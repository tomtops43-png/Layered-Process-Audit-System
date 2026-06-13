/** Lines, stations, users, settings, and checklist read APIs. */
function getMasterData(payload, currentUser) {
  try {
    var lines = getRowsAsObjects(SHEET_NAMES.LINES).filter(function (row) { return isActive_(row.ActiveStatus); }).map(sanitizeForClient_);
    var stations = getRowsAsObjects(SHEET_NAMES.STATIONS).filter(function (row) { return isActive_(row.ActiveStatus); }).map(sanitizeForClient_);
    var users = getRowsAsObjects(SHEET_NAMES.USERS).filter(function (row) { return isActive_(row.ActiveStatus); }).map(publicUser_);
    var lists = getRowsAsObjects(SHEET_NAMES.LISTS).filter(function (row) { return !row.ActiveStatus || isActive_(row.ActiveStatus); }).map(sanitizeForClient_);
    var safeSettings = ['APP_NAME', 'TIMEZONE', 'DEFAULT_DUE_DAYS', 'CUSTOMER_NAME', 'COMPANY_NAME'];
    var settings = {};
    safeSettings.forEach(function (key) { settings[key] = getSetting(key); });
    return jsonResponse(true, 'Master data loaded.', { lines: lines, stations: stations, users: users, lists: lists, settings: settings });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function getChecklist(payload, currentUser) {
  try {
    if (!hasPermission_(currentUser, 'checklist.view') && !hasPermission_(currentUser, 'checklist.manage') &&
        !hasApiAccess_(currentUser, 'saveAudit')) throw new Error('Permission denied: checklist.view');
    if (!isAllFilter_(payload.lineId) && !isAdmin_(currentUser) && !hasPermission_(currentUser, 'audit.view.all') &&
        (hasPermission_(currentUser, 'audit.engineer.create') || hasPermission_(currentUser, 'audit.leader.create') ||
         hasPermission_(currentUser, 'audit.view.line'))) {
      requireLineAccess_(currentUser, payload.lineId, 'View');
    }
    requireFields_(payload, ['lineId', 'stationId', 'auditLayer']);
    var lineId = cleanString_(payload.lineId);
    var stationId = cleanString_(payload.stationId);
    var layer = cleanString_(payload.auditLayer);
    var category = cleanString_(payload.category);
    var language = cleanString_(payload.language).toUpperCase() === 'EN' ? 'EN' : 'TH';
    var rows = getRowsAsObjects(SHEET_NAMES.CHECKLIST).filter(function (row) {
      var lineMatches = valuesEqual_(row.LineID, lineId) || valuesEqual_(row.LineID, 'ALL');
      var stationMatches = valuesEqual_(row.StationID, stationId) || valuesEqual_(row.StationID, 'ALL');
      var layerMatches = valuesEqual_(row.AuditLayer, layer) || valuesEqual_(row.AuditLayer, 'ALL');
      var categoryMatches = !category || valuesEqual_(row.Category, category);
      return isActive_(row.ActiveStatus) && lineMatches && stationMatches && layerMatches && categoryMatches;
    }).sort(function (a, b) {
      var sortOrderDifference = toNumber_(a.SortOrder) - toNumber_(b.SortOrder);
      return sortOrderDifference || cleanString_(a.ChecklistID).localeCompare(cleanString_(b.ChecklistID));
    }).map(function (row) {
      var checklist = {};
      SHEET_HEADERS[SHEET_NAMES.CHECKLIST].forEach(function (header) {
        checklist[header] = row[header] === undefined ? '' : row[header];
      });
      if (language === 'EN') {
        checklist.CheckItem = cleanString_(row.CheckItemEN) || checklist.CheckItem;
        checklist.StandardCriteria = cleanString_(row.StandardCriteriaEN) || checklist.StandardCriteria;
        checklist.ExampleOK = cleanString_(row.ExampleOKEN) || checklist.ExampleOK;
        checklist.ExampleNG = cleanString_(row.ExampleNGEN) || checklist.ExampleNG;
      } else {
        checklist.CheckItem = cleanString_(row.CheckItemTH) || checklist.CheckItem;
        checklist.StandardCriteria = cleanString_(row.StandardCriteriaTH) || checklist.StandardCriteria;
        checklist.ExampleOK = cleanString_(row.ExampleOKTH) || checklist.ExampleOK;
        checklist.ExampleNG = cleanString_(row.ExampleNGTH) || checklist.ExampleNG;
      }
      return checklist;
    });
    return jsonResponse(true, 'Checklist loaded.', { checklist: rows, count: rows.length });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}
