/** Shared database, validation, date, ID, and response helpers. */
function getSpreadsheet_() {
  if (!SPREADSHEET_ID) SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
  if (!SPREADSHEET_ID) throw new Error('SPREADSHEET_ID is not configured in Script Properties.');
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheet(sheetName) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) throw new Error('Required sheet not found: ' + sheetName);
  return sheet;
}

function getHeaders_(sheet) {
  var lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) return [];
  return sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(cleanString_);
}

function getRowsAsObjects(sheetName) {
  var sheet = getSheet(sheetName);
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];
  var headers = getHeaders_(sheet);
  var values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  return values.map(function (row, index) {
    var object = { _rowNumber: index + 2 };
    headers.forEach(function (header, column) {
      if (header) object[header] = normalizeCellValue_(row[column]);
    });
    return object;
  }).filter(function (object) {
    return headers.some(function (header) { return header && object[header] !== ''; });
  });
}

function appendObject(sheetName, object) {
  validateObjectFields_(sheetName, object);
  var sheet = getSheet(sheetName);
  var headers = getHeaders_(sheet);
  if (!headers.length) throw new Error('Sheet has no header row: ' + sheetName);
  var row = headers.map(function (header) { return object[header] === undefined ? '' : object[header]; });
  sheet.appendRow(row);
  return object;
}

function updateObjectById(sheetName, idColumnName, idValue, updateObject) {
  validateObjectFields_(sheetName, updateObject);
  var sheet = getSheet(sheetName);
  var headers = getHeaders_(sheet);
  var idColumn = headers.indexOf(idColumnName);
  if (idColumn < 0) throw new Error('ID column not found: ' + idColumnName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var ids = sheet.getRange(2, idColumn + 1, lastRow - 1, 1).getDisplayValues();
  var rowNumber = -1;
  for (var i = 0; i < ids.length; i++) {
    if (cleanString_(ids[i][0]) === cleanString_(idValue)) { rowNumber = i + 2; break; }
  }
  if (rowNumber < 0) return null;

  var current = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  headers.forEach(function (header, index) {
    if (Object.prototype.hasOwnProperty.call(updateObject, header)) current[index] = updateObject[header];
  });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([current]);
  var result = {};
  headers.forEach(function (header, index) { result[header] = normalizeCellValue_(current[index]); });
  return result;
}


function validateObjectFields_(sheetName, object) {
  var configuredHeaders = SHEET_HEADERS[sheetName];
  if (!configuredHeaders) throw new Error('No configured schema for sheet: ' + sheetName);
  var unknownFields = Object.keys(object || {}).filter(function (field) {
    return configuredHeaders.indexOf(field) === -1;
  });
  if (unknownFields.length) {
    throw new Error('Unsupported field(s) for ' + sheetName + ': ' + unknownFields.join(', '));
  }
}

function projectToSheetSchema_(sheetName, object) {
  var configuredHeaders = SHEET_HEADERS[sheetName];
  if (!configuredHeaders) throw new Error('No configured schema for sheet: ' + sheetName);
  var projected = {};
  configuredHeaders.forEach(function (header) {
    if (Object.prototype.hasOwnProperty.call(object, header)) projected[header] = object[header];
  });
  return projected;
}

function generateId(prefix, sheetName, idColumnName, periodMonth) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return generateIdWithoutLock_(prefix, sheetName, idColumnName, periodMonth);
  } finally {
    lock.releaseLock();
  }
}

/** Generates an ID while the caller already owns the script lock. */
function generateIdWithoutLock_(prefix, sheetName, idColumnName, periodMonth) {
  var ids = getRowsAsObjects(sheetName).map(function (row) { return cleanString_(row[idColumnName]); });
  var period = cleanString_(periodMonth);
  var stem = prefix + (period ? '-' + period : '');
  var width = ['AR', 'LOG', 'ATT'].indexOf(prefix) !== -1 ? 6 : 4;
  var maximum = 0;
  ids.forEach(function (id) {
    if (id.indexOf(stem + '-') === 0 || (!period && id.indexOf(prefix) === 0)) {
      var match = id.match(/(\d+)$/);
      if (match) maximum = Math.max(maximum, Number(match[1]));
    }
  });
  var sequenceKey = 'LPA_SEQUENCE_' + sheetName + '_' + idColumnName + '_' + (period || 'ALL');
  var properties = PropertiesService.getScriptProperties();
  maximum = Math.max(maximum, toNumber_(properties.getProperty(sequenceKey)));
  var next = maximum + 1;
  properties.setProperty(sequenceKey, String(next));
  return stem + (period ? '-' : '') + padNumber_(next, width);
}

