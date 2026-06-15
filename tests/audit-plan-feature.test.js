'use strict';

const assert = require('assert');
const fs = require('fs');

const config = fs.readFileSync('apps-script/Config.gs', 'utf8');
const setup = fs.readFileSync('apps-script/Setup.gs', 'utf8');
const routes = fs.readFileSync('apps-script/Code.gs', 'utf8');
const rbac = fs.readFileSync('apps-script/RBAC.gs', 'utf8');
const plan = fs.readFileSync('apps-script/AuditPlan.gs', 'utf8');
const audit = fs.readFileSync('apps-script/Audit.gs', 'utf8');
const dashboard = fs.readFileSync('apps-script/Dashboard.gs', 'utf8');
const report = fs.readFileSync('apps-script/Reports.gs', 'utf8');
const frontend = fs.readFileSync('frontend/app.js', 'utf8');
const docs = fs.readFileSync('docs/app.js', 'utf8');

[
  'PlanID', 'PeriodType', 'PeriodKey', 'DueDate', 'DueTime', 'RequiredRole',
  'RequiredUserID', 'LineID', 'StationID', 'AuditLayer', 'Frequency', 'Status',
  'CompletedAuditID', 'SubmittedAt', 'IsLate', 'LateReason'
].forEach(header => assert(config.includes(`'${header}'`), `missing AuditPlan header ${header}`));

['SubmittedAt', 'IsLate', 'LateReason', 'PlanID', 'PlanStatus'].forEach(header => {
  assert(config.includes(`'${header}'`), `missing AuditSessions header ${header}`);
});

['getAuditPlan', 'generateAuditPlan', 'refreshAuditPlanStatus', 'getMyAuditPlanSummary'].forEach(action => {
  assert(routes.includes(`${action}:`), `missing route ${action}`);
  assert(rbac.includes(`${action}:`), `missing API permission mapping ${action}`);
  assert(plan.includes(`function ${action}(`), `missing backend function ${action}`);
});

['audit.plan.view', 'audit.plan.manage', 'audit.plan.generate', 'audit.plan.refresh'].forEach(permission => {
  assert(setup.includes(permission), `missing default permission ${permission}`);
});

assert(plan.includes('planDuplicateKey_'));
assert(plan.includes("DueTime: '17:00'"));
assert(plan.includes('function effectiveAuditPlan_('));
assert(plan.includes('getRowsAsObjects(SHEET_NAMES.AUDIT_PLAN).map(function (row)'));
assert(audit.includes('คุณกำลังบันทึก Audit ย้อนหลัง กรุณาระบุเหตุผล'));
assert(audit.includes("requireLineAccess_(currentUser, payload.lineId, 'Audit')"));
assert(audit.includes('completeAuditPlan_'));
assert(dashboard.includes('AuditPlanSummary'));
assert(dashboard.includes('effectiveAuditPlan_(row, audits, now)'));
assert(report.includes('PlannedAuditCount'));
assert(report.includes("slice(0, 7).replace('-', '') === period"));
assert(report.includes('effectiveAuditPlan_(row, allAuditSessions, reportNow)'));
assert(frontend.includes('Loading Audit Plan'));
assert(frontend.includes('Generating Audit Plan'));
assert(frontend.includes('Refreshing Audit Plan'));
assert(frontend.includes('startAuditFromPlan'));
assert.strictEqual(frontend, docs, 'frontend/app.js and docs/app.js must stay synchronized');

console.log('Audit plan feature tests passed.');
