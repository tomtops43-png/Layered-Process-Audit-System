'use strict';

const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('frontend/app.js', 'utf8');
const docsApp = fs.readFileSync('docs/app.js', 'utf8');
const html = fs.readFileSync('frontend/index.html', 'utf8');
const docsHtml = fs.readFileSync('docs/index.html', 'utf8');

assert(html.includes('<select id="auditRuleStation"'));
assert(html.includes('<option value="ALL" selected>ALL</option>'));
assert(/app\.js\?v=\d{8}/.test(html), 'app.js script tag must keep a cache-busting version');
assert(app.includes("$('#auditRuleLine').addEventListener('change', handleAuditRuleLineChange)"));
assert(app.includes('function handleAuditRuleLineChange()'));
assert(app.includes("populateAuditRuleStationSelect($('#auditRuleLine').value"));
assert(app.includes("const allOption = allowAll && lineId ? '<option value=\"ALL\">ทั้งหมด</option>' : '';"));
assert(app.includes('ระบบจะสร้างกฎสำหรับ Station ที่ Active ทั้งหมดใน'));
assert(app.includes('สร้างกฎใหม่ ${result.createdCount || 0} รายการ / ข้ามกฎซ้ำ ${result.skippedDuplicateCount || 0} รายการ'));
assert.strictEqual(app, docsApp);
assert.strictEqual(html, docsHtml);

console.log('Audit rule All Stations UI tests passed.');
