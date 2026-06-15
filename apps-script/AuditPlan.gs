/** Audit plan generation, visibility, reminders, and idempotent status refresh. */
function generateAuditPlan(payload, currentUser) {
  try {
    var allowedRoles = getAuditPlanGenerationRoles_(currentUser);
    requirePermission_(currentUser, 'audit.plan.generate');
    requireFields_(payload, ['periodMonth']);
    var month = normalizePlanMonth_(payload.periodMonth);
    if (!month) throw new Error('periodMonth must use YYYY-MM or YYYYMM format.');
    var requestedRole = cleanString_(payload.requiredRole || payload.role) || 'ALL';
    var selectedRoles = isAllFilter_(requestedRole) ? allowedRoles.slice() : allowedRoles.filter(function (role) {
      return valuesEqual_(role, requestedRole);
    });
    if (!selectedRoles.length) {
      throw new Error('คุณไม่มีสิทธิ์สร้างแผนการตรวจสำหรับบทบาท ' + requestedRole);
    }
    var includeWeekends = payload.includeWeekends === true || isAllowed_(payload.includeWeekends);
    var lineFilter = cleanString_(payload.lineId) || 'ALL';
    var stationFilter = cleanString_(payload.stationId) || 'ALL';
    var lineAccess = getUserLineAccess_(currentUser);
    var canManageAllLines = isAdmin_(currentUser) || hasPermission_(currentUser, 'audit.view.all');
    if (!isAllFilter_(lineFilter) && !isAdmin_(currentUser) && !hasPermission_(currentUser, 'audit.view.all')) {
      requireLineAccess_(currentUser, lineFilter, 'View');
    }

    var lines = getRowsAsObjects(SHEET_NAMES.LINES).filter(function (row) {
      return isActive_(row.ActiveStatus) &&
        (isAllFilter_(lineFilter) || valuesEqual_(row.LineID, lineFilter)) &&
        (canManageAllLines || canAccessLineFromRows_(currentUser, row.LineID, 'View', lineAccess));
    });
    var lineIds = {};
    lines.forEach(function (row) { lineIds[cleanString_(row.LineID)] = row; });
    var stations = getRowsAsObjects(SHEET_NAMES.STATIONS).filter(function (row) {
      return isActive_(row.ActiveStatus) && Boolean(lineIds[cleanString_(row.LineID)]) &&
        (isAllFilter_(stationFilter) || valuesEqual_(row.StationID, stationFilter));
    });
    if (!stations.length) throw new Error('No active stations found for the selected scope.');

    var existingKeys = {};
    getRowsAsObjects(SHEET_NAMES.AUDIT_PLAN).forEach(function (row) {
      existingKeys[planDuplicateKey_(row)] = true;
    });
    var timestamp = formatDateTimeBangkok(new Date());
    var created = 0;
    var skipped = 0;
    stations.forEach(function (station) {
      var line = lineIds[cleanString_(station.LineID)] || {};
      buildMonthlyPlanDefinitions_(month, includeWeekends).forEach(function (definition) {
        if (!selectedRoles.some(function (role) { return valuesEqual_(role, definition.RequiredRole); })) return;
        var duplicateKey = [
          definition.PeriodType, definition.PeriodKey, definition.RequiredRole,
          station.LineID, station.StationID
        ].map(cleanString_).join('|').toLowerCase();
        if (existingKeys[duplicateKey]) {
          skipped++;
          return;
        }
        var planId = generateId('PLAN', SHEET_NAMES.AUDIT_PLAN, 'PlanID', month.replace('-', ''));
        appendObject(SHEET_NAMES.AUDIT_PLAN, {
          PlanID: planId, PeriodType: definition.PeriodType, PeriodKey: definition.PeriodKey,
          DueDate: definition.DueDate, DueTime: definition.DueTime,
          RequiredRole: definition.RequiredRole, RequiredUserID: '', RequiredUserName: '',
          LineID: station.LineID, LineName: station.LineName || line.LineName || '',
          StationID: station.StationID, StationName: station.StationName || '',
          AuditLayer: definition.RequiredRole, Frequency: definition.PeriodType, Status: 'Planned',
          CompletedAuditID: '', CompletedAt: '', SubmittedAt: '', IsLate: 'No', LateReason: '',
          CreatedAt: timestamp, CreatedBy: currentUser.UserID, UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
        });
        existingKeys[duplicateKey] = true;
        created++;
      });
    });
    invalidateDashboardCachesForUser_(currentUser);
    return jsonResponse(true, 'Audit plan generated.', {
      created: created, skippedDuplicates: skipped, month: month,
      lineScope: lineFilter, stationScope: stationFilter, includeWeekends: includeWeekends,
      roleScope: selectedRoles
    });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function getAuditPlanGenerationRoles_(currentUser) {
  var role = cleanString_(currentUser && currentUser.Role).toLowerCase();
  if (role === 'admin' || role === 'manager') return ['Leader', 'Supervisor', 'Manager'];
  if (role === 'supervisor') return ['Leader', 'Supervisor'];
  throw new Error('คุณไม่มีสิทธิ์สร้างแผนการตรวจ LPA');
}

function getAuditPlan(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'audit.plan.view');
    var month = normalizePlanMonth_(payload.periodMonth) || formatDateBangkok_(new Date()).slice(0, 7);
    var now = new Date();
    var pageSize = Math.min(Math.max(toNumber_(payload.pageSize || payload.limit) || 100, 1), 500);
    var page = Math.max(toNumber_(payload.page) || 1, 1);
    var lineAccess = getUserLineAccess_(currentUser);
    var canViewAll = isAdmin_(currentUser) || hasPermission_(currentUser, 'audit.view.all');
    var audits = getRowsAsObjects(SHEET_NAMES.AUDIT_SESSIONS).filter(function (row) {
      return normalizeFindingPeriod_(row.PeriodMonth || row.AuditDate) === month.replace('-', '');
    });
    var auditIndex = buildAuditPlanMatchIndex_(audits);
    var rows = getRowsAsObjects(SHEET_NAMES.AUDIT_PLAN).filter(function (row) {
      return cleanString_(row.DueDate).slice(0, 7) === month;
    }).map(function (row) {
      return effectiveAuditPlan_(row, audits, now, auditIndex);
    }).filter(function (row) {
      return (isAllFilter_(payload.lineId) || valuesEqual_(row.LineID, payload.lineId)) &&
        (isAllFilter_(payload.stationId) || valuesEqual_(row.StationID, payload.stationId)) &&
        (isAllFilter_(payload.requiredRole) || valuesEqual_(row.RequiredRole, payload.requiredRole)) &&
        (isAllFilter_(payload.status) || valuesEqual_(row.Status, payload.status));
    });
    rows = rows.filter(function (row) {
      return canViewAuditPlanFromRows_(currentUser, row, payload.myPlanOnly, lineAccess, canViewAll);
    });
    rows.sort(function (a, b) {
      return (cleanString_(a.DueDate) + cleanString_(a.DueTime)).localeCompare(cleanString_(b.DueDate) + cleanString_(b.DueTime));
    });
    var total = rows.length;
    var offset = (page - 1) * pageSize;
    return jsonResponse(true, 'Audit plan loaded.', {
      plans: rows.slice(offset, offset + pageSize).map(sanitizeForClient_),
      count: Math.min(pageSize, Math.max(total - offset, 0)), total: total, page: page, pageSize: pageSize, month: month
    });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function refreshAuditPlanStatus(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'audit.plan.refresh');
    var month = normalizePlanMonth_(payload.periodMonth) || formatDateBangkok_(new Date()).slice(0, 7);
    var period = month.replace('-', '');
    var rows = getRowsAsObjects(SHEET_NAMES.AUDIT_PLAN).filter(function (plan) {
      return cleanString_(plan.DueDate).slice(0, 7) === month;
    });
    var audits = getRowsAsObjects(SHEET_NAMES.AUDIT_SESSIONS).filter(function (audit) {
      return normalizeFindingPeriod_(audit.PeriodMonth || audit.AuditDate) === period;
    });
    var auditIndex = buildAuditPlanMatchIndex_(audits);
    var now = new Date();
    var today = formatDateBangkok_(now);
    var updated = 0;
    rows.forEach(function (plan) {
      if (!canViewAuditPlan_(currentUser, plan, false)) return;
      var audit = findMatchingAuditForPlan_(plan, audits, auditIndex);
      var changes = audit ? completedPlanChanges_(plan, audit, now, currentUser.UserID) :
        pendingPlanChanges_(plan, today, now, currentUser.UserID);
      if (changes.Status !== cleanString_(plan.Status) ||
          cleanString_(changes.CompletedAuditID) !== cleanString_(plan.CompletedAuditID) ||
          cleanString_(changes.IsLate) !== cleanString_(plan.IsLate)) {
        updateObjectById(SHEET_NAMES.AUDIT_PLAN, 'PlanID', plan.PlanID, changes);
        updated++;
      }
    });
    invalidateDashboardCachesForUser_(currentUser);
    return jsonResponse(true, 'Audit plan status refreshed.', { updated: updated, checked: rows.length });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function getMyAuditPlanSummary(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'audit.plan.view');
    var now = new Date();
    var month = normalizePlanMonth_(payload.periodMonth) || formatDateBangkok_(now).slice(0, 7);
    var lineAccess = getUserLineAccess_(currentUser);
    var cacheKey = auditPlanSummaryCacheKey_(currentUser, month.replace('-', ''), lineAccess);
    var cached = safeCacheGetJson_(cacheKey);
    if (cached) return jsonResponse(true, 'Audit plan summary loaded from cache.', cached);
    var canViewAll = isAdmin_(currentUser) || hasPermission_(currentUser, 'audit.view.all');
    var audits = getRowsAsObjects(SHEET_NAMES.AUDIT_SESSIONS).filter(function (row) {
      return normalizeFindingPeriod_(row.PeriodMonth || row.AuditDate) === month.replace('-', '');
    });
    var summary = summarizeAuditPlanRows_(
      currentUser, month, now, audits, lineAccess, canViewAll, true
    );
    safeCachePutJson_(cacheKey, summary, 60);
    return jsonResponse(true, 'Audit plan summary loaded.', summary);
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function summarizeAuditPlanRows_(currentUser, month, now, audits, lineAccess, canViewAll, myPlanOnly) {
  var today = formatDateBangkok_(now);
  var weekKey = isoWeekKey_(now);
  var auditIndex = buildAuditPlanMatchIndex_(audits || []);
  var summary = {
    DueToday: 0, Overdue: 0, ThisWeek: 0, ThisMonth: 0,
    Completed: 0, LateSubmitted: 0, Missed: 0, Total: 0
  };
  getRowsAsObjects(SHEET_NAMES.AUDIT_PLAN).forEach(function (plan) {
    if (cleanString_(plan.DueDate).slice(0, 7) !== month) return;
    var row = effectiveAuditPlan_(plan, audits || [], now, auditIndex);
    if (!canViewAuditPlanFromRows_(currentUser, row, myPlanOnly, lineAccess || [], canViewAll)) return;
    var status = cleanString_(row.Status);
    summary.Total++;
    if (valuesEqual_(row.DueDate, today) && ['Completed', 'Late Submitted'].indexOf(status) === -1) summary.DueToday++;
    if (status === 'Overdue') summary.Overdue++;
    if (cleanString_(row.PeriodKey) === weekKey) summary.ThisWeek++;
    summary.ThisMonth++;
    if (status === 'Completed') summary.Completed++;
    if (status === 'Late Submitted') summary.LateSubmitted++;
    if (status === 'Missed') summary.Missed++;
  });
  return summary;
}

function findMatchingPlanForAudit_(payload) {
  var explicitPlanId = cleanString_(payload.planId);
  var plans = getRowsAsObjects(SHEET_NAMES.AUDIT_PLAN);
  if (explicitPlanId) {
    return plans.filter(function (row) { return valuesEqual_(row.PlanID, explicitPlanId); })[0] || null;
  }
  var auditDate = formatDateBangkok_(payload.auditDate);
  return plans.filter(function (row) {
    return valuesEqual_(row.AuditLayer, payload.auditLayer) && valuesEqual_(row.LineID, payload.lineId) &&
      valuesEqual_(row.StationID, payload.stationId) && dateBelongsToPlan_(auditDate, row);
  }).sort(function (a, b) { return cleanString_(a.DueDate).localeCompare(cleanString_(b.DueDate)); })[0] || null;
}

function completeAuditPlan_(plan, auditId, submittedAt, isLate, lateReason, currentUser) {
  if (!plan) return;
  updateObjectById(SHEET_NAMES.AUDIT_PLAN, 'PlanID', plan.PlanID, {
    Status: isLate ? 'Late Submitted' : 'Completed', CompletedAuditID: auditId,
    CompletedAt: submittedAt, SubmittedAt: submittedAt, IsLate: isLate ? 'Yes' : 'No',
    LateReason: lateReason || '', UpdatedAt: submittedAt, UpdatedBy: currentUser.UserID
  });
}

function buildMonthlyPlanDefinitions_(month, includeWeekends) {
  var parts = month.split('-');
  var year = Number(parts[0]);
  var monthIndex = Number(parts[1]) - 1;
  var cursor = new Date(year, monthIndex, 1);
  var daily = [];
  var weekDueDates = {};
  var lastWorkingDay = '';
  while (cursor.getMonth() === monthIndex) {
    var day = cursor.getDay();
    var dateText = localPlanDate_(cursor);
    var workingDay = day !== 0 && day !== 6;
    if (includeWeekends || workingDay) daily.push(planDefinition_('Daily', dateText.replace(/-/g, ''), dateText, 'Leader'));
    if (workingDay) lastWorkingDay = dateText;
    var weekKey = isoWeekKey_(cursor);
    if (!weekDueDates[weekKey] || day === 5) weekDueDates[weekKey] = dateText;
    cursor.setDate(cursor.getDate() + 1);
  }
  var weekly = Object.keys(weekDueDates).sort().map(function (weekKey) {
    return planDefinition_('Weekly', weekKey, weekDueDates[weekKey], 'Supervisor');
  });
  var monthly = [planDefinition_('Monthly', month.replace('-', ''), lastWorkingDay, 'Manager')];
  return daily.concat(weekly).concat(monthly);
}

function planDefinition_(type, key, dueDate, role) {
  return { PeriodType: type, PeriodKey: key, DueDate: dueDate, DueTime: '17:00', RequiredRole: role };
}

function findMatchingAuditForPlan_(plan, audits, auditIndex) {
  var index = auditIndex || buildAuditPlanMatchIndex_(audits || []);
  if (plan.CompletedAuditID) {
    var linked = index.byAuditId[cleanString_(plan.CompletedAuditID).toLowerCase()];
    if (linked) return linked;
  }
  var explicit = index.byPlanId[cleanString_(plan.PlanID).toLowerCase()];
  if (explicit) return explicit;
  return (index.byScope[auditPlanScopeKey_(plan)] || []).filter(function (audit) {
    return valuesEqual_(audit.AuditLayer, plan.AuditLayer) &&
      (valuesEqual_(audit.PlanID, plan.PlanID) || dateBelongsToPlan_(audit.AuditDate, plan));
  }).sort(function (a, b) { return cleanString_(a.SubmittedAt || a.CreatedAt).localeCompare(cleanString_(b.SubmittedAt || b.CreatedAt)); })[0] || null;
}

function buildAuditPlanMatchIndex_(audits) {
  var index = { byAuditId: {}, byPlanId: {}, byScope: {} };
  (audits || []).forEach(function (audit) {
    var auditId = cleanString_(audit.AuditID).toLowerCase();
    var planId = cleanString_(audit.PlanID).toLowerCase();
    var scopeKey = auditPlanScopeKey_(audit);
    if (auditId) index.byAuditId[auditId] = audit;
    if (planId && !index.byPlanId[planId]) index.byPlanId[planId] = audit;
    if (!index.byScope[scopeKey]) index.byScope[scopeKey] = [];
    index.byScope[scopeKey].push(audit);
  });
  return index;
}

function auditPlanScopeKey_(row) {
  return [row.AuditLayer, row.LineID, row.StationID].map(cleanString_).join('|').toLowerCase();
}

function completedPlanChanges_(plan, audit, now, userId) {
  var submitted = cleanString_(audit.SubmittedAt || audit.CreatedAt) || formatDateTimeBangkok(now);
  var late = valuesEqual_(audit.IsLate, 'Yes') || submitted > cleanString_(plan.DueDate) + ' ' + (cleanString_(plan.DueTime) || '17:00') + ':00';
  return {
    Status: late ? 'Late Submitted' : 'Completed', CompletedAuditID: audit.AuditID,
    CompletedAt: submitted, SubmittedAt: submitted, IsLate: late ? 'Yes' : 'No',
    LateReason: audit.LateReason || '', UpdatedAt: formatDateTimeBangkok(now), UpdatedBy: userId
  };
}

function pendingPlanChanges_(plan, today, now, userId) {
  var dueDate = cleanString_(plan.DueDate);
  var status = dueDate === today ? 'Due Today' : (dueDate > today ? 'Planned' : (planPeriodEnded_(plan, now) ? 'Missed' : 'Overdue'));
  return {
    Status: status, CompletedAuditID: '', CompletedAt: '', SubmittedAt: '', IsLate: 'No',
    LateReason: '', UpdatedAt: formatDateTimeBangkok(now), UpdatedBy: userId
  };
}

/** Returns current effective status without writing, so read APIs never expose stale plan state. */
function effectiveAuditPlan_(plan, audits, now, auditIndex) {
  var effective = {};
  Object.keys(plan || {}).forEach(function (key) { effective[key] = plan[key]; });
  var audit = findMatchingAuditForPlan_(plan, audits || [], auditIndex);
  var changes = audit ? completedPlanChanges_(plan, audit, now, '') :
    pendingPlanChanges_(plan, formatDateBangkok_(now), now, '');
  ['Status', 'CompletedAuditID', 'CompletedAt', 'SubmittedAt', 'IsLate', 'LateReason'].forEach(function (field) {
    effective[field] = changes[field];
  });
  return effective;
}

function planPeriodEnded_(plan, now) {
  var today = formatDateBangkok_(now);
  if (valuesEqual_(plan.PeriodType, 'Daily')) return cleanString_(plan.DueDate) < formatDateBangkok_(new Date(now.getTime() - 86400000));
  if (valuesEqual_(plan.PeriodType, 'Weekly')) return cleanString_(plan.PeriodKey) < isoWeekKey_(now);
  return cleanString_(plan.PeriodKey) < today.slice(0, 7).replace('-', '');
}

function canViewAuditPlan_(user, row, myPlanOnly) {
  if (isAdmin_(user) || hasPermission_(user, 'audit.view.all')) return !myPlanOnly || !row.RequiredUserID || valuesEqual_(row.RequiredUserID, user.UserID);
  if (!canAccessLine_(user, row.LineID, 'View')) return false;
  if (myPlanOnly === true || isAllowed_(myPlanOnly)) {
    return row.RequiredUserID ? valuesEqual_(row.RequiredUserID, user.UserID) : valuesEqual_(row.RequiredRole, user.Role);
  }
  if (cleanString_(user.Role).toLowerCase() === 'leader') {
    return row.RequiredUserID ? valuesEqual_(row.RequiredUserID, user.UserID) : valuesEqual_(row.RequiredRole, 'Leader');
  }
  return true;
}

function canViewAuditPlanFromRows_(user, row, myPlanOnly, lineAccess, canViewAll) {
  if (isAdmin_(user)) return true;
  if (canViewAll && !(myPlanOnly === true || isAllowed_(myPlanOnly))) return true;
  if (canViewAll && (myPlanOnly === true || isAllowed_(myPlanOnly))) {
    return row.RequiredUserID ? valuesEqual_(row.RequiredUserID, user.UserID) : valuesEqual_(row.RequiredRole, user.Role);
  }
  if (!canAccessLineFromRows_(user, row.LineID, 'View', lineAccess)) return false;
  if (myPlanOnly === true || isAllowed_(myPlanOnly)) {
    return row.RequiredUserID ? valuesEqual_(row.RequiredUserID, user.UserID) : valuesEqual_(row.RequiredRole, user.Role);
  }
  if (cleanString_(user.Role).toLowerCase() === 'leader') {
    return row.RequiredUserID ? valuesEqual_(row.RequiredUserID, user.UserID) : valuesEqual_(row.RequiredRole, 'Leader');
  }
  return true;
}

function canAccessLineFromRows_(user, lineId, requiredLevel, lineAccess) {
  if (isAdmin_(user) || isAllFilter_(lineId)) return true;
  var levelRank = { view: 1, audit: 2, update: 2, manage: 3, all: 3 };
  var minimum = levelRank[cleanString_(requiredLevel).toLowerCase()] || 1;
  return (lineAccess || []).some(function (row) {
    return (valuesEqual_(row.LineID, lineId) || valuesEqual_(row.LineID, 'ALL')) &&
      (levelRank[cleanString_(row.AccessLevel).toLowerCase()] || 0) >= minimum;
  });
}

function lineAccessScopeKey_(lineAccess) {
  return (lineAccess || []).map(function (row) {
    return cleanString_(row.LineID) + ':' + cleanString_(row.AccessLevel);
  }).sort().join(',').slice(0, 120) || 'NONE';
}

function auditPlanSummaryCacheKey_(user, period, lineAccess) {
  return 'LPA_PLAN_SUM_' + cleanString_(user.UserID) + '_' + cleanString_(user.Role) + '_' + period + '_' +
    lineAccessScopeKey_(lineAccess);
}

function invalidateDashboardCachesForUser_(user) {
  if (!user) return;
  var period = getPeriodMonth(new Date());
  var lineAccess = getUserLineAccess_(user);
  safeCacheRemove_([
    dashboardCacheKey_(user, period, lineAccess, ''),
    auditPlanSummaryCacheKey_(user, period, lineAccess),
    auditRuleSummaryCacheKey_(user, formatDateBangkok_(new Date()), lineAccess)
  ]);
}

function dateBelongsToPlan_(auditDate, plan) {
  var date = parseDate_(auditDate);
  if (!date) return false;
  if (valuesEqual_(plan.PeriodType, 'Daily')) return cleanString_(auditDate).slice(0, 10).replace(/-/g, '') === cleanString_(plan.PeriodKey);
  if (valuesEqual_(plan.PeriodType, 'Weekly')) return isoWeekKey_(date) === cleanString_(plan.PeriodKey);
  return cleanString_(auditDate).slice(0, 7).replace('-', '') === cleanString_(plan.PeriodKey);
}

function normalizePlanMonth_(value) {
  var text = cleanString_(value);
  if (/^\d{6}$/.test(text)) return text.slice(0, 4) + '-' + text.slice(4);
  return /^\d{4}-\d{2}$/.test(text) ? text : '';
}

function planDuplicateKey_(row) {
  return [row.PeriodType, row.PeriodKey, row.RequiredRole, row.LineID, row.StationID].map(cleanString_).join('|').toLowerCase();
}

function localPlanDate_(date) {
  return date.getFullYear() + '-' + padNumber_(date.getMonth() + 1, 2) + '-' + padNumber_(date.getDate(), 2);
}

function isoWeekKey_(date) {
  var value = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  value.setDate(value.getDate() + 4 - (value.getDay() || 7));
  var yearStart = new Date(value.getFullYear(), 0, 1);
  var week = Math.ceil((((value - yearStart) / 86400000) + 1) / 7);
  return value.getFullYear() + '-W' + padNumber_(week, 2);
}
