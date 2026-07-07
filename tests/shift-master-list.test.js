const assert = require('assert');
const fs = require('fs');

const config = fs.readFileSync('apps-script/Config.gs', 'utf8');
const setup = fs.readFileSync('apps-script/Setup.gs', 'utf8');
const masterData = fs.readFileSync('apps-script/MasterData.gs', 'utf8');
const masterLists = fs.readFileSync('apps-script/MasterLists.gs', 'utf8');
const audit = fs.readFileSync('apps-script/Audit.gs', 'utf8');
const code = fs.readFileSync('apps-script/Code.gs', 'utf8');
const rbac = fs.readFileSync('apps-script/RBAC.gs', 'utf8');
const frontend = fs.readFileSync('frontend/app.js', 'utf8');
const docs = fs.readFileSync('docs/app.js', 'utf8');
const html = fs.readFileSync('frontend/index.html', 'utf8');
const docsHtml = fs.readFileSync('docs/index.html', 'utf8');

assert(config.includes("['ListType', 'ListValue', 'DisplayText', 'SortOrder', 'ActiveStatus']"));
assert(setup.includes('function ensureDefaultShiftLists_'));
assert(setup.includes('LPA_SHIFT_DEFAULTS_INITIALIZED'));
assert(setup.includes("{ ListValue: 'A', DisplayText: 'A', SortOrder: 1, ActiveStatus: 'Active' }"));
assert(setup.includes("{ ListValue: 'B', DisplayText: 'B', SortOrder: 2, ActiveStatus: 'Active' }"));
assert(setup.includes("{ ListValue: 'Day', DisplayText: 'Day', SortOrder: 3, ActiveStatus: 'Inactive' }"));
assert(masterData.includes('function getActiveListRows_'));
assert(masterData.includes('getMasterDataVersion_()'));
assert(masterLists.includes('function getMasterLists('));
assert(masterLists.includes('function upsertMasterList('));
assert(masterLists.includes('incrementMasterDataVersion_()'));
assert(masterLists.includes('function normalizeMasterListSortOrders_'));
assert(masterLists.includes('function deactivateDuplicateMasterListRows_'));
assert(masterLists.includes('rows.reduce(function (maximum, row)'));
assert(!masterLists.includes('payload.sortOrder'));
assert(code.includes('getMasterLists:'));
assert(code.includes('upsertMasterList:'));
assert(rbac.includes("getMasterLists: ['users.managePermission']"));
assert(audit.includes("if (!shift) throw new Error('กรุณาเลือก Shift')"));
assert(audit.includes("valuesEqual_(row.ListType, 'Shift')"), 'saveAudit must validate shift against the master list');
assert(audit.includes('Shift ที่เลือกไม่ได้เปิดใช้งาน'));

assert.strictEqual(frontend, docs);
assert.strictEqual(html, docsHtml);
assert(/id="auditShift" required><option value="">เลือก Shift<\/option><\/select>/.test(html));
assert(!html.includes('<option>Day</option><option>Night</option><option>A</option><option>B</option><option>C</option>'));
assert(frontend.includes("populateSelect('#auditShift', shifts, 'ListValue', 'DisplayText', 'เลือก Shift')"));
assert(frontend.includes(".filter(row => String(row.ListType || '').toLowerCase() === 'shift')"));
assert(html.includes('id="shiftManagementPanel"'));
assert(frontend.includes("apiCall('upsertMasterList', payload)"));
assert(!frontend.includes("sortOrder: Number($('#shiftSortOrder')"));
assert(html.includes('id="shiftSortOrder" value="Auto" readonly'));

console.log('Shift master list tests passed.');
