/** Lines, stations, users, settings, and checklist read APIs. */
function getMasterData(payload, currentUser) {
  try {
    var lineAccess = getUserLineAccess_(currentUser);
    var cacheKey = 'LPA_MASTER_' + cleanString_(currentUser.UserID) + '_' + cleanString_(currentUser.Role) + '_' +
      lineAccessScopeKey_(lineAccess) + '_' + getMasterDataVersion_();
    var cached = safeCacheGetJson_(cacheKey);
    if (cached) return jsonResponse(true, 'Master data loaded from cache.', cached);
    var lines = getRowsAsObjects(SHEET_NAMES.LINES).filter(function (row) { return isActive_(row.ActiveStatus); }).map(sanitizeForClient_);
    var stations = getRowsAsObjects(SHEET_NAMES.STATIONS).filter(function (row) { return isActive_(row.ActiveStatus); }).map(sanitizeForClient_);
    var users = getRowsAsObjects(SHEET_NAMES.USERS).filter(function (row) { return isActive_(row.ActiveStatus); }).map(publicUser_);
    var listKeys = {};
    var lists = getRowsAsObjects(SHEET_NAMES.LISTS)
      .filter(function (row) { return !row.ActiveStatus || isActive_(row.ActiveStatus); })
      .sort(function (a, b) {
        return cleanString_(a.ListType).localeCompare(cleanString_(b.ListType)) || compareMasterListRows_(a, b);
      }).filter(function (row) {
        var key = (cleanString_(row.ListType) + '|' + cleanString_(row.ListValue)).toLowerCase();
        if (!key || listKeys[key]) return false;
        listKeys[key] = true;
        return true;
      }).map(sanitizeForClient_);
    var safeSettings = ['APP_NAME', 'TIMEZONE', 'DEFAULT_DUE_DAYS', 'CUSTOMER_NAME', 'COMPANY_NAME'];
    var settingRows = getRowsAsObjects(SHEET_NAMES.SETTINGS);
    var settingMap = {};
    settingRows.forEach(function (row) { settingMap[cleanString_(row.SettingKey)] = row.SettingValue; });
    var settings = {};
    safeSettings.forEach(function (key) { settings[key] = settingMap[key] || ''; });
    var result = { lines: lines, stations: stations, users: users, lists: lists, settings: settings };
    safeCachePutJson_(cacheKey, result, 300);
    return jsonResponse(true, 'Master data loaded.', result);
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function getMasterDataVersion_() {
  return PropertiesService.getScriptProperties().getProperty('LPA_MASTER_DATA_VERSION') || '1';
}

function incrementMasterDataVersion_() {
  var properties = PropertiesService.getScriptProperties();
  var next = toNumber_(properties.getProperty('LPA_MASTER_DATA_VERSION')) + 1;
  properties.setProperty('LPA_MASTER_DATA_VERSION', String(next));
  return next;
}

function getActiveListRows_(listType) {
  var seen = {};
  return getRowsAsObjects(SHEET_NAMES.LISTS).filter(function (row) {
    return valuesEqual_(row.ListType, listType) && isActive_(row.ActiveStatus);
  }).sort(compareMasterListRows_).filter(function (row) {
    var key = cleanString_(row.ListValue).toLowerCase();
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function compareMasterListRows_(a, b) {
  var left = Number(a.SortOrder);
  var right = Number(b.SortOrder);
  var leftValid = isFinite(left) && left > 0 && Math.floor(left) === left;
  var rightValid = isFinite(right) && right > 0 && Math.floor(right) === right;
  if (leftValid && rightValid && left !== right) return left - right;
  if (leftValid !== rightValid) return leftValid ? -1 : 1;
  return toNumber_(a._rowNumber) - toNumber_(b._rowNumber) ||
    cleanString_(a.ListValue).localeCompare(cleanString_(b.ListValue));
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
    var cacheKey = 'LPA_CL_' + lineId + '_' + stationId + '_' + layer + '_' + language + (category ? '_' + category : '');
    var cached = safeCacheGetJson_(cacheKey);
    if (cached) return jsonResponse(true, 'Checklist loaded from cache.', cached);
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
    var result = { checklist: rows, count: rows.length };
    safeCachePutJson_(cacheKey, result, 600);
    return jsonResponse(true, 'Checklist loaded.', result);
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}
