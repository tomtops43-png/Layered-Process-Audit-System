/** Lightweight rule-based LPA schedule APIs and in-memory due calculation. */
function getAuditPlanRules(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'audit.plan.view');
    var lineAccess = getUserLineAccess_(currentUser);
    var canViewAll = isAdmin_(currentUser) || hasPermission_(currentUser, 'audit.view.all');
    var limit = Math.min(Math.max(toNumber_(payload.limit || payload.pageSize) || 100, 1), 300);
    var rows = getRowsAsObjects(SHEET_NAMES.AUDIT_PLAN_RULES).filter(function (row) {
      return (isAllFilter_(payload.lineId) || valuesEqual_(row.LineID, payload.lineId)) &&
        (isAllFilter_(payload.stationId) || valuesEqual_(row.StationID, payload.stationId)) &&
        (isAllFilter_(payload.requiredRole) || valuesEqual_(row.RequiredRole, payload.requiredRole)) &&
        (isAllFilter_(payload.requiredUserId) || valuesEqual_(row.RequiredUserID, payload.requiredUserId)) &&
        (isAllFilter_(payload.frequency) || valuesEqual_(row.Frequency, payload.frequency)) &&
        (isAllFilter_(payload.activeStatus) || valuesEqual_(row.ActiveStatus, payload.activeStatus)) &&
        (canViewAll || canAccessLineFromRows_(currentUser, row.LineID, 'View', lineAccess));
    }).sort(function (a, b) {
      return cleanString_(a.LineID).localeCompare(cleanString_(b.LineID)) ||
        cleanString_(a.StationID).localeCompare(cleanString_(b.StationID)) ||
        cleanString_(a.RequiredRole).localeCompare(cleanString_(b.RequiredRole));
    });
    return jsonResponse(true, 'Audit schedule rules loaded.', {
      rules: rows.slice(0, limit).map(sanitizeForClient_), total: rows.length, limit: limit
    });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function upsertAuditPlanRule(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'audit.plan.manage');
    requireFields_(payload, ['requiredRole', 'lineId', 'stationId', 'frequency', 'activeStatus']);
    var role = cleanString_(payload.requiredRole);
    var frequency = cleanString_(payload.frequency);
    if (['Leader', 'Supervisor', 'Manager'].indexOf(role) === -1) throw new Error('RequiredRole must be Leader, Supervisor, or Manager.');
    if (['Daily', 'Weekly', 'Monthly'].indexOf(frequency) === -1) throw new Error('Frequency must be Daily, Weekly, or Monthly.');
    if (!isAdmin_(currentUser)) requireLineAccess_(currentUser, payload.lineId, 'Manage');
    var line = findById_(SHEET_NAMES.LINES, 'LineID', payload.lineId) || {};
    var station = findById_(SHEET_NAMES.STATIONS, 'StationID', payload.stationId) || {};
    if (!station.StationID || !valuesEqual_(station.LineID, payload.lineId)) throw new Error('Station does not belong to the selected Line.');
    var assignedUser = cleanString_(payload.requiredUserId) ?
      findById_(SHEET_NAMES.USERS, 'UserID', payload.requiredUserId) : null;
    if (payload.requiredUserId && (!assignedUser || !isActive_(assignedUser.ActiveStatus))) throw new Error('Assigned user was not found or is inactive.');
    if (assignedUser && !valuesEqual_(assignedUser.Role, role)) throw new Error('Assigned user role must match RequiredRole.');
    var duplicate = getRowsAsObjects(SHEET_NAMES.AUDIT_PLAN_RULES).some(function (row) {
      return !valuesEqual_(row.RuleID, payload.ruleId) &&
        valuesEqual_(row.RequiredRole, role) &&
        valuesEqual_(row.RequiredUserID, assignedUser ? assignedUser.UserID : '') &&
        valuesEqual_(row.LineID, payload.lineId) &&
        valuesEqual_(row.StationID, payload.stationId) &&
        valuesEqual_(row.Frequency, frequency) &&
        valuesEqual_(row.DayOfWeek, payload.dayOfWeek) &&
        valuesEqual_(row.DayOfMonth, frequency === 'Monthly' ? (toNumber_(payload.dayOfMonth) || 1) : '');
    });
    if (duplicate) throw new Error('An equivalent audit schedule rule already exists.');
    var now = formatDateTimeBangkok(new Date());
    var existing = cleanString_(payload.ruleId) ? findById_(SHEET_NAMES.AUDIT_PLAN_RULES, 'RuleID', payload.ruleId) : null;
    var ruleId = existing ? existing.RuleID : generateId('RULE', SHEET_NAMES.AUDIT_PLAN_RULES, 'RuleID', '');
    var values = {
      RuleID: ruleId, RequiredRole: role,
      RequiredUserID: assignedUser ? assignedUser.UserID : '',
      RequiredUserName: assignedUser ? assignedUser.FullName : '',
      LineID: payload.lineId, LineName: line.LineName || station.LineName || '',
      StationID: payload.stationId, StationName: station.StationName || '',
      Frequency: frequency, DayOfWeek: cleanString_(payload.dayOfWeek),
      DayOfMonth: frequency === 'Monthly' ? Math.min(Math.max(toNumber_(payload.dayOfMonth) || 1, 1), 31) : '',
      DueTime: cleanString_(payload.dueTime) || '17:00',
      ActiveStatus: isActive_(payload.activeStatus) ? 'Active' : 'Inactive',
      CreatedAt: existing ? existing.CreatedAt : now, CreatedBy: existing ? existing.CreatedBy : currentUser.UserID,
      UpdatedAt: now, UpdatedBy: currentUser.UserID
    };
    if (existing) updateObjectById(SHEET_NAMES.AUDIT_PLAN_RULES, 'RuleID', ruleId, values);
    else appendObject(SHEET_NAMES.AUDIT_PLAN_RULES, values);
    invalidateDashboardCachesForUser_(currentUser);
    return jsonResponse(true, 'Audit schedule rule saved.', { rule: sanitizeForClient_(values) });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function getRuleBasedAuditSummary_(currentUser, now, lineAccess, auditRows) {
  var today = formatDateBangkok_(now);
  var month = today.slice(0, 7);
  var cacheKey = auditRuleSummaryCacheKey_(currentUser, today, lineAccess || []);
  var cached = safeCacheGetJson_(cacheKey);
  if (cached) return cached;
  var rules = getRowsAsObjects(SHEET_NAMES.AUDIT_PLAN_RULES).filter(function (rule) {
    return isActive_(rule.ActiveStatus) && valuesEqual_(rule.RequiredRole, currentUser.Role) &&
      (!cleanString_(rule.RequiredUserID) || valuesEqual_(rule.RequiredUserID, currentUser.UserID)) &&
      canAccessLineFromRows_(currentUser, rule.LineID, 'View', lineAccess || []);
  });
  var audits = (auditRows || getRowsAsObjects(SHEET_NAMES.AUDIT_SESSIONS)).filter(function (audit) {
    return cleanString_(audit.AuditDate).slice(0, 7) === month;
  });
  var summary = { DueToday: 0, Overdue: 0, Missed: 0, ThisWeek: 0, CompletedThisMonth: 0, RuleCount: rules.length };
  rules.forEach(function (rule) {
    ruleExpectedDatesInMonth_(rule, now).forEach(function (dueDate) {
      var completed = audits.some(function (audit) { return auditSatisfiesRulePeriod_(audit, rule, dueDate); });
      if (completed) {
        summary.CompletedThisMonth++;
        return;
      }
      if (dueDate === today) summary.DueToday++;
      if (dueDate < today) { summary.Overdue++; summary.Missed++; }
    });
    if (ruleExpectedDatesInWeek_(rule, now).length) summary.ThisWeek++;
  });
  safeCachePutJson_(cacheKey, summary, 60);
  return summary;
}

