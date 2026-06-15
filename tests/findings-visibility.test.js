const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const sheets = {
  Findings: [],
  RolePermissions: [],
  UserPermissions: [],
  UserLineAccess: [],
  Users: [],
  AuditSessions: [],
  ActionLogs: []
};

const context = {
  console,
  SHEET_NAMES: {
    FINDINGS: 'Findings',
    ROLE_PERMISSIONS: 'RolePermissions',
    USER_PERMISSIONS: 'UserPermissions',
    USER_LINE_ACCESS: 'UserLineAccess',
    USERS: 'Users',
    AUDIT_SESSIONS: 'AuditSessions',
    ACTION_LOGS: 'ActionLogs'
  },
  getRowsAsObjects: name => (sheets[name] || []).map(row => ({ ...row })),
  findById_: (name, field, value) => (sheets[name] || []).find(row => String(row[field]) === String(value)) || null,
  updateObjectById: (name, field, value, updates) => {
    const row = (sheets[name] || []).find(item => String(item[field]) === String(value));
    if (!row) throw new Error(`Missing ${name} row`);
    Object.assign(row, updates);
    return { ...row };
  },
  appendObject: (name, row) => {
    if (!sheets[name]) sheets[name] = [];
    sheets[name].push({ ...row });
  },
  generateId: prefix => `${prefix}-TEST`,
  getDefaultRolePermissions_: () => ({}),
  requireFields_: (payload, fields) => {
    fields.forEach(field => {
      if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
        throw new Error(`${field} is required.`);
      }
    });
  },
  cleanString_: value => value === null || value === undefined ? '' : String(value).trim(),
  valuesEqual_: (left, right) => String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase(),
  isActive_: value => String(value || '').trim().toLowerCase() === 'active',
  sanitizeForClient_: value => value,
  calculateOverdue: () => ({ OverdueFlag: 'No', DaysOverdue: 0 }),
  formatDateBangkok_: value => value,
  formatDateTimeBangkok: () => '2026-06-15 12:00:00',
  getPeriodMonth: () => '202606',
  jsonResponse: (success, message, data) => ({ success, message, data }),
  safeErrorMessage_: error => error.message
};
vm.createContext(context);
['apps-script/RBAC.gs', 'apps-script/Findings.gs'].forEach(file => {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
});

function setPermissions(role, permissions) {
  sheets.RolePermissions = permissions.map(PermissionKey => ({ Role: role, PermissionKey, Allowed: true }));
}

function visibleIds(user, payload = {}) {
  const response = context.getFindings(payload, user);
  assert.strictEqual(response.success, true, response.message);
  return response.data.findings.map(row => row.FindingID).sort();
}

const leader = { UserID: 'USR-LEADER', FullName: 'Same Name', Role: 'Leader' };
sheets.Findings = [
  { FindingID: 'assigned-id', AssignedToUserID: leader.UserID, AssignedToName: 'Leader' },
  { FindingID: 'created-auditor', AssignedToUserID: 'USR-ADMIN', AuditorUserID: leader.UserID },
  { FindingID: 'created-by', AssignedToUserID: 'USR-ADMIN', AuditorUserID: 'USR-AUDITOR', CreatedBy: leader.UserID },
  { FindingID: 'admin', AssignedToUserID: 'USR-ADMIN', AssignedToName: 'Same Name' },
  { FindingID: 'legacy-name', AssignedToName: leader.FullName },
  { FindingID: 'verify', AssignedToUserID: 'USR-ADMIN', VerifierUserID: leader.UserID, Status: 'Pending Verification' }
];
setPermissions('Leader', ['findings.view.assigned', 'findings.view.created']);
assert.deepStrictEqual(
  visibleIds(leader),
  ['assigned-id', 'created-auditor', 'created-by', 'legacy-name'],
  'All must return only the leader-authorized union'
);
assert.deepStrictEqual(visibleIds(leader, { myFindings: 'assigned' }), ['assigned-id', 'legacy-name']);
assert.deepStrictEqual(visibleIds(leader, { myFindings: 'created' }), ['created-auditor', 'created-by']);
assert.deepStrictEqual(
  visibleIds(leader, { myFindings: 'verification' }),
  [],
  'A My Findings filter cannot expand the base visibility scope'
);

