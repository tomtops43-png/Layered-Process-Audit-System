'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const config = fs.readFileSync('apps-script/Config.gs', 'utf8');
const setup = fs.readFileSync('apps-script/Setup.gs', 'utf8');
const routes = fs.readFileSync('apps-script/Code.gs', 'utf8');
const rbac = fs.readFileSync('apps-script/RBAC.gs', 'utf8');
const meeting = fs.readFileSync('apps-script/Meeting.gs', 'utf8');
const quizSource = fs.readFileSync('apps-script/MeetingQuiz.gs', 'utf8');
const frontend = fs.readFileSync('frontend/app.js', 'utf8');
const docs = fs.readFileSync('docs/app.js', 'utf8');
const frontendHtml = fs.readFileSync('frontend/index.html', 'utf8');
const docsHtml = fs.readFileSync('docs/index.html', 'utf8');
const frontendStyle = fs.readFileSync('frontend/style.css', 'utf8');
const docsStyle = fs.readFileSync('docs/style.css', 'utf8');

['MEETING_QUIZZES', 'MEETING_QUIZ_QUESTIONS', 'MEETING_QUIZ_PARTICIPANTS', 'ActiveQuizID'].forEach(value => {
  assert(config.includes(value), `missing quiz storage schema value ${value}`);
});
['QuizID', 'SourceHash', 'RosterStatus', 'ShiftRosterJSON', 'Shift', 'AnswersJSON', 'TokenHash'].forEach(value => {
  assert(config.includes(`'${value}'`), `missing quiz storage field ${value}`);
});
assert(config.includes("'PublicToken'"), 'published quizzes need a QR guest token');
assert(config.includes('GUEST_QUIZ_ACTIONS'), 'API should define the limited QR guest action set');
[
  'getMeetingQuiz', 'getMeetingQuizAdmin', 'generateMeetingQuiz', 'saveMeetingQuizDraft',
  'publishMeetingQuiz', 'lockMeetingQuizRoster', 'excuseMeetingQuizParticipant',
  'registerMeetingQuizParticipant', 'submitMeetingQuiz', 'getMeetingQuizAnswerKey'
].forEach(action => {
  assert(routes.includes(`${action}:`), `missing API route ${action}`);
  assert(rbac.includes(`${action}:`), `missing API permission mapping ${action}`);
});
['Admin', 'Engineer', 'Leader'].forEach(role => {
  const roleLine = setup.split('\n').find(line => line.trim().startsWith(`${role}:`));
  assert(roleLine && roleLine.includes('meeting.quiz.manage'), `${role} should be able to manage quizzes`);
});
assert(meeting.includes('copy.MeetingQuiz = meetingQuizSummaryForPost_(row, user, quizSummaryCache)'));
assert(quizSource.includes('function meetingQuizPostsForDate_(meetingDate)'));
assert(quizSource.includes('function meetingQuizRowsForDate_(meetingDate)'));
assert(quizSource.includes('function meetingQuizShiftSessions_(quiz)'));
assert(quizSource.includes('function meetingQuizSetShiftRoster_(quiz, shift, status, user)'));
assert(quizSource.includes('quiz.SourcePostIDs = JSON.stringify(dailyPosts.map'));
assert(quizSource.includes('function meetingQuizSourceHash_(posts, sourceText)'));
assert(quizSource.includes('วันนี้มีข้อสอบเผยแพร่แล้ว ทำข้อสอบได้วันละ 1 ชุดต่อ Meeting'));
assert(quizSource.includes('สร้างข้อสอบฉบับร่าง 5 ข้อจากทุกหัวข้อของวันนี้แล้ว'));
assert(quizSource.includes('เนื้อหาหัวข้อหรือสไลด์เปลี่ยนหลังสร้างข้อสอบ'));
assert(frontend.includes('กรอกชื่อและนามสกุลก่อนเริ่มทำ 5 ข้อ'));
assert(frontend.includes('data-mtg-quiz-review'));
assert(frontend.includes('data-quiz-language'));
assert(frontend.includes('language: model.language, answers: submitted'));
assert(frontend.includes('เสร็จแล้ว / ให้คนถัดไปทำ'));
assert(frontend.includes('const shownQuizDates = new Set()'), 'board quiz actions should appear once per date');
assert(frontend.includes('จากทุกหัวข้อวันนี้'), 'admin should be told the quiz covers all daily topics');
assert(frontend.includes('ข้อสอบชุดเดียวกันสำหรับทุกกะ'), 'both shifts should be told they share one question set');
assert(frontend.includes('name="shift"'), 'employees must register for a shift');
assert(frontend.includes('openPublicMeetingQuiz(publicToken)'), 'QR links should open the guest exam route');
assert(frontend.includes('data-quiz-global-key'), 'guest results should expose the shared key only after it unlocks');
assert(frontendHtml.includes('id="publicQuizView"'), 'the guest exam needs a page outside login');
assert(frontendHtml.includes('vendor/qrcode.js'), 'QR generation should be bundled locally');
assert(quizSource.includes('function meetingQuizPublicContext_(publicToken)'), 'QR token should resolve only a published quiz');
assert(routes.includes('GUEST_QUIZ_ACTIONS.indexOf(action) !== -1 && cleanString_(payload.publicToken)'), 'only scoped quiz actions should bypass login');
assert(quizSource.includes("RegisteredByUserID: user && user.UserID ? user.UserID : 'QR Guest'"), 'guest registration should not require a user account');
assert.strictEqual(frontend, docs, 'frontend/app.js and docs/app.js must stay synchronized');
assert.strictEqual(frontendHtml, docsHtml, 'frontend/index.html and docs/index.html must stay synchronized');
assert.strictEqual(frontendStyle, docsStyle, 'frontend/style.css and docs/style.css must stay synchronized');

