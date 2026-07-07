'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('apps-script/RBAC.gs', 'utf8');
const rowsByUser = {
  VIEWER: [{ UserID: 'VIEWER', LineID: 'L1', AccessLevel: 'View', ActiveStatus: 'Active' }],
  AUDITOR: [{ UserID: 'AUDITOR', LineID: 'L1', AccessLevel: 'Audit', ActiveStatus: 'Active' }],
  MANAGER: [{ UserID: 'MANAGER', LineID: 'L1', AccessLevel: 'Manage', ActiveStatus: 'Active' }],
  ALL: [{ UserID: 'ALL', LineID: 'L1', AccessLevel: 'All', ActiveStatus: 'Active' }]
};

const context = {
  SHEET_NAMES: { USER_LINE_ACCESS: 'UserLineAccess' },
  cleanString_: value => String(value == null ? '' : value).trim(),
  valuesEqual_: (left, right) => String(left).toLowerCase() === String(right).toLowerCase(),
  getRowsAsObjects: () => Object.keys(rowsByUser).reduce((rows, key) => rows.concat(rowsByUser[key]), []),
  safeErrorMessage_: error => error.message,
  isActive_: value => String(value).toLowerCase() === 'active',
  sanitizeForClient_: row => ({ ...row }),
  safeCacheGetJson_: () => null,
  safeCachePutJson_: () => false,
  safeCacheRemove_: () => {},
  getCachedUserLineAccessRows_: () => Object.keys(rowsByUser).reduce((rows, key) => rows.concat(rowsByUser[key]), [])
};
vm.createContext(context);
vm.runInContext(source, context);

assert.strictEqual(context.canAccessLine_({ UserID: 'VIEWER' }, 'L1', 'View'), true);
assert.strictEqual(context.canAccessLine_({ UserID: 'VIEWER' }, 'L1', 'Audit'), false);
assert.strictEqual(context.canAccessLine_({ UserID: 'AUDITOR' }, 'L1', 'Audit'), true);
assert.strictEqual(context.canAccessLine_({ UserID: 'MANAGER' }, 'L1', 'Audit'), true);
assert.strictEqual(context.canAccessLine_({ UserID: 'ALL' }, 'L1', 'Audit'), true);
assert.strictEqual(context.canAccessLine_({ UserID: 'AUDITOR' }, 'L1', 'Manage'), false);

console.log('Line access level tests passed.');