const engineer = { UserID: 'USR-ENGINEER', FullName: 'Engineer', Role: 'Engineer' };
sheets.Findings = [
  { FindingID: 'line-view', LineID: 'LINE-VIEW' },
  { FindingID: 'line-audit', LineID: 'LINE-AUDIT' },
  { FindingID: 'line-manage', LineID: 'LINE-MANAGE' },
  { FindingID: 'line-all-level', LineID: 'LINE-ALL-LEVEL' },
  { FindingID: 'inactive', LineID: 'LINE-INACTIVE' },
  { FindingID: 'other', LineID: 'LINE-OTHER' },
  { FindingID: 'missing-line', LineID: '' }
];
setPermissions('Engineer', ['findings.view.line']);
sheets.UserLineAccess = [
  { UserID: engineer.UserID, LineID: 'LINE-VIEW', AccessLevel: 'View', ActiveStatus: 'Active' },
  { UserID: engineer.UserID, LineID: 'LINE-AUDIT', AccessLevel: 'Audit', ActiveStatus: 'Active' },
  { UserID: engineer.UserID, LineID: 'LINE-MANAGE', AccessLevel: 'Manage', ActiveStatus: 'Active' },
  { UserID: engineer.UserID, LineID: 'LINE-ALL-LEVEL', AccessLevel: 'All', ActiveStatus: 'Active' },
  { UserID: engineer.UserID, LineID: 'LINE-INACTIVE', AccessLevel: 'View', ActiveStatus: 'Inactive' },
  { UserID: 'USR-OTHER', LineID: 'LINE-OTHER', AccessLevel: 'Manage', ActiveStatus: 'Active' }
];
assert.deepStrictEqual(visibleIds(engineer), ['line-all-level', 'line-audit', 'line-manage', 'line-view']);

const manager = { UserID: 'USR-MANAGER', FullName: 'Manager', Role: 'Manager' };
setPermissions('Manager', ['findings.view.all']);
assert.deepStrictEqual(visibleIds(manager), sheets.Findings.map(row => row.FindingID).sort());

const user = { UserID: 'USR-USER', FullName: 'User', Role: 'User' };
sheets.Findings = [
  { FindingID: 'assigned', AssignedToUserID: user.UserID },
  { FindingID: 'not-assigned', AssignedToUserID: 'USR-OTHER', CreatedBy: user.UserID },
  { FindingID: 'pending-verification', AssignedToUserID: user.UserID, VerifierUserID: user.UserID, Status: 'Pending Verification' }
];
setPermissions('User', ['findings.view.assigned']);
assert.deepStrictEqual(visibleIds(user), ['assigned', 'pending-verification']);
assert.deepStrictEqual(visibleIds(user, { myFindings: 'verification' }), []);

sheets.Findings = [
  { FindingID: 'unassigned-minor', LineID: 'LINE-VERIFY', Status: 'Pending Verification', Severity: 'Minor', VerifierUserID: '' },
  { FindingID: 'unassigned-critical', LineID: 'LINE-VERIFY', Status: 'Pending Verification', Severity: 'Critical', VerifierUserID: '' },
  { FindingID: 'assigned-verifier', LineID: 'LINE-OTHER', Status: 'Pending Verification', Severity: 'Critical', VerifierUserID: engineer.UserID },
  { FindingID: 'assigned-other', LineID: 'LINE-VERIFY', Status: 'Pending Verification', Severity: 'Minor', VerifierUserID: 'USR-OTHER' }
];
setPermissions('Engineer', ['findings.verify', 'findings.close.minor', 'findings.close.major']);
sheets.UserLineAccess = [
  { UserID: engineer.UserID, LineID: 'LINE-VERIFY', AccessLevel: 'View', ActiveStatus: 'Active' }
];
assert.deepStrictEqual(
  visibleIds(engineer, { myFindings: 'verification' }),
  ['assigned-verifier', 'unassigned-minor'],
  'Verifier filter must include assigned verification work and unassigned work within line/severity scope'
);

setPermissions('Manager', ['findings.view.all', 'findings.verify', 'findings.close.minor', 'findings.close.major', 'findings.close.critical']);
assert.deepStrictEqual(
  visibleIds(manager, { myFindings: 'verification' }),
  ['assigned-other', 'assigned-verifier', 'unassigned-critical', 'unassigned-minor']
);

const workflowLeader = { UserID: 'USR-LEADER', FullName: 'Leader', Role: 'Leader' };
const workflowManager = { UserID: 'USR-MANAGER', FullName: 'Manager', Role: 'Manager' };
const outsider = { UserID: 'USR-OUTSIDER', FullName: 'Outsider', Role: 'User' };
sheets.Findings = [{
  FindingID: 'F-WORKFLOW',
  AssignedToUserID: workflowLeader.UserID,
  AssignedToName: workflowLeader.FullName,
  Status: 'Assigned',
  Severity: 'Major',
  RootCause: '',
  CorrectiveAction: '',
  ActionRemark: '',
  AfterPhotoURL: ''
}];
setPermissions('Leader', ['findings.view.assigned', 'findings.update.assigned']);
let response = context.submitFinding({
  findingId: 'F-WORKFLOW',
  correctiveAction: 'Corrected',
  afterPhotoUrl: 'https://example.test/after.jpg'
}, workflowLeader);
assert.strictEqual(response.success, false);
assert.match(response.message, /RootCause is required/);