function getSetting(key) {
  if (!SPREADSHEET_ID && key === 'SPREADSHEET_ID') return PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
  try {
    var row = getRowsAsObjects(SHEET_NAMES.SETTINGS).filter(function (item) {
      return cleanString_(item.SettingKey) === cleanString_(key);
    })[0];
    return row ? row.SettingValue : '';
  } catch (error) {
    if (key === 'SPREADSHEET_ID') return SPREADSHEET_ID;
    throw error;
  }
}

function hashPassword(password) {
  if (password === undefined || password === null || String(password) === '') throw new Error('Password is required.');
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password), Utilities.Charset.UTF_8);
  return digest.map(function (byte) {
    var value = byte < 0 ? byte + 256 : byte;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');
}

function jsonResponse(success, message, data) {
  return ContentService.createTextOutput(JSON.stringify({
    success: Boolean(success),
    message: String(message || ''),
    data: data === undefined || data === null ? {} : data
  })).setMimeType(ContentService.MimeType.JSON);
}

function safeCacheGetJson_(key) {
  try {
    var value = CacheService.getScriptCache().get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.warn('Cache read skipped for ' + key + ': ' + safeErrorMessage_(error));
    return null;
  }
}

function safeCachePutJson_(key, value, ttlSeconds) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(value), ttlSeconds);
    return true;
  } catch (error) {
    console.warn('Cache write skipped for ' + key + ': ' + safeErrorMessage_(error));
    return false;
  }
}

function safeCacheRemove_(keys) {
  try {
    var values = Array.isArray(keys) ? keys : [keys];
    CacheService.getScriptCache().removeAll(values.filter(Boolean));
  } catch (error) {
    console.warn('Cache removal skipped: ' + safeErrorMessage_(error));
  }
}

function formatDateTimeBangkok(date) {
  return Utilities.formatDate(date instanceof Date ? date : new Date(date), APP_TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

function formatDateBangkok_(date) {
  if (!date) return '';
  var parsed = date instanceof Date ? date : new Date(date);
  if (isNaN(parsed.getTime())) return cleanString_(date);
  return Utilities.formatDate(parsed, APP_TIMEZONE, 'yyyy-MM-dd');
}

function getPeriodMonth(date) {
  return Utilities.formatDate(date instanceof Date ? date : new Date(date), APP_TIMEZONE, 'yyyyMM');
}

function calculateOverdue(dueDate, status) {
  if (!dueDate || isClosedStatus_(status)) return { OverdueFlag: 'No', DaysOverdue: 0 };
  var due = parseDate_(dueDate);
  if (!due) return { OverdueFlag: 'No', DaysOverdue: 0 };
  var today = parseDate_(formatDateBangkok_(new Date()));
  var days = Math.floor((today.getTime() - due.getTime()) / 86400000);
  return { OverdueFlag: days > 0 ? 'Yes' : 'No', DaysOverdue: days > 0 ? days : 0 };
}

function requireFields_(object, fields) {
  var missing = fields.filter(function (field) {
    return object[field] === undefined || object[field] === null || cleanString_(object[field]) === '';
  });
  if (missing.length) throw new Error('Missing required field(s): ' + missing.join(', '));
}

function findById_(sheetName, idColumn, idValue) {
  return getRowsAsObjects(sheetName).filter(function (row) {
    return cleanString_(row[idColumn]) === cleanString_(idValue);
  })[0] || null;
}

function cleanString_(value) { return value === undefined || value === null ? '' : String(value).trim(); }
function normalizeCellValue_(value) { return value instanceof Date ? formatDateTimeBangkok(value) : value; }
function padNumber_(number, width) { return String(number).padStart(width, '0'); }
function parseDate_(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  var text = cleanString_(value);
  var match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  var date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(text);
  return isNaN(date.getTime()) ? null : date;
}
function isActive_(value) { return ['active', 'yes', 'true', '1'].indexOf(cleanString_(value).toLowerCase()) !== -1; }
function isClosedStatus_(status) { return cleanString_(status).toLowerCase() === 'closed'; }
function valuesEqual_(left, right) { return cleanString_(left).toLowerCase() === cleanString_(right).toLowerCase(); }
function safeErrorMessage_(error) { return error && error.message ? error.message : 'Unexpected server error.'; }
function toNumber_(value) { var number = Number(value); return isNaN(number) ? 0 : number; }
function uniqueValues_(values) { var seen = {}; return values.filter(function (value) { var key = cleanString_(value); if (!key || seen[key]) return false; seen[key] = true; return true; }); }
function sanitizeForClient_(row) { var copy = {}; Object.keys(row || {}).forEach(function (key) { if (key.charAt(0) !== '_') copy[key] = row[key]; }); return copy; }