function auditRuleSummaryCacheKey_(user, date, lineAccess) {
  return 'LPA_RULE_SUMMARY_' + cleanString_(user.UserID) + '_' + cleanString_(user.Role) +
    '_' + cleanString_(date) + '_' + lineAccessScopeKey_(lineAccess || []);
}

function auditSatisfiesRulePeriod_(audit, rule, expectedDate) {
  if (!valuesEqual_(audit.LineID, rule.LineID) || !valuesEqual_(audit.StationID, rule.StationID)) return false;
  if (!valuesEqual_(audit.AuditLayer, rule.RequiredRole) && !valuesEqual_(audit.AuditorRole, rule.RequiredRole)) return false;
  if (cleanString_(rule.RequiredUserID) && !valuesEqual_(audit.AuditorUserID, rule.RequiredUserID)) return false;
  var frequency = cleanString_(rule.Frequency);
  if (frequency === 'Daily') return valuesEqual_(audit.AuditDate, expectedDate);
  if (frequency === 'Weekly') return isoWeekKey_(parseDate_(audit.AuditDate)) === isoWeekKey_(parseDate_(expectedDate));
  return cleanString_(audit.AuditDate).slice(0, 7) === cleanString_(expectedDate).slice(0, 7);
}

function ruleExpectedDatesInMonth_(rule, now) {
  var year = Number(formatDateBangkok_(now).slice(0, 4));
  var monthIndex = Number(formatDateBangkok_(now).slice(5, 7)) - 1;
  var frequency = cleanString_(rule.Frequency);
  if (frequency === 'Monthly') {
    var lastDay = new Date(year, monthIndex + 1, 0).getDate();
    return [formatDateBangkok_(new Date(year, monthIndex, Math.min(toNumber_(rule.DayOfMonth) || 1, lastDay)))];
  }
  var dates = [];
  for (var cursor = new Date(year, monthIndex, 1); cursor.getMonth() === monthIndex; cursor.setDate(cursor.getDate() + 1)) {
    if (!ruleDayMatches_(rule, cursor)) continue;
    if (frequency === 'Daily') dates.push(formatDateBangkok_(cursor));
    if (frequency === 'Weekly' && !dates.some(function (date) { return isoWeekKey_(parseDate_(date)) === isoWeekKey_(cursor); })) {
      dates.push(formatDateBangkok_(cursor));
    }
  }
  return dates;
}

function ruleExpectedDatesInWeek_(rule, now) {
  var week = isoWeekKey_(now);
  return ruleExpectedDatesInMonth_(rule, now).filter(function (date) { return isoWeekKey_(parseDate_(date)) === week; });
}

function ruleDayMatches_(rule, date) {
  var selected = cleanString_(rule.DayOfWeek);
  if (!selected) return date.getDay() !== 0 && date.getDay() !== 6;
  var names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return selected.split(',').some(function (value) {
    var token = cleanString_(value);
    return token === String(date.getDay()) || valuesEqual_(token.slice(0, 3), names[date.getDay()]);
  });
}