const rows = [
  { QuizID: 'Q1', QuestionNo: 1, QuestionTH: 'ข้อทดสอบหนึ่ง', ChoiceATH: 'ผิด', ChoiceBTH: 'ถูก', ChoiceCTH: 'ผิดอีกข้อ', ChoiceDTH: 'ผิดอีกข้อ', QuestionMY: 'မေးခွန်းတစ်', ChoiceAMY: 'မှား', ChoiceBMY: 'မှန်', ChoiceCMY: 'မှား', ChoiceDMY: 'မှား', CorrectOption: 'B', ExplanationTH: 'เหตุผลภาษาไทย', ExplanationMY: 'အကြောင်းပြချက်' },
  { QuizID: 'Q1', QuestionNo: 2, QuestionTH: 'ข้อทดสอบสอง', ChoiceATH: 'ถูก', ChoiceBTH: 'ผิด', ChoiceCTH: 'ผิดอีกข้อ', ChoiceDTH: 'ผิดอีกข้อ', QuestionMY: 'မေးခွန်းနှစ်', ChoiceAMY: 'မှန်', ChoiceBMY: 'မှား', ChoiceCMY: 'မှား', ChoiceDMY: 'မှား', CorrectOption: 'A', ExplanationTH: 'เหตุผลสอง', ExplanationMY: 'အကြောင်းပြချက်နှစ်' }
];
const context = {
  SHEET_NAMES: { MEETING_QUIZ_QUESTIONS: 'Questions' },
  getRowsAsObjects: table => table === 'Lists' ? [
    { ListType: 'Shift', ListValue: 'A', DisplayText: 'กะ A', SortOrder: 1, ActiveStatus: 'Active' },
    { ListType: 'Shift', ListValue: 'B', DisplayText: 'กะ B', SortOrder: 2, ActiveStatus: 'Active' }
  ] : rows,
  cleanString_: value => value == null ? '' : String(value).trim(),
  toNumber_: value => Number.isNaN(Number(value)) ? 0 : Number(value),
  isActive_: value => String(value || '').toLowerCase() === 'active',
  valuesEqual_: (left, right) => String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase(),
  safeErrorMessage_: error => String(error && error.message || error),
  meetingQuizQuestions_: () => rows,
  jsonResponse: (success, message, data) => ({ success, message, data })
};
vm.createContext(context);
new vm.Script(quizSource).runInContext(context);

