/** Scheduled maintenance: token cleanup and old-record archiving.
 *
 * Run installMaintenanceTriggers() once from the Apps Script editor to
 * schedule cleanupExpiredTokens daily and archiveOldRecords monthly.
 */
var ARCHIVE_RETENTION_MONTHS = 12;

/** Deletes expired login tokens from ScriptProperties.
 * Tokens are only deleted on use, so abandoned sessions accumulate until the
 * 500KB PropertiesService quota fills up and every login starts failing. */
function cleanupExpiredTokens() {
  var properties = PropertiesService.getScriptProperties();
  var all = properties.getProperties();
  var now = new Date().getTime();
  var removed = 0;
  Object.keys(all).forEach(function (key) {
    if (key.indexOf(TOKEN_PROPERTY_PREFIX) !== 0) return;
    var expired = true;
    try {
      var session = JSON.parse(all[key]);
      expired = !session.expiry || Number(session.expiry) <= now;
    } catch (error) {
      // Unparseable token payloads are garbage; delete them too.
    }
    if (expired) {
      properties.deleteProperty(key);
      removed++;
    }
  });
  console.log('cleanupExpiredTokens: removed ' + removed + ' expired token(s).');
  return removed;
}

/** Moves closed findings and action logs older than ARCHIVE_RETENTION_MONTHS
 * into <SheetName>Archive sheets so the hot sheets stay small and fast. */
function archiveOldRecords() {
  var cutoff = archiveCutoffDate_();
  var findingsMoved = archiveSheetRows_(SHEET_NAMES.FINDINGS, function (row) {
    if (!valuesEqual_(row.Status, 'Closed')) return false;
    var closedAt = parseDate_(row.ClosedDate || row.ClosedAt || row.UpdatedAt);
    return closedAt !== null && closedAt.getTime() < cutoff.getTime();
  });
  var logsMoved = archiveSheetRows_(SHEET_NAMES.ACTION_LOGS, function (row) {
    var actionDate = parseDate_(row.ActionDate || row.CreatedAt);
    return actionDate !== null && actionDate.getTime() < cutoff.getTime();
  });
  if (findingsMoved) invalidateFindingsCache_();
  console.log('archiveOldRecords: moved ' + findingsMoved + ' finding(s) and ' + logsMoved + ' action log(s).');
  return { findings: findingsMoved, actionLogs: logsMoved };
}

function archiveCutoffDate_() {
  var cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - ARCHIVE_RETENTION_MONTHS);
  return cutoff;
}

/** Moves rows matching shouldArchive from sheetName into sheetName + 'Archive'.
 * Copies to the archive sheet first and only rewrites the source after the
 * copy succeeds, so a failure can duplicate rows but never lose them. */
function archiveSheetRows_(sheetName, shouldArchive) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Could not acquire lock for archiving ' + sheetName + '.');
  try {
    var sheet = getSheet(sheetName);
    var lastRow = sheet.getLastRow();
    var lastColumn = sheet.getLastColumn();
    if (lastRow < 2 || lastColumn < 1) return 0;
    var headers = getHeaders_(sheet);
    var values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
    var keep = [];
    var move = [];
    values.forEach(function (rowValues) {
      var row = {};
      headers.forEach(function (header, column) {
        if (header) row[header] = normalizeCellValue_(rowValues[column]);
      });
      (shouldArchive(row) ? move : keep).push(rowValues);
    });
    if (!move.length) return 0;

    var archive = getOrCreateArchiveSheet_(sheetName, headers);
    archive.getRange(archive.getLastRow() + 1, 1, move.length, lastColumn).setValues(move);
    SpreadsheetApp.flush();

    sheet.getRange(2, 1, lastRow - 1, lastColumn).clearContent();
    if (keep.length) sheet.getRange(2, 1, keep.length, lastColumn).setValues(keep);
    SpreadsheetApp.flush();
    return move.length;
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateArchiveSheet_(sheetName, headers) {
  var spreadsheet = getSpreadsheet_();
  var archiveName = sheetName + 'Archive';
  var archive = spreadsheet.getSheetByName(archiveName);
  if (!archive) {
    archive = spreadsheet.insertSheet(archiveName);
    archive.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return archive;
}

/** Run once from the Apps Script editor to (re)install the maintenance triggers. */
function installMaintenanceTriggers() {
  var handlers = { cleanupExpiredTokens: true, archiveOldRecords: true };
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (handlers[trigger.getHandlerFunction()]) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('cleanupExpiredTokens').timeBased().everyDays(1).atHour(3).create();
  ScriptApp.newTrigger('archiveOldRecords').timeBased().onMonthDay(1).atHour(2).create();
  console.log('Maintenance triggers installed: cleanupExpiredTokens (daily 03:00), archiveOldRecords (monthly day 1 02:00).');
}
