/** One-time, non-destructive setup and manual test helpers. */
function setupHeaders() {
  var spreadsheet = getSpreadsheet_();
  var results = [];
  Object.keys(SHEET_HEADERS).forEach(function (sheetName) {
    var requiredHeaders = SHEET_HEADERS[sheetName];
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
      sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
      sheet.setFrozenRows(1);
      results.push(sheetName + ': created');
      return;
    }
    var headers = getHeaders_(sheet);
    if (!headers.length || headers.every(function (header) { return !header; })) {
      sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
      sheet.setFrozenRows(1);
      results.push(sheetName + ': headers created');
      return;
    }
    var missing = requiredHeaders.filter(function (header) { return headers.indexOf(header) === -1; });
    if (missing.length) {
      sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
      results.push(sheetName + ': appended headers ' + missing.join(', '));
    } else {
      results.push(sheetName + ': unchanged');
    }
  });
  return results;
}

/**
 * Destructively replaces ChecklistMaster from the 2D values read from the
 * ChecklistMaster_Bilingual worksheet. The input must include its header row
 * followed by exactly 39 checklist rows.
 */
function resetChecklistMasterBilingual(sourceValues) {
  if (!Array.isArray(sourceValues) || sourceValues.length !== 40) {
    throw new Error('ChecklistMaster_Bilingual must contain one header row and exactly 39 data rows.');
  }
  var requiredHeaders = SHEET_HEADERS[SHEET_NAMES.CHECKLIST];
  var sourceHeaders = sourceValues[0].map(cleanString_);
  if (sourceHeaders.length !== requiredHeaders.length ||
      sourceHeaders.some(function (header, index) { return header !== requiredHeaders[index]; })) {
    throw new Error('ChecklistMaster_Bilingual headers do not match the configured ChecklistMaster schema.');
  }
  sourceValues.slice(1).forEach(function (row, index) {
    if (!Array.isArray(row) || row.length !== requiredHeaders.length) {
      throw new Error('Row ' + (index + 2) + ' does not contain all required ChecklistMaster columns.');
    }
    if (cleanString_(row[sourceHeaders.indexOf('LineID')]).toUpperCase() !== 'ALL' ||
        cleanString_(row[sourceHeaders.indexOf('StationID')]).toUpperCase() !== 'ALL') {
      throw new Error('Row ' + (index + 2) + ' must use LineID = ALL and StationID = ALL.');
    }
  });

  var sheet = getSheet(SHEET_NAMES.CHECKLIST);
  sheet.clearContents();
  sheet.getRange(1, 1, sourceValues.length, requiredHeaders.length).setValues(sourceValues);
  sheet.setFrozenRows(1);
  return { sheetName: SHEET_NAMES.CHECKLIST, insertedRows: 39 };
}

function resetChecklistMasterBilingualFromSpreadsheet(sourceSpreadsheetId) {
  if (!cleanString_(sourceSpreadsheetId)) throw new Error('Source spreadsheet ID is required.');
  var sourceSheet = SpreadsheetApp.openById(sourceSpreadsheetId).getSheetByName('ChecklistMaster_Bilingual');
  if (!sourceSheet) throw new Error('Source sheet not found: ChecklistMaster_Bilingual');
  return resetChecklistMasterBilingual(sourceSheet.getDataRange().getValues());
}

function createDefaultAdmin(username, password) {
  username = cleanString_(username) || 'admin';
  password = cleanString_(password) || PropertiesService.getScriptProperties().getProperty('DEFAULT_ADMIN_PASSWORD');
  if (!password) throw new Error('Pass a password to createDefaultAdmin(username, password), or set DEFAULT_ADMIN_PASSWORD in Script Properties.');
  var existing = getRowsAsObjects(SHEET_NAMES.USERS).filter(function (row) { return cleanString_(row.Username).toLowerCase() === username.toLowerCase(); })[0];
  if (existing) return { created: false, message: 'Admin username already exists.', UserID: existing.UserID };
  var timestamp = formatDateTimeBangkok(new Date());
  var userId = generateId('U', SHEET_NAMES.USERS, 'UserID', '');
  appendObject(SHEET_NAMES.USERS, {
    UserID: userId, EmployeeID: '', Username: username, PasswordHash: hashPassword(password),
    FullName: 'System Administrator', Nickname: 'Admin', Role: 'Admin', Department: 'Quality',
    LineDefault: '', Email: '', Phone: '', ActiveStatus: 'Active', LastLogin: '',
    CreatedAt: timestamp, CreatedBy: 'SYSTEM', UpdatedAt: timestamp, UpdatedBy: 'SYSTEM'
  });
  return { created: true, message: 'Default admin created.', UserID: userId, Username: username };
}

function hashExistingPasswords() {
  var users = getRowsAsObjects(SHEET_NAMES.USERS);
  var updated = [];
  users.forEach(function (user) {
    var value = cleanString_(user.PasswordHash);
    if (value && !/^[a-f0-9]{64}$/i.test(value)) {
      updateObjectById(SHEET_NAMES.USERS, 'UserID', user.UserID, {
        PasswordHash: hashPassword(value), UpdatedAt: formatDateTimeBangkok(new Date()), UpdatedBy: 'SYSTEM'
      });
      updated.push(user.UserID);
    }
  });
  return { updatedCount: updated.length, userIds: updated };
}

function testApi() {
  var response = doGet();
  var result = response.getContent();
  console.log(result);
  return JSON.parse(result);
}

function testSaveAudit() {
  var admin = getRowsAsObjects(SHEET_NAMES.USERS).filter(function (row) { return row.Role === 'Admin' && isActive_(row.ActiveStatus); })[0];
  var checklist = getRowsAsObjects(SHEET_NAMES.CHECKLIST).filter(function (row) { return isActive_(row.ActiveStatus); })[0];
  if (!admin) throw new Error('An active Admin user is required.');
  if (!checklist) throw new Error('At least one active checklist row is required.');
  var payload = {
    auditDate: formatDateBangkok_(new Date()), lineId: checklist.LineID === 'ALL' ? 'TEST-LINE' : checklist.LineID,
    stationId: checklist.StationID === 'ALL' ? 'TEST-STATION' : checklist.StationID,
    auditLayer: checklist.AuditLayer === 'ALL' ? 'L1' : checklist.AuditLayer,
    shift: 'TEST', remark: 'Created by testSaveAudit',
    records: [{ checklistId: checklist.ChecklistID, category: checklist.Category, checkItem: checklist.CheckItem, standardCriteria: checklist.StandardCriteria, result: 'OK', remark: 'Backend smoke test' }]
  };
  var response = saveAudit(payload, { UserID: admin.UserID, Username: admin.Username, FullName: admin.FullName, Role: admin.Role });
  var result = JSON.parse(response.getContent());
  console.log(JSON.stringify(result));
  return result;
}
