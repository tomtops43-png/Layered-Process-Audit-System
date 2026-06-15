'use strict';

const assert = require('assert');
const fs = require('fs');

const audit = fs.readFileSync('apps-script/Audit.gs', 'utf8');
const config = fs.readFileSync('apps-script/Config.gs', 'utf8');
const utils = fs.readFileSync('apps-script/Utils.gs', 'utf8');
const frontend = fs.readFileSync('frontend/app.js', 'utf8');
const docs = fs.readFileSync('docs/app.js', 'utf8');
const frontendHtml = fs.readFileSync('frontend/index.html', 'utf8');
const docsHtml = fs.readFileSync('docs/index.html', 'utf8');

['AuditKey', 'ClientSubmissionID', 'SubmittedAt', 'PlanID', 'SaveSource'].forEach(header => {
  assert(config.includes(`'${header}'`), `missing AuditSessions header ${header}`);
});

assert(audit.includes('LockService.getScriptLock()'));
assert(audit.includes('saveLock.waitLock(30000)'));
assert(audit.includes('if (saveLockAcquired) saveLock.releaseLock()'));
assert(audit.includes('row.ClientSubmissionID'));
assert(audit.includes('IsDuplicate: true'));
assert(audit.includes('row.PlanID, explicitPlanId'));
assert(audit.includes('row.AuditKey'));
assert(audit.includes('buildAuditKey_('));
assert(audit.includes('แผนการตรวจนี้ถูกบันทึกเรียบร้อยแล้ว ไม่สามารถบันทึกซ้ำได้'));
assert(audit.includes('มีการบันทึก LPA สำหรับ Line / Station / Layer / Shift นี้แล้วในช่วงเวลานี้'));
assert(audit.includes('Duplicate checklist item in audit'));
assert(audit.includes('Duplicate finding for audit checklist item'));
assert(audit.includes('completeAuditPlan_(matchingPlan'));
assert(utils.includes('function generateIdWithoutLock_('));

assert(frontend.includes('auditSaveInProgress'));
assert(frontend.includes('auditClientSubmissionId'));
assert(frontend.includes('createClientSubmissionId()'));
assert(frontend.includes('กำลังบันทึกข้อมูล กรุณารอสักครู่'));
assert(frontend.includes('clientSubmissionId: state.auditClientSubmissionId'));
assert(frontendHtml.includes('id="saveAuditButton"'));
assert.strictEqual(frontend, docs);
assert.strictEqual(frontendHtml, docsHtml);

console.log('Audit save interlock tests passed.');
