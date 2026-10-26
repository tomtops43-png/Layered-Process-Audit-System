'use strict';

const GASCache = {
  _store: {},
  _ttl: {},
  set(key, data, ttlMinutes = 5) {
    this._store[key] = data;
    this._ttl[key] = Date.now() + ttlMinutes * 60000;
    try { sessionStorage.setItem('gas_' + key, JSON.stringify({ data, expiry: this._ttl[key] })); } catch (_) {}
  },
  get(key) {
    if (this._store[key] && Date.now() < (this._ttl[key] || 0)) return this._store[key];
    try {
      const raw = sessionStorage.getItem('gas_' + key);
      if (raw) {
        const { data, expiry } = JSON.parse(raw);
        if (Date.now() < expiry) { this._store[key] = data; this._ttl[key] = expiry; return data; }
        sessionStorage.removeItem('gas_' + key);
      }
    } catch (_) {}
    return null;
  },
  invalidate(...keys) {
    keys.forEach(k => {
      delete this._store[k]; delete this._ttl[k];
      try { sessionStorage.removeItem('gas_' + k); } catch (_) {}
    });
  },
  invalidatePrefix(prefix) {
    Object.keys(this._store).filter(k => k.startsWith(prefix)).forEach(k => this.invalidate(k));
    try { Object.keys(sessionStorage).filter(k => k.startsWith('gas_' + prefix)).forEach(k => sessionStorage.removeItem(k)); } catch (_) {}
  },
  invalidateAll() {
    this._store = {}; this._ttl = {};
    try { Object.keys(sessionStorage).filter(k => k.startsWith('gas_')).forEach(k => sessionStorage.removeItem(k)); } catch (_) {}
  }
};

async function cachedApiCall(action, payload, cacheKey, ttlMinutes = 5) {
  if (cacheKey) { const hit = GASCache.get(cacheKey); if (hit) return hit; }
  const data = await apiCall(action, payload);
  if (cacheKey) GASCache.set(cacheKey, data, ttlMinutes);
  return data;
}

const state = {
  token: localStorage.getItem('lpa_token') || '',
  user: readStoredJson('lpa_user'),
  masterData: { lines: [], stations: [], users: [], lists: [], settings: {} },
  masterDataLoadedAt: 0,
  masterDataPromise: null,
  checklist: [],
  auditAnswers: {},
  findings: [],
  findingsCache: null,
  dashboard: null,
  auditPlans: [],
  auditRules: [],
  todayAudits: [],
  report: null,
  editingFinding: null,
  meetingPosts: [],
  meetingCarryOver: [],
  trainingRecords: [],
  meetingCanCreate: false,
  meetingCanManage: false,
  meetingCanManageQuiz: false,
  meetingQuizBoardStatusRefreshPromise: null,
  meetingQuizResultPollTimer: null,
  meetingQuizResultRefreshPromise: null,
  meetingTvQuizStatusTimer: null,
  meetingTvIndex: 0,
  meetingPendingAcks: [],
  meetingFindingDigest: null,
  meetingPhotoItems: [],
  editingMeetingPost: null,
  meetingQuizAdmin: null,
  meetingQuizExam: null,
  fiveSBoard: null,
  fiveSSetup: null,
  adminUsers: [],
  adminMasterLists: [],
  editingUser: null,
  auditSaveInProgress: false,
  auditClientSubmissionId: '',
  auditDuplicateBlocked: false,
  auditMode: 'Manual',
  startingPlanAudit: false,
  notificationTimer: null,
  notificationInFlight: false,
  lastNotificationKey: '',
  bootstrapping: false
};

const PERMISSION_CATALOG = [
  'users.view', 'users.create', 'users.update', 'users.deactivate', 'users.resetPassword', 'users.managePermission',
  'audit.manager.create', 'audit.supervisor.create', 'audit.engineer.create', 'audit.leader.create', 'audit.view.all', 'audit.view.line', 'audit.view.own',
  'findings.view.all', 'findings.view.line', 'findings.view.assigned', 'findings.view.created', 'findings.assign',
  'findings.update.line', 'findings.update.assigned', 'findings.verify', 'findings.close.minor',
  'findings.close.major', 'findings.close.critical', 'dashboard.view', 'dashboard.view.all',
  'reports.view', 'reports.export', 'checklist.view', 'checklist.manage',
  'audit.plan.view', 'audit.plan.manage', 'audit.plan.generate', 'audit.plan.refresh',
  'meeting.view', 'meeting.create', 'meeting.update.own', 'meeting.manage', 'meeting.quiz.manage', 'meeting.quiz.generate',
  'fiveS.audit', 'fiveS.view.all', 'fiveS.manage', 'fiveS.checkpoint.manage'
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
function wireCheckboxChips(scope) {
  $$('.checkbox-item', scope).forEach(item => {
    const input = item.querySelector('input[type="checkbox"]');
    if (!input) return;
    const sync = () => item.classList.toggle('checked', input.checked);
    sync();
    input.addEventListener('change', sync);
  });
}
let busyDepth = 0;
const busyMessages = [];

window.addEventListener('DOMContentLoaded', initApp);

function initApp() {
  document.title = CONFIG.APP_NAME;
  bindVisualViewport();
  bindEvents();
  setDefaultDates();
  const publicQuizToken = new URLSearchParams(window.location.search).get('quiz');
  if (publicQuizToken) {
    showPublicQuiz();
    openPublicMeetingQuiz(publicQuizToken);
    return;
  }
  if (state.token && state.user) {
    showApplication();
    initializeAuthenticatedApp();
  } else {
    showLogin();
  }
}

function bindVisualViewport() {
  const updateViewportHeight = () => {
    if (document.querySelector('dialog[open]')) return;
    const height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--visual-viewport-height', `${Math.round(height)}px`);
  };
  updateViewportHeight();
  window.addEventListener('resize', updateViewportHeight, { passive: true });
  window.addEventListener('orientationchange', updateViewportHeight, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateViewportHeight, { passive: true });
    window.visualViewport.addEventListener('scroll', updateViewportHeight, { passive: true });
  }
}

function bindEvents() {
  $('#loginForm').addEventListener('submit', event => { event.preventDefault(); login(); });
  $('#togglePassword').addEventListener('click', () => {
    const input = $('#password');
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    $('#eyeIcon').innerHTML = isHidden
      ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'
      : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  });
  $('#logoutButton').addEventListener('click', logout);
  $('#sidebarLogoutButton').addEventListener('click', logout);
  $('#menuButton').addEventListener('click', openMobileDrawer);
  $('#closeMenuButton').addEventListener('click', closeMobileDrawer);
  $('#sidebarBackdrop').addEventListener('click', closeMobileDrawer);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMobileDrawer(); });
  window.addEventListener('resize', () => { if (window.innerWidth >= 768) closeMobileDrawer(); }, { passive: true });
  $$('#mainNav [data-page]').forEach(button => button.addEventListener('click', () => navigateTo(button.dataset.page)));
  $('#refreshDashboard').addEventListener('click', loadDashboard);
  $('#ldMeetingQuiz').addEventListener('click', handleLeaderMeetingQuizClick);
  $('#auditLine').addEventListener('change', () => {
    handleAuditLineChange();
    handleAuditScopeChange();
  });
  $('#auditStation').addEventListener('change', () => {
    updateAuditArea();
    handleAuditScopeChange();
  });
  $('#auditDate').addEventListener('change', () => {
    updateLateReasonVisibility();
    handleAuditScopeChange();
  });
  $('#auditShift').addEventListener('change', handleAuditScopeChange);
  $('#auditLayer').addEventListener('change', handleAuditScopeChange);
  $('#checklistLanguage').addEventListener('change', handleAuditScopeChange);
  $('#loadChecklistButton').addEventListener('click', loadChecklist);
  $('#auditForm').addEventListener('submit', event => { event.preventDefault(); saveAudit(); });
  $('#fiveSRefreshButton').addEventListener('click', loadFiveSPage);
  $('#fiveSLoadButton').addEventListener('click', loadFiveSPage);
  $('#fiveSInspectionDate').addEventListener('change', loadFiveSPage);
  $('#fiveSShiftFilter').addEventListener('change', loadFiveSPage);
  $('#fiveSAddCheckpointButton').addEventListener('click', () => openFiveSCheckpointEditor());
  $('#fiveSCancelCheckpointButton').addEventListener('click', closeFiveSCheckpointEditor);
  $('#fiveSCheckpointForm').addEventListener('submit', event => { event.preventDefault(); saveFiveSCheckpointFromForm(); });
  $('#fiveSReferencePhoto').addEventListener('change', handleFiveSReferencePhotoChange);
  $('#fiveSCheckpointTable').addEventListener('click', handleFiveSCheckpointTableClick);
  $('#fiveSInspectionList').addEventListener('submit', handleFiveSInspectionSubmit);
  $('#fiveSInspectionList').addEventListener('change', handleFiveSInspectionChange);
  $('#fiveSInspectionList').addEventListener('click', handleFiveSReviewClick);
  $('#planLine').addEventListener('change', () => populateStationSelect('#planStation', $('#planLine').value, true));
  $('#loadAuditPlanButton').addEventListener('click', loadAuditPlan);
  $('#addAuditRuleButton').addEventListener('click', () => openAuditRuleEditor());
  $('#cancelAuditRuleButton').addEventListener('click', closeAuditRuleEditor);
  $('#auditRuleLine').addEventListener('change', handleAuditRuleLineChange);
  $('#auditRuleAssignmentMode').addEventListener('change', updateAuditRuleAssignmentMode);
  $('#auditRuleFrequency').addEventListener('change', updateAuditRuleFrequencyFields);
  $('#auditRuleForm').addEventListener('submit', event => { event.preventDefault(); saveAuditRule(); });
  $('#auditPlanTable').addEventListener('click', event => {
    const button = event.target.closest('[data-rule-id]');
    if (!button) return;
    const rule = state.auditRules.find(item => String(item.RuleID) === button.dataset.ruleId);
    if (rule) openAuditRuleEditor(rule);
  });
  $('#addMeetingPostButton').addEventListener('click', () => openMeetingEditor());
  $('#addTrainingRecordButton').addEventListener('click', () => openMeetingEditor('', 'Training'));
  $('#trainingRefreshButton').addEventListener('click', loadTrainingPage);
  $('#loadTrainingRecordsButton').addEventListener('click', loadTrainingPage);
  $('#trainingDateFrom').addEventListener('change', loadTrainingPage);
  $('#trainingDateTo').addEventListener('change', loadTrainingPage);
  $('#trainingSearch').addEventListener('input', renderTrainingArchive);
  $('#trainingArchive').addEventListener('click', handleTrainingArchiveClick);
  $('#trainingArchive').addEventListener('change', handleTrainingArchiveFileChange);
  $('#meetingPostType').addEventListener('change', syncMeetingEditorType);
  $('#printTrainingDraftButton').addEventListener('click', printTrainingDraftFromEditor);
  $('#meetingTvButton').addEventListener('click', openMeetingTv);
  document.addEventListener('keydown', event => {
    if ($('#meetingTv').classList.contains('hidden') || document.querySelector('dialog[open]')) return;
    if (['ArrowRight', ' ', 'PageDown', 'Enter'].includes(event.key)) { event.preventDefault(); meetingTvStep(1); }
    else if (['ArrowLeft', 'PageUp'].includes(event.key)) { event.preventDefault(); meetingTvStep(-1); }
    else if (event.key === 'Escape') closeMeetingTv();
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && !$('#meetingTv').classList.contains('hidden')) closeMeetingTv();
  });
  window.addEventListener('afterprint', clearTrainingPrintView);
  $('#loadMeetingPostsButton').addEventListener('click', () => loadMeetingBoard());
  $('#meetingDate').addEventListener('change', () => loadMeetingBoard());
  $('#meetingForm').addEventListener('submit', event => { event.preventDefault(); saveMeetingPostFromForm(); });
  $('#closeMeetingDialog').addEventListener('click', () => $('#meetingDialog').close());
  $('#cancelMeetingPost').addEventListener('click', () => $('#meetingDialog').close());
  $('#deleteMeetingPostButton').addEventListener('click', deleteMeetingPostAction);
  $('#meetingAckSearch').addEventListener('input', filterMeetingAckUsers);
  $('#meetingPostPhoto').addEventListener('change', addMeetingPhotoFiles);
  $('#meetingPostVideo').addEventListener('change', handleMeetingVideoFileChange);
  $('#meetingPostVideoUrl').addEventListener('input', handleMeetingVideoUrlInput);
  $('#insertMeetingVideoMarker').addEventListener('click', insertMeetingVideoMarker);
  $('#meetingBoard').addEventListener('click', handleMeetingQuizBoardClick);
  $('#closeMeetingQuizAdmin').addEventListener('click', () => $('#meetingQuizAdminDialog').close());
  $('#meetingQuizAdminDialog').addEventListener('close', stopMeetingQuizAdminPolling);
  $('#closeMeetingQuizExam').addEventListener('click', () => $('#meetingQuizExamDialog').close());
  $('#meetingQuizExamDialog').addEventListener('close', stopMeetingQuizResultPolling);
  $('#meetingQuizAdminContent').addEventListener('click', handleMeetingQuizAdminClick);
  $('#meetingQuizAdminContent').addEventListener('change', handleMeetingQuizAdminChange);
  $('#meetingQuizAdminContent').addEventListener('input', handleMeetingQuizAdminInput);
  $('#meetingQuizExamContent').addEventListener('submit', handleMeetingQuizExamSubmit);
  $('#meetingQuizExamContent').addEventListener('change', handleMeetingQuizExamChange);
  $('#publicMeetingQuizContent').addEventListener('submit', handleMeetingQuizExamSubmit);
  $('#publicMeetingQuizContent').addEventListener('change', handleMeetingQuizExamChange);
  $('#publicMeetingQuizContent').addEventListener('click', handleMeetingQuizExamClick);
  $('#findingLine').addEventListener('change', () => populateStationSelect('#findingStation', $('#findingLine').value, true));
  $('#checklistLine').addEventListener('change', () => populateStationSelect('#checklistStation', $('#checklistLine').value, false));
  $('#applyFindingFilters').addEventListener('click', loadFindings);
  $('#refreshFindings').addEventListener('click', () => loadFindings(true));
  $('#loadReportButton').addEventListener('click', loadMonthlyReport);
  $('#printReportButton').addEventListener('click', () => window.print());
  $('#exportCsvButton').addEventListener('click', exportReportCsv);
  $('#loadMasterChecklistButton').addEventListener('click', loadMasterChecklist);
  $('#findingForm').addEventListener('submit', event => event.preventDefault());
  $('#editAfterPhoto').addEventListener('change', renderFindingPhotoPreview);
  $('#closeFindingDialog').addEventListener('click', () => $('#findingDialog').close());
  $('#cancelFindingEdit').addEventListener('click', () => $('#findingDialog').close());
  $('#submitVerificationButton').addEventListener('click', submitFindingForVerification);
  $('#approveFindingButton').addEventListener('click', () => verifyFinding('Approve'));
  $('#rejectFindingButton').addEventListener('click', () => verifyFinding('Reject'));
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-photo-url]');
    if (!trigger || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    // Collect every photo in the same gallery so the lightbox can page through them
    const siblings = trigger.parentElement ? $$('[data-photo-url]', trigger.parentElement) : [];
    const triggers = siblings.length ? siblings : [trigger];
    openPhotoLightbox(triggers.map(t => t.dataset.photoUrl), Math.max(0, triggers.indexOf(trigger)), {
      enableZoom: Boolean(trigger.closest('#meetingTv'))
    });
  });
  $('#closePhotoLightbox').addEventListener('click', closePhotoLightbox);
  $('#photoLightboxPrev').addEventListener('click', () => stepPhotoLightbox(-1));
  $('#photoLightboxNext').addEventListener('click', () => stepPhotoLightbox(1));
  $('#photoLightboxZoomIn').addEventListener('click', () => setPhotoLightboxZoom(photoLightboxZoom + .25));
  $('#photoLightboxZoomOut').addEventListener('click', () => setPhotoLightboxZoom(photoLightboxZoom - .25));
  $('#photoLightboxZoomReset').addEventListener('click', resetPhotoLightboxZoom);
  const lightboxImage = $('#photoLightboxImage');
  lightboxImage.addEventListener('pointerdown', startPhotoLightboxPan);
  lightboxImage.addEventListener('pointermove', movePhotoLightboxPan);
  lightboxImage.addEventListener('pointerup', endPhotoLightboxPan);
  lightboxImage.addEventListener('pointercancel', endPhotoLightboxPan);
  document.addEventListener('keydown', event => {
    if (!$('#photoLightbox').open) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); stepPhotoLightbox(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); stepPhotoLightbox(-1); }
    else if (photoLightboxTvZoom && ['+', '='].includes(event.key)) { event.preventDefault(); setPhotoLightboxZoom(photoLightboxZoom + .25); }
    else if (photoLightboxTvZoom && event.key === '-') { event.preventDefault(); setPhotoLightboxZoom(photoLightboxZoom - .25); }
    else if (photoLightboxTvZoom && event.key === '0') { event.preventDefault(); resetPhotoLightboxZoom(); }
  });
  $('#photoLightbox').addEventListener('click', event => { if (event.target === event.currentTarget) closePhotoLightbox(); });
  $('#photoLightbox').addEventListener('close', () => {
    $('#photoLightboxImage').src = '';
    $('#photoLightbox').classList.remove('is-tv-zoomable', 'is-zoomed', 'is-dragging');
    $('#photoLightboxZoomControls').classList.add('hidden');
    photoLightboxTvZoom = false;
    photoLightboxPointer = null;
  });
  $('#confirmDialogOk').addEventListener('click', () => settleConfirmDialog(true));
  $('#confirmDialogCancel').addEventListener('click', () => settleConfirmDialog(false));
  // Escape and backdrop clicks both mean "no" — they funnel through the same
  // settle() as the buttons so every dismissal path resolves the promise once.
  $('#confirmDialog').addEventListener('close', () => settleConfirmDialog(false));
  $('#confirmDialog').addEventListener('click', event => { if (event.target === event.currentTarget) settleConfirmDialog(false); });
  ['#editCloseRemark', '#editRejectReason'].forEach(selector => {
    $(selector).addEventListener('input', event => event.target.classList.remove('field-error'));
  });
  populateFindingReasonSelect('#editCloseReasonSelect', FINDING_CLOSE_REASONS);
  populateFindingReasonSelect('#editRejectReasonSelect', FINDING_REJECT_REASONS);
  wireFindingReasonSelect('#editCloseReasonSelect', '#editCloseRemark', '#editCloseRemarkNoteField');
  wireFindingReasonSelect('#editRejectReasonSelect', '#editRejectReason', '#editRejectReasonNoteField');
  $('#addUserButton').addEventListener('click', () => openUserEditor());
  $('#migrateRulesBtn').addEventListener('click', async () => {
    const confirmed = await showConfirm({
      title: 'แปลง Rule เป็น Line Level?',
      message: 'ระบบจะลบ Rule ระดับ Station เดิม แล้วสร้าง Rule ใหม่ 1 Rule ต่อ 1 Line\nการดำเนินการนี้ไม่สามารถย้อนกลับได้',
      confirmText: 'แปลง Rule',
      tone: 'danger'
    });
    if (!confirmed) return;
    const btn = $('#migrateRulesBtn');
    btn.disabled = true; btn.textContent = 'กำลังแปลง...';
    try {
      const data = await apiCall('migrateRulesToLineLevel', {});
      showToast(`แปลงสำเร็จ: สร้าง ${data.migrated} Rule ใหม่, ลบ ${data.deleted} Rule เก่า`, 'success', 8000);
      state.auditRules = [];
      GASCache.invalidatePrefix('mgr_comp_'); GASCache.invalidatePrefix('dir_dash_');
    } catch(e) { showToast(e.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = '🔄 Migrate Rules → Line Level'; }
  });
  $('#deduplicateRulesBtn').addEventListener('click', async () => {
    const confirmed = await showConfirm({
      title: 'ลบ Rule ที่ซ้ำกัน?',
      message: 'Rule ที่มี Line + Role + Frequency เดียวกันจะถูกลบออก เหลือไว้ 1 Rule ต่อ Line',
      confirmText: 'ลบ Rule ซ้ำ',
      tone: 'danger'
    });
    if (!confirmed) return;
    const btn = $('#deduplicateRulesBtn');
    btn.disabled = true; btn.textContent = 'กำลังลบ...';
    try {
      const data = await apiCall('deduplicateLineRules', {});
      showToast(`ลบ rule ซ้ำ ${data.deleted} รายการ`, 'success', 6000);
      state.auditRules = [];
      state.leaderDashData = null;
      GASCache.invalidatePrefix('mgr_comp_'); GASCache.invalidatePrefix('leader_');
    } catch(e) { showToast(e.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = '🧹 ลบ Rule ซ้ำ'; }
  });
  $('#searchUsersButton').addEventListener('click', loadUsers);
  $('#addShiftButton').addEventListener('click', () => openShiftEditor());
  $('#cancelShiftButton').addEventListener('click', closeShiftEditor);
  $('#shiftForm').addEventListener('submit', event => { event.preventDefault(); saveShift(); });
  $('#shiftListTable').addEventListener('click', event => {
    const button = event.target.closest('[data-shift-value]');
    if (button) openShiftEditor(button.dataset.shiftValue);
  });
  $('#adminUsersTable').addEventListener('click', event => {
    const button = event.target.closest('[data-user-id]');
    if (button) openUserEditor(button.dataset.userId);
  });
  $('#userForm').addEventListener('submit', event => { event.preventDefault(); saveUser(); });
  $('#closeUserDialog').addEventListener('click', () => $('#userDialog').close());
  $('#cancelUserEdit').addEventListener('click', () => $('#userDialog').close());
  $('#deactivateUserButton').addEventListener('click', deactivateSelectedUser);
  $('#resetPasswordButton').addEventListener('click', resetSelectedUserPassword);
  document.addEventListener('visibilitychange', handleNotificationVisibilityChange);
}

function makeWorkerTimeout(ms) {
  // Web Workers are not throttled by Chrome background-tab policies
  const code = 'self.onmessage=function(e){setTimeout(function(){self.postMessage(1)},e.data);}';
  const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
  let worker, resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  try {
    worker = new Worker(url);
    worker.onmessage = () => { URL.revokeObjectURL(url); reject(new Error('__timeout__')); };
    worker.onerror = () => { URL.revokeObjectURL(url); reject(new Error('__timeout__')); };
    worker.postMessage(ms);
  } catch (_) {
    URL.revokeObjectURL(url);
    setTimeout(() => reject(new Error('__timeout__')), ms);
  }
  const cancel = () => { try { worker && worker.terminate(); URL.revokeObjectURL(url); } catch (_) {} };
  return { promise, cancel };
}

// Apps Script's /exec edge sporadically answers 404/429/5xx before the script is
// ever invoked — the deployment is fine, the request just never landed. Those are
// safe to replay (even for writes, since nothing ran server-side).
const RETRYABLE_HTTP_STATUS = [404, 408, 425, 429, 500, 502, 503, 504];
// These 404 windows are not instantaneous — they persist for seconds at a time
// (redeploys and request bursts both trigger them). Three quick attempts gave up
// after ~1.5s and surfaced the error to the user; this rides out ~25s.
const API_MAX_ATTEMPTS = 6;
const API_RETRY_BASE_MS = 800;
const API_RETRY_MAX_MS = 8000;
// Firing several requests at the endpoint at once is itself a trigger for those
// 404s, so no more than this many are ever in flight — the rest queue.
const API_MAX_CONCURRENT = 2;
// Timeouts get their own, much shorter ladder — see the retry loop in apiCall().
const API_MAX_TIMEOUT_ATTEMPTS = 2;
// Actions that change server state: a dropped connection may mean the write DID
// land, so replay them only when the server explicitly refused the request.
const WRITE_ACTIONS = [
  'saveAudit', 'uploadFile', 'uploadFiveSCheckpointReferencePhoto', 'uploadMeetingQuizQuestionImage', 'translateMeetingQuizQuestionToMyanmar', 'updateFinding', 'submitFinding', 'verifyFinding', 'closeFinding',
  'saveMeetingPost', 'deleteMeetingPost', 'updateMeetingPostStatus', 'acknowledgeMeetingPost',
  'convertMeetingSlideFile', 'generateMeetingQuiz', 'startManualMeetingQuiz', 'saveMeetingQuizApiKey', 'saveMeetingQuizDraft', 'publishMeetingQuiz',
  'lockMeetingQuizRoster', 'excuseMeetingQuizParticipant', 'registerMeetingQuizParticipant', 'startMeetingQuizAttempt', 'submitMeetingQuiz',
  'saveProductionPlan', 'upsertAuditPlanRule', 'deleteAuditRule',
  'generateAuditPlan', 'refreshAuditPlanStatus', 'upsertMasterList', 'migrateRulesToLineLevel',
  'deduplicateLineRules', 'createUser', 'updateUser', 'deactivateUser', 'resetUserPassword',
  'updateRolePermissions', 'updateUserPermissions', 'updateUserLineAccess', 'reviewFiveSInspection'
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Gate on the endpoint: at most API_MAX_CONCURRENT requests in flight, everything
// else waits its turn. Two lanes, because plain FIFO let a background refresh that
// started a moment earlier hold up the button the user just pressed: the write was
// sent first but sat in the queue for a whole round trip with the spinner already
// up. Writes, and anything else a user is actively waiting on, take the high lane.
const apiGate = { active: 0, high: [], normal: [] };

function apiGateBusy() { return apiGate.active >= API_MAX_CONCURRENT; }

async function acquireApiSlot(priority) {
  if (apiGate.active < API_MAX_CONCURRENT) { apiGate.active++; return; }
  // The waker hands its slot straight over, so active already counts this call.
  await new Promise(resolve => apiGate[priority === 'high' ? 'high' : 'normal'].push(resolve));
}

function releaseApiSlot() {
  const next = apiGate.high.shift() || apiGate.normal.shift();
  // Handing the slot to a waiter keeps active unchanged. Decrementing first would
  // leave a gap that a fresh caller could claim before the waiter resumes.
  if (next) next();
  else apiGate.active--;
}

async function apiCall(action, payload = {}, options = {}) {
  const TIMEOUT_MS = (action === 'uploadFile' || action === 'uploadFiveSCheckpointReferencePhoto' || action === 'uploadMeetingQuizQuestionImage' || action === 'saveAudit' || action === 'convertMeetingSlideFile' || action === 'generateMeetingQuiz' || action === 'translateMeetingQuizQuestionToMyanmar') ? 90000 : 45000;
  // Writes are always something a user is standing in front of; reads are only
  // urgent when the caller says so (background refreshes pass priority 'normal').
  const priority = options.priority || (WRITE_ACTIONS.includes(action) ? 'high' : 'normal');
  await acquireApiSlot(priority);
  try {
    let timeouts = 0;
    for (let attempt = 1; ; attempt++) {
      try {
        return await apiCallOnce(action, payload, TIMEOUT_MS);
      } catch (error) {
        // A refused request costs milliseconds, so riding those out is cheap. A
        // timeout already cost the full deadline, so replaying it up the whole
        // ladder would leave the user in front of a spinner for minutes.
        if (error.lpaTimeout && ++timeouts >= API_MAX_TIMEOUT_ATTEMPTS) throw error;
        if (!error.lpaRetryable || attempt >= API_MAX_ATTEMPTS) throw error;
        // Exponential backoff with jitter so retries from several calls that
        // failed together do not line back up into another burst.
        const backoff = Math.min(API_RETRY_BASE_MS * 2 ** (attempt - 1), API_RETRY_MAX_MS);
        console.warn(`apiCall(${action}) attempt ${attempt} failed, retrying:`, error.message);
        // A silent spinner through a 25s retry ladder is indistinguishable from a
        // frozen page, so say what is happening while it rides the outage out.
        if (options.quiet !== true) setLoadingHint(`เซิร์ฟเวอร์ยังไม่ตอบสนอง กำลังลองใหม่ครั้งที่ ${attempt + 1} จาก ${API_MAX_ATTEMPTS}`);
        await sleep(backoff * (0.7 + Math.random() * 0.6));
      }
    }
  } finally {
    releaseApiSlot();
  }
}

async function apiCallOnce(action, payload, TIMEOUT_MS) {
  const { promise: timeoutPromise, cancel: cancelTimeout } = makeWorkerTimeout(TIMEOUT_MS);
  const timeoutMsg = `ระบบใช้เวลานานเกินไป (${TIMEOUT_MS / 1000}s) กรุณาลองใหม่อีกครั้ง`;
  const fetchPromise = fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token: state.token || '', payload })
  }).then(async response => {
    if (!response.ok) {
      cancelTimeout();
      const httpError = new Error(`เซิร์ฟเวอร์ตอบกลับ HTTP ${response.status}`);
      httpError.lpaRetryable = RETRYABLE_HTTP_STATUS.includes(response.status);
      throw httpError;
    }
    // Reading the body is part of the request, so the timeout has to cover it.
    // Cancelling on the headers alone left the call with no deadline at all, and
    // Apps Script's edge does stall mid-body — that request then never settled and
    // the loading overlay stayed up until the page was reloaded. This is the hang.
    const text = await response.text();
    cancelTimeout();
    let result;
    try {
      result = JSON.parse(text);
    } catch (_) {
      // Not JSON means the edge served something that is not our script (an
      // interstitial or an error page), so the request never reached the backend.
      const parseError = new Error('เซิร์ฟเวอร์ตอบกลับข้อมูลไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง');
      // Same rule as a dropped connection: a read is safe to replay, a write is
      // not, because there is no proof from here that the script did not run.
      parseError.lpaRetryable = !WRITE_ACTIONS.includes(action);
      throw parseError;
    }
    if (!result.success) {
      const rawMessage = result.message || 'ไม่สามารถดำเนินการได้';
      if (isTokenError(rawMessage) && action !== 'login') {
        logout(false);
        showToast('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่', 'warning');
      }
      throw new Error(translateApiMessage(rawMessage));
    }
    return result.data || {};
  });
  try {
    return await Promise.race([fetchPromise, timeoutPromise]);
  } catch (error) {
    cancelTimeout();
    if (error.message === '__timeout__') {
      const timeoutError = new Error(timeoutMsg);
      // A read that timed out changed nothing, so it is safe to replay; a write
      // may have landed server-side, so that one still has to be surfaced.
      timeoutError.lpaRetryable = !WRITE_ACTIONS.includes(action);
      timeoutError.lpaTimeout = true;
      throw timeoutError;
    }
    if (error instanceof TypeError) {
      const networkError = new Error('ไม่สามารถเชื่อมต่อระบบได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
      networkError.lpaRetryable = !WRITE_ACTIONS.includes(action);
      throw networkError;
    }
    throw error;
  }
}

/**
 * Runs several read actions in one request.
 *
 * Every Apps Script round trip costs ~2s of platform overhead regardless of how
 * little work it does, so page loads are dominated by call count, not payload
 * size. Resolves to an array positionally matching `calls`; a sub-call that
 * failed resolves to null rather than rejecting the whole batch.
 */
async function apiBatch(calls) {
  if (!calls.length) return [];
  if (calls.length === 1) {
    try { return [await apiCall(calls[0].action, calls[0].payload || {})]; } catch (_) { return [null]; }
  }
  const data = await apiCall('batch', { calls: calls.map(c => ({ action: c.action, payload: c.payload || {} })) });
  const results = Array.isArray(data.results) ? data.results : [];
  return calls.map((call, index) => {
    const result = results[index];
    if (!result || !result.success) {
      if (result) console.warn(`batch(${call.action}) failed:`, result.message);
      return null;
    }
    return result.data || {};
  });
}

async function login() {
  const username = $('#username').value.trim();
  const password = $('#password').value;
  if (!username || !password) return showToast('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน', 'warning');
  const button = $('#loginButton');
  button.disabled = true;
  button.textContent = 'กำลังเข้าสู่ระบบ...';
  showLoading('กำลังเข้าสู่ระบบ...');
  try {
    const data = await apiCall('login', { username, password });
    state.token = data.token;
    state.user = data.user;
    state.user.permissions = data.permissions || [];
    state.user.lineAccess = data.lineAccess || [];
    localStorage.setItem('lpa_token', state.token);
    localStorage.setItem('lpa_user', JSON.stringify(state.user));
    localStorage.setItem('lpa_line_access', JSON.stringify(data.lineAccess || []));
    $('#password').value = '';
    showApplication();
    showToast(`ยินดีต้อนรับ ${state.user.FullName || state.user.Username}`, 'success');
    hideLoading();
    await initializeAuthenticatedApp(false);
    startFindingNotificationPolling(true);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'เข้าสู่ระบบ';
    hideLoading();
  }
}

function logout(notify = true) {
  closeMobileDrawer();
  state.token = '';
  state.user = null;
  state.masterData = { lines: [], stations: [], users: [], lists: [], settings: {} };
  state.masterDataLoadedAt = 0;
  state.masterDataPromise = null;
  state.checklist = [];
  state.auditAnswers = {};
  state.bootstrapping = false;
  localStorage.removeItem('lpa_token');
  localStorage.removeItem('lpa_user');
  GASCache.invalidateAll();
  state.leaderDashData = null;
  state.productionPlan = null;
  state.productionPlanSkipped = false;
  stopFindingNotificationPolling();
  updateFindingBadges(0);
  showLogin();
  if (notify) showToast('ออกจากระบบแล้ว', 'success');
}

async function initializeAuthenticatedApp(validateSession = true) {
  state.bootstrapping = true;
  // On a page refresh the session used to be revalidated with a blocking
  // getCurrentUser call — ~4s of spinner before the shell even appeared. The
  // stored user renders the shell straight away and getCurrentUser rides along
  // in the bootstrap batch below; a dead token still logs out, just later.
  applyUserToShell();
  showDashboardSkeleton();
  // Fire the background batch first: it publishes state.masterDataPromise
  // synchronously, so anything navigateTo triggers that needs master data joins
  // this request instead of opening a second one.
  bootstrapBackgroundData(validateSession);
  await navigateTo('dashboard');
}

function applyUserToShell() {
  $('#currentUserName').textContent = state.user.FullName || state.user.Username || '-';
  $('#currentUserRole').textContent = state.user.Role || '-';
  applyPermissionVisibility();
  applyAuditPlanRoleScope();
  applyAuditLayerPermissions();
  applyViewerAccountRestrictions();
}

/**
 * Everything the dashboard itself does not block on, fetched in one request.
 *
 * These used to be five independent calls (meeting acks, finding notifications,
 * a 3s-delayed findings pre-warm, an idle schedule-rules prefetch, plus master
 * data loaded lazily behind a blocking spinner on first navigation). At ~2s of
 * platform overhead per Apps Script round trip that dominated the post-login
 * experience; one batch pays that overhead once.
 */
async function bootstrapBackgroundData(validateSession = false) {
  const calls = [{ action: 'getMasterData', payload: {} }];
  const currentUserIndex = validateSession
    ? calls.push({ action: 'getCurrentUser', payload: {} }) - 1 : -1;
  const notificationIndex = calls.push({
    action: 'getMyFindingNotificationSummary',
    payload: { lastSeenAt: getLastSeenFindingNotificationAt(), limit: 5 }
  }) - 1;
  const ackIndex = hasPermission('meeting.view')
    ? calls.push({ action: 'getMyPendingMeetingAcks', payload: {} }) - 1 : -1;
  const findingsIndex = calls.push({ action: 'getFindings', payload: {} }) - 1;
  const rulesIndex = hasPermission('audit.plan.view')
    ? calls.push({ action: 'getAuditPlanRules', payload: { activeStatus: 'Active', limit: 300 } }) - 1 : -1;

  const batchPromise = apiBatch(calls);
  // Park the master-data slice on the shared promise so anything that calls
  // ensureMasterDataLoaded while the batch is in flight (the shift digest does,
  // during navigateTo) waits on this request instead of issuing its own.
  state.masterDataPromise = batchPromise.then(batchResults => {
    const data = batchResults[0];
    if (!data) throw new Error('ไม่สามารถโหลด Master Data ได้');
    state.masterData = data;
    state.masterDataLoadedAt = Date.now();
    populateAllMasterSelects();
    return data;
  });
  state.masterDataPromise.catch(() => {});

  let results;
  try {
    results = await batchPromise;
  } catch (error) {
    console.warn('Background bootstrap failed:', error.message || error);
    return;
  } finally {
    state.bootstrapping = false;
    state.masterDataPromise = null;
  }

  if (currentUserIndex >= 0 && results[currentUserIndex]) {
    state.user = results[currentUserIndex];
    localStorage.setItem('lpa_user', JSON.stringify(state.user));
    applyUserToShell();
  }
  const notifications = results[notificationIndex];
  if (notifications) handleFindingNotificationSummary(notifications, true);
  // Keep the recurring poll running even if the summary sub-call failed.
  startFindingNotificationPolling(!notifications);

  if (ackIndex >= 0 && results[ackIndex]) {
    state.meetingPendingAcks = results[ackIndex].pending || [];
    renderMeetingAckBadgeAndBanner();
    if (state.meetingPendingAcks.length) {
      showToast(`📣 มีเรื่องแจ้งจากที่ประชุม ${state.meetingPendingAcks.length} รายการ รอคุณกดรับทราบ`, 'warning', 8000);
    }
  }
  const findings = results[findingsIndex];
  if (findings && !state.findingsCache) {
    state.findingsCache = { key: JSON.stringify({}), data: Array.isArray(findings.findings) ? findings.findings : [], ts: Date.now() };
  }
  if (rulesIndex >= 0 && results[rulesIndex] && !state.auditRules.length) {
    state.auditRules = results[rulesIndex].rules || [];
  }
}

async function loadMasterData(withLoading = true) {
  if (withLoading) showLoading('กำลังโหลด Master Data...');
  try {
    state.masterData = await apiCall('getMasterData', {});
    state.masterDataLoadedAt = Date.now();
    populateAllMasterSelects();
    return state.masterData;
  } catch (error) {
    showToast(error.message, 'error');
    throw error;
  } finally {
    if (withLoading) hideLoading();
  }
}

async function ensureMasterDataLoaded(withLoading = true) {
  const freshForFiveMinutes = state.masterDataLoadedAt && Date.now() - state.masterDataLoadedAt < 300000;
  if (freshForFiveMinutes && (state.masterData.lines || []).length) return state.masterData;
  if (state.masterDataPromise) return state.masterDataPromise;
  state.masterDataPromise = loadMasterData(withLoading);
  try {
    return await state.masterDataPromise;
  } finally {
    state.masterDataPromise = null;
  }
}

async function loadDashboard() {
  const role = state.user?.Role || '';
  const isLeaderRole = role === 'Leader' || role === 'Supervisor';
  const isMgrRole = role === 'Manager' || role === 'Viewer' || role === 'Customer'; // Viewer/Customer see the Manager-style dashboard
  const isDirRole = role === 'Admin';
  $('#ldMeetingQuizSection')?.classList.toggle('hidden', !hasPermission('meeting.view'));
  if (isLeaderRole) syncLeaderMeetingQuizPolling();
  else stopLeaderMeetingQuizPolling();
  $('#leaderDashboard').classList.toggle('hidden', !isLeaderRole);
  $('#mgrDashboard').classList.toggle('hidden', !isMgrRole);
  $('#dirDashboard').classList.toggle('hidden', !isDirRole);
  $('#managerDashboard').classList.toggle('hidden', isLeaderRole || isMgrRole || isDirRole);
  if (isMgrRole) { await loadManagerDashboard(); return; }
  if (isDirRole) { await loadDirectorDashboard(); return; }
  if (isLeaderRole) { await loadLeaderDashboard(); return; }
  const refreshButton = $('#refreshDashboard');
  refreshButton.disabled = true;
  const cachedDash = GASCache.get('dashboard');
  if (cachedDash) { state.dashboard = cachedDash; renderDashboard(cachedDash); refreshButton.disabled = false; return; }
  showDashboardSkeleton();
  try {
    const [dashData, todayAudits] = await Promise.all([
      cachedApiCall('getDashboard', {}, 'dashboard', 1),
      apiCall('getAuditList', { limit: 200 }).catch(() => ({ audits: [] }))
    ]);
    state.dashboard = dashData;
    renderDashboard(dashData);
    renderTodayAudits(todayAudits.audits || [], '#todayAuditsList');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    refreshButton.disabled = false;
  }
}

// ===== Production Plan Check-in =====
// ===== Shift helpers =====
function detectCurrentShift() {
  const h = new Date().getHours();
  return (h >= 8 && h < 20) ? 'กะเช้า' : 'กะดึก';
}
function getShiftDate(shiftName) {
  const now = new Date();
  if (shiftName === 'กะดึก' && now.getHours() < 8) {
    const y = new Date(now); y.setDate(y.getDate() - 1); return localDateInput(y);
  }
  return localDateInput(now);
}

async function ensureProductionPlan() {
  if (state.productionPlan) return true;
  if (state.productionPlanSkipped) return true;
  // Detect shift + shift date
  const autoShift = detectCurrentShift();
  const autoShiftDate = getShiftDate(autoShift);
  const planCacheKey = `prod_plan_${autoShiftDate}_${autoShift}_${state.user?.UserID}`;
  const planCached = GASCache.get(planCacheKey);
  if (planCached) {
    if (planCached.isSet) state.productionPlan = { activeLineIds: planCached.activeLineIds, date: planCached.date, shiftName: planCached.shiftName || autoShift };
    else state.productionPlanSkipped = true;
    return true;
  }
  try {
    const data = await apiCall('getProductionPlan', { shiftName: autoShift, shiftDate: autoShiftDate });
    GASCache.set(planCacheKey, data, 60);
    if (data.isSet) {
      state.productionPlan = { activeLineIds: data.activeLineIds, date: data.date, shiftName: data.shiftName || autoShift };
      return true;
    }
    if (!(state.masterData.lines || []).length) await ensureMasterDataLoaded(false);
    await openProductionPlanModal(data, autoShift, autoShiftDate);
    if (!state.productionPlan) state.productionPlanSkipped = true;
    return true;
  } catch (_) {
    return true; // on error, don't block dashboard
  }
}

async function openProductionPlanModal(planData, autoShift, autoShiftDate) {
  return new Promise(resolve => {
    // Always reset button state when opening modal
    const saveBtn = $('#prodPlanSave');
    saveBtn.disabled = false;
    saveBtn.textContent = '✓ บันทึกและเริ่มงาน';

    const lineAccess = JSON.parse(localStorage.getItem('lpa_line_access') || '[]');
    const allLines = state.masterData.lines || [];
    const myLines = allLines.filter(l =>
      lineAccess.some(la => la.LineID === l.LineID || la.LineID === 'ALL')
    );
    if (!myLines.length) { resolve(); return; }

    // Shift selector
    let selectedShift = autoShift || detectCurrentShift();
    let selectedShiftDate = autoShiftDate || getShiftDate(selectedShift);
    const SHIFTS = [
      { key: 'กะเช้า', label: 'กะเช้า', sub: '08:00 – 20:00' },
      { key: 'กะดึก', label: 'กะดึก',  sub: '20:00 – 08:00' }
    ];
    $('#prodPlanLines').innerHTML = `
      <div style="margin-bottom:14px">
        <div style="font-size:.8rem;font-weight:800;color:var(--muted);margin-bottom:8px">คุณทำงานกะอะไร?</div>
        <div style="display:flex;gap:10px">
          ${SHIFTS.map(s => `
            <label class="prod-plan-shift-opt${s.key === selectedShift ? ' active' : ''}" id="shiftOpt_${s.key}">
              <input type="radio" name="prodPlanShift" value="${escapeAttr(s.key)}" ${s.key === selectedShift ? 'checked' : ''} style="display:none">
              <div class="prod-plan-shift-label">${escapeHtml(s.label)}</div>
              <div class="prod-plan-shift-sub">${escapeHtml(s.sub)}</div>
            </label>`).join('')}
        </div>
      </div>
      <div id="prodPlanLinesInner"></div>`;
    $$('input[name="prodPlanShift"]').forEach(r => r.addEventListener('change', () => {
      selectedShift = r.value;
      selectedShiftDate = getShiftDate(selectedShift);
      $$('.prod-plan-shift-opt').forEach(el => el.classList.remove('active'));
      document.getElementById('shiftOpt_' + selectedShift)?.classList.add('active');
    }));

    const currentIds = planData?.activeLineIds || null;
    const isAllSelected = currentIds === null;

    const stationCounts = {};
    (state.masterData.stations || []).forEach(s => {
      stationCounts[s.LineID] = (stationCounts[s.LineID] || 0) + 1;
    });
    const lineIcons = ['🏭','⚙️','🔧','🏗️','⛏️','🔩','🛠️','🔨'];

    // Compute initial checked count BEFORE rendering (from logic, not DOM)
    const initialChecked = myLines.filter(l =>
      isAllSelected || (currentIds && currentIds.includes(l.LineID))
    ).length;

    const updateCount = () => {
      const total = $$('.prod-plan-cb').length;
      const checked = $$('.prod-plan-cb:checked').length;
      const countEl = $('#prodPlanLinesInner')?.querySelector('.prod-plan-count');
      if (countEl) countEl.textContent = checked > 0 ? `เลือกแล้ว ${checked} จาก ${total} Line` : 'ยังไม่ได้เลือก Line';
      $('#prodPlanToggleAll').textContent = checked === total ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด';
    };

    $('#prodPlanLinesInner').innerHTML =
      `<div class="prod-plan-count">${initialChecked > 0 ? `เลือกแล้ว ${initialChecked} จาก ${myLines.length} Line` : 'ยังไม่ได้เลือก Line'}</div>` +
      myLines.map((l, i) => {
        const isChecked = isAllSelected || (currentIds && currentIds.includes(l.LineID));
        const stCount = stationCounts[l.LineID] || 0;
        return `<label class="prod-plan-line-item${isChecked ? ' pp-checked' : ''}">
          <div class="prod-plan-cb-wrap"><input type="checkbox" class="prod-plan-cb" value="${escapeAttr(l.LineID)}" ${isChecked ? 'checked' : ''}></div>
          <span class="prod-plan-line-icon">${lineIcons[i % lineIcons.length]}</span>
          <div class="prod-plan-line-info">
            <span class="prod-plan-line-name">${escapeHtml(l.LineName || l.LineID)}</span>
            <span class="prod-plan-line-sub">${stCount > 0 ? `${stCount} Station` : ''}</span>
          </div>
          <span class="prod-plan-tick">✅</span>
        </label>`;
      }).join('');

    $$('.prod-plan-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        cb.closest('.prod-plan-line-item').classList.toggle('pp-checked', cb.checked);
        updateCount();
      });
    });

    $('#prodPlanToggleAll').textContent = initialChecked === myLines.length ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด';
    $('#prodPlanToggleAll').onclick = () => {
      const allNowChecked = $$('.prod-plan-cb:checked').length < myLines.length;
      $$('.prod-plan-cb').forEach(cb => { cb.checked = allNowChecked; cb.closest('.prod-plan-line-item').classList.toggle('pp-checked', allNowChecked); });
      updateCount();
    };

    saveBtn.onclick = async () => {
      const selected = $$('.prod-plan-cb:checked').map(cb => cb.value);
      if (!selected.length) { showToast('กรุณาเลือกอย่างน้อย 1 Line', 'warning'); return; }
      saveBtn.disabled = true;
      saveBtn.textContent = 'กำลังบันทึก...';
      try {
        const saved = await apiCall('saveProductionPlan', { lineIds: selected, shiftName: selectedShift, shiftDate: selectedShiftDate });
        state.productionPlan = { activeLineIds: saved.activeLineIds, date: saved.date, shiftName: saved.shiftName || selectedShift };
        GASCache.invalidate(`prod_plan_${saved.date}_${saved.shiftName || selectedShift}_${state.user?.UserID}`);
        $('#prodPlanDialog').close();
        resolve();
      } catch (err) {
        showToast(err.message, 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = '✓ บันทึกและเริ่มงาน';
      }
    };

    const closeFn = () => { $('#prodPlanDialog').close(); resolve(); };
    $('#closeProdPlanDialog').onclick = closeFn;
    $('#prodPlanDialog').oncancel = closeFn;
    $('#prodPlanDialog').showModal();
  });
}

async function changeProdPlan() {
  state.productionPlan = null;
  state.productionPlanSkipped = false;
  state.leaderDashData = null;
  GASCache.invalidatePrefix('leader_');
  if (!(state.masterData.lines || []).length) await ensureMasterDataLoaded(false);
  const sh = detectCurrentShift();
  await openProductionPlanModal(null, sh, getShiftDate(sh));
  loadLeaderDashboard();
}

async function loadLeaderDashboard() {
  loadFindingShiftDigest('ldShiftDigest', 'ldShiftDigestPic');
  const today = localDateInput(new Date());
  const role = state.user.Role;
  const rolesToFetch = role === 'Supervisor' ? ['Supervisor', 'Leader'] : ['Leader'];
  const ldKey = `leader_${state.user?.UserID}_${today}`;

  // Restore from sessionStorage cache first (survives page refresh — no loading flash)
  if (!state.leaderDashData) {
    const sessionCached = GASCache.get(ldKey);
    if (sessionCached) state.leaderDashData = sessionCached;
  }

  // Supervisor/Manager: skip production plan — they audit ALL lines every week
  const needsProdPlan = role === 'Leader';

  // Render immediately if we have any data
  if (state.leaderDashData) {
    renderLeaderFromData(state.leaderDashData);
    if (needsProdPlan) ensureProductionPlan(); // async, no blocking
    if (!GASCache.get(ldKey)) fetchLeaderDashData(ldKey, today, rolesToFetch, true);
    return;
  }

  // True first load
  $('#ldHeader').innerHTML = '<div class="ld-header-left"><div class="ld-greeting">กำลังโหลด Dashboard...</div></div>';
  $('#ldMetrics').innerHTML = Array.from({length: 4}, () => '<div class="ld-card skeleton-card" style="min-height:90px"></div>').join('');
  $('#ldTasks').innerHTML = '<div class="empty-state">กำลังโหลด...</div>';
  $('#ldFindings').innerHTML = '<div class="empty-state">กำลังโหลด...</div>';
  if (needsProdPlan) await ensureProductionPlan();
  await fetchLeaderDashData(ldKey, today, rolesToFetch, false);
}

function stopLeaderMeetingQuizPolling() {
  if (window._leaderMeetingQuizPoll) clearInterval(window._leaderMeetingQuizPoll);
  window._leaderMeetingQuizPoll = null;
}

function syncLeaderMeetingQuizPolling() {
  stopLeaderMeetingQuizPolling();
  const dashboard = $('#page-dashboard');
  const role = String(state.user?.Role || '');
  if (!dashboard?.classList.contains('active-page') || !['Leader', 'Supervisor'].includes(role) || !hasPermission('meeting.view')) return;
  loadLeaderMeetingQuizStatus();
  window._leaderMeetingQuizPoll = setInterval(() => {
    if (document.visibilityState !== 'visible' || !dashboard.classList.contains('active-page')) return;
    loadLeaderMeetingQuizStatus();
  }, 3000);
}

async function loadLeaderMeetingQuizStatus() {
  const panel = $('#ldMeetingQuiz');
  if (!panel || !hasPermission('meeting.view') || state.leaderMeetingQuizRefreshPromise) return;
  state.leaderMeetingQuizRefreshPromise = (async () => {
    try {
      const meetingDate = localDateInput(new Date());
      const data = await apiCall('getMeetingQuizStatus', { meetingDates: [meetingDate] }, { priority: 'low', quiet: true });
      const quiz = data.summariesByDate?.[meetingDate] || null;
      if (!quiz || !quiz.available) {
        const message = quiz?.hasDraft && quiz?.canManage ? 'มีข้อสอบฉบับร่าง รอตรวจและเผยแพร่' : 'วันนี้ยังไม่มีข้อสอบที่เผยแพร่';
        panel.innerHTML = `<div class="leader-meeting-quiz-empty"><span>${escapeHtml(message)}</span><button type="button" class="btn btn-outline btn-compact" data-leader-meeting-go>เปิด Meeting</button></div>`;
        return;
      }
      const sessions = quiz.shiftSessions || [];
      const submitted = Number(quiz.submittedCount || 0);
      const total = Number(quiz.startedCount ?? quiz.participantCount ?? 0);
      const registered = Number(quiz.registeredCount || 0);
      const pending = Math.max(0, total - submitted);
      const openShiftPending = sessions.filter(session => !session.examStopped)
        .reduce((sum, session) => sum + Number(session.pendingCount || 0), 0);
      const sessionHtml = sessions.map(session => `<span class="leader-meeting-quiz-shift"><strong>${escapeHtml(session.label || session.shift)}</strong>เริ่ม ${Number(session.startedCount ?? session.participantCount ?? 0)} · ส่ง ${Number(session.submittedCount || 0)}${session.examStopped ? ' · หยุดแล้ว' : ''}</span>`).join('');
      const refreshedAt = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const progressMessage = quiz.allSubmitted
        ? 'หัวหน้าหยุดสอบครบทุกกะแล้ว · เปิดดูเฉลยรวมได้'
        : openShiftPending
          ? `กะที่ยังเปิดมีผู้ค้างส่ง ${openShiftPending} คน · หัวหน้าหยุดสอบได้ทันที`
          : total
            ? `ผู้เริ่มทำข้อสอบส่งครบแล้ว · ยังมีผู้ลงชื่อ ${registered} คน`
            : (registered ? `ลงชื่อแล้ว ${registered} คน · ยังไม่มีผู้เริ่มทำข้อสอบ` : 'ยังไม่มีผู้เริ่มทำข้อสอบ');
      panel.innerHTML = `<div class="leader-meeting-quiz-card"><div class="leader-meeting-quiz-top"><div><strong>${escapeHtml(quiz.sourceTitle || 'Meeting วันนี้')}</strong><small>ติดตามสถานะอัตโนมัติ · อัปเดต ${refreshedAt}</small></div><span class="leader-meeting-quiz-total">เริ่มแล้ว ${total} · ส่ง ${submitted}</span></div><div class="leader-meeting-quiz-shifts">${sessionHtml}</div><div class="leader-meeting-quiz-foot"><span>${progressMessage}${openShiftPending && !quiz.allSubmitted ? ` · ค้างส่ง ${openShiftPending}` : ''}</span>${quiz.canManage ? `<button type="button" class="btn btn-primary btn-compact" data-leader-quiz-results="${escapeAttr(quiz.postId)}">ดูผลสอบรายคน</button>` : '<button type="button" class="btn btn-outline btn-compact" data-leader-meeting-go>เปิด Meeting</button>'}</div></div>`;
      if (quiz.allSubmitted) stopLeaderMeetingQuizPolling();
    } catch (error) {
      if (error.message) {
        console.warn('Meeting quiz dashboard status refresh failed:', error.message);
        panel.innerHTML = `<div class="leader-meeting-quiz-empty"><span>โหลดสถานะข้อสอบไม่สำเร็จ · ${escapeHtml(error.message)}</span><button type="button" class="btn btn-outline btn-compact" data-leader-meeting-go>เปิด Meeting</button></div>`;
      }
    } finally {
      state.leaderMeetingQuizRefreshPromise = null;
    }
  })();
  return state.leaderMeetingQuizRefreshPromise;
}

async function handleLeaderMeetingQuizClick(event) {
  const results = event.target.closest('[data-leader-quiz-results]');
  if (results) {
    const postId = results.dataset.leaderQuizResults;
    await navigateTo('meeting');
    if (findMeetingPost(postId)?.MeetingQuiz?.canManage) await openMeetingQuizAdmin(postId);
    else showToast('เปิด Meeting เพื่อดูผลสอบและรายชื่อผู้ส่งแล้ว', 'info');
    return;
  }
  if (event.target.closest('[data-leader-meeting-go]')) await navigateTo('meeting');
}

function renderLeaderFromData(d) {
  renderLeaderHeader(d.dashData);
  renderLeaderMetrics(d.dashData, d.rules, d.todayAudits, d.myFindings);
  renderLeaderTasks(d.rules, d.todayAudits);
  renderLeaderFindings(d.myFindings);
}

async function fetchLeaderDashData(ldKey, today, rolesToFetch, silent) {
  try {
    // Single batch call — replaces 4 separate API calls (major speed improvement)
    const batch = await apiCall('getLeaderDashboardBatch', {});
    const allAudits = batch.todayAudits || []; // this month's audits
    const today = localDateInput(new Date());

    // Week start (Monday)
    const wd = new Date().getDay();
    const weekStartD = new Date(); weekStartD.setDate(weekStartD.getDate() - (wd === 0 ? 6 : wd - 1));
    const weekStart = localDateInput(weekStartD);

    // Active lines derived from audit history (proxy for "line had production")
    const weeklyActiveLines = new Set(
      allAudits.filter(a => (a.AuditDate||'').slice(0,10) >= weekStart).map(a => a.LineID)
    );
    const monthlyActiveLines = new Set(allAudits.map(a => a.LineID));

    // Leader: filter by production plan. Supervisor/Manager: filter by audit history
    const leaderPlanIds = (rolesToFetch.includes('Leader') && !rolesToFetch.includes('Supervisor'))
      ? (state.productionPlan?.activeLineIds || null) : null;

    const rules = (batch.rules || [])
      .filter(r => rolesToFetch.includes(r.RequiredRole))
      .filter(r => {
        const freq = r.Frequency || 'Daily';
        if (freq === 'Weekly') {
          // Supervisor: only lines with Leader audit this week
          return weeklyActiveLines.size === 0 || weeklyActiveLines.has(r.LineID);
        }
        if (freq === 'Monthly') {
          // Manager: only lines with any audit this month
          return monthlyActiveLines.size === 0 || monthlyActiveLines.has(r.LineID);
        }
        // Daily (Leader): filter by production plan
        return !leaderPlanIds || leaderPlanIds.includes(r.LineID);
      });
    // Build a minimal dashData object from batch result
    const dashData = { AuditRuleSummary: batch.ruleSummary || {}, MyOpenFindings: batch.MyOpenFindings || 0, MyOverdueFindings: batch.MyOverdueFindings || 0 };
    state.dashboard = dashData;
    const todayAudits = batch.todayAudits || []; // contains this month's audits
    const myFindings = (batch.myFindings || []).filter(f => (f.Status || '').toLowerCase() !== 'closed');
    const d = { dashData, rules, todayAudits, myFindings };
    state.leaderDashData = d;
    GASCache.set(ldKey, d, 20); // 20-minute cache
    renderLeaderFromData(d);
  } catch (error) {
    if (silent) return; // Background refresh failure — keep showing old data silently
    const msg = error.message || 'โหลดไม่สำเร็จ';
    $('#ldHeader').innerHTML = `<div class="ld-header-left"><div class="ld-greeting">❌ ${escapeHtml(msg)}</div></div><button class="ld-refresh" onclick="loadLeaderDashboard()">↻ ลองใหม่</button>`;
    $('#ldMetrics').innerHTML = ''; $('#ldTasks').innerHTML = '<div class="empty-state">โหลดไม่สำเร็จ — กด ↻ ลองใหม่</div>'; $('#ldFindings').innerHTML = '';
    showToast(msg, 'error');
  }
}

function renderLeaderHeader(dashData) {
  const user = state.user;
  const rs = dashData.AuditRuleSummary || {};
  const plan = state.productionPlan;
  const now = new Date();
  const thaiDate = now.toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Show active lines from production plan — always visible
  const allLines = state.masterData.lines || [];
  const lineAccess = JSON.parse(localStorage.getItem('lpa_line_access') || '[]');
  const myLineIds = lineAccess.map(l => l.LineID);
  const role = user.Role || '';
  const isSupervisorOrMgr = role === 'Supervisor' || role === 'Manager';
  const shiftLabel = plan?.shiftName || detectCurrentShift();
  let activeBadge, btnLabel;
  if (isSupervisorOrMgr) {
    // No production plan for Supervisor/Manager — they audit all lines
    activeBadge = `<span class="prod-active-badge">🔄 ตรวจทุก Line รายสัปดาห์</span>`;
    btnLabel = null;
  } else if (plan && plan.activeLineIds && plan.activeLineIds.length > 0) {
    const activeNames = allLines.filter(l => plan.activeLineIds.includes(l.LineID)).map(l => l.LineName || l.LineID);
    activeBadge = `<span class="prod-active-badge">🟢 ${escapeHtml(shiftLabel)} · ${escapeHtml(activeNames.join(', '))}</span>`;
    btnLabel = 'เปลี่ยนกะ/Line';
  } else {
    activeBadge = `<span class="prod-active-badge" style="background:rgba(211,41,41,.45)">⚠️ ยังไม่ได้เลือกกะและ Line</span>`;
    btnLabel = 'เลือกกะ / Line';
  }

  const todayTasks = (state.leaderDashData?.rules || []).filter(r => rulesMatchToday(r)).length;
  $('#ldHeader').innerHTML = `
    <div class="ld-header-left">
      <div class="ld-greeting">สวัสดี, ${escapeHtml(user.FullName || user.Username)} 👋</div>
      <div class="ld-sub">${escapeHtml(user.Role)} · ${escapeHtml(thaiDate)}</div>
      <div style="margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        ${activeBadge}
        ${btnLabel ? `<button class="prod-change-btn" onclick="changeProdPlan()">${btnLabel}</button>` : ''}
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:10px">
      <button class="ld-refresh" onclick="loadLeaderDashboard()" title="รีเฟรช">↻</button>
      <button class="ld-bell" onclick="navigateTo('findings')" title="Finding ของฉัน">
        🔔${todayTasks > 0 ? `<span class="ld-bell-badge">${todayTasks}</span>` : ''}
      </button>
    </div>`;
}

function renderLeaderMetrics(dashData, rules, todayAudits, myFindings) {
  const rs = dashData.AuditRuleSummary || {};
  const todayMap = {};
  todayAudits.forEach(a => { todayMap[`${a.LineID}|${a.StationID}|${String(a.AuditLayer||'').toLowerCase()}`] = true; });
  const todayRules = rules.filter(r => rulesMatchToday(r));
  // Use client-computed values from filtered rules (respects production plan)
  const dueToday = todayRules.length;
  const doneToday = todayRules.filter(r => todayMap[`${r.LineID}|${r.StationID}|${r.RequiredRole.toLowerCase()}`]).length;
  const openFindings = myFindings.length;
  const compliance = dueToday > 0 ? Math.round(doneToday / dueToday * 100) : (doneToday === 0 ? 100 : 0);
  const cards = [
    { label: 'ต้องตรวจวันนี้', value: dueToday, note: 'Station (เฉพาะ Line ที่ผลิต)', cls: dueToday > 0 ? 'warn' : 'ok' },
    { label: 'ตรวจแล้ววันนี้', value: doneToday, note: `จาก ${todayRules.length} รายการ`, cls: doneToday >= todayRules.length && todayRules.length > 0 ? 'ok' : '' },
    { label: 'Finding ค้างอยู่', value: openFindings, note: 'รายการที่มอบหมายฉัน', cls: openFindings > 0 ? 'danger' : 'ok' },
    { label: 'Compliance วันนี้', value: `${compliance}%`, note: `ตรวจแล้ว ${doneToday}/${dueToday} รอบ`, cls: compliance >= 80 ? 'ok' : compliance >= 50 ? 'warn' : 'danger' }
  ];
  $('#ldMetrics').innerHTML = cards.map(c => `<div class="ld-card ${c.cls}"><div class="ld-card-label">${escapeHtml(c.label)}</div><div class="ld-card-value">${escapeHtml(String(c.value))}</div><div class="ld-card-note">${escapeHtml(c.note)}</div></div>`).join('');
}

function rulesMatchToday(rule) {
  if (!rule || (String(rule.ActiveStatus).toLowerCase() !== 'active')) return false;
  const freq = rule.Frequency || 'Daily';
  const now = new Date();
  const day = now.getDay();
  if (freq === 'Monthly') {
    return now.getDate() === Number(rule.DayOfMonth || 1);
  }
  if (freq === 'Weekly') {
    const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const selected = String(rule.DayOfWeek || '');
    return selected.split(',').some(v => {
      const t = v.trim();
      return t === String(day) || t.slice(0,3).toLowerCase() === names[day].toLowerCase();
    });
  }
  // Daily — working days (Mon-Fri) unless DayOfWeek specified
  if (rule.DayOfWeek) {
    const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return rule.DayOfWeek.split(',').some(v => {
      const t = v.trim();
      return t === String(day) || t.slice(0,3).toLowerCase() === names[day].toLowerCase();
    });
  }
  return day !== 0 && day !== 6;
}

function renderLeaderTasks(rules, todayAudits) {
  const now = new Date();
  const today = localDateInput(now);
  const dayOfWeek = now.getDay(); // 0=Sun,1=Mon,...,6=Sat
  // Week Mon-Sat: Mon=1…Sat=6, Sun treated as week end
  const daysToSat = dayOfWeek === 0 ? 0 : (6 - dayOfWeek); // days remaining until Saturday
  const isSaturday = dayOfWeek === 6;

  // Build audit lookup key
  const auditKey = (a) => `${a.LineID}|${a.StationID}|${String(a.AuditLayer||'').toLowerCase()}`;
  const auditMap = {};
  todayAudits.forEach(a => { auditMap[auditKey(a)] = (auditMap[auditKey(a)] || []).concat(a.AuditDate?.slice(0,10) || today); });

  // Filter rules: for Daily show today's, for Weekly show all active weekly rules
  const relevantRules = rules.filter(r => {
    const freq = r.Frequency || 'Daily';
    if (freq === 'Daily') return rulesMatchToday(r);
    if (freq === 'Weekly') return String(r.ActiveStatus || '').toLowerCase() === 'active';
    return false;
  }).sort((a, b) => (a.LineName || a.LineID).localeCompare(b.LineName || b.LineID));

  if (!relevantRules.length) {
    $('#ldTasks').innerHTML = '<div class="empty-state">ไม่มีงานตรวจสัปดาห์นี้</div>';
    return;
  }

  // Week start (Monday)
  const weekStartDate = new Date(now); weekStartDate.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  const weekStart = localDateInput(weekStartDate);

  $('#ldTasks').innerHTML = relevantRules.map(r => {
    const freq = r.Frequency || 'Daily';
    const key = `${r.LineID}|${r.StationID}|${r.RequiredRole.toLowerCase()}`;
    const auditDates = auditMap[key] || [];

    let done, badge, note;
    if (freq === 'Daily') {
      done = auditDates.includes(today);
      badge = done ? '<span class="ld-badge done">✅ ตรวจแล้ว</span>' : '<span class="ld-badge pending">🕐 รอตรวจ</span>';
      note = `${r.RequiredRole} · รายวัน`;
    } else {
      // Weekly: done if any audit this week (Mon-Sat)
      done = auditDates.some(d => d >= weekStart && d <= today);
      if (done) {
        badge = '<span class="ld-badge done">✅ ตรวจแล้วสัปดาห์นี้</span>';
        note = `${r.RequiredRole} · รายสัปดาห์`;
      } else if (isSaturday) {
        badge = '<span class="ld-badge overdue">⚠️ วันสุดท้าย! ต้องตรวจวันนี้</span>';
        note = `${r.RequiredRole} · รายสัปดาห์`;
      } else {
        badge = `<span class="ld-badge pending">📅 เหลือ ${daysToSat} วัน (ถึงเสาร์)</span>`;
        note = `${r.RequiredRole} · รายสัปดาห์`;
      }
    }

    const startBtn = done ? '' : `<button class="btn btn-primary btn-compact" onclick="startAuditFromDashboard('${escapeAttr(r.LineID)}','${escapeAttr(r.StationID)}','${escapeAttr(r.RequiredRole)}')">เริ่มตรวจ</button>`;
    return `<div class="ld-task-row">
      ${badge}
      <div class="ld-task-info"><div class="ld-task-name">${escapeHtml(r.LineName || r.LineID)}</div><div class="ld-task-meta">${escapeHtml(note)}</div></div>
      ${startBtn}
    </div>`;
  }).join('');
}

function shiftFindingRowHtml(f) {
  const severity = String(f.Severity || f.Priority || '').toLowerCase();
  const sevBadge = severity === 'critical' ? '<span class="ld-badge overdue">🔴 Critical</span>'
    : severity === 'major' ? '<span class="ld-badge pending">🟠 Major</span>'
    : '<span class="ld-badge done">🟡 Minor</span>';
  return `<div class="ld-finding-row ld-finding-row-clickable" onclick="openFindingForEdit('${escapeAttr(f.FindingID)}')" role="button" tabindex="0">
    ${sevBadge}
    <div class="ld-finding-info"><div class="ld-finding-name">${escapeHtml(f.ProblemDetail || f.FindingID)}</div><div class="ld-finding-meta">${escapeHtml(f.LineName || f.LineID)} / ${escapeHtml(f.StationName || f.StationID)} · ${escapeHtml(f.Category || '')}</div></div>
    <div class="ld-due-label">${escapeHtml(f.Status || 'Open')}</div>
  </div>`;
}

// Full-detail digest row for the Meeting board — same content as the TV slide
// (root cause, corrective action, photos) in the light theme. The compact
// shiftFindingRowHtml stays in use on the dashboards.
function meetingFindingBoardRowHtml(f) {
  const s = String(f.Severity || f.Priority || '').toLowerCase();
  const sev = s === 'critical' ? '🔴' : s === 'major' ? '🟠' : '🟡';
  const sevCls = severityClass(f.Severity || f.Priority);
  const overdue = String(f.OverdueFlag || '').toLowerCase() === 'yes';
  const statusLabel = overdue ? `เกิน Due ${Number(f.DaysOverdue) || 0} วัน` : (f.Status || 'Open');
  const photos = [];
  const addPhotos = (csv, label) => String(csv || '').split(',').map(u => u.trim()).filter(Boolean).forEach((u, i, arr) => {
    const caption = arr.length > 1 ? `${label} ${i + 1}` : label;
    photos.push(`<a href="${escapeAttr(u)}" data-photo-url="${escapeAttr(u)}" class="finding-photo-thumb photo-link-trigger" rel="noopener"><img src="${escapeAttr(driveThumbnailUrl_(u, 300))}" alt="${escapeAttr(caption)}" loading="lazy"><span>${escapeHtml(caption)}</span></a>`);
  });
  addPhotos(f.BeforePhotoURL, 'Before');
  addPhotos(f.AfterPhotoURL, 'After');
  const metaParts = [`${escapeHtml(f.LineName || f.LineID || '-')} / ${escapeHtml(f.StationName || f.StationID || '-')}`];
  if (f.Category) metaParts.push(escapeHtml(f.Category));
  const pic = f.AssignmentDisplay || f.PICName || f.AssignedToName || f.ResponsiblePerson;
  if (pic && pic !== '-') metaParts.push(`ผู้รับผิดชอบ ${escapeHtml(pic)}`);
  if (f.DueDate) metaParts.push(`Due ${formatDate(f.DueDate)}`);
  return `<div class="mtg-fd-card ${sevCls}${overdue ? ' overdue' : ''}">
    <div class="mtg-fd-top">
      <span class="mtg-fd-sev">${sev}</span>
      <div class="mtg-fd-name">${escapeHtml(f.ProblemDetail || f.FindingID)}</div>
      <span class="status-badge ${overdue ? 'status-overdue' : statusClass(f.Status)}">${escapeHtml(statusLabel)}</span>
    </div>
    <div class="mtg-fd-meta">${metaParts.join(' · ')}</div>
    ${f.RootCause ? `<div class="mtg-fd-extra">🔍 สาเหตุ: ${escapeHtml(f.RootCause)}</div>` : ''}
    ${f.CorrectiveAction ? `<div class="mtg-fd-extra">🛠 แนวทางแก้ไข: ${escapeHtml(f.CorrectiveAction)}</div>` : ''}
    ${photos.length ? `<div class="finding-photos mtg-fd-photos">${photos.join('')}</div>` : ''}
    <div class="mtg-fd-actions"><button class="btn btn-outline btn-compact" onclick="openFindingForEdit('${escapeAttr(f.FindingID)}')">เปิด Finding</button></div>
  </div>`;
}

function renderMgrShiftDigest(digest, containerId = 'mgrShiftDigest') {
  const el = $(`#${containerId}`);
  if (!el) return;
  if (!digest) { el.innerHTML = emptyHtml('ไม่มีข้อมูล'); return; }
  const rowFn = containerId === 'meetingShiftDigest' ? meetingFindingBoardRowHtml : shiftFindingRowHtml;
  const sections = [
    { key: 'today', label: '📅 วันนี้' },
    { key: 'yesterday', label: '📅 เมื่อวาน' },
    { key: 'sevenDaysAgo', label: '📅 7 วันก่อน' }
  ];
  el.innerHTML = sections.map(s => {
    const bucket = digest[s.key] || {};
    const dateLabel = bucket.date ? formatDate(bucket.date) : '';
    const groups = bucket.shiftGroups || [];
    const body = !groups.length
      ? '<div class="empty-state">✅ ไม่มี Finding เปิดในวันนี้</div>'
      : groups.map(g => `
        <div class="mgr-shift-group">
          <div class="mgr-shift-group-title">🕐 ${escapeHtml(g.shift)} <span class="mgr-shift-count">${g.count} รายการ</span></div>
          ${g.findings.map(rowFn).join('')}
        </div>`).join('');
    return `
      <div class="mgr-shift-day">
        <div class="mgr-shift-day-title">${escapeHtml(s.label)} <span class="mgr-shift-day-date">(${escapeHtml(dateLabel)})</span> — ${bucket.totalCount || 0} Finding</div>
        ${body}
      </div>`;
  }).join('');
}

function populateShiftDigestPicFilter(selectId = 'mgrShiftDigestPic') {
  const select = $(`#${selectId}`);
  if (!select) return;
  const picUsers = (state.masterData.users || [])
    .filter(u => (!u.ActiveStatus || String(u.ActiveStatus).toLowerCase() === 'active') && u.Role && !EXCLUDED_ASSIGNABLE_ROLES.has(u.Role))
    .slice()
    .sort((a, b) => String(a.FullName || '').localeCompare(String(b.FullName || ''), 'th'))
    .map(u => ({ UserID: u.UserID, PicLabel: `${u.FullName || u.Username} (${u.Role})` }));
  populateSelect(`#${selectId}`, picUsers, 'UserID', 'PicLabel', 'ผู้รับผิดชอบ: ทั้งหมด');
}

async function loadFindingShiftDigest(containerId = 'mgrShiftDigest', selectId = 'mgrShiftDigestPic', prefetched = null) {
  const el = $(`#${containerId}`);
  if (!el) return;
  if (!prefetched) el.innerHTML = '<div class="empty-state">กำลังโหลด...</div>';
  try {
    if (!(state.masterData.users || []).length) await ensureMasterDataLoaded(false);
    populateShiftDigestPicFilter(selectId);
    const picUserId = $(`#${selectId}`)?.value || '';
    // A prefetched digest is always the unfiltered one, so only reuse it when the
    // PIC filter is empty — otherwise fetch the filtered view.
    const digest = (prefetched && !picUserId)
      ? prefetched
      : await apiCall('getFindingShiftDigest', picUserId ? { picUserId } : {});
    // Meeting page keeps the digest around so TV mode can show it as a final slide
    if (containerId === 'meetingShiftDigest') state.meetingFindingDigest = digest;
    renderMgrShiftDigest(digest, containerId);
  } catch (error) {
    el.innerHTML = emptyHtml(error.message || 'โหลด Finding ไม่สำเร็จ');
  }
}

/** Viewer role (morning-meeting account): sidebar trimmed to Dashboard + Finding Tracking only.
 * Only ever ADDS 'hidden' to other nav items — never removes it, so it can't
 * undo applyPermissionVisibility()'s permission-based hiding for other roles. */
const VIEWER_ALLOWED_PAGES_ = new Set(['dashboard', 'findings', 'meeting']);
function applyViewerAccountRestrictions() {
  const isViewer = state.user?.Role === 'Viewer';
  if (isViewer) {
    $$('.main-nav .nav-item').forEach(btn => {
      if (!VIEWER_ALLOWED_PAGES_.has(btn.dataset.page)) btn.classList.add('hidden');
    });
  }
  const section = $('#mgrShiftDigestSection');
  if (section) section.classList.toggle('hidden', !isViewer);
}

function renderLeaderFindings(findings) {
  // Update section title based on role
  const role = state.user?.Role || '';
  const titleEl = $('#ldFindingTitle');
  if (titleEl) {
    if (role === 'Supervisor' || role === 'Manager') {
      titleEl.textContent = '⚠️ Finding รอ Verify + ที่ฉันรับผิดชอบ';
    } else {
      titleEl.textContent = '⚠️ Finding ที่ฉันรับผิดชอบ';
    }
  }
  if (!findings.length) {
    $('#ldFindings').innerHTML = '<div class="empty-state">✅ ไม่มี Finding ค้างอยู่</div>';
    return;
  }
  const now = new Date(); now.setHours(0,0,0,0);
  $('#ldFindings').innerHTML = findings.map(f => {
    const status = f.Status || 'Open';
    const overdue = String(f.OverdueFlag).toLowerCase() === 'yes';
    const dueDate = f.DueDate || '';
    let daysLabel = '';
    let dueCls = '';
    if (dueDate) {
      const due = new Date(dueDate); due.setHours(0,0,0,0);
      const diff = Math.round((due - now) / 86400000);
      daysLabel = diff < 0 ? `เกิน ${Math.abs(diff)} วัน` : diff === 0 ? 'Due วันนี้' : `เหลือ ${diff} วัน`;
      dueCls = diff < 0 ? 'color:var(--red);font-weight:800' : diff <= 3 ? 'color:var(--orange);font-weight:700' : '';
    }
    const badge = overdue ? '<span class="ld-badge overdue">🔴 เกิน Due</span>'
      : status.toLowerCase().includes('progress') ? '<span class="ld-badge pending">🔧 กำลังแก้</span>'
      : '<span class="ld-badge done">📋 ' + escapeHtml(status) + '</span>';
    return `<div class="ld-finding-row">
      ${badge}
      <div class="ld-finding-info"><div class="ld-finding-name">${escapeHtml(f.ProblemDetail || f.FindingID)}</div><div class="ld-finding-meta">${escapeHtml(f.LineName || f.LineID)} / ${escapeHtml(f.StationName || f.StationID)}</div></div>
      <div class="ld-due-label" style="${dueCls}">${escapeHtml(formatDate(dueDate))}<div class="ld-days">${escapeHtml(daysLabel)}</div></div>
      <button class="btn btn-outline btn-compact" onclick="openFindingForEdit('${escapeAttr(f.FindingID)}')">อัปเดต</button>
    </div>`;
  }).join('');
}

function startAuditFromDashboard(lineId, stationId, role) {
  navigateTo('audit').then(() => {
    const lineEl = $('#auditLine');
    if (lineEl) { lineEl.value = lineId; lineEl.dispatchEvent(new Event('change')); }
    setTimeout(() => {
      // Line-level: station is always ALL
      $('#auditStation').value = 'ALL';
      const layerEl = $('#auditLayer');
      if (layerEl) {
        const opt = Array.from(layerEl.options).find(o => o.value.toLowerCase() === role.toLowerCase());
        if (opt) { layerEl.value = opt.value; }
      }
    }, 400);
  });
}

// navigateTo('findings') kicks off loadFindings() without awaiting it (intentionally,
// so master data and the finding list load in parallel) — on a cold first load that
// call can take longer than any fixed delay, so poll for the row instead of guessing.
function waitForFindingLoaded(findingId, timeoutMs = 6000) {
  return new Promise(resolve => {
    const start = Date.now();
    const check = () => {
      if (state.findings.some(f => f.FindingID === findingId)) return resolve(true);
      if (Date.now() - start >= timeoutMs) return resolve(false);
      setTimeout(check, 150);
    };
    check();
  });
}

async function openFindingForEdit(findingId) {
  await navigateTo('findings');
  const found = await waitForFindingLoaded(findingId);
  if (found) { openFindingEditor(findingId); return; }
  showToast('โหลดข้อมูล Finding ยังไม่เสร็จ กรุณากดใหม่อีกครั้ง', 'warning');
}

// ===== Director Dashboard =====
if (!state.dirData) state.dirData = { data: null, months: 3 };

async function loadDirectorDashboard(months) {
  if (months) state.dirData.months = months;
  const m = state.dirData.months;
  const dirKey = `dir_dash_${m}`;
  const dirCached = GASCache.get(dirKey);
  if (dirCached && !months) {
    state.dirData.data = dirCached;
    renderDirHeader(dirCached); renderDirKPIs(dirCached); renderDirTrend(dirCached); renderDirChronic(dirCached); renderDirLayer(dirCached); return;
  }
  $('#dirKPIs').innerHTML = Array.from({length:3},()=>'<div class="dir-kpi-card skeleton-card" style="min-height:120px"></div>').join('');
  $('#dirTrend').innerHTML = '<div class="dir-trend-placeholder">กำลังโหลด...</div>';
  $('#dirChronic').innerHTML = '<div class="empty-state">กำลังโหลด...</div>';
  $('#dirLayer').innerHTML = '<div class="empty-state">กำลังโหลด...</div>';
  try {
    const data = await cachedApiCall('getDirectorDashboardData', { months: m }, dirKey, 5);
    state.dirData.data = data;
    renderDirHeader(data);
    renderDirKPIs(data);
    renderDirTrend(data);
    renderDirChronic(data);
    renderDirLayer(data);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function monthsAgoToYYYYMM(monthsBack) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - (monthsBack - 1));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function dirSetStartMonth() {
  const val = $('#dirStartMonth').value; // YYYY-MM
  if (!val) return;
  const [y, mo] = val.split('-').map(Number);
  const now = new Date();
  const diffMonths = (now.getFullYear() - y) * 12 + (now.getMonth() - (mo - 1)) + 1;
  loadDirectorDashboard(Math.min(Math.max(diffMonths, 1), 12));
}

function renderDirHeader(data) {
  const user = state.user;
  const ts = new Date().toLocaleString('th-TH', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  const m = data.months;
  const currentYYYYMM = monthsAgoToYYYYMM(1);
  $('#dirHeader').innerHTML = `
    <div>
      <div class="dir-title">LPA Overview Dashboard</div>
      <div class="dir-sub">${escapeHtml(user.Department||user.FullName||'Plant')}</div>
    </div>
    <div class="dir-period-row">
      <button class="dir-period-btn ${m===1?'active':''}" onclick="loadDirectorDashboard(1)">1 เดือน</button>
      <button class="dir-period-btn ${m===3?'active':''}" onclick="loadDirectorDashboard(3)">3 เดือน</button>
      <button class="dir-period-btn ${m===6?'active':''}" onclick="loadDirectorDashboard(6)">6 เดือน</button>
      <span style="display:flex;align-items:center;gap:6px;font-size:.78rem">
        เดือนเริ่มต้น
        <input type="month" id="dirStartMonth" value="${escapeAttr(monthsAgoToYYYYMM(m))}" max="${escapeAttr(currentYYYYMM)}"
               style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:7px;padding:4px 8px;font-size:.78rem;min-height:auto;width:130px"
               onchange="dirSetStartMonth()">
      </span>
      <span class="dir-ts">อัปเดต ${escapeHtml(ts)}</span>
    </div>`;
}

function renderDirKPIs(data) {
  const kpis = data.overallKPIs || {};
  const spark = data.sparklineData || [];
  const TARGET = 90;

  function trendArrow(curr, prev) {
    if (prev == null || prev === curr) return { icon:'→', cls:'flat', label:'' };
    const diff = (curr - prev).toFixed(1);
    return curr >= prev ? { icon:'▲', cls:'up', label:`+${diff}%` } : { icon:'▼', cls:'down', label:`${diff}%` };
  }

  function sparkSVG(points, color) {
    if (!points.length || points.every(p => p == null)) return '';
    const vals = points.map(p => p != null ? p : 0);
    const w = 100, h = 30, max = 100, min = 0;
    const xStep = vals.length > 1 ? w / (vals.length - 1) : w;
    const pts = vals.map((v, i) => `${(i * xStep).toFixed(1)},${(h - (v - min) / (max - min) * h).toFixed(1)}`).join(' ');
    const targetY = (h - (TARGET - min) / (max - min) * h).toFixed(1);
    return `<svg class="dir-sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <line x1="0" y1="${targetY}" x2="${w}" y2="${targetY}" stroke="#d32929" stroke-width="0.8" stroke-dasharray="3,2"/>
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
  }

  const compliance = kpis.compliance ?? 0;
  const compCls = compliance >= TARGET ? 'green' : compliance >= 70 ? 'orange' : 'red';
  const compTrend = trendArrow(compliance, kpis.prevCompliance);
  const compSpark = sparkSVG(spark.map(s => s.compliance), compliance >= TARGET ? '#16824b' : '#d32929');

  const resRate = kpis.resolutionRate;
  const resCls = resRate >= 80 ? 'green' : resRate >= 50 ? 'orange' : 'red';
  const resTrend = trendArrow(resRate, kpis.prevResolutionRate);

  const roles = ['Leader','Supervisor','Manager'];
  const roleColors = { Leader:'var(--blue)', Supervisor:'var(--orange)', Manager:'var(--navy)' };
  const layerData = data.layerSummary || [];
  const maxComp = Math.max(1, ...layerData.map(l => l.compliance));
  const miniBars = roles.map(role => {
    const row = layerData.find(l => l.role === role) || {};
    const pct = row.compliance ?? 0;
    const barH = Math.max(3, Math.round(pct / maxComp * 28));
    const color = roleColors[role] || 'var(--blue)';
    return `<div class="dir-mini-bar-wrap"><div class="dir-mini-bar" style="height:${barH}px;background:${color}" title="${role}: ${pct}%"></div><div class="dir-mini-bar-label">${role.slice(0,3)}</div></div>`;
  }).join('');

  const overdue = data.overdueSummary || { total: 0, bySeverity: [] };
  const overdueCls = overdue.total > 0 ? 'red' : 'green';
  const overdueChips = (overdue.bySeverity || []).map(s =>
    `<span class="severity-chip ${severityClass(s.severity)}">${escapeHtml(s.severity)}: ${s.count}</span>`).join('');

  $('#dirKPIs').innerHTML = `
    <div class="dir-kpi-card">
      <div class="dir-kpi-label">Overall Compliance</div>
      <div class="dir-kpi-value ${compCls}">${compliance}%</div>
      <div class="dir-kpi-trend ${compTrend.cls}">${compTrend.icon} ${compTrend.label || 'เทียบกับช่วงก่อน'}</div>
      ${compSpark}
      <div class="dir-target-note">Target: ${TARGET}% ${compliance < TARGET ? '⚠️ ต่ำกว่า Target' : '✅ ผ่าน Target'}</div>
    </div>
    <div class="dir-kpi-card">
      <div class="dir-kpi-label">Finding Resolution Rate</div>
      <div class="dir-kpi-value ${resCls}">${resRate != null ? resRate+'%' : '-'}</div>
      <div class="dir-kpi-trend ${resTrend.cls}">${resTrend.icon} ${resTrend.label || 'เทียบกับช่วงก่อน'}</div>
      <div class="dir-target-note">% Finding ที่ปิดได้ตรงเวลา</div>
    </div>
    <div class="dir-kpi-card">
      <div class="dir-kpi-label">Audit Completion by Layer</div>
      <div class="dir-kpi-value">${compliance}%</div>
      <div class="dir-mini-bars">${miniBars}</div>
      <div class="dir-target-note">Leader / Supervisor / Manager</div>
    </div>
    <div class="dir-kpi-card">
      <div class="dir-kpi-label">Overdue Finding</div>
      <div class="dir-kpi-value ${overdueCls}">${overdue.total}</div>
      <div class="dir-target-note">${overdue.total > 0 ? '⚠️ ต้องเร่งติดตาม' : '✅ ไม่มีค้างเกิน Due'}</div>
      <div class="dir-overdue-chips">${overdueChips}</div>
    </div>`;
}

function renderDirTrend(data) {
  const monthly = data.monthlyCompliance || [];
  const lines = data.lines || [];
  if (monthly.length < 2) {
    $('#dirTrend').innerHTML = '<div class="dir-trend-placeholder">ยังไม่มีข้อมูลเพียงพอ · ต้องการอย่างน้อย 2 เดือน</div>';
    return;
  }
  const W = 560, H = 180, PL = 40, PR = 10, PT = 14, PB = 30;
  const chartW = W - PL - PR, chartH = H - PT - PB;
  const months = monthly.map(m => m.month);
  const TARGET = 90;

  // Collect per-line data across months
  const lineColors = ['#1769aa','#16824b','#d56a00','#8f1111','#7b3fa0','#0b6e6e','#b85c00','#456b00'];
  const lineMap = {};
  monthly.forEach(m => {
    Object.keys(m.byLine || {}).forEach(lid => {
      if (!lineMap[lid]) lineMap[lid] = {};
      lineMap[lid][m.month] = m.byLine[lid].expected ? Math.round(m.byLine[lid].done*1000/m.byLine[lid].expected)/10 : 100;
    });
  });

  function xPos(i) { return PL + (months.length > 1 ? i / (months.length - 1) * chartW : chartW / 2); }
  function yPos(pct) { return PT + chartH - (pct / 100 * chartH); }

  // Grid lines + labels
  const yGridLines = [0,25,50,75,100].map(v => {
    const y = yPos(v);
    return `<line x1="${PL}" y1="${y}" x2="${W-PR}" y2="${y}" stroke="#e5ebef" stroke-width="0.8"/>
            <text x="${PL-4}" y="${y+4}" text-anchor="end" font-size="9" fill="#657383">${v}</text>`;
  }).join('');
  const xLabels = months.map((m, i) => {
    const x = xPos(i);
    const label = m.slice(0,4) + '/' + m.slice(4,6);
    return `<text x="${x}" y="${H-4}" text-anchor="middle" font-size="9" fill="#657383">${label}</text>`;
  }).join('');
  const targetY = yPos(TARGET);
  const targetLine = `<line x1="${PL}" y1="${targetY}" x2="${W-PR}" y2="${targetY}" stroke="#d32929" stroke-width="1" stroke-dasharray="5,3"/>
    <text x="${W-PR+2}" y="${targetY+3}" font-size="8" fill="#d32929">T</text>`;

  // Line paths
  const linePaths = lines.slice(0,8).map((line, li) => {
    const color = lineColors[li % lineColors.length];
    const pts = months.map((m, i) => {
      const v = lineMap[line.lineId] && lineMap[line.lineId][m] != null ? lineMap[line.lineId][m] : null;
      return v != null ? `${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}` : null;
    }).filter(Boolean);
    if (pts.length < 1) return '';
    return `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');

  const legend = lines.slice(0,8).map((line, li) => {
    const color = lineColors[li % lineColors.length];
    return `<div class="dir-legend-item"><div class="dir-legend-dot" style="background:${color}"></div>${escapeHtml(line.lineName)}</div>`;
  }).join('');

  $('#dirTrend').innerHTML = `<div class="dir-trend-wrap">
    <svg class="dir-svg-chart" viewBox="0 0 ${W} ${H}" style="max-height:220px">
      ${yGridLines}${xLabels}${targetLine}${linePaths}
    </svg>
    <div class="dir-legend">${legend}
      <div class="dir-legend-item"><div class="dir-legend-dot" style="background:#d32929;border-radius:0;height:2px;width:14px"></div>Target 90%</div>
    </div>
  </div>`;
}

function renderDirChronic(data) {
  const chronic = data.chronicFindings || [];
  if (!chronic.length) { $('#dirChronic').innerHTML = '<div class="empty-state">ไม่พบ Finding ในช่วงเวลานี้</div>'; return; }
  const rows = chronic.map(c => {
    const warn = c.avgCloseDays != null && c.avgCloseDays > 7;
    const avgStr = c.avgCloseDays != null ? `${c.avgCloseDays} วัน` : '-';
    return `<tr class="${warn?'chronic-warn':''}">
      <td><strong>${escapeHtml(c.category)}</strong></td>
      <td class="num">${c.count}</td>
      <td>${escapeHtml(c.topLineName||c.topLineId||'-')}</td>
      <td class="num ${warn?'':''}"><span style="${warn?'color:var(--red);font-weight:900':''}">${avgStr}</span></td>
      <td class="num">${c.openCount}</td>
    </tr>`;
  }).join('');
  $('#dirChronic').innerHTML = `<table class="dir-data-table">
    <thead><tr><th>ประเภท Finding</th><th class="num">ครั้ง</th><th>Line ที่พบบ่อย</th><th class="num">Avg Close</th><th class="num">ยังเปิด</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="font-size:.72rem;color:var(--muted);padding:8px 12px">⚠️ แถวสีแดง = avg close time เกิน 7 วัน</div>`;
}

function renderDirLayer(data) {
  const layers = data.layerSummary || [];
  if (!layers.length) { $('#dirLayer').innerHTML = '<div class="empty-state">ไม่มีข้อมูล</div>'; return; }
  const rows = layers.map(l => {
    const compCls = l.compliance >= 90 ? 'color:var(--green)' : l.compliance >= 70 ? 'color:var(--orange)' : 'color:var(--red)';
    const otCls = l.onTimeRate >= 90 ? 'color:var(--green)' : l.onTimeRate >= 70 ? 'color:var(--orange)' : 'color:var(--red)';
    return `<tr>
      <td><strong>${escapeHtml(l.role)}</strong></td>
      <td class="num">${l.done}/${l.expected}</td>
      <td class="num"><span style="${compCls};font-weight:900">${l.compliance}%</span></td>
      <td class="num"><span style="${otCls};font-weight:900">${l.onTimeRate}%</span></td>
      <td class="num">${l.findingCount}</td>
    </tr>`;
  }).join('');
  $('#dirLayer').innerHTML = `<table class="dir-data-table">
    <thead><tr><th>Role</th><th class="num">Audit Done/Total</th><th class="num">Compliance</th><th class="num">On-Time Rate</th><th class="num">Finding ที่พบ</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ===== Manager Dashboard =====
if (!state.mgrData) state.mgrData = { complianceData: null, dashData: null, findings: [], period: 'month', selectedLine: '', startDate: '', endDate: '' };

async function loadManagerDashboard(startDate, endDate) {
  if (state.user?.Role === 'Viewer') loadFindingShiftDigest();
  const today = localDateInput(new Date());
  // Set or compute date range
  if (startDate && endDate) {
    state.mgrData.startDate = startDate;
    state.mgrData.endDate = endDate;
    state.mgrData.period = 'custom';
  } else if (!state.mgrData.startDate) {
    // Default: this month
    state.mgrData.startDate = today.slice(0, 7) + '-01';
    state.mgrData.endDate = today;
    state.mgrData.period = 'month';
  }
  const sd = state.mgrData.startDate, ed = state.mgrData.endDate;
  const mgrKey = `mgr_comp_${sd}_${ed}`;
  const mgrCached = GASCache.get(mgrKey);
  if (mgrCached && !startDate) {
    try {
      const { complianceData, dashData, findings } = mgrCached;
      state.mgrData.complianceData = complianceData; state.mgrData.dashData = dashData; state.mgrData.findings = findings;
      renderMgrHeader(); renderMgrAuditReminder(dashData); renderMgrMetrics(complianceData, dashData); renderMgrBarChart(complianceData.byLine || []);
      renderMgrHeatmap(complianceData.byStationRole || [], state.mgrData.selectedLine); renderMgrEscalation(findings);
      renderMgrFindingSummary(findings, sd, ed); renderMgr5m1eChart(findings, sd, ed); renderMgrOpenFindingsTable(findings, sd, ed);
      return;
    } catch (_) { GASCache.invalidate(mgrKey); }
  }
  $('#mgrHeader').innerHTML = '<div class="mgr-header-left"><div class="ld-greeting">กำลังโหลด Dashboard...</div></div>';
  $('#mgrMetrics').innerHTML = Array.from({length:4}, () => '<div class="ld-card skeleton-card" style="min-height:90px"></div>').join('');
  $('#mgrBarChart').innerHTML = '<div class="empty-state">กำลังโหลด...</div>';
  $('#mgrHeatmap').innerHTML = '<div class="empty-state">กำลังโหลด...</div>';
  $('#mgrEscalation').innerHTML = '<div class="empty-state">กำลังโหลด...</div>';
  try {
    const [complianceData, dashData, findingsData, todayAuditsData] = await Promise.all([
      cachedApiCall('getManagerComplianceData', { startDate: sd, endDate: ed }, mgrKey, 3),
      cachedApiCall('getDashboard', {}, 'dashboard', 1),
      apiCall('getFindings', { limit: 500 }).catch(() => ({ findings: [] })),
      apiCall('getAuditList', { limit: 200 }).catch(() => ({ audits: [] }))
    ]);
    state.mgrData.complianceData = complianceData;
    state.mgrData.dashData = dashData;
    state.mgrData.findings = findingsData.findings || [];
    // Populate line selector for heatmap
    const byStationRole = complianceData.byStationRole || [];
    const lineIds = [...new Set(byStationRole.map(r => r.lineId))].sort();
    const lineNames = {};
    (complianceData.byLine || []).forEach(l => { lineNames[l.lineId] = l.lineName; });
    const heatmapSel = $('#mgrHeatmapLine');
    if (heatmapSel) {
      heatmapSel.innerHTML = lineIds.map(lid => `<option value="${escapeAttr(lid)}">${escapeHtml(lineNames[lid] || lid)}</option>`).join('');
      if (!state.mgrData.selectedLine || !lineIds.includes(state.mgrData.selectedLine)) {
        state.mgrData.selectedLine = lineIds[0] || '';
      }
      heatmapSel.value = state.mgrData.selectedLine;
    }
    renderMgrHeader();
    renderMgrAuditReminder(dashData);
    renderMgrMetrics(complianceData, dashData);
    renderMgrBarChart(complianceData.byLine || []);
    renderMgrHeatmap(complianceData.byStationRole || [], state.mgrData.selectedLine);
    renderMgrEscalation(state.mgrData.findings);
    renderMgrFindingSummary(state.mgrData.findings, sd, ed);
    renderMgr5m1eChart(state.mgrData.findings, sd, ed);
    renderMgrOpenFindingsTable(state.mgrData.findings, sd, ed);
    renderTodayAudits(todayAuditsData.audits || [], '#mgrTodayAudits');
    GASCache.set(mgrKey, { complianceData, dashData, findings: state.mgrData.findings }, 3);
  } catch (error) {
    $('#mgrHeader').innerHTML = `<div class="mgr-header-left"><div class="ld-greeting">❌ โหลดไม่สำเร็จ</div><div class="ld-sub">${escapeHtml(error.message)}</div></div><button class="mgr-export-btn" onclick="loadManagerDashboard()">↻ ลองใหม่</button>`;
    ['#mgrMetrics','#mgrBarChart','#mgrHeatmap','#mgrEscalation'].forEach(s => { const el = $(s); if (el) el.innerHTML = ''; });
    showToast(error.message, 'error');
  }
}

function renderMgrHeader() {
  const user = state.user;
  const today = localDateInput(new Date());
  const sd = state.mgrData.startDate || today.slice(0,7) + '-01';
  const ed = state.mgrData.endDate || today;
  const thisMonthStart = today.slice(0,7) + '-01';
  const thisWeekStart = (() => { const d = new Date(); d.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay()-1)); return localDateInput(d); })();
  const isMonth = sd === thisMonthStart && ed === today;
  const isWeek = sd === thisWeekStart && ed === today;
  $('#mgrHeader').innerHTML = `
    <div class="mgr-header-left">
      <div class="ld-greeting">👔 ${escapeHtml(user.FullName || user.Username)} · ${escapeHtml(user.Role === 'Customer' ? 'Customer' : user.Role === 'Viewer' ? 'Viewer' : 'Manager')}</div>
      <div class="ld-sub">Plant Overview Dashboard</div>
    </div>
    <div class="mgr-period-row">
      <button class="mgr-period-btn ${isMonth?'active':''}" onclick="mgrSetPreset('month')">เดือนนี้</button>
      <button class="mgr-period-btn ${isWeek?'active':''}" onclick="mgrSetPreset('week')">สัปดาห์นี้</button>
      <span style="display:flex;align-items:center;gap:6px;font-size:.8rem">
        <input type="date" id="mgrDateStart" value="${escapeAttr(sd)}" max="${escapeAttr(today)}"
               style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:7px;padding:4px 8px;font-size:.78rem;min-height:auto;width:130px"
               onchange="mgrApplyDateRange()">
        <span style="opacity:.7">–</span>
        <input type="date" id="mgrDateEnd" value="${escapeAttr(ed)}" max="${escapeAttr(today)}"
               style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:7px;padding:4px 8px;font-size:.78rem;min-height:auto;width:130px"
               onchange="mgrApplyDateRange()">
      </span>
      <button class="mgr-export-btn" onclick="window.print()">⬇ Export PDF</button>
    </div>`;
}

function mgrSetPreset(preset) {
  const today = localDateInput(new Date());
  let sd;
  if (preset === 'week') {
    const d = new Date(); d.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay()-1));
    sd = localDateInput(d);
  } else {
    sd = today.slice(0,7) + '-01';
  }
  GASCache.invalidatePrefix('mgr_comp_');
  loadManagerDashboard(sd, today);
}

function mgrApplyDateRange() {
  const sd = $('#mgrDateStart')?.value;
  const ed = $('#mgrDateEnd')?.value;
  if (sd && ed && sd <= ed) {
    GASCache.invalidatePrefix('mgr_comp_');
    loadManagerDashboard(sd, ed);
  }
}

function renderMgrAuditReminder(dashData) {
  const section = $('#mgrAuditReminderSection');
  const tasksEl = $('#mgrAuditReminderTasks');
  if (!section || !tasksEl) return;
  const reminder = dashData && dashData.ManagerAuditReminder;
  const lines = (reminder && reminder.Lines) || [];
  if (!reminder || !lines.length) {
    section.classList.add('hidden');
    tasksEl.innerHTML = '';
    return;
  }
  section.classList.remove('hidden');
  const deadlineLabel = formatDate(reminder.DeadlineDate);
  tasksEl.innerHTML = lines.map(l => {
    let badge;
    if (l.Done) {
      badge = '<span class="ld-badge done">✅ ตรวจแล้วเดือนนี้</span>';
    } else if (reminder.Overdue) {
      badge = '<span class="ld-badge overdue">⚠️ เลยกำหนดแล้ว!</span>';
    } else {
      badge = `<span class="ld-badge pending">📅 เหลือ ${reminder.DaysLeft} วัน (ถึง ${deadlineLabel})</span>`;
    }
    const startBtn = l.Done ? '' : `<button class="btn btn-primary btn-compact" onclick="startAuditFromDashboard('${escapeAttr(l.LineID)}','ALL','Manager')">เริ่มตรวจ</button>`;
    return `<div class="ld-task-row">
      ${badge}
      <div class="ld-task-info"><div class="ld-task-name">${escapeHtml(l.LineName)}</div><div class="ld-task-meta">Manager · รายเดือน</div></div>
      ${startBtn}
    </div>`;
  }).join('');
}

function findingInDateRange(f, sd, ed) {
  const d = String(f.FoundDate || '').slice(0, 10);
  return d && d >= sd && d <= ed;
}

function renderMgrFindingSummary(findings, sd, ed) {
  const el = $('#mgrFindingSummary');
  if (!el) return;
  const periodDays = Math.round((new Date(ed) - new Date(sd)) / 86400000) + 1;
  const prevEnd = new Date(sd); prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - periodDays + 1);
  const prevSd = localDateInput(prevStart), prevEd = localDateInput(prevEnd);

  const curr = (findings || []).filter(f => findingInDateRange(f, sd, ed));
  const prev = (findings || []).filter(f => findingInDateRange(f, prevSd, prevEd));

  const isClosed = f => String(f.Status || '').toLowerCase() === 'closed';
  const isInProgress = f => ['in progress', 'on going', 'ongoing', 'assigned'].includes(String(f.Status || '').toLowerCase());
  const isOverdue = f => String(f.OverdueFlag || '').toLowerCase() === 'yes';

  const metrics = [
    { label: 'Finding เปิดใหม่', curr: curr.length, prev: prev.length, goodWhenUp: false },
    { label: 'กำลังดำเนินการ', curr: curr.filter(isInProgress).length, prev: prev.filter(isInProgress).length, goodWhenUp: false },
    { label: 'เกิน Due Date', curr: curr.filter(isOverdue).length, prev: prev.filter(isOverdue).length, goodWhenUp: false },
    { label: 'ปิดแล้ว', curr: curr.filter(isClosed).length, prev: prev.filter(isClosed).length, goodWhenUp: true }
  ];

  el.innerHTML = metrics.map(m => {
    const diff = m.curr - m.prev;
    const pct = m.prev > 0 ? Math.round((diff / m.prev) * 100) : (m.curr > 0 ? 100 : 0);
    const isGood = diff === 0 ? null : (diff > 0) === m.goodWhenUp;
    const cls = diff === 0 ? '' : (isGood ? 'ok' : 'danger');
    const arrow = diff === 0 ? '→' : (diff > 0 ? '▲' : '▼');
    return `<div class="ld-card ${cls}">
      <div class="ld-card-label">${escapeHtml(m.label)}</div>
      <div class="ld-card-value">${m.curr}</div>
      <div class="ld-card-note">${arrow} ${Math.abs(diff)} (${Math.abs(pct)}%) เทียบช่วงก่อนหน้า</div>
    </div>`;
  }).join('');
}

const FINDING_REASON_OTHER = '__other__';

const FINDING_CLOSE_REASONS = [
  'แก้ไขเรียบร้อยตามมาตรฐานแล้ว',
  'ตรวจสอบหน้างานแล้วถูกต้องตรงตามมาตรฐาน',
  'ดำเนินการแก้ไขและป้องกันการเกิดซ้ำเรียบร้อยแล้ว',
  'เปลี่ยน/ซ่อมอุปกรณ์ที่ชำรุดเรียบร้อยแล้ว',
  'มีการอบรม/กำชับพนักงานที่เกี่ยวข้องแล้ว',
  'ปรับปรุงพื้นที่ทำงานให้เป็นไปตามมาตรฐาน 5ส แล้ว'
];

const FINDING_REJECT_REASONS = [
  'รูปหลังแก้ไขไม่ชัดเจนหรือไม่ตรงจุดที่พบปัญหา',
  'แก้ไขยังไม่ครบถ้วน ไม่ตรงกับปัญหาที่พบ',
  'Root Cause ไม่สอดคล้องกับปัญหาที่พบจริง',
  'แนวทางแก้ไขไม่เพียงพอ ไม่สามารถป้องกันการเกิดซ้ำได้',
  'ข้อมูลไม่ครบถ้วน กรุณาระบุรายละเอียดเพิ่มเติม'
];

const M1E_CATEGORIES = [
  { key: 'Man', label: 'Man (คน)', color: '#1769aa' },
  { key: 'Machine', label: 'Machine (เครื่องจักร)', color: '#d56a00' },
  { key: 'Material', label: 'Material (วัตถุดิบ)', color: '#16824b' },
  { key: 'Method', label: 'Method (วิธีการ)', color: '#8e44ad' },
  { key: 'Measurement', label: 'Measurement (การวัด)', color: '#d32929' },
  { key: 'Environment', label: 'Environment (สิ่งแวดล้อม)', color: '#0b8793' }
];

// Direct Category → 5M1E mapping (ChecklistMaster Category field)
const CATEGORY_TO_5M1E = (function () {
  const m = {};
  const groups = {
    Man: ['man', 'คน', 'พนักงาน', 'ผู้ปฏิบัติงาน', 'ผู้ดำเนินการ', 'human', 'operator', 'worker', 'people', 'personnel'],
    Machine: ['machine', 'เครื่องจักร', 'อุปกรณ์', 'เครื่องมือ', 'equipment', 'tool', 'jig', 'fixture', 'device', 'robot', 'automation'],
    Material: ['material', 'วัสดุ', 'วัตถุดิบ', 'ชิ้นงาน', 'part', 'component', 'raw material', 'rawmaterial', 'stock', 'supply'],
    Method: ['method', 'วิธีการ', 'กระบวนการ', 'ขั้นตอน', 'process', 'procedure', 'work instruction', 'wi', 'standard', 'sop'],
    Measurement: ['measurement', 'การวัด', 'เครื่องมือวัด', 'gauge', 'measuring', 'inspection', 'calibration', 'sensor'],
    Environment: ['environment', 'สภาพแวดล้อม', 'สิ่งแวดล้อม', '5s', '5ส', 'safety', 'housekeeping', 'cleanliness', 'temperature', 'humidity', 'lighting']
  };
  Object.keys(groups).forEach(key => groups[key].forEach(kw => { m[kw.toLowerCase()] = key; }));
  return m;
})();

// Keyword heuristics to auto-classify an NG Finding into a 5M1E root-cause bucket
// from its Thai/English text when Category lookup yields no result.
const M1E_KEYWORDS = {
  Man: ['พนักงาน', 'ผู้ปฏิบัติงาน', 'โอเปอเรเตอร์', 'operator', 'คนงาน', 'ไม่สวม', 'ไม่ใส่', 'ไม่ปฏิบัติตาม', 'ไม่ทำตาม', 'ไม่ทราบ', 'ไม่รู้', 'ลืม', 'ขาดความรู้', 'ขาดทักษะ', 'ขาดจิตสำนึก', 'จิตสำนึก', 'อบรม', 'training', 'ทักษะ', 'skill', 'ความเข้าใจ', 'ละเลย', 'ประมาท', 'วินัย', 'ppe', 'อุปกรณ์ป้องกัน', 'แว่น', 'ถุงมือ', 'หมวก', 'รองเท้านิรภัย'],
  Machine: ['เครื่องจักร', 'เครื่องมือ', 'machine', 'อุปกรณ์', 'equipment', 'เสีย', 'ชำรุด', 'breakdown', 'มอเตอร์', 'motor', 'เซนเซอร์', 'sensor', 'jig', 'fixture', 'แม่พิมพ์', 'mold', 'สายพาน', 'conveyor', 'ปั๊ม', 'วาล์ว', 'หัวจ่าย', 'รั่ว', 'ค้าง', 'ติดขัด', 'บำรุงรักษา', 'maintenance', 'pm'],
  Material: ['วัตถุดิบ', 'material', 'ชิ้นงาน', 'ชิ้นส่วน', 'part', 'ของเสีย', 'defect', 'ลาเบล', 'label', 'ฉลาก', 'สติกเกอร์', 'แผ่นโฟม', 'โฟม', 'กล่อง', 'บรรจุภัณฑ์', 'packaging', 'วัสดุ', 'สินค้า', 'lot', 'รุ่น', 'หมดอายุ', 'ปนเปื้อน', 'สเปค', 'ผิดรุ่น', 'ผิดเบอร์'],
  Method: ['วิธีการ', 'method', 'wi', 'work instruction', 'procedure', 'ขั้นตอน', 'มาตรฐานการทำงาน', 'sop', 'process', 'กระบวนการ', 'การทำงาน', 'ไม่มีการเคลียร์', 'เคลียร์งาน', 'setup', 'ตั้งค่า', 'เอกสาร', 'บันทึก', 'ฟอร์ม', 'checklist', 'ไม่มีการบันทึก', 'ไม่ได้บันทึก', 'ขั้นตอนการ'],
  Measurement: ['วัด', 'measure', 'measurement', 'เกจ', 'gauge', 'calibration', 'สอบเทียบ', 'ค่าวัด', 'spec', 'tolerance', 'เครื่องวัด', 'ตรวจวัด', 'บันทึกค่า', 'ค่าผิด', 'เกินค่า', 'อุณหภูมิเกิน', 'แรงดัน', 'torque', 'ทอร์ค'],
  Environment: ['สิ่งแวดล้อม', 'environment', '5ส', '5s', 'พื้นที่', 'area', 'ความสะอาด', 'สะอาด', 'ระเบียบ', 'จัดเก็บ', 'เก็บ', 'housekeeping', 'แสงสว่าง', 'อุณหภูมิห้อง', 'เสียงดัง', 'ฝุ่น', 'dust', 'พื้น', 'floor', 'ทางเดิน', 'รก', 'เกะกะ', 'วางไม่เป็นที่', 'จอดไม่เป็นที่', 'ไม่เป็นระเบียบ', 'visual management', 'ป้าย', 'เส้นแบ่ง', 'ขยะ', 'รถเข็น']
};

function classify5m1e(finding) {
  // 1. Stored RootCauseCategory (set at Finding creation from Category mapping)
  const stored = String(finding.RootCauseCategory || '').trim();
  if (stored && M1E_CATEGORIES.some(c => c.key === stored)) return stored;
  // 2. Direct Category → 5M1E lookup (ChecklistMaster Category)
  const catKey = String(finding.Category || '').toLowerCase().trim();
  if (catKey) {
    if (CATEGORY_TO_5M1E[catKey]) return CATEGORY_TO_5M1E[catKey];
    const match = Object.keys(CATEGORY_TO_5M1E).find(k => catKey.indexOf(k) !== -1 || k.indexOf(catKey) !== -1);
    if (match) return CATEGORY_TO_5M1E[match];
  }
  // 3. Keyword heuristics from finding text (fallback for historical data)
  const text = [finding.ProblemDetail, finding.StandardCriteria, finding.RootCause, finding.CheckItemSnapshot, finding.CorrectiveAction]
    .map(v => String(v || '').toLowerCase()).join(' ');
  if (!text.trim()) return '';
  let best = '', bestScore = 0;
  M1E_CATEGORIES.forEach(c => {
    let score = 0;
    (M1E_KEYWORDS[c.key] || []).forEach(kw => { if (text.indexOf(kw.toLowerCase()) !== -1) score++; });
    if (score > bestScore) { bestScore = score; best = c.key; }
  });
  return bestScore > 0 ? best : '';
}

function renderMgr5m1eChart(findings, sd, ed) {
  const el = $('#mgr5m1eChart');
  if (!el) return;
  const curr = (findings || []).filter(f => findingInDateRange(f, sd, ed));
  if (!curr.length) { el.innerHTML = emptyHtml('ไม่มี Finding ในช่วงที่เลือก'); return; }
  const counts = {};
  M1E_CATEGORIES.forEach(c => { counts[c.key] = 0; });
  let unclassified = 0;
  curr.forEach(f => {
    const cat = classify5m1e(f);
    if (cat && Object.prototype.hasOwnProperty.call(counts, cat)) counts[cat]++;
    else unclassified++;
  });
  const total = curr.length;
  const max = Math.max(1, ...Object.values(counts), unclassified);
  const topKey = M1E_CATEGORIES.reduce((a, c) => counts[c.key] > counts[a] ? c.key : a, M1E_CATEGORIES[0].key);
  const rows = M1E_CATEGORIES.map(c => {
    const pct = total ? Math.round(counts[c.key] / total * 100) : 0;
    return `<div class="mgr-5m1e-row"><span class="mgr-5m1e-label">${escapeHtml(c.label)}</span><div class="mgr-5m1e-bar-wrap"><div class="mgr-5m1e-bar" style="width:${Math.max(2, counts[c.key] / max * 100)}%;background:${c.color}"></div></div><span class="mgr-5m1e-count">${counts[c.key]} (${pct}%)</span></div>`;
  }).join('') +
    (unclassified ? `<div class="mgr-5m1e-row"><span class="mgr-5m1e-label">ยังไม่ระบุ</span><div class="mgr-5m1e-bar-wrap"><div class="mgr-5m1e-bar" style="width:${Math.max(2, unclassified / max * 100)}%;background:#9aa5af"></div></div><span class="mgr-5m1e-count">${unclassified}</span></div>` : '');
  const topLabel = (M1E_CATEGORIES.find(c => c.key === topKey) || {}).label || '-';
  const insight = counts[topKey] > 0
    ? `<div class="mgr-5m1e-insight">💡 สาเหตุหลักช่วงนี้: <strong>${escapeHtml(topLabel)}</strong> (${counts[topKey]} จาก ${total} รายการ) — ควรเน้นแก้ไขที่จุดนี้ก่อน</div>`
    : '';
  el.innerHTML = rows + insight;
}

function renderMgrOpenFindingsTable(findings, sd, ed) {
  const el = $('#mgrOpenFindingsTable');
  if (!el) return;
  const rows = (findings || [])
    .filter(f => findingInDateRange(f, sd, ed) && String(f.Status || '').toLowerCase() !== 'closed')
    .sort((a, b) => String(b.FoundDate || '').localeCompare(String(a.FoundDate || '')))
    .slice(0, 20);
  if (!rows.length) { el.innerHTML = emptyHtml('ไม่มี Finding ค้างอยู่ในช่วงที่เลือก'); return; }
  el.innerHTML = tableHtml(
    ['วันที่', 'Line', 'Problem Detail', 'ผู้รับผิดชอบ', 'หมวด 5M1E', 'Status', 'Due Date'],
    rows.map(f => {
      const cat = classify5m1e(f);
      const catLabel = (M1E_CATEGORIES.find(c => c.key === cat) || {}).label || 'ยังไม่ระบุ';
      const auto = !String(f.RootCauseCategory || '').trim() && cat ? ' (auto)' : '';
      return [formatDate(f.FoundDate), f.LineName || f.LineID, f.ProblemDetail || '-', formatFindingAssignment(f), catLabel + auto, f.Status || '-', formatDate(f.DueDate)];
    })
  );
}

function renderMgrMetrics(cd, dashData) {
  const overall = cd.overall || {};
  const compliance = overall.compliance ?? 100;
  const done = overall.done || 0;
  const expected = overall.expected || 0;
  const rs = dashData.AuditRuleSummary || {};
  const openFindings = (dashData.OpenFinding || 0) + (dashData.OnGoingFinding || 0);
  const avgClose = cd.avgCloseDays ?? '-';
  const complianceCls = compliance >= 90 ? 'ok' : compliance >= 70 ? 'warn' : 'danger';
  const cards = [
    { label: 'Compliance รวม Plant', value: `${compliance}%`, note: `${done}/${expected} รอบ`, cls: complianceCls },
    { label: 'Audit ทำแล้ว / ทั้งหมด', value: `${done}/${expected}`, note: 'รอบที่ควรตรวจ', cls: '' },
    { label: 'Finding เปิดอยู่', value: openFindings, note: 'Open + In Progress', cls: openFindings > 0 ? 'danger' : 'ok' },
    { label: 'Avg Close Time', value: avgClose === '-' ? '-' : `${avgClose} วัน`, note: 'เฉลี่ยจาก Finding ที่ปิดแล้ว', cls: '' }
  ];
  $('#mgrMetrics').innerHTML = cards.map(c => `<div class="ld-card ${c.cls}"><div class="ld-card-label">${escapeHtml(c.label)}</div><div class="ld-card-value">${escapeHtml(String(c.value))}</div><div class="ld-card-note">${escapeHtml(c.note)}</div></div>`).join('');
}

function mgrComplianceCls(pct) {
  return pct >= 90 ? 'green' : pct >= 70 ? 'yellow' : 'red';
}

function renderMgrBarChart(byLine) {
  if (!byLine.length) { $('#mgrBarChart').innerHTML = '<div class="empty-state">ไม่มีข้อมูล</div>'; return; }
  const sorted = [...byLine].sort((a, b) => a.compliance - b.compliance); // worst first
  $('#mgrBarChart').innerHTML = `<div class="mgr-bar-wrap" style="padding:16px 20px">${sorted.map(l => {
    const cls = mgrComplianceCls(l.compliance);
    return `<div class="mgr-bar-row">
      <div class="mgr-bar-label" title="${escapeAttr(l.lineName)}">${escapeHtml(l.lineName)}</div>
      <div class="mgr-bar-track"><div class="mgr-bar-fill ${cls}" style="width:${l.compliance}%"></div></div>
      <div class="mgr-bar-pct ${cls}">${l.compliance}%</div>
    </div>`;
  }).join('')}</div>`;
}

function renderMgrHeatmap(byStationRole, lineId) {
  state.mgrData.selectedLine = lineId;
  const rows = byStationRole.filter(r => r.lineId === lineId);
  if (!rows.length) { $('#mgrHeatmap').innerHTML = '<div class="empty-state">ไม่มีข้อมูลสำหรับ Line นี้</div>'; $('#mgrHeatmapInsight').className = 'mgr-insight'; return; }
  const roles = [...new Set(rows.map(r => r.role))].sort();
  const stations = [...new Set(rows.map(r => r.stationId))].sort();
  const cellMap = {};
  rows.forEach(r => { cellMap[`${r.stationId}|${r.role}`] = r; });
  const headCols = roles.map(r => `<th>${escapeHtml(r)}</th>`).join('');
  const tableRows = stations.map(sid => {
    const stName = (rows.find(r => r.stationId === sid) || {}).stationName || sid;
    const cells = roles.map(role => {
      const c = cellMap[`${sid}|${role}`];
      if (!c) return `<td class="hm-empty">—</td>`;
      const cls = c.compliance >= 90 ? 'hm-green' : c.compliance >= 70 ? 'hm-yellow' : 'hm-red';
      return `<td class="${cls}" title="${escapeAttr(`${c.done}/${c.expected} รอบ`)}">${c.compliance}%</td>`;
    }).join('');
    return `<tr><td>${escapeHtml(stName)}</td>${cells}</tr>`;
  }).join('');
  $('#mgrHeatmap').innerHTML = `<div class="mgr-heatmap-wrap"><table class="mgr-hm-table"><thead><tr><th>Station</th>${headCols}</tr></thead><tbody>${tableRows}</tbody></table></div>`;
  // Insight: worst cell
  const worst = rows.reduce((a, b) => (b.expected > 0 && b.compliance < a.compliance) ? b : a, { compliance: 101 });
  const insightEl = $('#mgrHeatmapInsight');
  if (worst.compliance <= 100 && worst.expected > 0) {
    insightEl.textContent = `⚠️ ${worst.stationName} · ${worst.role} ต่ำที่สุด (${worst.compliance}%) — ควรติดตาม`;
    insightEl.className = 'mgr-insight visible';
  } else {
    insightEl.className = 'mgr-insight';
  }
}

function onMgrLineChange() {
  const lineId = $('#mgrHeatmapLine').value;
  if (state.mgrData.complianceData) {
    renderMgrHeatmap(state.mgrData.complianceData.byStationRole || [], lineId);
  }
}

function parseAuditTime_(t) {
  if (!t) return '-';
  const s = String(t);
  // "HH:mm" or "HH:mm:ss"
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) return m[1].padStart(2,'0') + ':' + m[2];
  return '-';
}

function renderTodayAudits(audits, selector) {
  const el = $(selector);
  if (!el) return;
  if (!audits.length) { el.innerHTML = '<div class="empty-state">ยังไม่มีการตรวจ</div>'; return; }

  let sortCol = 'datetime', sortDir = -1; // default: newest first

  function doRender() {
    const rows = [...audits].sort((a, b) => {
      let va, vb;
      if (sortCol === 'datetime') {
        va = (a.AuditDate || '') + ' ' + parseAuditTime_(a.AuditTime);
        vb = (b.AuditDate || '') + ' ' + parseAuditTime_(b.AuditTime);
      } else if (sortCol === 'line') {
        va = a.LineName || a.LineID || '';
        vb = b.LineName || b.LineID || '';
      } else if (sortCol === 'auditor') {
        va = a.AuditorName || '';
        vb = b.AuditorName || '';
      } else if (sortCol === 'ng') {
        return (Number(b.TotalNG) - Number(a.TotalNG)) * sortDir;
      }
      return va < vb ? -sortDir : va > vb ? sortDir : 0;
    });

    const arrow = dir => dir === -1 ? ' ▼' : ' ▲';
    const th = (col, label) => `<th style="cursor:pointer;user-select:none" onclick="sortTodayAudits_('${selector}','${col}')">${label}${sortCol===col ? arrow(sortDir) : ''}</th>`;

    el.innerHTML = `<div style="overflow-x:auto"><table class="data-table" style="font-size:.82rem;min-width:560px">
      <thead><tr>
        ${th('datetime','วันที่ / เวลา')}
        ${th('line','Line')}
        ${th('auditor','ผู้ตรวจ')}
        <th>Layer</th><th>Shift</th>
        <th class="num">OK</th>
        ${th('ng','NG')}
      </tr></thead>
      <tbody>${rows.map(a => {
        const ngNum = Number(a.TotalNG) || 0;
        const ngCls = ngNum > 0 ? 'color:var(--red);font-weight:800' : '';
        const date = formatDate(a.AuditDate);
        const time = parseAuditTime_(a.AuditTime);
        return `<tr>
          <td style="white-space:nowrap">${escapeHtml(date)} <span style="color:var(--muted)">${escapeHtml(time)}</span></td>
          <td><strong>${escapeHtml(a.LineName || a.LineID)}</strong></td>
          <td>${escapeHtml(a.AuditorName || '-')}</td>
          <td>${escapeHtml(a.AuditLayer || '-')}</td>
          <td>${escapeHtml(a.Shift || '-')}</td>
          <td class="num" style="color:var(--green);font-weight:700">${a.TotalOK ?? '-'}</td>
          <td class="num" style="${ngCls}">${ngNum > 0 ? ngNum : '-'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  // Expose sort function globally for onclick
  window.sortTodayAudits_ = (sel, col) => {
    if (sortCol === col) sortDir *= -1; else { sortCol = col; sortDir = -1; }
    renderTodayAudits(audits, sel);
  };

  doRender();
}

function renderMgrEscalation(findings) {
  const now = new Date(); now.setHours(0,0,0,0);
  const urgent = findings.filter(f => {
    if ((f.Status||'').toLowerCase() === 'closed') return false;
    const overdue = String(f.OverdueFlag).toLowerCase() === 'yes';
    if (overdue) return true;
    if (!f.DueDate) return false;
    const due = new Date(f.DueDate); due.setHours(0,0,0,0);
    return Math.round((due - now) / 86400000) <= 2;
  }).sort((a, b) => {
    const aOver = Number(a.DaysOverdue) || 0;
    const bOver = Number(b.DaysOverdue) || 0;
    if (aOver !== bOver) return bOver - aOver;
    return (a.DueDate||'').localeCompare(b.DueDate||'');
  });
  if (!urgent.length) { $('#mgrEscalation').innerHTML = '<div class="empty-state">✅ ไม่มี Finding ที่ต้อง Escalate</div>'; return; }
  $('#mgrEscalation').innerHTML = urgent.map(f => {
    const overdue = String(f.OverdueFlag).toLowerCase() === 'yes';
    const days = Number(f.DaysOverdue) || 0;
    let dueLabel, dueCls;
    if (overdue) {
      dueLabel = `เกิน ${days} วัน`; dueCls = 'color:var(--red);font-weight:900';
    } else {
      const due = new Date(f.DueDate); due.setHours(0,0,0,0);
      const diff = Math.round((due - now) / 86400000);
      dueLabel = diff === 0 ? 'Due วันนี้!' : `เหลือ ${diff} วัน`;
      dueCls = diff <= 1 ? 'color:var(--red);font-weight:800' : 'color:var(--orange);font-weight:700';
    }
    const badge = overdue ? '<span class="ld-badge overdue">🔴 เกิน Due</span>' : '<span class="ld-badge pending">⏰ Due ใกล้</span>';
    const pic = f.AssignmentDisplay || f.AssignedToName || f.PICName || '-';
    return `<div class="mgr-esc-row">
      ${badge}
      <div class="mgr-esc-info">
        <div class="mgr-esc-name">${escapeHtml(f.ProblemDetail || f.FindingID)}</div>
        <div class="mgr-esc-meta">${escapeHtml(f.LineName||f.LineID)} / ${escapeHtml(f.StationName||f.StationID)} · PIC: ${escapeHtml(pic)}</div>
      </div>
      <div class="mgr-esc-due" style="${dueCls}">${escapeHtml(formatDate(f.DueDate))}<div class="ld-days">${escapeHtml(dueLabel)}</div></div>
      <button class="btn btn-outline btn-compact" onclick="openFindingForEdit('${escapeAttr(f.FindingID)}')">ติดตาม</button>
    </div>`;
  }).join('');
}

function notificationStorageKey() {
  return state.user?.UserID ? `lpa_last_seen_finding_notification_${state.user.UserID}` : '';
}

function getLastSeenFindingNotificationAt() {
  const key = notificationStorageKey();
  return key ? localStorage.getItem(key) || '' : '';
}

function setLastSeenFindingNotificationAt(value) {
  const key = notificationStorageKey();
  if (key && value) localStorage.setItem(key, value);
}

function startFindingNotificationPolling(immediate = false) {
  if (!state.token || !state.user) return;
  stopFindingNotificationPolling();
  if (immediate) pollFindingNotifications(true);
  scheduleNextFindingNotificationPoll();
}

function stopFindingNotificationPolling() {
  if (state.notificationTimer) clearTimeout(state.notificationTimer);
  state.notificationTimer = null;
  state.notificationInFlight = false;
}

function scheduleNextFindingNotificationPoll() {
  if (!state.token || !state.user) return;
  if (state.notificationTimer) clearTimeout(state.notificationTimer);
  const delay = document.visibilityState === 'hidden' ? 180000 : 60000;
  state.notificationTimer = setTimeout(() => pollFindingNotifications(false), delay);
}

function handleNotificationVisibilityChange() {
  if (!state.token || !state.user) return;
  if (document.visibilityState === 'visible') pollFindingNotifications(true);
  else scheduleNextFindingNotificationPoll();
}

async function pollFindingNotifications(immediate = false) {
  if (!state.token || !state.user || state.notificationInFlight) return;
  // bootstrapBackgroundData already has this summary in flight inside its batch.
  if (state.bootstrapping) return;
  // A badge count is never worth the last free slot. If the endpoint is already
  // saturated, skip this tick rather than queue — the next one is a minute away,
  // and whatever the user does next should not have to wait behind a badge.
  if (apiGateBusy()) { scheduleNextFindingNotificationPoll(); return; }
  state.notificationInFlight = true;
  try {
    const data = await apiCall('getMyFindingNotificationSummary', { lastSeenAt: getLastSeenFindingNotificationAt(), limit: 5 }, { priority: 'normal', quiet: true });
    handleFindingNotificationSummary(data, immediate);
  } catch (error) {
    console.warn('Finding notification polling failed:', error.message || error);
  } finally {
    state.notificationInFlight = false;
    scheduleNextFindingNotificationPoll();
  }
}

function handleFindingNotificationSummary(data, immediate) {
  const count = number(data.actionableCount ?? (number(data.assignedOpenCount) + number(data.pendingVerificationCount)));
  updateFindingBadges(count);
  const latest = data.latestFindings || [];
  const newest = latest[0];
  const newestAt = newest ? (newest.UpdatedAt || newest.CreatedAt || data.serverTime) : data.serverTime;
  const newCount = number(data.newFindingCount);
  if (newCount > 0 && newest && state.lastNotificationKey !== `${newest.FindingID}|${newestAt}`) {
    const message = data.pendingVerificationCount > 0
      ? `มี Finding รอ Verification ${data.pendingVerificationCount} รายการ`
      : `มี Finding ใหม่ ${newCount} รายการที่มอบหมายให้ ${newest.AssignmentDisplay || newest.AssignedRole || state.user.Role}`;
    const toast = showToast(message, 'info', 7000);
    toast.classList.add('clickable-toast');
    toast.addEventListener('click', () => navigateTo('findings'));
    state.lastNotificationKey = `${newest.FindingID}|${newestAt}`;
    if (document.querySelector('#page-findings.active-page')) {
      const dialog = $('#findingDialog');
      if (dialog && dialog.open) showToast('มีรายการใหม่ กดรีเฟรชรายการ', 'info', 6000);
      else loadFindings();
    }
  }
  if (newestAt) setLastSeenFindingNotificationAt(newestAt);
}

function updateFindingBadges(count) {
  ['#findingNavBadge'].forEach(selector => {
    const badge = $(selector);
    if (!badge) return;
    badge.textContent = count;
    badge.classList.toggle('hidden', count < 1);
  });
}

function showDashboardSkeleton() {
  $('#dashboardCards').innerHTML = Array.from({ length: 8 }, () => '<article class="metric-card skeleton-card"><span></span><strong></strong><small></small></article>').join('');
  $('#monthlyAuditChart').className = 'bar-chart dashboard-section-loading';
  $('#monthlyAuditChart').innerHTML = '<div class="inline-loader"></div><span>กำลังโหลด Dashboard...</span>';
  $('#lineSummary').innerHTML = '<div class="dashboard-section-loading"><div class="inline-loader"></div><span>กำลังโหลดข้อมูล...</span></div>';
  $('#nearDueList').innerHTML = '<div class="dashboard-section-loading"><div class="inline-loader"></div><span>กำลังโหลดข้อมูล...</span></div>';
}

function renderDashboard(data) {
  const topCategory = data.TopNGCategory && data.TopNGCategory.Category ? `${data.TopNGCategory.Category} (${data.TopNGCategory.Count})` : '-';
  const ruleSummary = data.AuditRuleSummary || {};
  const cards = [
    ['My Due Today', ruleSummary.DueToday || 0, 'กำหนดจากกฎตารางตรวจ', 'orange'],
    ['My Overdue / Missed', ruleSummary.Overdue || 0, 'รอบที่ผ่านแล้วและยังไม่ตรวจ', 'dark-red'],
    ['My Schedule This Week', ruleSummary.ThisWeek || 0, 'กฎที่มีกำหนดในสัปดาห์นี้', ''],
    ['Completed This Month', ruleSummary.CompletedThisMonth || 0, 'รอบกฎที่ตรวจสำเร็จ', 'green'],
    ['Total Audit', data.TotalAudit, 'รายการตรวจทั้งหมด', ''],
    ['Audit This Month', data.AuditThisMonth, 'รายการเดือนนี้', ''],
    ['Total Finding', data.TotalFinding, 'Finding ทั้งหมด', ''],
    ['Open Finding', data.OpenFinding, 'รอดำเนินการ', 'red'],
    ['On going Finding', data.OnGoingFinding, 'กำลังดำเนินการ', 'orange'],
    ['Closed Finding', data.ClosedFinding, 'ปิดแล้ว', 'green'],
    ['Overdue Action', data.OverdueAction, 'เกิน Due Date', 'dark-red'],
    ['My Open Findings', data.MyOpenFindings, 'Assigned to Me', 'orange'],
    ['My Overdue Findings', data.MyOverdueFindings, 'งานของฉันที่เกินกำหนด', 'dark-red'],
    ['Pending My Verification', data.PendingMyVerification, 'รอตรวจสอบโดยฉัน', 'red'],
    ['Top NG Category', topCategory, 'Category ที่พบสูงสุด', 'red']
  ];
  $('#dashboardCards').innerHTML = cards.map(card => `<article class="metric-card ${card[3]}"><span class="metric-label">${escapeHtml(card[0])}</span><strong class="metric-value">${escapeHtml(String(card[1] ?? 0))}</strong><small class="metric-note">${escapeHtml(card[2])}</small></article>`).join('');
  const notificationCount = number(data.MyOpenFindings) + number(data.PendingMyVerification);
  updateFindingBadges(notificationCount);
  // Audit badge — show only DueToday (not accumulated overdue)
  const dueToday = number(ruleSummary.DueToday);
  const auditBadge = $('#auditNavBadge');
  if (dueToday > 0) {
    auditBadge.textContent = String(dueToday);
    auditBadge.classList.remove('hidden');
  } else {
    auditBadge.textContent = '0';
    auditBadge.classList.add('hidden');
  }
  // Audit alert banner
  const alertEl = $('#auditPlanAlert');
  if (dueToday > 0) {
    alertEl.innerHTML = `<span>⏰ <strong>${dueToday} รายการ</strong> ต้องตรวจวันนี้</span><button class="btn btn-sm btn-primary" onclick="navigateTo('audit')">ไปตรวจเลย →</button>`;
    alertEl.classList.remove('hidden');
  } else {
    alertEl.classList.add('hidden');
    alertEl.innerHTML = '';
  }
  renderMonthlyBars(data.MonthlyAuditResult || []);
  $('#lineSummary').innerHTML = tableHtml(['Line', 'Total Audit', 'Total NG', 'Open Finding'], (data.SummaryByLine || []).map(row => [row.LineName || row.LineID, row.TotalAudit, row.TotalNG, row.OpenFinding]));
  const nearDue = data.ActionsNearDueDate || [];
  $('#nearDueList').innerHTML = nearDue.length ? nearDue.map(row => `<div class="near-due-item"><div><strong>${escapeHtml(row.FindingID)}</strong><span class="data-label">${escapeHtml(row.ProblemDetail || '-')}</span></div><div><span class="data-label">Line / Station</span>${escapeHtml(row.LineName || row.LineID)} / ${escapeHtml(row.StationName || row.StationID)}</div><div><span class="data-label">PIC</span>${escapeHtml(row.PICName || '-')}</div><div><span class="data-label">Due Date</span>${formatDate(row.DueDate)}</div><span class="status-badge ${statusClass(row.Status)}">${escapeHtml(row.Status || '-')}</span></div>`).join('') : emptyHtml('ไม่มี Action ที่ใกล้ Due Date');
}

function renderMonthlyBars(rows) {
  $('#monthlyAuditChart').className = 'bar-chart';
  if (!rows.length) return $('#monthlyAuditChart').innerHTML = emptyHtml('ยังไม่มีข้อมูลรายเดือน');
  const max = Math.max(1, ...rows.flatMap(row => [number(row.TotalOK), number(row.TotalNG), number(row.TotalNA)]));
  $('#monthlyAuditChart').classList.remove('empty-state');
  $('#monthlyAuditChart').innerHTML = rows.map(row => `<div class="bar-group" title="${escapeHtml(row.PeriodMonth)}"><div class="bar ok" style="height:${Math.max(3, number(row.TotalOK) / max * 155)}px" title="OK ${number(row.TotalOK)}"></div><div class="bar ng" style="height:${Math.max(3, number(row.TotalNG) / max * 155)}px" title="NG ${number(row.TotalNG)}"></div><div class="bar na" style="height:${Math.max(3, number(row.TotalNA) / max * 155)}px" title="N/A ${number(row.TotalNA)}"></div><small>${formatPeriod(row.PeriodMonth)}</small></div>`).join('');
}

async function loadChecklist() {
  const lineId = $('#auditLine').value;
  const stationId = $('#auditStation').value;
  const auditLayer = $('#auditLayer').value;
  const language = $('#checklistLanguage').value;
  if (!lineId || !auditLayer) return showToast('กรุณาเลือก Line และ Audit Layer', 'warning');
  showLoading('กำลังโหลด Checklist...');
  try {
    const data = await apiCall('getChecklist', { lineId, stationId, auditLayer, language });
    state.checklist = data.checklist || [];
    state.auditAnswers = {};
    renderAuditChecklist();
    if (!state.checklist.length) showToast('ไม่พบ Checklist ที่ตรงกับเงื่อนไข', 'warning');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    hideLoading();
    updateAuditSaveButtonState();
    setPlanScopeLocked(state.auditMode === 'Plan');
  }
}

function renderAuditChecklist() {
  const container = $('#auditChecklist');
  $('#auditSaveBar').classList.toggle('hidden', !state.checklist.length);
  if (!state.checklist.length) {
    container.innerHTML = emptyHtml('ไม่พบ Checklist');
    return;
  }
  const roleOptions = assignableRoleOptions();
  const isManager = state.user.Role === 'Manager';
  const isMultiUserCapable = isManager || state.user.Role === 'Supervisor';
  const roleFieldHtml = isManager
    ? `<div class="form-field full-width"><span class="data-label">มอบหมายให้ตำแหน่ง (เลือกได้หลายตำแหน่ง)</span><div class="checkbox-group" data-field="roleCheckboxGroup">${assignableRoles().map(r => `<label class="checkbox-item"><input type="checkbox" value="${escapeAttr(r)}" data-role-checkbox> ${escapeHtml(r)}</label>`).join('')}</div></div>`
    : `<label>มอบหมายให้ตำแหน่ง<select data-field="assignedRole"><option value="">เลือกตำแหน่งรับผิดชอบ</option>${roleOptions}</select></label>`;
  const userFieldHtml = `<div class="form-field full-width hidden" data-field="userCheckboxWrap"><span class="data-label">เลือกผู้รับผิดชอบ (เลือกได้หลายคน)</span><div class="checkbox-group" data-field="userCheckboxGroup"></div></div><label data-field="userPickerLabel" class="hidden">เลือกผู้รับผิดชอบ<select data-field="assignedUserSelect"><option value="">-- เลือกชื่อ --</option></select></label>`;
  const assignmentFields = `${roleFieldHtml}${userFieldHtml}<label>ผู้รับผิดชอบ<input data-field="responsiblePerson" readonly></label><input data-field="assignmentMode" type="hidden" value="ROLE"><input data-field="assignedUserId" type="hidden"><input data-field="assignedUserName" type="hidden"><input data-field="findingStatus" type="hidden" value="Assigned">`;
  const findingDetailFieldHtml = `<div class="form-field full-width finding-detail-field"><span class="data-label">รายละเอียดปัญหา * (แยกเป็นข้อๆ หากมีหลายประเด็นในจุดตรวจนี้ — แต่ละข้อจะกลายเป็นคนละ Finding)</span><div class="finding-detail-list" data-field="findingDetailList"><div class="finding-detail-item"><span class="finding-detail-index">1</span><textarea data-field="findingDetailItem" rows="2" placeholder="อธิบายปัญหาที่พบ"></textarea><button type="button" class="finding-detail-remove" data-remove-finding-detail hidden aria-label="ลบปัญหานี้">×</button></div></div><button type="button" class="btn btn-outline btn-compact finding-detail-add" data-add-finding-detail>+ เพิ่มปัญหา</button></div>`;
  container.innerHTML = state.checklist.map((item, index) => `<article class="checklist-card" data-checklist-id="${escapeAttr(item.ChecklistID)}"><div class="checklist-head"><p class="eyebrow">ข้อ ${index + 1} · ${escapeHtml(item.Category || 'ทั่วไป')}</p><h3>${escapeHtml(item.CheckItem || '-')}</h3></div><div class="criteria-grid"><div class="criteria-box"><strong>เกณฑ์มาตรฐาน</strong>${escapeHtml(item.StandardCriteria || '-')}</div><div class="criteria-box ok-example"><strong>ตัวอย่าง OK</strong>${escapeHtml(item.ExampleOK || '-')}</div><div class="criteria-box ng-example"><strong>ตัวอย่าง NG</strong>${escapeHtml(item.ExampleNG || '-')}</div></div><div class="result-buttons"><button type="button" class="result-button ok" data-result="OK">OK</button><button type="button" class="result-button ng" data-result="NG">NG</button><button type="button" class="result-button na" data-result="N/A">N/A</button></div><div class="ng-fields hidden"><p class="required-note">กรุณากรอกข้อมูล Finding ให้ครบ</p><div class="form-grid">${findingDetailFieldHtml}${assignmentFields}<label>กำหนดวันแก้ไข *<input data-field="dueDate" type="date"></label><label>รูปก่อนแก้ไข *<input data-field="beforePhoto" type="file" accept="image/*" multiple><span class="photo-preview" data-field="beforePhotoPreview"></span></label><label>หมายเหตุ<textarea data-field="remark" rows="2"></textarea></label></div></div></article>`).join('');
  $$('.checklist-card', container).forEach(card => {
    $$('.result-button', card).forEach(button => button.addEventListener('click', () => selectAuditResult(card, button.dataset.result)));
    $$('input, select, textarea', card).forEach(field => {
      field.addEventListener('input', updateAuditSaveButtonState);
      field.addEventListener('change', event => {
        if (field.dataset.field === 'beforePhoto') renderPhotoPreview(field, `[data-field=\"beforePhotoPreview\"]`, '', card);
        updateAuditSaveButtonState();
      });
    });
    $$('.finding-detail-item', card).forEach(item => wireFindingDetailItem(card, item));
    renumberFindingDetailItems(card);
    const addDetailBtn = $('[data-add-finding-detail]', card);
    if (addDetailBtn) addDetailBtn.addEventListener('click', () => { addFindingDetailItem(card); saveAuditDraft(); });
    if (isManager) {
      wireCheckboxChips(card);
      $$('[data-role-checkbox]', card).forEach(cb => cb.addEventListener('change', () => {
        const checked = $$('[data-role-checkbox]:checked', card).map(c => c.value);
        renderMultiUserPicker(card, checked);
        updateAuditSaveButtonState();
      }));
    } else {
      const roleSelect = $('select[data-field="assignedRole"]', card);
      if (roleSelect) roleSelect.addEventListener('change', event => {
        if (isMultiUserCapable) {
          renderMultiUserPicker(card, event.target.value ? [event.target.value] : []);
        } else {
          onRoleChange(card, event.target.value);
        }
        updateAuditSaveButtonState();
      });
    }
    const userSelect = $('select[data-field="assignedUserSelect"]', card);
    if (userSelect) userSelect.addEventListener('change', event => {
      onUserSelectChange(card, event.target.value);
      updateAuditSaveButtonState();
    });
  });
  updateAuditProgress();
  updateAuditSaveButtonState();
  // Start auto-save timer when checklist is rendered
  if (!window._auditDraftTimer) {
    window._auditDraftTimer = setInterval(saveAuditDraft, 30000);
  }
}

function onRoleChange(card, role) {
  const pickerLabel = $('[data-field="userPickerLabel"]', card);
  const userSelect = $('select[data-field="assignedUserSelect"]', card);
  const responsibleInput = $('[data-field="responsiblePerson"]', card);
  const modeInput = $('[data-field="assignmentMode"]', card);
  const userIdInput = $('[data-field="assignedUserId"]', card);
  const userNameInput = $('[data-field="assignedUserName"]', card);

  // reset user fields
  userIdInput.value = '';
  userNameInput.value = '';

  if (!role) {
    pickerLabel.classList.add('hidden');
    responsibleInput.value = '';
    modeInput.value = 'ROLE';
    return;
  }

  const users = usersForRole(role);

  if (users.length === 0) {
    // ROLE mode — no individual user
    pickerLabel.classList.add('hidden');
    responsibleInput.value = role;
    modeInput.value = 'ROLE';
  } else if (users.length === 1) {
    // Auto-select the only user
    pickerLabel.classList.add('hidden');
    const u = users[0];
    userIdInput.value = u.UserID;
    userNameInput.value = u.FullName || u.Username;
    responsibleInput.value = `${u.FullName || u.Username} (${role})`;
    modeInput.value = 'USER';
  } else {
    // Show picker
    userSelect.innerHTML = `<option value="">-- เลือกชื่อ --</option>` +
      users.map(u => `<option value="${escapeAttr(u.UserID)}">${escapeHtml((u.FullName || u.Username) + (u.Username ? ' (' + u.Username + ')' : ''))}</option>`).join('');
    pickerLabel.classList.remove('hidden');
    responsibleInput.value = role;
    modeInput.value = 'ROLE';
  }
}

function onUserSelectChange(card, userId) {
  const role = $('select[data-field="assignedRole"]', card).value;
  const userIdInput = $('[data-field="assignedUserId"]', card);
  const userNameInput = $('[data-field="assignedUserName"]', card);
  const responsibleInput = $('[data-field="responsiblePerson"]', card);
  const modeInput = $('[data-field="assignmentMode"]', card);

  if (!userId) {
    userIdInput.value = '';
    userNameInput.value = '';
    responsibleInput.value = role;
    modeInput.value = 'ROLE';
    return;
  }
  const u = (state.masterData.users || []).find(user => String(user.UserID) === String(userId));
  if (u) {
    userIdInput.value = u.UserID;
    userNameInput.value = u.FullName || u.Username;
    responsibleInput.value = `${u.FullName || u.Username} (${role})`;
    modeInput.value = 'USER';
  }
}

function getSelectedRoles(card) {
  const checkboxes = $$('[data-role-checkbox]:checked', card);
  if (checkboxes.length) return checkboxes.map(cb => cb.value);
  const select = $('select[data-field="assignedRole"]', card);
  return select && select.value ? [select.value] : [];
}

// Multi-role / multi-user picker — used by Manager (multi-role) and Supervisor (multi-user within one role)
function renderMultiUserPicker(card, roles) {
  const wrap = $('[data-field="userCheckboxWrap"]', card);
  const group = $('[data-field="userCheckboxGroup"]', card);
  const responsibleInput = $('[data-field="responsiblePerson"]', card);
  const modeInput = $('[data-field="assignmentMode"]', card);
  const userIdInput = $('[data-field="assignedUserId"]', card);
  const userNameInput = $('[data-field="assignedUserName"]', card);

  if (!roles.length) {
    wrap.classList.add('hidden');
    group.innerHTML = '';
    responsibleInput.value = '';
    modeInput.value = 'ROLE';
    userIdInput.value = '';
    userNameInput.value = '';
    return;
  }

  const seen = new Set();
  const users = [];
  roles.forEach(role => {
    usersForRole(role).forEach(u => {
      if (!seen.has(u.UserID)) { seen.add(u.UserID); users.push(u); }
    });
  });

  if (!users.length) {
    wrap.classList.add('hidden');
    group.innerHTML = '';
    responsibleInput.value = roles.join(', ');
    modeInput.value = 'ROLE';
    userIdInput.value = '';
    userNameInput.value = '';
    return;
  }

  wrap.classList.remove('hidden');
  group.innerHTML = users.map(u => `<label class="checkbox-item"><input type="checkbox" value="${escapeAttr(u.UserID)}" data-user-checkbox checked> ${escapeHtml((u.FullName || u.Username) + (u.Username ? ' (' + u.Username + ')' : ''))}</label>`).join('');
  wireCheckboxChips(group);
  $$('[data-user-checkbox]', group).forEach(cb => cb.addEventListener('change', () => {
    updateMultiUserSelection(card);
    updateAuditSaveButtonState();
  }));
  updateMultiUserSelection(card);
}

function updateMultiUserSelection(card) {
  const checkedBoxes = $$('[data-user-checkbox]:checked', card);
  const responsibleInput = $('[data-field="responsiblePerson"]', card);
  const modeInput = $('[data-field="assignmentMode"]', card);
  const userIdInput = $('[data-field="assignedUserId"]', card);
  const userNameInput = $('[data-field="assignedUserName"]', card);
  if (!checkedBoxes.length) {
    responsibleInput.value = '';
    modeInput.value = 'ROLE';
    userIdInput.value = '';
    userNameInput.value = '';
    return;
  }
  const ids = checkedBoxes.map(cb => cb.value);
  const names = ids.map(id => {
    const u = (state.masterData.users || []).find(user => String(user.UserID) === String(id));
    return u ? (u.FullName || u.Username) : id;
  });
  userIdInput.value = ids.join(',');
  userNameInput.value = names.join(', ');
  responsibleInput.value = names.join(', ');
  modeInput.value = 'USER';
}

function selectAuditResult(card, result) {
  const checklistId = card.dataset.checklistId;
  state.auditAnswers[checklistId] = { ...(state.auditAnswers[checklistId] || {}), result };
  $$('.result-button', card).forEach(button => button.classList.toggle('selected', button.dataset.result === result));
  $('.ng-fields', card).classList.toggle('hidden', result !== 'NG');
  updateAuditProgress();
  updateAuditSaveButtonState();
  saveAuditDraft();
}

function updateAuditProgress() {
  const answered = Object.keys(state.auditAnswers).filter(key => state.auditAnswers[key].result).length;
  $('#auditProgress').textContent = `ตอบแล้ว ${answered} / ${state.checklist.length} ข้อ`;
}

function auditNgDetailsComplete() {
  return state.checklist.every(item => {
    const answer = state.auditAnswers[item.ChecklistID];
    if (!answer || answer.result !== 'NG') return true;
    const card = $(`.checklist-card[data-checklist-id="${cssEscape(item.ChecklistID)}"]`);
    // Before Photo is optional — only require core finding fields
    const hasAssignment = getSelectedRoles(card).length > 0 || Boolean(fieldValue(card, 'assignedUserId'));
    return Boolean(card && fieldValues(card, 'findingDetailItem').length &&
      hasAssignment && fieldValue(card, 'dueDate'));
  });
}

function updateAuditSaveButtonState() {
  const button = $('#saveAuditButton');
  if (!button) return;
  const allAnswered = state.checklist.length > 0 &&
    state.checklist.every(item => state.auditAnswers[item.ChecklistID]?.result);
  button.disabled = state.auditSaveInProgress || state.auditDuplicateBlocked ||
    !allAnswered || !auditNgDetailsComplete();
  button.textContent = state.auditSaveInProgress ? 'กำลังบันทึก...' : 'บันทึก Audit';
}

async function saveAudit() {
  if (state.auditSaveInProgress) return;
  setAuditSavingState(true);
  if (!state.checklist.length) {
    setAuditSavingState(false);
    return showToast('กรุณาโหลด Checklist ก่อนบันทึก', 'warning');
  }
  if (Object.keys(state.auditAnswers).length !== state.checklist.length) {
    setAuditSavingState(false);
    return showToast('กรุณาระบุผลให้ครบทุกข้อ', 'warning');
  }
  const auditDateValue = $('#auditDate').value;
  const isBackdated = auditDateValue && auditDateValue < localDateInput(new Date());
  const lateReason = $('#auditLateReason').value.trim();
  if (isBackdated && !lateReason) {
    setAuditSavingState(false);
    return showToast('คุณกำลังบันทึก Audit ย้อนหลัง กรุณาระบุเหตุผล', 'warning');
  }
  const records = [];
  for (const item of state.checklist) {
    const card = $(`.checklist-card[data-checklist-id="${cssEscape(item.ChecklistID)}"]`);
    const answer = state.auditAnswers[item.ChecklistID];
    const record = { checklistId: item.ChecklistID, category: item.Category, checkItem: item.CheckItem, standardCriteria: item.StandardCriteria, checklistRevision: item.Revision, result: answer.result, remark: fieldValue(card, 'remark') };
    if (answer.result === 'NG') {
      record.findingDetails = fieldValues(card, 'findingDetailItem');
      record.correctiveAction = '';
      record.assignmentMode = fieldValue(card, 'assignmentMode') || 'ROLE';
      record.assignedUserId = fieldValue(card, 'assignedUserId') || '';
      const assignedUserName = fieldValue(card, 'assignedUserName') || '';
      const selectedRoles = getSelectedRoles(card);
      if (record.assignmentMode === 'USER' && assignedUserName) {
        record.assignedRole = '';
        record.assignedRoleName = '';
        record.assignedToName = assignedUserName;
        record.responsiblePerson = assignedUserName;
      } else {
        record.assignedRole = selectedRoles.join(',');
        record.assignedRoleName = record.assignedRole;
        record.assignedToName = record.assignedRole;
        record.responsiblePerson = record.assignedRole;
      }
      record.assignedToUserId = record.assignedUserId;
      record.picUserId = record.assignedUserId;
      record.picName = record.responsiblePerson;
      record.assignedToRole = record.assignedRole;
      record.severity = item.Severity || 'Minor';
      record.dueDate = fieldValue(card, 'dueDate');
      record.status = (record.assignedRole || record.assignedUserId) ? 'Assigned' : 'Open';
      record.findingStatus = record.status;
      if (!record.findingDetails.length || (!record.assignedRole && !record.assignedUserId) || !record.dueDate) {
        setAuditSavingState(false);
        return showToast(`กรุณากรอก รายละเอียดปัญหา, ตำแหน่งรับผิดชอบ และ กำหนดวันแก้ไข ของ ${item.ChecklistID} ให้ครบ`, 'warning');
      }
      const photos = fieldFiles(card, 'beforePhoto');
      if (photos.length) record._photos = photos;
    }
    records.push(record);
  }
  const confirmedSave = await showConfirm({
    title: 'ยืนยันบันทึกผลตรวจ?',
    message: `ระบบจะบันทึกผลการตรวจทั้งหมด ${records.length} ข้อ`,
    confirmText: 'บันทึก Audit',
    tone: 'success'
  });
  if (!confirmedSave) {
    setAuditSavingState(false);
    return;
  }
  if (!state.auditClientSubmissionId) state.auditClientSubmissionId = createClientSubmissionId();
  const photoRecords = records.filter(r => r._photos && r._photos.length);
  const totalPhotos = photoRecords.reduce((sum, r) => sum + r._photos.length, 0);
  try {
    // Step 1: upload all photos in parallel
    if (totalPhotos > 0) {
      showLoading(`กำลังอัปโหลดรูปภาพ ${totalPhotos} รูป... กรุณารอสักครู่`);
      await Promise.all(photoRecords.map(async record => {
        const urls = await Promise.all(record._photos.map(async (file, i) => {
          const upload = await uploadFile(file, 'AuditDraft', `DRAFT-${Date.now()}-${i}`, 'BeforePhoto', false);
          return upload.DriveFileURL;
        }));
        record.beforePhotoUrl = urls.join(',');
        delete record._photos;
      }));
      hideLoading();
    }
    // Step 2: save audit data
    showLoading('กำลังบันทึกผลการตรวจ...');
    const auditDate = $('#auditDate').value;
    const payload = {
      auditDate, auditTime: $('#auditTime').value, periodMonth: auditDate.slice(0, 7),
      lineId: $('#auditLine').value, lineName: selectedText('#auditLine'),
      stationId: $('#auditStation').value, stationName: selectedText('#auditStation'),
      area: $('#auditArea').value, shift: $('#auditShift').value, auditLayer: $('#auditLayer').value,
      checklistLanguage: $('#checklistLanguage').value,
      remark: $('#auditRemark').value.trim(), lateReason, planId: $('#auditPlanId').value,
      clientSubmissionId: state.auditClientSubmissionId, records
    };
    const data = await apiCall('saveAudit', payload);
    const findingText = (data.FindingIDs || []).length ? ` | Finding: ${data.FindingIDs.join(', ')}` : '';
    showToast(`บันทึกสำเร็จ AuditID: ${data.AuditID}${findingText}`, 'success', 7000);
    state.auditPlans = [];
    GASCache.invalidate('dashboard'); GASCache.invalidatePrefix('mgr_comp_'); GASCache.invalidatePrefix('dir_dash_'); GASCache.invalidatePrefix('leader_');
    state.leaderDashData = null;
    clearAuditDraft();
    resetAuditForm();
    refreshDashboardIfVisible();
  } catch (error) {
    const message = error && error.message ? error.message : 'ไม่สามารถบันทึก Audit ได้';
    state.auditDuplicateBlocked = isAuditDuplicateMessage(message);
    const toast = showToast(message, 'error', 7000);
    if (state.auditDuplicateBlocked) toast.classList.add('audit-duplicate-toast');
    setAuditSavingState(false);
  } finally {
    hideLoading();
    updateAuditSaveButtonState();
    setPlanScopeLocked(state.auditMode === 'Plan');
  }
}

function setAuditSavingState(isSaving) {
  state.auditSaveInProgress = isSaving;
  updateAuditSaveButtonState();
}

function createClientSubmissionId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return `LPA-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function isAuditDuplicateMessage(message) {
  return String(message || '').includes('แผนการตรวจนี้ถูกบันทึกเรียบร้อยแล้ว') ||
    String(message || '').includes('มีการบันทึก LPA สำหรับ Line / Station / Layer / Shift นี้แล้ว');
}

// Renders Drive-hosted photos inline instead of as bare links: pulling the
// file ID out of the "view" URL lets Drive's thumbnail endpoint serve the
// image directly, so users don't get bounced out to Drive to see it.
function driveThumbnailUrl_(url, size = 1000) {
  const str = String(url || '');
  const match = str.match(/\/d\/([a-zA-Z0-9_-]{10,})/) || str.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  return match ? `https://drive.google.com/thumbnail?id=${match[1]}&sz=w${size}` : str;
}

function renderPhotoPreview(input, targetSelector, existingUrl = '', scope = document, options = {}) {
  const target = typeof targetSelector === 'string' ? $(targetSelector, scope) : targetSelector;
  if (!target) return;
  const files = input && input.files ? Array.from(input.files) : [];
  const nonImages = files.filter(f => !String(f.type || '').startsWith('image/'));
  if (nonImages.length) {
    target.innerHTML = '<span class="required-note">กรุณาเลือกไฟล์รูปภาพเท่านั้น</span>';
    return;
  }
  const removedUrls = options.removedUrls || [];
  const existingUrls = String(existingUrl || '').split(',').map(u => u.trim()).filter(Boolean)
    .filter(u => !removedUrls.includes(u));
  if (!existingUrls.length && !files.length) {
    target.innerHTML = '';
    return;
  }
  const existingHtml = existingUrls.map((u, i) => `<span class="photo-preview-item" data-existing-url="${escapeAttr(u)}">${
    options.onRemoveExisting ? `<button type="button" class="photo-preview-remove" data-remove-existing="${escapeAttr(u)}" title="ลบรูปนี้">×</button>` : ''
  }<a href="${escapeAttr(u)}" data-photo-url="${escapeAttr(u)}" class="photo-link-trigger" rel="noopener" title="ดูรูปเต็ม"><img src="${escapeAttr(driveThumbnailUrl_(u))}" alt="รูปที่ ${i + 1}" loading="lazy"></a><span>รูปที่ ${i + 1}</span></span>`).join('');
  const newHtml = files.map(file => {
    const url = URL.createObjectURL(file);
    return `<span class="photo-preview-item"><img src="${escapeAttr(url)}" alt="preview" data-revoke="${escapeAttr(url)}"><span>${escapeHtml(file.name)} · ${Math.ceil(file.size / 1024)} KB</span></span>`;
  }).join('');
  target.innerHTML = `<div class="photo-preview-grid">${existingHtml}${newHtml}</div>`;
  $$('img[data-revoke]', target).forEach(img => img.addEventListener('load', () => URL.revokeObjectURL(img.dataset.revoke), { once: true }));
  if (options.onRemoveExisting) {
    $$('[data-remove-existing]', target).forEach(button => button.addEventListener('click', event => {
      event.preventDefault();
      options.onRemoveExisting(button.dataset.removeExisting);
    }));
  }
}

// Finding After-Photo preview is backed by state.findingPhotoRemovals so a
// removal click can re-render immediately without re-fetching the finding.
function renderFindingPhotoPreview() {
  renderPhotoPreview($('#editAfterPhoto'), '#editPhotoPreview', state.editingFinding?.AfterPhotoURL || '', document, {
    removedUrls: state.findingPhotoRemovals ? Array.from(state.findingPhotoRemovals) : [],
    onRemoveExisting: url => {
      if (!state.findingPhotoRemovals) state.findingPhotoRemovals = new Set();
      state.findingPhotoRemovals.add(url);
      renderFindingPhotoPreview();
    }
  });
}

// Before Photo is view-only in this dialog — no upload/remove, just the
// evidence captured at audit time for reference while doing corrective action.
function renderViewOnlyPhotoGallery(targetSelector, urlCsv) {
  const target = $(targetSelector);
  if (!target) return;
  const urls = String(urlCsv || '').split(',').map(u => u.trim()).filter(Boolean);
  if (!urls.length) { target.innerHTML = '<span class="muted">ไม่มีรูปแนบ</span>'; return; }
  target.innerHTML = `<div class="photo-preview-grid">${urls.map((u, i) => `<span class="photo-preview-item"><a href="${escapeAttr(u)}" data-photo-url="${escapeAttr(u)}" class="photo-link-trigger" rel="noopener"><img src="${escapeAttr(driveThumbnailUrl_(u))}" alt="รูปที่ ${i + 1}" loading="lazy"></a><span>รูปที่ ${i + 1}</span></span>`).join('')}</div>`;
}

async function compressImage(file, maxPx = 800, quality = 0.6) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxPx || height > maxPx) {
        if (width >= height) { height = Math.round(height * maxPx / width); width = maxPx; }
        else { width = Math.round(width * maxPx / height); height = maxPx; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

async function uploadFile(file, relatedType, relatedId, fileType, manageLoading = true) {
  if (!file) throw new Error('ไม่พบไฟล์สำหรับอัปโหลด');
  const uploadMessage = fileType === 'BeforePhoto' ? 'กำลังอัปโหลด Before Photo...' :
    (fileType === 'AfterPhoto' ? 'กำลังอัปโหลด After Photo...' : 'กำลังอัปโหลดไฟล์...');
  if (manageLoading) showLoading(uploadMessage);
  try {
    const compressed = String(file.type || '').startsWith('image/') ? await compressImage(file) : file;
    const base64Data = await fileToBase64(compressed);
    return await apiCall('uploadFile', { relatedType, relatedId, fileType, fileName: file.name.replace(/\.[^.]+$/, '.jpg'), mimeType: 'image/jpeg', base64Data });
  } finally {
    if (manageLoading) hideLoading();
  }
}

async function uploadFiveSCheckpointReferencePhoto(file, checkpointId) {
  if (!file) throw new Error('กรุณาเลือกภาพอ้างอิงตำแหน่ง');
  const compressed = String(file.type || '').startsWith('image/') ? await compressImage(file) : file;
  const base64Data = await fileToBase64(compressed);
  return apiCall('uploadFiveSCheckpointReferencePhoto', {
    checkpointId, fileName: file.name.replace(/\.[^.]+$/, '.jpg'), mimeType: 'image/jpeg', base64Data
  });
}

// ===== Morning Meeting Board =====
// Pre-shift meeting board: Leaders post problems/news/announcements ahead of
// the meeting, then the team opens this page and ticks topics off as discussed.
const MEETING_CATEGORY_META = {
  'ปัญหา': { icon: '🔴', cls: 'mtg-cat-problem' },
  'ข่าวสาร': { icon: '📢', cls: 'mtg-cat-news' },
  'ความปลอดภัย': { icon: '⚠️', cls: 'mtg-cat-safety' },
  'คุณภาพ': { icon: '🎯', cls: 'mtg-cat-quality' },
  'ทั่วไป': { icon: '📋', cls: 'mtg-cat-general' }
};

async function loadTrainingPage() {
  const container = $('#trainingArchive');
  if (!container) return;
  container.innerHTML = '<div class="empty-state">กำลังโหลดประวัติ Training...</div>';
  const payload = { includeHistory: true, contentType: 'Training' };
  if ($('#trainingDateFrom').value) payload.dateFrom = $('#trainingDateFrom').value;
  if ($('#trainingDateTo').value) payload.dateTo = $('#trainingDateTo').value;
  try {
    const data = await apiCall('getMeetingPosts', payload, { priority: 'high' });
    state.trainingRecords = data.posts || [];
    renderTrainingArchive();
  } catch (error) {
    state.trainingRecords = [];
    $('#trainingArchiveSummary').innerHTML = '';
    container.innerHTML = emptyHtml(error.message || 'โหลดประวัติ Training ไม่สำเร็จ');
    showToast(error.message || 'โหลดประวัติ Training ไม่สำเร็จ', 'error');
  }
}

function trainingRecordSlidesHtml(row) {
  const images = String(row.SlideImageURLs || '').split(',').map(url => url.trim()).filter(Boolean);
  const imageSlides = images.length
    ? `<div class="training-slide-gallery">${images.map((url, index) => `<figure><img src="${escapeAttr(driveThumbnailUrl_(url, 900))}" alt="สไลด์ Training ${index + 1}" loading="lazy"><figcaption>สไลด์ ${index + 1}</figcaption></figure>`).join('')}</div>`
    : '';
  const fileId = meetingDriveFileId(row.SlideFileURL);
  const filePreview = row.SlideFileURL
    ? `<div class="training-slide-file"><a href="${escapeAttr(row.SlideFileURL)}" target="_blank" rel="noopener">📊 เปิดไฟล์สไลด์ต้นฉบับ${row.SlideFileName ? ' · ' + escapeHtml(row.SlideFileName) : ''}</a>${!images.length && fileId ? `<iframe title="พรีวิวสไลด์ Training" src="https://drive.google.com/file/d/${escapeAttr(fileId)}/preview" loading="lazy" allowfullscreen></iframe>` : ''}</div>`
    : '';
  return `${meetingDetailHtml(row.Detail, meetingPhotoList(row), row.VideoURL, row.VideoFileName)}${meetingUnassignedPhotoGallery(row)}${imageSlides}${filePreview}`;
}

function trainingRecordCardHtml(row) {
  const details = [formatDate(row.MeetingDate)];
  if (row.TrainingTime) details.push(row.TrainingTime);
  if (row.TrainingUnit) details.push(row.TrainingUnit);
  if (row.Shift) details.push('กะ ' + row.Shift);
  if (row.LineName || row.LineID) details.push(row.LineName || row.LineID);
  const trainer = row.TrainerName || row.CreatedByName || '';
  const summaryText = row.TrainingEffect ? `<div class="training-effect"><strong>ผลการ Training</strong><p>${escapeHtml(row.TrainingEffect)}</p></div>` : '';
  const actions = [
    hasPermission('meeting.quiz.manage') ? `<button type="button" class="btn btn-secondary" data-training-quiz-manage="${escapeAttr(row.PostID)}">✨ Gen / จัดการข้อสอบ</button>` : '',
    `<button type="button" class="btn btn-primary" data-training-pdf="${escapeAttr(row.PostID)}">⬇ PDF แบบฟอร์มลงชื่อ</button>`,
    row.SignedTrainingPDFURL ? `<a class="btn btn-outline" href="${escapeAttr(row.SignedTrainingPDFURL)}" title="${escapeAttr(row.SignedTrainingPDFName || 'PDF ที่พนักงานเซ็นแล้ว')}" target="_blank" rel="noopener">📄 ดู PDF ที่เซ็นแล้ว</a>` : '',
    row.CanEdit ? `<label class="btn btn-outline training-signed-pdf-upload">📎 ${row.SignedTrainingPDFURL ? 'เปลี่ยน PDF ที่เซ็นแล้ว' : 'แนบ PDF ที่เซ็นแล้ว'}<input type="file" accept="application/pdf,.pdf" data-training-signed-pdf="${escapeAttr(row.PostID)}" aria-label="แนบ PDF ที่พนักงานเซ็นแล้ว"></label>` : '',
    `<button type="button" class="btn btn-outline" data-training-print="${escapeAttr(row.PostID)}">🖨 พิมพ์แบบบันทึก + สไลด์</button>`,
    row.CanEdit ? `<button type="button" class="btn btn-outline" data-training-edit="${escapeAttr(row.PostID)}">แก้ไข</button>` : ''
  ].filter(Boolean).join('');
  return `<article class="training-record-card">
    <div class="training-card-heading"><span class="training-type-chip">🎓 TRAINING</span><span class="training-card-date">${escapeHtml(formatDate(row.MeetingDate))}</span></div>
    <h3>${escapeHtml(row.Topic || 'Training')}</h3>
    <p class="training-card-meta">${details.slice(1).map(escapeHtml).join(' · ')}${trainer ? `${details.length > 1 ? ' · ' : ''}ผู้ให้ Training ${escapeHtml(trainer)}` : ''}</p>
    ${summaryText}
    <details class="training-review"><summary>ทบทวนเนื้อหาและสไลด์</summary><div class="training-review-content">${trainingRecordSlidesHtml(row) || '<p class="muted">ยังไม่มีรายละเอียดหรือไฟล์สไลด์</p>'}</div></details>
    ${actions ? `<div class="training-card-actions">${actions}</div>` : ''}
  </article>`;
}

function renderTrainingArchive() {
  const container = $('#trainingArchive');
  if (!container) return;
  const query = String($('#trainingSearch')?.value || '').trim().toLocaleLowerCase();
  const rows = (state.trainingRecords || []).filter(row => {
    if (!query) return true;
    return [row.Topic, row.Detail, row.TrainingUnit, row.TrainingPlace, row.TrainerName, row.TrainingEffect]
      .some(value => String(value || '').toLocaleLowerCase().includes(query));
  });
  $('#trainingArchiveSummary').innerHTML = `<div class="training-summary-card"><strong>${rows.length}</strong><span>รายการ Training${query ? ' ที่ตรงกับคำค้น' : ''}</span></div>`;
  container.innerHTML = rows.length ? rows.map(trainingRecordCardHtml).join('') : emptyHtml(query ? 'ไม่พบรายการที่ตรงกับคำค้น' : 'ยังไม่มีประวัติ Training เลือกโหมด Training ตอนเพิ่มหัวข้อจากหน้า Meeting');
}

function handleTrainingArchiveClick(event) {
  const quiz = event.target.closest('[data-training-quiz-manage]');
  if (quiz) return openMeetingQuizAdmin(quiz.dataset.trainingQuizManage);
  const pdf = event.target.closest('[data-training-pdf]');
  if (pdf) return printTrainingRecord(pdf.dataset.trainingPdf, { includeSlides: false });
  const print = event.target.closest('[data-training-print]');
  if (print) return printTrainingRecord(print.dataset.trainingPrint);
  const edit = event.target.closest('[data-training-edit]');
  if (edit) return openMeetingEditor(edit.dataset.trainingEdit, 'Training');
}

async function handleTrainingArchiveFileChange(event) {
  const input = event.target.closest('[data-training-signed-pdf]');
  if (!input) return;
  const file = input.files && input.files[0];
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) {
    input.value = '';
    return showToast('กรุณาเลือกไฟล์ PDF เท่านั้น', 'warning');
  }
  if (file.size > 10 * 1024 * 1024) {
    input.value = '';
    return showToast('ไฟล์ต้องมีขนาดไม่เกิน 10 MB', 'warning');
  }
  input.disabled = true;
  showLoading('กำลังแนบ PDF ใบเซ็น Training...');
  try {
    await uploadSignedTrainingPDF(file, input.dataset.trainingSignedPdf);
    showToast('แนบ PDF ใบเซ็น Training สำเร็จ', 'success');
    await loadTrainingPage();
  } catch (error) {
    showToast(error.message || 'แนบ PDF ไม่สำเร็จ', 'error');
  } finally {
    hideLoading();
    input.disabled = false;
    input.value = '';
  }
}

function trainingPrintSlideHtml(slide, index, row) {
  if (slide.isPpt) {
    return `<article class="training-print-slide"><p class="training-print-slide-label">สไลด์ ${index + 1} · หน้า ${slide.pptPage}/${slide.pptTotal}</p><img src="${escapeAttr(driveThumbnailUrl_(slide.pptUrl, 1600))}" alt="สไลด์ Training หน้า ${slide.pptPage}"></article>`;
  }
  if (slide.isDoc) {
    const fileId = meetingDriveFileId(slide.docUrl);
    const previewUrl = fileId ? `https://drive.google.com/file/d/${fileId}/preview` : slide.docUrl;
    return `<article class="training-print-slide"><p class="training-print-slide-label">ไฟล์สไลด์แนบ · ${escapeHtml(slide.docName || row.SlideFileName || 'เอกสารประกอบ')}</p><iframe title="ไฟล์สไลด์ Training" src="${escapeAttr(previewUrl)}"></iframe><a href="${escapeAttr(slide.docUrl)}" target="_blank" rel="noopener">เปิดไฟล์ต้นฉบับ</a></article>`;
  }
  const photoNumbers = slide.photoNumbers || (slide.photos || []).map((_, i) => i + 1);
  const inlineContent = slide.hasMediaMarkers
    ? `<div class="training-print-slide-text">${(slide.contentParts || []).map(part => part.type === 'photo'
      ? `<figure class="training-print-inline-photo"><img src="${escapeAttr(driveThumbnailUrl_(part.url, 1200))}" alt="รูปที่ ${part.number}"><figcaption>รูปที่ ${part.number}</figcaption></figure>`
      : part.type === 'video' ? `<p><a href="${escapeAttr(part.url)}" target="_blank" rel="noopener">▶ เปิดวิดีโอประกอบ ${escapeHtml(part.fileName || 'Training')}</a></p>` : escapeHtml(part.text)).join('')}</div>${!slide.hasPhotoMarkers ? (slide.photos || []).map((url, i) => `<figure class="training-print-photo"><img src="${escapeAttr(driveThumbnailUrl_(url, 1200))}" alt="รูปที่ ${photoNumbers[i]}"><figcaption>รูปที่ ${photoNumbers[i]}</figcaption></figure>`).join('') : ''}`
    : `${slide.sectionText ? `<div class="training-print-slide-text">${escapeHtml(slide.sectionText)}</div>` : ''}${(slide.photos || []).map((url, i) => `<figure class="training-print-photo"><img src="${escapeAttr(driveThumbnailUrl_(url, 1200))}" alt="รูปที่ ${photoNumbers[i]}"><figcaption>รูปที่ ${photoNumbers[i]}</figcaption></figure>`).join('')}`;
  return `<article class="training-print-slide"><p class="training-print-slide-label">เนื้อหา Training · สไลด์ ${index + 1}</p>${inlineContent}</article>`;
}

// Use the same marker-to-photo mapping as TV so [รูปN] prints as its actual image.
function trainingPrintDetailHtml(row) {
  if (!String(row.Detail || '').trim() && !meetingPhotoList(row).length && !row.VideoURL) return '-';
  const slides = meetingTvPostSlides([{ row, carry: false }]).filter(slide => !slide.isPpt && !slide.isDoc);
  if (!slides.length) return escapeHtml(row.Detail || '-').replace(/\n/g, '<br>');
  return slides.map((slide, index) => {
    const textHtml = slide.hasMediaMarkers
      ? (slide.contentParts || []).map(part => part.type === 'photo'
        ? `<figure class="training-print-inline-photo"><img src="${escapeAttr(driveThumbnailUrl_(part.url, 1200))}" alt="รูปที่ ${part.number}"><figcaption>รูปที่ ${part.number}</figcaption></figure>`
        : part.type === 'video' ? `<a href="${escapeAttr(part.url)}" target="_blank" rel="noopener">▶ เปิดวิดีโอประกอบ ${escapeHtml(part.fileName || 'Training')}</a>`
          : escapeHtml(part.text).replace(/\n/g, '<br>')).join('')
      : escapeHtml(slide.sectionText || '').replace(/\n/g, '<br>');
    const loosePhotos = slide.hasPhotoMarkers ? [] : (slide.photos || []).map((url, photoIndex) => {
      const number = (slide.photoNumbers || [])[photoIndex] || photoIndex + 1;
      return `<figure class="training-print-photo"><img src="${escapeAttr(driveThumbnailUrl_(url, 1200))}" alt="รูปที่ ${number}"><figcaption>รูปที่ ${number}</figcaption></figure>`;
    });
    const sectionLabel = slide.sectionCount > 1
      ? `<p class="training-print-detail-label">${slide.isUnassignedPhotos ? 'รูปที่ยังไม่ได้ระบุตำแหน่งในรายละเอียด' : `สไลด์ ${index + 1}`}</p>`
      : '';
    return `<div class="training-print-detail-section">${sectionLabel}<div class="training-print-detail-text">${textHtml}</div>${loosePhotos.join('')}</div>`;
  }).join('');
}

async function printTrainingRecord(postId, { includeSlides = true, rowOverride = null } = {}) {
  const row = rowOverride || (state.trainingRecords || []).find(item => String(item.PostID) === String(postId)) || findMeetingPost(postId);
  if (!row) return showToast('ไม่พบรายการ Training นี้', 'error');
  const dateAndTime = `${formatDate(row.MeetingDate)}${row.TrainingTime ? ' · ' + escapeHtml(row.TrainingTime) : ''}`;
  const slides = includeSlides ? meetingTvPostSlides([{ row, carry: false }]) : [];
  const printRoot = $('#trainingPrintRoot');
  printRoot.innerHTML = `<article class="training-print-form">
      <h1>Training implementation effect record sheet.</h1>
      <table class="training-record-table"><colgroup><col><col><col><col></colgroup><tbody>
        <tr><th>Training program</th><td colspan="3">${escapeHtml(row.Topic || '-')}</td></tr>
        <tr><th>Brief introduction of training content</th><td colspan="3">${trainingPrintDetailHtml(row)}</td></tr>
        <tr><th>Training Date (date, hour)</th><td>${dateAndTime}</td><th>Training place</th><td>${escapeHtml(row.TrainingPlace || '') || '&nbsp;'}</td></tr>
        <tr><th>Training and implementation unit</th><td>${escapeHtml(row.TrainingUnit || row.LineName || row.LineID || '') || '&nbsp;'}</td><th>Trainer</th><td>${escapeHtml(row.TrainerName || row.CreatedByName || '') || '&nbsp;'}</td></tr>
        <tr><th colspan="4">Signed:</th></tr>
        <tr><th colspan="4">Planned training?： <span class="training-record-checks">${String(row.TrainingPlanned || 'Yes').toLowerCase() === 'no' ? '☐ Yes　　 ☒ No，But recorded' : '☒ Yes　　 ☐ No，But recorded'}</span></th></tr>
        <tr><th colspan="4">Training implementation effect:<br><span class="training-record-effect">${row.TrainingEffect ? escapeHtml(row.TrainingEffect).replace(/\n/g, '<br>') : '&nbsp;'}</span></th></tr>
      </tbody></table>
    </article>
    ${includeSlides ? `<section class="training-print-slides"><h2>Training slides / เนื้อหาที่ใช้ฝึกอบรม</h2>${slides.length ? slides.map((slide, index) => trainingPrintSlideHtml(slide, index, row)).join('') : '<p>ไม่มีรายละเอียด รูป หรือไฟล์สไลด์แนบ</p>'}</section>` : ''}`;
  printRoot.classList.remove('hidden');
  printRoot.style.cssText = 'display:block;position:fixed;left:-10000px;top:0;width:210mm;visibility:hidden;';
  document.body.classList.add('training-printing');
  document.body.classList.toggle('training-print-form-only', !includeSlides);
  const imageLoads = Array.from(printRoot.querySelectorAll('img')).map(image => image.complete
    ? Promise.resolve()
    : new Promise(resolve => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    }));
  await Promise.race([Promise.all(imageLoads), new Promise(resolve => window.setTimeout(resolve, 5000))]);
  printRoot.style.cssText = '';
  window.print();
}

function printTrainingDraftFromEditor() {
  if ($('#meetingPostType').value !== 'Training') return;
  const topic = $('#meetingPostTopic').value.trim();
  if (!topic) return showToast('กรอกหัวข้อ Training ก่อนพิมพ์แบบฟอร์มลงชื่อ', 'warning');
  const row = {
    PostID: $('#meetingPostId').value || 'TRAINING-DRAFT',
    ContentType: 'Training',
    MeetingDate: $('#meetingPostDate').value || localDateInput(new Date()),
    Topic: topic,
    Detail: $('#meetingPostDetail').value.trim(),
    TrainingTime: $('#meetingTrainingTime').value,
    TrainingPlace: $('#meetingTrainingPlace').value.trim(),
    TrainingUnit: $('#meetingTrainingUnit').value.trim(),
    TrainerName: $('#meetingTrainerName').value.trim(),
    TrainingPlanned: $('#meetingTrainingPlanned').value,
    TrainingEffect: $('#meetingTrainingEffect').value.trim(),
    LineID: $('#meetingPostLine').value === 'ALL' ? '' : $('#meetingPostLine').value
  };
  return printTrainingRecord(row.PostID, { includeSlides: false, rowOverride: row });
}

function clearTrainingPrintView() {
  document.body.classList.remove('training-printing');
  document.body.classList.remove('training-print-form-only');
  const printRoot = $('#trainingPrintRoot');
  if (printRoot) {
    printRoot.classList.add('hidden');
    printRoot.style.cssText = '';
    printRoot.innerHTML = '';
  }
}

function meetingCategoryMeta(category) {
  return MEETING_CATEGORY_META[String(category || '').trim()] || MEETING_CATEGORY_META['ทั่วไป'];
}

function isMeetingPinned(row) {
  return ['yes', 'true', '1'].includes(String(row?.Pinned || '').toLowerCase());
}

function meetingBoardPayload() {
  const dateInput = $('#meetingDate');
  if (!dateInput.value) dateInput.value = localDateInput(new Date());
  const payload = { meetingDate: dateInput.value };
  const lineId = optionalFilterValue($('#meetingLine').value);
  const category = optionalFilterValue($('#meetingCategory').value);
  if (lineId) payload.lineId = lineId;
  if (category) payload.category = category;
  return payload;
}

/** Load the board first, then refresh the Finding digest and master data in
 * parallel so slower auxiliary data does not hold the Meeting board open. */
async function loadMeetingPage() {
  const wantsDigest = hasAnyPermission(['dashboard.view', 'dashboard.view.all']);
  $('#meetingBoard').innerHTML = '<div class="empty-state">กำลังโหลดบอร์ดประชุม...</div>';
  if (wantsDigest) $('#meetingShiftDigest').innerHTML = '<div class="empty-state">กำลังโหลด...</div>';

  let posts;
  try {
    // This is a user navigation, so let the board jump ahead of queued
    // background reads. It is a single request and does not wait on the digest.
    posts = await apiCall('getMeetingPosts', meetingBoardPayload(), { priority: 'high' });
  } catch (error) {
    $('#meetingBoard').innerHTML = emptyHtml(error.message);
    if (wantsDigest) $('#meetingShiftDigest').innerHTML = emptyHtml('โหลด Finding ไม่สำเร็จ');
    showToast(error.message, 'error');
    return;
  }

  await loadMeetingBoard(posts);
  // Keep the heavier digest off the critical path so the Meeting board becomes
  // usable as soon as its posts arrive. The digest and master data can then
  // load together in the background.
  const masterDataTask = ensureMasterDataLoaded(false);
  if (wantsDigest) {
    const digestTask = apiCall('getFindingShiftDigest', {}, { priority: 'normal' });
    Promise.all([masterDataTask, digestTask]).then(([, digest]) =>
      loadFindingShiftDigest('meetingShiftDigest', 'meetingShiftDigestPic', digest)
    ).catch(error => {
      const digest = $('#meetingShiftDigest');
      if (digest) digest.innerHTML = emptyHtml(error.message || 'โหลด Finding ไม่สำเร็จ');
    });
  }
  else masterDataTask.catch(error => console.warn('Meeting master data load failed:', error.message || error));
}

async function loadMeetingBoard(prefetched = null) {
  const payload = meetingBoardPayload();
  const container = $('#meetingBoard');
  if (!prefetched) container.innerHTML = '<div class="empty-state">กำลังโหลดบอร์ดประชุม...</div>';
  try {
    const data = prefetched || await apiCall('getMeetingPosts', payload, { priority: 'high' });
    state.meetingPosts = data.posts || [];
    state.meetingCarryOver = data.carryOver || [];
    state.meetingCanCreate = Boolean(data.canCreate);
    state.meetingCanManage = Boolean(data.canManage);
    state.meetingCanManageQuiz = Boolean(data.canManageQuiz);
    $('#addMeetingPostButton').classList.toggle('hidden', !state.meetingCanCreate);
    renderMeetingBoard();
    refreshMeetingTvQuizStatus();
    if ($('#page-meeting')?.classList.contains('active-page')) refreshMeetingQuizBoardStatus();
  } catch (error) {
    container.innerHTML = emptyHtml(error.message);
    showToast(error.message, 'error');
  }
}

async function refreshMeetingQuizBoardStatus() {
  if (state.meetingQuizBoardStatusRefreshPromise) return state.meetingQuizBoardStatusRefreshPromise;
  const posts = [...(state.meetingPosts || []), ...(state.meetingCarryOver || [])];
  // The board response already contains the lightweight create/draft flags.
  // Only fetch full roster and submission progress when a quiz is published.
  if (!posts.some(post => post.MeetingQuiz?.available || post.TrainingQuiz?.available)) return;
  const meetingDates = [...new Set(posts.map(post => String(post.MeetingDate || '').slice(0, 10)).filter(Boolean))];
  if (!meetingDates.length) return;
  const trainingPostIds = [...new Set(posts
    .filter(post => String(post.ContentType || '').toLowerCase() === 'training' && post.TrainingQuiz?.available)
    .map(post => String(post.PostID || '').trim()).filter(Boolean))].slice(0, 10);
  const request = (async () => {
    const data = await apiCall('getMeetingQuizStatus', { meetingDates, trainingPostIds }, { priority: 'low', quiet: true });
    const summaries = data.summariesByDate || {};
    const trainingSummaries = data.summariesByPostId || {};
    let changed = false;
    posts.forEach(post => {
      if (String(post.ContentType || '').toLowerCase() === 'training') {
        const next = trainingSummaries[post.PostID];
        if (next && JSON.stringify(post.TrainingQuiz || {}) !== JSON.stringify(next)) {
          post.TrainingQuiz = next;
          changed = true;
        }
      } else {
        const date = String(post.MeetingDate || '').slice(0, 10);
        const next = summaries[date];
        if (next && JSON.stringify(post.MeetingQuiz || {}) !== JSON.stringify(next)) {
          post.MeetingQuiz = next;
          changed = true;
        }
      }
    });
    if (changed) {
      if ($('#page-meeting')?.classList.contains('active-page')) renderMeetingBoard();
      // The TV uses its own overlay and can remain visible while another app
      // page is active. Always refresh its live status when the quiz summary
      // arrives, otherwise the initial empty preview (0 shifts) stays on TV.
      refreshMeetingTvQuizStatus();
    }
  })();
  state.meetingQuizBoardStatusRefreshPromise = request;
  try {
    await request;
  } catch (error) {
    console.warn('Meeting quiz board status refresh failed:', error.message || error);
  } finally {
    if (state.meetingQuizBoardStatusRefreshPromise === request) state.meetingQuizBoardStatusRefreshPromise = null;
  }
}

function renderMeetingBoard() {
  const container = $('#meetingBoard');
  const posts = state.meetingPosts;
  const carryOver = state.meetingCarryOver;
  const discussed = posts.filter(p => ['discussed', 'closed'].includes(String(p.Status || '').toLowerCase())).length;
  const progress = posts.length
    ? `<div class="mtg-progress${discussed >= posts.length ? ' mtg-progress-done' : ''}">คุย/Training แล้ว ${discussed} จาก ${posts.length} หัวข้อ${discussed >= posts.length ? ' ✅' : ''}</div>`
    : '';
  const shownQuizDates = new Set();
  const renderDailyPostCard = (row, isCarry) => {
    const isTraining = String(row.ContentType || '').toLowerCase() === 'training';
    const quiz = isTraining ? (row.TrainingQuiz || {}) : (row.MeetingQuiz || {});
    if (isTraining) return meetingPostCardHtml(row, isCarry, Boolean(quiz.available || quiz.canManage || quiz.hasDraft));
    const dateKey = String(row.MeetingDate || '').slice(0, 10);
    const hasDailyQuizAction = Boolean(quiz.available || quiz.canManage || quiz.hasDraft);
    const showQuizActions = hasDailyQuizAction && !shownQuizDates.has(dateKey);
    if (showQuizActions) shownQuizDates.add(dateKey);
    return meetingPostCardHtml(row, isCarry, showQuizActions);
  };
  const todayHtml = posts.length
    ? posts.map(row => renderDailyPostCard(row, false)).join('')
    : emptyHtml(state.meetingCanCreate ? 'ยังไม่มีหัวข้อสำหรับวันนี้ กด "+ เพิ่มหัวข้อ" เพื่อลงเรื่องที่จะคุย' : 'ยังไม่มีหัวข้อสำหรับวันนี้');
  const carryHtml = carryOver.length
    ? `<div class="mtg-carry-section"><div class="mtg-carry-title">⏳ ค้างจากวันก่อน (${carryOver.length})</div>${carryOver.map(row => renderDailyPostCard(row, true)).join('')}</div>`
    : '';
  container.innerHTML = `${progress}${todayHtml}${carryHtml}`;
  $$('[data-mtg-edit]', container).forEach(btn => btn.addEventListener('click', () => openMeetingEditor(btn.dataset.mtgEdit)));
  $$('[data-mtg-status]', container).forEach(btn => btn.addEventListener('click', () => setMeetingPostStatus(btn, btn.dataset.mtgId, btn.dataset.mtgStatus)));
  $$('[data-mtg-ack]', container).forEach(btn => btn.addEventListener('click', () => ackMeetingPost(btn, btn.dataset.mtgAck)));
}

function meetingAckSectionHtml(row) {
  if (!row.AckRequiredCount) return '';
  const done = row.AckedCount >= row.AckRequiredCount;
  const acked = (row.AckedNames || []).join(', ');
  const pending = (row.AckPendingNames || []).join(', ');
  return `<div class="mtg-ack${done ? ' mtg-ack-done' : ''}">
    <div class="mtg-ack-count">🙋 รับทราบแล้ว ${row.AckedCount}/${row.AckRequiredCount}${done ? ' ✅' : ''}</div>
    ${acked ? `<div class="mtg-ack-names">✓ ${escapeHtml(acked)}</div>` : ''}
    ${pending ? `<div class="mtg-ack-names mtg-ack-pending">⏳ ยังไม่รับทราบ: ${escapeHtml(pending)}</div>` : ''}
    ${row.NeedsMyAck ? `<button class="btn btn-primary mtg-ack-btn" data-mtg-ack="${escapeAttr(row.PostID)}">✋ กดรับทราบ</button>` : ''}
  </div>`;
}

function meetingPostCardHtml(row, isCarry, showQuizActions = true) {
  const isTraining = String(row.ContentType || '').toLowerCase() === 'training';
  const cat = meetingCategoryMeta(row.Category);
  const status = String(row.Status || 'Open').toLowerCase();
  const statusMeta = status === 'closed' ? { label: 'จบเรื่อง', cls: 'status-closed' } :
    status === 'discussed' ? { label: 'คุยแล้ว', cls: 'status-ok' } : { label: 'รอคุย', cls: 'status-open' };
  const priority = String(row.Priority || 'ปกติ');
  const priorityChip = priority === 'ด่วน' ? '<span class="mtg-priority mtg-priority-urgent">ด่วน</span>' :
    priority === 'สำคัญ' ? '<span class="mtg-priority mtg-priority-important">สำคัญ</span>' : '';
  const completionLabel = isTraining ? 'Training แล้ว' : 'คุยแล้ว';
  const canTick = state.meetingCanCreate;
  const actions = [];
  if (canTick && status === 'open') actions.push(`<button class="btn btn-secondary" data-mtg-status="Discussed" data-mtg-id="${escapeAttr(row.PostID)}">✓ ${completionLabel}</button>`);
  if (canTick && status === 'discussed') actions.push(`<button class="btn btn-outline" data-mtg-status="Closed" data-mtg-id="${escapeAttr(row.PostID)}">${isTraining ? 'ปิด Training' : 'จบเรื่อง'}</button>`);
  if (canTick && status !== 'open') actions.push(`<button class="btn btn-ghost" data-mtg-status="Open" data-mtg-id="${escapeAttr(row.PostID)}">↩ รอคุย</button>`);
  if (isTraining) actions.push(`<button class="btn btn-outline" data-training-form-print="${escapeAttr(row.PostID)}" title="พิมพ์แบบฟอร์มลงชื่อก่อนเริ่ม Training">🖨 พิมพ์แบบฟอร์มลงชื่อ</button>`);
  const quiz = isTraining ? (row.TrainingQuiz || {}) : (row.MeetingQuiz || {});
  if (showQuizActions) {
    if (quiz.allSubmitted) actions.push(`<button class="btn btn-primary" data-mtg-quiz-review="${escapeAttr(row.PostID)}">🔑 เฉลย</button>`);
    if (quiz.canManage) actions.push(`<button class="btn btn-outline" data-mtg-quiz-manage="${escapeAttr(row.PostID)}">${quiz.available ? '📱 QR / จัดการข้อสอบ' : (quiz.hasDraft ? '✏️ แก้ไขข้อสอบร่าง' : (quiz.canGenerate ? '✨ Gen ข้อสอบ 5 ข้อ' : '👷 รอ Admin/Engineer สร้าง'))}</button>`);
    if (quiz.available) {
      actions.push(`<button class="btn btn-secondary" data-mtg-quiz-open="${escapeAttr(row.PostID)}">📝 ทำข้อสอบ / ดูเฉลยของฉัน</button>`);
    }
  }
  if (row.CanEdit) actions.push(`<button class="btn btn-outline" data-mtg-edit="${escapeAttr(row.PostID)}">แก้ไข</button>`);
  const metaParts = [
    `${formatDate(row.MeetingDate)}${row.Shift ? ' · กะ ' + escapeHtml(row.Shift) : ''}`,
    escapeHtml(row.LineName || row.LineID || 'ทุกไลน์'),
    `ลงโดย ${escapeHtml(row.CreatedByName || '-')}`
  ];
  if (row.DiscussedBy) metaParts.push(`คุยแล้วโดย ${escapeHtml(row.DiscussedBy)}`);
  return `<article class="meeting-card ${cat.cls}${status === 'closed' ? ' mtg-done' : ''}${status === 'discussed' ? ' mtg-discussed' : ''}">
    <div class="mtg-head">
      <div class="mtg-head-left">
        ${isMeetingPinned(row) ? '<span class="mtg-pin" title="ปักหมุด">📌</span>' : ''}
        ${isTraining ? '<span class="training-type-chip">🎓 TRAINING</span>' : ''}
        <span class="mtg-cat-chip ${cat.cls}">${cat.icon} ${escapeHtml(row.Category || 'ทั่วไป')}</span>
        ${priorityChip}
        ${isCarry ? `<span class="mtg-carry-chip">ค้างจาก ${formatDate(row.MeetingDate)}</span>` : ''}
      </div>
      <span class="status-badge ${statusMeta.cls}">${statusMeta.label}</span>
    </div>
    <div class="mtg-topic">${escapeHtml(row.Topic || '-')}</div>
    ${meetingDetailHtml(row.Detail, meetingPhotoList(row), row.VideoURL, row.VideoFileName)}
    ${meetingUnassignedPhotoGallery(row)}
    ${(() => {
      const pptCount = String(row.SlideImageURLs || '').split(',').map(u => u.trim()).filter(Boolean).length;
      if (pptCount) return `<div class="mtg-doc"><span class="mtg-doc-badge">📊 สไลด์ PPT ${pptCount} หน้า · ฉายในโหมด TV</span>${row.SlideFileURL ? ` <a href="${escapeAttr(row.SlideFileURL)}" target="_blank" rel="noopener" class="btn btn-outline btn-compact">เปิดไฟล์ต้นฉบับ</a>` : ''}</div>`;
      if (row.SlideFileURL) return `<div class="mtg-doc"><a href="${escapeAttr(row.SlideFileURL)}" target="_blank" rel="noopener" class="btn btn-outline btn-compact">📊 เปิดสไลด์ PPT/PDF${row.SlideFileName ? ' · ' + escapeHtml(row.SlideFileName) : ''}</a></div>`;
      return '';
    })()}
    ${showQuizActions && quiz.available
      ? `<div class="mtg-quiz-summary">ข้อสอบ 5 ข้อ · ${(quiz.shiftSessions || []).map(session => `${escapeHtml(session.label || session.shift)} ลงชื่อ ${session.registeredCount || 0} · เริ่ม ${session.startedCount ?? session.participantCount ?? 0} · ส่ง ${session.submittedCount || 0}${session.rosterStatus === 'Locked' ? ' · ปิดรับ' : ' · เปิดรับ'}`).join(' · ')}</div>${(quiz.people || []).length ? `<div class="mtg-quiz-summary">✅ ส่งแล้ว: ${quiz.people.filter(p => p.submitted).map(p => `${escapeHtml(p.name)} (${escapeHtml(p.shift)})`).join(', ') || '-'}<br>📝 เริ่มแล้วแต่ยังไม่ส่ง: ${quiz.people.filter(p => p.started && !p.submitted).map(p => `${escapeHtml(p.name)} (${escapeHtml(p.shift)})`).join(', ') || '-'}<br>⏳ ลงชื่อแล้วแต่ยังไม่เริ่ม: ${quiz.people.filter(p => !p.started).map(p => `${escapeHtml(p.name)} (${escapeHtml(p.shift)})`).join(', ') || '-'}</div>` : ''}`
      : (showQuizActions && quiz.canManage ? `<div class="mtg-quiz-summary">${isTraining ? 'Training นี้' : 'วันนี้'}ยังไม่มีข้อสอบ</div>` : '')}
    ${meetingAckSectionHtml(row)}
    <div class="mtg-meta">${metaParts.join(' · ')}</div>
    ${actions.length ? `<div class="mtg-actions">${actions.join('')}</div>` : ''}
  </article>`;
}

function handleMeetingQuizBoardClick(event) {
  const trainingPrint = event.target.closest('[data-training-form-print]');
  if (trainingPrint) return printTrainingRecord(trainingPrint.dataset.trainingFormPrint, { includeSlides: false });
  const manage = event.target.closest('[data-mtg-quiz-manage]');
  if (manage) return openMeetingQuizAdmin(manage.dataset.mtgQuizManage);
  const open = event.target.closest('[data-mtg-quiz-open]');
  if (open) return openMeetingQuizExam(open.dataset.mtgQuizOpen);
  const review = event.target.closest('[data-mtg-quiz-review]');
  if (review) return openMeetingQuizAnswerKey(review.dataset.mtgQuizReview);
}

function meetingQuizTokenStorageKey(quizId) { return `lpa_mtg_quiz_token_${String(quizId || '')}`; }
function meetingQuizPublicTokenStorageKey(publicToken) { return `lpa_mtg_quiz_public_${String(publicToken || '')}`; }

function meetingQuizScope(model) {
  return model && model.publicMode ? { publicToken: model.publicToken } : { postId: model.postId };
}

function meetingQuizExamTitleElement(model = state.meetingQuizExam) {
  return $(model && model.publicMode ? '#publicMeetingQuizTitle' : '#meetingQuizExamTitle');
}

function meetingQuizExamContentElement(model = state.meetingQuizExam) {
  return $(model && model.publicMode ? '#publicMeetingQuizContent' : '#meetingQuizExamContent');
}

async function openMeetingQuizAdmin(postId) {
  stopMeetingQuizAdminPolling();
  const post = findMeetingPost(postId);
  if (!post) return;
  state.meetingQuizAdmin = { postId, post, quiz: null, questions: [], participants: [], summary: {} };
  $('#meetingQuizAdminTitle').textContent = `จัดการข้อสอบ · ${post.Topic || postId}`;
  $('#meetingQuizAdminContent').innerHTML = '<div class="empty-state">กำลังโหลดข้อมูลข้อสอบ...</div>';
  $('#meetingQuizAdminDialog').showModal();
  await refreshMeetingQuizAdmin();
  const model = state.meetingQuizAdmin;
  const isTraining = String(model?.post?.ContentType || post.ContentType || '').toLowerCase() === 'training';
  if (model && !model.quiz && model.canGenerate && Number(model.post?.SlideCount || 0) > 0 && (isTraining || meetingQuizIsToday(model.post?.MeetingDate))) {
    try {
      await generateMeetingQuizDraft(model, { automatic: true });
      showToast(isTraining ? 'สร้างข้อสอบฉบับร่าง 5 ข้อจาก Training นี้แล้ว ตรวจแก้ก่อนเผยแพร่' : 'สร้างข้อสอบฉบับร่าง 5 ข้อจากทุกหัวข้อวันนี้แล้ว ตรวจแก้ก่อนเผยแพร่', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }
}

function meetingQuizIsToday(value) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok' }).format(new Date());
  return String(value || '').slice(0, 10) === today;
}

async function generateMeetingQuizDraft(model, { automatic = false, createNewVersion = false } = {}) {
  if (!model) return;
  model.autoGenerating = true;
  model.generationError = '';
  renderMeetingQuizAdmin();
  if (createNewVersion) setMeetingQuizEditorSaving(true);
  if (!automatic) showLoading('กำลังอ่านสไลด์และสร้างข้อสอบ 5 ข้อ...');
  try {
    if (createNewVersion && String(model.quiz?.Status || '').toLowerCase() === 'draft') {
      const currentDraftQuestions = readMeetingQuizAdminQuestions();
      model.questions = currentDraftQuestions;
      await apiCall('saveMeetingQuizDraft', {
        postId: model.postId, quizId: model.quiz.QuizID, questions: currentDraftQuestions
      });
    }
    const data = await apiCall('generateMeetingQuiz', {
      postId: model.postId,
      ...(String(model.quiz?.Status || '').toLowerCase() === 'draft' ? { quizId: model.quiz.QuizID } : {}),
      ...(createNewVersion ? {
        createNewVersion: true,
        ...(String(model.quiz?.Status || '').toLowerCase() === 'draft' ? { replaceQuizId: model.quiz.QuizID } : {})
      } : {})
    });
    if (!data?.quiz || !Array.isArray(data.questions) || data.questions.length !== 5) {
      throw new Error('ระบบไม่ได้รับข้อสอบครบ 5 ข้อจาก API กรุณาตรวจสถานะและลองอีกครั้ง');
    }
    const quizVersions = [data.quiz, ...(model.quizVersions || []).filter(version =>
      version.QuizID !== data.quiz.QuizID && version.QuizID !== data.deletedQuizId
    )];
    Object.assign(model, { quiz: data.quiz, questions: data.questions || [], participants: [], quizVersions });
    return data;
  } catch (error) {
    model.generationError = error.message;
    throw error;
  } finally {
    model.autoGenerating = false;
    renderMeetingQuizAdmin();
    if (!automatic) hideLoading();
  }
}

async function refreshMeetingQuizAdmin(quizId = '') {
  const current = state.meetingQuizAdmin;
  if (!current) return;
  if (current.refreshPromise) return current.refreshPromise;
  current.refreshPromise = (async () => {
    try {
      const data = await apiCall('getMeetingQuizAdmin', { postId: current.postId, ...(quizId ? { quizId } : {}) });
      if (state.meetingQuizAdmin !== current) return;
      Object.assign(current, data, { lastRefreshedAt: Date.now() });
      renderMeetingQuizAdmin();
      syncMeetingQuizAdminPolling();
    } catch (error) {
      if (state.meetingQuizAdmin !== current) return;
      if (!current.silentStatusRefresh) {
        $('#meetingQuizAdminContent').innerHTML = emptyHtml(error.message);
        showToast(error.message, 'error');
      } else {
        console.warn('Meeting quiz status refresh failed:', error.message || error);
      }
    } finally {
      current.refreshPromise = null;
      current.silentStatusRefresh = false;
    }
  })();
  return current.refreshPromise;
}

function stopMeetingQuizAdminPolling() {
  if (window._meetingQuizAdminPoll) clearInterval(window._meetingQuizAdminPoll);
  window._meetingQuizAdminPoll = null;
}

function syncMeetingQuizAdminPolling() {
  const model = state.meetingQuizAdmin;
  const dialog = $('#meetingQuizAdminDialog');
  const isPublished = String(model?.quiz?.Status || '').toLowerCase() === 'published';
  const needsUpdates = isPublished && !model?.summary?.allSubmitted;
  if (!dialog?.open || !needsUpdates) {
    stopMeetingQuizAdminPolling();
    return;
  }
  if (window._meetingQuizAdminPoll) return;
  window._meetingQuizAdminPoll = setInterval(() => {
    if (!dialog.open || document.visibilityState !== 'visible') return;
    const current = state.meetingQuizAdmin;
    if (!current || current.refreshPromise) return;
    current.silentStatusRefresh = true;
    refreshMeetingQuizAdmin(current.quiz?.QuizID || '');
  }, 3000);
}

function meetingQuizUiQuestion(row = {}) {
  const cleanChoices = values => (values || []).map(value => String(value || '').replace(/^\s*[A-D]\s*[.)、:：-]\s*/i, '').trim());
  const choicesTH = cleanChoices(row.choicesTH || [row.ChoiceATH || row.choiceATH || '', row.ChoiceBTH || row.choiceBTH || '', row.ChoiceCTH || row.choiceCTH || '', row.ChoiceDTH || row.choiceDTH || '']);
  const choicesMY = cleanChoices(row.choicesMY || [row.ChoiceAMY || row.choiceAMY || '', row.ChoiceBMY || row.choiceBMY || '', row.ChoiceCMY || row.choiceCMY || '', row.ChoiceDMY || row.choiceDMY || '']);
  const detectedCount = Math.max(
    choicesTH.reduce((last, value, index) => value ? index + 1 : last, 0),
    choicesMY.reduce((last, value, index) => value ? index + 1 : last, 0)
  );
  const optionCount = Math.max(2, Math.min(4, Number(row.optionCount || row.OptionCount) || detectedCount || 4));
  return {
    questionTH: row.QuestionTH || row.questionTH || '',
    choicesTH,
    questionMY: row.QuestionMY || row.questionMY || '',
    choicesMY,
    optionCount,
    correctOption: row.CorrectOption !== undefined ? String(row.CorrectOption || '').toUpperCase()
      : (row.correctOption !== undefined ? String(row.correctOption || '').toUpperCase() : 'A'),
    explanationTH: row.ExplanationTH || row.explanationTH || '',
    explanationMY: row.ExplanationMY || row.explanationMY || '',
    questionImageURL: row.QuestionImageURL || row.questionImageURL || ''
  };
}

function renderMeetingQuizAdmin() {
  const model = state.meetingQuizAdmin;
  if (!model) return;
  const isTraining = String(model.post?.ContentType || '').toLowerCase() === 'training';
  const quiz = model.quiz;
  const isDraft = quiz && String(quiz.Status || '').toLowerCase() === 'draft';
  const isManualDraft = isDraft && String(quiz.SourceType || '').toLowerCase() === 'manual';
  const summary = model.summary || {};
  const participants = model.participants || [];
  const publicUrl = quiz && !isDraft && quiz.PublicToken ? meetingQuizPublicUrl(quiz.PublicToken) : '';
  let qrSvg = '';
  if (publicUrl && typeof qrcode === 'function') {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(publicUrl);
      qr.make();
      qrSvg = qr.createSvgTag(5, 4);
    } catch (error) { console.warn('Could not build quiz QR code:', error); }
  }
  const statusText = !quiz ? 'ยังไม่มีฉบับข้อสอบ' : isDraft ? `${isManualDraft ? 'ฉบับร่างสร้างเอง/เกม' : 'ฉบับร่าง'} v${quiz.VersionNo || ''}` : 'เผยแพร่แล้ว · แยกรายชื่อและการปิดรับตามกะ';
  const hasSlides = Number(model.post?.SlideCount || 0) > 0;
  const canGenerate = Boolean(model.canGenerate) && !quiz && hasSlides;
  const canRegenerate = Boolean(model.canGenerate) && Boolean(quiz) && isDraft && hasSlides;
  const canStartManual = Boolean(model.canManage) && (!quiz || isDraft) && !isManualDraft;
  const canAttachTrainingImages = isTraining && isDraft && !isManualDraft && Boolean(model.canManage) &&
    (model.questions || []).some(question => !String(question.QuestionImageURL || question.questionImageURL || '').trim());
  const questionEditor = isDraft ? (model.questions || []).map((raw, index) => {
    const q = meetingQuizUiQuestion(raw);
    const choices = ['A', 'B', 'C', 'D'];
    const choiceFields = (lang, values) => `<div class="quiz-choice-grid">${choices.map((key, i) => `<label class="quiz-choice-row" data-option-index="${i + 1}"${i >= q.optionCount ? ' hidden' : ''}><strong>${key}</strong><textarea data-quiz-field="choice${key}${lang}" aria-label="ตัวเลือก ${key} ${lang}" data-required-for-publish>${escapeHtml(values[i] || '')}</textarea></label>`).join('')}</div>`;
    const correctOption = choices.slice(0, q.optionCount).includes(q.correctOption) ? q.correctOption : '';
    return `<section class="quiz-editor-question" data-quiz-q="${index}">
      <h4>ข้อ ${index + 1}</h4>
      <div class="quiz-question-image-field"><label>รูปประกอบ (ไม่บังคับ)<input type="file" accept="image/jpeg,image/png,image/webp" data-quiz-image="${index}"></label><input type="hidden" data-quiz-field="questionImageURL" value="${escapeAttr(q.questionImageURL)}"><div class="quiz-question-image-preview" data-quiz-image-preview>${q.questionImageURL ? `<img src="${escapeAttr(driveThumbnailUrl_(q.questionImageURL, 360))}" alt="รูปประกอบข้อ ${index + 1}" loading="lazy"><button type="button" class="btn btn-ghost btn-compact" data-quiz-remove-image>นำรูปออก</button>` : '<span class="field-help">เพิ่มรูปเพื่อใช้ประกอบคำถามหรือเกมได้</span>'}</div><span class="field-help">รูปจะเก็บใน Google Drive และเชื่อมกับข้อสอบนี้</span></div>
      <label class="quiz-option-count-control">จำนวนตัวเลือก<select data-quiz-option-count>${[2, 3, 4].map(count => `<option value="${count}" ${q.optionCount === count ? 'selected' : ''}>${count} ตัวเลือก</option>`).join('')}</select></label>
      <div class="quiz-editor-language-panel" data-quiz-language-panel="TH">
        <label class="quiz-editor-full-field">คำถามภาษาไทย<textarea data-quiz-field="questionTH" data-required-for-publish>${escapeHtml(q.questionTH)}</textarea></label>
        <strong class="quiz-editor-section-label">ตัวเลือกภาษาไทย</strong>${choiceFields('TH', q.choicesTH)}
        <label class="quiz-editor-full-field">คำอธิบายภาษาไทย<textarea data-quiz-field="explanationTH" data-required-for-publish>${escapeHtml(q.explanationTH)}</textarea></label>
      </div>
      <div class="quiz-editor-language-panel" data-quiz-language-panel="MY" hidden>
        <button type="button" class="btn btn-outline btn-compact quiz-translate-myanmar" data-quiz-translate-myanmar>แปลภาษาพม่าข้อนี้ใหม่จากภาษาไทย</button>
        <label class="quiz-editor-full-field">မေးခွန်း (မြန်မာ)<textarea data-quiz-field="questionMY" data-required-for-publish>${escapeHtml(q.questionMY)}</textarea></label>
        <strong class="quiz-editor-section-label">ရွေးချယ်စရာများ (မြန်မာ)</strong>${choiceFields('MY', q.choicesMY)}
        <label class="quiz-editor-full-field">ရှင်းလင်းချက် (မြန်မာ)<textarea data-quiz-field="explanationMY" data-required-for-publish>${escapeHtml(q.explanationMY)}</textarea></label>
      </div>
      <label class="quiz-editor-correct-answer">คำตอบที่ถูก<select data-quiz-field="correctOption"><option value="" ${correctOption ? '' : 'selected'}>เลือกคำตอบ</option>${choices.map((key, choiceIndex) => `<option value="${key}" ${choiceIndex >= q.optionCount ? 'hidden disabled' : ''} ${correctOption === key ? 'selected' : ''}>${key}</option>`).join('')}</select></label>
    </section>`;
  }).join('') : '';
  const shiftSessions = model.shiftSessions || [];
  const roster = shiftSessions.map(session => {
    const people = session.rosterConfigured
      ? (session.rosterMembers || []).map(person => ({
        ParticipantID: person.participantId, DisplayName: person.displayName,
        Score: person.score, TotalQuestions: person.total,
        ParticipantStatus: person.status === 'NotRegistered' ? 'NotRegistered' : person.status,
        hasStarted: Boolean(person.hasStarted)
      }))
      : participants.filter(person => String(person.Shift || '') === String(session.shift || ''));
    const peopleHtml = people.length ? `<ul class="quiz-roster-list">${people.map(person => {
      const submitted = person.ParticipantStatus === 'Submitted';
      const excused = person.ParticipantStatus === 'Excused';
      const notRegistered = person.ParticipantStatus === 'NotRegistered';
      const started = submitted || Boolean(person.hasStarted);
      const status = submitted ? `ส่งแล้ว · ${escapeHtml(String(person.Score ?? ''))}/${escapeHtml(String(person.TotalQuestions || 5))} คะแนน`
        : (excused ? 'ยกเว้น' : (notRegistered ? 'ยังไม่ลงชื่อ' : (started ? 'เริ่มแล้ว · ยังไม่ส่ง' : 'ลงชื่อแล้ว · ยังไม่เริ่ม')));
      return `<li class="quiz-roster-item"><span>${person.EmployeeID ? `${escapeHtml(person.EmployeeID)} · ` : ''}${escapeHtml(person.DisplayName)} · ${status}</span>${!submitted && !excused && !notRegistered ? `<button type="button" class="btn btn-ghost btn-compact" data-quiz-excuse="${escapeAttr(person.ParticipantID)}">ยกเว้นจากรอบ</button>` : ''}</li>`;
    }).join('')}</ul>` : '<div class="empty-state">ยังไม่มีผู้ลงชื่อสอบในกะนี้</div>';
    const rosterButton = session.rosterStatus === 'Stopped'
      ? '<span class="status-badge status-ok">หยุดสอบแล้ว</span>'
      : (session.rosterStatus === 'Locked'
        ? '<span class="status-badge status-ok">ปิดรับรายชื่อแล้ว</span>'
        : `<button type="button" class="btn btn-outline" data-quiz-lock="${escapeAttr(session.shift)}">ปิดรับรายชื่อ</button>`);
    const retakeButton = session.examStopped && model.canManage
      ? `<button type="button" class="btn btn-outline" data-quiz-retake="${escapeAttr(session.shift)}">↻ สอบใหม่ · รอบ ${Number(session.attemptNo || 1) + 1}</button>` : '';
    const stopButton = session.examStopped
      ? ''
      : `<button type="button" class="btn btn-primary" data-quiz-stop="${escapeAttr(session.shift)}" title="หยุดได้ทันที ผู้ที่ยังไม่ส่งจะไม่ถูกนำมาจัดอันดับ">หยุดสอบและประกาศอันดับ</button>`;
    const stats = `ลงชื่อ ${session.registeredCount || 0} คน · เริ่มแล้ว ${session.startedCount ?? session.participantCount ?? 0} · ส่ง ${session.submittedCount || 0} · ค้าง ${session.pendingCount || 0}`;
    const podiumHtml = rows => rows?.length
      ? `<ol>${rows.map(person => `<li><span>${person.rank === 1 ? '🥇' : (person.rank === 2 ? '🥈' : '🥉')} ${escapeHtml(person.displayName)}${person.durationLabel ? `<small>${escapeHtml(person.durationLabel)}</small>` : ''}</span><b>${person.score}/${person.total}</b></li>`).join('')}</ol>`
      : '<p>ยังไม่มีผู้ส่งข้อสอบเพื่อจัดอันดับ</p>';
    const previousPodium = session.previousAttemptNo
      ? `<div class="quiz-podium"><strong>🏆 ${escapeHtml(session.label || session.shift)} · อันดับรอบ ${Number(session.previousAttemptNo)}</strong>${podiumHtml(session.previousTopThree || [])}</div>` : '';
    const podium = session.examStopped
      ? `<div class="quiz-podium"><strong>🏆 ${escapeHtml(session.label || session.shift)} · อันดับรอบ ${Number(session.attemptNo || 1)}</strong>${podiumHtml(session.topThree || [])}</div>` : '';
    return `<section class="quiz-shift-roster"><div class="quiz-roster-summary"><strong>${escapeHtml(session.label || session.shift)} · รอบ ${Number(session.attemptNo || 1)}</strong><span>${stats}</span><div class="quiz-roster-controls">${rosterButton}${stopButton}${retakeButton}</div></div>${peopleHtml}${previousPodium}${podium}</section>`;
  }).join('');
  const sourceTopics = (model.post?.SourceTopics || []).map(topic => topic.Topic).filter(Boolean);
  const quizVersions = model.quizVersions || [];
  const versionPicker = quizVersions.length > 1 ? `<label class="quiz-version-picker">เลือกฉบับข้อสอบ<select data-quiz-version aria-label="เลือกฉบับข้อสอบ">${quizVersions.map(version => {
    const status = String(version.Status || '').toLowerCase() === 'published' ? 'เผยแพร่แล้ว' : 'ฉบับร่าง';
    const source = String(version.SourceType || '').toLowerCase() === 'manual' ? 'สร้างเอง' : 'AI';
    const created = String(version.CreatedAt || '').slice(0, 10);
    const label = `${status} v${version.VersionNo || 1} · ${source}${created ? ` · ${created}` : ''}`;
    return `<option value="${escapeAttr(version.QuizID)}" ${version.QuizID === quiz?.QuizID ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('')}</select></label>` : '';
  const generationFeedback = model.autoGenerating
    ? `<div class="quiz-status-note">กำลังวิเคราะห์รายละเอียดและสไลด์${isTraining ? 'ของ Training นี้' : 'ทุกหัวข้อวันนี้'} แล้วสร้างข้อสอบ 5 ข้อ…</div>`
    : (model.generationError ? `<div class="quiz-status-note">สร้างข้อสอบไม่สำเร็จ: ${escapeHtml(model.generationError)} · ตรวจการตั้งค่า AI/API แล้วกด Gen เพื่อลองอีกครั้ง</div>` : '');
  const draftSaveNotice = model.draftSaveNotice
    ? `<div class="quiz-draft-save-notice ${model.draftSaveError ? 'is-error' : (model.draftSavePending ? 'is-pending' : 'is-success')}" role="status" aria-live="polite">${model.draftSaveError ? '⚠️' : (model.draftSavePending ? '⏳' : '✓')} ${escapeHtml(model.draftSaveNotice)}</div>`
    : '<div class="quiz-draft-save-notice hidden" role="status" aria-live="polite"></div>';
  const aiSettings = model.canGenerate ? `<details class="quiz-api-settings" ${model.aiConfigured ? '' : 'open'}>
    <summary>⚙️ ตั้งค่า AI สำหรับสร้างข้อสอบ <span class="quiz-api-status ${model.aiConfigured ? 'is-configured' : 'is-missing'}">${model.aiConfigured ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้งค่า'}</span></summary>
    <div class="quiz-api-settings-body"><p class="field-help">คีย์จะถูกเก็บใน Apps Script Script Properties และไม่แสดงกลับบนหน้าเว็บ ใส่คีย์ใหม่เพื่อเปลี่ยนคีย์เดิม</p>
      <label for="meetingQuizApiKey">Gemini API key</label><div class="quiz-api-input-row"><input id="meetingQuizApiKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="วาง Gemini API key ที่นี่"><button type="button" class="btn btn-outline" data-quiz-save-api-key>บันทึกคีย์</button></div>
    </div>
  </details>` : '';
  $('#meetingQuizAdminContent').innerHTML = `
    <div class="quiz-admin-toolbar"><div><strong>${escapeHtml(model.post?.Topic || '')}</strong><div class="field-help">${escapeHtml(model.post?.MeetingDate || '')} · ${escapeHtml(statusText)}${sourceTopics.length ? `<br>หัวข้อที่ใช้: ${sourceTopics.map(escapeHtml).join(' · ')}` : ''}</div>${versionPicker}</div><div class="quiz-admin-actions">${quiz && !isDraft ? `<span class="field-help">เริ่มแล้ว ${summary.startedCount ?? summary.participantCount ?? 0} · ส่ง ${summary.submittedCount || 0}${model.lastRefreshedAt ? ` · อัปเดต ${new Date(model.lastRefreshedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}` : ''}</span><button type="button" class="btn btn-outline" data-quiz-refresh>รีเฟรชสถานะ</button>` : ''}${canGenerate && !model.autoGenerating ? `<button type="button" class="btn btn-secondary" data-quiz-generate>✨ Gen ข้อสอบ 5 ข้อ${isTraining ? 'จาก Training นี้' : 'จากทุกหัวข้อวันนี้'}</button>` : ''}${canRegenerate && !model.autoGenerating ? '<button type="button" class="btn btn-secondary" data-quiz-regenerate>🔄 Gen ใหม่ · ลบฉบับเดิม</button>' : ''}${canAttachTrainingImages ? '<button type="button" class="btn btn-outline" data-quiz-attach-training-images>🖼️ ใส่รูปสไลด์ให้ข้อสอบอัตโนมัติ</button>' : ''}${canStartManual ? '<button type="button" class="btn btn-outline" data-quiz-manual>✍️ สร้างข้อสอบเอง / เกม</button>' : ''}</div></div>
    ${aiSettings}
    ${generationFeedback}
    ${quiz && !isDraft ? `<div class="quiz-status-note">ใช้ QR และข้อสอบชุดเดียวกันทุกกะ · รายชื่อจะบันทึกเฉพาะข้อสอบรอบนี้ · ค้างนับเฉพาะผู้ที่เริ่มแล้วแต่ยังไม่ส่ง · หัวหน้าหยุดสอบและประกาศอันดับได้ทันที อันดับคิดจากผู้ที่ส่งแล้ว · สถานะอัปเดตอัตโนมัติทุก 3 วินาที</div><h4>ผลสอบและรายชื่อผู้เข้าสอบ แยกตามกะ</h4>${roster}` : ''}
    ${publicUrl ? `<section class="quiz-qr-panel"><div><h4>QR สำหรับพนักงานเข้าสอบ</h4><p class="field-help">สแกน QR แล้วกรอกรหัสพนักงาน ชื่อ นามสกุล เลือกกะและภาษา · ระบบบันทึกรายชื่อแยกตามข้อสอบรอบนี้ และไม่ให้รหัสเดิมลงชื่อซ้ำในรอบเดียวกัน</p><div class="quiz-qr-link">${escapeHtml(publicUrl)}</div><button type="button" class="btn btn-outline" data-quiz-copy-link="${escapeAttr(publicUrl)}">คัดลอกลิงก์ข้อสอบ</button></div>${qrSvg ? `<div class="quiz-qr-image" aria-label="QR Code สำหรับเข้าสอบ">${qrSvg}</div>` : '<div class="quiz-qr-image quiz-qr-error">ยังสร้าง QR ไม่ได้ กรุณาคัดลอกลิงก์</div>'}</section>` : ''}
    ${isDraft ? `<div class="quiz-status-note">${isManualDraft ? 'ข้อสอบสร้างเอง/เกม · บันทึกฉบับร่างได้ระหว่างกรอก · ก่อนเผยแพร่กรอกคำถาม ตัวเลือก เฉลย และคำอธิบายทั้งภาษาไทยกับพม่าให้ครบ 5 ข้อ · แนบรูปได้' : `สร้างข้อสอบ${isTraining ? 'ของ Training นี้' : 'ชุดเดียวของวันนี้'}แล้ว · บันทึกฉบับร่างระหว่างแก้ไขได้ · ก่อนเผยแพร่ตรวจให้ครบทั้ง 5 ข้อและสองภาษา${isTraining ? ' · ระบบจับคู่รูปจากสไลด์ให้แต่ละข้ออัตโนมัติ' : ''} · Gen ชุดใหม่ได้โดยลบฉบับร่างเดิม`}</div><div id="meetingQuizEditor" data-quiz-editor-language="TH"><div class="quiz-editor-language-switch" role="group" aria-label="เลือกภาษาที่ต้องการแก้ไข"><span>ภาษา</span><button type="button" class="is-active" data-quiz-editor-language="TH" aria-pressed="true">ไทย <small>หลัก</small></button><button type="button" data-quiz-editor-language="MY" aria-pressed="false">မြန်မာ</button></div>${questionEditor}</div><div class="modal-actions">${draftSaveNotice}<button type="button" class="btn btn-outline" data-quiz-save>บันทึกฉบับร่าง</button><button type="button" class="btn btn-primary" data-quiz-publish>เผยแพร่และเปิดรับสอบ</button></div>` : ''}
    ${quiz && !isDraft && !participants.length ? '<div class="quiz-status-note">ยังไม่มีผู้ลงชื่อสอบในรอบนี้</div>' : ''}
    ${quiz && !isDraft && summary.allSubmitted ? '<div class="quiz-status-note">หัวหน้าหยุดสอบครบทุกกะแล้ว ปุ่มเฉลยรวมเปิดให้ดูบนบอร์ด</div>' : ''}
    ${model.canManage && !model.canGenerate && (!quiz || isDraft) ? '<div class="quiz-status-note">บัญชีนี้สร้างข้อสอบเองได้ แต่ยังไม่มีสิทธิ์ Gen ข้อสอบด้วย AI</div>' : ''}
    ${!quiz && !hasSlides ? `<div class="quiz-status-note">${isTraining ? 'Training นี้ยังไม่มีรายละเอียดหรือสไลด์สำหรับให้ AI สร้างข้อสอบ แต่ยังสร้างข้อสอบเอง/เกมได้' : 'วันนี้ไม่มีสไลด์สำหรับให้ AI สร้างข้อสอบ แต่ยังสร้างข้อสอบเอง/เกมได้'}</div>` : ''}
    ${!quiz ? `<div class="quiz-status-note">${isTraining ? 'ข้อสอบชุดนี้อ้างอิงจาก Training รายการนี้เท่านั้น แยก QR และผลสอบจาก Meeting และ Training รายการอื่น' : 'Meeting หนึ่งวันใช้ข้อสอบชุดเดียว 5 ข้อ โดยรวมรายละเอียดและสไลด์จากทุกหัวข้อของวันนั้น แล้วตรวจแก้ก่อนเผยแพร่'}</div>` : ''}`;
}

function meetingQuizPublicUrl(publicToken) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('quiz', publicToken);
  return url.toString();
}

function readMeetingQuizAdminQuestions() {
  return $$('#meetingQuizEditor [data-quiz-q]').map(card => {
    const get = field => card.querySelector(`[data-quiz-field="${field}"]`)?.value.trim() || '';
    const optionCount = Math.max(2, Math.min(4, Number(card.querySelector('[data-quiz-option-count]')?.value) || 4));
    return {
      questionTH: get('questionTH'), choicesTH: ['A', 'B', 'C', 'D'].map((key, index) => index < optionCount ? get(`choice${key}TH`) : ''),
      questionMY: get('questionMY'), choicesMY: ['A', 'B', 'C', 'D'].map((key, index) => index < optionCount ? get(`choice${key}MY`) : ''),
      correctOption: get('correctOption'), explanationTH: get('explanationTH'), explanationMY: get('explanationMY'),
      questionImageURL: get('questionImageURL')
    };
  });
}

function meetingQuizEditorHasUnsavedChanges(model) {
  if (!model?.quiz || String(model.quiz.Status || '').toLowerCase() !== 'draft' || !$('#meetingQuizEditor')) return false;
  const comparable = question => {
    const q = meetingQuizUiQuestion(question);
    return {
      questionTH: q.questionTH, choicesTH: q.choicesTH.slice(0, 4),
      questionMY: q.questionMY, choicesMY: q.choicesMY.slice(0, 4),
      optionCount: q.optionCount, correctOption: q.correctOption,
      explanationTH: q.explanationTH, explanationMY: q.explanationMY,
      questionImageURL: q.questionImageURL
    };
  };
  return JSON.stringify(readMeetingQuizAdminQuestions().map(comparable)) !==
    JSON.stringify((model.questions || []).map(comparable));
}

function updateMeetingQuizDraftNotice(model = state.meetingQuizAdmin) {
  const notice = $('#meetingQuizAdminContent .quiz-draft-save-notice');
  if (!notice) return;
  notice.textContent = model?.draftSaveNotice
    ? `${model.draftSaveError ? '⚠️' : (model.draftSavePending ? '⏳' : '✓')} ${model.draftSaveNotice}`
    : '';
  notice.classList.toggle('hidden', !model?.draftSaveNotice);
  notice.classList.toggle('is-error', Boolean(model?.draftSaveError));
  notice.classList.toggle('is-pending', Boolean(model?.draftSavePending));
  notice.classList.toggle('is-success', Boolean(model?.draftSaveNotice && !model?.draftSaveError && !model?.draftSavePending));
}

function setMeetingQuizEditorSaving(isSaving) {
  $$('#meetingQuizEditor input, #meetingQuizEditor textarea, #meetingQuizEditor select').forEach(field => {
    field.disabled = isSaving;
  });
}

function handleMeetingQuizAdminInput(event) {
  if (!event.target.closest('#meetingQuizEditor [data-quiz-field], #meetingQuizEditor [data-quiz-image], #meetingQuizEditor [data-quiz-option-count]')) return;
  const model = state.meetingQuizAdmin;
  if (!model?.draftSaveNotice || model.draftSavePending) return;
  model.draftSaveNotice = '';
  model.draftSaveError = false;
  updateMeetingQuizDraftNotice(model);
}

async function handleMeetingQuizAdminChange(event) {
  const versionSelect = event.target.closest('[data-quiz-version]');
  if (versionSelect) {
    const model = state.meetingQuizAdmin;
    const quizId = versionSelect.value;
    if (!model || !quizId || quizId === model.quiz?.QuizID) return;
    try {
      showLoading('กำลังเปิดฉบับข้อสอบ...');
      if (meetingQuizEditorHasUnsavedChanges(model)) {
        await apiCall('saveMeetingQuizDraft', {
          postId: model.postId, quizId: model.quiz.QuizID, questions: readMeetingQuizAdminQuestions()
        });
      }
      await refreshMeetingQuizAdmin(quizId);
      if (state.meetingQuizAdmin === model && model.quiz?.QuizID !== quizId) {
        throw new Error('โหลดฉบับข้อสอบที่เลือกไม่สำเร็จ กรุณาลองอีกครั้ง');
      }
      showToast('เปิดฉบับข้อสอบที่เลือกแล้ว', 'success');
    } catch (error) {
      showToast(`เปลี่ยนฉบับข้อสอบไม่สำเร็จ: ${error.message}`, 'error');
      renderMeetingQuizAdmin();
    } finally { hideLoading(); }
    return;
  }
  const optionCountInput = event.target.closest('[data-quiz-option-count]');
  if (optionCountInput) {
    const card = optionCountInput.closest('[data-quiz-q]');
    const count = Math.max(2, Math.min(4, Number(optionCountInput.value) || 4));
    card.querySelectorAll('[data-option-index]').forEach(row => {
      row.hidden = Number(row.dataset.optionIndex) > count;
    });
    const correct = card.querySelector('[data-quiz-field="correctOption"]');
    const selected = correct.value;
    Array.from(correct.options).forEach(option => {
      if (!option.value) return;
      const isAvailable = option.value.charCodeAt(0) - 64 <= count;
      option.hidden = !isAvailable;
      option.disabled = !isAvailable;
    });
    if (selected && selected.charCodeAt(0) - 64 > count) {
      correct.value = '';
      showToast('จำนวนตัวเลือกเปลี่ยนแล้ว กรุณาเลือกเฉลยใหม่', 'warning');
    }
    const model = state.meetingQuizAdmin;
    if (model?.draftSaveNotice && !model.draftSavePending) {
      model.draftSaveNotice = '';
      model.draftSaveError = false;
      updateMeetingQuizDraftNotice(model);
    }
    return;
  }
  const input = event.target.closest('[data-quiz-image]');
  const model = state.meetingQuizAdmin;
  const file = input?.files?.[0];
  if (!input || !file || !model?.quiz?.QuizID) return;
  if (!String(file.type || '').startsWith('image/')) {
    showToast('กรุณาเลือกไฟล์รูปภาพ', 'error');
    input.value = '';
    return;
  }
  const card = input.closest('[data-quiz-q]');
  const questionNo = Number(input.dataset.quizImage) + 1;
  try {
    input.disabled = true;
    showLoading(`กำลังอัปโหลดรูปข้อ ${questionNo}...`);
    const compressed = await compressImage(file, 1200, 0.72);
    const base64Data = await fileToBase64(compressed);
    const result = await apiCall('uploadMeetingQuizQuestionImage', {
      postId: model.postId, quizId: model.quiz.QuizID, questionNo,
      fileName: file.name.replace(/\.[^.]+$/, '.jpg'), mimeType: 'image/jpeg', base64Data
    });
    const imageUrl = result?.DriveFileURL || '';
    if (!imageUrl) throw new Error('อัปโหลดสำเร็จแต่ไม่ได้รับลิงก์รูป');
    card.querySelector('[data-quiz-field="questionImageURL"]').value = imageUrl;
    card.querySelector('[data-quiz-image-preview]').innerHTML = `<img src="${escapeAttr(driveThumbnailUrl_(imageUrl, 360))}" alt="รูปประกอบข้อ ${questionNo}" loading="lazy"><button type="button" class="btn btn-ghost btn-compact" data-quiz-remove-image>นำรูปออก</button>`;
    showToast(`เพิ่มรูปประกอบข้อ ${questionNo} แล้ว`, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    input.disabled = false;
    input.value = '';
    hideLoading();
  }
}

async function handleMeetingQuizAdminClick(event) {
  const model = state.meetingQuizAdmin;
  if (!model) return;
  const languageTab = event.target.closest('button[data-quiz-editor-language]');
  if (languageTab) {
    const language = languageTab.dataset.quizEditorLanguage === 'MY' ? 'MY' : 'TH';
    const editor = $('#meetingQuizEditor');
    if (!editor) return;
    editor.dataset.quizEditorLanguage = language;
    $$('#meetingQuizEditor [data-quiz-language-panel]').forEach(panel => {
      panel.hidden = panel.dataset.quizLanguagePanel !== language;
    });
    $$('#meetingQuizEditor [data-quiz-editor-language]').forEach(button => {
      const active = button.dataset.quizEditorLanguage === language;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    return;
  }
  const button = event.target.closest('[data-quiz-copy-link],[data-quiz-generate],[data-quiz-regenerate],[data-quiz-manual],[data-quiz-attach-training-images],[data-quiz-remove-image],[data-quiz-translate-myanmar],[data-quiz-save-api-key],[data-quiz-save],[data-quiz-publish],[data-quiz-lock],[data-quiz-stop],[data-quiz-retake],[data-quiz-excuse],[data-quiz-refresh]');
  if (!button) return;
  const originalButtonText = button.textContent;
  let savingDraft = false;
  try {
    button.disabled = true;
    if (button.hasAttribute('data-quiz-copy-link')) {
      await navigator.clipboard.writeText(button.dataset.quizCopyLink);
      showToast('คัดลอกลิงก์ข้อสอบแล้ว', 'success');
    } else if (button.hasAttribute('data-quiz-manual')) {
      const hasDraftContent = (model.questions || []).some(question => Boolean(question.QuestionTH || question.QuestionMY));
      if (String(model.quiz?.Status || '').toLowerCase() === 'draft' && hasDraftContent) {
        const confirmed = await showConfirm({ title: 'เปลี่ยนเป็นข้อสอบสร้างเอง?', message: 'ระบบจะล้างข้อสอบฉบับร่างปัจจุบัน แล้วเปิดฟอร์มเปล่า 5 ข้อสำหรับสร้างข้อสอบเอง/เกม', confirmText: 'สร้างฟอร์มใหม่', tone: 'primary' });
        if (!confirmed) return;
      }
      const result = await apiCall('startManualMeetingQuiz', { postId: model.postId });
      model.quiz = result.quiz;
      model.questions = result.questions || [];
      model.participants = [];
      showToast('เปิดฟอร์มข้อสอบเอง 5 ข้อแล้ว', 'success');
      renderMeetingQuizAdmin();
    } else if (button.hasAttribute('data-quiz-attach-training-images')) {
      const result = await apiCall('attachTrainingQuizImages', { postId: model.postId, quizId: model.quiz.QuizID });
      model.questions = result.questions || [];
      renderMeetingQuizAdmin();
      showToast('เพิ่มรูปสไลด์ให้ข้อสอบ Training แล้ว · ตรวจดูแต่ละข้อก่อนบันทึก', 'success');
    } else if (button.hasAttribute('data-quiz-remove-image')) {
      const card = button.closest('[data-quiz-q]');
      card.querySelector('[data-quiz-field="questionImageURL"]').value = '';
      card.querySelector('[data-quiz-image-preview]').innerHTML = '<span class="field-help">เพิ่มรูปเพื่อใช้ประกอบคำถามหรือเกมได้</span>';
    } else if (button.hasAttribute('data-quiz-translate-myanmar')) {
      const card = button.closest('[data-quiz-q]');
      const get = field => card.querySelector(`[data-quiz-field="${field}"]`)?.value.trim() || '';
      const questionNo = Number(card.dataset.quizQ) + 1;
      const optionCount = Math.max(2, Math.min(4, Number(card.querySelector('[data-quiz-option-count]')?.value) || 4));
      button.textContent = 'กำลังแปล...';
      const translated = await apiCall('translateMeetingQuizQuestionToMyanmar', {
        postId: model.postId, quizId: model.quiz.QuizID, questionNo,
        questionTH: get('questionTH'), choicesTH: ['A', 'B', 'C', 'D'].slice(0, optionCount).map(key => get(`choice${key}TH`)),
        explanationTH: get('explanationTH')
      });
      card.querySelector('[data-quiz-field="questionMY"]').value = translated.questionMY;
      ['A', 'B', 'C', 'D'].forEach((key, index) => {
        card.querySelector(`[data-quiz-field="choice${key}MY"]`).value = translated.choicesMY[index] || '';
      });
      card.querySelector('[data-quiz-field="explanationMY"]').value = translated.explanationMY;
      showToast('แปลพม่าจากข้อความไทยข้อนี้แล้ว · ตรวจทานและกดบันทึกฉบับร่าง', 'success');
    } else if (button.hasAttribute('data-quiz-generate')) {
      await generateMeetingQuizDraft(model);
      showToast(String(model.post?.ContentType || '').toLowerCase() === 'training'
        ? 'สร้างข้อสอบฉบับร่างจาก Training นี้แล้ว ตรวจแก้ก่อนเผยแพร่'
        : 'สร้างข้อสอบฉบับร่างแล้ว ตรวจแก้ก่อนเผยแพร่', 'success');
    } else if (button.hasAttribute('data-quiz-regenerate')) {
      const generated = await generateMeetingQuizDraft(model, { createNewVersion: true });
      showToast(generated.replaceWarning || 'สร้างข้อสอบชุดใหม่พร้อมรูปแล้ว · ลบฉบับร่างเดิมเรียบร้อย', generated.replaceWarning ? 'warning' : 'success');
    } else if (button.hasAttribute('data-quiz-save-api-key')) {
      const input = $('#meetingQuizApiKey');
      const apiKey = input?.value.trim() || '';
      if (!apiKey) throw new Error('กรุณาวาง Gemini API key ก่อนบันทึก');
      const result = await apiCall('saveMeetingQuizApiKey', { apiKey });
      input.value = '';
      model.aiConfigured = Boolean(result?.configured);
      model.generationError = '';
      renderMeetingQuizAdmin();
      showToast('ตั้งค่า Gemini API key ถาวรแล้ว', 'success');
      const isTraining = String(model.post?.ContentType || '').toLowerCase() === 'training';
      if (!model.quiz && Number(model.post?.SlideCount || 0) > 0 && (isTraining || meetingQuizIsToday(model.post?.MeetingDate))) {
        try {
          await generateMeetingQuizDraft(model, { automatic: true });
          showToast(isTraining ? 'สร้างข้อสอบฉบับร่าง 5 ข้อจาก Training นี้แล้ว ตรวจแก้ก่อนเผยแพร่' : 'สร้างข้อสอบฉบับร่าง 5 ข้อแล้ว ตรวจแก้ก่อนเผยแพร่', 'success');
        } catch (error) {
          showToast(`บันทึกคีย์แล้ว แต่สร้างข้อสอบไม่สำเร็จ: ${error.message}`, 'warning');
        }
      }
    } else if (button.hasAttribute('data-quiz-refresh')) {
      await refreshMeetingQuizAdmin(model.quiz?.QuizID || '');
    } else if (button.hasAttribute('data-quiz-save')) {
      savingDraft = true;
      const questions = readMeetingQuizAdminQuestions();
      model.questions = questions;
      model.draftSavePending = true;
      model.draftSaveError = false;
      model.draftSaveNotice = 'กำลังบันทึกฉบับร่าง…';
      setMeetingQuizEditorSaving(true);
      updateMeetingQuizDraftNotice(model);
      await apiCall('saveMeetingQuizDraft', { postId: model.postId, quizId: model.quiz.QuizID, questions });
      model.draftSavePending = false;
      model.draftSaveNotice = `บันทึกฉบับร่างสำเร็จ · ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      updateMeetingQuizDraftNotice(model);
      await refreshMeetingQuizAdmin(model.quiz.QuizID);
      if (state.meetingQuizAdmin === model) {
        renderMeetingQuizAdmin();
        setMeetingQuizEditorSaving(false);
      }
      showToast('บันทึกฉบับร่างสำเร็จแล้ว', 'success', 7000);
    } else if (button.hasAttribute('data-quiz-publish')) {
      const confirmed = await showConfirm({ title: 'เผยแพร่ข้อสอบ?', message: 'ผู้เข้าสอบจะเริ่มลงชื่อและทำข้อสอบชุดนี้ได้', confirmText: 'เผยแพร่', tone: 'primary' });
      if (!confirmed) return;
      await apiCall('saveMeetingQuizDraft', { postId: model.postId, quizId: model.quiz.QuizID, questions: readMeetingQuizAdminQuestions() });
      try {
        // Quiz questions can include supplemental content beyond the slides.
        // Keep the original source hash for traceability, but don't block the
        // manager from publishing a reviewed draft when its source has changed.
        await apiCall('publishMeetingQuiz', { postId: model.postId, quizId: model.quiz.QuizID, allowStaleSource: true });
      } catch (publishError) {
        // Keep the editor in sync with the server when other validation
        // prevents publishing; the just-saved draft remains available.
        await refreshMeetingQuizAdmin(model.quiz.QuizID);
        throw publishError;
      }
      await refreshMeetingQuizAdmin(model.quiz.QuizID);
      await loadMeetingBoard();
      showToast('เผยแพร่แล้ว สแกน QR นี้ให้พนักงานเข้าสอบได้เลย', 'success');
    } else if (button.hasAttribute('data-quiz-lock')) {
      const confirmed = await showConfirm({ title: 'ปิดรับรายชื่อและเริ่มสอบ?', message: 'หลังจากนี้จะไม่มีผู้ลงชื่อใหม่ในกะนี้ · เฉลยรวมจะเปิดเมื่อหัวหน้าหยุดสอบครบทุกกะ', confirmText: 'ปิดรับรายชื่อ', tone: 'primary' });
      if (!confirmed) return;
      await apiCall('lockMeetingQuizRoster', { postId: model.postId, shift: button.dataset.quizLock });
      await refreshMeetingQuizAdmin();
      await loadMeetingBoard();
      showToast('ปิดรับรายชื่อแล้ว', 'success');
    } else if (button.hasAttribute('data-quiz-stop')) {
      const shiftLabel = model.shiftSessions?.find(session => String(session.shift) === String(button.dataset.quizStop))?.label || button.dataset.quizStop;
      const stoppingSession = model.shiftSessions?.find(session => String(session.shift) === String(button.dataset.quizStop));
      const nonSubmitCount = Math.max(0, Number(stoppingSession?.registeredCount || 0) - Number(stoppingSession?.submittedCount || 0));
      const confirmed = await showConfirm({ title: `หยุดสอบ${shiftLabel}?`, message: `ระบบจะปิดรับคำตอบและแสดง 3 อันดับจากผู้ที่ส่งแล้วทันที${nonSubmitCount ? ` ผู้ที่ยังไม่ส่ง ${nonSubmitCount} คนจะไม่ถูกนำมาจัดอันดับ` : ''}`, confirmText: 'หยุดสอบและประกาศอันดับ', tone: 'primary' });
      if (!confirmed) return;
      const stopped = await apiCall('stopMeetingQuizShift', { postId: model.postId, shift: button.dataset.quizStop });
      await showMeetingQuizWinners(shiftLabel, stopped.topThree || []);
      await refreshMeetingQuizAdmin();
      await loadMeetingBoard();
      showToast('หยุดสอบแล้ว · แสดง 3 อันดับแรกของกะนี้', 'success');
    } else if (button.hasAttribute('data-quiz-retake')) {
      const shift = button.dataset.quizRetake;
      const session = model.shiftSessions?.find(item => String(item.shift) === String(shift));
      const shiftLabel = session?.label || shift;
      const nextAttemptNo = Number(session?.attemptNo || 1) + 1;
      const confirmed = await showConfirm({
        title: `เปิดสอบ${shiftLabel}รอบใหม่?`,
        message: `เปิดให้ลงชื่อและทำข้อสอบ ${shiftLabel} รอบ ${nextAttemptNo} · คะแนนและอันดับรอบ ${session?.attemptNo || 1} จะเก็บไว้แยกเหมือนเดิม`,
        confirmText: 'เปิดสอบรอบใหม่', tone: 'primary'
      });
      if (!confirmed) return;
      await apiCall('startNewMeetingQuizShiftRound', { postId: model.postId, shift });
      await refreshMeetingQuizAdmin(model.quiz?.QuizID || '');
      await loadMeetingBoard();
      showToast(`เปิดสอบ${shiftLabel}รอบ ${nextAttemptNo} แล้ว`, 'success');
    } else if (button.hasAttribute('data-quiz-excuse')) {
      const reason = window.prompt('เหตุผลที่ยกเว้นผู้เข้าสอบรายนี้');
      if (!reason || !reason.trim()) return;
      await apiCall('excuseMeetingQuizParticipant', { postId: model.postId, participantId: button.dataset.quizExcuse, reason: reason.trim() });
      await refreshMeetingQuizAdmin(model.quiz?.QuizID || '');
      await loadMeetingBoard();
      showToast('อัปเดตรายชื่อผู้เข้าสอบแล้ว', 'success');
    }
  } catch (error) {
    if (savingDraft && state.meetingQuizAdmin === model) {
      model.draftSavePending = false;
      model.draftSaveError = true;
      model.draftSaveNotice = `บันทึกฉบับร่างไม่สำเร็จ: ${error.message || 'กรุณาลองอีกครั้ง'}`;
      setMeetingQuizEditorSaving(false);
      updateMeetingQuizDraftNotice(model);
    }
    showToast(error.message, 'error');
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = originalButtonText;
    }
    hideLoading();
  }
}

async function openMeetingQuizExam(postId) {
  const post = findMeetingPost(postId);
  const quizId = post?.MeetingQuiz?.quizId;
  if (!post || !quizId) return showToast('ยังไม่มีข้อสอบที่เผยแพร่สำหรับหัวข้อนี้', 'warning');
  const key = meetingQuizTokenStorageKey(quizId);
  const token = sessionStorage.getItem(key) || '';
  const topic = post.MeetingQuiz.sourceTitle || `Meeting ${String(post.MeetingDate || '').slice(0, 10)}`;
  state.meetingQuizExam = { postId, quizId, topic, language: '', answers: {}, participantToken: token, questions: [], participant: null, review: null, examStarted: false, mode: 'exam' };
  $('#meetingQuizExamTitle').textContent = `แบบทดสอบ · ${topic}`;
  $('#meetingQuizExamContent').innerHTML = '<div class="empty-state">กำลังโหลดข้อสอบ...</div>';
  $('#meetingQuizExamDialog').showModal();
  try {
    const data = await apiCall('getMeetingQuiz', { postId, participantToken: token });
    Object.assign(state.meetingQuizExam, data);
    if (!state.meetingQuizExam.language && data.participant?.language) state.meetingQuizExam.language = data.participant.language;
    state.meetingQuizExam.tokenKey = key;
    if (!data.participant && token) {
      sessionStorage.removeItem(key);
      state.meetingQuizExam.participantToken = '';
    }
    renderMeetingQuizExam();
  } catch (error) {
    $('#meetingQuizExamContent').innerHTML = emptyHtml(error.message);
    showToast(error.message, 'error');
  }
}

function showPublicQuiz() {
  $('#publicQuizView').classList.remove('hidden');
  $('#loginView').classList.add('hidden');
  $('#appView').classList.add('hidden');
}

async function openPublicMeetingQuiz(publicToken) {
  stopMeetingQuizResultPolling();
  const tokenKey = meetingQuizPublicTokenStorageKey(publicToken);
  const participantToken = sessionStorage.getItem(tokenKey) || '';
  state.meetingQuizExam = {
    postId: '', publicToken, publicMode: true, quizId: '', topic: 'Meeting', meetingDate: '',
    language: '', answers: {}, participantToken, questions: [], participant: null, review: null,
    mode: 'exam', tokenKey, examStarted: false
  };
  const model = state.meetingQuizExam;
  meetingQuizExamContentElement(model).innerHTML = '<div class="empty-state">กำลังโหลดข้อสอบ...</div>';
  try {
    const data = await apiCall('getMeetingQuiz', { publicToken, participantToken });
    Object.assign(model, data);
    if (!model.language && data.participant?.language) model.language = data.participant.language;
    if (!data.participant && participantToken) {
      sessionStorage.removeItem(tokenKey);
      model.participantToken = '';
    }
    renderMeetingQuizExam();
  } catch (error) {
    meetingQuizExamContentElement(model).innerHTML = emptyHtml(error.message);
    showToast(error.message, 'error');
  }
}

function meetingQuizLanguagePickerHtml(lang = 'TH', registration = false) {
  const currentLanguage = lang === 'MY' ? 'MY' : 'TH';
  const fieldName = registration ? 'language' : 'quiz-display-language';
  const changeHandler = registration ? '' : ' data-quiz-language';
  const thaiHint = currentLanguage === 'MY' ? 'အဓိကဘာသာစကား' : 'ภาษาหลัก';
  const myanmarHint = currentLanguage === 'MY' ? 'ကိုယ်တိုင်ရွေးချယ်ပါ' : 'เลือกได้ตามต้องการ';
  const legend = currentLanguage === 'MY' ? 'ဘာသာစကား ရွေးချယ်ရန်' : 'เลือกภาษาข้อสอบ';
  return `<fieldset class="quiz-language-picker ${registration ? '' : 'quiz-language-picker-compact'}"><legend>${legend}</legend><div class="quiz-language-options"><label class="quiz-language-option"><input type="radio" name="${fieldName}" value="TH"${changeHandler} ${currentLanguage === 'TH' ? 'checked' : ''} ${registration ? 'required' : ''}><span>ไทย</span><small>${thaiHint}</small></label><label class="quiz-language-option"><input type="radio" name="${fieldName}" value="MY"${changeHandler} ${currentLanguage === 'MY' ? 'checked' : ''} ${registration ? 'required' : ''}><span>မြန်မာ</span><small>${myanmarHint}</small></label></div>${registration ? `<p class="quiz-language-help">เลือกภาษาที่อ่านถนัด ระบบจะแสดงข้อสอบและเฉลยเป็นภาษานั้น</p>` : ''}</fieldset>`;
}

function stopMeetingQuizResultPolling() {
  if (state.meetingQuizResultPollTimer) clearInterval(state.meetingQuizResultPollTimer);
  state.meetingQuizResultPollTimer = null;
}

async function refreshMeetingQuizResultStatus() {
  const model = state.meetingQuizExam;
  if (!model?.publicMode || !model.review || !model.participantToken || model.mode === 'globalReview' || model.leaderboardUnlocked) {
    stopMeetingQuizResultPolling();
    return;
  }
  if (state.meetingQuizResultRefreshPromise) return state.meetingQuizResultRefreshPromise;
  const participantToken = model.participantToken;
  const request = (async () => {
    const data = await apiCall('getMeetingQuiz', {
      ...meetingQuizScope(model), participantToken, language: model.language
    }, { priority: 'low', quiet: true });
    if (state.meetingQuizExam !== model || model.participantToken !== participantToken || !model.review) return;
    const wasUnlocked = Boolean(model.leaderboardUnlocked);
    const wasAllSubmitted = Boolean(model.allSubmitted);
    model.allSubmitted = Boolean(data.allSubmitted);
    model.examStopped = Boolean(data.examStopped);
    model.participant = data.participant || model.participant;
    model.review = data.review || model.review;
    model.retakeAvailable = Boolean(data.retakeAvailable);
    model.attemptExpired = Boolean(data.attemptExpired);
    model.leaderboardUnlocked = Boolean(data.leaderboardUnlocked);
    model.leaderboard = data.leaderboard || [];
    if (wasUnlocked !== model.leaderboardUnlocked || wasAllSubmitted !== model.allSubmitted) {
      renderMeetingQuizExam();
      if (!wasUnlocked && model.leaderboardUnlocked) {
        $('#quizPersonalPodium')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        showToast('หัวหน้าหยุดสอบแล้ว · แสดงอันดับของกะนี้แล้ว', 'success');
      }
    }
    if (model.leaderboardUnlocked) stopMeetingQuizResultPolling();
  })();
  state.meetingQuizResultRefreshPromise = request;
  try { await request; }
  catch (error) { console.warn('Meeting quiz result status refresh failed:', error.message || error); }
  finally { if (state.meetingQuizResultRefreshPromise === request) state.meetingQuizResultRefreshPromise = null; }
}

function startMeetingQuizResultPolling() {
  const model = state.meetingQuizExam;
  if (!model?.publicMode || !model.review || !model.participantToken || model.mode === 'globalReview' || model.leaderboardUnlocked) {
    stopMeetingQuizResultPolling();
    return;
  }
  if (state.meetingQuizResultPollTimer) return;
  // Keep the submitted result open and reveal the shift podium as soon as the
  // manager stops that shift. This checks only the current candidate's quiz.
  state.meetingQuizResultPollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refreshMeetingQuizResultStatus();
  }, 5000);
  refreshMeetingQuizResultStatus();
}

function renderMeetingQuizExam() {
  const model = state.meetingQuizExam;
  if (!model) return;
  if (model.mode === 'globalReview') stopMeetingQuizResultPolling();
  const title = meetingQuizExamTitleElement(model);
  const content = meetingQuizExamContentElement(model);
  const lang = model.language === 'MY' ? 'MY' : 'TH';
  if (model.mode === 'globalReview') {
    title.textContent = lang === 'MY' ? 'အဖြေများနှင့် ရှင်းလင်းချက်' : 'เฉลยรวม';
    content.innerHTML = `${model.publicMode ? '' : meetingQuizLanguagePickerHtml(lang)}${meetingQuizAnswerKeyHtml(model.questions || [], lang)}${model.publicMode ? `<div class="modal-actions"><button type="button" class="btn btn-outline" data-quiz-back-result>${lang === 'MY' ? 'ရလဒ်သို့ ပြန်သွားရန်' : 'กลับไปผลสอบของฉัน'}</button></div>` : ''}`;
    return;
  }
  if (!model.participant) {
    title.textContent = `${lang === 'MY' ? 'အစည်းအဝေး စာမေးပွဲ' : 'แบบทดสอบ'} · ${model.topic || ''}`;
    const availableShifts = (model.shiftOptions || []).filter(shift => shift.rosterStatus === 'Open');
    const canCheckIn = availableShifts.length > 0;
    const noRoster = canCheckIn ? '' : '<div class="quiz-status-note">ทุกกะปิดรับหรือหยุดสอบแล้ว กรุณาติดต่อ Leader</div>';
    const registrationShiftOptions = (model.shiftOptions || [])
      .map(shift => `<option value="${escapeHtml(shift.value)}" ${shift.rosterStatus !== 'Open' ? 'disabled' : ''}>${escapeHtml(shift.label || shift.value)}${shift.rosterStatus === 'Stopped' ? ' · หยุดสอบแล้ว' : (shift.rosterStatus === 'Locked' ? ' · ปิดรับชื่อใหม่' : '')}</option>`).join('');
    const registrationForm = canCheckIn
      ? `<form id="meetingQuizRegistrationForm" class="form-stack"><p class="quiz-registration-intro">กรอกรหัสพนักงาน ชื่อ นามสกุล และกะ ระบบจะบันทึกไว้เฉพาะข้อสอบรอบนี้ ไม่ดึงรายชื่อเก่าจากทะเบียน และรหัสพนักงานลงชื่อซ้ำในรอบเดียวกันไม่ได้ · การลงชื่อยังไม่นับเป็นผู้เริ่มสอบ ระบบจะนับเมื่อกด “เริ่มทำข้อสอบ”</p><label>รหัสพนักงาน *<input type="text" name="employeeId" autocomplete="off" maxlength="50" required placeholder="พิมพ์รหัสพนักงาน"></label><label>ชื่อ *<input type="text" name="firstName" autocomplete="off" maxlength="100" required placeholder="พิมพ์ชื่อ"></label><label>นามสกุล *<input type="text" name="lastName" autocomplete="off" maxlength="100" required placeholder="พิมพ์นามสกุล"></label><label>กะปัจจุบัน *<select name="employeeShift" required><option value="">เลือกกะ</option>${registrationShiftOptions}</select></label>${meetingQuizLanguagePickerHtml(lang, true)}<div class="modal-actions"><button type="submit" class="btn btn-primary">เช็กชื่อเข้าสอบ</button></div></form>`
      : '';
    content.innerHTML = `<p class="page-helper">${escapeHtml(model.meetingDate || '')} · ${escapeHtml(model.topic || '')}</p>${noRoster}${registrationForm}`;
    return;
  }
  if (String(model.participant.status || '').toLowerCase() === 'excused') {
    content.innerHTML = '<div class="quiz-status-note">รายชื่อนี้ถูกยกเว้นจากรอบสอบแล้ว หากต้องการสอบ กรุณาติดต่อ Leader หรือผู้ดูแล</div>';
    return;
  }
  if (model.attemptExpired && !model.review) {
    title.textContent = lang === 'MY' ? 'ဤအဆိုင်း၏ အဟောင်းစာမေးပွဲ' : 'รอบสอบเดิมสิ้นสุดแล้ว';
    content.innerHTML = `<div class="quiz-status-note">${lang === 'MY' ? 'ခေါင်းဆောင်က စာမေးပွဲအသစ်ကို ဖွင့်ထားပါက ပြန်လည်စာရင်းသွင်းပြီး ဖြေဆိုနိုင်ပါသည်။' : 'รอบเดิมสิ้นสุดแล้ว คะแนนเดิมยังอยู่ในระบบ หากหัวหน้าเปิดรอบใหม่แล้วให้ลงชื่อเข้าสอบอีกครั้ง'}</div><div class="modal-actions">${model.retakeAvailable ? '<button type="button" class="btn btn-primary" data-quiz-retake>ลงทะเบียนสอบรอบใหม่</button>' : ''}<button type="button" class="btn btn-outline" data-quiz-check-key>ตรวจสอบสถานะรอบใหม่</button></div>`;
    return;
  }
  if (model.review) {
    if (model.publicMode) startMeetingQuizResultPolling();
    title.textContent = lang === 'MY' ? 'စာမေးပွဲရလဒ်နှင့် ပြန်လည်သုံးသပ်ချက်' : 'ผลสอบและเฉลยของฉัน';
    const rows = (model.review.questions || []).map(question => ({
      Question: question.Question, QuestionNo: question.QuestionNo, QuestionImageURL: question.QuestionImageURL, SelectedText: question.SelectedText,
      CorrectText: question.CorrectText, CorrectOption: question.CorrectOption,
      SelectedOption: question.SelectedOption, IsCorrect: question.IsCorrect, Explanation: question.Explanation
    }));
    const personalPodium = model.publicMode && model.leaderboardUnlocked
      ? `<div id="quizPersonalPodium">${meetingQuizPodiumHtml(model.leaderboard || [], model.shift, lang)}</div>`
      : (model.publicMode ? `<div class="quiz-status-note">${lang === 'MY' ? `သင့်အဆိုင်းရပ်ပြီးနောက် အဆင့် ၁–၃ ကို အလိုအလျောက်ပြပါမည် · စက္ကန့် ၅ တိုင်း အခြေအနေစစ်ဆေးနေသည်` : `ส่งข้อสอบแล้ว · รอหัวหน้าหยุดสอบกะ${escapeHtml((model.shiftOptions || []).find(shift => shift.value === model.shift)?.label || model.shift || 'นี้')} แล้วระบบจะแสดงอันดับ 1–3 อัตโนมัติ · ตรวจสถานะทุก 5 วินาที`}</div>` : '');
    const retakeAction = model.publicMode && model.retakeAvailable
      ? `<div class="quiz-status-note">หัวหน้าเปิดรอบสอบใหม่แล้ว · คะแนนและอันดับรอบเดิมยังเก็บไว้</div><div class="modal-actions"><button type="button" class="btn btn-outline" data-quiz-retake>ลงทะเบียนสอบรอบใหม่</button></div>` : '';
    const publicKeyActions = model.publicMode ? (model.retakeAvailable
      ? retakeAction
      : (model.allSubmitted
        ? `<div class="quiz-status-note">${lang === 'MY' ? 'အဆိုင်းအားလုံးကို ရပ်နားပြီးပါပြီ · အဖြေစုစုပေါင်းကို ဖွင့်ထားပါသည်' : 'หัวหน้าหยุดสอบครบทุกกะแล้ว · เปิดเฉลยรวมได้'}</div><div class="modal-actions"><button type="button" class="btn btn-primary" data-quiz-global-key>${lang === 'MY' ? 'အဖြေများကို ကြည့်ရန်' : 'ดูเฉลยรวม'}</button><button type="button" class="btn btn-outline" data-quiz-check-key>ตรวจสอบสถานะรอบใหม่</button><button type="button" class="btn btn-outline" data-quiz-finish>${lang === 'MY' ? 'ပိတ်ရန်' : 'ปิดผลสอบ'}</button></div>`
        : `<div class="quiz-status-note">${lang === 'MY' ? 'အဆိုင်းတစ်ခုချင်းစီ ရပ်ပြီးသည်နှင့် အဆင့်စာရင်းကို ပြပါမည်။ အဆိုင်းအားလုံးရပ်ပြီးနောက် အဖြေစုစုပေါင်းကို ဖွင့်ပါမည်။' : 'อันดับของแต่ละกะจะแสดงทันทีเมื่อหัวหน้าหยุดกะนั้น · เฉลยรวมเปิดเมื่อหยุดครบทุกกะ'}<div class="modal-actions"><button type="button" class="btn btn-outline" data-quiz-check-key>${lang === 'MY' ? 'အဖြေအခြေအနေကို စစ်ဆေးရန်' : 'อัปเดตสถานะเฉลย/อันดับ'}</button><button type="button" class="btn btn-primary" data-quiz-finish>${lang === 'MY' ? 'ပိတ်ရန်' : 'ปิดผลสอบ'}</button></div></div>`))
      : `<div class="modal-actions"><button type="button" class="btn btn-primary" data-quiz-finish>${lang === 'MY' ? 'ပြီးပါပြီ / နောက်လူအတွက် ပိတ်ရန်' : 'เสร็จแล้ว / ให้คนถัดไปทำ'}</button></div>`;
    const ownShift = (model.shiftOptions || []).find(shift => shift.value === model.shift)?.label || model.shift || '';
    const durationNote = model.durationMs ? `<div class="quiz-status-note">${lang === 'MY' ? 'ကြာချိန်' : 'เวลาที่ใช้'} · ${meetingQuizDurationText(model.durationMs, lang)}</div>` : '';
    const submittedNotice = lang === 'MY' ? '✅ စာမေးပွဲတင်သွင်းပြီးပါပြီ' : '✅ ส่งข้อสอบสำเร็จแล้ว';
    content.innerHTML = `<div class="quiz-submission-success" role="status" aria-live="polite">${submittedNotice}</div><div class="quiz-status-note">${escapeHtml(model.participant?.displayName || '')}${ownShift ? ` · ${lang === 'MY' ? 'အဆိုင်း' : 'กะ'} ${escapeHtml(ownShift)}` : ''}</div>${durationNote}<div class="quiz-score">${lang === 'MY' ? 'ရမှတ်' : 'คะแนน'} ${model.review.score}/${model.review.total}</div>${meetingQuizPersonalReviewHtml(rows, lang)}${personalPodium}${publicKeyActions}`;
    return;
  }
  const ownShift = (model.shiftOptions || []).find(shift => shift.value === model.shift)?.label || model.shift || '';
  if (!model.examStarted && !model.participant.hasStarted) {
    const intro = lang === 'MY'
      ? 'အမည်စာရင်းသွင်းပြီးပါပြီ။ အဆင်သင့်ဖြစ်သည့်အခါ စတင်ရန်နှိပ်ပါ။ နှိပ်ချိန်မှစ၍ အသုံးပြုသည့်အချိန်ကို မှတ်တမ်းတင်ပါမည်။ ရမှတ်တူပါက အချိန်ပိုတိုသူ အဆင့်မြင့်ပါမည်။'
      : 'เช็กชื่อเรียบร้อยแล้ว เมื่อพร้อมให้กดเริ่มทำข้อสอบ ระบบจะจับเวลาตั้งแต่ตอนกดปุ่ม และถ้าคะแนนเท่ากัน คนที่ใช้เวลาน้อยกว่าจะได้อันดับสูงกว่า';
    const buttonText = lang === 'MY' ? 'စတင်ဖြေဆိုရန်' : 'เริ่มทำข้อสอบ';
    content.innerHTML = `<div class="quiz-start-gate"><div class="quiz-status-note">${escapeHtml(model.participant.displayName || '')}${ownShift ? ` · ${lang === 'MY' ? 'အဆိုင်း' : 'กะ'} ${escapeHtml(ownShift)}` : ''} · ${lang === 'MY' ? 'အမည်စာရင်းသွင်းပြီးပါပြီ' : 'เช็กชื่อแล้ว'}</div><section class="quiz-start-card"><span class="quiz-start-icon" aria-hidden="true">▶</span><h3>${lang === 'MY' ? 'အဆင်သင့်ဖြစ်ပြီလား?' : 'พร้อมเริ่มหรือยัง?'}</h3><p>${intro}</p><button type="button" class="btn btn-primary btn-large" data-quiz-start>${buttonText}</button></section></div>`;
    return;
  }
  const choices = ['A', 'B', 'C', 'D'];
  const questions = model.questions || [];
  content.innerHTML = `<div class="quiz-status-note">${escapeHtml(model.participant.displayName || '')}${ownShift ? ` · ${lang === 'MY' ? 'အဆိုင်း' : 'กะ'} ${escapeHtml(ownShift)}` : ''} · ${lang === 'TH' ? 'ภาษาไทย · เริ่มจับเวลาแล้ว · ตอบให้ครบทุกข้อ แล้วส่งคำตอบ' : 'မြန်မာဘာသာ · အချိန်စတင်မှတ်တမ်းတင်နေပါပြီ · အားလုံးဖြေပြီး တင်သွင်းပါ'}</div><form id="meetingQuizAnswerForm">${questions.map(q => `<fieldset class="quiz-exam-question"><legend>${meetingQuizQuestionNumber(q.QuestionNo)}. ${escapeHtml(q['Question' + lang] || '')}</legend>${q.QuestionImageURL ? `<img class="quiz-question-exam-image" src="${escapeAttr(driveThumbnailUrl_(q.QuestionImageURL, 900))}" alt="รูปประกอบข้อ ${meetingQuizQuestionNumber(q.QuestionNo)}" loading="lazy">` : ''}${choices.filter(choice => String(q['Choice' + choice + lang] || '').trim()).map(choice => `<label class="quiz-exam-choice"><input type="radio" name="q${meetingQuizQuestionNumber(q.QuestionNo)}" value="${choice}" ${model.answers[meetingQuizQuestionNumber(q.QuestionNo)] === choice ? 'checked' : ''} required><span>${choice}. ${escapeHtml(q['Choice' + choice + lang] || '')}</span></label>`).join('')}</fieldset>`).join('')}<div class="modal-actions"><button type="submit" class="btn btn-primary">${lang === 'MY' ? 'စာမေးပွဲတင်သွင်းရန်' : 'ส่งข้อสอบ'}</button></div></form>`;
}

function meetingQuizQuestionNumber(value) { const number = Number(value); return Number.isFinite(number) ? number : 0; }

function meetingQuizDurationText(durationMs, lang = 'TH') {
  const totalSeconds = Math.max(0, Math.ceil(Number(durationMs || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return lang === 'MY'
    ? `${minutes ? `${minutes} မိနစ် ` : ''}${seconds} စက္ကန့်`
    : `${minutes ? `${minutes} นาที ` : ''}${seconds} วินาที`;
}

function meetingQuizPodiumHtml(rows, shift, lang = 'TH') {
  const list = Array.isArray(rows) ? rows : [];
  const heading = lang === 'MY' ? `🏆 ${shift || 'ဤအဆိုင်း'} ၏ ထိပ်ဆုံး ၃ ဦး` : `🏆 ${shift || 'กะนี้'} · 3 อันดับแรก`;
  if (!list.length) return `<section class="quiz-podium"><strong>${escapeHtml(heading)}</strong><p class="field-help">${lang === 'MY' ? 'အဆင့်သတ်မှတ်ရန် စာမေးပွဲတင်သွင်းသူ မရှိပါ' : 'ยังไม่มีผู้ส่งข้อสอบเพื่อจัดอันดับ'}</p></section>`;
  return `<section class="quiz-podium"><strong>${escapeHtml(heading)}</strong><ol>${list.map(person => {
    const durationLabel = person.durationMs !== null && person.durationMs !== undefined
      ? meetingQuizDurationText(person.durationMs, lang) : person.durationLabel;
    return `<li><span>${person.rank === 1 ? '🥇' : (person.rank === 2 ? '🥈' : '🥉')} ${escapeHtml(person.displayName || '')}${durationLabel ? `<small>${escapeHtml(durationLabel)}</small>` : ''}</span><b>${Number(person.score || 0)}/${Number(person.total || 5)}</b></li>`;
  }).join('')}</ol></section>`;
}

async function showMeetingQuizWinners(shiftLabel, rows) {
  const podium = (Array.isArray(rows) ? rows : []).slice(0, 3);
  const messageHtml = podium.length
    ? `<ol class="confirm-podium-list">${podium.map(person => `<li><span><b>${person.rank === 1 ? '🥇' : (person.rank === 2 ? '🥈' : '🥉')} อันดับ ${Number(person.rank) || 0}</b>${escapeHtml(person.displayName || '')}${person.durationLabel ? `<small>${escapeHtml(person.durationLabel)}</small>` : ''}</span><strong>${Number(person.score || 0)}/${Number(person.total || 5)} คะแนน</strong></li>`).join('')}</ol>`
    : '<div class="confirm-podium-empty">ยังไม่มีผู้ส่งข้อสอบเพื่อจัดอันดับ</div>';
  await showConfirm({
    title: `🏆 ผลสอบกะ${shiftLabel}`,
    icon: '🏆', tone: 'success', messageHtml, confirmOnly: true, confirmText: 'ปิด'
  });
}

function meetingQuizPersonalReviewHtml(rows, lang) {
  const labels = lang === 'MY'
    ? { correct: '✓ မှန်ကန်သည်', wrong: '✗ မှားယွင်းသည်', rightAnswer: 'အဖြေမှန်' }
    : { correct: '✓ ตอบถูก', wrong: '✗ ตอบผิด', rightAnswer: 'คำตอบที่ถูก' };
  return rows.map(row => `<section class="quiz-review-question"><h4>${row.QuestionNo}. ${escapeHtml(row.Question || '')}</h4>${row.QuestionImageURL ? `<img class="quiz-question-review-image" src="${escapeAttr(driveThumbnailUrl_(row.QuestionImageURL, 720))}" alt="รูปประกอบข้อ ${row.QuestionNo}" loading="lazy">` : ''}<div class="quiz-answer-line ${row.IsCorrect ? 'is-correct' : 'is-wrong'}">${row.IsCorrect ? labels.correct : labels.wrong} · ${escapeHtml(row.SelectedOption || '-')} ${escapeHtml(row.SelectedText || '')}</div>${!row.IsCorrect ? `<div class="quiz-answer-line is-correct">${labels.rightAnswer}: ${escapeHtml(row.CorrectOption)} ${escapeHtml(row.CorrectText || '')}</div>` : ''}<div class="quiz-explanation">${escapeHtml(row.Explanation || '')}</div></section>`).join('');
}

function meetingQuizAnswerKeyHtml(questions, lang) {
  const labels = lang === 'MY'
    ? { open: 'အဖြေများကို ဖွင့်ထားပါပြီ · အတူတကွ ပြန်လည်လေ့လာနိုင်ပါသည်', correct: 'အဖြေမှန်' }
    : { open: 'เฉลยรวมเปิดแล้ว · ใช้ทบทวนร่วมกัน', correct: 'คำตอบที่ถูก' };
  return `<div class="quiz-status-note">${labels.open}</div>${questions.map(q => {
    const question = q['Question' + lang] || '';
    const correct = q.CorrectOption || '';
    const choice = q['Choice' + correct + lang] || '';
    const explanation = q['Explanation' + lang] || '';
    return `<section class="quiz-review-question"><h4>${meetingQuizQuestionNumber(q.QuestionNo)}. ${escapeHtml(question)}</h4>${q.QuestionImageURL ? `<img class="quiz-question-review-image" src="${escapeAttr(driveThumbnailUrl_(q.QuestionImageURL, 720))}" alt="รูปประกอบข้อ ${meetingQuizQuestionNumber(q.QuestionNo)}" loading="lazy">` : ''}<div class="quiz-answer-line is-correct">${labels.correct}: ${escapeHtml(correct)} ${escapeHtml(choice)}</div><div class="quiz-explanation">${escapeHtml(explanation)}</div></section>`;
  }).join('')}`;
}

async function handleMeetingQuizExamSubmit(event) {
  const model = state.meetingQuizExam;
  if (!model) return;
  if (event.target.id === 'meetingQuizRegistrationForm') {
    event.preventDefault();
    const form = event.target;
    const submitButton = form.querySelector('[type="submit"]');
    if (submitButton?.disabled) return;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'กำลังเช็กชื่อ...';
    }
    const language = form.elements.language.value;
    try {
      const data = await apiCall('registerMeetingQuizParticipant', {
        ...meetingQuizScope(model), employeeId: form.elements.employeeId.value.trim(),
        firstName: form.elements.firstName.value.trim(),
        lastName: form.elements.lastName.value.trim(), shift: form.elements.employeeShift.value,
        language, participantToken: model.participantToken
      });
      model.participantId = data.participantId;
      model.participantToken = data.participantToken;
      model.tokenKey = model.publicMode ? meetingQuizPublicTokenStorageKey(model.publicToken) : meetingQuizTokenStorageKey(model.quizId);
      sessionStorage.setItem(model.tokenKey, data.participantToken);
      model.participant = { participantId: data.participantId, employeeId: data.employeeId, displayName: data.displayName, language, status: data.status || 'Registered', shift: data.shift };
      model.participant.hasStarted = Boolean(data.hasStarted);
      model.language = language;
      model.shift = data.shift;
      model.questions = data.questions || [];
      model.review = data.review || null;
      model.examStarted = Boolean(data.hasStarted);
      model.startedAtMs = Number(data.startedAtMs || 0);
      model.durationMs = Number(data.durationMs || 0);
      model.allSubmitted = Boolean(data.allSubmitted);
      model.leaderboardUnlocked = Boolean(data.leaderboardUnlocked);
      model.leaderboard = data.leaderboard || [];
      renderMeetingQuizExam();
      showToast('เช็กชื่อแล้ว · บันทึกข้อมูลไว้ในฐานข้อมูลของข้อสอบรอบนี้', 'success');
      if (!model.publicMode) loadMeetingBoard().catch(() => {});
    } catch (error) {
      showToast(error.message, 'error');
      if (submitButton?.isConnected) {
        submitButton.disabled = false;
        submitButton.textContent = 'เช็กชื่อเข้าสอบ';
      }
    }
  } else if (event.target.id === 'meetingQuizAnswerForm') {
    event.preventDefault();
    const answers = model.answers || {};
    const missing = (model.questions || []).find(q => !answers[meetingQuizQuestionNumber(q.QuestionNo)]);
    if (missing) return showToast('กรุณาตอบให้ครบทั้ง 5 ข้อ', 'warning');
    const submitted = Object.keys(answers).map(questionNo => ({ questionNo: Number(questionNo), choice: answers[questionNo] }));
    try {
      showLoading('กำลังส่งข้อสอบ...');
      const data = await apiCall('submitMeetingQuiz', { ...meetingQuizScope(model), quizId: model.quizId, participantToken: model.participantToken, language: model.participant?.language || model.language, answers: submitted });
      model.review = data.review;
      model.allSubmitted = Boolean(data.allSubmitted);
      model.durationMs = Number(data.durationMs || 0);
      model.participant.status = 'Submitted';
      renderMeetingQuizExam();
      if (!model.publicMode) await loadMeetingBoard();
    } catch (error) { showToast(error.message, 'error'); }
    finally { hideLoading(); }
  }
}

async function handleMeetingQuizExamChange(event) {
  const model = state.meetingQuizExam;
  if (!model) return;
  if (event.target.matches('[data-quiz-language]')) {
    model.language = event.target.value;
    if (model.review && model.mode !== 'globalReview') {
      try {
        const data = await apiCall('getMeetingQuiz', { ...meetingQuizScope(model), participantToken: model.participantToken, language: model.language });
        model.review = data.review || model.review;
        model.allSubmitted = Boolean(data.allSubmitted);
        model.leaderboardUnlocked = Boolean(data.leaderboardUnlocked);
        model.leaderboard = data.leaderboard || [];
      } catch (error) { showToast(error.message, 'error'); }
    }
    renderMeetingQuizExam();
  } else if (event.target.matches('input[type="radio"][name^="q"]')) {
    const questionNo = Number(event.target.name.slice(1));
    model.answers[questionNo] = event.target.value;
  }
}

async function openMeetingQuizAnswerKey(postId) {
  const post = findMeetingPost(postId);
  if (!post?.MeetingQuiz?.quizId) return;
  const topic = post.MeetingQuiz.sourceTitle || `Meeting ${String(post.MeetingDate || '').slice(0, 10)}`;
  state.meetingQuizExam = { postId, quizId: post.MeetingQuiz.quizId, topic, language: 'TH', questions: [], mode: 'globalReview' };
  $('#meetingQuizExamTitle').textContent = `เฉลยรวม · ${topic}`;
  $('#meetingQuizExamContent').innerHTML = '<div class="empty-state">กำลังโหลดเฉลย...</div>';
  $('#meetingQuizExamDialog').showModal();
  try {
    const data = await apiCall('getMeetingQuizAnswerKey', { postId });
    state.meetingQuizExam.questions = data.questions || [];
    renderMeetingQuizExam();
  } catch (error) {
    $('#meetingQuizExamContent').innerHTML = emptyHtml(error.message);
    showToast(error.message, 'error');
  }
}

async function handleMeetingQuizExamClick(event) {
  const model = state.meetingQuizExam;
  if (!model) return;
  const retake = event.target.closest('[data-quiz-retake]');
  if (retake) {
    if (!model.publicMode || !model.retakeAvailable || retake.disabled) return;
    retake.disabled = true;
    try {
      stopMeetingQuizResultPolling();
      if (model.tokenKey) sessionStorage.removeItem(model.tokenKey);
      model.participantToken = '';
      model.participant = null;
      model.participantId = '';
      model.review = null;
      model.answers = {};
      model.examStarted = false;
      model.startedAtMs = 0;
      model.durationMs = 0;
      model.leaderboard = [];
      model.leaderboardUnlocked = false;
      model.retakeAvailable = false;
      model.attemptExpired = false;
      const data = await apiCall('getMeetingQuiz', { ...meetingQuizScope(model), participantToken: '' });
      Object.assign(model, data);
      model.participantToken = '';
      model.participant = null;
      model.answers = {};
      model.examStarted = false;
      model.mode = 'exam';
      renderMeetingQuizExam();
    } catch (error) {
      retake.disabled = false;
      showToast(error.message, 'error');
    }
    return;
  }
  const start = event.target.closest('[data-quiz-start]');
  if (start) {
    if (start.disabled) return;
    start.disabled = true;
    start.textContent = model.language === 'MY' ? 'စတင်နေသည်...' : 'กำลังเริ่ม...';
    try {
      const data = await apiCall('startMeetingQuizAttempt', {
        ...meetingQuizScope(model), quizId: model.quizId, participantToken: model.participantToken
      });
      if (data.alreadySubmitted) {
        const refreshed = await apiCall('getMeetingQuiz', { ...meetingQuizScope(model), participantToken: model.participantToken, language: model.language });
        Object.assign(model, refreshed);
      } else {
        model.examStarted = true;
        model.startedAtMs = Number(data.startedAtMs || model.startedAtMs || 0);
        if (Array.isArray(data.questions) && data.questions.length) model.questions = data.questions;
        if (model.participant) model.participant.hasStarted = true;
      }
      renderMeetingQuizExam();
    } catch (error) {
      showToast(error.message, 'error');
      if (start.isConnected) {
        start.disabled = false;
        start.textContent = model.language === 'MY' ? 'စတင်ဖြေဆိုရန်' : 'เริ่มทำข้อสอบ';
      }
    }
    return;
  }
  const checkKey = event.target.closest('[data-quiz-check-key]');
  const openKey = event.target.closest('[data-quiz-global-key]');
  const backToResult = event.target.closest('[data-quiz-back-result]');
  const finish = event.target.closest('[data-quiz-finish]');
  if (checkKey) {
    try {
      const data = await apiCall('getMeetingQuiz', { ...meetingQuizScope(model), participantToken: model.participantToken, language: model.language });
      model.allSubmitted = Boolean(data.allSubmitted);
      model.participant = data.participant || model.participant;
      model.review = data.review || model.review;
      model.examStopped = Boolean(data.examStopped);
      model.retakeAvailable = Boolean(data.retakeAvailable);
      model.attemptExpired = Boolean(data.attemptExpired);
      model.shiftOptions = data.shiftOptions || model.shiftOptions;
      model.examStarted = Boolean(data.examStarted);
      model.startedAtMs = Number(data.startedAtMs || 0);
      model.leaderboardUnlocked = Boolean(data.leaderboardUnlocked);
      model.leaderboard = data.leaderboard || [];
      renderMeetingQuizExam();
      showToast(model.leaderboardUnlocked ? 'อัปเดตอันดับกะของคุณแล้ว' : (model.allSubmitted ? 'เฉลยรวมเปิดแล้ว' : 'อัปเดตสถานะแล้ว · อันดับจะขึ้นหลังหยุดสอบกะนี้'), model.leaderboardUnlocked || model.allSubmitted ? 'success' : 'info');
    } catch (error) { showToast(error.message, 'error'); }
    return;
  }
  if (openKey) {
    try {
      const data = await apiCall('getMeetingQuizAnswerKey', meetingQuizScope(model));
      model.questions = data.questions || [];
      model.mode = 'globalReview';
      renderMeetingQuizExam();
    } catch (error) { showToast(error.message, 'error'); }
    return;
  }
  if (backToResult) {
    model.mode = 'exam';
    renderMeetingQuizExam();
    return;
  }
  if (!finish) return;
  stopMeetingQuizResultPolling();
  if (model.tokenKey) sessionStorage.removeItem(model.tokenKey);
  if (model.publicMode) {
    model.participantToken = '';
    model.participant = null;
    model.review = null;
    model.answers = {};
    model.mode = 'exam';
    renderMeetingQuizExam();
    return;
  }
  $('#meetingQuizExamDialog').close();
  state.meetingQuizExam = null;
}

$('#meetingQuizExamContent').addEventListener('click', handleMeetingQuizExamClick);

// Board card detail: --- separators become slide dividers and [รูปN] markers
// are stripped (shown instead as a "📷 รูปที่ N" tag) so the card mirrors how
// the topic will page in TV mode.
function meetingDetailHtml(detail, photos = [], videoUrl = '', videoName = '') {
  const sections = meetingSlideSections(detail);
  const hasVideoMarker = sections.some(meetingHasVideoRef);
  const render = (s, i, multi) => {
    const parts = meetingMediaContentParts(s, photos, videoUrl, videoName);
    if (videoUrl && !hasVideoMarker && i === sections.length - 1) parts.push({ type: 'video', url: videoUrl, fileName: videoName });
    const text = parts.map(part => part.type === 'photo'
      ? `<a href="${escapeAttr(part.url)}" data-photo-url="${escapeAttr(part.url)}" class="mtg-detail-inline-photo photo-link-trigger" rel="noopener"><img src="${escapeAttr(driveThumbnailUrl_(part.url, 480))}" alt="รูปที่ ${part.number}" loading="lazy"><span>รูปที่ ${part.number}</span></a>`
      : part.type === 'video' ? meetingVideoPlayerHtml(part.url, part.fileName) : escapeHtml(part.text)).join('');
    const tag = multi ? `<span class="mtg-detail-slide-tag">สไลด์ ${i + 1}</span>` : '';
    if (!text && !tag) return '';
    return multi ? `<div class="mtg-detail-slide">${tag}<div class="mtg-detail-slide-content">${text}</div></div>` : `<div class="mtg-detail-slide-content">${text}</div>`;
  };
  if (sections.length === 1) {
    const inner = render(sections[0], 0, false);
    return inner ? `<div class="mtg-detail">${inner}</div>` : '';
  }
  return `<div class="mtg-detail">${sections.map((s, i) => render(s, i, true)).join('')}</div>`;
}

function meetingPhotoGallery(urlCsv, photoNumbers = []) {
  const items = (Array.isArray(urlCsv) ? urlCsv : String(urlCsv || '').split(',').map(u => u.trim()).filter(Boolean)).map((u, i) => {
    const number = photoNumbers[i] || i + 1;
    return `<a href="${escapeAttr(u)}" data-photo-url="${escapeAttr(u)}" class="finding-photo-thumb photo-link-trigger" rel="noopener"><img src="${escapeAttr(driveThumbnailUrl_(u, 300))}" alt="รูปที่ ${number}" loading="lazy"><span>รูปที่ ${number}</span></a>`;
  });
  return items.length ? `<div class="finding-photos">${items.join('')}</div>` : '';
}

function meetingUnassignedPhotoGallery(row) {
  const photos = meetingPhotoList(row);
  if (!photos.length) return '';
  const referenced = new Set(meetingSlideSections(row.Detail).flatMap(section => meetingExtractPhotoRefs(section))
    .filter(index => index >= 0 && index < photos.length));
  const urls = photos.filter((_, index) => !referenced.has(index));
  const numbers = photos.map((_, index) => index + 1).filter((_, index) => !referenced.has(index));
  return meetingPhotoGallery(urls, numbers);
}

function findMeetingPost(postId) {
  return state.meetingPosts.find(p => p.PostID === postId) ||
    state.meetingCarryOver.find(p => p.PostID === postId) ||
    state.trainingRecords.find(p => p.PostID === postId) || null;
}

function openMeetingEditor(postId = '', defaultContentType = 'Meeting') {
  const row = postId ? findMeetingPost(postId) : null;
  state.editingMeetingPost = row;
  $('#meetingPostType').value = row ? (String(row.ContentType || '').toLowerCase() === 'training' ? 'Training' : 'Meeting') : defaultContentType;
  $('#meetingDialogTitle').textContent = row ? `แก้ไขหัวข้อ ${row.PostID}` : 'เพิ่มหัวข้อประชุม';
  $('#meetingPostId').value = row ? row.PostID : '';
  $('#meetingPostDate').value = row ? String(row.MeetingDate || '').slice(0, 10) : ($('#meetingDate').value || localDateInput(new Date()));
  $('#meetingPostShift').value = row ? (row.Shift || '') : '';
  const lineValue = row && row.LineID && String(row.LineID).toUpperCase() !== 'ALL' ? row.LineID : '';
  $('#meetingPostLine').value = lineValue;
  $('#meetingPostCategory').value = row ? (row.Category || 'ทั่วไป') : 'ทั่วไป';
  $('#meetingPostPriority').value = row ? (row.Priority || 'ปกติ') : 'ปกติ';
  $('#meetingPostPinnedField').classList.toggle('hidden', !state.meetingCanManage);
  $('#meetingPostPinned').checked = row ? isMeetingPinned(row) : false;
  $('#meetingPostTopic').value = row ? (row.Topic || '') : '';
  $('#meetingPostDetail').value = row ? (row.Detail || '') : '';
  $('#meetingTrainingTime').value = row ? (row.TrainingTime || '') : '';
  $('#meetingTrainingPlace').value = row ? (row.TrainingPlace || '') : '';
  $('#meetingTrainingUnit').value = row ? (row.TrainingUnit || '') : '';
  $('#meetingTrainerName').value = row ? (row.TrainerName || '') : (state.user?.FullName || state.user?.Username || '');
  $('#meetingTrainingPlanned').value = row ? (row.TrainingPlanned || 'Yes') : 'Yes';
  $('#meetingTrainingEffect').value = row ? (row.TrainingEffect || '') : '';
  populateMeetingAckUsers(row ? String(row.AckRequiredUserIDs || '').split(',').map(s => s.trim()).filter(Boolean) : []);
  $('#meetingPostPhoto').value = '';
  clearMeetingPhotoItems();
  state.meetingPhotoItems = row ? meetingPhotoList(row).map(url => ({ id: ++meetingPhotoSeq, type: 'url', url })) : [];
  renderMeetingPhotoManager();
  $('#meetingPostSlideFile').value = '';
  $('#meetingPostVideo').value = '';
  $('#meetingPostVideoUrl').value = row ? (row.VideoURL || '') : '';
  renderMeetingVideoCurrent(row);
  renderMeetingSlideFileCurrent(row);
  $('#deleteMeetingPostButton').classList.toggle('hidden', !row);
  syncMeetingEditorType();
  $('#meetingDialog').showModal();
}

function syncMeetingEditorType() {
  const isTraining = $('#meetingPostType').value === 'Training';
  $('#trainingFields').classList.toggle('hidden', !isTraining);
  $('#printTrainingDraftButton').classList.toggle('hidden', !isTraining);
  $('#meetingAckField').classList.toggle('hidden', isTraining);
  $('#meetingPostPinnedField').classList.toggle('hidden', isTraining || !state.meetingCanManage);
  $('#meetingDialogEyebrow').textContent = isTraining ? 'TRAINING SLIDES · RECORD' : 'MORNING MEETING';
  if (!state.editingMeetingPost) $('#meetingDialogTitle').textContent = isTraining ? 'เพิ่มหัวข้อ Training' : 'เพิ่มหัวข้อประชุม';
}

// ===== Photo manager (reorder / remove / number) in the meeting form =====
let meetingPhotoSeq = 0;

function clearMeetingPhotoItems() {
  (state.meetingPhotoItems || []).forEach(it => { if (it.objectUrl) URL.revokeObjectURL(it.objectUrl); });
  state.meetingPhotoItems = [];
}

function addMeetingPhotoFiles(event) {
  Array.from(event.target.files || []).forEach(file => {
    state.meetingPhotoItems.push({ id: ++meetingPhotoSeq, type: 'file', file, objectUrl: URL.createObjectURL(file) });
  });
  event.target.value = '';
  renderMeetingPhotoManager();
}

function renderMeetingPhotoManager() {
  const wrap = $('#meetingPhotoManager');
  if (!wrap) return;
  const items = state.meetingPhotoItems || [];
  if (!items.length) { wrap.innerHTML = '<div class="mtg-photo-empty">ยังไม่มีรูป — เลือกไฟล์ด้านบนเพื่อเพิ่ม</div>'; return; }
  wrap.innerHTML = items.map((it, i) => {
    const src = it.type === 'url' ? driveThumbnailUrl_(it.url, 200) : it.objectUrl;
    return `<div class="mtg-photo-item" data-idx="${i}">
      <div class="mtg-photo-num">รูปที่ ${i + 1}${it.type === 'file' ? ' <span class="mtg-photo-new">ใหม่</span>' : ''}</div>
      <img src="${escapeAttr(src)}" alt="รูปที่ ${i + 1}">
      <div class="mtg-photo-btns">
        <button type="button" data-pmove="-1" ${i === 0 ? 'disabled' : ''} aria-label="เลื่อนซ้าย">◀</button>
        <button type="button" data-pdel aria-label="ลบรูป">🗑</button>
        <button type="button" data-pmove="1" ${i === items.length - 1 ? 'disabled' : ''} aria-label="เลื่อนขวา">▶</button>
      </div>
    </div>`;
  }).join('');
  $$('[data-pmove]', wrap).forEach(b => b.addEventListener('click', () => moveMeetingPhoto(Number(b.closest('[data-idx]').dataset.idx), Number(b.dataset.pmove))));
  $$('[data-pdel]', wrap).forEach(b => b.addEventListener('click', () => removeMeetingPhoto(Number(b.closest('[data-idx]').dataset.idx))));
}

function moveMeetingPhoto(idx, dir) {
  const items = state.meetingPhotoItems;
  const j = idx + dir;
  if (j < 0 || j >= items.length) return;
  // Markers point to ordered slots: moving a photo should change the image
  // shown at [รูปN], while leaving the marker at that slide position.
  [items[idx], items[j]] = [items[j], items[idx]];
  renderMeetingPhotoManager();
}

function remapMeetingPhotoReferences(previousItems, nextItems) {
  const oldPhotoIdByNumber = new Map(previousItems.map((item, index) => [index + 1, item.id]));
  const newNumberByPhotoId = new Map(nextItems.map((item, index) => [item.id, index + 1]));
  const detail = $('#meetingPostDetail');
  if (!detail) return;
  detail.value = detail.value.replace(/\[\s*(?:รูปที่|รูป|ภาพ|pic|img|image)\s*(\d+)\s*\]/gi, (marker, rawNumber) => {
    const photoId = oldPhotoIdByNumber.get(Number(rawNumber));
    // Keep invalid/out-of-range markers visible for correction. If the
    // referenced photo was deleted, remove only that marker to avoid silently
    // pointing at the photo that shifted into its old number.
    if (!photoId) return marker;
    const nextNumber = newNumberByPhotoId.get(photoId);
    return nextNumber ? marker.replace(/\d+(?=\s*\])/, String(nextNumber)) : '';
  });
}

function removeMeetingPhoto(idx) {
  const previousItems = state.meetingPhotoItems.slice();
  const it = state.meetingPhotoItems[idx];
  if (it && it.objectUrl) URL.revokeObjectURL(it.objectUrl);
  state.meetingPhotoItems.splice(idx, 1);
  remapMeetingPhotoReferences(previousItems, state.meetingPhotoItems);
  renderMeetingPhotoManager();
}

function renderMeetingSlideFileCurrent(row) {
  const el = $('#meetingSlideFileCurrent');
  if (!el) return;
  if (row && String(row.SlideFileURL || '').trim()) {
    el.classList.remove('hidden');
    el.innerHTML = `<label class="check-label"><input id="meetingRemoveSlideFile" type="checkbox"> ลบไฟล์ที่แนบไว้: <a href="${escapeAttr(row.SlideFileURL)}" target="_blank" rel="noopener">📊 ${escapeHtml(row.SlideFileName || 'สไลด์ PPT')}</a></label>`;
  } else {
    el.classList.add('hidden');
    el.innerHTML = '';
  }
}

function renderMeetingVideoCurrent(row) {
  const el = $('#meetingVideoCurrent');
  if (!el) return;
  if (row && String(row.VideoURL || '').trim()) {
    el.classList.remove('hidden');
    el.innerHTML = `<span>วิดีโอปัจจุบัน: <a href="${escapeAttr(row.VideoURL)}" target="_blank" rel="noopener">▶ ${escapeHtml(row.VideoFileName || 'เปิดวิดีโอ')}</a></span><label class="check-label"><input id="meetingRemoveVideo" type="checkbox"> ลบวิดีโอที่แนบไว้</label>`;
  } else {
    el.classList.add('hidden');
    el.innerHTML = '';
  }
}

function insertMeetingVideoMarker() {
  const detail = $('#meetingPostDetail');
  if (!detail) return;
  const marker = '[วิดีโอ]';
  const start = Number.isFinite(detail.selectionStart) ? detail.selectionStart : detail.value.length;
  const end = Number.isFinite(detail.selectionEnd) ? detail.selectionEnd : start;
  const before = detail.value.slice(0, start);
  const after = detail.value.slice(end);
  const spacer = before && !/[\s\n]$/.test(before) ? '\n' : '';
  detail.value = `${before}${spacer}${marker}${after}`;
  const cursor = before.length + spacer.length + marker.length;
  detail.focus();
  detail.setSelectionRange(cursor, cursor);
}

function handleMeetingVideoFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const extension = (file.name.match(/\.([^.]+)$/) || [])[1] || '';
  if (!/^(mp4|webm|mov)$/i.test(extension)) {
    event.target.value = '';
    showToast('รองรับไฟล์วิดีโอ MP4, WebM และ MOV เท่านั้น', 'warning');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    event.target.value = '';
    showToast('ไฟล์วิดีโอต้องมีขนาดไม่เกิน 10 MB', 'warning');
    return;
  }
  $('#meetingPostVideoUrl').value = '';
  const removeVideo = $('#meetingRemoveVideo');
  if (removeVideo) removeVideo.checked = false;
}

function handleMeetingVideoUrlInput(event) {
  if (event.target.value) {
    if ($('#meetingPostVideo').files?.length) $('#meetingPostVideo').value = '';
    const removeVideo = $('#meetingRemoveVideo');
    if (removeVideo) removeVideo.checked = false;
  }
}

function meetingDriveFileId(url) {
  const text = String(url || '');
  const m = text.match(/\/d\/([-\w]{20,})/) || text.match(/[?&]id=([-\w]{20,})/);
  return m ? m[1] : '';
}

function meetingVideoPlayerHtml(url, fileName = '', className = 'mtg-inline-video') {
  const rawUrl = String(url || '').trim();
  if (!rawUrl) return '';
  let parsed;
  try { parsed = new URL(rawUrl); } catch (_) { return `<a class="meeting-video-link" href="${escapeAttr(rawUrl)}" target="_blank" rel="noopener">▶ เปิดวิดีโอ ${escapeHtml(fileName)}</a>`; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return '';
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const driveId = meetingDriveFileId(rawUrl);
  if (driveId && ['drive.google.com', 'docs.google.com'].includes(host)) {
    const src = `https://drive.google.com/file/d/${encodeURIComponent(driveId)}/preview`;
    return `<div class="${escapeAttr(className)}"><iframe src="${escapeAttr(src)}" title="${escapeAttr(fileName || 'วิดีโอประกอบ Meeting')}" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  let youtubeId = '';
  if (host === 'youtu.be') youtubeId = parsed.pathname.split('/').filter(Boolean)[0] || '';
  else if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) {
    youtubeId = parsed.searchParams.get('v') || (parsed.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/) || [])[1] || '';
  }
  if (/^[\w-]{6,}$/.test(youtubeId)) {
    const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}`;
    return `<div class="${escapeAttr(className)}"><iframe src="${escapeAttr(src)}" title="${escapeAttr(fileName || 'วิดีโอประกอบ Meeting')}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`;
  }
  if (/\.(?:mp4|webm|ogg|mov)$/i.test(parsed.pathname)) {
    return `<div class="${escapeAttr(className)}"><video controls playsinline preload="metadata" src="${escapeAttr(rawUrl)}">เบราว์เซอร์นี้ไม่รองรับการเล่นวิดีโอ</video></div>`;
  }
  return `<a class="meeting-video-link" href="${escapeAttr(rawUrl)}" target="_blank" rel="noopener">▶ เปิดวิดีโอ${fileName ? ` · ${escapeHtml(fileName)}` : ''}</a>`;
}

async function uploadMeetingVideo(file, postId) {
  const base64Data = await fileToBase64(file);
  const payload = {
    relatedType: 'MeetingVideo', relatedId: postId, fileType: 'Attachment',
    fileName: file.name, mimeType: file.type || 'application/octet-stream', base64Data
  };
  try {
    return await apiCall('uploadFile', payload);
  } catch (error) {
    if (/ATTACHMENT_FOLDER_ID/.test(error.message)) return apiCall('uploadFile', Object.assign({}, payload, { fileType: 'BeforePhoto' }));
    throw error;
  }
}

async function uploadMeetingDoc(file, postId) {
  const base64Data = await fileToBase64(file);
  const payload = { relatedType: 'MeetingPost', relatedId: postId, fileType: 'Attachment', fileName: file.name, mimeType: file.type || 'application/octet-stream', base64Data };
  try {
    return await apiCall('uploadFile', payload);
  } catch (error) {
    // Fall back to the always-configured Before Photo folder when ATTACHMENT_FOLDER_ID is unset
    if (/FOLDER_ID/.test(error.message)) return apiCall('uploadFile', Object.assign({}, payload, { fileType: 'BeforePhoto' }));
    throw error;
  }
}

async function uploadSignedTrainingPDF(file, postId) {
  const base64Data = await fileToBase64(file);
  const payload = {
    relatedType: 'TrainingSignedPDF', relatedId: postId, fileType: 'Attachment',
    fileName: file.name, mimeType: file.type || 'application/pdf', base64Data,
    remark: 'Signed Training attendance PDF'
  };
  try {
    return await apiCall('uploadFile', payload);
  } catch (error) {
    if (/ATTACHMENT_FOLDER_ID/.test(error.message)) {
      return apiCall('uploadFile', Object.assign({}, payload, { fileType: 'BeforePhoto' }));
    }
    throw error;
  }
}

async function uploadMeetingPhoto(file, postId) {
  try {
    return await uploadFile(file, 'MeetingPost', postId, 'Evidence', false);
  } catch (error) {
    // Fall back to the always-configured Before Photo folder when EVIDENCE_FOLDER_ID is not set
    if (/EVIDENCE_FOLDER_ID/.test(error.message)) return uploadFile(file, 'MeetingPost', postId, 'BeforePhoto', false);
    throw error;
  }
}

async function saveMeetingPostFromForm() {
  const topic = $('#meetingPostTopic').value.trim();
  if (!topic) return showToast('กรุณากรอกหัวข้อ', 'warning');
  const postId = $('#meetingPostId').value;
  const videoFile = ($('#meetingPostVideo').files || [])[0];
  const removeVideo = $('#meetingRemoveVideo') && $('#meetingRemoveVideo').checked;
  const enteredVideoUrl = $('#meetingPostVideoUrl').value.trim();
  if (videoFile && videoFile.size > 10 * 1024 * 1024) return showToast('ไฟล์วิดีโอต้องมีขนาดไม่เกิน 10 MB', 'warning');
  if (enteredVideoUrl && !removeVideo) {
    try {
      const parsedVideoUrl = new URL(enteredVideoUrl);
      if (!['http:', 'https:'].includes(parsedVideoUrl.protocol)) throw new Error('invalid scheme');
    } catch (_) { return showToast('กรุณาระบุลิงก์วิดีโอที่ถูกต้อง โดยขึ้นต้นด้วย https://', 'warning'); }
  }
  const existingVideoUrl = state.editingMeetingPost?.VideoURL || '';
  const videoUrlForSave = removeVideo ? '' : videoFile ? existingVideoUrl : enteredVideoUrl;
  const videoNameForSave = removeVideo ? '' : videoFile ? (state.editingMeetingPost?.VideoFileName || '') :
    enteredVideoUrl === existingVideoUrl ? (state.editingMeetingPost?.VideoFileName || '') : (enteredVideoUrl ? 'วิดีโอจากลิงก์' : '');
  const payload = {
    contentType: $('#meetingPostType').value,
    meetingDate: $('#meetingPostDate').value || localDateInput(new Date()),
    shift: $('#meetingPostShift').value,
    lineId: $('#meetingPostLine').value || 'ALL',
    category: $('#meetingPostCategory').value,
    priority: $('#meetingPostPriority').value,
    topic,
    detail: $('#meetingPostDetail').value.trim(),
    videoUrl: videoUrlForSave,
    videoFileName: videoNameForSave,
    trainingTime: $('#meetingTrainingTime').value,
    trainingPlace: $('#meetingTrainingPlace').value.trim(),
    trainingUnit: $('#meetingTrainingUnit').value.trim(),
    trainerName: $('#meetingTrainerName').value.trim(),
    trainingPlanned: $('#meetingTrainingPlanned').value,
    trainingEffect: $('#meetingTrainingEffect').value.trim(),
    pinned: $('#meetingPostPinned').checked,
    ackUserIds: $$('#meetingAckUserGroup input:checked').map(input => input.value)
  };
  if (postId) payload.postId = postId;
  const photoItems = state.meetingPhotoItems || [];
  const slideFile = ($('#meetingPostSlideFile').files || [])[0];
  const removeSlide = $('#meetingRemoveSlideFile') && $('#meetingRemoveSlideFile').checked;
  const contentType = payload.contentType;
  showLoading(contentType === 'Training' ? 'กำลังบันทึก Training...' : 'กำลังบันทึกหัวข้อประชุม...');
  try {
    const data = await apiCall('saveMeetingPost', payload);
    const savedId = data.post?.PostID || postId;
    if (savedId && !postId) {
      $('#meetingPostId').value = savedId;
      state.editingMeetingPost = data.post || state.editingMeetingPost;
    }
    // Rebuild PhotoURL from the managed list order so reordering + removals stick.
    const newFileCount = photoItems.filter(it => it.type === 'file').length;
    let uploaded = 0;
    const finalUrls = [];
    for (const it of photoItems) {
      if (it.type === 'url') { finalUrls.push(it.url); continue; }
      $('#loadingText').textContent = `กำลังอัปโหลดรูป ${++uploaded}/${newFileCount}...`;
      const upload = await uploadMeetingPhoto(it.file, savedId);
      if (upload?.DriveFileURL) finalUrls.push(upload.DriveFileURL);
    }
    const originalUrls = meetingPhotoList(data.post || {});
    if (savedId && finalUrls.join(', ') !== originalUrls.join(', ')) {
      const photoUpdate = await apiCall('saveMeetingPost', { postId: savedId, photoUrl: finalUrls.join(', ') });
      const persistedUrls = meetingPhotoList(photoUpdate.post || {});
      if (persistedUrls.join('\n') !== finalUrls.join('\n')) {
        throw new Error('บันทึกลำดับรูปไม่สำเร็จ กรุณาลองบันทึกอีกครั้ง');
      }
    }
    // PPT / PDF slide file: upload a new one, or clear the existing one.
    if (slideFile && savedId) {
      $('#loadingText').textContent = 'กำลังอัปโหลดไฟล์สไลด์...';
      const up = await uploadMeetingDoc(slideFile, savedId);
      if (up?.DriveFileURL) {
        await apiCall('saveMeetingPost', { postId: savedId, slideFileUrl: up.DriveFileURL, slideFileName: slideFile.name, slideImageUrls: '' });
        // PPT/PPTX get converted to one image per slide server-side; PDF stays as an embed.
        if (/\.pptx?$/i.test(slideFile.name) && up.DriveFileID) {
          $('#loadingText').textContent = 'กำลังแปลงสไลด์ PPT เป็นรูป... (อาจใช้เวลาสักครู่)';
          try {
            const conv = await apiCall('convertMeetingSlideFile', { postId: savedId, driveFileId: up.DriveFileID });
            if (conv && conv.converted === false) showToast('แนบไฟล์แล้ว (ฝังตัวพรีวิว) — แปลงเป็นรูปได้เฉพาะ PPT/PPTX', 'info', 6000);
          } catch (convErr) {
            showToast('แนบไฟล์แล้ว แต่แปลงเป็นรูปไม่สำเร็จ: ' + convErr.message + ' — จะฝังตัวพรีวิวแทน', 'warning', 9000);
          }
        }
      }
    } else if (removeSlide && savedId) {
      await apiCall('saveMeetingPost', { postId: savedId, slideFileUrl: '', slideFileName: '', slideImageUrls: '' });
    }
    if (videoFile && savedId) {
      $('#loadingText').textContent = 'กำลังอัปโหลดวิดีโอ...';
      const uploadedVideo = await uploadMeetingVideo(videoFile, savedId);
      if (!uploadedVideo?.DriveFileURL) throw new Error('อัปโหลดวิดีโอไม่สำเร็จ กรุณาลองอีกครั้ง');
      await apiCall('saveMeetingPost', { postId: savedId, videoUrl: uploadedVideo.DriveFileURL, videoFileName: videoFile.name });
    }
    clearMeetingPhotoItems();
    $('#meetingDialog').close();
    showToast(contentType === 'Training' ? (postId ? 'บันทึกการแก้ไข Training แล้ว' : 'บันทึกหัวข้อ Training แล้ว') : (postId ? 'แก้ไขหัวข้อแล้ว' : 'เพิ่มหัวข้อลงบอร์ดแล้ว'), 'success');
    await loadMeetingBoard();
    if ($('#page-training')?.classList.contains('active-page')) await loadTrainingPage();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    hideLoading();
  }
}

async function deleteMeetingPostAction() {
  const postId = $('#meetingPostId').value;
  if (!postId) return;
  const confirmed = await showConfirm({
    title: 'ลบหัวข้อนี้?',
    message: 'หัวข้อจะถูกลบออกจากบอร์ดประชุมและกู้คืนไม่ได้',
    confirmText: 'ลบหัวข้อ',
    tone: 'danger'
  });
  if (!confirmed) return;
  showLoading('กำลังลบหัวข้อ...');
  try {
    await apiCall('deleteMeetingPost', { postId });
    $('#meetingDialog').close();
    showToast('ลบหัวข้อแล้ว', 'success');
    await loadMeetingBoard();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    hideLoading();
  }
}

function populateMeetingAckUsers(selectedIds = []) {
  const group = $('#meetingAckUserGroup');
  const selected = new Set(selectedIds.map(String));
  const users = (state.masterData.users || [])
    .filter(u => (!u.ActiveStatus || String(u.ActiveStatus).toLowerCase() === 'active') && u.Role !== 'Customer')
    .sort((a, b) => String(a.FullName || '').localeCompare(String(b.FullName || ''), 'th'));
  group.innerHTML = users.length
    ? users.map(u => `<label class="checkbox-item"><input type="checkbox" value="${escapeAttr(u.UserID)}" ${selected.has(String(u.UserID)) ? 'checked' : ''}><span>${escapeHtml(u.FullName || u.Username)} <small>(${escapeHtml(u.Role || '')})</small></span></label>`).join('')
    : '<div class="empty-state">กำลังโหลดรายชื่อผู้ใช้...</div>';
  wireCheckboxChips(group);
  $('#meetingAckSearch').value = '';
  filterMeetingAckUsers();
}

function filterMeetingAckUsers() {
  const query = $('#meetingAckSearch').value.trim().toLowerCase();
  $$('#meetingAckUserGroup .checkbox-item').forEach(item => {
    const match = !query || item.textContent.toLowerCase().includes(query) || item.querySelector('input').checked;
    item.style.display = match ? '' : 'none';
  });
}

async function ackMeetingPost(button, postId) {
  if (button) { button.disabled = true; button.textContent = 'กำลังบันทึก...'; }
  try {
    await apiCall('acknowledgeMeetingPost', { postId });
    showToast('รับทราบเรียบร้อย ✅', 'success');
    state.meetingPendingAcks = state.meetingPendingAcks.filter(p => p.PostID !== postId);
    renderMeetingAckBadgeAndBanner();
    if ($('#page-meeting').classList.contains('active-page')) await loadMeetingBoard();
    refreshMeetingAckNotifications(false);
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = '✋ กดรับทราบ'; }
    showToast(error.message, 'error');
  }
}

async function refreshMeetingAckNotifications(notify = false) {
  if (!state.user || !hasPermission('meeting.view')) return;
  try {
    const data = await apiCall('getMyPendingMeetingAcks', {});
    state.meetingPendingAcks = data.pending || [];
    renderMeetingAckBadgeAndBanner();
    if (notify && state.meetingPendingAcks.length) {
      showToast(`📣 มีเรื่องแจ้งจากที่ประชุม ${state.meetingPendingAcks.length} รายการ รอคุณกดรับทราบ`, 'warning', 8000);
    }
  } catch (_) { /* เงียบไว้ — แถบเตือนไม่ควรทำให้หน้าหลักพัง */ }
}

function renderMeetingAckBadgeAndBanner() {
  const count = state.meetingPendingAcks.length;
  const badge = $('#meetingNavBadge');
  if (badge) {
    badge.textContent = count;
    badge.classList.toggle('hidden', !count);
  }
  const banner = $('#meetingAckBanner');
  if (!banner) return;
  if (!count) { banner.classList.add('hidden'); banner.innerHTML = ''; return; }
  banner.classList.remove('hidden');
  banner.innerHTML = `<div class="mtg-ack-banner-head">📣 มีเรื่องแจ้งจากที่ประชุมรอคุณกดรับทราบ (${count})</div>` +
    state.meetingPendingAcks.map(p => `<div class="mtg-ack-banner-item">
      <div class="mtg-ack-banner-text">
        <strong>${escapeHtml(p.Topic || '-')}</strong>
        <small>${formatDate(p.MeetingDate)} · ${escapeHtml(p.LineName || p.LineID || 'ทุกไลน์')} · ${escapeHtml(p.Category || 'ทั่วไป')} · ลงโดย ${escapeHtml(p.CreatedByName || '-')}</small>
        ${p.Detail ? `<small class="mtg-ack-banner-detail">${escapeHtml(p.Detail)}</small>` : ''}
      </div>
      <button class="btn btn-primary" data-mtg-ack="${escapeAttr(p.PostID)}">✋ รับทราบ</button>
    </div>`).join('') +
    `<button class="btn btn-outline mtg-ack-banner-open" id="meetingAckBannerOpen">เปิดบอร์ดประชุม →</button>`;
  $$('[data-mtg-ack]', banner).forEach(btn => btn.addEventListener('click', () => ackMeetingPost(btn, btn.dataset.mtgAck)));
  $('#meetingAckBannerOpen').addEventListener('click', () => navigateTo('meeting'));
}

async function setMeetingPostStatus(button, postId, status, fromTv = false) {
  if (button) button.disabled = true;
  try {
    const data = await apiCall('updateMeetingPostStatus', { postId, status });
    const updated = data.post || {};
    ['meetingPosts', 'meetingCarryOver'].forEach(key => {
      state[key] = state[key].map(p => p.PostID === postId ? { ...p, ...updated } : p);
    });
    renderMeetingBoard();
    if (fromTv && ['Discussed', 'Closed'].includes(status)) meetingTvStep(1);
    else if (!$('#meetingTv').classList.contains('hidden')) renderMeetingTv();
  } catch (error) {
    if (button) button.disabled = false;
    showToast(error.message, 'error');
  }
}

// ===== TV / presentation mode =====
// Full-screen slide deck for projecting the board during the pre-shift meeting:
// slide 0 is the agenda, then one big-type slide per topic (carry-overs last).
function meetingTvDeck(posts = state.meetingPosts, carryOver = state.meetingCarryOver) {
  return posts.map(row => ({ row, carry: false }))
    .concat(carryOver.map(row => ({ row, carry: true })));
}

// A line of --- (3+ dashes) in the Detail splits a post into multiple TV slides,
// so one topic can span several slides. Empty sections are dropped.
function meetingSlideSections(detail) {
  const parts = String(detail || '').split(/(?:^|\n)\s*-{3,}\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean);
  return parts.length ? parts : [''];
}

function meetingPhotoList(row) {
  return String(row.PhotoURL || '').split(',').map(u => u.trim()).filter(Boolean);
}

// A [รูป1] / [ภาพ2] / [pic3] marker in a section pins that photo to that slide.
const MEETING_PHOTO_MARKER = /\[\s*(?:รูปที่|รูป|ภาพ|pic|img|image)\s*(\d+)\s*\]/gi;
function meetingExtractPhotoRefs(text) {
  const idxs = [];
  String(text || '').replace(MEETING_PHOTO_MARKER, (_, n) => { idxs.push(parseInt(n, 10) - 1); return ''; });
  return idxs;
}
function meetingPhotoContentParts(text, photos) {
  const source = String(text || '');
  const parts = [];
  const marker = /\[\s*(?:รูปที่|รูป|ภาพ|pic|img|image)\s*(\d+)\s*\]/gi;
  let cursor = 0;
  let match;
  while ((match = marker.exec(source))) {
    if (match.index > cursor) parts.push({ type: 'text', text: source.slice(cursor, match.index) });
    const number = Number(match[1]);
    const url = photos[number - 1];
    if (url) parts.push({ type: 'photo', url, number });
    else parts.push({ type: 'text', text: match[0] });
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) parts.push({ type: 'text', text: source.slice(cursor) });
  return parts;
}
const MEETING_VIDEO_MARKER = /\[\s*(?:วิดีโอ|video)\s*\]/gi;
function meetingHasVideoRef(text) {
  MEETING_VIDEO_MARKER.lastIndex = 0;
  return MEETING_VIDEO_MARKER.test(String(text || ''));
}
function meetingMediaContentParts(text, photos, videoUrl = '', videoName = '') {
  const source = String(text || '');
  const parts = [];
  const marker = /\[\s*(?:(?:รูปที่|รูป|ภาพ|pic|img|image)\s*(\d+)|(วิดีโอ|video))\s*\]/gi;
  let cursor = 0;
  let match;
  while ((match = marker.exec(source))) {
    if (match.index > cursor) parts.push({ type: 'text', text: source.slice(cursor, match.index) });
    if (match[1]) {
      const number = Number(match[1]);
      const url = photos[number - 1];
      if (url) parts.push({ type: 'photo', url, number });
      else parts.push({ type: 'text', text: match[0] });
    } else if (videoUrl) {
      parts.push({ type: 'video', url: videoUrl, fileName: videoName });
    } else {
      parts.push({ type: 'text', text: match[0] });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) parts.push({ type: 'text', text: source.slice(cursor) });
  return parts;
}
function meetingStripPhotoRefs(text) {
  return String(text || '').replace(MEETING_PHOTO_MARKER, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
function meetingStripMediaRefs(text) {
  MEETING_VIDEO_MARKER.lastIndex = 0;
  return meetingStripPhotoRefs(String(text || '').replace(MEETING_VIDEO_MARKER, '')).trim();
}

// Flatten the deck into one entry per slide — a post with N sections yields N.
// Photos are pinned to whichever slide names them ([รูปN]); anything not named
// falls to the last slide so existing posts keep all photos at the end.
function meetingTvPostSlides(deck = meetingTvDeck()) {
  const slides = [];
  deck.forEach((item, deckPos) => {
    const rawSections = meetingSlideSections(item.row.Detail);
    const allPhotos = meetingPhotoList(item.row);
    const allVideo = String(item.row.VideoURL || '').trim();
    const allVideoName = String(item.row.VideoFileName || '').trim();
    const used = new Set();
    const perSection = rawSections.map(text => {
      const refs = meetingExtractPhotoRefs(text).filter(i => i >= 0 && i < allPhotos.length);
      refs.forEach(i => used.add(i));
      const hasPhotoMarkers = meetingExtractPhotoRefs(text).length > 0;
      const hasVideoMarkers = meetingHasVideoRef(text);
      return { text: meetingStripMediaRefs(text), rawText: text, photoIdx: refs, hasPhotoMarkers: hasPhotoMarkers, hasVideoMarkers: hasVideoMarkers, hasMediaMarkers: hasPhotoMarkers || hasVideoMarkers, appendVideo: false };
    });
    const hasExplicitPhotoRefs = rawSections.some(text => meetingExtractPhotoRefs(text).length > 0);
    const hasExplicitVideoRefs = rawSections.some(meetingHasVideoRef);
    const unused = allPhotos.map((_, i) => i).filter(i => !used.has(i));
    // Preserve the old “put all photos at the end” behavior when the author
    // has not placed any markers. Once markers exist, keep each slide strictly
    // tied to its selected photo numbers and put remaining photos on a clearly
    // labeled overflow slide instead of mixing them into the final topic.
    if (perSection.length && unused.length && !hasExplicitPhotoRefs) {
      const last = perSection[perSection.length - 1];
      last.photoIdx = last.photoIdx.concat(unused);
    } else if (perSection.length && unused.length) {
      perSection.push({ text: 'รูปที่ยังไม่ได้ระบุตำแหน่งในรายละเอียด', rawText: 'รูปที่ยังไม่ได้ระบุตำแหน่งในรายละเอียด', photoIdx: unused, isUnassignedPhotos: true });
    }
    if (allVideo && !hasExplicitVideoRefs && perSection.length) {
      const videoTarget = [...perSection].reverse().find(section => !section.isUnassignedPhotos) || perSection[perSection.length - 1];
      videoTarget.appendVideo = true;
      videoTarget.hasMediaMarkers = true;
    }
    const postSlides = perSection.map(sec => {
      const seen = new Set();
      const dedup = sec.photoIdx.filter(i => !seen.has(i) && seen.add(i));
      const contentParts = sec.hasMediaMarkers ? meetingMediaContentParts(sec.rawText, allPhotos, allVideo, allVideoName) : [];
      if (sec.appendVideo) contentParts.push({ type: 'video', url: allVideo, fileName: allVideoName });
      return {
        row: item.row, carry: item.carry, deckPos, sectionText: sec.text, isDoc: false,
        hasPhotoMarkers: Boolean(sec.hasPhotoMarkers), hasVideoMarkers: Boolean(sec.hasVideoMarkers), hasMediaMarkers: Boolean(sec.hasMediaMarkers),
        contentParts: contentParts,
        isUnassignedPhotos: Boolean(sec.isUnassignedPhotos),
        photos: dedup.map(i => allPhotos[i]), photoNumbers: dedup.map(i => i + 1)
      };
    });
    const pptImages = String(item.row.SlideImageURLs || '').split(',').map(u => u.trim()).filter(Boolean);
    const docUrl = String(item.row.SlideFileURL || '').trim();
    if (pptImages.length) {
      // Converted PPT: one native image slide per page.
      pptImages.forEach((url, pi) => postSlides.push({ row: item.row, carry: item.carry, deckPos, isPpt: true, pptUrl: url, pptPage: pi + 1, pptTotal: pptImages.length }));
    } else if (docUrl) {
      // PDF / unconverted: fall back to the embedded Drive preview.
      postSlides.push({ row: item.row, carry: item.carry, deckPos, isDoc: true, docUrl, docName: String(item.row.SlideFileName || '').trim() || 'สไลด์ PPT' });
    }
    postSlides.forEach((s, sectionIndex) => {
      s.sectionIndex = sectionIndex;
      s.sectionCount = postSlides.length;
      s.isLast = sectionIndex === postSlides.length - 1;
      slides.push(s);
    });
  });
  return slides;
}

// Direction of the last slide change — drives the enter animation (next = from right).
let meetingTvDir = 'next';

function tvHasFindingSlide() {
  return Boolean(state.meetingFindingDigest) && hasAnyPermission(['dashboard.view', 'dashboard.view.all']);
}

function meetingTvDailyQuizzes() {
  const meetingDate = String($('#meetingDate')?.value || localDateInput(new Date())).slice(0, 10);
  const todaysPosts = (state.meetingPosts || []).filter(row => String(row.MeetingDate || '').slice(0, 10) === meetingDate);
  const meetingPosts = todaysPosts.filter(row => String(row.ContentType || '').toLowerCase() !== 'training');
  const trainingPosts = todaysPosts.filter(row => String(row.ContentType || '').toLowerCase() === 'training');
  const makeEntry = (post, isTraining) => {
    const quiz = post ? (isTraining ? post.TrainingQuiz : post.MeetingQuiz) || {} : {};
    return {
      post: post || null, quiz, isTraining,
      canManage: Boolean(quiz.canManage),
      canGenerate: Boolean(quiz.canGenerate),
      hasSlides: Number(quiz.slideCount || 0) > 0
    };
  };
  // TV presents one shared assessment link for all shifts. Prefer a published
  // Training assessment when both Training and Meeting quizzes exist; otherwise
  // fall back to the published Meeting quiz. This keeps a single QR/status pair.
  const meetingPost = meetingPosts.find(row => row.MeetingQuiz?.available) ||
    meetingPosts.find(row => row.MeetingQuiz?.hasDraft || row.MeetingQuiz?.canGenerate || row.MeetingQuiz?.canManage) || meetingPosts[0];
  const entries = [
    ...trainingPosts.map(post => makeEntry(post, true)),
    ...(meetingPost ? [makeEntry(meetingPost, false)] : [])
  ];
  const published = entries.filter(entry => entry.quiz.available);
  if (published.length) return [published.find(entry => entry.isTraining) || published[0]];
  const drafts = entries.filter(entry => entry.quiz.hasDraft);
  if (drafts.length) return [drafts.find(entry => entry.isTraining) || drafts[0]];
  const configured = entries.find(entry => entry.canGenerate || entry.canManage);
  if (configured) return [configured];
  const fallbackPost = meetingPost || trainingPosts[0] || null;
  return [makeEntry(fallbackPost, fallbackPost ? String(fallbackPost.ContentType || '').toLowerCase() === 'training' : false)];
}

function meetingTvDailyQuiz() {
  return meetingTvDailyQuizzes()[0] || null;
}

function meetingTvAuxiliarySlides() {
  const slides = [];
  // Keep a QR slot in the TV agenda every day; show setup hints until a quiz
  // is published, then show one QR and progress slide for each published set.
  meetingTvDailyQuizzes().forEach(dailyQuiz => {
    slides.push({ type: 'quiz', dailyQuiz });
    if (dailyQuiz.quiz?.available) slides.push({ type: 'quizStatus', dailyQuiz });
  });
  if (tvHasFindingSlide()) slides.push({ type: 'finding' });
  return slides;
}

function meetingTvTotalSlides() {
  return meetingTvPostSlides().length + meetingTvAuxiliarySlides().length;
}

function openMeetingTv() {
  if (!meetingTvTotalSlides()) return showToast('ยังไม่มีหัวข้อบนบอร์ดสำหรับนำเสนอ', 'warning');
  state.meetingTvIndex = 0;
  meetingTvDir = 'next';
  $('#meetingTv').classList.remove('hidden');
  document.body.classList.add('mtg-tv-open');
  renderMeetingTv();
  startMeetingTvQuizStatusPolling();
  if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
}

function closeMeetingTv() {
  stopMeetingTvQuizStatusPolling();
  $('#meetingTv').classList.add('hidden');
  document.body.classList.remove('mtg-tv-open');
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}

function startMeetingTvQuizStatusPolling() {
  stopMeetingTvQuizStatusPolling();
  // Refresh immediately on entry, then keep the visible TV status slide current
  // while employees are submitting their answers from other devices.
  refreshMeetingQuizBoardStatus();
  state.meetingTvQuizStatusTimer = setInterval(() => {
    const tv = $('#meetingTv');
    if (!tv || tv.classList.contains('hidden') || document.visibilityState !== 'visible') return;
    refreshMeetingQuizBoardStatus();
  }, 10000);
}

function stopMeetingTvQuizStatusPolling() {
  if (state.meetingTvQuizStatusTimer) clearInterval(state.meetingTvQuizStatusTimer);
  state.meetingTvQuizStatusTimer = null;
}

function meetingTvStep(delta) {
  meetingTvDir = delta < 0 ? 'prev' : 'next';
  state.meetingTvIndex = Math.max(0, Math.min(state.meetingTvIndex + delta, meetingTvTotalSlides()));
  renderMeetingTv();
}

function meetingTvStatusDone(row) {
  return ['discussed', 'closed'].includes(String(row.Status || '').toLowerCase());
}

// One Finding rendered full-fat for the TV: problem, root cause, corrective
// action, due date, and Before/After photos (tap a photo for the lightbox).
function meetingTvFindingRowHtml(f) {
  const s = String(f.Severity || f.Priority || '').toLowerCase();
  const sev = s === 'critical' ? '🔴' : s === 'major' ? '🟠' : '🟡';
  const overdue = String(f.OverdueFlag || '').toLowerCase() === 'yes';
  const photos = [];
  const addPhotos = (csv, label) => String(csv || '').split(',').map(u => u.trim()).filter(Boolean).forEach((u, i, arr) => {
    const caption = arr.length > 1 ? `${label} ${i + 1}` : label;
    photos.push(`<a href="${escapeAttr(u)}" data-photo-url="${escapeAttr(u)}" class="mtg-tv-fd-photo"><img src="${escapeAttr(driveThumbnailUrl_(u, 600))}" alt="${escapeAttr(caption)}" loading="lazy"><span>${escapeHtml(caption)}</span></a>`);
  });
  addPhotos(f.BeforePhotoURL, 'Before');
  addPhotos(f.AfterPhotoURL, 'After');
  const metaParts = [`${escapeHtml(f.LineName || f.LineID || '-')} / ${escapeHtml(f.StationName || f.StationID || '-')}`];
  if (f.Category) metaParts.push(escapeHtml(f.Category));
  const pic = f.AssignmentDisplay || f.PICName || f.AssignedToName || f.ResponsiblePerson;
  if (pic && pic !== '-') metaParts.push(`ผู้รับผิดชอบ ${escapeHtml(pic)}`);
  if (f.DueDate) metaParts.push(`Due ${formatDate(f.DueDate)}${overdue ? ` ⚠️ เกิน ${Number(f.DaysOverdue) || 0} วัน` : ''}`);
  return `<div class="mtg-tv-fd-row${overdue ? ' mtg-tv-fd-overdue' : ''}">
    <div class="mtg-tv-fd-top">
      <span class="mtg-tv-fd-sev">${sev}</span>
      <div class="mtg-tv-fd-name">${escapeHtml(f.ProblemDetail || f.FindingID)}</div>
      <span class="mtg-tv-fd-status">${escapeHtml(f.Status || 'Open')}</span>
    </div>
    <div class="mtg-tv-fd-meta">${metaParts.join(' · ')}</div>
    ${f.RootCause ? `<div class="mtg-tv-fd-extra">🔍 สาเหตุ: ${escapeHtml(f.RootCause)}</div>` : ''}
    ${f.CorrectiveAction ? `<div class="mtg-tv-fd-extra">🛠 แนวทางแก้ไข: ${escapeHtml(f.CorrectiveAction)}</div>` : ''}
    ${photos.length ? `<div class="mtg-tv-fd-photos">${photos.join('')}</div>` : ''}
  </div>`;
}

// Final TV slide: the same Finding shift digest shown on the Meeting page,
// restyled in big type so the meeting can run through open Findings on-screen.
function meetingTvFindingSlideHtml() {
  const digest = state.meetingFindingDigest || {};
  const sections = [
    { key: 'today', label: '📅 วันนี้' },
    { key: 'yesterday', label: '📅 เมื่อวาน' },
    { key: 'sevenDaysAgo', label: '📅 7 วันก่อน' }
  ];
  const bodyHtml = sections.map(s => {
    const bucket = digest[s.key] || {};
    const groups = bucket.shiftGroups || [];
    const dateLabel = bucket.date ? formatDate(bucket.date) : '';
    const rows = !groups.length
      ? '<div class="mtg-tv-fd-empty">✅ ไม่มี Finding เปิด</div>'
      : groups.map(g => `
        <div class="mtg-tv-fd-shift">🕐 ${escapeHtml(g.shift)} <span>${g.count} รายการ</span></div>
        ${g.findings.map(meetingTvFindingRowHtml).join('')}`).join('');
    return `<div class="mtg-tv-fd-day"><div class="mtg-tv-fd-day-title">${escapeHtml(s.label)}${dateLabel ? ` (${dateLabel})` : ''} — ${bucket.totalCount || 0} Finding</div>${rows}</div>`;
  }).join('');
  return `<div class="mtg-tv-slide tv-anim-${meetingTvDir}">
    <div class="mtg-tv-chips"><span class="mtg-tv-chip mtg-tv-cat mtg-cat-problem">📢 Finding จากการตรวจ LPA</span></div>
    <div class="mtg-tv-fd-list">${bodyHtml}</div>
  </div>`;
}

function meetingTvQuizSlideHtml(dailyQuiz) {
  const quiz = dailyQuiz?.quiz || {};
  const examType = dailyQuiz?.isTraining ? 'Training' : 'Meeting';
  const examLabel = `แบบทดสอบหลัง ${examType}`;
  const postTitle = dailyQuiz?.post?.Topic || quiz.sourceTitle || `${examType} วันนี้`;
  if (!quiz.available) {
    const setupContent = !dailyQuiz
      ? '<div class="mtg-tv-quiz-empty">ยังไม่มีข้อสอบที่เผยแพร่สำหรับวันนี้</div><p class="mtg-tv-quiz-help">รอ Admin หรือ Engineer สร้างและเผยแพร่ข้อสอบจากหัวข้อประชุมวันนี้</p>'
      : quiz.hasDraft
        ? `<div class="mtg-tv-quiz-empty">มีข้อสอบฉบับร่างแล้ว</div>${dailyQuiz.canManage ? `<button type="button" class="btn btn-primary mtg-tv-quiz-generate" data-tv-quiz-draft="${escapeAttr(dailyQuiz.post.PostID)}">✏️ เปิดและแก้ไขฉบับร่าง</button>` : ''}<p class="mtg-tv-quiz-help">ตรวจแก้และเผยแพร่ฉบับร่างก่อนให้พนักงานเริ่มสอบ</p>`
        : dailyQuiz.canGenerate && dailyQuiz.hasSlides
          ? `<p class="mtg-tv-quiz-help">ระบบจะวิเคราะห์รายละเอียดและสไลด์จากทุกหัวข้อของวันนี้ แล้วสร้างข้อสอบ 5 ข้อให้อัตโนมัติ</p><button type="button" class="btn btn-primary mtg-tv-quiz-generate" data-tv-quiz-generate="${escapeAttr(dailyQuiz.post.PostID)}">✨ Gen ข้อสอบ 5 ข้ออัตโนมัติ</button><p class="mtg-tv-quiz-help">หลังสร้าง ระบบจะเปิดหน้าตรวจแก้และเผยแพร่ก่อนให้พนักงานสแกน QR</p>`
          : dailyQuiz.canGenerate
            ? '<div class="mtg-tv-quiz-empty">ยังไม่มีรายละเอียดหรือสไลด์ประกอบสำหรับวันนี้</div><p class="mtg-tv-quiz-help">เพิ่มรายละเอียดหรือแนบสไลด์ในหัวข้อ Meeting ก่อนสร้างข้อสอบ</p>'
          : '<div class="mtg-tv-quiz-empty">วันนี้ยังไม่มีข้อสอบเผยแพร่</div><p class="mtg-tv-quiz-help">รอ Admin หรือ Engineer สร้างและเผยแพร่ข้อสอบจากหัวข้อประชุมวันนี้</p>';
    return `<div class="mtg-tv-slide mtg-tv-quiz-slide tv-anim-${meetingTvDir}">
      <div class="mtg-tv-chips"><span class="mtg-tv-chip mtg-tv-quiz-chip">📝 ${examLabel}</span></div>
      <h1 class="mtg-tv-title">QR Code ข้อสอบ</h1>
      <p class="mtg-tv-quiz-help">${escapeHtml(postTitle)}</p>
      ${setupContent}
    </div>`;
  }
  const publicUrl = dailyQuiz.quiz.publicToken ? meetingQuizPublicUrl(dailyQuiz.quiz.publicToken) : '';
  let qrSvg = '';
  if (publicUrl && typeof qrcode === 'function') {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(publicUrl);
      qr.make();
      qrSvg = qr.createSvgTag(8, 4);
    } catch (error) { console.warn('Could not build TV quiz QR code:', error); }
  }
  return `<div class="mtg-tv-slide mtg-tv-quiz-slide tv-anim-${meetingTvDir}">
    <div class="mtg-tv-chips"><span class="mtg-tv-chip mtg-tv-quiz-chip">📝 ${examLabel}</span></div>
    <h1 class="mtg-tv-title">QR Code ข้อสอบ</h1>
    <p class="mtg-tv-quiz-help">${escapeHtml(postTitle)} · QR เดียวใช้ได้ทั้ง 2 กะ · เลือกกะตอนลงชื่อ · ไม่ต้อง Login</p>
    ${qrSvg ? `<div class="mtg-tv-quiz-qr" aria-label="QR Code สำหรับเข้าสอบ">${qrSvg}</div>` : '<div class="mtg-tv-quiz-error">ข้อสอบเผยแพร่แล้ว แต่ QR ยังไม่พร้อม กรุณารีเฟรชหน้า Meeting</div>'}
    <div class="mtg-tv-quiz-caption">สแกน QR เดียวกันได้ทั้ง 2 กะ แล้วกรอกรหัสพนักงาน ชื่อ นามสกุล เลือกกะและภาษาที่ต้องการ</div>
  </div>`;
}

function meetingTvQuizStatusContentHtml(dailyQuiz) {
  const quiz = dailyQuiz?.quiz || {};
  if (!quiz.available) return '<div class="mtg-tv-quiz-status-empty">ยังไม่มีข้อสอบที่เปิดรับทำในวันนี้</div>';
  const sessions = quiz.shiftSessions || [];
  const stoppedShifts = sessions.filter(session => session.examStopped).length;
  const shifts = sessions.length
    ? sessions.map(session => {
      const started = Number(session.startedCount ?? session.participantCount ?? 0);
      const submitted = Number(session.submittedCount || 0);
      const stopControl = quiz.canManage && !session.examStopped
        ? `<button type="button" class="mtg-tv-quiz-stop" data-tv-quiz-post="${escapeAttr(dailyQuiz?.post?.PostID || '')}" data-tv-quiz-stop="${escapeAttr(session.shift)}" title="หยุดได้ทันที แม้ยังไม่มีผู้เริ่มสอบ">หยุดสอบและประกาศอันดับ</button>`
        : (session.examStopped ? '<span class="mtg-tv-quiz-stopped">หยุดแล้ว</span>' : '');
      const retakeControl = quiz.canManage && session.examStopped
        ? `<button type="button" class="mtg-tv-quiz-retake" data-tv-quiz-post="${escapeAttr(dailyQuiz?.post?.PostID || '')}" data-tv-quiz-retake="${escapeAttr(session.shift)}">↻ สอบใหม่ · รอบ ${Number(session.attemptNo || 1) + 1}</button>` : '';
      const shiftActions = stopControl || retakeControl
        ? `<div class="mtg-tv-quiz-shift-actions">${stopControl}${retakeControl}</div>` : '';
      return `<div class="mtg-tv-quiz-shift"><span>${escapeHtml(session.label || session.shift || 'กะ')}<small>รอบ ${Number(session.attemptNo || 1)} · ลงชื่อ ${Number(session.registeredCount || 0)} · เริ่ม ${started} · ส่ง ${submitted}</small></span><strong>ส่ง ${submitted} <small>/ เริ่ม ${started} คน</small></strong>${shiftActions}</div>`;
    }).join('')
    : '<div class="mtg-tv-quiz-status-empty">กำลังโหลดข้อมูลผู้เข้าสอบแยกตามกะ…</div>';
  const podiumHtml = (session, attemptNo, rows) =>
    `<div class="mtg-tv-quiz-podium"><strong>🏆 ${escapeHtml(session.label || session.shift)} · อันดับรอบ ${Number(attemptNo || 1)}</strong>${(rows || []).length
      ? `<ol>${rows.map(person => `<li><span>${person.rank === 1 ? '🥇' : (person.rank === 2 ? '🥈' : '🥉')} ${escapeHtml(person.displayName || '')}${person.durationLabel ? `<small>${escapeHtml(person.durationLabel)}</small>` : ''}</span><b>${Number(person.score || 0)}/${Number(person.total || 5)}</b></li>`).join('')}</ol>`
      : '<p>ยังไม่มีผู้ส่งข้อสอบเพื่อจัดอันดับ</p>'}</div>`;
  const podium = sessions.filter(session => session.examStopped)
    .map(session => podiumHtml(session, session.attemptNo, session.topThree)).join('');
  const previousPodium = sessions.filter(session => Number(session.previousAttemptNo || 0) > 0)
    .map(session => podiumHtml(session, session.previousAttemptNo, session.previousTopThree)).join('');
  const status = quiz.allSubmitted
    ? 'หัวหน้าหยุดสอบครบทุกกะแล้ว · จัดอันดับแยกตามกะ'
    : stoppedShifts
      ? `หยุดสอบแล้ว ${stoppedShifts} กะ · อีกกะยังทำข้อสอบได้ · สถานะและอันดับแยกตามกะ`
      : 'ข้อสอบชุดเดียวและ QR เดียวใช้ได้ทั้ง 2 กะ · Leader หยุดแต่ละกะเพื่อประกาศอันดับได้ทันที';
  const refreshedAt = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `<div class="mtg-tv-quiz-status-card">
    <div class="mtg-tv-quiz-status-total"><span>ข้อสอบชุดเดียว · แสดงผลแยกตามกะ</span><strong>${sessions.length || '—'}<small>${sessions.length ? ' กะ' : ' รอข้อมูล'}</small></strong></div>
    <p class="mtg-tv-quiz-status-message">${escapeHtml(status)}</p>
    <div class="mtg-tv-quiz-shifts">${shifts}</div>
    ${previousPodium || podium ? `<div class="mtg-tv-quiz-podium-list">${previousPodium}${podium}</div>` : ''}
    <small class="mtg-tv-quiz-updated">อัปเดตอัตโนมัติ · ${refreshedAt}</small>
  </div>`;
}

function meetingTvQuizStatusSlideHtml(dailyQuiz) {
  const examType = dailyQuiz?.isTraining ? 'Training' : 'Meeting';
  const postId = dailyQuiz?.post?.PostID || '';
  return `<div class="mtg-tv-slide mtg-tv-quiz-slide mtg-tv-quiz-status-slide tv-anim-${meetingTvDir}">
    <div class="mtg-tv-chips"><span class="mtg-tv-chip mtg-tv-quiz-chip">📝 แบบทดสอบหลัง ${examType}</span></div>
    <h1 class="mtg-tv-title">สถานะการส่งข้อสอบ</h1>
    <p class="mtg-tv-quiz-help">ติดตามจำนวนผู้ส่งแยกตามกะ · หน้านี้อัปเดตอัตโนมัติ</p>
    <div data-tv-quiz-status-content="${escapeAttr(postId)}" class="mtg-tv-quiz-status-content">${meetingTvQuizStatusContentHtml(dailyQuiz)}</div>
  </div>`;
}

function refreshMeetingTvQuizStatus() {
  $$('[data-tv-quiz-status-content]').forEach(content => {
    const entry = meetingTvDailyQuizzes().find(item => String(item.post?.PostID || '') === String(content.dataset.tvQuizStatusContent || ''));
    if (entry) content.innerHTML = meetingTvQuizStatusContentHtml(entry);
  });
}

// One post section rendered as a TV slide. The topic + chips repeat on every
// section; photos, meta, and the discuss button appear only on the last section.
function meetingTvPostSlideHtml(slide) {
  const { row, carry, sectionText, sectionIndex, sectionCount, isLast } = slide;
  const isTraining = String(row.ContentType || '').toLowerCase() === 'training';
  const st = String(row.Status || 'Open').toLowerCase();
  const cat = meetingCategoryMeta(row.Category);
  const priority = String(row.Priority || 'ปกติ');
  const completionLabel = isTraining ? 'Training แล้ว' : 'คุยแล้ว';
  const photos = slide.photos || [];
  const actions = [];
  if (isLast && state.meetingCanCreate && st === 'open') actions.push(`<button class="mtg-tv-action mtg-tv-action-primary" data-mtg-status="Discussed" data-mtg-id="${escapeAttr(row.PostID)}">✓ ${completionLabel} — ไปหัวข้อถัดไป</button>`);
  if (isLast && state.meetingCanCreate && st === 'discussed') actions.push(`<button class="mtg-tv-action" data-mtg-status="Closed" data-mtg-id="${escapeAttr(row.PostID)}">${isTraining ? 'ปิด Training' : 'จบเรื่อง'}</button>`);
  let mid;
  if (slide.isPpt) {
    mid = `<div class="mtg-tv-photo-hint">🔍 คลิกรูปเพื่อขยาย แล้วใช้ + / − เพื่อซูม</div><div class="mtg-tv-ppt"><img src="${escapeAttr(driveThumbnailUrl_(slide.pptUrl, 1600))}" data-photo-url="${escapeAttr(slide.pptUrl)}" alt="สไลด์ PPT ${slide.pptPage}" loading="lazy"></div>`;
  } else if (slide.isDoc) {
    const fileId = meetingDriveFileId(slide.docUrl);
    const previewUrl = fileId ? `https://drive.google.com/file/d/${fileId}/preview` : slide.docUrl;
    mid = `<div class="mtg-tv-embed"><iframe src="${escapeAttr(previewUrl)}" loading="lazy" allowfullscreen></iframe></div>
      <div class="mtg-tv-embed-hint">📊 ${escapeHtml(slide.docName)} · เลื่อนสไลด์ในตัวพรีวิว · <a href="${escapeAttr(slide.docUrl)}" target="_blank" rel="noopener">เปิดเต็มจอ ↗</a></div>`;
  } else {
    const photoNumbers = slide.photoNumbers || photos.map((_, i) => i + 1);
    if (slide.hasMediaMarkers) {
      const inlineParts = (slide.contentParts || []).map(part => part.type === 'photo'
        ? `<figure class="mtg-tv-inline-photo"><img src="${escapeAttr(driveThumbnailUrl_(part.url, 1200))}" data-photo-url="${escapeAttr(part.url)}" alt="รูปที่ ${part.number}" loading="lazy"><figcaption>รูปที่ ${part.number}</figcaption></figure>`
        : part.type === 'video' ? meetingVideoPlayerHtml(part.url, part.fileName, 'mtg-tv-video') : escapeHtml(part.text)).join('');
      const hasInlinePhoto = (slide.contentParts || []).some(part => part.type === 'photo');
      const hasInlineVideo = (slide.contentParts || []).some(part => part.type === 'video');
      const loosePhotos = photos.length && !slide.hasPhotoMarkers
        ? `<div class="mtg-tv-photos">${photos.map((url, i) => `<figure class="mtg-tv-photo-item"><img src="${escapeAttr(driveThumbnailUrl_(url, 1000))}" data-photo-url="${escapeAttr(url)}" alt="รูปที่ ${photoNumbers[i]}" loading="lazy"><figcaption>รูปที่ ${photoNumbers[i]}</figcaption></figure>`).join('')}</div>`
        : '';
      mid = `${hasInlinePhoto ? '<div class="mtg-tv-photo-hint">🔍 รูปอยู่ตามตำแหน่งในเนื้อหา · คลิกรูปเพื่อขยายและซูม</div>' : ''}${hasInlineVideo ? '<div class="mtg-tv-video-hint">▶ วิดีโออยู่ในเนื้อหาหัวข้อนี้</div>' : ''}<div class="mtg-tv-detail mtg-tv-inline-content">${inlineParts}${loosePhotos}</div>`;
    } else {
      mid = `${sectionText ? `<div class="mtg-tv-detail">${escapeHtml(sectionText)}</div>` : ''}
        ${photos.length ? `<div class="mtg-tv-photo-hint">🔍 คลิกรูปเพื่อขยาย แล้วใช้ + / − เพื่อซูม</div><div class="mtg-tv-photos">${photos.map((u, i) => `<figure class="mtg-tv-photo-item"><img src="${escapeAttr(driveThumbnailUrl_(u, 1000))}" data-photo-url="${escapeAttr(u)}" alt="รูปที่ ${photoNumbers[i]}" loading="lazy"><figcaption>รูปที่ ${photoNumbers[i]}</figcaption></figure>`).join('')}</div>` : ''}`;
    }
  }
  return `<div class="mtg-tv-slide tv-anim-${meetingTvDir}">
      <div class="mtg-tv-chips">
        ${isMeetingPinned(row) ? '<span class="mtg-tv-chip">📌 ปักหมุด</span>' : ''}
        ${isTraining ? '<span class="mtg-tv-chip mtg-tv-training-chip">🎓 TRAINING</span>' : ''}
        ${slide.isUnassignedPhotos ? '<span class="mtg-tv-chip mtg-tv-sectionchip">⚠️ รูปที่ยังไม่ได้กำหนดจุด</span>' : ''}
        <span class="mtg-tv-chip mtg-tv-cat ${cat.cls}">${cat.icon} ${escapeHtml(row.Category || 'ทั่วไป')}</span>
        ${priority === 'ด่วน' ? '<span class="mtg-tv-chip mtg-tv-urgent">ด่วน</span>' : priority === 'สำคัญ' ? '<span class="mtg-tv-chip mtg-tv-important">สำคัญ</span>' : ''}
        ${carry ? `<span class="mtg-tv-chip mtg-tv-carrychip">⏳ ค้างจาก ${formatDate(row.MeetingDate)}</span>` : ''}
        ${slide.isPpt ? `<span class="mtg-tv-chip mtg-tv-sectionchip">📊 PPT ${slide.pptPage}/${slide.pptTotal}</span>` : ''}
        ${slide.isDoc ? '<span class="mtg-tv-chip mtg-tv-sectionchip">📊 สไลด์ PPT</span>' : ''}
        ${sectionCount > 1 ? `<span class="mtg-tv-chip mtg-tv-sectionchip">สไลด์ ${sectionIndex + 1}/${sectionCount}</span>` : ''}
        ${st !== 'open' ? `<span class="mtg-tv-chip mtg-tv-donechip">${st === 'closed' ? (isTraining ? '✔ ปิด Training' : '✔ จบเรื่อง') : `✓ ${completionLabel}`}</span>` : ''}
      </div>
      <div class="mtg-tv-topic">${escapeHtml(row.Topic || '-')}</div>
      ${mid}
      ${!isLast ? '<div class="mtg-tv-slide-more">มีต่อสไลด์ถัดไป →</div>' : `
      <div class="mtg-tv-slide-meta">📅 ${formatDate(row.MeetingDate)}${row.Shift ? ' · กะ ' + escapeHtml(row.Shift) : ''} · 🏭 ${escapeHtml(row.LineName || row.LineID || 'ทุกไลน์')} · ✍️ ลงโดย ${escapeHtml(row.CreatedByName || '-')}${row.DiscussedBy ? ' · ✓ คุยแล้วโดย ' + escapeHtml(row.DiscussedBy) : ''}${row.AckRequiredCount ? ` · 🙋 รับทราบ ${row.AckedCount}/${row.AckRequiredCount}` : ''}${row.PostID ? ' · ' + escapeHtml(row.PostID) : ''}</div>
      ${row.AckRequiredCount && (row.AckPendingNames || []).length ? `<div class="mtg-tv-slide-meta mtg-tv-ack-pending">⏳ ยังไม่รับทราบ: ${escapeHtml(row.AckPendingNames.join(', '))}</div>` : ''}
      ${actions.length ? `<div class="mtg-tv-actions">${actions.join('')}</div>` : ''}`}
    </div>`;
}

function renderMeetingTv() {
  const container = $('#meetingTv');
  const deck = meetingTvDeck();
  const postSlides = meetingTvPostSlides();
  const auxiliarySlides = meetingTvAuxiliarySlides();
  const total = postSlides.length + auxiliarySlides.length;
  const index = Math.max(0, Math.min(state.meetingTvIndex, total));
  state.meetingTvIndex = index;
  // Progress counts topics discussed, not slides, so a multi-slide topic counts once.
  const discussed = deck.filter(item => meetingTvStatusDone(item.row)).length;
  // Derive per-topic first-slide index and slide count from the flat list, so
  // extra slides (PPT embed) are counted correctly.
  const firstSlideByDeck = [];
  const slideCountByDeck = [];
  postSlides.forEach((s, i) => {
    if (firstSlideByDeck[s.deckPos] === undefined) firstSlideByDeck[s.deckPos] = i + 1;
    slideCountByDeck[s.deckPos] = (slideCountByDeck[s.deckPos] || 0) + 1;
  });
  const dateLabel = formatDate($('#meetingDate').value || localDateInput(new Date()));
  let body = '';
  if (index === 0) {
    body = `<div class="mtg-tv-agenda tv-anim-${meetingTvDir}">
      <p class="mtg-tv-eyebrow">MORNING MEETING · ${escapeHtml(dateLabel)}</p>
      <h1 class="mtg-tv-title">หัวข้อประชุมวันนี้</h1>
      <ol class="mtg-tv-list">${deck.map((item, i) => {
        const done = meetingTvStatusDone(item.row);
        const cat = meetingCategoryMeta(item.row.Category);
        const priority = String(item.row.Priority || 'ปกติ');
        const slideCount = slideCountByDeck[i] || 1;
        const isTraining = String(item.row.ContentType || '').toLowerCase() === 'training';
        const sub = [isTraining ? '🎓 Training' : '📣 Meeting', item.row.LineName || item.row.LineID || 'ทุกไลน์', item.row.Category || 'ทั่วไป', `ลงโดย ${item.row.CreatedByName || '-'}`].join(' · ');
        return `<li style="animation-delay:${Math.min(i * 70, 700)}ms" class="mtg-tv-li"><button class="mtg-tv-item${done ? ' done' : ''}" data-tv-goto="${firstSlideByDeck[i]}">
          <span class="mtg-tv-item-icon">${done ? '✅' : (isTraining ? '🎓' : cat.icon)}</span>
          <span class="mtg-tv-item-text">${escapeHtml(item.row.Topic || '-')}<span class="mtg-tv-item-line">${escapeHtml(sub)}</span></span>
          ${slideCount > 1 ? `<span class="mtg-tv-chip mtg-tv-sectionchip">${slideCount} สไลด์</span>` : ''}
          ${priority === 'ด่วน' ? '<span class="mtg-tv-chip mtg-tv-urgent">ด่วน</span>' : priority === 'สำคัญ' ? '<span class="mtg-tv-chip mtg-tv-important">สำคัญ</span>' : ''}
          ${item.carry ? '<span class="mtg-tv-item-carry">⏳ ค้าง</span>' : ''}
        </button></li>`;
      }).join('')}${auxiliarySlides.map((slide, i) => {
        const delay = Math.min((deck.length + i) * 70, 700);
        const target = postSlides.length + i + 1;
        if (slide.type === 'quiz') {
          const examType = slide.dailyQuiz?.isTraining ? 'Training' : 'Meeting';
          const quiz = slide.dailyQuiz?.quiz || {};
          const subtitle = quiz.available
            ? `สแกนเพื่อทำข้อสอบ ${examType} · ${slide.dailyQuiz?.post?.Topic || quiz.sourceTitle || 'วันนี้'}`
            : quiz.hasDraft ? `มีฉบับร่าง ${examType} · Admin/Engineer ตรวจและเผยแพร่`
              : slide.dailyQuiz?.canGenerate && slide.dailyQuiz?.hasSlides ? `Admin/Engineer แตะเพื่อ Gen ข้อสอบ ${examType}`
                : slide.dailyQuiz?.canGenerate ? 'เพิ่มรายละเอียดหรือสไลด์ก่อน Gen ข้อสอบ'
                  : slide.dailyQuiz?.post ? `รอ Admin/Engineer สร้างและเผยแพร่ข้อสอบ ${examType}` : 'ยังไม่มีข้อสอบเผยแพร่สำหรับวันที่นี้';
          return `<li style="animation-delay:${delay}ms" class="mtg-tv-li"><button class="mtg-tv-item mtg-tv-item-quiz" data-tv-goto="${target}">
          <span class="mtg-tv-item-icon">📱</span>
          <span class="mtg-tv-item-text">QR Code ข้อสอบ ${examType}<span class="mtg-tv-item-line">${escapeHtml(subtitle)}</span></span>
        </button></li>`;
        }
        if (slide.type === 'quizStatus') {
          const sessions = slide.dailyQuiz?.quiz?.shiftSessions || [];
          const perShift = sessions.map(session => `${session.label || session.shift}: ส่ง ${Number(session.submittedCount || 0)}/${Number(session.startedCount ?? session.participantCount ?? 0)}`).join(' · ');
          return `<li style="animation-delay:${delay}ms" class="mtg-tv-li"><button class="mtg-tv-item mtg-tv-item-quiz-status" data-tv-goto="${target}">
          <span class="mtg-tv-item-icon">📊</span>
          <span class="mtg-tv-item-text">สถานะข้อสอบ ${slide.dailyQuiz?.isTraining ? 'Training' : 'Meeting'}<span class="mtg-tv-item-line">${escapeHtml(perShift || 'ยังไม่มีผู้เริ่มสอบ')} · แสดงผลแยกตามกะ</span></span>
        </button></li>`;
        }
        return `<li style="animation-delay:${delay}ms" class="mtg-tv-li"><button class="mtg-tv-item mtg-tv-item-finding" data-tv-goto="${target}">
          <span class="mtg-tv-item-icon">📢</span>
          <span class="mtg-tv-item-text">Finding จากการตรวจ LPA<span class="mtg-tv-item-line">วันนี้ ${(state.meetingFindingDigest?.today?.totalCount) || 0} รายการ · เมื่อวาน ${(state.meetingFindingDigest?.yesterday?.totalCount) || 0} รายการ</span></span>
        </button></li>`;
      }).join('')}</ol>
    </div>`;
  } else if (index > postSlides.length) {
    const auxiliarySlide = auxiliarySlides[index - postSlides.length - 1];
    body = auxiliarySlide?.type === 'quiz'
      ? meetingTvQuizSlideHtml(auxiliarySlide.dailyQuiz)
      : auxiliarySlide?.type === 'quizStatus'
        ? meetingTvQuizStatusSlideHtml(auxiliarySlide.dailyQuiz)
        : meetingTvFindingSlideHtml();
  } else {
    body = meetingTvPostSlideHtml(postSlides[index - 1]);
  }
  const topicTotal = deck.length;
  container.innerHTML = `
    <div class="mtg-tv-top">
      <span class="mtg-tv-brand">📣 Meeting ก่อนเข้างาน · 🎓 Training</span>
      <span class="mtg-tv-progress${topicTotal && discussed >= topicTotal ? ' all-done' : ''}">คุย/Training แล้ว ${discussed}/${topicTotal} หัวข้อ</span>
      <button class="mtg-tv-close" id="meetingTvClose" aria-label="ปิดโหมด TV">✕ ปิด</button>
    </div>
    <div class="mtg-tv-body">${body}</div>
    <div class="mtg-tv-nav">
      <button class="mtg-tv-navbtn" id="meetingTvPrev" ${index === 0 ? 'disabled' : ''}>‹ ก่อนหน้า</button>
      <span class="mtg-tv-counter">${index === 0 ? 'สารบัญ' : `${index} / ${total}`}</span>
      <button class="mtg-tv-navbtn" id="meetingTvNext" ${index >= total ? 'disabled' : ''}>ถัดไป ›</button>
    </div>`;
  $('#meetingTvClose').addEventListener('click', closeMeetingTv);
  $('#meetingTvPrev').addEventListener('click', () => meetingTvStep(-1));
  $('#meetingTvNext').addEventListener('click', () => meetingTvStep(1));
  $$('[data-tv-goto]', container).forEach(btn => btn.addEventListener('click', () => {
    meetingTvDir = 'next';
    state.meetingTvIndex = Number(btn.dataset.tvGoto);
    renderMeetingTv();
  }));
  $$('[data-tv-quiz-generate]', container).forEach(btn =>
    btn.addEventListener('click', () => generateMeetingQuizFromTv(btn)));
  $$('[data-tv-quiz-draft]', container).forEach(btn =>
    btn.addEventListener('click', () => openMeetingQuizDraftFromTv(btn)));
  if (!container.dataset.tvQuizStopBound) {
    container.addEventListener('click', event => {
      const stopButton = event.target?.closest?.('[data-tv-quiz-stop]');
      const retakeButton = event.target?.closest?.('[data-tv-quiz-retake]');
      if (stopButton && container.contains(stopButton)) stopMeetingQuizFromTv(stopButton);
      else if (retakeButton && container.contains(retakeButton)) startNewMeetingQuizRoundFromTv(retakeButton);
    });
    container.dataset.tvQuizStopBound = 'true';
  }
  $$('[data-mtg-status]', container).forEach(btn =>
    btn.addEventListener('click', () => setMeetingPostStatus(btn, btn.dataset.mtgId, btn.dataset.mtgStatus, true)));
}

async function stopMeetingQuizFromTv(button) {
  if (!button || button.disabled) return;
  const postId = button.dataset.tvQuizPost;
  const dailyQuiz = meetingTvDailyQuizzes().find(item => String(item.post?.PostID || '') === String(postId || ''));
  const shift = button.dataset.tvQuizStop;
  if (!postId || !shift) return;
  const label = dailyQuiz?.quiz?.shiftSessions?.find(session => String(session.shift) === String(shift))?.label || shift;
  const stoppingSession = dailyQuiz?.quiz?.shiftSessions?.find(session => String(session.shift) === String(shift));
  const nonSubmitCount = Math.max(0, Number(stoppingSession?.registeredCount || 0) - Number(stoppingSession?.submittedCount || 0));
  const confirmed = await showConfirm({
    title: `หยุดสอบ${label}?`,
    message: `หลังหยุดสอบ ระบบจะแสดง 3 อันดับแรกจากผู้ที่ส่งแล้วทันที และไม่รับคำตอบเพิ่ม${nonSubmitCount ? ` · ผู้ที่ยังไม่ส่ง ${nonSubmitCount} คนจะไม่ถูกนำมาจัดอันดับ` : ''}`,
    confirmText: 'หยุดสอบและประกาศอันดับ', tone: 'primary'
  });
  if (!confirmed) return;
  button.disabled = true;
  try {
    const stopped = await apiCall('stopMeetingQuizShift', { postId, shift });
    await showMeetingQuizWinners(label, stopped.topThree || []);
    await loadMeetingBoard();
    showToast(`หยุดสอบ${label}แล้ว · แสดงอันดับ 1–3`, 'success');
  } catch (error) {
    button.disabled = false;
    showToast(error.message, 'error');
  }
}

async function startNewMeetingQuizRoundFromTv(button) {
  if (!button || button.disabled) return;
  const postId = button.dataset.tvQuizPost;
  const shift = button.dataset.tvQuizRetake;
  const dailyQuiz = meetingTvDailyQuizzes().find(item => String(item.post?.PostID || '') === String(postId || ''));
  const session = dailyQuiz?.quiz?.shiftSessions?.find(item => String(item.shift) === String(shift));
  if (!postId || !shift || !session?.examStopped) return;
  const label = session.label || shift;
  const nextAttemptNo = Number(session.attemptNo || 1) + 1;
  const confirmed = await showConfirm({
    title: `เปิดสอบ${label}รอบใหม่?`,
    message: `เปิดให้ลงชื่อและทำข้อสอบ ${label} รอบ ${nextAttemptNo} · คะแนนและอันดับรอบ ${session.attemptNo || 1} จะเก็บไว้แยกเหมือนเดิม`,
    confirmText: 'เปิดสอบรอบใหม่', tone: 'primary'
  });
  if (!confirmed) return;
  button.disabled = true;
  try {
    await apiCall('startNewMeetingQuizShiftRound', { postId, shift });
    await loadMeetingBoard();
    await refreshMeetingQuizBoardStatus();
    refreshMeetingTvQuizStatus();
    showToast(`เปิดสอบ${label}รอบ ${nextAttemptNo} แล้ว`, 'success');
  } catch (error) {
    button.disabled = false;
    showToast(error.message, 'error');
  }
}

async function openMeetingQuizDraftFromTv(button) {
  const postId = button.dataset.tvQuizDraft;
  if (!postId) return;
  closeMeetingTv();
  await openMeetingQuizAdmin(postId);
}

async function generateMeetingQuizFromTv(button) {
  const postId = button.dataset.tvQuizGenerate;
  if (!postId || button.disabled) return;
  button.disabled = true;
  button.textContent = 'กำลังวิเคราะห์เนื้อหาและสร้างข้อสอบ…';
  try {
    await apiCall('generateMeetingQuiz', { postId }, { priority: 'high' });
    const selectedPost = state.meetingPosts.find(row => String(row.PostID) === String(postId));
    const meetingDate = String(selectedPost?.MeetingDate || '').slice(0, 10);
    const isTraining = String(selectedPost?.ContentType || '').toLowerCase() === 'training';
    if (isTraining && selectedPost) {
      selectedPost.TrainingQuiz = Object.assign({}, selectedPost.TrainingQuiz || {}, { available: false, hasDraft: true });
    } else {
      state.meetingPosts.forEach(row => {
        if (String(row.MeetingDate || '').slice(0, 10) !== meetingDate || String(row.ContentType || '').toLowerCase() === 'training') return;
        row.MeetingQuiz = Object.assign({}, row.MeetingQuiz || {}, { available: false, hasDraft: true });
      });
    }
    closeMeetingTv();
    showToast('สร้างข้อสอบฉบับร่างแล้ว กำลังเปิดหน้าตรวจแก้และเผยแพร่', 'success');
    await openMeetingQuizAdmin(postId);
  } catch (error) {
    button.disabled = false;
    button.textContent = '✨ Gen ข้อสอบ 5 ข้ออัตโนมัติ';
    showToast(error.message, 'error');
  }
}

// quiet: refresh in place — no overlay, no skeleton, keep the current cards on
// screen until the new ones arrive. Used after a write, where the list is already
// correct and this call only reconciles it.
async function loadFindings(force = false, quiet = false) {
  const payload = {
    lineId: optionalFilterValue($('#findingLine').value), stationId: optionalFilterValue($('#findingStation').value),
    category: optionalFilterValue($('#findingCategory').value), status: optionalFilterValue($('#findingStatus').value),
    picUserId: optionalFilterValue($('#findingPicName').value),
    periodMonth: monthToPeriod($('#findingMonth').value),
    myFindings: optionalFilterValue($('#findingMine').value),
    overdueOnly: $('#findingOverdue').checked
  };
  Object.keys(payload).forEach(key => { if (payload[key] === '' || payload[key] === false) delete payload[key]; });
  payload.limit = 300;
  const cacheKey = JSON.stringify(payload);
  const CACHE_TTL = 5 * 60 * 1000;
  if (!force && state.findingsCache && state.findingsCache.key === cacheKey &&
      Date.now() - state.findingsCache.ts < CACHE_TTL) {
    state.findings = state.findingsCache.data;
    state.findingsTotal = state.findingsCache.total ?? state.findings.length;
    state.findingsQuery = payload;
    renderFindings();
    return;
  }
  if (!quiet) {
    $('#findingsList').innerHTML = Array.from({length: 4}, () => '<article class="finding-card skeleton-card" style="min-height:110px"></article>').join('');
    showLoading('กำลังโหลด Finding...');
  }
  try {
    const data = await apiCall('getFindings', payload, quiet ? { priority: 'normal', quiet: true } : {});
    state.findings = Array.isArray(data.findings) ? data.findings : [];
    state.findingsTotal = number(data.total ?? state.findings.length);
    state.findingsQuery = payload;
    state.findingsCache = { key: cacheKey, data: state.findings, total: state.findingsTotal, ts: Date.now() };
    renderFindings();
  } catch (error) {
    // A failed background reconcile leaves the optimistic row in place; the next
    // manual search corrects it. Only a foreground load is worth a toast.
    if (!quiet) showToast(error.message, 'error');
    else console.warn('quiet finding refresh failed:', error.message || error);
  } finally {
    if (!quiet) hideLoading();
  }
}

async function loadMoreFindings(button) {
  if (!state.findingsQuery) return;
  button.disabled = true;
  button.textContent = 'กำลังโหลด...';
  try {
    const payload = { ...state.findingsQuery, offset: state.findings.length };
    const data = await apiCall('getFindings', payload);
    state.findings = state.findings.concat(Array.isArray(data.findings) ? data.findings : []);
    state.findingsTotal = number(data.total ?? state.findingsTotal);
    if (state.findingsCache) {
      state.findingsCache.data = state.findings;
      state.findingsCache.total = state.findingsTotal;
    }
    renderFindings();
  } catch (error) {
    showToast(error.message, 'error');
    renderFindings();
  }
}

function renderFindings() {
  const container = $('#findingsList');
  if (!state.findings.length) return container.innerHTML = emptyHtml('ไม่พบ Finding ตามเงื่อนไข');
  container.innerHTML = state.findings.map(findingCardHtml).join('');
  const hasMore = number(state.findingsTotal) > state.findings.length;
  if (hasMore) {
    container.innerHTML += `<div style="text-align:center;padding:12px"><button class="btn btn-outline" id="loadMoreFindingsBtn">โหลดเพิ่ม (แสดง ${state.findings.length} จาก ${number(state.findingsTotal)})</button></div>`;
    $('#loadMoreFindingsBtn').addEventListener('click', event => loadMoreFindings(event.target));
  }
  $$('[data-edit-finding]', container).forEach(button => button.addEventListener('click', () => openFindingEditor(button.dataset.editFinding)));
}

// Card layout tuned for readability at a distance — this list doubles as the
// slide shown on-screen during the Leader's morning meeting, so the problem
// text and status are the visual headline, everything else is secondary.
function severityClass(severity) {
  const value = String(severity || '').toLowerCase();
  if (value === 'critical') return 'sev-critical';
  if (value === 'major' || value === 'high') return 'sev-high';
  if (value === 'medium') return 'sev-medium';
  return 'sev-minor';
}

function findingCardHtml(row) {
  const overdue = String(row.OverdueFlag).toLowerCase() === 'yes';
  const statusLabel = overdue ? `เกิน Due ${number(row.DaysOverdue)} วัน` : (row.Status || '-');
  const statusCls = overdue ? 'status-overdue' : statusClass(row.Status);
  const sevCls = severityClass(row.Severity || row.Priority);
  const sevLabel = row.Severity || row.Priority || '-';
  const sibling = findingSiblingInfo(row);
  const siblingLabel = sibling ? ` · ปัญหาที่ ${sibling.pos}/${sibling.total} จากจุดตรวจนี้` : '';
  return `<article class="finding-card ${sevCls}${overdue ? ' overdue' : ''}">
    <div class="finding-head">
      <div class="finding-head-left">
        <span class="finding-id">${escapeHtml(row.FindingID)}</span>
        <span class="finding-meta-line">${formatDate(row.FoundDate)} · ${escapeHtml(row.LineName || row.LineID || '-')} / ${escapeHtml(row.StationName || row.StationID || '-')} · ${escapeHtml(row.Category || '-')}${escapeHtml(siblingLabel)}</span>
      </div>
      <div class="finding-head-right">
        <span class="severity-chip ${sevCls}">${escapeHtml(sevLabel)}</span>
        <span class="status-badge ${statusCls}">${escapeHtml(statusLabel)}</span>
      </div>
    </div>
    <div class="finding-problem">${escapeHtml(row.ProblemDetail || '-')}</div>
    <div class="finding-meta-grid">
      <div><span class="data-label">เปิดโดย</span>${escapeHtml(row.AuditorName || row.CreatedByName || '-')}<span class="table-subtext">${escapeHtml(row.AuditorRole || '')}</span></div>
      <div><span class="data-label">รับผิดชอบโดย</span>${escapeHtml(formatFindingAssignment(row))}<span class="table-subtext">${escapeHtml(formatFindingAssignmentMode(row))}</span></div>
      <div><span class="data-label">Due Date</span>${formatDate(row.DueDate)}</div>
    </div>
    ${row.CorrectiveAction ? `<div class="finding-corrective"><span class="data-label">แนวทางแก้ไข</span>${escapeHtml(row.CorrectiveAction)}</div>` : ''}
    ${findingPhotoGallery(row)}
    <div class="finding-actions"><button class="btn btn-outline" data-edit-finding="${escapeAttr(row.FindingID)}">เปิด Finding</button></div>
  </article>`;
}

// A checklist item with multiple problems now splits into multiple Findings
// sharing one RecordID — this tells the responder which one of the set they're
// looking at, so they don't confuse their answer with a sibling problem's.
function findingSiblingInfo(row) {
  if (!row.RecordID) return null;
  const siblings = state.findings.filter(f => f.RecordID === row.RecordID)
    .sort((a, b) => String(a.FindingID).localeCompare(String(b.FindingID)));
  if (siblings.length <= 1) return null;
  const pos = siblings.findIndex(f => f.FindingID === row.FindingID) + 1;
  return { pos, total: siblings.length };
}

function openFindingEditor(findingId) {
  const row = state.findings.find(item => item.FindingID === findingId);
  if (!row) return;
  state.editingFinding = row;
  $('#findingDialogTitle').textContent = `${row.FindingID} · ${row.ProblemDetail || ''}`;
  const sibling = findingSiblingInfo(row);
  const siblingNote = $('#findingSiblingNote');
  if (siblingNote) {
    if (sibling) {
      siblingNote.textContent = `📌 ปัญหาที่ ${sibling.pos} จาก ${sibling.total} ข้อ ที่พบในจุดตรวจเดียวกัน — ตอบเฉพาะปัญหานี้`;
      siblingNote.classList.remove('hidden');
    } else {
      siblingNote.classList.add('hidden');
    }
  }
  $('#editFindingId').value = row.FindingID;
  renderViewOnlyPhotoGallery('#viewBeforePhoto', row.BeforePhotoURL);
  $('#editRootCause').value = row.RootCause || '';
  const _5m1eKey = classify5m1e(row);
  const _5m1eLabel = (_5m1eKey && (M1E_CATEGORIES.find(c => c.key === _5m1eKey) || {}).label) || 'ยังไม่ระบุ';
  const _badge = $('#editRootCauseCategory');
  if (_badge) { _badge.textContent = _5m1eLabel; _badge.style.background = _5m1eKey ? (M1E_CATEGORIES.find(c => c.key === _5m1eKey) || {}).color || '#888' : '#aaa'; }
  const _hiddenCat = $('#editRootCauseCategoryVal');
  if (_hiddenCat) _hiddenCat.value = _5m1eKey;
  $('#editCorrectiveAction').value = row.CorrectiveAction || '';
  $('#editStatus').value = row.Status || 'Open';
  $('#editStatus').closest('label').classList.toggle('hidden', ['Leader', 'User'].includes(state.user.Role));
  $('#editActionRemark').value = row.ActionRemark || '';
  resetFindingReasonField('#editCloseReasonSelect', '#editCloseRemark', '#editCloseRemarkNoteField');
  resetFindingReasonField('#editRejectReasonSelect', '#editRejectReason', '#editRejectReasonNoteField');
  $('#editAfterPhoto').value = '';
  state.findingPhotoRemovals = new Set();
  renderFindingPhotoPreview();
  const status = String(row.Status || '').toLowerCase();
  const pending = status === 'pending verification';
  const canVerify = pending && hasPermission('findings.verify');
  const assignedToMe = isFindingAssignedToCurrentUser(row);
  const isLeaderOrUser = ['Leader', 'User'].includes(state.user.Role);
  const isAssignedFollowUpUser = isLeaderOrUser && assignedToMe;
  const canUpdate = status !== 'closed' && (hasPermission('findings.view.all') || hasPermission('findings.update.line') ||
    (assignedToMe && hasPermission('findings.update.assigned')));
  const canEditFollowUp = canUpdate && !pending;
  const canSubmit = canEditFollowUp && status !== 'closed';
  const severity = String(row.Severity || row.Priority || 'Minor').toLowerCase();
  const closePermission = severity === 'critical' ? 'findings.close.critical' : severity === 'major' ? 'findings.close.major' : 'findings.close.minor';
  const rejected = status === 'rejected' && Boolean(row.RejectReason);
  const rejectedByUser = (state.masterData.users || []).find(user => String(user.UserID) === String(row.RejectedBy || ''));
  $('#rejectionHistory').classList.toggle('hidden', !rejected);
  $('#rejectionReasonDisplay').textContent = row.RejectReason || '-';
  $('#rejectedByDisplay').textContent = rejectedByUser ? (rejectedByUser.FullName || rejectedByUser.Username) : (row.RejectedBy || '-');
  $('#rejectedAtDisplay').textContent = row.RejectedAt || '-';
  $('#assignedFindingHelp').classList.toggle('hidden', !isAssignedFollowUpUser || !canSubmit);
  $('#verifierFindingHelp').classList.toggle('hidden', !canVerify || isLeaderOrUser);
  $('#editCloseRemarkField').classList.toggle('hidden', !canVerify || isLeaderOrUser);
  $('#editRejectReasonField').classList.toggle('hidden', !canVerify || isLeaderOrUser);
  if (!canVerify || isLeaderOrUser) {
    $('#editCloseRemarkNoteField').classList.add('hidden');
    $('#editRejectReasonNoteField').classList.add('hidden');
  }
  $('#approveFindingButton').classList.toggle('hidden', isLeaderOrUser || !canVerify || !hasPermission(closePermission));
  $('#rejectFindingButton').classList.toggle('hidden', isLeaderOrUser || !canVerify);
  $('#submitVerificationButton').classList.toggle('hidden', !canSubmit);
  $('#editRootCause').disabled = !canEditFollowUp;
  $('#editCorrectiveAction').disabled = !canEditFollowUp;
  $('#editActionRemark').disabled = !canEditFollowUp;
  $('#editCloseReasonSelect').disabled = !canVerify;
  $('#editRejectReasonSelect').disabled = !canVerify;
  $('#editCloseRemark').disabled = !canVerify;
  $('#editRejectReason').disabled = !canVerify;
  $('#editAfterPhotoField').classList.toggle('hidden', !canEditFollowUp);
  $('#editAfterPhoto').disabled = !canEditFollowUp;

  // Reassign section — Supervisor, Manager, Engineer, Admin only
  const canReassign = ['Supervisor', 'Manager', 'Engineer', 'Admin'].includes(state.user.Role) && status !== 'closed';
  const isReassignManager = state.user.Role === 'Manager';
  const isReassignMultiUser = isReassignManager || state.user.Role === 'Supervisor';
  const reassignRoleField = $('#reassignRoleField');
  const reassignRoleCheckboxField = $('#reassignRoleCheckboxField');
  const reassignUserField = $('#reassignUserField');
  const reassignUserCheckboxField = $('#reassignUserCheckboxField');
  const reassignDisplayField = $('#reassignDisplayField');
  reassignRoleField.classList.add('hidden');
  reassignRoleCheckboxField.classList.add('hidden');
  reassignUserField.classList.add('hidden');
  reassignUserCheckboxField.classList.add('hidden');
  reassignDisplayField.classList.add('hidden');
  $('#reassignUserId').value = '';
  $('#reassignUserName').value = '';
  $('#reassignMode').value = '';
  if (canReassign) {
    if (isReassignManager) {
      reassignRoleCheckboxField.classList.remove('hidden');
      const group = $('#reassignRoleCheckboxGroup');
      group.innerHTML = assignableRoles().map(r => `<label class="checkbox-item"><input type="checkbox" value="${escapeAttr(r)}" data-reassign-role-checkbox> ${escapeHtml(r)}</label>`).join('');
      wireCheckboxChips(group);
      $$('[data-reassign-role-checkbox]', group).forEach(cb => cb.addEventListener('change', () => {
        const checked = $$('[data-reassign-role-checkbox]:checked', group).map(c => c.value);
        renderReassignUserPicker(checked);
      }));
    } else {
      reassignRoleField.classList.remove('hidden');
      const roleSelect = $('#reassignRole');
      roleSelect.innerHTML = `<option value="">-- ไม่เปลี่ยน --</option>` +
        assignableRoles().map(r => `<option value="${escapeAttr(r)}">${escapeHtml(r)}</option>`).join('');
      roleSelect.value = '';
      roleSelect.onchange = () => {
        if (isReassignMultiUser) {
          renderReassignUserPicker(roleSelect.value ? [roleSelect.value] : []);
        } else {
          onReassignRoleChange();
        }
      };
    }
    $('#reassignUserSelect').onchange = () => onReassignUserChange();
  }

  $('#findingDialog').showModal();
}

function getReassignSelectedRoles() {
  const checkboxes = $$('[data-reassign-role-checkbox]:checked');
  if (checkboxes.length) return checkboxes.map(cb => cb.value);
  const select = $('#reassignRole');
  return select && select.value ? [select.value] : [];
}

function renderReassignUserPicker(roles) {
  const wrap = $('#reassignUserCheckboxField');
  const group = $('#reassignUserCheckboxGroup');
  const displayField = $('#reassignDisplayField');

  if (!roles.length) {
    wrap.classList.add('hidden');
    displayField.classList.add('hidden');
    group.innerHTML = '';
    $('#reassignUserId').value = '';
    $('#reassignUserName').value = '';
    $('#reassignMode').value = '';
    return;
  }

  const seen = new Set();
  const users = [];
  roles.forEach(role => {
    usersForRole(role).forEach(u => {
      if (!seen.has(u.UserID)) { seen.add(u.UserID); users.push(u); }
    });
  });

  if (!users.length) {
    wrap.classList.add('hidden');
    displayField.classList.remove('hidden');
    $('#reassignDisplay').value = roles.join(', ');
    $('#reassignUserId').value = '';
    $('#reassignUserName').value = '';
    $('#reassignMode').value = 'ROLE';
    return;
  }

  wrap.classList.remove('hidden');
  displayField.classList.remove('hidden');
  group.innerHTML = users.map(u => `<label class="checkbox-item"><input type="checkbox" value="${escapeAttr(u.UserID)}" data-reassign-user-checkbox checked> ${escapeHtml((u.FullName || u.Username) + (u.Username ? ' (' + u.Username + ')' : ''))}</label>`).join('');
  wireCheckboxChips(group);
  $$('[data-reassign-user-checkbox]', group).forEach(cb => cb.addEventListener('change', updateReassignMultiUserSelection));
  updateReassignMultiUserSelection();
}

function updateReassignMultiUserSelection() {
  const checkedBoxes = $$('[data-reassign-user-checkbox]:checked');
  if (!checkedBoxes.length) {
    $('#reassignDisplay').value = '';
    $('#reassignUserId').value = '';
    $('#reassignUserName').value = '';
    $('#reassignMode').value = 'ROLE';
    return;
  }
  const ids = checkedBoxes.map(cb => cb.value);
  const names = ids.map(id => {
    const u = (state.masterData.users || []).find(user => String(user.UserID) === String(id));
    return u ? (u.FullName || u.Username) : id;
  });
  $('#reassignUserId').value = ids.join(',');
  $('#reassignUserName').value = names.join(', ');
  $('#reassignDisplay').value = names.join(', ');
  $('#reassignMode').value = 'USER';
}

function onReassignRoleChange() {
  const role = $('#reassignRole').value;
  const userField = $('#reassignUserField');
  const displayField = $('#reassignDisplayField');
  $('#reassignUserId').value = '';
  $('#reassignUserName').value = '';
  $('#reassignMode').value = '';
  $('#reassignDisplay').value = '';

  if (!role) {
    userField.classList.add('hidden');
    displayField.classList.add('hidden');
    return;
  }

  const users = usersForRole(role);
  if (users.length === 0) {
    userField.classList.add('hidden');
    displayField.classList.remove('hidden');
    $('#reassignDisplay').value = role;
    $('#reassignMode').value = 'ROLE';
  } else if (users.length === 1) {
    userField.classList.add('hidden');
    displayField.classList.remove('hidden');
    const u = users[0];
    $('#reassignUserId').value = u.UserID;
    $('#reassignUserName').value = u.FullName || u.Username;
    $('#reassignDisplay').value = `${u.FullName || u.Username} (${role})`;
    $('#reassignMode').value = 'USER';
  } else {
    const sel = $('#reassignUserSelect');
    sel.innerHTML = `<option value="">-- เลือกชื่อ --</option>` +
      users.map(u => `<option value="${escapeAttr(u.UserID)}">${escapeHtml((u.FullName || u.Username) + (u.Username ? ' (' + u.Username + ')' : ''))}</option>`).join('');
    sel.value = '';
    userField.classList.remove('hidden');
    displayField.classList.remove('hidden');
    $('#reassignDisplay').value = role;
    $('#reassignMode').value = 'ROLE';
  }
}

function onReassignUserChange() {
  const role = $('#reassignRole').value;
  const userId = $('#reassignUserSelect').value;
  if (!userId) {
    $('#reassignUserId').value = '';
    $('#reassignUserName').value = '';
    $('#reassignDisplay').value = role;
    $('#reassignMode').value = 'ROLE';
    return;
  }
  const u = (state.masterData.users || []).find(user => String(user.UserID) === String(userId));
  if (u) {
    $('#reassignUserId').value = u.UserID;
    $('#reassignUserName').value = u.FullName || u.Username;
    $('#reassignDisplay').value = `${u.FullName || u.Username} (${role})`;
    $('#reassignMode').value = 'USER';
  }
}

function findingKeptExistingPhotos() {
  const removed = state.findingPhotoRemovals ? Array.from(state.findingPhotoRemovals) : [];
  return String(state.editingFinding?.AfterPhotoURL || '').split(',').map(u => u.trim()).filter(Boolean)
    .filter(u => !removed.includes(u));
}

async function submitFindingForVerification() {
  const findingId = $('#editFindingId').value;
  const rootCause = $('#editRootCause').value.trim();
  const correctiveAction = $('#editCorrectiveAction').value.trim();
  const hasPhoto = findingKeptExistingPhotos().length > 0 || $('#editAfterPhoto').files.length > 0;
  if (!rootCause || !correctiveAction || !hasPhoto) {
    return showToast('กรุณากรอก Root Cause, Corrective Action และแนบ After Photo อย่างน้อย 1 รูปให้ครบก่อนส่งตรวจยืนยัน', 'warning');
  }
  const confirmed = await showConfirm({
    title: 'ส่ง Finding ให้ตรวจยืนยัน?',
    message: `${findingId} จะถูกส่งให้ผู้ตรวจสอบยืนยันผลการแก้ไข`,
    confirmText: 'ส่งตรวจยืนยัน'
  });
  if (!confirmed) return;
  await runFindingWorkflow('submitFinding', {
    findingId, rootCause, correctiveAction,
    rootCauseCategory: ($('#editRootCauseCategoryVal') || {}).value || '',
    actionRemark: $('#editActionRemark').value.trim(),
    remark: $('#editActionRemark').value.trim() || 'Submitted for verification'
  }, {
    loadingMessage: 'กำลังส่ง Finding ให้ตรวจยืนยัน...',
    successMessage: 'ส่ง Finding เพื่อตรวจสอบแล้ว'
  });
}

async function verifyFinding(decision) {
  const findingId = $('#editFindingId').value;
  const isReject = decision === 'Reject';
  const selectField = isReject ? $('#editRejectReasonSelect') : $('#editCloseReasonSelect');
  const remarkField = isReject ? $('#editRejectReason') : $('#editCloseRemark');
  const verifierRemark = remarkField.value.trim();
  selectField.classList.remove('field-error');
  remarkField.classList.remove('field-error');
  if (!verifierRemark) {
    // Empty because nothing was picked yet -> flag the dropdown; empty
    // because "อื่นๆ" was picked but left blank -> flag the free-text field.
    const invalidField = selectField.value === FINDING_REASON_OTHER ? remarkField : selectField;
    invalidField.classList.add('field-error');
    invalidField.focus();
    const warning = isReject
      ? 'กรุณาเลือกหรือระบุเหตุผลการ Reject ก่อนส่งกลับให้ผู้รับผิดชอบแก้ไข'
      : 'กรุณาเลือกหรือระบุเหตุผลการปิด Finding ก่อนปิด Finding';
    return showToast(warning, 'warning');
  }
  const confirmed = await showConfirm(isReject ? {
    title: 'Reject Finding นี้?',
    message: `${findingId} จะถูกส่งกลับให้ผู้รับผิดชอบแก้ไขอีกครั้ง`,
    confirmText: 'Reject Finding',
    tone: 'danger'
  } : {
    title: 'ปิด Finding นี้?',
    message: `${findingId} จะถูกปิดและบันทึกเหตุผลการปิดไว้ในระบบ`,
    confirmText: 'Close Finding',
    tone: 'success'
  });
  if (!confirmed) return;
  await runFindingWorkflow('verifyFinding', {
    findingId, decision,
    rejectReason: decision === 'Reject' ? verifierRemark : '',
    closeRemark: decision === 'Approve' ? verifierRemark : ''
  }, {
    loadingMessage: decision === 'Approve' ? 'กำลังปิด Finding...' : 'กำลัง Reject Finding...',
    successMessage: decision === 'Approve' ? 'Close Finding สำเร็จ' : 'Reject Finding สำเร็จ ส่งกลับให้ผู้รับผิดชอบแก้ไขแล้ว'
  });
}

async function runFindingWorkflow(action, payload, options) {
  const settings = typeof options === 'string'
    ? { successMessage: options, loadingMessage: 'กำลังบันทึก Finding...' }
    : options;
  const actionBtns = $$('#findingDialog .modal-actions button');
  actionBtns.forEach(b => { b.disabled = true; });
  showLoading(settings.loadingMessage);
  try {
    const files = Array.from($('#editAfterPhoto').files || []);
    const keptExisting = findingKeptExistingPhotos();
    if (files.length) {
      // Fire the uploads together and let the API gate pace them. One at a time
      // meant three photos cost three full round trips back to back before the
      // write even started.
      let done = 0;
      const paint = () => {
        // Update the existing overlay's text in place rather than calling
        // showLoading again — that would push busyDepth past the single
        // hideLoading() in the finally block and leave the UI stuck busy.
        if (files.length > 1) $('#loadingText').textContent = `กำลังอัปโหลดรูปหลังแก้ไข ${done}/${files.length}...`;
      };
      paint();
      const uploadedUrls = await Promise.all(files.map(async file => {
        const upload = await uploadFile(file, 'Finding', payload.findingId, 'AfterPhoto', false);
        done++;
        paint();
        return upload.DriveFileURL;
      }));
      $('#loadingText').textContent = settings.loadingMessage;
      payload.afterPhotoUrl = keptExisting.concat(uploadedUrls).join(',');
    } else if (state.editingFinding) {
      payload.afterPhotoUrl = keptExisting.join(',');
    }
    // Attach reassign fields if set
    const reassignRoles = getReassignSelectedRoles();
    const reassignMode = $('#reassignMode') ? $('#reassignMode').value : '';
    if (reassignRoles.length) {
      if (reassignMode === 'USER') {
        payload.assignedToUserId = $('#reassignUserId').value;
      } else {
        payload.reassignRole = reassignRoles.join(',');
      }
    }
    const result = await apiCall(action, payload);
    $('#findingDialog').close();
    state.findingPhotoRemovals = new Set();
    state.findingsCache = null;
    state.leaderDashData = null;
    GASCache.invalidate('dashboard'); GASCache.invalidatePrefix('mgr_comp_'); GASCache.invalidatePrefix('dir_dash_');
    // The server hands back the row it just wrote, so the card on screen can be
    // corrected from that copy immediately. Re-reading the list and the dashboard
    // is reconciliation, not part of the action — awaiting them here held the
    // overlay through two more Apps Script round trips after the Finding was
    // already closed, which is exactly what looked like a hang.
    applyFindingUpdate(result && result.finding);
    showToast(settings.successMessage, 'success');
    refreshAfterFindingWrite();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    hideLoading();
    actionBtns.forEach(b => { b.disabled = false; });
  }
}

/** Patches one finding in the on-screen list from the server's own copy. */
function applyFindingUpdate(finding) {
  if (!finding || !finding.FindingID) return;
  const index = state.findings.findIndex(row => String(row.FindingID) === String(finding.FindingID));
  if (index === -1) return;
  state.findings[index] = { ...state.findings[index], ...finding };
  renderFindings();
}

/** Reconciles list, badges and dashboard after a Finding write, without holding
 *  the UI. The dashboard is only refetched when it is the page on screen —
 *  otherwise the invalidated cache makes navigating to it fetch fresh anyway. */
function refreshAfterFindingWrite() {
  // Deferred by a tick so the caller's finally block can drop the overlay first —
  // the notification poll stands down while the app is busy, and this refresh is
  // precisely the moment its badge count went stale.
  setTimeout(() => {
    loadFindings(true, true).catch(error => console.warn('finding refresh failed:', error.message || error));
    pollFindingNotifications(true);
    refreshDashboardIfVisible();
  }, 0);
}

/** Refetches the dashboard only when it is the page on screen. Its caches were
 *  invalidated by the write either way, so navigating to it still gets fresh
 *  data — spending round trips on a page nobody is looking at only starves the
 *  two-slot gate of capacity the user's next action needs. */
function refreshDashboardIfVisible() {
  const page = $('#page-dashboard');
  if (!page || !page.classList.contains('active-page')) return;
  Promise.resolve(loadDashboard()).catch(error => console.warn('dashboard refresh failed:', error.message || error));
}

async function closeFinding(payload) {
  return apiCall('closeFinding', payload);
}

async function loadMonthlyReport() {
  const periodMonth = monthToPeriod($('#reportMonth').value);
  if (!periodMonth) return showToast('กรุณาเลือกเดือน', 'warning');
  showLoading('กำลังโหลด Monthly Report...');
  try {
    state.report = await apiCall('getMonthlyReport', { periodMonth });
    renderMonthlyReport(state.report);
    $('#printReportButton').disabled = false;
    $('#exportCsvButton').disabled = false;
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    hideLoading();
  }
}

async function loadAuditPlan() {
  if (!hasPermission('audit.plan.view')) return;
  showLoading('กำลังโหลดกฎตารางตรวจ...');
  try {
    const today = localDateInput(new Date());
    const [rulesData, auditsData] = await Promise.all([
      apiCall('getAuditPlanRules', {
        lineId: optionalFilterValue($('#planLine').value),
        stationId: optionalFilterValue($('#planStation').value),
        requiredRole: optionalFilterValue($('#planRole').value),
        requiredUserId: '',
        frequency: optionalFilterValue($('#planFrequency').value),
        activeStatus: optionalFilterValue($('#planRuleStatus').value),
        limit: 300
      }),
      apiCall('getAuditList', { periodMonth: today.slice(0,7).replace('-',''), limit: 500 }).catch(() => ({ audits: [] }))
    ]);
    state.auditRules = rulesData.rules || [];
    state.todayAudits = auditsData.audits || [];
    renderAuditRules();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    hideLoading();
  }
}

function auditStatusForRule(rule, allAudits) {
  const freq = rule.Frequency || 'Daily';
  const lid = rule.LineID, sid = rule.StationID, role = (rule.RequiredRole || '').toLowerCase();
  const now = new Date();
  const today = localDateInput(now);

  const matches = allAudits.filter(a =>
    String(a.LineID) === lid &&
    String(a.StationID) === sid &&
    String(a.AuditLayer || '').toLowerCase() === role
  );

  if (freq === 'Daily') {
    const done = matches.some(a => String(a.AuditDate || '').slice(0, 10) === today);
    if (done) return 'done';
    return 'pending'; // pending all day, overdue after midnight
  }

  if (freq === 'Weekly') {
    const weekStart = (() => { const d = new Date(now); d.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1)); return localDateInput(d); })();
    const done = matches.some(a => String(a.AuditDate || '').slice(0, 10) >= weekStart && String(a.AuditDate || '').slice(0, 10) <= today);
    if (done) return 'done';
    return 'pending'; // during the week, never overdue — overdue only if whole week passed
  }

  if (freq === 'Monthly') {
    const dayOfMonth = Number(rule.DayOfMonth || 1);
    const monthStr = today.slice(0, 7);
    const done = matches.some(a => String(a.AuditDate || '').slice(0, 7) === monthStr);
    if (done) return 'done';
    if (now.getDate() > dayOfMonth) return 'overdue'; // due date passed
    return 'pending'; // due date not yet
  }
  return 'pending';
}

function renderAuditRules() {
  const container = $('#auditPlanTable');
  if (!state.auditRules.length) { container.innerHTML = emptyHtml('ไม่พบกฎตารางตรวจตามตัวกรอง'); return; }
  const canManage = hasPermission('audit.plan.manage');
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todayMap = {};
  (state.todayAudits || []).forEach(a => { todayMap[`${a.LineID}|${a.StationID}|${String(a.AuditLayer||'').toLowerCase()}`] = true; });

  // Build matrix: lineId → stationId → role → { rule, status }
  const lineOrder = [], lineMap = {}, roleSet = new Set(), roleFreq = {};
  const ROLE_ORDER = { Leader: 1, Supervisor: 2, Engineer: 3, Manager: 4 };
  state.auditRules.filter(r => String(r.ActiveStatus).toLowerCase() === 'active').forEach(rule => {
    const { LineID: lid, StationID: sid, RequiredRole: role } = rule;
    if (!lineMap[lid]) { lineMap[lid] = { name: rule.LineName || lid, stOrder: [], stMap: {} }; lineOrder.push(lid); }
    if (!lineMap[lid].stMap[sid]) { lineMap[lid].stMap[sid] = { name: rule.StationName || sid, cells: {} }; lineMap[lid].stOrder.push(sid); }
    roleSet.add(role);
    if (!roleFreq[role]) {
      const freq = rule.Frequency || 'Daily';
      const sub = freq === 'Daily' ? (rule.DayOfWeek || 'Working days') : freq === 'Weekly' ? (rule.DayOfWeek || 'ทุกวัน') : `วันที่ ${rule.DayOfMonth || '1'}`;
      roleFreq[role] = { freq, sub };
    }
    const status = auditStatusForRule(rule, state.todayAudits || []);
    lineMap[lid].stMap[sid].cells[role] = { rule, status };
  });
  const roles = Array.from(roleSet).sort((a, b) => (ROLE_ORDER[a] || 9) - (ROLE_ORDER[b] || 9));

  // Counters
  let totalOverdue = 0, totalDone = 0;
  lineOrder.forEach(lid => lineMap[lid].stOrder.forEach(sid => {
    roles.forEach(role => { const c = lineMap[lid].stMap[sid].cells[role]; if (!c) return; if (c.status === 'overdue') totalOverdue++; if (c.status === 'done') totalDone++; });
  }));

  // Filter bar
  const filterBar = `<div class="mx-bar"><div class="mx-filters">
    <button class="mx-btn active" data-mf="all">ทั้งหมด</button>
    <button class="mx-btn" data-mf="overdue">🔴 เกินกำหนด</button>
    <button class="mx-btn" data-mf="done">✅ ตรวจแล้ว</button>
  </div><div class="mx-counter"><span class="mx-cnt-ov">🔴 <strong>${totalOverdue}</strong> เกินกำหนด</span><span class="mx-cnt-ok">✅ <strong>${totalDone}</strong> ตรวจแล้ว</span></div></div>`;

  // Tables per line
  const headCols = roles.map(role => {
    const f = roleFreq[role] || {};
    return `<th><div class="mx-role">${escapeHtml(role)}</div><div class="mx-freq">${escapeHtml(f.freq||'')} / ${escapeHtml(f.sub||'')}</div></th>`;
  }).join('');

  const tables = lineOrder.map(lid => {
    const line = lineMap[lid];
    const rows = line.stOrder.map(sid => {
      const st = line.stMap[sid];
      let nOver = 0, nDone = 0, nCell = 0;
      const cells = roles.map(role => {
        const c = st.cells[role];
        if (!c) return `<td><span class="mx-badge mx-none">—</span></td>`;
        nCell++;
        if (c.status === 'done') nDone++;
        if (c.status === 'overdue') nOver++;
        const badge = c.status === 'done' ? `<span class="mx-badge mx-done">✅ ตรวจแล้ว</span>`
          : c.status === 'overdue' ? `<span class="mx-badge mx-ov">⏰ เกินกำหนด</span>`
          : `<span class="mx-badge mx-pend">รอตรวจ</span>`;
        const btns = canManage ? `<div class="mx-acts"><button class="btn btn-outline btn-compact" data-rule-id="${escapeAttr(c.rule.RuleID)}">แก้ไข</button><button class="btn btn-danger btn-compact" data-delete-rule-id="${escapeAttr(c.rule.RuleID)}" data-rule-label="${escapeAttr(`${c.rule.RequiredRole}/${c.rule.LineName||c.rule.LineID}/${c.rule.StationName||c.rule.StationID}`)}">ลบ</button></div>` : '';
        return `<td>${badge}${btns}</td>`;
      }).join('');
      return `<tr data-ov="${nOver}" data-done="${nDone}" data-cells="${nCell}"><td class="mx-st">${escapeHtml(st.name)}</td>${cells}</tr>`;
    }).join('');
    return `<div class="mx-line"><div class="mx-line-title">📊 ${escapeHtml(line.name)}</div><div class="table-wrap"><table class="data-table mx-table"><thead><tr><th>Station</th>${headCols}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }).join('');

  container.innerHTML = filterBar + tables;

  // Filter logic
  $$('.mx-btn', container).forEach(btn => btn.addEventListener('click', () => {
    $$('.mx-btn', container).forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const f = btn.dataset.mf;
    $$('.mx-line tbody tr', container).forEach(row => {
      const ov = +row.dataset.ov, done = +row.dataset.done, cells = +row.dataset.cells;
      row.style.display = (f === 'overdue' ? ov > 0 : f === 'done' ? done === cells && cells > 0 : true) ? '' : 'none';
    });
  }));

  // Edit/delete handlers
  $$('[data-rule-id]', container).forEach(btn => btn.addEventListener('click', () => {
    const rule = state.auditRules.find(r => r.RuleID === btn.dataset.ruleId);
    if (rule) openAuditRuleEditor(rule);
  }));
  $$('[data-delete-rule-id]', container).forEach(btn => btn.addEventListener('click', () => deleteAuditRule(btn.dataset.deleteRuleId, btn.dataset.ruleLabel)));
}

function openAuditRuleEditor(rule = null) {
  if (!hasPermission('audit.plan.manage')) return showToast('คุณไม่มีสิทธิ์จัดการกฎตารางตรวจ', 'error');
  $('#auditRuleEditor').classList.remove('hidden');
  $('#auditRuleEditorTitle').textContent = rule ? 'แก้ไขกฎตารางตรวจ' : 'เพิ่มกฎตารางตรวจ';
  $('#auditRuleId').value = rule?.RuleID || '';
  $('#auditRuleRole').value = rule?.RequiredRole || 'Leader';
  $('#auditRuleAssignmentMode').value = rule?.AssignmentMode || (rule?.RequiredUserID ? 'USER' : 'ROLE');
  $('#auditRuleUser').value = rule?.RequiredUserID || '';
  $('#auditRuleLine').value = rule?.LineID || '';
  populateAuditRuleStationSelect($('#auditRuleLine').value, !rule);
  $('#auditRuleStation').value = rule?.StationID || '';
  $('#auditRuleFrequency').value = rule?.Frequency || 'Daily';
  $('#auditRuleDayOfWeek').value = rule?.DayOfWeek || '';
  $('#auditRuleDayOfMonth').value = rule?.DayOfMonth || 1;
  $('#auditRuleDueTime').value = formatDueTime(rule?.DueTime || '17:00');
  $('#auditRuleActiveStatus').value = rule?.ActiveStatus || 'Active';
  updateAuditRuleAssignmentMode();
  updateAuditRuleFrequencyFields();
  $('#auditRuleEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeAuditRuleEditor() {
  $('#auditRuleEditor').classList.add('hidden');
  $('#auditRuleForm').reset();
  $('#auditRuleId').value = '';
}

function updateAuditRuleAssignmentMode() {
  const isUserMode = $('#auditRuleAssignmentMode').value === 'USER';
  $('#auditRuleUserField').classList.toggle('hidden', !isUserMode);
  $('#auditRuleUser').disabled = !isUserMode;
  $('#auditRuleUser').required = isUserMode;
  if (!isUserMode) $('#auditRuleUser').value = '';
}

function updateAuditRuleFrequencyFields() {
  const frequency = $('#auditRuleFrequency').value;
  const weekly = frequency === 'Weekly';
  const monthly = frequency === 'Monthly';
  $('#auditRuleDayOfWeek').disabled = !weekly;
  $('#auditRuleDayOfWeek').required = weekly;
  $('#auditRuleDayOfWeek').closest('label').classList.toggle('hidden', frequency === 'Daily' || monthly);
  $('#auditRuleDayOfMonth').disabled = !monthly;
  $('#auditRuleDayOfMonth').required = monthly;
  $('#auditRuleDayOfMonth').closest('label').classList.toggle('hidden', frequency === 'Daily' || weekly);
  if (!weekly) $('#auditRuleDayOfWeek').value = '';
  if (!monthly) $('#auditRuleDayOfMonth').value = '';
}

function formatAssignmentMode(rule) {
  return String(rule.AssignmentMode || (rule.RequiredUserID ? 'USER' : 'ROLE')).toUpperCase() === 'USER' ? 'Specific user' : 'Role-based';
}

function formatRuleUser(rule) {
  return String(rule.AssignmentMode || (rule.RequiredUserID ? 'USER' : 'ROLE')).toUpperCase() === 'USER' ? (rule.RequiredUserName || rule.RequiredUserID || '-') : `ตามตำแหน่ง ${rule.RequiredRole || ''}`.trim();
}

function formatDueTime(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  return match ? `${String(match[1]).padStart(2, '0')}:${match[2]}` : '17:00';
}

async function saveAuditRule() {
  const payload = {
    ruleId: $('#auditRuleId').value,
    requiredRole: $('#auditRuleRole').value,
    assignmentMode: $('#auditRuleAssignmentMode').value,
    requiredUserId: $('#auditRuleAssignmentMode').value === 'USER' ? $('#auditRuleUser').value : '',
    lineId: $('#auditRuleLine').value,
    stationId: $('#auditRuleStation').value,
    frequency: $('#auditRuleFrequency').value,
    dayOfWeek: $('#auditRuleDayOfWeek').value.trim(),
    dayOfMonth: $('#auditRuleDayOfMonth').value,
    dueTime: formatDueTime($('#auditRuleDueTime').value),
    activeStatus: $('#auditRuleActiveStatus').value
  };
  if (payload.assignmentMode === 'USER' && !payload.requiredUserId) return showToast('กรุณาเลือก Assigned User สำหรับ Specific user mode', 'warning');
  if (payload.frequency === 'Weekly' && !payload.dayOfWeek) return showToast('กรุณาระบุ Day of Week สำหรับ Weekly', 'warning');
  if (payload.frequency === 'Monthly' && !payload.dayOfMonth) return showToast('กรุณาระบุ Day of Month สำหรับ Monthly', 'warning');
  if (payload.frequency === 'Daily') { payload.dayOfWeek = ''; payload.dayOfMonth = ''; }
  if (payload.frequency === 'Weekly') payload.dayOfMonth = '';
  if (payload.frequency === 'Monthly') payload.dayOfWeek = '';
  if (payload.stationId === 'ALL') {
    const allLines = payload.lineId === 'ALL';
    const stationCount = allLines
      ? (state.masterData.stations || []).filter(s => String(s.ActiveStatus || '').toLowerCase() === 'active').length
      : activeStationsForLine(payload.lineId).length;
    if (!stationCount) return showToast('ไม่พบ Station ที่ Active ใน Line ที่เลือก', 'warning');
    const lineLabel = allLines ? 'ทุก Line' : 'Line นี้';
    const confirmed = await showConfirm({
      title: 'สร้างกฎให้ทุก Station?',
      message: `ระบบจะสร้างกฎสำหรับ Station ที่ Active ทั้งหมดใน ${lineLabel} (${stationCount} Station)`,
      confirmText: 'สร้างกฎ',
      tone: 'warning'
    });
    if (!confirmed) return;
  }
  showLoading('กำลังบันทึกกฎตารางตรวจ...');
  try {
    const result = await apiCall('upsertAuditPlanRule', payload);
    closeAuditRuleEditor();
    await loadAuditPlan();
    state.dashboard = null;
    const summary = result.updatedCount
      ? `อัปเดตกฎ ${result.updatedCount} รายการ`
      : `สร้างกฎใหม่ ${result.createdCount || 0} รายการ / ข้ามกฎซ้ำ ${result.skippedDuplicateCount || 0} รายการ`;
    showToast(summary, 'success', 7000);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    hideLoading();
  }
}

async function deleteAuditRule(ruleId, ruleLabel) {
  const confirmed = await showConfirm({
    title: 'ลบกฎตารางตรวจ?',
    message: ruleLabel,
    confirmText: 'ลบกฎ',
    tone: 'danger'
  });
  if (!confirmed) return;
  showLoading('กำลังลบกฎตารางตรวจ...');
  try {
    await apiCall('deleteAuditRule', { ruleId });
    state.auditRules = state.auditRules.filter(r => r.RuleID !== ruleId);
    renderAuditRules();
    showToast('ลบกฎตารางตรวจแล้ว', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    hideLoading();
  }
}

async function startAuditFromPlan(plan) {
  const layerOption = Array.from($('#auditLayer').options).find(option => option.value === plan.AuditLayer);
  if (!layerOption) return showToast('คุณไม่มีสิทธิ์เริ่มตรวจ Audit Layer นี้', 'error');
  showLoading('กำลังโหลดแผนเข้าสู่ฟอร์มตรวจ...');
  try {
    state.startingPlanAudit = true;
    await Promise.resolve();
    await navigateTo('audit');
    state.auditMode = 'Plan';
    $('#auditPlanId').value = plan.PlanID || '';
    $('#auditDate').value = dateInputValue(plan.DueDate);
    $('#auditLine').value = plan.LineID || '';
    handleAuditLineChange();
    $('#auditStation').value = plan.StationID || '';
    updateAuditArea();
    $('#auditLayer').value = plan.AuditLayer;
    setPlanScopeLocked(true);
    resetAuditInterlockState();
    updateLateReasonVisibility();
    showToast('โหลดแผนการตรวจแล้ว กรุณากดโหลด Checklist', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    state.startingPlanAudit = false;
    hideLoading();
    if (state.auditMode === 'Plan') setPlanScopeLocked(true);
  }
}

function viewAuditFromPlan(plan) {
  if (!plan.CompletedAuditID) return showToast('แผนนี้ยังไม่มีผลตรวจ', 'warning');
  showToast(`AuditID: ${plan.CompletedAuditID}`, 'info', 6000);
}

function updateLateReasonVisibility() {
  const date = $('#auditDate').value;
  const backdated = date && date < localDateInput(new Date());
  $('#lateReasonField').classList.toggle('hidden', !backdated);
  $('#auditLateReason').required = Boolean(backdated);
}

function renderMonthlyReport(data) {
  const metrics = [['Total Audit', data.TotalAudit], ['Planned Audit', data.PlannedAuditCount], ['Completed Plan', data.CompletedAuditCount], ['Completion Rate', `${number(data.CompletionRate).toFixed(2)}%`], ['Overdue Audit', data.OverdueAuditCount], ['Missed Audit', data.MissedAuditCount], ['Late Submitted', data.LateSubmittedCount], ['Total OK', data.TotalOK], ['Total NG', data.TotalNG], ['NG Rate', `${number(data.NGRate).toFixed(2)}%`], ['Total Finding', data.TotalFinding], ['Open Finding', data.OpenFinding], ['Closed Finding', data.ClosedFinding], ['Overdue Action', data.OverdueAction]];
  $('#reportContent').innerHTML = `<article class="panel"><div class="panel-title"><div><p class="eyebrow">MONTHLY LPA REPORT</p><h3>ประจำเดือน ${escapeHtml(formatPeriod(data.Period))}</h3></div></div><div class="report-metrics">${metrics.map(item => `<div class="metric-card"><span class="metric-label">${escapeHtml(item[0])}</span><strong class="metric-value">${escapeHtml(String(item[1] ?? 0))}</strong></div>`).join('')}</div></article><div class="content-grid two-columns"><article class="panel report-section"><h3>Audit Plan by Role</h3>${tableHtml(['Role', 'Planned', 'Completed', 'Late', 'Missed'], (data.AuditPlanByRole || []).map(row => [row.Role, row.Planned, row.Completed, row.LateSubmitted, row.Missed]))}</article><article class="panel report-section"><h3>Audit Plan by Line</h3>${tableHtml(['Line', 'Planned', 'Completed', 'Late', 'Missed'], (data.AuditPlanByLine || []).map(row => [row.LineName || row.LineID, row.Planned, row.Completed, row.LateSubmitted, row.Missed]))}</article></div><div class="content-grid two-columns"><article class="panel report-section"><h3>Summary by Category</h3>${tableHtml(['Category', 'Total', 'OK', 'NG', 'N/A'], (data.SummaryByCategory || []).map(row => [row.Category, row.Total, row.OK, row.NG, row.NA]))}</article><article class="panel report-section"><h3>Summary by Line</h3>${tableHtml(['Line', 'Audit', 'OK', 'NG', 'N/A'], (data.SummaryByLine || []).map(row => [row.LineName || row.LineID, row.TotalAudit, row.TotalOK, row.TotalNG, row.TotalNA]))}</article></div><article class="panel report-section"><h3>Top Finding</h3>${findingReportTable(data.TopFinding || [])}</article><article class="panel report-section"><h3>Action Plan</h3>${findingReportTable(data.ActionPlanList || [])}</article>`;
}

async function exportReportCsv() {
  const periodMonth = monthToPeriod($('#reportMonth').value);
  if (!periodMonth) return showToast('กรุณาเลือกเดือน', 'warning');
  showLoading('กำลังสร้าง CSV...');
  try {
    const data = await apiCall('exportReportCsv', { periodMonth });
    const blob = new Blob([data.Csv || ''], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = data.FileName || `LPA_Report_${periodMonth}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('ดาวน์โหลด CSV แล้ว', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    hideLoading();
  }
}

async function loadMasterChecklist() {
  const lineId = $('#checklistLine').value;
  const stationId = $('#checklistStation').value;
  const auditLayer = $('#checklistLayer').value;
  if (!lineId || !auditLayer) return showToast('กรุณาเลือก Line และ Audit Layer', 'warning');
  showLoading('กำลังโหลด Checklist Master...');
  try {
    const data = await apiCall('getChecklist', { lineId, stationId, auditLayer, category: $('#checklistCategory').value.trim() });
    renderMasterChecklist(data.checklist || []);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    hideLoading();
  }
}

async function loadUsers() {
  const container = $('#adminUsersTable');
  if (!hasPermission('users.view')) {
    const message = 'คุณไม่มีสิทธิ์ดูรายชื่อผู้ใช้';
    container.innerHTML = emptyHtml(message);
    showToast(message, 'error');
    return;
  }
  container.innerHTML = emptyHtml('กำลังโหลดผู้ใช้...');
  showLoading('กำลังโหลดข้อมูลผู้ใช้...');
  try {
    const data = await apiCall('listUsers', {
      search: $('#adminUserSearch').value.trim(),
      role: $('#adminRoleFilter').value,
      status: $('#adminStatusFilter').value,
      lineId: $('#adminLineFilter').value
    });
    state.adminUsers = data.users || [];
    renderAdminUsers();
  } catch (error) {
    state.adminUsers = [];
    const message = error && error.message ? error.message : 'ไม่สามารถโหลดรายชื่อผู้ใช้ได้';
    container.innerHTML = emptyHtml(message);
    console.error('loadUsers failed:', error);
    showToast(message, 'error');
  } finally {
    hideLoading();
  }
}

function renderAdminUsers() {
  const rows = state.adminUsers;
  if (!rows.length) return $('#adminUsersTable').innerHTML = emptyHtml('ไม่พบผู้ใช้');
  $('#adminUsersTable').innerHTML = `<table class="data-table"><thead><tr><th>User</th><th>Full Name</th><th>Role</th><th>Line Access</th><th>Status</th><th>Last Login</th><th></th></tr></thead><tbody>${rows.map(user => `<tr><td>${escapeHtml(user.Username)}</td><td>${escapeHtml(user.FullName)}</td><td>${escapeHtml(user.Role)}</td><td>${escapeHtml((user.LineAccess || []).map(line => line.LineName || line.LineID).join(', ') || user.LineDefault || '-')}</td><td><span class="status-badge ${String(user.ActiveStatus).toLowerCase() === 'active' ? 'status-closed' : 'status-na'}">${escapeHtml(user.ActiveStatus || '-')}</span></td><td>${escapeHtml(user.LastLogin || '-')}</td><td><button type="button" class="btn btn-outline" data-user-id="${escapeAttr(user.UserID)}">Edit</button></td></tr>`).join('')}</tbody></table>`;
}

async function loadShiftLists() {
  if (String(state.user?.Role || '').toLowerCase() !== 'admin') return;
  try {
    const data = await apiCall('getMasterLists', { listType: 'Shift' });
    state.adminMasterLists = data.lists || [];
    renderShiftLists();
  } catch (error) {
    $('#shiftListTable').innerHTML = emptyHtml(error.message || 'ไม่สามารถโหลด Shift ได้');
    showToast(error.message, 'error');
  }
}

function renderShiftLists() {
  const rows = state.adminMasterLists;
  if (!rows.length) {
    $('#shiftListTable').innerHTML = emptyHtml('ยังไม่มี Shift ใน Master List');
    return;
  }
  $('#shiftListTable').innerHTML = `<table class="data-table"><thead><tr><th>Value</th><th>Display Name</th><th>Sort</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(row =>
    `<tr><td>${escapeHtml(row.ListValue)}</td><td>${escapeHtml(row.DisplayText || row.ListValue)}</td><td>${escapeHtml(row.SortOrder ?? 0)}</td><td><span class="status-badge ${String(row.ActiveStatus).toLowerCase() === 'active' ? 'status-closed' : 'status-na'}">${escapeHtml(row.ActiveStatus)}</span></td><td><button type="button" class="btn btn-outline btn-compact" data-shift-value="${escapeAttr(row.ListValue)}">แก้ไข</button></td></tr>`
  ).join('')}</tbody></table>`;
}

function openShiftEditor(listValue = '') {
  const row = state.adminMasterLists.find(item => String(item.ListValue) === String(listValue));
  $('#shiftListValue').value = row?.ListValue || '';
  $('#shiftListValue').readOnly = Boolean(row);
  $('#shiftDisplayText').value = row?.DisplayText || row?.ListValue || '';
  $('#shiftSortOrder').value = row ? row.SortOrder : 'Auto';
  $('#shiftActiveStatus').value = row?.ActiveStatus || 'Active';
  $('#shiftForm').classList.remove('hidden');
  $('#shiftListValue').focus();
}

function closeShiftEditor() {
  $('#shiftForm').reset();
  $('#shiftListValue').readOnly = false;
  $('#shiftForm').classList.add('hidden');
}

async function saveShift() {
  const payload = {
    listType: 'Shift',
    listValue: $('#shiftListValue').value.trim(),
    displayText: $('#shiftDisplayText').value.trim(),
    activeStatus: $('#shiftActiveStatus').value
  };
  if (!payload.listValue || !payload.displayText) return showToast('กรุณากรอกข้อมูล Shift ให้ครบ', 'warning');
  showLoading('กำลังบันทึก Shift...');
  try {
    await apiCall('upsertMasterList', payload);
    state.masterDataLoadedAt = 0;
    closeShiftEditor();
    await Promise.all([loadShiftLists(), ensureMasterDataLoaded(false)]);
    showToast('บันทึก Shift สำเร็จ', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    hideLoading();
  }
}

async function openUserEditor(userId = '') {
  const user = state.adminUsers.find(item => item.UserID === userId) || null;
  if (userId && !user) {
    showToast(`ไม่พบผู้ใช้ ${userId}`, 'error');
    return;
  }
  state.editingUser = user;
  $('#userDialogTitle').textContent = user ? 'Edit User' : 'Add User';
  $('#userFormError').textContent = '';
  $('#userFormError').classList.add('hidden');
  $('#adminEditUserId').value = user ? user.UserID : '';
  $('#adminEmployeeId').value = user ? user.EmployeeID || '' : '';
  $('#adminUsername').value = user ? user.Username || '' : '';
  $('#adminFullName').value = user ? user.FullName || '' : '';
  $('#adminNickname').value = user ? user.Nickname || '' : '';
  $('#adminUserRole').value = user ? user.Role || 'User' : 'User';
  $('#adminDepartment').value = user ? user.Department || '' : '';
  $('#adminLineDefault').value = user ? user.LineDefault || '' : '';
  $('#adminEmail').value = user ? user.Email || '' : '';
  $('#adminPhone').value = user ? user.Phone || '' : '';
  $('#adminActiveStatus').value = user ? user.ActiveStatus || 'Active' : 'Active';
  $('#adminPassword').value = '';
  $('#adminPassword').required = !user;
  $('#adminPasswordLabel').classList.toggle('hidden', Boolean(user));
  const canManageAccess = hasPermission('users.managePermission');
  $('#adminAccessEditor').classList.toggle('hidden', !canManageAccess);
  $('#adminAdvancedPermissions').open = false;
  $('#resetPasswordButton').classList.toggle('hidden', !user || !hasPermission('users.resetPassword'));
  $('#deactivateUserButton').classList.toggle('hidden', !user || !hasPermission('users.deactivate') || user.UserID === state.user.UserID);
  if (canManageAccess) renderUserAccessEditors([], []);
  $('#userDialog').showModal();
  if (user && canManageAccess) {
    try {
      await loadUserAccessEditors(user.UserID);
    } catch (error) {
      const message = error && error.message ? error.message : 'ไม่สามารถโหลดสิทธิ์ผู้ใช้ได้';
      $('#userFormError').textContent = message;
      $('#userFormError').classList.remove('hidden');
      showToast(message, 'error');
    }
  }
}

async function loadUserAccessEditors(userId) {
  showLoading('กำลังโหลดข้อมูลผู้ใช้...');
  try {
    const [permissionData, lineData] = await Promise.all([
      apiCall('listUserPermissions', { userId }),
      apiCall('listUserLineAccess', { userId })
    ]);
    renderUserAccessEditors(permissionData.userPermissions || [], lineData.lineAccess || []);
  } finally {
    hideLoading();
  }
}

function renderUserAccessEditors(permissionRows, lineAccessRows) {
  const permissionMap = {};
  permissionRows.forEach(row => { permissionMap[row.PermissionKey] = row.Allowed || 'Inherit'; });
  $('#adminPermissionList').innerHTML = PERMISSION_CATALOG.map(key => {
    const value = permissionMap[key] || 'Inherit';
    return `<label class="permission-item">${escapeHtml(key)}<select data-user-permission="${escapeAttr(key)}"><option ${value === 'Inherit' ? 'selected' : ''}>Inherit</option><option value="Yes" ${value === 'Yes' ? 'selected' : ''}>Allow</option><option value="No" ${value === 'No' ? 'selected' : ''}>Deny</option></select></label>`;
  }).join('');

  const lineMap = {};
  lineAccessRows.forEach(row => { lineMap[row.LineID] = row; });
  const lines = [{ LineID: 'ALL', LineName: 'ALL' }, ...(state.masterData.lines || [])];
  $('#adminLineAccessList').innerHTML = lines.map(line => {
    const access = lineMap[line.LineID];
    const currentLevel = String(access && access.AccessLevel || 'View');
    const viewSelected = currentLevel === 'View' || !access;
    const manageValue = ['Update', 'Audit', 'Manage', 'All'].includes(currentLevel) ? currentLevel : 'Manage';
    return `<div class="permission-item line-access-item"><label><input type="checkbox" data-line-access="${escapeAttr(line.LineID)}" ${access && String(access.ActiveStatus).toLowerCase() === 'active' ? 'checked' : ''}> ${escapeHtml(line.LineName || line.LineID)}</label><select data-line-level="${escapeAttr(line.LineID)}"><option value="View" ${viewSelected ? 'selected' : ''}>View</option><option value="${escapeAttr(manageValue)}" ${!viewSelected ? 'selected' : ''}>Manage</option></select></div>`;
  }).join('');
}

async function saveUser() {
  const userId = $('#adminEditUserId').value;
  const payload = {
    employeeId: $('#adminEmployeeId').value.trim(), username: $('#adminUsername').value.trim(),
    fullName: $('#adminFullName').value.trim(), nickname: $('#adminNickname').value.trim(),
    role: $('#adminUserRole').value, department: $('#adminDepartment').value.trim(),
    lineDefault: $('#adminLineDefault').value, email: $('#adminEmail').value.trim(),
    phone: $('#adminPhone').value.trim(), activeStatus: $('#adminActiveStatus').value
  };
  if (!userId) payload.password = $('#adminPassword').value;
  $('#userFormError').textContent = '';
  $('#userFormError').classList.add('hidden');
  showLoading('กำลังบันทึกข้อมูลผู้ใช้...');
  try {
    const result = await apiCall(userId ? 'updateUser' : 'createUser', userId ? { ...payload, userId } : payload);
    const savedUserId = userId || result.user.UserID;
    if (hasPermission('users.managePermission')) await saveUserAccess(savedUserId);
    $('#userDialog').close();
    showToast('บันทึกผู้ใช้สำเร็จ', 'success');
    await loadUsers();
  } catch (error) {
    const message = error && error.message ? error.message : 'ไม่สามารถบันทึกผู้ใช้ได้';
    $('#userFormError').textContent = message;
    $('#userFormError').classList.remove('hidden');
    showToast(message, 'error');
  } finally {
    hideLoading();
  }
}

async function saveUserAccess(userId) {
  showLoading('กำลังอัปเดตสิทธิ์ผู้ใช้...');
  const permissions = $$('[data-user-permission]').map(input => ({ permissionKey: input.dataset.userPermission, allowed: input.value, reason: 'Updated from Admin Panel' }));
  const lineAccess = $$('[data-line-access]').map(input => ({
    lineId: input.dataset.lineAccess,
    accessLevel: $(`[data-line-level="${cssEscape(input.dataset.lineAccess)}"]`).value,
    activeStatus: input.checked ? 'Active' : 'Inactive'
  }));
  try {
    await apiCall('updateUserPermissions', { userId, permissions });
    await apiCall('updateUserLineAccess', { userId, lineAccess });
  } finally {
    hideLoading();
  }
}

async function deactivateSelectedUser() {
  const userId = $('#adminEditUserId').value;
  if (!userId) return;
  const confirmed = await showConfirm({
    title: 'ปิดใช้งานผู้ใช้นี้?',
    message: 'ผู้ใช้จะไม่สามารถเข้าสู่ระบบได้ จนกว่าจะเปิดใช้งานใหม่',
    confirmText: 'ปิดใช้งาน',
    tone: 'danger'
  });
  if (!confirmed) return;
  showLoading('กำลังบันทึกข้อมูลผู้ใช้...');
  try {
    await apiCall('deactivateUser', { userId });
    $('#userDialog').close();
    showToast('ปิดใช้งานผู้ใช้แล้ว', 'success');
    await loadUsers();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    hideLoading();
  }
}

async function resetSelectedUserPassword() {
  const userId = $('#adminEditUserId').value;
  const password = window.prompt('รหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร');
  if (!userId || !password) return;
  showLoading('กำลังบันทึกข้อมูลผู้ใช้...');
  try {
    await apiCall('resetUserPassword', { userId, password });
    showToast('Reset password สำเร็จ', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    hideLoading();
  }
}

function renderMasterChecklist(rows) {
  const headers = ['ChecklistID', 'Category', 'CheckItem', 'StandardCriteria', 'ExampleOK', 'ExampleNG', 'LineName', 'StationName', 'AuditLayer', 'Frequency', 'Severity', 'ActiveStatus'];
  $('#masterChecklistTable').innerHTML = rows.length ? tableHtml(headers, rows.map(row => headers.map(header => row[header] ?? '')), 'checklist-master-table') : emptyHtml('ไม่พบ Checklist');
}

function populateAllMasterSelects() {
  const allLines = state.masterData.lines || [];
  // Audit Form: only show lines in today's production plan (interlock)
  const activeIds = state.productionPlan?.activeLineIds;
  // treat empty array same as null — show all lines if no plan set
  const auditLines = allLines; // No line interlock — Leader can audit any line
  populateSelect('#auditLine', auditLines, 'LineID', 'LineName', 'เลือก Line');
  // Other selects use all lines
  ['#findingLine', '#checklistLine', '#planLine'].forEach((selector, index) => populateSelect(selector, allLines, 'LineID', 'LineName', index === 1 ? 'ทั้งหมด' : 'เลือก Line'));
  $('#auditStation').value = 'ALL'; // Line-level audit: always ALL
  populateStationSelect('#findingStation', '', true);
  populateStationSelect('#checklistStation', '', false);
  populateStationSelect('#planStation', '', true);
  populateSelect('#auditRuleLine', state.masterData.lines || [], 'LineID', 'LineName', 'เลือก Line', 'ทั้งหมด (ALL Lines)');
  populateAuditRuleStationSelect('', true);
  populateSelect('#auditRuleUser', state.masterData.users || [], 'UserID', 'FullName', 'ตาม Role');
  const picUsers = (state.masterData.users || [])
    .filter(u => (!u.ActiveStatus || String(u.ActiveStatus).toLowerCase() === 'active') && u.Role && !EXCLUDED_ASSIGNABLE_ROLES.has(u.Role))
    .slice()
    .sort((a, b) => String(a.FullName || '').localeCompare(String(b.FullName || ''), 'th'))
    .map(u => ({ UserID: u.UserID, PicLabel: `${u.FullName || u.Username} (${u.Role})` }));
  populateSelect('#findingPicName', picUsers, 'UserID', 'PicLabel', 'ทั้งหมด');
  populateSelect('#adminLineFilter', state.masterData.lines || [], 'LineID', 'LineName', 'ทั้งหมด');
  populateSelect('#adminLineDefault', state.masterData.lines || [], 'LineID', 'LineName', 'ไม่ระบุ');
  const shifts = (state.masterData.lists || [])
    .filter(row => String(row.ListType || '').toLowerCase() === 'shift')
    .sort((a, b) => Number(a.SortOrder || 0) - Number(b.SortOrder || 0));
  populateSelect('#auditShift', shifts, 'ListValue', 'DisplayText', 'เลือก Shift');
  // Meeting board: filter shows every line; the post form only shows lines the user can post to
  populateSelect('#meetingLine', allLines, 'LineID', 'LineName', 'ทั้งหมด');
  const meetingLineAccess = JSON.parse(localStorage.getItem('lpa_line_access') || '[]');
  const meetingHasAllLines = state.user?.Role === 'Admin' || meetingLineAccess.some(la => la.LineID === 'ALL');
  const meetingPostableLines = meetingHasAllLines ? allLines :
    allLines.filter(l => meetingLineAccess.some(la => String(la.LineID) === String(l.LineID)));
  populateSelect('#meetingPostLine', meetingPostableLines, 'LineID', 'LineName', 'ทุกไลน์ (ALL)');
  populateSelect('#meetingPostShift', shifts, 'ListValue', 'DisplayText', 'ไม่ระบุ');
  // Supervisor/Manager: no shift — hide and clear the field
  const role = state.user?.Role || '';
  const shiftLabel = $('#auditShiftLabel');
  const shiftSel = $('#auditShift');
  if (role === 'Supervisor' || role === 'Manager') {
    shiftSel.value = '';
    shiftSel.required = false;
    if (shiftLabel) shiftLabel.classList.add('hidden');
  } else {
    shiftSel.required = true;
    if (shiftLabel) shiftLabel.classList.remove('hidden');
  }
}

function populateStationSelect(selector, lineId, allowAll) {
  const rows = (state.masterData.stations || []).filter(row => !lineId || String(row.LineID) === String(lineId));
  populateSelect(selector, rows, 'StationID', 'StationName', allowAll ? 'ทั้งหมด' : 'เลือก Station');
}

function activeStationsForLine(lineId) {
  return (state.masterData.stations || []).filter(row =>
    String(row.LineID) === String(lineId) &&
    (!row.ActiveStatus || String(row.ActiveStatus).toLowerCase() === 'active')
  );
}

function handleAuditRuleLineChange() {
  const lineId = $('#auditRuleLine').value;
  if (lineId === 'ALL') {
    $('#auditRuleStation').innerHTML = '<option value="ALL">ทั้งหมด (ALL Stations)</option>';
    $('#auditRuleStation').value = 'ALL';
  } else {
    populateAuditRuleStationSelect(lineId, true);
  }
}

function populateAuditRuleStationSelect(lineId, allowAll) {
  const select = $('#auditRuleStation');
  const current = select.value;
  const rows = activeStationsForLine(lineId);
  const allOption = allowAll && lineId ? '<option value="ALL">ทั้งหมด</option>' : '';
  select.innerHTML = `<option value="">เลือก Station</option>${allOption}` +
    rows.map(row => `<option value="${escapeAttr(row.StationID)}">${escapeHtml(row.StationName || row.StationID)}</option>`).join('');
  if ((current === 'ALL' && allowAll) || rows.some(row => String(row.StationID) === current)) select.value = current;
}

// Verifier close/reject reasons: a fixed dropdown of common reasons plus
// "อื่นๆ" that reveals a free-text field, instead of an open textarea for
// every verification. Selecting a preset writes straight into the textarea
// (still the field actually submitted), so no backend changes were needed.
function populateFindingReasonSelect(selector, reasons) {
  $(selector).innerHTML = `<option value="">-- เลือกเหตุผล --</option>` +
    reasons.map(reason => `<option value="${escapeAttr(reason)}">${escapeHtml(reason)}</option>`).join('') +
    `<option value="${FINDING_REASON_OTHER}">อื่นๆ (ระบุเอง)</option>`;
}

function wireFindingReasonSelect(selectSelector, textareaSelector, noteFieldSelector) {
  $(selectSelector).addEventListener('change', () => {
    const select = $(selectSelector);
    const textarea = $(textareaSelector);
    const isOther = select.value === FINDING_REASON_OTHER;
    $(noteFieldSelector).classList.toggle('hidden', !isOther);
    textarea.classList.remove('field-error');
    select.classList.remove('field-error');
    if (isOther) {
      textarea.value = '';
      textarea.focus();
    } else {
      textarea.value = select.value;
    }
  });
}

function resetFindingReasonField(selectSelector, textareaSelector, noteFieldSelector) {
  $(selectSelector).value = '';
  $(selectSelector).classList.remove('field-error');
  $(textareaSelector).value = '';
  $(textareaSelector).classList.remove('field-error');
  $(noteFieldSelector).classList.add('hidden');
}

function populateSelect(selector, rows, valueField, textField, firstLabel, allOptionLabel) {
  const select = $(selector);
  const current = select.value;
  const allOpt = allOptionLabel ? `<option value="ALL">${escapeHtml(allOptionLabel)}</option>` : '';
  select.innerHTML = `<option value="">${escapeHtml(firstLabel)}</option>${allOpt}` + rows.map(row => `<option value="${escapeAttr(row[valueField])}">${escapeHtml(row[textField] || row[valueField])}</option>`).join('');
  if (current === 'ALL' && allOptionLabel) select.value = 'ALL';
  else if (rows.some(row => String(row[valueField]) === current)) select.value = current;
}

const EXCLUDED_ASSIGNABLE_ROLES = new Set(['Admin', 'Viewer', 'Customer']);

function assignableRoles() {
  const order = ['Leader', 'Supervisor', 'Engineer', 'Manager'];
  const roles = new Set();
  (state.masterData.users || []).forEach(user => {
    if ((!user.ActiveStatus || String(user.ActiveStatus).toLowerCase() === 'active') && user.Role && !EXCLUDED_ASSIGNABLE_ROLES.has(user.Role)) {
      roles.add(user.Role);
    }
  });
  // ensure order preserved, add any extra roles not in order
  const ordered = order.filter(r => roles.has(r));
  roles.forEach(r => { if (!order.includes(r)) ordered.push(r); });
  return ordered;
}

function usersForRole(role) {
  const currentUserId = state.user && state.user.UserID;
  return (state.masterData.users || []).filter(user =>
    user.Role === role &&
    (!user.ActiveStatus || String(user.ActiveStatus).toLowerCase() === 'active') &&
    String(user.UserID) !== String(currentUserId)
  );
}

function assignableRoleOptions() {
  return assignableRoles().map(role => `<option value="${escapeAttr(role)}">${escapeHtml(role)}</option>`).join('');
}

function findingAssignmentMode(row) {
  return String(row.AssignmentMode || (row.AssignedUserID || row.AssignedToUserID || row.PICUserID ? 'USER' : 'ROLE')).toUpperCase();
}

function formatFindingAssignment(row) {
  return findingAssignmentMode(row) === 'ROLE'
    ? (row.AssignedRoleName || row.AssignedRole || row.AssignedToRole || row.ResponsiblePerson || row.PICName || '-')
    : (row.AssignedUserName || row.AssignedToName || row.PICName || row.AssignedUserID || row.AssignedToUserID || '-');
}

function formatFindingAssignmentMode(row) {
  return findingAssignmentMode(row) === 'ROLE' ? 'รูปแบบ: ตามตำแหน่ง' : 'รูปแบบ: ระบุรายบุคคล';
}

// AssignedUserID/AssignedRole can hold a CSV list when a finding is
// multi-assigned (e.g. "U-Leader1,U-Leader2"), matching the server's
// isAssignedToUser_ in Findings.gs. An exact-equality check here would wrongly
// hide the edit form for every co-assignee except whichever ID happens to
// come first, blocking them from responding at all — independent of due date.
function csvContainsValue(csv, value) {
  const target = String(value ?? '').trim().toLowerCase();
  if (!target) return false;
  return String(csv ?? '').split(',').map(v => v.trim().toLowerCase()).includes(target);
}

function isFindingAssignedToCurrentUser(row) {
  if (findingAssignmentMode(row) === 'ROLE') {
    const assignedRole = row.AssignedRole || row.AssignedRoleName || row.AssignedToRole || row.AssignedToName || row.ResponsiblePerson || row.PICName || '';
    return csvContainsValue(assignedRole, state.user?.Role) || csvContainsValue(assignedRole, state.user?.FullName);
  }
  const assignedUserId = row.AssignedUserID || row.AssignedToUserID || row.ResponsibleUserID || row.PICUserID || '';
  if (assignedUserId) return csvContainsValue(assignedUserId, state.user?.UserID);
  return csvContainsValue(row.AssignedUserName || row.AssignedToName || row.PICName, state.user?.FullName);
}

function activeUserOptions() {
  return (state.masterData.users || []).map(user => `<option value="${escapeAttr(user.UserID)}">${escapeHtml(user.FullName || user.Username)} (${escapeHtml(user.Role || '-')})</option>`).join('');
}

function populateFindingAssignee(selectedUserId) {
  const select = $('#editAssignedTo');
  select.innerHTML = `<option value="">ไม่ระบุผู้รับผิดชอบ</option>${activeUserOptions()}`;
  select.value = selectedUserId || '';
}

function handleAuditLineChange() {
  // Line-level audit: always use ALL as station
  $('#auditStation').value = 'ALL';
  updateAuditArea();
}

function updateAuditArea() {
  const line = (state.masterData.lines || []).find(row => String(row.LineID) === $('#auditLine').value);
  $('#auditArea').value = (line && line.Area) || '';
}

function resetAuditForm() {
  if (window._auditDraftTimer) { clearInterval(window._auditDraftTimer); window._auditDraftTimer = null; }
  state.checklist = [];
  state.auditAnswers = {};
  state.auditMode = 'Manual';
  state.auditDuplicateBlocked = false;
  state.auditClientSubmissionId = createClientSubmissionId();
  setPlanScopeLocked(false);
  setAuditSavingState(false);
  $('#auditChecklist').innerHTML = emptyHtml('เลือก Line, Station และ Audit Layer แล้วกด “โหลด Checklist”');
  $('#auditSaveBar').classList.add('hidden');
  $('#auditRemark').value = '';
  $('#auditPlanId').value = '';
  $('#auditLateReason').value = '';
  updateLateReasonVisibility();
  setDefaultDates();
}

function resetAuditInterlockState() {
  state.auditDuplicateBlocked = false;
  state.auditClientSubmissionId = createClientSubmissionId();
  $$('.audit-duplicate-toast').forEach(toast => toast.remove());
  setAuditSavingState(false);
}

function clearLoadedAuditChecklist() {
  state.checklist = [];
  state.auditAnswers = {};
  $('#auditChecklist').innerHTML = emptyHtml('ขอบเขตการตรวจเปลี่ยนแล้ว กรุณาโหลด Checklist ใหม่');
  $('#auditSaveBar').classList.add('hidden');
  updateAuditSaveButtonState();
}

function handleAuditScopeChange() {
  resetAuditInterlockState();
  clearLoadedAuditChecklist();
  if (state.auditMode !== 'Plan') $('#auditPlanId').value = '';
}

function setPlanScopeLocked(locked) {
  ['#auditLine', '#auditStation', '#auditLayer'].forEach(selector => {
    const field = $(selector);
    if (field) field.disabled = locked;
  });
}

function enterManualAuditMode() {
  state.auditMode = 'Manual';
  $('#auditPlanId').value = '';
  setPlanScopeLocked(false);
  resetAuditInterlockState();
  clearLoadedAuditChecklist();
}

async function navigateTo(page) {
  $$('.page').forEach(section => section.classList.toggle('active-page', section.id === `page-${page}`));
  $$('#mainNav [data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  closeMobileDrawer();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (page === 'audit' && !state.startingPlanAudit) {
    enterManualAuditMode();
    // Re-apply production plan interlock on audit line dropdown
    if (state.masterData.lines?.length) populateAllMasterSelects();
    const draft = getAuditDraft();
    if (draft) restoreAuditDraft(draft);
  }
  if (page === 'dashboard') {
    loadDashboard(false);
  } else {
    stopLeaderMeetingQuizPolling();
  }
  if (page === 'meeting') {
    // Show the board first, then refresh the digest and master data in parallel.
    await loadMeetingPage();
    if (!window._meetingQuizBoardPoll) {
      window._meetingQuizBoardPoll = setInterval(() => {
        const board = $('#page-meeting');
        if (document.visibilityState !== 'visible' || !board?.classList.contains('active-page')) return;
        const posts = [...(state.meetingPosts || []), ...(state.meetingCarryOver || [])];
        if ($('#meetingQuizAdminDialog')?.open || !posts.some(post => post.MeetingQuiz?.available && !post.MeetingQuiz.allSubmitted)) return;
        refreshMeetingQuizBoardStatus();
      }, 3000);
    }
  }
  if (page === 'training') await loadTrainingPage();
  if (page === 'five-s') {
    await loadFiveSPage();
  }
  if (['audit', 'audit-plan', 'findings', 'checklist', 'admin'].includes(page)) {
    if (page === 'findings') {
      // Run master data + findings in parallel — they are independent GAS calls
      loadFindings();
      pollFindingNotifications(true);
      try { await ensureMasterDataLoaded(false); } catch (_) { return; }
    } else {
      try { await ensureMasterDataLoaded(true); } catch (_) { return; }
    }
  }
  if (page === 'findings') { /* already handled above */ }
  if (page === 'dashboard') pollFindingNotifications(true);
  if (page === 'audit-plan' && !state.auditRules.length) loadAuditPlan();
  if (page === 'admin' && hasPermission('users.view')) loadUsers();
  if (page === 'admin' && String(state.user?.Role || '').toLowerCase() === 'admin') loadShiftLists();
}

async function loadFiveSPage() {
  const dateInput = $('#fiveSInspectionDate');
  if (!dateInput.value) dateInput.value = localDateInput(new Date());
  $('#fiveSInspectionList').innerHTML = '<div class="empty-state">กำลังโหลดรายการตรวจ 5.ส...</div>';
  try {
    const canManage = hasAnyPermission(['fiveS.manage', 'fiveS.checkpoint.manage']);
    const payload = { inspectionDate: dateInput.value, shift: $('#fiveSShiftFilter').value || '' };
    const [board, setup] = await Promise.all([
      apiCall('getFiveSBoard', payload),
      canManage ? apiCall('getFiveSSetupData', {}) : Promise.resolve(null)
    ]);
    state.fiveSBoard = board;
    state.fiveSSetup = setup;
    $('#fiveSShiftFilterField').classList.toggle('hidden', !board.canViewAll);
    const filter = $('#fiveSShiftFilter');
    const selected = filter.value;
    filter.innerHTML = '<option value="">ทุกกะ</option>' + (board.shifts || []).map(shift =>
      `<option value="${escapeAttr(shift.value)}">${escapeHtml(shift.label)}</option>`
    ).join('');
    filter.value = (board.shifts || []).some(shift => shift.value === selected) ? selected : '';
    renderFiveSSummary(board);
    renderFiveSInspectionList(board);
    if (setup) renderFiveSSetup(setup);
  } catch (error) {
    $('#fiveSSummary').innerHTML = '';
    $('#fiveSInspectionList').innerHTML = `<div class="empty-state">${escapeHtml(error.message || 'โหลดรายการตรวจไม่สำเร็จ')}</div>`;
    if (hasAnyPermission(['fiveS.manage', 'fiveS.checkpoint.manage'])) $('#fiveSCheckpointTable').innerHTML = '<div class="empty-state">โหลดข้อมูลจุดตรวจไม่สำเร็จ</div>';
  }
}

function renderFiveSSummary(board) {
  const shifts = board.summary || [];
  const total = shifts.reduce((sum, shift) => sum + Number(shift.total || 0), 0);
  const approved = shifts.reduce((sum, shift) => sum + Number(shift.approved || 0), 0);
  const pendingReview = shifts.reduce((sum, shift) => sum + Number(shift.pendingReview || 0), 0);
  const awaitingLeader = shifts.reduce((sum, shift) => sum + Number(shift.awaitingLeader || 0), 0);
  $('#fiveSSummary').innerHTML = `
    <article class="five-s-stat"><span>จุดตรวจทั้งหมด</span><strong>${total}</strong><small>วันที่ ${escapeHtml(formatDate(board.inspectionDate))}</small></article>
    <article class="five-s-stat success"><span>Supervisor รับรองแล้ว</span><strong>${approved}</strong><small>${shifts.map(shift => `${escapeHtml(shift.label)} ${shift.approved}/${shift.total}`).join(' · ') || 'ยังไม่มีจุดตรวจที่มอบหมาย'}</small></article>
    <article class="five-s-stat review-pending"><span>รอ Supervisor ตรวจ</span><strong>${pendingReview}</strong><small>Leader ส่งผลพร้อมรูปแล้ว</small></article>
    <article class="five-s-stat pending"><span>รอ Leader ส่ง/แก้ไข</span><strong>${awaitingLeader}</strong><small>${shifts.map(shift => `${escapeHtml(shift.label)} ${shift.awaitingLeader}`).join(' · ') || 'ยังไม่มีจุดตรวจที่มอบหมาย'}</small></article>`;
}

function renderFiveSSetup(setup) {
  const rows = setup.checkpoints || [];
  $('#fiveSCheckpointTable').innerHTML = rows.length ? `<table class="five-s-table"><thead><tr><th>หัวข้อ 5.ส</th><th>จุดตรวจ / พื้นที่</th><th>กะ / Leader</th><th>สถานะ</th><th></th></tr></thead><tbody>${rows.map(row => `
    <tr><td>${escapeHtml(row.Category)}</td><td><strong>${escapeHtml(row.CheckpointName)}</strong><small>${escapeHtml(row.Area)} · ${escapeHtml(row.StandardText)}</small>${row.ReferencePhotoURL ? `<a class="five-s-reference-link" href="${escapeAttr(row.ReferencePhotoURL)}" target="_blank" rel="noopener"><img src="${escapeAttr(driveThumbnailUrl_(row.ReferencePhotoURL))}" alt="รูปอ้างอิง ${escapeAttr(row.CheckpointName)}" loading="lazy"><span>ดูรูปอ้างอิง</span></a>` : ''}</td>
      <td>${(row.ShiftAssignments || []).map(item => `<span class="five-s-assignment-summary"><strong>กะ ${escapeHtml(item.Shift)}</strong> · ${escapeHtml(item.LeaderName || 'ยังไม่กำหนด')}</span>`).join('')}</td><td><span class="five-s-status ${isActiveStatus(row.ActiveStatus) ? 'active' : 'inactive'}">${isActiveStatus(row.ActiveStatus) ? 'Active' : 'Inactive'}</span></td>
      <td><button type="button" class="btn btn-outline btn-compact" data-five-s-edit="${escapeAttr(row.CheckpointGroupID)}">แก้ไข</button></td></tr>`).join('')}</tbody></table>`
    : '<div class="empty-state">ยังไม่มีจุดตรวจ กด “เพิ่มจุดตรวจ” เพื่อเริ่มกำหนดรายการ</div>';
}

function renderFiveSShiftAssignmentInputs(assignments = []) {
  const shifts = state.fiveSSetup?.shifts || [];
  const leaders = state.fiveSSetup?.leaders || [];
  const assignedLeaderByShift = new Map((assignments || []).map(item => [String(item.Shift), String(item.LeaderUserID || '')]));
  const target = $('#fiveSShiftAssignments');
  if (!shifts.length) {
    target.innerHTML = '<div class="empty-state">ไม่พบกะที่เปิดใช้งาน กรุณาตรวจสอบ Master List ก่อน</div>';
    return;
  }
  target.innerHTML = shifts.map(shift => `
    <label class="five-s-shift-assignment">กะ ${escapeHtml(shift.label)}
      <select data-five-s-shift="${escapeAttr(shift.value)}" required>
        <option value="">เลือก Leader ประจำกะนี้</option>
        ${leaders.map(leader => `<option value="${escapeAttr(leader.UserID)}" ${assignedLeaderByShift.get(String(shift.value)) === String(leader.UserID) ? 'selected' : ''}>${escapeHtml(leader.FullName || leader.Username)}</option>`).join('')}
      </select>
    </label>`).join('');
}

function isActiveStatus(value) { return !['inactive', 'false', 'no', '0'].includes(String(value || '').trim().toLowerCase()); }

function openFiveSCheckpointEditor(row = null) {
  const form = $('#fiveSCheckpointForm');
  form.reset();
  $('#fiveSCheckpointGroupId').value = row?.CheckpointGroupID || '';
  $('#fiveSCategory').value = row?.Category || '';
  $('#fiveSCheckpointName').value = row?.CheckpointName || '';
  $('#fiveSArea').value = row?.Area || '';
  $('#fiveSCheckpointStatus').value = row?.ActiveStatus || 'Active';
  $('#fiveSStandardText').value = row?.StandardText || '';
  renderFiveSShiftAssignmentInputs(row?.ShiftAssignments || []);
  $('#fiveSReferencePhotoURL').value = row?.ReferencePhotoURL || '';
  $('#fiveSReferencePhoto').value = '';
  renderFiveSReferencePhotoPreview(row?.ReferencePhotoURL || '');
  $('#fiveSCheckpointFormError').classList.add('hidden');
  form.classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function closeFiveSCheckpointEditor() {
  const preview = $('#fiveSReferencePhotoPreview');
  if (preview.dataset.previewUrl) URL.revokeObjectURL(preview.dataset.previewUrl);
  preview.dataset.previewUrl = '';
  preview.innerHTML = '';
  $('#fiveSCheckpointForm').reset();
  $('#fiveSCheckpointGroupId').value = '';
  $('#fiveSReferencePhotoURL').value = '';
  $('#fiveSCheckpointForm').classList.add('hidden');
  $('#fiveSCheckpointFormError').classList.add('hidden');
}

async function saveFiveSCheckpointFromForm() {
  const errorEl = $('#fiveSCheckpointFormError');
  errorEl.classList.add('hidden');
  let savedCheckpointGroupId = $('#fiveSCheckpointGroupId').value;
  let checkpointSaved = false;
  try {
    showLoading('กำลังบันทึกจุดตรวจ 5.ส...');
    const payload = {
      checkpointGroupId: savedCheckpointGroupId,
      category: $('#fiveSCategory').value,
      checkpointName: $('#fiveSCheckpointName').value.trim(),
      area: $('#fiveSArea').value.trim(), standardText: $('#fiveSStandardText').value.trim(),
      shiftAssignments: Array.from($('#fiveSShiftAssignments').querySelectorAll('[data-five-s-shift]')).map(select => ({
        shift: select.dataset.fiveSShift, leaderUserId: select.value
      })),
      activeStatus: $('#fiveSCheckpointStatus').value,
      referencePhotoURL: $('#fiveSReferencePhotoURL').value
    };
    const firstSave = await apiCall('saveFiveSCheckpoint', payload);
    checkpointSaved = true;
    savedCheckpointGroupId = firstSave.checkpointGroupID || savedCheckpointGroupId;
    const referenceAttachmentCheckpointId = firstSave.checkpointIDs?.[0] || '';
    if (!savedCheckpointGroupId || !referenceAttachmentCheckpointId) throw new Error('บันทึกจุดตรวจแล้ว แต่ไม่ได้รับรหัสชุดจุดตรวจ กรุณารีเฟรชก่อนลองอีกครั้ง');
    $('#fiveSCheckpointGroupId').value = savedCheckpointGroupId;
    const file = $('#fiveSReferencePhoto').files?.[0];
    if (file) {
      const uploaded = await uploadFiveSCheckpointReferencePhoto(file, referenceAttachmentCheckpointId);
      if (!uploaded.DriveFileURL) throw new Error('อัปโหลดรูปแล้วแต่ไม่ได้รับลิงก์รูป กรุณาลองบันทึกอีกครั้ง');
      $('#fiveSReferencePhotoURL').value = uploaded.DriveFileURL;
      $('#fiveSReferencePhoto').value = '';
      renderFiveSReferencePhotoPreview(uploaded.DriveFileURL);
      await apiCall('saveFiveSCheckpoint', { ...payload, checkpointGroupId: savedCheckpointGroupId, referencePhotoURL: uploaded.DriveFileURL });
    }
    closeFiveSCheckpointEditor();
    showToast('บันทึกจุดตรวจ 5.ส แล้ว', 'success');
    await loadFiveSPage();
  } catch (error) {
    errorEl.textContent = checkpointSaved
      ? `บันทึกจุดตรวจแล้ว แต่การตั้งค่ารูปอ้างอิงยังไม่เสร็จ: ${error.message || 'กรุณาตรวจสอบแล้วกดบันทึกอีกครั้ง'}`
      : (error.message || 'บันทึกจุดตรวจไม่สำเร็จ');
    errorEl.classList.remove('hidden');
  } finally { hideLoading(); }
}

function renderFiveSReferencePhotoPreview(url = '') {
  const preview = $('#fiveSReferencePhotoPreview');
  if (preview.dataset.previewUrl) URL.revokeObjectURL(preview.dataset.previewUrl);
  preview.dataset.previewUrl = '';
  preview.innerHTML = url ? `<a class="five-s-reference-link" href="${escapeAttr(url)}" target="_blank" rel="noopener"><img src="${escapeAttr(driveThumbnailUrl_(url))}" alt="ตัวอย่างรูปอ้างอิงตำแหน่ง" loading="lazy"><span>ดูรูปอ้างอิงปัจจุบัน</span></a>` : '';
}

function handleFiveSReferencePhotoChange(event) {
  const preview = $('#fiveSReferencePhotoPreview');
  if (preview.dataset.previewUrl) URL.revokeObjectURL(preview.dataset.previewUrl);
  const file = event.target.files?.[0];
  if (!file) { renderFiveSReferencePhotoPreview($('#fiveSReferencePhotoURL').value); return; }
  preview.dataset.previewUrl = URL.createObjectURL(file);
  preview.innerHTML = `<span class="five-s-reference-link"><img src="${escapeAttr(preview.dataset.previewUrl)}" alt="ตัวอย่างรูปอ้างอิงตำแหน่ง"><span>${escapeHtml(file.name)} · รูปใหม่จะแทนที่รูปเดิม</span></span>`;
}

function handleFiveSCheckpointTableClick(event) {
  const button = event.target.closest('[data-five-s-edit]');
  if (!button) return;
  const row = state.fiveSSetup?.checkpoints?.find(item => item.CheckpointGroupID === button.dataset.fiveSEdit);
  if (row) openFiveSCheckpointEditor(row);
}

function renderFiveSInspectionList(board) {
  const container = $('#fiveSInspectionList');
  container.querySelectorAll('.five-s-photo-upload-preview img[src^="blob:"]').forEach(image => URL.revokeObjectURL(image.src));
  const canSubmit = board.canInspect && board.inspectionDate === board.today;
  const rows = board.checkpoints || [];
  if (!rows.length) {
    container.innerHTML = `<div class="empty-state">${board.canViewAll ? 'ยังไม่มีจุดตรวจที่เปิดใช้งาน — Admin เพิ่มจุดตรวจและมอบหมาย Leader ก่อน' : 'ยังไม่มีจุดตรวจที่มอบหมายให้คุณในกะนี้ กรุณาติดต่อ Admin'}</div>`;
    return;
  }
  container.innerHTML = rows.map(row => {
    const inspection = row.Inspection;
    const reviewStatus = inspection?.ReviewStatus || 'Pending';
    const resultLabel = !inspection ? 'รอ Leader ส่ง' : reviewStatus === 'Approved' ? 'Supervisor รับรองแล้ว' : reviewStatus === 'Returned' ? 'รอ Leader แก้ไข' : 'รอ Supervisor ตรวจ';
    const resultClass = !inspection ? 'waiting' : reviewStatus === 'Approved' ? 'approved' : reviewStatus === 'Returned' ? 'returned' : 'review-waiting';
    const photo = inspection?.PhotoURL ? `<a class="five-s-photo" href="${escapeAttr(inspection.PhotoURL)}" target="_blank" rel="noopener"><img src="${escapeAttr(driveThumbnailUrl_(inspection.PhotoURL))}" alt="รูปจุดตรวจ ${escapeAttr(row.CheckpointName)}" loading="lazy"><span>ดูรูปที่ส่งแล้ว</span></a>` : '';
    const referencePhoto = row.ReferencePhotoURL ? `<a class="five-s-reference-photo" href="${escapeAttr(row.ReferencePhotoURL)}" target="_blank" rel="noopener"><span>📍 รูปอ้างอิงตำแหน่ง</span><img src="${escapeAttr(driveThumbnailUrl_(row.ReferencePhotoURL))}" alt="รูปอ้างอิงตำแหน่ง ${escapeAttr(row.CheckpointName)}" loading="lazy"></a>` : '';
    const isAssignedLeader = row.LeaderUserID === state.user?.UserID;
    const canEdit = canSubmit && isAssignedLeader && (!inspection || reviewStatus === 'Returned');
    const form = canEdit ? `
      <form class="five-s-audit-form" data-five-s-form data-checkpoint-id="${escapeAttr(row.CheckpointID)}">
        <div class="form-grid"><label>ผลตรวจ<select name="result" required><option value="">เลือกผลตรวจ</option><option value="Pass" ${inspection?.Result === 'Pass' ? 'selected' : ''}>ผ่านตามมาตรฐาน</option><option value="NeedAction" ${inspection?.Result === 'NeedAction' ? 'selected' : ''}>ต้องปรับปรุง</option></select></label>
          <label class="five-s-photo-input">รูปถ่ายจุดตรวจ <span class="required-mark">บังคับ</span><input name="photo" type="file" accept="image/*" capture="environment" required><small>ต้องแนบรูปทุกจุดก่อนบันทึก${inspection ? ' · ถ่ายรูปใหม่เพื่อส่งผลแก้ไข' : ''}</small></label>
          <label class="full-width">หมายเหตุ${' '}<textarea name="remark" rows="2" maxlength="1000" placeholder="ระบุสิ่งที่ต้องปรับปรุง (บังคับเมื่อเลือกต้องปรับปรุง)">${escapeHtml(inspection?.Remark || '')}</textarea></label>
        </div><div class="five-s-photo-upload-preview" aria-live="polite"></div><div class="button-row"><button type="submit" class="btn btn-primary">${inspection ? 'ส่งผลแก้ไขให้ Supervisor ตรวจ' : 'บันทึกผลพร้อมรูป'}</button></div>
      </form>` : '';
    const reviewSummary = inspection ? `<div class="five-s-review-summary"><strong>ผลจาก Leader:</strong> ${inspection.Result === 'Pass' ? 'ผ่านตามมาตรฐาน' : 'ต้องปรับปรุง'}${inspection.InspectorName ? ` · ส่งโดย ${escapeHtml(inspection.InspectorName)}` : ''} · ส่งเมื่อ ${escapeHtml(inspection.SubmittedAt || '')}</div>` : '';
    const returnedNote = inspection && reviewStatus === 'Returned' && inspection.ReviewRemark ? `<div class="five-s-review-note"><strong>เหตุผลที่ Supervisor ส่งกลับ:</strong> ${escapeHtml(inspection.ReviewRemark)}</div>` : '';
    const reviewPanel = inspection && reviewStatus === 'Pending' && board.canReview ? `
      <section class="five-s-review-panel" aria-label="ตรวจรับผลจาก Leader" data-five-s-review-card>
        <strong>ตรวจผลที่ Leader ส่ง</strong><label>หมายเหตุผู้ตรวจ (ต้องระบุเมื่อส่งกลับแก้ไข)<textarea rows="2" maxlength="1000" data-five-s-review-remark placeholder="ระบุเหตุผลหรือสิ่งที่ต้องแก้ไข"></textarea></label>
        <div class="button-row"><button type="button" class="btn btn-primary" data-five-s-review="approve" data-checkpoint-id="${escapeAttr(row.CheckpointID)}">รับรองผลตรวจ</button><button type="button" class="btn btn-secondary" data-five-s-review="return" data-checkpoint-id="${escapeAttr(row.CheckpointID)}">ส่งกลับให้ Leader แก้ไข</button></div>
      </section>` : '';
    let readOnly = '';
    if (isAssignedLeader && inspection && !canEdit) {
      readOnly = `<p class="five-s-readonly-note">${reviewStatus === 'Approved' ? `Supervisor รับรองแล้ว${inspection.ReviewerName ? ` โดย ${escapeHtml(inspection.ReviewerName)}` : ''}` : reviewStatus === 'Returned' ? 'รายการนี้ถูกส่งกลับแล้ว กรุณาเลือกวันที่วันนี้เพื่อแก้ไข' : 'ส่งผลตรวจแล้ว กำลังรอ Supervisor ตรวจรับ'}</p>`;
    } else if (!inspection && !canEdit) {
      readOnly = '<p class="five-s-readonly-note">ยังไม่ส่งผลตรวจ</p>';
    }
    return `<article class="five-s-checkpoint-card">
      <div class="five-s-card-head"><div><span class="five-s-category">${escapeHtml(row.Category)}</span><h4>${escapeHtml(row.CheckpointName)}</h4><p>${escapeHtml(row.Area)} · กะ ${escapeHtml(row.Shift)} · Leader ${escapeHtml(row.LeaderName)}</p></div><span class="five-s-status ${resultClass}">${resultLabel}</span></div>
      ${referencePhoto}
      <p class="five-s-standard"><strong>มาตรฐาน:</strong> ${escapeHtml(row.StandardText)}</p>
      ${reviewSummary}${inspection?.Remark ? `<div class="five-s-saved-meta"><strong>หมายเหตุ Leader:</strong> ${escapeHtml(inspection.Remark)}</div>` : ''}${returnedNote}
      ${photo}${form}${reviewPanel}${readOnly}</article>`;
  }).join('');
}

function handleFiveSInspectionChange(event) {
  const input = event.target.closest('input[name="photo"]');
  if (!input) return;
  const preview = input.closest('form')?.querySelector('.five-s-photo-upload-preview');
  const file = input.files?.[0];
  if (!preview) return;
  if (preview.dataset.previewUrl) URL.revokeObjectURL(preview.dataset.previewUrl);
  preview.dataset.previewUrl = file ? URL.createObjectURL(file) : '';
  preview.innerHTML = file ? `<img src="${escapeAttr(preview.dataset.previewUrl)}" alt="ตัวอย่างรูปที่จะส่ง"><span>${escapeHtml(file.name)}</span>` : '';
}

async function handleFiveSReviewClick(event) {
  const button = event.target.closest('[data-five-s-review]');
  if (!button) return;
  const decision = button.dataset.fiveSReview;
  const checkpointId = button.dataset.checkpointId;
  const card = button.closest('[data-five-s-review-card]');
  const reviewRemark = card?.querySelector('[data-five-s-review-remark]')?.value.trim() || '';
  if (decision === 'return' && !reviewRemark) {
    showToast('กรุณาระบุเหตุผลก่อนส่งกลับให้ Leader แก้ไข', 'warning');
    card?.querySelector('[data-five-s-review-remark]')?.focus();
    return;
  }
  const buttons = card?.querySelectorAll('[data-five-s-review]') || [];
  buttons.forEach(item => { item.disabled = true; });
  try {
    showLoading(decision === 'approve' ? 'กำลังรับรองผลตรวจ...' : 'กำลังส่งผลตรวจกลับให้ Leader...');
    await apiCall('reviewFiveSInspection', {
      inspectionDate: state.fiveSBoard?.inspectionDate || localDateInput(new Date()),
      checkpointId, decision, reviewRemark
    });
    showToast(decision === 'approve' ? 'รับรองผลตรวจแล้ว' : 'ส่งกลับให้ Leader แก้ไขแล้ว', 'success');
    await loadFiveSPage();
  } catch (error) {
    showToast(error.message || 'ตรวจรับผลไม่สำเร็จ', 'error');
    buttons.forEach(item => { item.disabled = false; });
  } finally { hideLoading(); }
}

async function handleFiveSInspectionSubmit(event) {
  const form = event.target.closest('[data-five-s-form]');
  if (!form) return;
  event.preventDefault();
  if (!form.reportValidity()) return;
  const checkpointId = form.dataset.checkpointId;
  const date = state.fiveSBoard?.inspectionDate || localDateInput(new Date());
  const file = form.querySelector('input[name="photo"]')?.files?.[0];
  const result = form.querySelector('[name="result"]')?.value || '';
  const remark = form.querySelector('[name="remark"]')?.value.trim() || '';
  if (!file) { showToast('กรุณาถ่ายหรือเลือกภาพของจุดตรวจนี้', 'warning'); return; }
  if (result === 'NeedAction' && !remark) { showToast('กรุณาระบุสิ่งที่ต้องปรับปรุง', 'warning'); return; }
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    showLoading('กำลังอัปโหลดรูปและบันทึกผลตรวจ...');
    const relatedId = `${date}|${checkpointId}`;
    const upload = await uploadFile(file, 'FiveSInspection', relatedId, 'Evidence', false);
    if (!upload?.DriveFileURL) throw new Error('อัปโหลดรูปไม่สำเร็จ กรุณาลองอีกครั้ง');
    await apiCall('submitFiveSInspection', { inspectionDate: date, checkpointId, result, remark, photoUrl: upload.DriveFileURL });
    showToast('บันทึกผลตรวจพร้อมรูปแล้ว', 'success');
    await loadFiveSPage();
  } catch (error) {
    showToast(error.message || 'บันทึกผลตรวจไม่สำเร็จ', 'error');
    submitButton.disabled = false;
  } finally { hideLoading(); }
}

function showLogin() { $('#loginView').classList.remove('hidden'); $('#appView').classList.add('hidden'); $('#username').focus(); }
function showApplication() { $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden'); }
function openMobileDrawer() {
  const sidebar = $('#sidebar');
  const backdrop = $('#sidebarBackdrop');
  const menuBtn = $('#menuButton');
  sidebar.classList.add('open');
  backdrop.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  if (menuBtn) menuBtn.setAttribute('aria-expanded', 'true');
}
function closeMobileDrawer() {
  const sidebar = $('#sidebar');
  const backdrop = $('#sidebarBackdrop');
  const menuBtn = $('#menuButton');
  sidebar.classList.remove('open');
  backdrop.classList.add('hidden');
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
  document.body.style.pointerEvents = '';
  if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
}
function toggleMobileDrawer() {
  if ($('#sidebar').classList.contains('open')) closeMobileDrawer(); else openMobileDrawer();
}
// An Apps Script round trip costs seconds even when it succeeds, and the retry
// ladder can ride out an outage for far longer. A motionless spinner over that
// window is what users report as "ค้าง", so once a wait passes this many seconds
// the overlay starts counting out loud — same spinner, visibly still alive.
const BUSY_HINT_AFTER_SECONDS = 5;
let busyStartedAt = 0;
let busyHintTimer = null;
let busyHintText = '';

function setLoadingHint(text) {
  busyHintText = text || '';
  renderLoadingHint();
}

function renderLoadingHint() {
  const hint = $('#loadingHint');
  if (!hint) return;
  const seconds = busyStartedAt ? Math.round((Date.now() - busyStartedAt) / 1000) : 0;
  if (!busyHintText && seconds < BUSY_HINT_AFTER_SECONDS) {
    hint.textContent = '';
    hint.classList.add('hidden');
    return;
  }
  const base = busyHintText || 'ระบบยังทำงานอยู่ กรุณารอสักครู่';
  hint.textContent = seconds >= BUSY_HINT_AFTER_SECONDS ? `${base} (${seconds} วินาที)` : base;
  hint.classList.remove('hidden');
}

// Input is blocked purely in CSS (.is-busy #loginView/#appView { pointer-events:none }).
// The old implementation also walked every button/input/select/textarea in the
// document to toggle .disabled — thousands of layout-invalidating writes on both
// sides of every single API call, which is what made the UI feel sluggish.
function showLoading(message = 'กำลังโหลด...') {
  busyDepth++;
  busyMessages.push(message);
  $('#loadingText').textContent = message;
  $('#loadingOverlay').classList.remove('hidden');
  document.body.classList.add('is-busy');
  document.body.setAttribute('aria-busy', 'true');
  if (busyDepth === 1) {
    busyStartedAt = Date.now();
    busyHintText = '';
    renderLoadingHint();
    clearInterval(busyHintTimer);
    busyHintTimer = setInterval(renderLoadingHint, 1000);
  }
}

function hideLoading() {
  if (busyDepth > 0) busyDepth--;
  busyMessages.pop();
  if (busyDepth > 0) {
    $('#loadingText').textContent = busyMessages[busyMessages.length - 1] || 'กำลังโหลด...';
    return;
  }
  busyDepth = 0;
  busyMessages.length = 0;
  clearInterval(busyHintTimer);
  busyHintTimer = null;
  busyStartedAt = 0;
  busyHintText = '';
  const hint = $('#loadingHint');
  if (hint) { hint.textContent = ''; hint.classList.add('hidden'); }
  $('#loadingOverlay').classList.add('hidden');
  document.body.classList.remove('is-busy');
  document.body.removeAttribute('aria-busy');
}

async function withBusy(message, asyncFunction) {
  showLoading(message);
  try {
    return await asyncFunction();
  } finally {
    hideLoading();
  }
}

function showToast(message, type = 'info', duration = 4500) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  $('#toastContainer').appendChild(toast);
  setTimeout(() => toast.remove(), duration);
  return toast;
}

// window.confirm() paints the browser's own "<host> says" alert, which looks
// nothing like the rest of the app. showConfirm() drives a styled <dialog>
// instead and resolves the same true/false, so call sites just await it.
const CONFIRM_TONE_ICONS = { primary: '?', danger: '!', warning: '!', success: '✓' };
let confirmDialogResolve = null;

function showConfirm(options) {
  const config = typeof options === 'string' ? { message: options } : (options || {});
  const dialog = $('#confirmDialog');
  if (!dialog || typeof dialog.showModal !== 'function') {
    return Promise.resolve(window.confirm(config.message || config.title || 'ยืนยันการทำรายการ?'));
  }
  settleConfirmDialog(false);
  const tone = config.tone || 'primary';
  dialog.className = `modal confirm-modal tone-${tone}`;
  $('#confirmDialogIcon').textContent = config.icon || CONFIRM_TONE_ICONS[tone] || '?';
  $('#confirmDialogTitle').textContent = config.title || 'ยืนยันการทำรายการ';
  const messageElement = $('#confirmDialogMessage');
  if (config.messageHtml) messageElement.innerHTML = config.messageHtml;
  else messageElement.textContent = config.message || '';
  const okButton = $('#confirmDialogOk');
  const cancelButton = $('#confirmDialogCancel');
  okButton.textContent = config.confirmText || 'ยืนยัน';
  cancelButton.textContent = config.cancelText || 'ยกเลิก';
  cancelButton.hidden = Boolean(config.confirmOnly);
  okButton.className = `btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`;
  dialog.showModal();
  // Destructive prompts start on Cancel so a stray Enter cannot delete anything.
  (tone === 'danger' ? cancelButton : okButton).focus();
  return new Promise(resolve => { confirmDialogResolve = resolve; });
}

// Buttons, Escape and backdrop clicks all land here. The resolver is cleared
// before close() so the resulting 'close' event settles nothing a second time.
function settleConfirmDialog(result) {
  const resolve = confirmDialogResolve;
  confirmDialogResolve = null;
  const dialog = $('#confirmDialog');
  if (dialog && dialog.open) dialog.close();
  if (resolve) resolve(result);
}

function findingReportTable(rows) {
  return rows.length ? tableHtml(['FindingID', 'Problem', 'Line', 'PIC', 'Due Date', 'Status'], rows.map(row => [row.FindingID, row.ProblemDetail, row.LineName || row.LineID, row.PICName, formatDate(row.DueDate), row.Status])) : emptyHtml('ไม่มีข้อมูล');
}

function tableHtml(headers, rows, extraClass = '') {
  if (!rows.length) return emptyHtml('ไม่มีข้อมูล');
  return `<table class="data-table${extraClass ? ' ' + extraClass : ''}"><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(String(cell ?? '-'))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

// Inline thumbnails (not bare "Before/After" text links) so a Finding's evidence
// is visible at a glance in the list — the point when this is projected in a meeting.
function findingPhotoGallery(row) {
  const items = [];
  const addPhotos = (urlCsv, label) => {
    String(urlCsv || '').split(',').map(u => u.trim()).filter(Boolean).forEach((u, i, arr) => {
      const caption = arr.length > 1 ? `${label} ${i + 1}` : label;
      items.push(`<a href="${escapeAttr(u)}" data-photo-url="${escapeAttr(u)}" class="finding-photo-thumb photo-link-trigger" rel="noopener"><img src="${escapeAttr(driveThumbnailUrl_(u, 300))}" alt="${escapeAttr(caption)}" loading="lazy"><span>${escapeHtml(caption)}</span></a>`);
    });
  };
  addPhotos(row.BeforePhotoURL, 'Before');
  addPhotos(row.AfterPhotoURL, 'After');
  return items.length ? `<div class="finding-photos">${items.join('')}</div>` : '';
}

// Opens Before/After photo links inline instead of letting them navigate to
// Google Drive. Delegated on document so it covers both the finding-card
// list and the finding edit dialog's thumbnails without per-render binding.
// Accepts a whole gallery (array of URLs) so ‹ › buttons and arrow keys can
// page through without closing and reopening the dialog.
let photoLightboxUrls = [];
let photoLightboxIndex = 0;
let photoLightboxTvZoom = false;
let photoLightboxZoom = 1;
let photoLightboxPan = { x: 0, y: 0 };
let photoLightboxPointer = null;

function openPhotoLightbox(urls, index = 0, options = {}) {
  photoLightboxUrls = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  if (!photoLightboxUrls.length) return;
  photoLightboxIndex = Math.min(Math.max(index, 0), photoLightboxUrls.length - 1);
  photoLightboxTvZoom = Boolean(options.enableZoom);
  photoLightboxZoom = 1;
  photoLightboxPan = { x: 0, y: 0 };
  $('#photoLightbox').classList.toggle('is-tv-zoomable', photoLightboxTvZoom);
  $('#photoLightboxZoomControls').classList.toggle('hidden', !photoLightboxTvZoom);
  renderPhotoLightbox();
  $('#photoLightbox').showModal();
}

function renderPhotoLightbox() {
  const multi = photoLightboxUrls.length > 1;
  const image = $('#photoLightboxImage');
  image.src = driveThumbnailUrl_(photoLightboxUrls[photoLightboxIndex], photoLightboxTvZoom ? 2560 : 1920);
  image.alt = `รูปภาพ ${photoLightboxIndex + 1} จาก ${photoLightboxUrls.length}`;
  $('#photoLightboxPrev').classList.toggle('hidden', !multi);
  $('#photoLightboxNext').classList.toggle('hidden', !multi);
  const counter = $('#photoLightboxCounter');
  counter.classList.toggle('hidden', !multi);
  counter.textContent = `${photoLightboxIndex + 1} / ${photoLightboxUrls.length}`;
  updatePhotoLightboxZoom();
}

function updatePhotoLightboxZoom() {
  const image = $('#photoLightboxImage');
  if (!image) return;
  image.style.transform = photoLightboxTvZoom
    ? `translate(${photoLightboxPan.x}px, ${photoLightboxPan.y}px) scale(${photoLightboxZoom})`
    : '';
  $('#photoLightbox').classList.toggle('is-zoomed', photoLightboxTvZoom && photoLightboxZoom > 1);
  $('#photoLightboxZoomReset').textContent = `${Math.round(photoLightboxZoom * 100)}%`;
  $('#photoLightboxZoomOut').disabled = photoLightboxZoom <= 1;
  $('#photoLightboxZoomIn').disabled = photoLightboxZoom >= 3;
}

function clampPhotoLightboxPan() {
  const image = $('#photoLightboxImage');
  const maxX = Math.max(0, image.offsetWidth * (photoLightboxZoom - 1) / 2);
  const maxY = Math.max(0, image.offsetHeight * (photoLightboxZoom - 1) / 2);
  photoLightboxPan.x = Math.max(-maxX, Math.min(maxX, photoLightboxPan.x));
  photoLightboxPan.y = Math.max(-maxY, Math.min(maxY, photoLightboxPan.y));
}

function setPhotoLightboxZoom(value) {
  if (!photoLightboxTvZoom) return;
  photoLightboxZoom = Math.min(3, Math.max(1, Math.round(value * 100) / 100));
  if (photoLightboxZoom === 1) photoLightboxPan = { x: 0, y: 0 };
  clampPhotoLightboxPan();
  updatePhotoLightboxZoom();
}

function resetPhotoLightboxZoom() {
  photoLightboxZoom = 1;
  photoLightboxPan = { x: 0, y: 0 };
  updatePhotoLightboxZoom();
}

function startPhotoLightboxPan(event) {
  if (!photoLightboxTvZoom || photoLightboxZoom <= 1 || event.button !== 0) return;
  event.preventDefault();
  photoLightboxPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  event.currentTarget.setPointerCapture(event.pointerId);
  $('#photoLightbox').classList.add('is-dragging');
}

function movePhotoLightboxPan(event) {
  if (!photoLightboxPointer || photoLightboxPointer.id !== event.pointerId) return;
  photoLightboxPan.x += event.clientX - photoLightboxPointer.x;
  photoLightboxPan.y += event.clientY - photoLightboxPointer.y;
  photoLightboxPointer.x = event.clientX;
  photoLightboxPointer.y = event.clientY;
  clampPhotoLightboxPan();
  updatePhotoLightboxZoom();
}

function endPhotoLightboxPan(event) {
  if (!photoLightboxPointer || photoLightboxPointer.id !== event.pointerId) return;
  photoLightboxPointer = null;
  $('#photoLightbox').classList.remove('is-dragging');
}

function stepPhotoLightbox(delta) {
  if (photoLightboxUrls.length < 2) return;
  photoLightboxIndex = (photoLightboxIndex + delta + photoLightboxUrls.length) % photoLightboxUrls.length;
  photoLightboxZoom = 1;
  photoLightboxPan = { x: 0, y: 0 };
  renderPhotoLightbox();
}

function closePhotoLightbox() {
  const dialog = $('#photoLightbox');
  if (dialog.open) dialog.close();
}

function statusClass(status) {
  const value = String(status || '').toLowerCase().replace(/\s+/g, '-');
  if (value === 'open') return 'status-open';
  if (['on-going', 'ongoing', 'in-progress'].includes(value)) return 'status-on-going';
  if (['assigned', 'pending-verification', 'rejected'].includes(value)) return 'status-on-going';
  if (value === 'closed') return 'status-closed';
  if (value === 'ok') return 'status-ok';
  if (value === 'ng') return 'status-ng';
  if (['overdue', 'missed', 'late-submitted'].includes(value)) return 'status-overdue';
  if (value === 'due-today') return 'status-on-going';
  return 'status-na';
}

function auditPlanStatusClass(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'due today') return 'status-plan-due';
  if (value === 'completed') return 'status-plan-completed';
  if (value === 'overdue') return 'status-plan-overdue';
  if (value === 'missed') return 'status-plan-missed';
  if (value === 'late submitted') return 'status-plan-late';
  return 'status-plan-planned';
}

function hasPermission(permissionKey) {
  if (!state.user) return false;
  const permissions = state.user.permissions || [];
  if (state.user.Role === 'Admin' || permissions.includes('*') || permissions.includes(permissionKey)) return true;
  return permissionKey === 'users.view' && permissions.includes('users.managePermission');
}

function hasAnyPermission(keys) {
  return keys.some(hasPermission);
}

function applyPermissionVisibility() {
  $$('[data-permission-any]').forEach(element => {
    const keys = element.dataset.permissionAny.split(',').map(value => value.trim());
    element.classList.toggle('hidden', !hasAnyPermission(keys));
  });
  const canViewAdmin = hasAnyPermission(['users.view', 'users.managePermission']);
  $('#adminNavButton').classList.toggle('hidden', !canViewAdmin);
  $('#addUserButton').classList.toggle('hidden', !hasPermission('users.create'));
  $('#exportCsvButton').classList.toggle('hidden', !hasPermission('reports.export'));
  $('#addAuditRuleButton').classList.toggle('hidden', !hasPermission('audit.plan.manage'));
  $('#addMeetingPostButton').classList.toggle('hidden', !hasPermission('meeting.create'));
  $('#meetingPostPinnedField').classList.toggle('hidden', !hasPermission('meeting.manage'));
  // Customer is an external account — the internal pre-shift Meeting board is
  // always hidden for them, even if a stray meeting.view permission slips in.
  if (String(state.user?.Role || '').toLowerCase() === 'customer') {
    $$('#mainNav [data-page="meeting"], #mainNav [data-page="training"]').forEach(btn => btn.classList.add('hidden'));
  }
  $('#shiftManagementPanel').classList.toggle('hidden', String(state.user?.Role || '').toLowerCase() !== 'admin');
}

function applyAuditPlanRoleScope() {
  const role = String(state.user?.Role || '').toLowerCase();
  const roleSelect = $('#planRole');
  const scopes = {
    admin: ['', 'Leader', 'Supervisor', 'Manager'],
    manager: ['', 'Leader', 'Supervisor', 'Manager'],
    supervisor: ['', 'Leader', 'Supervisor'],
    leader: ['Leader']
  };
  const roles = scopes[role] || ['', 'Leader', 'Supervisor', 'Manager'];
  roleSelect.innerHTML = roles.map(value =>
    `<option value="${value}">${value || 'ทั้งหมด'}</option>`
  ).join('');
  if (role === 'leader') {
    roleSelect.value = 'Leader';
    roleSelect.disabled = true;
  } else {
    roleSelect.disabled = false;
  }
}

function applyAuditLayerPermissions() {
  const layerPermissions = [
    ['Leader', 'audit.leader.create'],
    ['Engineer', 'audit.engineer.create'],
    ['Supervisor', 'audit.supervisor.create'],
    ['Manager', 'audit.manager.create']
  ];
  const allowedLayers = layerPermissions
    .filter(([, permission]) => hasPermission(permission))
    .map(([layer]) => layer);
  const select = $('#auditLayer');
  const loadButton = $('#loadChecklistButton');
  select.innerHTML = allowedLayers.length
    ? allowedLayers.map(layer => `<option value="${layer}">${layer}</option>`).join('')
    : '<option value="">ไม่มีสิทธิ์สร้าง Audit</option>';
  select.disabled = allowedLayers.length <= 1;
  loadButton.disabled = allowedLayers.length === 0;
  if (allowedLayers.length === 1) select.value = allowedLayers[0];
  if (!allowedLayers.length) showToast('คุณไม่มีสิทธิ์สร้างรายการตรวจ LPA', 'warning');
}

function setDefaultDates() {
  const now = new Date();
  const today = localDateInput(now);
  const dateEl = $('#auditDate');
  dateEl.value = today;
  // No date lock — all roles can backdate (needed for shift work / missed entries)
  dateEl.min = '';
  dateEl.max = today; // Cannot audit future dates
  dateEl.readOnly = false;
  $('#auditTime').value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  $('#findingMonth').value = '';
  $('#reportMonth').value = month;
  updateLateReasonVisibility();
}

function fileToBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ')); reader.readAsDataURL(file); }); }

// Multiple problems in one NG checklist item, each in its own textarea —
// each non-empty item becomes a separate Finding on the backend (saveAudit),
// instead of forcing the auditor to number them inside one long box.
function fieldValues(root, field) { return $$(`[data-field="${field}"]`, root).map(el => el.value.trim()).filter(Boolean); }

function addFindingDetailItem(card, value = '') {
  const list = $('[data-field="findingDetailList"]', card);
  if (!list) return;
  const item = document.createElement('div');
  item.className = 'finding-detail-item';
  item.innerHTML = `<span class="finding-detail-index"></span><textarea data-field="findingDetailItem" rows="2" placeholder="อธิบายปัญหาที่พบ"></textarea><button type="button" class="finding-detail-remove" data-remove-finding-detail aria-label="ลบปัญหานี้">×</button>`;
  list.appendChild(item);
  $('textarea', item).value = value;
  wireFindingDetailItem(card, item);
  renumberFindingDetailItems(card);
  updateAuditSaveButtonState();
  return item;
}

function wireFindingDetailItem(card, item) {
  const textarea = $('textarea', item);
  textarea.addEventListener('input', updateAuditSaveButtonState);
  const removeBtn = $('[data-remove-finding-detail]', item);
  if (!removeBtn) return;
  removeBtn.addEventListener('click', () => {
    item.remove();
    renumberFindingDetailItems(card);
    updateAuditSaveButtonState();
    saveAuditDraft();
  });
}

function renumberFindingDetailItems(card) {
  const items = $$('.finding-detail-item', card);
  items.forEach((item, i) => {
    const indexEl = $('.finding-detail-index', item);
    if (indexEl) indexEl.textContent = String(i + 1);
    const removeBtn = $('[data-remove-finding-detail]', item);
    if (removeBtn) removeBtn.hidden = items.length <= 1;
  });
}

function clearFindingDetailItems(card) {
  const list = $('[data-field="findingDetailList"]', card);
  if (list) list.innerHTML = '';
}

function setFindingDetailItems(card, items) {
  clearFindingDetailItems(card);
  const values = items && items.length ? items : [''];
  values.forEach(value => addFindingDetailItem(card, value));
}
function fieldValue(root, field) { const element = $(`[data-field="${field}"]`, root); return element ? element.value.trim() : ''; }

// --- Audit Draft (localStorage) ---
const AUDIT_DRAFT_KEY = 'lpa_audit_draft';
const AUDIT_DRAFT_MAX_AGE = 24 * 60 * 60 * 1000;

function saveAuditDraft() {
  if (!state.checklist.length || state.auditSaveInProgress) return;
  const ngData = {};
  $$('.checklist-card').forEach(card => {
    const id = card.dataset.checklistId;
    if (state.auditAnswers[id]?.result === 'NG') {
      ngData[id] = {
        findingDetails: fieldValues(card, 'findingDetailItem'),
        correctiveAction: fieldValue(card, 'correctiveAction'),
        assignedRole: getSelectedRoles(card).join(','),
        dueDate: fieldValue(card, 'dueDate'),
        remark: fieldValue(card, 'remark')
      };
    }
  });
  try {
    localStorage.setItem(AUDIT_DRAFT_KEY, JSON.stringify({
      lineId: $('#auditLine').value,
      stationId: $('#auditStation').value,
      auditLayer: $('#auditLayer').value,
      language: $('#checklistLanguage').value,
      remark: $('#auditRemark')?.value || '',
      answers: state.auditAnswers,
      ngData,
      savedAt: Date.now()
    }));
  } catch (_) {}
}

function clearAuditDraft() {
  try { localStorage.removeItem(AUDIT_DRAFT_KEY); } catch (_) {}
}

function getAuditDraft() {
  try {
    const raw = localStorage.getItem(AUDIT_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft.lineId || !draft.stationId || Date.now() - draft.savedAt > AUDIT_DRAFT_MAX_AGE) {
      clearAuditDraft(); return null;
    }
    return draft;
  } catch (_) { return null; }
}

async function restoreAuditDraft(draft) {
  const lineEl = $('#auditLine');
  lineEl.value = draft.lineId;
  lineEl.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));
  const stEl = $('#auditStation');
  stEl.value = draft.stationId;
  stEl.dispatchEvent(new Event('change', { bubbles: true }));
  const layerEl = $('#auditLayer');
  if (draft.auditLayer) layerEl.value = draft.auditLayer;
  const langEl = $('#checklistLanguage');
  if (draft.language) langEl.value = draft.language;
  await loadChecklist();
  // Apply answers
  $$('.checklist-card').forEach(card => {
    const id = card.dataset.checklistId;
    const answer = draft.answers?.[id];
    if (!answer?.result) return;
    const btn = $(`.result-button[data-result="${answer.result}"]`, card);
    if (btn) btn.click();
    if (answer.result === 'NG' && draft.ngData?.[id]) {
      const ng = draft.ngData[id];
      const set = (field, val) => { const el = $(`[data-field="${field}"]`, card); if (el && val) { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); } };
      if (ng.findingDetails?.length) setFindingDetailItems(card, ng.findingDetails);
      else if (ng.findingDetail) setFindingDetailItems(card, [ng.findingDetail]); // legacy single-field drafts
      set('correctiveAction', ng.correctiveAction);
      set('assignedRole', ng.assignedRole);
      set('dueDate', ng.dueDate);
      set('remark', ng.remark);
    }
  });
  if (draft.remark && $('#auditRemark')) $('#auditRemark').value = draft.remark;
  updateAuditSaveButtonState();
  showToast('กู้คืนร่าง Audit ที่บันทึกไว้อัตโนมัติ', 'info', 5000);
}
function fieldFile(root, field) { const element = $(`[data-field="${field}"]`, root); return element && element.files ? element.files[0] : null; }
function fieldFiles(root, field) { const element = $(`[data-field="${field}"]`, root); return element && element.files ? Array.from(element.files) : []; }
function selectedText(selector) { const select = $(selector); return select.selectedIndex >= 0 ? select.options[select.selectedIndex].text : ''; }
function monthToPeriod(value) { return value || ''; }
function optionalFilterValue(value) {
  const normalized = String(value ?? '').trim();
  return ['', 'all', 'ทั้งหมด', 'null', 'undefined'].includes(normalized.toLowerCase()) ? '' : normalized;
}
function formatPeriod(value) {
  const text = String(value || '');
  if (/^\d{4}-\d{2}$/.test(text)) return `${text.slice(5, 7)}/${text.slice(0, 4)}`;
  if (/^\d{6}$/.test(text)) return `${text.slice(4, 6)}/${text.slice(0, 4)}`;
  return text || '-';
}
function formatDate(value) { const text = String(value || ''); const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/); return match ? `${match[3]}/${match[2]}/${match[1]}` : text || '-'; }
function dateInputValue(value) { const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/); return match ? match[0] : ''; }
function localDateInput(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function normalizeEditableStatus(status) { const options = ['Open', 'Assigned', 'In Progress', 'Pending Verification', 'Closed', 'Rejected']; return options.find(option => option.toLowerCase() === String(status || '').toLowerCase()) || 'Open'; }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function emptyHtml(message) { return `<div class="empty-state">${escapeHtml(message)}</div>`; }
function isTokenError(message) { return /token|expired|authentication|session/i.test(message); }

// Translate backend (English) error messages to Thai before showing them to users.
// Pattern rules run first (messages with dynamic parts), then exact matches.
const API_MESSAGE_PATTERNS = [
  [/^Unknown action: (.+)$/, m => `เซิร์ฟเวอร์ยังเป็นเวอร์ชันเก่า ไม่รู้จักคำสั่ง "${m[1]}" — กรุณาแจ้งผู้ดูแลระบบให้ Deploy เวอร์ชันใหม่`],
  [/^Permission denied for action: (.+)$/, m => `คุณไม่มีสิทธิ์ใช้งานส่วนนี้ (${m[1]})`],
  [/^Permission denied: (.+)$/, m => `คุณไม่มีสิทธิ์ดำเนินการนี้ (${m[1]})`],
  [/^Line access denied: (.*)$/, m => `คุณไม่มีสิทธิ์เข้าถึง Line ${m[1] || 'นี้'}`],
  [/^Missing required field\(s\): (.+)$/, m => `กรุณากรอกข้อมูลให้ครบ: ${m[1]}`],
  [/^Required sheet not found: (.+)$/, m => `ไม่พบชีทข้อมูล "${m[1]}" ในระบบ กรุณาแจ้งผู้ดูแลระบบ`],
  [/^Unsupported fileType: (.+)$/, m => `ประเภทไฟล์ไม่รองรับ (${m[1]})`],
  [/^(.+FOLDER_ID) is not configured in Settings\.$/, m => `ยังไม่ได้ตั้งค่าโฟลเดอร์เก็บไฟล์ (${m[1]}) กรุณาแจ้งผู้ดูแลระบบ`],
  [/^Meeting post not found: (.+)$/, m => `ไม่พบหัวข้อประชุม ${m[1]} (อาจถูกลบไปแล้ว)`],
  [/^Invalid meetingDate: (.+)$/, m => `วันที่ประชุมไม่ถูกต้อง (${m[1]})`],
  [/^Invalid status: (.+)$/, m => `สถานะไม่ถูกต้อง (${m[1]})`]
];
const API_MESSAGE_EXACT = {
  'Invalid or expired authentication token.': 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่',
  'Invalid username or password.': 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
  'Too many failed login attempts. Please try again in 10 minutes.': 'เข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารอ 10 นาทีแล้วลองใหม่',
  'User account is unavailable.': 'บัญชีผู้ใช้ถูกปิดใช้งานหรือไม่พร้อมใช้งาน',
  'User role is not valid.': 'Role ของผู้ใช้ไม่ถูกต้อง กรุณาแจ้งผู้ดูแลระบบ',
  'You do not have permission to edit this post.': 'คุณไม่มีสิทธิ์แก้ไขหัวข้อนี้ (แก้ไขได้เฉพาะหัวข้อที่ตัวเองสร้าง)',
  'You do not have permission to delete this post.': 'คุณไม่มีสิทธิ์ลบหัวข้อนี้ (ลบได้เฉพาะหัวข้อที่ตัวเองสร้าง)',
  'You do not have permission to update this post.': 'คุณไม่มีสิทธิ์อัปเดตหัวข้อนี้',
  'You do not have permission to upload to this finding.': 'คุณไม่มีสิทธิ์อัปโหลดไฟล์ใน Finding นี้',
  'Topic is required.': 'กรุณากรอกหัวข้อ',
  'File exceeds the 10 MB upload limit.': 'ไฟล์ใหญ่เกิน 10 MB กรุณาย่อรูปหรือเลือกไฟล์ใหม่',
  'Uploaded file is empty.': 'ไฟล์ที่อัปโหลดว่างเปล่า กรุณาเลือกไฟล์ใหม่',
  'base64Data is invalid.': 'ไฟล์เสียหาย กรุณาลองอัปโหลดใหม่',
  'Unexpected server error.': 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง',
  'Request body is required.': 'คำขอไม่ถูกต้อง กรุณารีเฟรชหน้าเว็บแล้วลองใหม่',
  'Invalid JSON request body.': 'คำขอไม่ถูกต้อง กรุณารีเฟรชหน้าเว็บแล้วลองใหม่'
};
function translateApiMessage(message) {
  const text = String(message || '');
  if (API_MESSAGE_EXACT[text]) return API_MESSAGE_EXACT[text];
  for (const [pattern, build] of API_MESSAGE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return build(match);
  }
  return text;
}
function readStoredJson(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]); }
function escapeAttr(value) { return escapeHtml(value); }
function cssEscape(value) { return window.CSS && CSS.escape ? CSS.escape(String(value)) : String(value).replace(/["\\]/g, '\\$&'); }