response = context.submitFinding({
  findingId: 'F-WORKFLOW',
  rootCause: 'Root cause',
  correctiveAction: 'Corrected',
  afterPhotoUrl: 'https://example.test/after.jpg'
}, workflowLeader);
assert.strictEqual(response.success, true, response.message);
assert.strictEqual(sheets.Findings[0].Status, 'Pending Verification');
assert.strictEqual(sheets.Findings[0].VerificationStatus, 'Pending');
assert.strictEqual(sheets.Findings[0].SubmittedBy, workflowLeader.UserID);

setPermissions('User', ['findings.close.major']);
response = context.closeFinding({ findingId: 'F-WORKFLOW', closeRemark: 'Unauthorized close' }, outsider);
assert.strictEqual(response.success, false);

setPermissions('Manager', ['findings.view.all', 'findings.verify', 'findings.close.major']);
response = context.verifyFinding({ findingId: 'F-WORKFLOW', decision: 'Approve' }, workflowManager);
assert.strictEqual(response.success, false);
assert.match(response.message, /CloseRemark is required/);

response = context.verifyFinding({
  findingId: 'F-WORKFLOW',
  decision: 'Approve',
  closeRemark: 'Verified and complete'
}, workflowManager);
assert.strictEqual(response.success, true, response.message);
assert.strictEqual(sheets.Findings[0].Status, 'Closed');
assert.strictEqual(sheets.Findings[0].VerificationStatus, 'Approved');
assert.strictEqual(sheets.Findings[0].ClosedBy, workflowManager.UserID);

sheets.Findings[0].Status = 'Pending Verification';
sheets.Findings[0].VerificationStatus = 'Pending';
response = context.verifyFinding({
  findingId: 'F-WORKFLOW',
  decision: 'Reject',
  rejectReason: 'Correct the evidence'
}, workflowManager);
assert.strictEqual(response.success, true, response.message);
assert.strictEqual(sheets.Findings[0].Status, 'Rejected');
assert.strictEqual(sheets.Findings[0].VerificationStatus, 'Rejected');
assert.strictEqual(sheets.Findings[0].RejectReason, 'Correct the evidence');
assert.strictEqual(sheets.Findings[0].RejectedBy, workflowManager.UserID);
assert.strictEqual(sheets.Findings[0].CloseRemark, 'Verified and complete');
assert.strictEqual(sheets.Findings[0].ActionRemark, '');
assert(
  sheets.ActionLogs.some(log => log.NewStatus === 'Rejected' && log.Remark === 'Correct the evidence'),
  'Reject reason must remain in the action log'
);

setPermissions('Leader', ['findings.view.assigned', 'findings.update.assigned']);
response = context.submitFinding({
  findingId: 'F-WORKFLOW',
  rootCause: 'Revised root cause',
  correctiveAction: 'Revised correction',
  actionRemark: 'Updated evidence after rejection'
}, workflowLeader);
assert.strictEqual(response.success, true, response.message);
assert.strictEqual(sheets.Findings[0].ActionRemark, 'Updated evidence after rejection');
assert.strictEqual(sheets.Findings[0].RejectReason, '');
assert.strictEqual(sheets.Findings[0].RejectedBy, '');
assert.strictEqual(sheets.Findings[0].RejectedAt, '');
assert(
  sheets.ActionLogs.some(log => log.OldStatus === 'Rejected' && log.NewStatus === 'Pending Verification'),
  'Resubmission after rejection must remain in the action log'
);

const setupSource = fs.readFileSync('apps-script/Setup.gs', 'utf8');
const leaderDefaults = setupSource.match(/Leader:\s*\[([^\]]*)\]/);
assert(leaderDefaults, 'Leader default permissions must be defined');
assert(!leaderDefaults[1].includes('findings.close.minor'), 'Leader must not receive findings.close.minor by default');

const codeSource = fs.readFileSync('apps-script/Code.gs', 'utf8');
['updateFinding', 'submitFinding', 'verifyFinding', 'closeFinding'].forEach(action => {
  assert(codeSource.includes(`${action}: function (user)`), `Code.gs must route ${action}`);
});

const configSource = fs.readFileSync('apps-script/Config.gs', 'utf8');
assert(configSource.includes("'ActionRemark'"), 'Findings schema must include ActionRemark');

console.log('Finding visibility authorization tests passed.');
