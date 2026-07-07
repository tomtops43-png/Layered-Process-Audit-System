'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('apps-script/ScheduleRules.gs', 'utf8');
const sheets = {
  AuditPlanRules: [],
  Lines: [{ LineID: 'ENC1', LineName: 'ENC Line 1', ActiveStatus: 'Active' }],
  Stations: [
    { StationID: 'ST1', StationName: 'Station 1', LineID: 'ENC1', ActiveStatus: 'Active' },
    { StationID: 'ST2', StationName: 'Station 2', LineID: 'ENC1', ActiveStatus: 'Active' },
    { StationID: 'ST3', StationName: 'Station 3', LineID: 'ENC1', ActiveStatus: 'Inactive' },
    { StationID: 'OTHER', StationName: 'Other', LineID: 'ENC2', ActiveStatus: 'Active' }
  ],
  Users: [{ UserID: 'USER1', FullName: 'ภาคภูมิ', Role: 'Leader', ActiveStatus: 'Active' }]
};
let sequence = 0;
const context = {
  SHEET_NAMES: {
    AUDIT_PLAN_RULES: 'AuditPlanRules', LINES: 'Lines', STATIONS: 'Stations', USERS: 'Users'
  },
  requirePermission_: () => true,
  requireFields_: (payload, fields) => fields.forEach(field => {
    if (payload[field] === undefined || payload[field] === null || String(payload[field]).trim() === '') {
      throw new Error(`Missing ${field}`);
    }
  }),
  cleanString_: value => value == null ? '' : String(value).trim(),
  valuesEqual_: (left, right) => String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase(),
  isAllFilter_: value => ['', 'all', 'ทั้งหมด', 'null', 'undefined'].includes(String(value == null ? '' : value).trim().toLowerCase()),
  isAdmin_: user => user.Role === 'Admin',
  requireLineAccess_: () => true,
  findById_: (sheet, field, value) => (sheets[sheet] || []).find(row => String(row[field]) === String(value)) || null,
  getRowsAsObjects: sheet => (sheets[sheet] || []).map(row => ({ ...row })),
  isActive_: value => ['active', 'true', 'yes', '1'].includes(String(value || '').toLowerCase()),
  toNumber_: value => Number(value) || 0,
  formatDateTimeBangkok: () => '2026-06-15 12:00:00',
  generateIdWithoutLock_: () => `RULE-${String(++sequence).padStart(4, '0')}`,
  appendObject: (sheet, row) => sheets[sheet].push({ ...row }),
  updateObjectById: (sheet, field, value, updates) => {
    const row = sheets[sheet].find(item => String(item[field]) === String(value));
    Object.assign(row, updates);
    return row;
  },
  sanitizeForClient_: row => ({ ...row }),
  invalidateDashboardCachesForUser_: () => {},
  safeCacheGetJson_: () => null,
  safeCachePutJson_: () => false,
  safeCacheRemove_: () => {},
  jsonResponse: (success, message, data) => ({ success, message, data }),
  safeErrorMessage_: error => error.message,
  LockService: {
    getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} })
  }
};
vm.createContext(context);
vm.runInContext(source, context);

const admin = { UserID: 'ADMIN', Role: 'Admin' };
const basePayload = {
  requiredRole: 'Leader', requiredUserId: 'USER1', lineId: 'ENC1', stationId: 'ALL',
  frequency: 'Daily', dayOfWeek: '', dayOfMonth: '', dueTime: '17:00', activeStatus: 'Active'
};

// Station 'ALL' now creates a single line-level rule (see "Migrate rules to
// line-level"), not one rule per station.
let response = context.upsertAuditPlanRule(basePayload, admin);
assert.strictEqual(response.success, true, response.message);
assert.strictEqual(response.data.createdCount, 1);
assert.strictEqual(response.data.skippedDuplicateCount, 0);
assert.deepStrictEqual(sheets.AuditPlanRules.map(row => row.StationID), ['ALL']);

response = context.upsertAuditPlanRule(basePayload, admin);
assert.strictEqual(response.success, true, response.message);
assert.strictEqual(response.data.createdCount, 0);
assert.strictEqual(response.data.skippedDuplicateCount, 1);
assert.strictEqual(sheets.AuditPlanRules.length, 1);

response = context.upsertAuditPlanRule({ ...basePayload, stationId: 'ST1', frequency: 'Weekly', dayOfWeek: 'Fri' }, admin);
assert.strictEqual(response.success, true, response.message);
assert.strictEqual(response.data.createdCount, 1);
assert.strictEqual(sheets.AuditPlanRules.length, 2);

response = context.upsertAuditPlanRule({ ...basePayload, stationId: 'ST3' }, admin);
assert.strictEqual(response.success, false);
assert.match(response.message, /not active|does not belong|No active lines\/stations/);

console.log('Audit rule All Stations tests passed.');
