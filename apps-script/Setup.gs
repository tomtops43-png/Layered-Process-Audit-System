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

/** Creates missing RBAC sheets/headers and inserts only missing default role permissions. */
function setupRbac() {
  var headerResults = setupHeaders();
  var defaults = getDefaultRolePermissions_();
  var existing = getRowsAsObjects(SHEET_NAMES.ROLE_PERMISSIONS);
  var timestamp = formatDateTimeBangkok(new Date());
  var inserted = 0;
  Object.keys(defaults).forEach(function (role) {
    defaults[role].forEach(function (permissionKey) {
      var exists = existing.some(function (row) {
        return cleanString_(row.Role).toLowerCase() === cleanString_(role).toLowerCase() &&
          cleanString_(row.PermissionKey).toLowerCase() === cleanString_(permissionKey).toLowerCase();
      });
      if (!exists) {
        appendObject(SHEET_NAMES.ROLE_PERMISSIONS, {
          Role: role, PermissionKey: permissionKey, Allowed: 'TRUE',
          Description: 'Default ' + role + ' permission',
          UpdatedAt: timestamp, UpdatedBy: 'SYSTEM'
        });
        inserted++;
      }
    });
  });
  return { headers: headerResults, insertedRolePermissions: inserted };
}

function getDefaultRolePermissions_() {
  return {
    Admin: ['*', 'users.view', 'users.create', 'users.update', 'users.deactivate', 'users.resetPassword', 'users.managePermission'],
    Manager: ['audit.manager.create', 'audit.view.all', 'findings.view.all', 'findings.assign', 'findings.verify', 'findings.close.minor', 'findings.close.major', 'findings.close.critical', 'dashboard.view.all', 'reports.view', 'reports.export'],
    Supervisor: [],
    Engineer: ['audit.engineer.create', 'audit.view.line', 'findings.view.line', 'findings.assign', 'findings.update.line', 'findings.verify', 'findings.close.minor', 'findings.close.major', 'dashboard.view', 'reports.view'],
    Leader: ['audit.leader.create', 'audit.view.own', 'findings.view.assigned', 'findings.view.created', 'findings.update.assigned', 'findings.close.minor', 'dashboard.view'],
    User: ['findings.view.assigned', 'findings.update.assigned', 'dashboard.view']
  };
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

function createSampleMasterData() {
  var timestamp = formatDateTimeBangkok(new Date());
  var created = [];
  var lineId = 'TEST-LINE';
  var stationId = 'TEST-STATION';
  if (!findById_(SHEET_NAMES.LINES, 'LineID', lineId)) {
    appendObject(SHEET_NAMES.LINES, {
      LineID: lineId, LineName: 'Test Line', Area: 'Test Area', Department: 'Quality',
      ActiveStatus: 'Active', SortOrder: 999, CreatedAt: timestamp, UpdatedAt: timestamp
    });
    created.push(lineId);
  }
  if (!findById_(SHEET_NAMES.STATIONS, 'StationID', stationId)) {
    appendObject(SHEET_NAMES.STATIONS, {
      StationID: stationId, LineID: lineId, LineName: 'Test Line', StationName: 'Test Station',
      StationNo: 'TEST', Area: 'Test Area', ProcessName: 'Test Process', ActiveStatus: 'Active',
      SortOrder: 999, CreatedAt: timestamp, UpdatedAt: timestamp
    });
    created.push(stationId);
  }
  return { created: created, lineId: lineId, stationId: stationId };
}

function testApi() {
  var response = doGet();
  var result = response.getContent();
  console.log(result);
  return JSON.parse(result);
}

function testSaveAudit() {
  var context = getSampleAuditContext_();
  var now = new Date();
  var auditDate = formatDateBangkok_(now);
  var periodMonth = getPeriodMonth(now);
  var payload = {
    auditDate: auditDate, auditTime: Utilities.formatDate(now, APP_TIMEZONE, 'HH:mm:ss'),
    periodMonth: periodMonth, lineId: context.lineId, lineName: context.lineName,
    stationId: context.stationId, stationName: context.stationName, area: context.area,
    auditLayer: context.auditLayer, shift: 'TEST', submitStatus: 'Submitted',
    remark: 'Created by testSaveAudit',
    records: [{
      checklistId: context.checklist.ChecklistID, category: context.checklist.Category,
      checkItem: context.checklist.CheckItem, standardCriteria: context.checklist.StandardCriteria,
      checklistRevision: context.checklist.Revision, result: 'OK', findingDetail: '',
      correctiveAction: '', responsiblePerson: '', picUserId: '', picName: '', dueDate: '',
      status: 'Completed', findingStatus: '', beforePhotoUrl: '', afterPhotoUrl: '',
      remark: 'Backend OK audit smoke test'
    }]
  };
  var response = saveAudit(payload, context.user);
  var result = JSON.parse(response.getContent());
  console.log(JSON.stringify(result));
  return result;
}

function testSaveAuditNG() {
  var context = getSampleAuditContext_();
  var now = new Date();
  var auditDate = formatDateBangkok_(now);
  var dueDate = new Date(now.getTime());
  dueDate.setDate(dueDate.getDate() + 7);
  var payload = {
    auditDate: auditDate, auditTime: Utilities.formatDate(now, APP_TIMEZONE, 'HH:mm:ss'),
    periodMonth: getPeriodMonth(now), lineId: context.lineId, lineName: context.lineName,
    stationId: context.stationId, stationName: context.stationName, area: context.area,
    auditLayer: context.auditLayer, shift: 'TEST', submitStatus: 'Submitted',
    remark: 'Created by testSaveAuditNG',
    records: [{
      checklistId: context.checklist.ChecklistID, category: context.checklist.Category,
      checkItem: context.checklist.CheckItem, standardCriteria: context.checklist.StandardCriteria,
      checklistRevision: context.checklist.Revision, result: 'NG',
      findingDetail: 'NG smoke-test finding', correctiveAction: 'Contain and correct the test condition',
      rootCause: 'Test root cause', responsiblePerson: context.admin.FullName,
      picUserId: context.admin.UserID, picName: context.admin.FullName,
      assignedToUserId: context.admin.UserID, assignedToName: context.admin.FullName,
      assignedToRole: context.admin.Role, dueDate: formatDateBangkok_(dueDate),
      status: 'Assigned', findingStatus: 'Assigned', severity: context.checklist.Severity || 'Minor',
      beforePhotoUrl: 'https://drive.google.com/test-before-photo',
      afterPhotoUrl: '', remark: 'Backend NG/Finding smoke test'
    }]
  };
  var response = saveAudit(payload, context.user);
  var result = JSON.parse(response.getContent());
  console.log(JSON.stringify(result));
  return result;
}

function testLogin(username, password) {
  username = cleanString_(username);
  password = cleanString_(password);
  if (!username || !password) throw new Error('testLogin(username, password) requires both values.');
  var result = JSON.parse(login({ username: username, password: password }).getContent());
  console.log(JSON.stringify(result));
  return result;
}

function testDashboard() {
  var admin = getActiveAdmin_();
  var result = JSON.parse(getDashboard({}, buildUserContext_(admin)).getContent());
  console.log(JSON.stringify(result));
  return result;
}

function testMonthlyReport(periodMonth) {
  var admin = getActiveAdmin_();
  periodMonth = cleanString_(periodMonth) || getPeriodMonth(new Date());
  var result = JSON.parse(getMonthlyReport({ periodMonth: periodMonth }, buildUserContext_(admin)).getContent());
  console.log(JSON.stringify(result));
  return result;
}

function getActiveAdmin_() {
  var admin = getRowsAsObjects(SHEET_NAMES.USERS).filter(function (row) {
    return cleanString_(row.Role).toLowerCase() === 'admin' && isActive_(row.ActiveStatus);
  })[0];
  if (!admin) throw new Error('An active Admin user is required.');
  return admin;
}

function getActiveChecklist_() {
  var checklist = getRowsAsObjects(SHEET_NAMES.CHECKLIST).filter(function (row) {
    return isActive_(row.ActiveStatus);
  })[0];
  if (!checklist) throw new Error('At least one active checklist row is required.');
  return checklist;
}

function buildUserContext_(user) {
  return {
    UserID: user.UserID, Username: user.Username, FullName: user.FullName,
    Role: user.Role, LineDefault: user.LineDefault || ''
  };
}

function getSampleAuditContext_() {
  var admin = getActiveAdmin_();
  var checklist = getActiveChecklist_();
  var sample = createSampleMasterData();
  var lineId = cleanString_(checklist.LineID).toUpperCase() === 'ALL' ? sample.lineId : checklist.LineID;
  var stationId = cleanString_(checklist.StationID).toUpperCase() === 'ALL' ? sample.stationId : checklist.StationID;
  var line = findById_(SHEET_NAMES.LINES, 'LineID', lineId) || {};
  var station = findById_(SHEET_NAMES.STATIONS, 'StationID', stationId) || {};
  return {
    admin: admin, user: buildUserContext_(admin), checklist: checklist,
    lineId: lineId, lineName: line.LineName || station.LineName || 'Test Line',
    stationId: stationId, stationName: station.StationName || 'Test Station',
    area: station.Area || line.Area || 'Test Area',
    auditLayer: cleanString_(checklist.AuditLayer).toUpperCase() === 'ALL' ? 'Manager' : checklist.AuditLayer
  };
}
