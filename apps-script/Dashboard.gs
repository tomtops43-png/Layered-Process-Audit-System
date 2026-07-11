/** Single-call batch for Leader/Supervisor dashboard — replaces 4 separate API calls. */
function getLeaderDashboardBatch(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'dashboard.view');
    var batchCacheKey = 'LPA_LEADER_BATCH_' + cleanString_(currentUser.UserID);
    var cached = safeCacheGetJson_(batchCacheKey);
    if (cached) return jsonResponse(true, 'Leader batch loaded from cache.', cached);

    var now = new Date();
    var today = formatDateBangkok_(now);
    var lineAccess = getUserLineAccess_(currentUser);

    // Shared data reads — each sheet is read once
    var allAuditSessions = getRowsAsObjects(SHEET_NAMES.AUDIT_SESSIONS);
    var allFindingRows = getCachedFindingRows_().map(refreshOverdueForRead_);

    // 1. Dashboard summary (AuditRuleSummary)
    var ruleSummary = { DueToday: 0, Overdue: 0, Missed: 0, ThisWeek: 0, CompletedThisMonth: 0, RuleCount: 0 };
    try { ruleSummary = getRuleBasedAuditSummary_(currentUser, now, lineAccess, allAuditSessions); } catch (_) {}

    // 2. Schedule rules for this user's role
    var rules = getAuditPlanRuleRows_().filter(function(r) {
      return isActive_(r.ActiveStatus) &&
        valuesEqual_(r.RequiredRole, currentUser.Role) &&
        (!cleanString_(r.RequiredUserID) || valuesEqual_(r.RequiredUserID, currentUser.UserID)) &&
        canAccessLineFromRows_(currentUser, r.LineID, 'View', lineAccess);
    }).map(sanitizeAuditRuleForClient_);

    // 3. Audit sessions: entire current month (covers daily, weekly, monthly rule checks)
    var monthStart = today.slice(0, 7) + '-01';
    var dayOfWeek = now.getDay(); // 0=Sun
    var daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    var monday = new Date(now); monday.setDate(now.getDate() - daysToMonday); monday.setHours(0,0,0,0);
    var weekStart = formatDateBangkok_(monday);
    var todayAudits = allAuditSessions.filter(function(a) {
      var d = dateOnly_(a.AuditDate);
      return d >= monthStart && d <= today &&
        (canAccessLineFromRows_(currentUser, a.LineID, 'View', lineAccess) ||
         valuesEqual_(a.AuditorUserID, currentUser.UserID));
    }).map(sanitizeForClient_);

    // 4. My open findings
    var myFindings = allFindingRows.filter(function(f) {
      if (isClosedStatus_(f.Status)) return false;
      // Assigned to me (Leader: corrective action owner)
      if (isAssignedToUser_(f, currentUser)) return true;
      // Pending Verification that I can verify (Supervisor/Manager)
      if (valuesEqual_(f.Status, 'Pending Verification') && canHandlePendingVerification_(currentUser, f)) return true;
      return false;
    }).map(sanitizeFindingForClient_);

    // 5. Findings opened this shift, for the Leader's morning meeting — every
    // finding on lines the user can view, not just findings assigned to them.
    var shiftInfo = detectShiftInfo_(now);
    var auditShiftMap = {};
    allAuditSessions.forEach(function(a) {
      var id = cleanString_(a.AuditID);
      if (id) auditShiftMap[id] = { shift: cleanString_(a.Shift), date: dateOnly_(a.AuditDate) };
    });
    var shiftFindings = allFindingRows.filter(function(f) {
      var info = auditShiftMap[cleanString_(f.AuditID)];
      var foundDate = info ? info.date : dateOnly_(f.FoundDate);
      var shiftName = info ? info.shift : '';
      if (foundDate !== shiftInfo.date) return false;
      if (shiftName && shiftName !== shiftInfo.name) return false;
      return canAccessLineFromRows_(currentUser, f.LineID, 'View', lineAccess);
    }).sort(function(a, b) { return cleanString_(a.FoundDate).localeCompare(cleanString_(b.FoundDate)); })
      .map(sanitizeFindingForClient_);

    var result = {
      ruleSummary: ruleSummary, rules: rules,
      todayAudits: todayAudits, myFindings: myFindings,
      shiftInfo: shiftInfo, shiftFindings: shiftFindings,
      MyOpenFindings: myFindings.length,
      MyOverdueFindings: myFindings.filter(function(f){ return valuesEqual_(f.OverdueFlag,'Yes'); }).length,
      serverDate: today
    };
    safeCachePutJson_(batchCacheKey, result, 90); // 90 sec server cache
    return jsonResponse(true, 'Leader batch loaded.', result);
  } catch(error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

/** Dashboard KPI and grouped-summary API. */
function getDashboard(payload, currentUser) {
  try {
    var permissions = getUserPermissions_(currentUser);
    var canViewAll = permissionEnabled_(permissions, 'dashboard.view.all');
    if (!permissionEnabled_(permissions, 'dashboard.view') && !canViewAll) {
      throw new Error('Permission denied: dashboard.view');
    }
    var now = new Date();
    var currentPeriod = getPeriodMonth(now);
    var lineAccess = getUserLineAccess_(currentUser);
    var cacheKey = dashboardCacheKey_(currentUser, currentPeriod, lineAccess, payload.lineId);
    var cached = safeCacheGetJson_(cacheKey);
    if (cached) return jsonResponse(true, 'Dashboard loaded from cache.', cached);
    var audits = getRowsAsObjects(SHEET_NAMES.AUDIT_SESSIONS);
    var findings = getCachedFindingRows_().map(refreshOverdueForRead_);
    var allFindings = findings.slice();
    var ruleSummary = { DueToday: 0, Overdue: 0, Missed: 0, ThisWeek: 0, CompletedThisMonth: 0, RuleCount: 0 };
    try {
      ruleSummary = getRuleBasedAuditSummary_(currentUser, now, lineAccess, audits);
    } catch (ruleError) {
      console.warn('Rule-based schedule summary skipped: ' + safeErrorMessage_(ruleError));
    }
    var managerAuditReminder = buildManagerAuditReminder_(currentUser, now, currentPeriod, audits);
    if (payload.lineId) {
      if (!canViewAll && !canAccessLineFromRows_(currentUser, payload.lineId, 'View', lineAccess)) {
        throw new Error('Line access denied: ' + cleanString_(payload.lineId));
      }
      audits = audits.filter(function (row) { return valuesEqual_(row.LineID, payload.lineId); });
      findings = findings.filter(function (row) { return valuesEqual_(row.LineID, payload.lineId); });
    }
    if (!canViewAll) {
      audits = audits.filter(function (row) {
        return canAccessLineFromRows_(currentUser, row.LineID, 'View', lineAccess) ||
          valuesEqual_(row.AuditorUserID, currentUser.UserID);
      });
      findings = findings.filter(function (row) {
        return canViewFindingForDashboard_(currentUser, row, permissions, lineAccess);
      });
    }
    if (['Leader', 'User'].indexOf(currentUser.Role) !== -1) findings = findings.filter(function (row) { return canAccessFinding_(currentUser, row); });

    var categoryNg = {};
    findings.forEach(function (row) { var key = cleanString_(row.Category) || 'Uncategorized'; categoryNg[key] = (categoryNg[key] || 0) + 1; });
    var topCategory = Object.keys(categoryNg).sort(function (a, b) { return categoryNg[b] - categoryNg[a]; })[0] || '';
    var monthly = {};
    audits.forEach(function (row) {
      var key = cleanString_(row.PeriodMonth);
      if (!monthly[key]) monthly[key] = { PeriodMonth: key, TotalAudit: 0, TotalOK: 0, TotalNG: 0, TotalNA: 0 };
      monthly[key].TotalAudit++;
      monthly[key].TotalOK += toNumber_(row.TotalOK); monthly[key].TotalNG += toNumber_(row.TotalNG); monthly[key].TotalNA += toNumber_(row.TotalNA);
    });
    var byLine = {};
    audits.forEach(function (row) {
      var key = cleanString_(row.LineID) || 'Unassigned';
      if (!byLine[key]) byLine[key] = { LineID: key, LineName: cleanString_(row.LineName), TotalAudit: 0, TotalNG: 0, OpenFinding: 0 };
      if (!byLine[key].LineName) byLine[key].LineName = cleanString_(row.LineName);
      byLine[key].TotalAudit++; byLine[key].TotalNG += toNumber_(row.TotalNG);
    });
    findings.forEach(function (row) {
      var key = cleanString_(row.LineID) || 'Unassigned';
      if (!byLine[key]) byLine[key] = { LineID: key, LineName: cleanString_(row.LineName), TotalAudit: 0, TotalNG: 0, OpenFinding: 0 };
      if (!byLine[key].LineName) byLine[key].LineName = cleanString_(row.LineName);
      if (!isClosedStatus_(row.Status)) byLine[key].OpenFinding++;
    });
    var today = parseDate_(formatDateBangkok_(now));
    var nearDue = findings.filter(function (row) {
      if (isClosedStatus_(row.Status)) return false;
      var due = parseDate_(row.DueDate);
      if (!due) return false;
      var days = Math.floor((due.getTime() - today.getTime()) / 86400000);
      return days >= 0 && days <= 7;
    }).sort(function (a, b) { return cleanString_(a.DueDate).localeCompare(cleanString_(b.DueDate)); })
      .slice(0, 50).map(sanitizeForClient_);

    var result = {
      TotalAudit: audits.length,
      AuditThisMonth: audits.filter(function (row) { return valuesEqual_(row.PeriodMonth, currentPeriod); }).length,
      TotalFinding: findings.length,
      OpenFinding: findings.filter(function (row) { return valuesEqual_(row.Status, 'Open'); }).length,
      OnGoingFinding: findings.filter(function (row) { return ['on going', 'ongoing', 'in progress'].indexOf(cleanString_(row.Status).toLowerCase()) !== -1; }).length,
      ClosedFinding: findings.filter(function (row) { return isClosedStatus_(row.Status); }).length,
      OverdueAction: findings.filter(function (row) { return valuesEqual_(row.OverdueFlag, 'Yes'); }).length,
      MyOpenFindings: allFindings.filter(function (row) {
        return isAssignedToUser_(row, currentUser) && !isClosedStatus_(row.Status);
      }).length,
      MyOverdueFindings: allFindings.filter(function (row) {
        return isAssignedToUser_(row, currentUser) && valuesEqual_(row.OverdueFlag, 'Yes');
      }).length,
      PendingMyVerification: allFindings.filter(function (row) {
        return valuesEqual_(row.Status, 'Pending Verification') &&
          canViewFindingForDashboard_(currentUser, row, permissions, lineAccess) &&
          permissionEnabled_(permissions, 'findings.verify');
      }).length,
      AuditRuleSummary: ruleSummary,
      TopNGCategory: topCategory ? { Category: topCategory, Count: categoryNg[topCategory] } : {},
      MonthlyAuditResult: Object.keys(monthly).sort().slice(-12).map(function (key) { return monthly[key]; }),
      SummaryByLine: Object.keys(byLine).sort().map(function (key) { return byLine[key]; }),
      ActionsNearDueDate: nearDue,
      ManagerAuditReminder: managerAuditReminder
    };
    safeCachePutJson_(cacheKey, result, 60);
    return jsonResponse(true, 'Dashboard loaded.', result);
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

/** Manager must complete at least 1 LPA audit per month for EACH line they're responsible for, deadline day 30 (or last day if month is shorter). */
function buildManagerAuditReminder_(currentUser, now, currentPeriod, allAudits) {
  if (cleanString_(currentUser.Role) !== 'Manager') return null;
  var lines = resolveUserResponsibleLines_(currentUser);
  if (!lines.length) return null;

  var doneLineIds = {};
  allAudits.forEach(function (row) {
    if (valuesEqual_(row.PeriodMonth, currentPeriod) &&
        valuesEqual_(row.AuditorUserID, currentUser.UserID) &&
        valuesEqual_(row.AuditorRole, 'Manager')) {
      doneLineIds[cleanString_(row.LineID)] = true;
    }
  });
  var missingLines = lines.filter(function (l) { return !doneLineIds[l.LineID]; });
  var completed = missingLines.length === 0;

  var year = now.getFullYear();
  var month = now.getMonth();
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var deadlineDay = Math.min(30, daysInMonth);
  var deadlineDate = new Date(year, month, deadlineDay);
  var todayOnly = new Date(year, month, now.getDate());
  var daysLeft = Math.ceil((deadlineDate.getTime() - todayOnly.getTime()) / 86400000);

  return {
    Completed: completed,
    DaysLeft: daysLeft,
    DeadlineDate: formatDateBangkok_(deadlineDate),
    Overdue: !completed && daysLeft < 0,
    TotalLines: lines.length,
    DoneLines: lines.length - missingLines.length,
    MissingLines: missingLines.map(function (l) { return l.LineName || l.LineID; }),
    Lines: lines.map(function (l) {
      return { LineID: l.LineID, LineName: l.LineName || l.LineID, Done: Boolean(doneLineIds[l.LineID]) };
    })
  };
}

/** Resolve the distinct active lines a user is responsible for (expands 'ALL' access to every active line). */
function resolveUserResponsibleLines_(currentUser) {
  var allLines = getRowsAsObjects(SHEET_NAMES.LINES).filter(function (l) { return isActive_(l.ActiveStatus); });
  var access = getUserLineAccess_(currentUser);
  var hasAll = access.some(function (row) { return isAllFilter_(row.LineID); });
  if (hasAll) return allLines.map(function (l) { return { LineID: cleanString_(l.LineID), LineName: cleanString_(l.LineName) }; });
  var ids = {};
  access.forEach(function (row) { var id = cleanString_(row.LineID); if (id) ids[id] = true; });
  return allLines.filter(function (l) { return ids[cleanString_(l.LineID)]; })
    .map(function (l) { return { LineID: cleanString_(l.LineID), LineName: cleanString_(l.LineName) }; });
}

/** Mirrors the frontend's detectCurrentShift()/getShiftDate() so shift findings line up with the shift badge shown on the dashboard. */
function detectShiftInfo_(now) {
  var hour = Number(Utilities.formatDate(now, APP_TIMEZONE, 'H'));
  var name = (hour >= 8 && hour < 20) ? 'กะเช้า' : 'กะดึก';
  var date = formatDateBangkok_(now);
  if (name === 'กะดึก' && hour < 8) {
    date = formatDateBangkok_(new Date(now.getTime() - 24 * 3600 * 1000));
  }
  return { name: name, date: date };
}

function dashboardCacheKey_(user, period, lineAccess, lineId) {
  return 'LPA_DASH_' + cleanString_(user.UserID) + '_' + cleanString_(user.Role) + '_' + period + '_' +
    cleanString_(lineId || 'ALL') + '_' + lineAccessScopeKey_(lineAccess);
}

function permissionEnabled_(permissions, key) {
  return permissions['*'] === true || permissions[key] === true;
}

function canViewFindingForDashboard_(user, finding, permissions, lineAccess) {
  if (isAdmin_(user) || permissionEnabled_(permissions, 'findings.view.all')) return true;
  var canViewLine = permissionEnabled_(permissions, 'findings.view.line') &&
    canAccessLineFromRows_(user, finding.LineID, 'View', lineAccess);
  if (canViewLine) return true;
  if (permissionEnabled_(permissions, 'findings.view.assigned') && isAssignedToUser_(finding, user)) return true;
  if (permissionEnabled_(permissions, 'findings.view.created') && isCreatedByUser_(finding, user)) return true;
  if (!valuesEqual_(finding.Status, 'Pending Verification') || !permissionEnabled_(permissions, 'findings.verify')) return false;
  var verifierUserId = cleanString_(finding.VerifierUserID);
  if (verifierUserId) {
    return valuesEqual_(verifierUserId, user.UserID) || cleanString_(user.Role).toLowerCase() === 'manager';
  }
  return canAccessLineFromRows_(user, finding.LineID, 'View', lineAccess);
}
