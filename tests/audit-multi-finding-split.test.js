'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const audit = fs.readFileSync('apps-script/Audit.gs', 'utf8');

const sheets = {
  AuditSessions: [],
  AuditRecords: [],
  Findings: []
};

let idCounter = 0;

const context = {
  console,
  SHEET_NAMES: {
    AUDIT_SESSIONS: 'AuditSessions',
    AUDIT_RECORDS: 'AuditRecords',
    FINDINGS: 'Findings'
  },
  getRowsAsObjects: name => (sheets[name] || []).map(row => ({ ...row })),
  appendObject: (name, row) => { if (!sheets[name]) sheets[name] = []; sheets[name].push({ ...row }); },
  appendBatch_: (name, rows) => { if (!sheets[name]) sheets[name] = []; rows.forEach(row => sheets[name].push({ ...row })); },
  findById_: (name, field, value) => (sheets[name] || []).find(row => String(row[field]) === String(value)) || null,
  requireFields_: (payload, fields) => {
    fields.forEach(field => {
      if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
        throw new Error(`${field} is required.`);
      }
    });
  },
  cleanString_: value => value === null || value === undefined ? '' : String(value).trim(),
  valuesEqual_: (left, right) => String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase(),
  isActive_: value => !value || String(value).trim().toLowerCase() === 'active',
  hasPermission_: () => true,
  isAdmin_: () => false,
  csvList_: value => String(value === null || value === undefined ? '' : value).split(',').map(item => item.trim()).filter(Boolean),
  toNumber_: value => { const n = Number(value); return isNaN(n) ? 0 : n; },
  jsonResponse: (success, message, data) => ({ success, message, data }),
  safeErrorMessage_: error => error.message,
  formatDateBangkok_: value => { const d = value instanceof Date ? value : new Date(value); return d.toISOString().slice(0, 10); },
  formatDateTimeBangkok: () => '2026-07-13 08:00:00',
  getPeriodMonth: () => '202607',
  parseDate_: value => new Date(value),
  addDays_: (date, days) => { const d = new Date(date); d.setDate(d.getDate() + days); return d; },
  getDefaultDueDays_: () => 5,
  getCachedChecklistRows_: () => [{ ChecklistID: 'CL-1', Category: 'SAFETY', CheckItem: 'ตรวจ PPE', StandardCriteria: '-', Revision: '1', Severity: 'Minor' }],
  getCachedUserRows_: () => [],
  getCachedListRows_: () => [],
  generateMultipleIdsWithoutLock_: (prefix, sheetName, idColumnName, periodMonth, count) => {
    const ids = [];
    for (let i = 0; i < count; i++) { idCounter++; ids.push(`${prefix}-TEST-${idCounter}`); }
    return ids;
  },
  validateAssignableFindingRole_: role => role,
  normalizeFindingAssignmentMode_: (mode, source) => (mode || 'ROLE').toUpperCase(),
  mapCategoryTo5m1e_: () => 'Method',
  completeAuditPlan_: () => {},
  invalidateDashboardCachesForUser_: () => {},
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  APP_TIMEZONE: 'Asia/Bangkok'
};
vm.createContext(context);
vm.runInContext(audit, context);

const currentUser = { UserID: 'U0001', FullName: 'ผู้ตรวจทดสอบ', Role: 'Manager' };

const todayStr = new Date().toISOString().slice(0, 10);
const payload = {
  auditDate: todayStr, auditTime: '08:00:00', lineId: 'L001', lineName: 'Line 1',
  stationId: 'ALL', stationName: 'ทั้ง Line', area: 'Assembly', auditLayer: 'Manager',
  shift: '', remark: '', lateReason: '', planId: '', clientSubmissionId: 'CS-TEST-1',
  records: [
    {
      checklistId: 'CL-1', category: 'SAFETY', checkItem: 'ตรวจ PPE', standardCriteria: '-', checklistRevision: '1',
      result: 'NG', remark: '',
      findingDetails: ['พนักงานไม่สวม PPE', 'ไม่มีป้ายเตือนความปลอดภัย'],
      assignmentMode: 'ROLE', assignedRole: 'Leader', dueDate: '2026-07-18'
    }
  ]
};

const result = context.saveAudit(payload, currentUser);
assert.strictEqual(result.success, true, 'saveAudit should succeed: ' + result.message);
assert.strictEqual(sheets.Findings.length, 2, 'one Finding per problem item, not one shared Finding');

const [f1, f2] = sheets.Findings;
assert.strictEqual(f1.ProblemDetail, 'พนักงานไม่สวม PPE');
assert.strictEqual(f2.ProblemDetail, 'ไม่มีป้ายเตือนความปลอดภัย');
assert.notStrictEqual(f1.FindingID, f2.FindingID, 'each split Finding must have its own FindingID');
// Shared fields (assignment, due date, checklist link) carry through to every split Finding.
[f1, f2].forEach(f => {
  assert.strictEqual(f.AssignedRole, 'Leader');
  assert.strictEqual(f.DueDate, '2026-07-18');
  assert.strictEqual(f.RecordID, sheets.AuditRecords[0].RecordID);
  assert.strictEqual(f.AuditID, sheets.AuditSessions[0].AuditID);
  assert.strictEqual(f.Status, 'Assigned');
  assert.strictEqual(f.CorrectiveAction, '', 'corrective action starts empty — filled in later by the assignee');
});

const auditRecord = sheets.AuditRecords[0];
assert.strictEqual(auditRecord.FindingID, `${f1.FindingID}, ${f2.FindingID}`, 'AuditRecord.FindingID should list every split Finding');
assert.strictEqual(auditRecord.FindingDetail, `1. พนักงานไม่สวม PPE\n2. ไม่มีป้ายเตือนความปลอดภัย`);

console.log('Audit multi-finding split tests passed.');
