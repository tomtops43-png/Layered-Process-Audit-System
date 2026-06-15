const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const sheets = {
  Findings: [],
  RolePermissions: [],
  UserPermissions: [],
  UserLineAccess: []
};

const context = {
  console,
  SHEET_NAMES: {
    FINDINGS: 'Findings',
    ROLE_PERMISSIONS: 'RolePermissions',
    USER_PERMISSIONS: 'UserPermissions',
    USER_LINE_ACCESS: 'UserLineAccess'
  },
  getRowsAsObjects: name => (sheets[name] || []).map(row => ({ ...row })),
  getDefaultRolePermissions_: () => ({}),
  cleanString_: value => value === null || value === undefined ? '' : String(value).trim(),
  valuesEqual_: (left, right) => String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase(),
  isActive_: value => String(value || '').trim().toLowerCase() === 'active',
  sanitizeForClient_: value => value,
  calculateOverdue: () => ({ OverdueFlag: 'No', DaysOverdue: 0 }),
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
assert.deepStrictEqual(visibleIds(user, { myFindings: 'verification' }), ['pending-verification']);

console.log('Finding visibility authorization tests passed.');
