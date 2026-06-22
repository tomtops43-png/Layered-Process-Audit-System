/** Lightweight rule-based LPA schedule APIs and in-memory due calculation. */
function getDirectorDashboardData(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'dashboard.view.all');
    var months = Math.min(Math.max(toNumber_(payload.months) || 3, 1), 12);
    var dirCacheKey = 'DIR_DASH_' + months;
    var dirCached = safeCacheGetJson_(dirCacheKey);
    if (dirCached) return jsonResponse(true, 'Director dashboard loaded from cache.', dirCached);
    var now = new Date();
    var today = formatDateBangkok_(now);

    function monthKey(date) { return getPeriodMonth(date); }
    function buildMonthList(offset, count) {
      var list = [];
      for (var i = offset + count - 1; i >= offset; i--) {
        var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        list.push({ month: monthKey(d), date: d });
      }
      return list;
    }
    var currMonths = buildMonthList(0, months);
    var prevMonths = buildMonthList(months, months);
    var sparkMonths = buildMonthList(0, Math.max(months, 6));

    var allMonthKeys = {};
    function registerMonths(arr) { arr.forEach(function(m){ allMonthKeys[m.month] = m.date; }); }
    registerMonths(currMonths); registerMonths(prevMonths); registerMonths(sparkMonths);

    var earliestMonth = Object.keys(allMonthKeys).sort()[0];
    var auditRows = getRowsAsObjects(SHEET_NAMES.AUDIT_SESSIONS).filter(function(a) {
      return cleanString_(a.PeriodMonth) >= earliestMonth;
    });

    var auditByMonth = {};
    var auditsByRole = {};
    auditRows.forEach(function(a) {
      var m = cleanString_(a.PeriodMonth), role = cleanString_(a.AuditLayer);
      if (!auditByMonth[m]) auditByMonth[m] = { keys: {} };
      var key = [cleanString_(a.AuditDate), cleanString_(a.LineID), cleanString_(a.StationID), role.toLowerCase()].join('|');
      auditByMonth[m].keys[key] = true;
      if (!auditsByRole[role]) auditsByRole[role] = { done: 0, onTime: 0 };
      auditsByRole[role].done++;
      if (cleanString_(a.IsLate).toLowerCase() !== 'yes') auditsByRole[role].onTime++;
    });

    var rules = getAuditPlanRuleRows_().filter(function(r) { return isActive_(r.ActiveStatus); });

    function computeMonth(monthDate) {
      var m = monthKey(monthDate);
      var monthAudits = (auditByMonth[m] || {}).keys || {};
      var byLine = {}, byRole = {}, exp = 0, done = 0;
      rules.forEach(function(rule) {
        var dates = ruleExpectedDatesInMonth_(rule, monthDate);
        var lid = cleanString_(rule.LineID), role = cleanString_(rule.RequiredRole);
        if (!byLine[lid]) byLine[lid] = { lineName: cleanString_(rule.LineName)||lid, expected:0, done:0 };
        if (!byRole[role]) byRole[role] = { expected:0, done:0 };
        dates.forEach(function(date) {
          if (date > today) return;
          byLine[lid].expected++; byRole[role].expected++; exp++;
          var key = [date, lid, cleanString_(rule.StationID), role.toLowerCase()].join('|');
          if (monthAudits[key]) { byLine[lid].done++; byRole[role].done++; done++; }
        });
      });
      return { month: m, expected: exp, done: done, compliance: exp ? Math.round(done*1000/exp)/10 : 100, byLine: byLine, byRole: byRole };
    }

    var computed = {};
    Object.keys(allMonthKeys).forEach(function(m) { computed[m] = computeMonth(allMonthKeys[m]); });

    function pct(d, e) { return e ? Math.round(d*1000/e)/10 : 100; }
    function periodAgg(list) {
      var e=0, d=0; list.forEach(function(m){ var c=computed[m.month]; if(c){e+=c.expected;d+=c.done;} }); return {expected:e,done:d,compliance:pct(d,e)};
    }
    var curr = periodAgg(currMonths), prev = periodAgg(prevMonths);

    var rangeStart = currMonths[0].month;
    var prevStart = prevMonths.length ? prevMonths[0].month : '';
    var allFindingRows = getCachedFindingRows_();
    var currFindings = allFindingRows.filter(function(f) { var fm=normalizeFindingPeriod_(f.PeriodMonth||f.FoundDate); return fm>=rangeStart; });
    var prevFindingRows = prevStart ? allFindingRows.filter(function(f) { var fm=normalizeFindingPeriod_(f.PeriodMonth||f.FoundDate); return fm>=prevStart&&fm<rangeStart; }) : [];

    function resolutionRate(findings) {
      var closed = findings.filter(function(f){ return isClosedStatus_(f.Status) && cleanString_(f.DueDate); });
      if (!closed.length) return null;
      var onTime = closed.filter(function(f){ var cd=cleanString_(f.ClosedDate||f.ClosedAt); return cd&&cd<=cleanString_(f.DueDate); }).length;
      return pct(onTime, closed.length);
    }

    var catMap = {};
    currFindings.forEach(function(f) {
      var cat = cleanString_(f.Category)||'Uncategorized', lid = cleanString_(f.LineID);
      if (!catMap[cat]) catMap[cat]={category:cat,count:0,lines:{},closeTimes:[],openCount:0,lastStatus:''};
      catMap[cat].count++; catMap[cat].lines[lid]=(catMap[cat].lines[lid]||0)+1;
      if (!isClosedStatus_(f.Status)) catMap[cat].openCount++;
      catMap[cat].lastStatus = f.Status||'';
      var found=parseDate_(f.FoundDate), closed=parseDate_(f.ClosedDate||f.ClosedAt);
      if (found&&closed) catMap[cat].closeTimes.push(Math.max(0,Math.round((closed-found)/86400000)));
    });
    var chronicFindings = Object.keys(catMap).sort(function(a,b){return catMap[b].count-catMap[a].count;}).slice(0,5).map(function(cat){
      var c=catMap[cat];
      var topLine=Object.keys(c.lines).sort(function(a,b){return c.lines[b]-c.lines[a];})[0]||'';
      var lineRow=topLine?allFindingRows.filter(function(f){return cleanString_(f.LineID)===topLine;})[0]:null;
      var avgClose=c.closeTimes.length?Math.round(c.closeTimes.reduce(function(s,v){return s+v;},0)/c.closeTimes.length*10)/10:null;
      return {category:cat,count:c.count,topLineId:topLine,topLineName:lineRow?cleanString_(lineRow.LineName)||topLine:topLine,openCount:c.openCount,avgCloseDays:avgClose,lastStatus:c.lastStatus};
    });

    var findingByRole={};
    currFindings.forEach(function(f){ var r=cleanString_(f.AuditorRole||''); if(r)findingByRole[r]=(findingByRole[r]||0)+1; });
    var roleSet={};
    rules.forEach(function(r){ roleSet[cleanString_(r.RequiredRole)]=true; });
    var layerSummary=Object.keys(roleSet).sort().map(function(role){
      var e=0,d=0;
      currMonths.forEach(function(mo){ var c=computed[mo.month]; if(c&&c.byRole[role]){e+=c.byRole[role].expected;d+=c.byRole[role].done;} });
      var ra=auditsByRole[role]||{done:0,onTime:0};
      return {role:role,expected:e,done:d,compliance:pct(d,e),onTimeRate:ra.done?pct(ra.onTime,ra.done):100,findingCount:findingByRole[role]||0};
    });

    var lineSet={};
    currMonths.forEach(function(mo){ var c=computed[mo.month]; if(c)Object.keys(c.byLine).forEach(function(lid){if(!lineSet[lid])lineSet[lid]=c.byLine[lid].lineName;}); });
    var lines=Object.keys(lineSet).sort().map(function(lid){return{lineId:lid,lineName:lineSet[lid]};});

    var monthlyCompliance=currMonths.map(function(mo){return computed[mo.month];}).filter(Boolean);
    var sparklineData=sparkMonths.map(function(mo){var c=computed[mo.month];return c?{month:mo.month,compliance:c.compliance}:null;}).filter(Boolean);

    var dirResult = {
      monthlyCompliance:monthlyCompliance, sparklineData:sparklineData,
      chronicFindings:chronicFindings, layerSummary:layerSummary, lines:lines,
      overallKPIs:{
        compliance:curr.compliance, prevCompliance:prev.compliance,
        resolutionRate:resolutionRate(currFindings), prevResolutionRate:resolutionRate(prevFindingRows),
        auditCompletionRate:curr.compliance,
        currDone:curr.done, currExpected:curr.expected
      },
      months:months, startDate:currMonths[0].month.slice(0,4)+'-'+currMonths[0].month.slice(4,6)+'-01', endDate:today
    };
    safeCachePutJson_(dirCacheKey, dirResult, 300);
    return jsonResponse(true, 'Director dashboard loaded.', dirResult);
  } catch(error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function getManagerComplianceData(payload, currentUser) {
  try {
    if (!hasPermission_(currentUser, 'dashboard.view') && !hasPermission_(currentUser, 'dashboard.view.all')) {
      throw new Error('Permission denied: dashboard.view');
    }
    var mgrCacheKey = 'MGR_COMP_' + cleanString_(payload.period || 'month') + '_' + cleanString_(payload.lineId || 'ALL');
    var mgrCached = safeCacheGetJson_(mgrCacheKey);
    if (mgrCached) return jsonResponse(true, 'Manager compliance loaded from cache.', mgrCached);
    var now = new Date();
    var period = cleanString_(payload.period) || 'month';
    var lineId = cleanString_(payload.lineId) || '';
    var startDate, endDate;
    if (period === 'week') {
      var dow = now.getDay() === 0 ? 7 : now.getDay();
      var monday = new Date(now); monday.setDate(now.getDate() - (dow - 1)); monday.setHours(0, 0, 0, 0);
      startDate = formatDateBangkok_(monday);
    } else {
      var y = Number(formatDateBangkok_(now).slice(0, 4));
      var m = Number(formatDateBangkok_(now).slice(5, 7));
      startDate = y + '-' + ('0' + m).slice(-2) + '-01';
    }
    endDate = formatDateBangkok_(now);

    var rules = getAuditPlanRuleRows_().filter(function (r) {
      return isActive_(r.ActiveStatus) && (!lineId || valuesEqual_(r.LineID, lineId));
    });
    var auditRows = getRowsAsObjects(SHEET_NAMES.AUDIT_SESSIONS).filter(function (a) {
      return cleanString_(a.AuditDate) >= startDate && cleanString_(a.AuditDate) <= endDate;
    });
    var auditMap = {};
    auditRows.forEach(function (a) {
      auditMap[[cleanString_(a.AuditDate), cleanString_(a.LineID), cleanString_(a.StationID), cleanString_(a.AuditLayer).toLowerCase()].join('|')] = true;
    });

    var byLine = {}, byStationRole = {}, totalExpected = 0, totalDone = 0;
    rules.forEach(function (rule) {
      var dates = getRuleDatesInRange_(rule, startDate, endDate);
      var lid = cleanString_(rule.LineID), sid = cleanString_(rule.StationID), role = cleanString_(rule.RequiredRole);
      if (!byLine[lid]) byLine[lid] = { lineId: lid, lineName: cleanString_(rule.LineName) || lid, expected: 0, done: 0 };
      var ck = lid + '|' + sid + '|' + role;
      if (!byStationRole[ck]) byStationRole[ck] = { lineId: lid, lineName: cleanString_(rule.LineName) || lid, stationId: sid, stationName: cleanString_(rule.StationName) || sid, role: role, expected: 0, done: 0 };
      dates.forEach(function (date) {
        byLine[lid].expected++; byStationRole[ck].expected++; totalExpected++;
        if (auditMap[[date, lid, sid, role.toLowerCase()].join('|')]) { byLine[lid].done++; byStationRole[ck].done++; totalDone++; }
      });
    });

    var finRows = getCachedFindingRows_();
    var closedWithDates = finRows.filter(function (f) { return isClosedStatus_(f.Status) && cleanString_(f.FoundDate) && cleanString_(f.ClosedDate || f.ClosedAt); });
    var avgClose = 0;
    if (closedWithDates.length) {
      var sumDays = closedWithDates.reduce(function (s, f) {
        var found = parseDate_(f.FoundDate), closed = parseDate_(f.ClosedDate || f.ClosedAt);
        return s + (found && closed ? Math.max(0, Math.round((closed - found) / 86400000)) : 0);
      }, 0);
      avgClose = Math.round(sumDays / closedWithDates.length);
    }

    function pct(d, e) { return e ? Math.round(d * 1000 / e) / 10 : 100; }
    var byLineArr = Object.keys(byLine).sort().map(function (k) { var b = byLine[k]; b.compliance = pct(b.done, b.expected); return b; });
    var bySRArr = Object.keys(byStationRole).sort().map(function (k) { var b = byStationRole[k]; b.compliance = pct(b.done, b.expected); return b; });
    var mgrResult = {
      byLine: byLineArr, byStationRole: bySRArr,
      overall: { expected: totalExpected, done: totalDone, compliance: pct(totalDone, totalExpected) },
      period: period, startDate: startDate, endDate: endDate, avgCloseDays: avgClose
    };
    safeCachePutJson_(mgrCacheKey, mgrResult, 120);
    return jsonResponse(true, 'Manager compliance loaded.', mgrResult);
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function getRuleDatesInRange_(rule, startDate, endDate) {
  var freq = cleanString_(rule.Frequency) || 'Daily';
  var dates = [];
  var start = parseDate_(startDate), end = parseDate_(endDate);
  if (!start || !end) return dates;
  if (freq === 'Monthly') {
    var dayNum = toNumber_(rule.DayOfMonth) || 1;
    var lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    var d = new Date(start.getFullYear(), start.getMonth(), Math.min(dayNum, lastDay));
    var ds = formatDateBangkok_(d);
    if (ds >= startDate && ds <= endDate) dates.push(ds);
    return dates;
  }
  var seenWeeks = {};
  for (var cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    if (!ruleDayMatches_(rule, cursor)) continue;
    if (freq === 'Weekly') {
      var wk = isoWeekKey_(cursor); if (seenWeeks[wk]) continue; seenWeeks[wk] = true;
    }
    dates.push(formatDateBangkok_(new Date(cursor)));
  }
  return dates;
}

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
      rules: rows.slice(0, limit).map(sanitizeAuditRuleForClient_), total: rows.length, limit: limit
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
    var bulkAllLines = isAllFilter_(payload.lineId);
    var bulkCreate = valuesEqual_(stationSelection, 'ALL') || bulkAllLines;
    var assignmentMode = cleanString_(payload.assignmentMode).toUpperCase() || (cleanString_(payload.requiredUserId) ? 'USER' : 'ROLE');
    if (['ROLE', 'USER'].indexOf(assignmentMode) === -1) throw new Error('AssignmentMode must be ROLE or USER.');
    if (['Leader', 'Supervisor', 'Manager'].indexOf(role) === -1) throw new Error('RequiredRole must be Leader, Supervisor, or Manager.');
    if (['Daily', 'Weekly', 'Monthly'].indexOf(frequency) === -1) throw new Error('Frequency must be Daily, Weekly, or Monthly.');
    if (bulkCreate && cleanString_(payload.ruleId)) throw new Error('All Lines/Stations can only be used when creating new rules.');
    if (!isAdmin_(currentUser) && !bulkAllLines) requireLineAccess_(currentUser, payload.lineId, 'Manage');
    if (!isAdmin_(currentUser) && bulkAllLines) requirePermission_(currentUser, 'audit.plan.manage');
    var assignedUser = null;
    if (assignmentMode === 'USER') {
      if (!cleanString_(payload.requiredUserId)) throw new Error('Assigned user is required for Specific user mode.');
      assignedUser = findById_(SHEET_NAMES.USERS, 'UserID', payload.requiredUserId);
      if (!assignedUser || !isActive_(assignedUser.ActiveStatus)) throw new Error('Assigned user was not found or is inactive.');
      if (!valuesEqual_(assignedUser.Role, role)) throw new Error('Assigned user role must match RequiredRole.');
    }

    var allStationRows = getRowsAsObjects(SHEET_NAMES.STATIONS).filter(function (s) { return isActive_(s.ActiveStatus); });
    var activeStations = allStationRows.filter(function (station) {
      var lineMatch = bulkAllLines || valuesEqual_(station.LineID, payload.lineId);
      var stationMatch = bulkCreate || valuesEqual_(station.StationID, stationSelection);
      return lineMatch && stationMatch;
    });
    if (!activeStations.length) {
      throw new Error('No active stations were found for the selected Line/Station combination.');
    }

    var normalizedDayOfWeek = frequency === 'Weekly' ? cleanString_(payload.dayOfWeek) : '';
    var normalizedDayOfMonth = frequency === 'Monthly' ? Math.min(Math.max(toNumber_(payload.dayOfMonth) || 1, 1), 31) : '';
    if (frequency === 'Weekly' && !normalizedDayOfWeek) throw new Error('DayOfWeek is required for Weekly rules.');
    var normalizedDueTime = normalizeDueTime_(payload.dueTime) || '17:00';
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

    var lineCache = {};
    activeStations.forEach(function (station) {
      var stationLineId = station.LineID;
      if (!lineCache[stationLineId]) {
        lineCache[stationLineId] = findById_(SHEET_NAMES.LINES, 'LineID', stationLineId) || {};
      }
      var stationLine = lineCache[stationLineId];
      var candidate = {
        AssignmentMode: assignmentMode, RequiredRole: role,
        RequiredUserID: assignmentMode === 'USER' ? assignedUser.UserID : '',
        LineID: stationLineId, StationID: station.StationID, Frequency: frequency,
        DayOfWeek: normalizedDayOfWeek, DayOfMonth: normalizedDayOfMonth,
        DueTime: normalizedDueTime, ActiveStatus: normalizedActiveStatus
      };
      var duplicate = existingRules.some(function (row) {
        return !valuesEqual_(row.RuleID, payload.ruleId) && auditRuleDuplicateMatches_(row, candidate);
      });
      if (duplicate) {
        skippedDuplicateCount++;
        return;
      }
      var ruleId = editedRule ? editedRule.RuleID : generateIdWithoutLock_('RULE', SHEET_NAMES.AUDIT_PLAN_RULES, 'RuleID', '');
      var values = {
        RuleID: ruleId, AssignmentMode: assignmentMode, RequiredRole: role,
        RequiredUserID: assignmentMode === 'USER' ? assignedUser.UserID : '',
        RequiredUserName: assignmentMode === 'USER' ? assignedUser.FullName : '',
        LineID: stationLineId, LineName: stationLine.LineName || station.LineName || '',
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
      savedRules.push(sanitizeAuditRuleForClient_(values));
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

function deleteAuditRule(payload, currentUser) {
  var lock = null;
  var lockAcquired = false;
  try {
    requirePermission_(currentUser, 'audit.plan.manage');
    var ruleId = cleanString_(payload.ruleId);
    if (!ruleId) throw new Error('ruleId is required.');
    var rule = findById_(SHEET_NAMES.AUDIT_PLAN_RULES, 'RuleID', ruleId);
    if (!rule) throw new Error('Audit schedule rule not found: ' + ruleId);
    if (!isAdmin_(currentUser)) requireLineAccess_(currentUser, rule.LineID, 'Manage');
    lock = LockService.getScriptLock();
    lock.waitLock(15000);
    lockAcquired = true;
    var sheet = getSheet(SHEET_NAMES.AUDIT_PLAN_RULES);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    var idCol = headers.indexOf('RuleID');
    if (idCol < 0) throw new Error('RuleID column not found.');
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) throw new Error('Audit schedule rule not found: ' + ruleId);
    var ids = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getDisplayValues();
    var rowNumber = -1;
    for (var i = 0; i < ids.length; i++) {
      if (cleanString_(ids[i][0]) === ruleId) { rowNumber = i + 2; break; }
    }
    if (rowNumber < 0) throw new Error('Audit schedule rule not found: ' + ruleId);
    sheet.deleteRow(rowNumber);
    invalidateDashboardCachesForUser_(currentUser);
    return jsonResponse(true, 'Audit schedule rule deleted.', { ruleId: ruleId });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

function auditRuleDuplicateMatches_(row, candidate) {
  var mode = cleanString_(row.AssignmentMode).toUpperCase() || (cleanString_(row.RequiredUserID) ? 'USER' : 'ROLE');
  if (!valuesEqual_(mode, candidate.AssignmentMode)) return false;
  if (!valuesEqual_(row.RequiredRole, candidate.RequiredRole)) return false;
  if (mode === 'USER' && !valuesEqual_(row.RequiredUserID, candidate.RequiredUserID)) return false;
  return valuesEqual_(row.LineID, candidate.LineID) && valuesEqual_(row.StationID, candidate.StationID) &&
    valuesEqual_(row.Frequency, candidate.Frequency) &&
    valuesEqual_(cleanString_(row.DayOfWeek), cleanString_(candidate.DayOfWeek)) &&
    valuesEqual_(cleanString_(row.DayOfMonth), cleanString_(candidate.DayOfMonth)) &&
    valuesEqual_(normalizeDueTime_(row.DueTime), candidate.DueTime) &&
    valuesEqual_(row.ActiveStatus, candidate.ActiveStatus);
}

function normalizeDueTime_(value) {
  if (!value) return '';
  if (value instanceof Date) return Utilities.formatDate(value, APP_TIMEZONE, 'HH:mm');
  var text = cleanString_(value);
  var match = text.match(/(\d{1,2}):(\d{2})/);
  if (!match) return text;
  return ('0' + Number(match[1])).slice(-2) + ':' + match[2];
}

function sanitizeAuditRuleForClient_(row) {
  var copy = sanitizeForClient_(row);
  copy.AssignmentMode = cleanString_(copy.AssignmentMode).toUpperCase() || (cleanString_(copy.RequiredUserID) ? 'USER' : 'ROLE');
  copy.DueTime = normalizeDueTime_(copy.DueTime) || '17:00';
  if (copy.AssignmentMode === 'ROLE') {
    copy.RequiredUserID = '';
    copy.RequiredUserName = '';
  }
  return copy;
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

var AUDIT_RULES_CACHE_KEY = 'LPA_AUDIT_RULES_RAW';
var AUDIT_RULES_CACHE_TTL = 300;

function getAuditPlanRuleRows_() {
  var cached = safeCacheGetJson_(AUDIT_RULES_CACHE_KEY);
  if (cached) return cached;
  try {
    var rows = getRowsAsObjects(SHEET_NAMES.AUDIT_PLAN_RULES);
    safeCachePutJson_(AUDIT_RULES_CACHE_KEY, rows, AUDIT_RULES_CACHE_TTL);
    return rows;
  } catch (error) {
    if (/Required sheet not found/.test(safeErrorMessage_(error))) {
      throw new Error('AuditPlanRules sheet is not set up. Run setupHeaders() in Apps Script, then try again.');
    }
    throw error;
  }
}

function invalidateAuditRulesCache_() {
  safeCacheRemove_(AUDIT_RULES_CACHE_KEY);
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
