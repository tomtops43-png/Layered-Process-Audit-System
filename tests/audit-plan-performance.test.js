const assert = require('assert');
const fs = require('fs');

const frontend = fs.readFileSync('frontend/app.js', 'utf8');
const docs = fs.readFileSync('docs/app.js', 'utf8');
const dashboard = fs.readFileSync('apps-script/Dashboard.gs', 'utf8');
const plan = fs.readFileSync('apps-script/AuditPlan.gs', 'utf8');
const masterData = fs.readFileSync('apps-script/MasterData.gs', 'utf8');
const audit = fs.readFileSync('apps-script/Audit.gs', 'utf8');

assert.strictEqual(frontend, docs);
assert(frontend.includes('await initializeAuthenticatedApp(false);'));
assert(frontend.includes('async function ensureMasterDataLoaded'));
assert(frontend.includes("if (['audit', 'audit-plan', 'findings', 'checklist', 'admin'].includes(page))"));
assert(frontend.includes('page: 1, pageSize: 100'));
assert(frontend.includes("await navigateTo('audit');"));

assert(dashboard.includes('safeCacheGetJson_(cacheKey)'));
assert(dashboard.includes('safeCachePutJson_(cacheKey, summary, 60)'));
assert(dashboard.includes('summarizeAuditPlanRows_'));
assert(!dashboard.includes('refreshAuditPlanStatus('));

assert(plan.includes("normalizePlanMonth_(payload.periodMonth) || formatDateBangkok_(new Date()).slice(0, 7)"));
assert(plan.includes('pageSize = Math.min'));
assert(plan.includes('function summarizeAuditPlanRows_'));
assert(plan.includes('safeCachePutJson_(cacheKey, summary, 60)'));
assert(masterData.includes('safeCachePutJson_(cacheKey, result, 300)'));
assert(audit.includes('completeAuditPlan_(matchingPlan'));
assert(audit.includes('invalidateDashboardCachesForUser_(currentUser)'));

console.log('Audit Plan performance tests passed.');
