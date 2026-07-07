'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const config = fs.readFileSync('apps-script/Config.gs', 'utf8');
const schedule = fs.readFileSync('apps-script/ScheduleRules.gs', 'utf8');
const setup = fs.readFileSync('apps-script/Setup.gs', 'utf8');
const dashboard = fs.readFileSync('apps-script/Dashboard.gs', 'utf8');
const code = fs.readFileSync('apps-script/Code.gs', 'utf8');
const rbac = fs.readFileSync('apps-script/RBAC.gs', 'utf8');
const html = fs.readFileSync('frontend/index.html', 'utf8');
const docsHtml = fs.readFileSync('docs/index.html', 'utf8');
const frontend = fs.readFileSync('frontend/app.js', 'utf8');
const docs = fs.readFileSync('docs/app.js', 'utf8');

assert(config.includes("AUDIT_PLAN_RULES: 'AuditPlanRules'"));
[
  'RuleID', 'AssignmentMode', 'RequiredRole', 'RequiredUserID', 'RequiredUserName', 'LineID', 'LineName',
  'StationID', 'StationName', 'Frequency', 'DayOfWeek', 'DayOfMonth', 'DueTime',
  'ActiveStatus', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'
].forEach(header => assert(config.includes(`'${header}'`), `missing AuditPlanRules header ${header}`));
assert(setup.includes('SHEET_HEADERS[SHEET_NAMES.AUDIT_PLAN_RULES] = AUDIT_PLAN_RULE_HEADERS_.slice()'));
assert(schedule.includes('AuditPlanRules sheet is not set up. Run setupHeaders()'));

['getAuditPlanRules', 'upsertAuditPlanRule'].forEach(action => {
  assert(code.includes(`${action}:`), `missing route ${action}`);
  assert(rbac.includes(`${action}:`), `missing permission mapping ${action}`);
  assert(schedule.includes(`function ${action}(`), `missing function ${action}`);
});

assert(schedule.includes('getRuleBasedAuditSummary_'));
assert(schedule.includes('safeCachePutJson_(cacheKey, summary, 60)'));
assert(schedule.includes('auditSatisfiesRulePeriod_'));
assert(schedule.includes('ruleExpectedDatesInMonth_'));
assert(dashboard.includes('try {'));
assert(dashboard.includes('getRuleBasedAuditSummary_'));
assert(dashboard.includes('Rule-based schedule summary skipped'));
assert(!dashboard.includes('SHEET_NAMES.AUDIT_PLAN'));
assert(html.includes('LPA SCHEDULE / AUDIT RULES'));
assert(html.includes('id="auditRuleForm"'));
assert(frontend.includes("apiCall('getAuditPlanRules'"));
assert(frontend.includes("apiCall('upsertAuditPlanRule'"));
assert(frontend.includes('limit: 300'));
assert(!frontend.includes("apiCall('generateAuditPlan'"));
assert(frontend.includes("['My Due Today', ruleSummary.DueToday"));
assert(frontend.includes('<option value="ALL">ทั้งหมด</option>'));
assert(frontend.includes('ระบบจะสร้างกฎสำหรับ Station ที่ Active ทั้งหมดใน'));
assert(schedule.includes("valuesEqual_(stationSelection, 'ALL')"));
assert(schedule.includes('skippedDuplicateCount'));
assert.strictEqual(frontend, docs);
assert.strictEqual(html, docsHtml);

const context = {
  cleanString_: value => value == null ? '' : String(value).trim(),
  valuesEqual_: (left, right) => String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase(),
  formatDateBangkok_: value => {
    const date = value instanceof Date ? value : new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  },
  parseDate_: value => new Date(`${String(value).slice(0, 10)}T00:00:00`),
  dateOnly_: value => String(value == null ? '' : value).slice(0, 10),
  isoWeekKey_: date => {
    const d = new Date(date);
    const start = new Date(d.getFullYear(), 0, 1);
    return `${d.getFullYear()}-W${String(Math.ceil((((d - start) / 86400000) + start.getDay() + 1) / 7)).padStart(2, '0')}`;
  },
  toNumber_: value => Number(value) || 0
};
vm.createContext(context);
vm.runInContext(schedule, context);

const dailyRule = { RequiredRole: 'Leader', LineID: 'ENC5', StationID: 'ST1', Frequency: 'Daily' };
assert.strictEqual(context.auditSatisfiesRulePeriod_({
  AuditDate: '2026-06-15', LineID: 'ENC5', StationID: 'ST1',
  AuditLayer: 'Leader', AuditorRole: 'Leader', AuditorUserID: 'USER001'
}, dailyRule, '2026-06-15'), true);
assert.strictEqual(context.auditSatisfiesRulePeriod_({
  AuditDate: '2026-06-15', LineID: 'ENC5', StationID: 'ST2', AuditLayer: 'Leader'
}, dailyRule, '2026-06-15'), false);

const monthlyDates = context.ruleExpectedDatesInMonth_(
  { Frequency: 'Monthly', DayOfMonth: 31 }, new Date(2026, 1, 15)
);
assert.deepStrictEqual(Array.from(monthlyDates), ['2026-02-28']);

console.log('Audit schedule rule tests passed.');