context.dateOnly_ = value => String(value || '').slice(0, 10);
const todaysPosts = [
  { PostID: 'TODAY-1', MeetingDate: '2026-10-07', Topic: 'ตรวจ Part No / Model / Label', Detail: 'ตรวจสอบ Part No, Model และ Label ให้ตรงก่อนเริ่มงาน' },
  { PostID: 'TODAY-2', MeetingDate: '2026-10-07', Topic: 'แยกชิ้นงานตาม Model', Detail: 'ห้ามปะปนชิ้นงานต่าง Model และเคลียร์ชิ้นงาน Model ก่อนหน้าให้หมดก่อนเปลี่ยน Model' },
  { PostID: 'TODAY-3', MeetingDate: '2026-10-07', Topic: 'อุปกรณ์ป้องกันส่วนบุคคล', Detail: 'พนักงานและผู้รับเหมาทุกกะต้องสวม Safety Shoes, Earplugs และ Uniform' }
];
const todaysSource = context.meetingQuizSourceText_(todaysPosts);
const todaysPrompt = context.buildMeetingQuizPrompt_(todaysPosts, todaysSource);
assert(todaysPrompt.includes('เพียง 1 ชุด จำนวน 5 ข้อ'), 'today should produce one five-question daily set');
assert(todaysPrompt.includes('ตรวจ Part No / Model / Label'));
assert(todaysPrompt.includes('แยกชิ้นงานตาม Model'));
assert(todaysPrompt.includes('อุปกรณ์ป้องกันส่วนบุคคล'));
assert(todaysPrompt.includes('Safety Shoes, Earplugs และ Uniform'));
assert(todaysPrompt.includes('ครอบคลุมหัวข้อทั้งหมด'), 'daily prompt should cover topics together');
context.SHEET_NAMES.MEETING_POSTS = 'Posts';
context.getRowsAsObjects = table => table === 'Posts' ? todaysPosts : rows;
context.meetingPostCompare_ = () => 0;
assert.strictEqual(context.meetingQuizPostsForDate_('2026-10-07').length, 3, 'daily grouping should include every topic with the same date');
assert.strictEqual(context.meetingQuizPostsForDate_('2026-10-08').length, 0, 'daily grouping should not include topics from other dates');

const dailyQuestionDraft = Array.from({ length: 5 }, (_, index) => ({
  questionTH: `คำถามจาก Meeting วันนี้ข้อ ${index + 1}`,
  choicesTH: ['ตัวเลือก ก', 'ตัวเลือก ข', 'ตัวเลือก ค', 'ตัวเลือก ง'],
  questionMY: `ယနေ့အစည်းအဝေး မေးခွန်း ${index + 1}`,
  choicesMY: ['ရွေးချယ်မှု က', 'ရွေးချယ်မှု ခ', 'ရွေးချယ်မှု ဂ', 'ရွေးချယ်မှု ဃ'],
  correctOption: 'A', explanationTH: 'อธิบายจากเนื้อหาวันนี้', explanationMY: 'ယနေ့အကြောင်းအရာမှ ရှင်းလင်းချက်'
}));
assert.strictEqual(context.normalizeMeetingQuizQuestions_(dailyQuestionDraft).length, 5);

