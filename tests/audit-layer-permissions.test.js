'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const auditSource = fs.readFileSync('apps-script/Audit.gs', 'utf8');
const frontendSource = fs.readFileSync('frontend/app.js', 'utf8');
const setupSource = fs.readFileSync('apps-script/Setup.gs', 'utf8');

const context = {
  cleanString_: value => String(value == null ? '' : value).trim(),
  requireFields_: (payload, fields) => {
    fields.forEach(field => {
      if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
        throw new Error(`${field} is required`);
      }
    });
  },
  hasPermission_: (user, permission) =>
    user.Role === 'Admin' || (user.permissions || []).includes('*') || (user.permissions || []).includes(permission),
  isAdmin_: user => user.Role === 'Admin',
  requireLineAccess_: () => {
    throw new Error('Line access should not be checked after an unauthorized layer is rejected.');
  },
  jsonResponse: (success, message, data) => ({ success, message, data }),
  safeErrorMessage_: error => error.message
};
vm.createContext(context);
vm.runInContext(auditSource, context);

const leader = {
  UserID: 'U-LEADER',
  Role: 'Leader',
  permissions: ['audit.leader.create']
};
const response = context.saveAudit({
  auditDate: '2026-06-15',
  lineId: 'LINE-1',
  stationId: 'ST-1',
  auditLayer: 'Manager',
  records: []
}, leader);
assert.strictEqual(response.success, false);
assert.strictEqual(response.message, 'คุณไม่มีสิทธิ์สร้าง Audit Layer นี้');

assert(frontendSource.includes("['Leader', 'audit.leader.create']"));
assert(frontendSource.includes("['Engineer', 'audit.engineer.create']"));
assert(frontendSource.includes("['Supervisor', 'audit.supervisor.create']"));
assert(frontendSource.includes("['Manager', 'audit.manager.create']"));
assert(frontendSource.includes('applyAuditLayerPermissions();'));

const leaderDefaults = setupSource.match(/Leader:\s*\[([^\]]*)\]/);
assert(leaderDefaults);
assert(leaderDefaults[1].includes('audit.leader.create'));
assert(!leaderDefaults[1].includes('audit.engineer.create'));
assert(!leaderDefaults[1].includes('audit.supervisor.create'));
assert(!leaderDefaults[1].includes('audit.manager.create'));

console.log('Audit layer permission tests passed.');
