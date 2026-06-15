/** Lightweight rule-based LPA schedule APIs and in-memory due calculation. */
function getAuditPlanRules(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'audit.plan.view');
    var lineAccess = getUserLineAccess_(currentUser);
    var canViewAll = isAdmin_(currentUser) || hasPermission_(currentUser, 'audit.view.all');
    var limit = Math.min(Math.max(toNumber_(payload.limit || payload.pageSize) || 100, 1), 300);
    var rows = getAuditPlanRuleRows_().filter(function (row) {
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
  var ruleLock = null;
  var ruleLockAcquired = false;
  try {
    requirePermission_(currentUser, 'audit.plan.manage');
    requireFields_(payload, ['requiredRole', 'lineId', 'stationId', 'frequency', 'activeStatus']);
    var role = cleanString_(payload.requiredRole);
    var frequency = cleanString_(payload.frequency);
    var stationSelection = cleanString_(payload.stationId);
    var bulkCreate = valuesEqual_(stationSelection, 'ALL');
    if (['Leader', 'Supervisor', 'Manager'].indexOf(role) === -1) throw new Error('RequiredRole must be Leader, Supervisor, or Manager.');
    if (['Daily', 'Weekly', 'Monthly'].indexOf(frequency) === -1) throw new Error('Frequency must be Daily, Weekly, or Monthly.');
    if (bulkCreate && cleanString_(payload.ruleId)) throw new Error('All Stations can only be used when creating new rules.');
    if (!isAdmin_(currentUser)) requireLineAccess_(currentUser, payload.lineId, 'Manage');
    var line = findById_(SHEET_NAMES.LINES, 'LineID', payload.lineId) || {};
    var assignedUser = cleanString_(payload.requiredUserId) ?
      findById_(SHEET_NAMES.USERS, 'UserID', payload.requiredUserId) : null;
    if (payload.requiredUserId && (!assignedUser || !isActive_(assignedUser.ActiveStatus))) throw new Error('Assigned user was not found or is inactive.');
    if (assignedUser && !valuesEqual_(assignedUser.Role, role)) throw new Error('Assigned user role must match RequiredRole.');

    var activeStations = getRowsAsObjects(SHEET_NAMES.STATIONS).filter(function (station) {
      return isActive_(station.ActiveStatus) && valuesEqual_(station.LineID, payload.lineId) &&
        (bulkCreate || valuesEqual_(station.StationID, stationSelection));
    });
    if (!activeStations.length) {
      throw new Error(bulkCreate ? 'No active stations were found for the selected Line.' : 'Selected station is not active or does not belong to the selected Line.');
    }

    var normalizedDayOfWeek = cleanString_(payload.dayOfWeek);
    var normalizedDayOfMonth = frequency === 'Monthly' ? Math.min(Math.max(toNumber_(payload.dayOfMonth) || 1, 1), 31) : '';
    var normalizedDueTime = cleanString_(payload.dueTime) || '17:00';
    var normalizedActiveStatus = isActive_(payload.activeStatus) ? 'Active' : 'Inactive';
    var timestamp = formatDateTimeBangkok(new Date());
    var createdCount = 0;
    var updatedCount = 0;
    var skippedDuplicateCount = 0;
    var savedRules = [];

    ruleLock = LockService.getScriptLock();
    ruleLock.waitLock(30000);
    ruleLockAcquired = true;
    var existingRules = getAuditPlanRuleRows_();
    var editedRule = cleanString_(payload.ruleId) ? existingRules.filter(function (row) {
      return valuesEqual_(row.RuleID, payload.ruleId);
    })[0] : null;
    if (cleanString_(payload.ruleId) && !editedRule) throw new Error('Audit schedule rule not found: ' + payload.ruleId);

    activeStations.forEach(function (station) {
      var duplicate = existingRules.some(function (row) {
        return !valuesEqual_(row.RuleID, payload.ruleId) &&
          valuesEqual_(row.RequiredRole, role) &&
          valuesEqual_(row.RequiredUserID, assignedUser ? assignedUser.UserID : '') &&
          valuesEqual_(row.LineID, payload.lineId) &&
          valuesEqual_(row.StationID, station.StationID) &&
          valuesEqual_(row.Frequency, frequency) &&
          valuesEqual_(row.DayOfWeek, normalizedDayOfWeek) &&
          valuesEqual_(row.DayOfMonth, normalizedDayOfMonth) &&
          valuesEqual_(row.DueTime, normalizedDueTime) &&
          valuesEqual_(row.ActiveStatus, normalizedActiveStatus);
      });
      if (duplicate) {
        skippedDuplicateCount++;
        return;
      }
      var ruleId = editedRule ? editedRule.RuleID : generateIdWithoutLock_('RULE', SHEET_NAMES.AUDIT_PLAN_RULES, 'RuleID', '');
      var values = {
        RuleID: ruleId, RequiredRole: role,
        RequiredUserID: assignedUser ? assignedUser.UserID : '',
        RequiredUserName: assignedUser ? assignedUser.FullName : '',
        LineID: payload.lineId, LineName: line.LineName || station.LineName || '',
        StationID: station.StationID, StationName: station.StationName || '',
        Frequency: frequency, DayOfWeek: normalizedDayOfWeek, DayOfMonth: normalizedDayOfMonth,
        DueTime: normalizedDueTime, ActiveStatus: normalizedActiveStatus,
        CreatedAt: editedRule ? editedRule.CreatedAt : timestamp,
        CreatedBy: editedRule ? editedRule.CreatedBy : currentUser.UserID,
        UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
      };
      if (editedRule) {
        updateObjectById(SHEET_NAMES.AUDIT_PLAN_RULES, 'RuleID', ruleId, values);
        updatedCount++;
      } else {
        appendObject(SHEET_NAMES.AUDIT_PLAN_RULES, values);
        existingRules.push(values);
        createdCount++;
      }
      savedRules.push(sanitizeForClient_(values));
    });
    invalidateDashboardCachesForUser_(currentUser);
    return jsonResponse(true, 'Audit schedule rules saved.', {
      rules: savedRules, rule: savedRules[0] || {}, createdCount: createdCount,
      updatedCount: updatedCount, skippedDuplicateCount: skippedDuplicateCount,
      totalStations: activeStations.length
    });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  } finally {
    if (ruleLockAcquired) ruleLock.releaseLock();
  }
}

function getRuleBasedAuditSummary_(currentUser, now, lineAccess, auditRows) {
  var today = formatDateBangkok_(now);
  var month = today.slice(0, 7);
  var cacheKey = auditRuleSummaryCacheKey_(currentUser, today, lineAccess || []);
  var cached = safeCacheGetJson_(cacheKey);
  if (cached) return cached;
  var rules = getAuditPlanRuleRows_().filter(function (rule) {
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

function getAuditPlanRuleRows_() {
  try {
    return getRowsAsObjects(SHEET_NAMES.AUDIT_PLAN_RULES);
  } catch (error) {
    if (/Required sheet not found/.test(safeErrorMessage_(error))) {
      throw new Error('AuditPlanRules sheet is not set up. Run setupHeaders() in Apps Script, then try again.');
    }
    throw error;
  }
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
