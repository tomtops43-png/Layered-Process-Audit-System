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
const masterData = fs.readFileSync('apps-script/MasterData.gs', 'utf8');
const utils = fs.readFileSync('apps-script/Utils.gs', 'utf8');
const frontend = fs.readFileSync('frontend/app.js', 'utf8');
const docs = fs.readFileSync('docs/app.js', 'utf8');
const frontendHtml = fs.readFileSync('frontend/index.html', 'utf8');
const docsHtml = fs.readFileSync('docs/index.html', 'utf8');
const frontendStyle = fs.readFileSync('frontend/style.css', 'utf8');
const docsStyle = fs.readFileSync('docs/style.css', 'utf8');

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
assert(plan.includes('getRowsAsObjects(SHEET_NAMES.AUDIT_PLAN).filter(function (row)'));
assert(audit.includes('คุณกำลังบันทึก Audit ย้อนหลัง กรุณาระบุเหตุผล'));
assert(audit.includes("requireLineAccess_(currentUser, payload.lineId, 'Audit')"));
assert(audit.includes('completeAuditPlan_'));
assert(dashboard.includes('AuditPlanSummary'));
assert(dashboard.includes('summarizeAuditPlanRows_'));
assert(report.includes('PlannedAuditCount'));
assert(report.includes("slice(0, 7).replace('-', '') === period"));
assert(report.includes('effectiveAuditPlan_(row, allAuditSessions, reportNow, auditPlanIndex)'));
assert(plan.includes('pageSize = Math.min'));
assert(plan.includes("normalizePlanMonth_(payload.periodMonth) || formatDateBangkok_"));
assert(plan.includes('safeCacheGetJson_'));
assert(plan.includes('auditPlanSummaryCacheKey_'));
assert(plan.includes('buildAuditPlanMatchIndex_'));
assert(dashboard.includes('dashboardCacheKey_'));
assert(dashboard.includes('safeCachePutJson_(cacheKey, result, 60)'));
assert(plan.includes("cleanString_(plan.DueDate).slice(0, 7) !== month"));
assert(masterData.includes('safeCachePutJson_(cacheKey, result, 300)'));
assert(masterData.includes('var settingRows = getRowsAsObjects(SHEET_NAMES.SETTINGS)'));
assert(utils.includes('function safeCacheGetJson_('));
assert(utils.includes('function safeCachePutJson_('));
assert(frontend.includes('กำลังโหลดแผนการตรวจ...'));
assert(frontend.includes('กำลังสร้างแผนการตรวจ...'));
assert(frontend.includes('กำลังอัปเดตสถานะแผน...'));
assert(frontend.includes('กำลังโหลดแผนเข้าสู่ฟอร์มตรวจ...'));
assert(frontend.includes('startAuditFromPlan'));
assert(frontend.includes('renderAuditPlanSummary'));
assert(frontend.includes('ensureMasterDataLoaded'));
assert(frontend.includes('showDashboardSkeleton'));
assert(!frontend.includes('await loadMasterData(false);'));
assert(frontend.includes('await initializeAuthenticatedApp(false);'));
assert(frontend.includes('คุณไม่มีสิทธิ์เริ่มตรวจ Audit Layer นี้'));
assert(frontend.includes('คุณกำลังสร้างแผนสำหรับทุก Line/Station'));
assert(frontendHtml.includes('ใช้หน้านี้เพื่อดูแผนการตรวจ LPA'));
assert(frontendHtml.includes('data-page="audit-plan" data-permission-any="audit.plan.view"'));
assert(frontendHtml.includes('data-plan-count="Due Today"'));
assert(frontendStyle.includes('.status-plan-completed'));
assert(frontendStyle.includes('.status-plan-missed'));
assert.strictEqual(frontend, docs, 'frontend/app.js and docs/app.js must stay synchronized');
assert.strictEqual(frontendHtml, docsHtml, 'frontend/index.html and docs/index.html must stay synchronized');
assert.strictEqual(frontendStyle, docsStyle, 'frontend/style.css and docs/style.css must stay synchronized');

console.log('Audit plan feature tests passed.');
