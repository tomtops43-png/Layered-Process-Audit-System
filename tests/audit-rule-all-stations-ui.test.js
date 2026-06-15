'use strict';

const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('frontend/app.js', 'utf8');
const docsApp = fs.readFileSync('docs/app.js', 'utf8');
const html = fs.readFileSync('frontend/index.html', 'utf8');
const docsHtml = fs.readFileSync('docs/index.html', 'utf8');

assert(html.includes('<option value="">เลือก Station</option><option value="ALL">ทั้งหมด</option>'));
assert(html.includes('app.js?v=20260615-all-stations'));
assert(app.includes("$('#auditRuleLine').addEventListener('change', handleAuditRuleLineChange)"));
assert(app.includes('function handleAuditRuleLineChange()'));
assert(app.includes("populateAuditRuleStationSelect($('#auditRuleLine').value, true)"));
assert(app.includes("const allOption = allowAll && lineId ? '<option value=\"ALL\">ทั้งหมด</option>' : '';"));
assert(app.includes("window.confirm('ระบบจะสร้างกฎสำหรับ Station ที่ Active ทั้งหมดใน Line นี้ ต้องการดำเนินการต่อหรือไม่?')"));
assert(app.includes('สร้างกฎใหม่ ${result.createdCount || 0} รายการ / ข้ามกฎซ้ำ ${result.skippedDuplicateCount || 0} รายการ'));
assert.strictEqual(app, docsApp);
assert.strictEqual(html, docsHtml);

console.log('Audit rule All Stations UI tests passed.');
