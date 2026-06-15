const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('apps-script/AuditPlan.gs', 'utf8');
const context = {
  cleanString_: value => value == null ? '' : String(value).trim()
};
vm.createContext(context);
vm.runInContext(source, context);

assert.deepStrictEqual(Array.from(context.getAuditPlanGenerationRoles_({ Role: 'Admin' })), ['Leader', 'Supervisor', 'Manager']);
assert.deepStrictEqual(Array.from(context.getAuditPlanGenerationRoles_({ Role: 'Manager' })), ['Leader', 'Supervisor', 'Manager']);
assert.deepStrictEqual(Array.from(context.getAuditPlanGenerationRoles_({ Role: 'Supervisor' })), ['Leader', 'Supervisor']);
assert.throws(() => context.getAuditPlanGenerationRoles_({ Role: 'Leader' }), /ไม่มีสิทธิ์สร้างแผน/);

assert(source.includes("payload.requiredRole || payload.role"));
assert(source.includes('roleScope: selectedRoles'));
assert(source.includes("canAccessLineFromRows_(currentUser, row.LineID, 'View', lineAccess)"));

const setup = fs.readFileSync('apps-script/Setup.gs', 'utf8');
assert(/Supervisor:[^\n]*'audit\.plan\.generate'/.test(setup));

const frontend = fs.readFileSync('frontend/app.js', 'utf8');
const docs = fs.readFileSync('docs/app.js', 'utf8');
assert.strictEqual(frontend, docs);
assert(frontend.includes('function applyAuditPlanRoleScope()'));
assert(frontend.includes("supervisor: ['', 'Leader', 'Supervisor']"));
assert(frontend.includes("leader: ['Leader']"));
assert(frontend.includes("requiredRole: optionalFilterValue($('#planRole').value)"));
assert(frontend.includes("roleSelect.value = 'Leader'"));
assert(frontend.includes("apiCall('getAuditPlanRules'"));

console.log('Audit Plan role scope tests passed.');