const publicQuestion = context.meetingQuizQuestionForClient_(rows[0]);
assert(!Object.hasOwn(publicQuestion, 'CorrectOption'), 'public exam question must not reveal the answer key');
const schema = context.meetingQuizResponseSchema_();
assert.strictEqual(schema.type, 'object');
assert.strictEqual(schema.properties.questions.items.properties.choicesTH.items.type, 'string');
assert.deepStrictEqual(Array.from(schema.properties.questions.items.properties.correctOption.enum), ['A', 'B', 'C', 'D']);
let generationRequest;
context.PropertiesService = { getScriptProperties: () => ({ getProperty: key => key === 'GEMINI_API_KEY' ? 'test-key' : '' }) };
context.UrlFetchApp = { fetch: (url, options) => {
  generationRequest = { url, options };
  return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ questions: [] }) }] } }] }) };
} };
context.callMeetingQuizGenerator_('test prompt');
const generationPayload = JSON.parse(generationRequest.options.payload);
assert.strictEqual(generationPayload.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON');
assert.strictEqual(generationPayload.generationConfig.responseFormat.text.schema.type, 'object');
assert(!generationRequest.url.includes('test-key'), 'API key must not appear in the request URL');
assert.strictEqual(generationRequest.options.headers['x-goog-api-key'], 'test-key');
const personalReview = context.meetingQuizReview_('Q1', JSON.stringify({ '1': 'A', '2': 'A' }), 'TH');
assert.strictEqual(personalReview.score, 1);
assert.strictEqual(personalReview.total, 2);
assert.strictEqual(personalReview.questions[0].SelectedText, 'ผิด');
assert.strictEqual(personalReview.questions[0].CorrectText, 'ถูก');
assert.strictEqual(personalReview.questions[0].Explanation, 'เหตุผลภาษาไทย');

let participants = [];
context.SHEET_NAMES.LISTS = 'Lists';
context.meetingQuizParticipants_ = (quizId, shift) => participants.filter(row => !shift || row.Shift === shift);
const roster = { QuizID: 'Q1', ShiftRosterJSON: JSON.stringify({ A: 'Locked', B: 'Open' }) };
participants = [{ Shift: 'A', ParticipantStatus: 'Submitted' }, { Shift: 'B', ParticipantStatus: 'Submitted' }];
const shiftSessions = context.meetingQuizShiftSessions_(roster);
assert.deepStrictEqual(Array.from(shiftSessions, session => [session.shift, session.participantCount, session.submittedCount]), [['A', 1, 1], ['B', 1, 1]]);
assert.strictEqual(context.meetingQuizAllSubmitted_(roster), false, 'one shift still open must keep the shared key locked');
roster.ShiftRosterJSON = JSON.stringify({ A: 'Locked', B: 'Locked' });
participants = [];
assert.strictEqual(context.meetingQuizAllSubmitted_(roster), false, 'an empty two-shift roster must not reveal the answer key');
participants = [{ Shift: 'A', ParticipantStatus: 'Submitted' }, { Shift: 'B', ParticipantStatus: 'Registered' }];
assert.strictEqual(context.meetingQuizAllSubmitted_(roster), false, 'an incomplete participant in either shift must keep the key locked');
participants[1].ParticipantStatus = 'Submitted';
assert.strictEqual(context.meetingQuizAllSubmitted_(roster), true, 'the same question set can unlock after both shift rosters close and submit');

let allSubmitted = false;
context.meetingQuizPost_ = () => ({ PostID: 'P1' });
context.meetingQuizForPost_ = () => ({ QuizID: 'Q1' });
context.meetingQuizAllSubmitted_ = () => allSubmitted;
context.meetingQuizQuestionForReview_ = row => ({ QuestionNo: row.QuestionNo, CorrectOption: row.CorrectOption });
let answerKey = context.getMeetingQuizAnswerKey({ postId: 'P1' }, {});
assert.strictEqual(answerKey.success, false, 'shared answer key must stay locked before everyone submits');
allSubmitted = true;
answerKey = context.getMeetingQuizAnswerKey({ postId: 'P1' }, {});
assert.strictEqual(answerKey.success, true);
assert.strictEqual(answerKey.data.questions.length, rows.length);

context.ensureMeetingQuizSheets_ = () => {};
context.SHEET_NAMES.MEETING_QUIZZES = 'Quizzes';
context.SHEET_NAMES.MEETING_POSTS = 'Posts';
const publishedQuiz = { QuizID: 'Q-QR', PostID: 'P-QR', Status: 'Published', PublicToken: 'secret-daily-quiz-token', MeetingDate: '2026-10-07' };
context.getRowsAsObjects = table => table === 'Quizzes' ? [publishedQuiz] : [];
context.findById_ = (table, field, value) => table === 'Posts' && value === 'P-QR' ? { PostID: 'P-QR', MeetingDate: '2026-10-07' } : null;
const qrContext = context.meetingQuizPublicContext_('secret-daily-quiz-token');
assert.strictEqual(qrContext.quiz.QuizID, 'Q-QR', 'valid QR token should resolve its published quiz');
assert.strictEqual(qrContext.isPublic, true);
assert.throws(() => context.meetingQuizPublicContext_('wrong-token'), /ไม่พบข้อสอบ/);

let summaryEnsureCalls = 0, summaryQuizLookups = 0, summaryPostCounts = 0, summarySessionReads = 0;
const summaryContext = {
  SHEET_NAMES: { MEETING_QUIZZES: 'Quizzes', MEETING_POSTS: 'Posts' },
  cleanString_: value => value == null ? '' : String(value).trim(),
  dateOnly_: value => String(value || '').slice(0, 10),
  hasPermission_: () => true,
  canSeeMeetingPost_: () => true,
  ensureMeetingQuizSheets_: () => { summaryEnsureCalls++; },
  meetingQuizForPost_: () => { summaryQuizLookups++; return null; },
  getRowsAsObjects: () => [{ MeetingDate: '2026-10-07', Status: 'Draft' }],
  valuesEqual_: (left, right) => String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase(),
  meetingQuizPostsForDate_: () => { summaryPostCounts++; return [{}, {}, {}]; },
  toNumber_: value => Number(value) || 0,
  meetingQuizShiftSessions_: () => { summarySessionReads++; return []; },
  meetingQuizAllSubmitted_: (quiz, sessions) => { assert.strictEqual(sessions.length, 2); return false; }
};
vm.createContext(summaryContext);
new vm.Script(quizSource).runInContext(summaryContext);
summaryContext.ensureMeetingQuizSheets_ = () => { summaryEnsureCalls++; };
summaryContext.meetingQuizForPost_ = () => { summaryQuizLookups++; return null; };
summaryContext.meetingQuizPostsForDate_ = () => { summaryPostCounts++; return [{}, {}, {}]; };
summaryContext.meetingQuizShiftSessions_ = () => { summarySessionReads++; return [{}, {}]; };
summaryContext.meetingQuizAllSubmitted_ = (quiz, sessions) => { assert.strictEqual(sessions.length, 2); return false; };
const summaryCache = { sheetsReady: false, byDate: {} };
const summaryA = summaryContext.meetingQuizSummaryForPost_({ MeetingDate: '2026-10-07' }, {}, summaryCache);
const summaryB = summaryContext.meetingQuizSummaryForPost_({ MeetingDate: '2026-10-07' }, {}, summaryCache);
assert.strictEqual(summaryA.sourcePostCount, 3);
assert.deepStrictEqual(summaryB, summaryA);
assert.strictEqual(summaryEnsureCalls, 1, 'quiz sheet headers should be checked once per Meeting request');
assert.strictEqual(summaryQuizLookups, 1, 'daily quiz summary should be calculated once for posts on the same date');
assert.strictEqual(summaryPostCounts, 1, 'source topics should be counted once per date');

let insertedParticipant;
context.SHEET_NAMES.MEETING_QUIZ_PARTICIPANTS = 'Participants';
context.meetingQuizRequestContext_ = () => ({ quiz: { QuizID: 'Q-QR', PostID: 'P-QR' }, post: { PostID: 'P-QR' }, isPublic: true });
context.meetingQuizFindParticipant_ = () => null;
context.meetingQuizNormalizeShift_ = () => 'A';
context.meetingQuizShiftSessions_ = () => [{ shift: 'A', rosterStatus: 'Open' }];
context.meetingQuizQuestions_ = () => rows;
context.newMeetingQuizToken_ = () => 'employee-answer-token';
context.hashMeetingQuizToken_ = () => 'hashed-employee-token';
context.generateId = () => 'MQP-TEST';
context.getPeriodMonth = () => '202610';
context.formatDateTimeBangkok = () => '2026-10-07 08:00:00';
context.appendObject = (table, participant) => { assert.strictEqual(table, 'Participants'); insertedParticipant = participant; };
context.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
const guestRegistration = context.registerMeetingQuizParticipant({
  publicToken: 'secret-daily-quiz-token', firstName: 'Test', lastName: 'Employee', shift: 'A', language: 'TH'
}, null);
assert.strictEqual(guestRegistration.success, true, 'QR guest should be able to register without an account');
assert.strictEqual(insertedParticipant.RegisteredByUserID, 'QR Guest');
assert.strictEqual(guestRegistration.data.participantToken, 'employee-answer-token');
context.meetingQuizFindParticipant_ = (quizId, token) => quizId === 'Q-QR' && token === 'employee-answer-token' ? insertedParticipant : null;
context.meetingQuizAllSubmitted_ = () => false;
let submittedAnswers;
context.updateObjectById = (table, field, id, update) => { submittedAnswers = update; };
const guestSubmission = context.submitMeetingQuiz({
  publicToken: 'secret-daily-quiz-token', quizId: 'Q-QR', participantToken: 'employee-answer-token', language: 'TH',
  answers: [{ questionNo: 1, choice: 'B' }, { questionNo: 2, choice: 'B' }]
}, null);
assert.strictEqual(guestSubmission.success, true, `QR guest should be able to submit without an account: ${guestSubmission.message}`);
assert.strictEqual(submittedAnswers.ParticipantStatus, 'Submitted');
assert.strictEqual(guestSubmission.data.review.score, 1, 'guest submission should return an immediate personal review');
assert.strictEqual(guestSubmission.data.review.questions[1].CorrectOption, 'A');

const routedGuestCalls = [];
const routerContext = {
  GUEST_QUIZ_ACTIONS: ['getMeetingQuiz', 'registerMeetingQuizParticipant', 'submitMeetingQuiz', 'getMeetingQuizAnswerKey'],
  PUBLIC_ACTIONS: ['login'],
  cleanString_: value => value == null ? '' : String(value).trim(),
  jsonResponse: (success, message, data) => ({ success, message, data }),
  safeErrorMessage_: error => String(error && error.message || error),
  getCurrentUserFromRequest_: () => { throw new Error('login required'); },
  console: { error: () => {} }
};
vm.createContext(routerContext);
new vm.Script(routes).runInContext(routerContext);
routerContext.buildApiHandlers_ = () => ({
  getMeetingQuiz: user => { routedGuestCalls.push(user); return { success: true, message: 'ok', data: {} }; },
  getMeetingQuizAdmin: () => ({ success: true, message: 'unexpected', data: {} })
});
const guestResponse = routerContext.doPost({ postData: { contents: JSON.stringify({ action: 'getMeetingQuiz', payload: { publicToken: 'secret-daily-quiz-token' } }) } });
assert.strictEqual(guestResponse.success, true, 'a scoped QR request should reach the quiz handler without login');
assert.strictEqual(routedGuestCalls[0], null, 'the guest handler should receive a null user');
const tokenlessResponse = routerContext.doPost({ postData: { contents: JSON.stringify({ action: 'getMeetingQuiz', payload: {} }) } });
assert.strictEqual(tokenlessResponse.success, false, 'quiz API requests without login or a public token should fail');
const adminGuestResponse = routerContext.doPost({ postData: { contents: JSON.stringify({ action: 'getMeetingQuizAdmin', payload: { publicToken: 'secret-daily-quiz-token' } }) } });
assert.strictEqual(adminGuestResponse.success, false, 'a quiz QR must not grant quiz-management access');

const qrFactory = require('../frontend/vendor/qrcode.js');
const qr = qrFactory(0, 'M');
qr.addData('https://tomtops43-png.github.io/Layered-Process-Audit-System/?quiz=' + 'abc123'.repeat(10));
qr.make();
assert(qr.createSvgTag(5, 4).startsWith('<svg'), 'bundled QR generator should create a scannable SVG payload');

console.log('Meeting quiz feature tests passed.');
