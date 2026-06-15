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
    var cache = CacheService.getScriptCache();
    var cacheKey = dashboardCacheKey_(currentUser, currentPeriod, lineAccess, payload.lineId);
    var cached = cache.get(cacheKey);
    if (cached) return jsonResponse(true, 'Dashboard loaded from cache.', JSON.parse(cached));
    var audits = getRowsAsObjects(SHEET_NAMES.AUDIT_SESSIONS);
    var findings = getRowsAsObjects(SHEET_NAMES.FINDINGS).map(refreshOverdueForRead_);
    var allFindings = findings.slice();
    var planSummary = summarizeAuditPlansForDashboard_(
      currentUser, now, audits, lineAccess, canViewAll, permissionEnabled_(permissions, 'audit.plan.view')
    );
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
      AuditPlanSummary: planSummary,
      TopNGCategory: topCategory ? { Category: topCategory, Count: categoryNg[topCategory] } : {},
      MonthlyAuditResult: Object.keys(monthly).sort().slice(-12).map(function (key) { return monthly[key]; }),
      SummaryByLine: Object.keys(byLine).sort().map(function (key) { return byLine[key]; }),
      ActionsNearDueDate: nearDue
    };
    cache.put(cacheKey, JSON.stringify(result), 60);
    return jsonResponse(true, 'Dashboard loaded.', result);
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function summarizeAuditPlansForDashboard_(currentUser, now, auditRows, lineAccess, canViewAll, canViewPlans) {
  if (!canViewPlans) {
    return { DueToday: 0, Overdue: 0, ThisWeek: 0, ThisMonth: 0, Completed: 0, LateSubmitted: 0, Missed: 0, Total: 0 };
  }
  var today = formatDateBangkok_(now);
  var week = isoWeekKey_(now);
  var month = today.slice(0, 7);
  var summary = { DueToday: 0, Overdue: 0, ThisWeek: 0, ThisMonth: 0, Completed: 0, LateSubmitted: 0, Missed: 0, Total: 0 };
  var audits = (auditRows || []).filter(function (row) {
    return normalizeFindingPeriod_(row.PeriodMonth || row.AuditDate) === month.replace('-', '');
  });
  var auditIndex = buildAuditPlanMatchIndex_(audits);
  getRowsAsObjects(SHEET_NAMES.AUDIT_PLAN).filter(function (row) {
    return cleanString_(row.DueDate).slice(0, 7) === month;
  }).map(function (row) {
    return effectiveAuditPlan_(row, audits, now, auditIndex);
  }).filter(function (row) {
    return canViewAuditPlanFromRows_(currentUser, row, true, lineAccess || [], canViewAll);
  }).forEach(function (row) {
    summary.Total++;
    if (valuesEqual_(row.DueDate, today) && ['Completed', 'Late Submitted'].indexOf(cleanString_(row.Status)) === -1) summary.DueToday++;
    if (valuesEqual_(row.Status, 'Overdue')) summary.Overdue++;
    if (valuesEqual_(row.PeriodKey, week)) summary.ThisWeek++;
    if (cleanString_(row.DueDate).slice(0, 7) === month) summary.ThisMonth++;
    if (valuesEqual_(row.Status, 'Completed')) summary.Completed++;
    if (valuesEqual_(row.Status, 'Late Submitted')) summary.LateSubmitted++;
    if (valuesEqual_(row.Status, 'Missed')) summary.Missed++;
  });
  return summary;
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
