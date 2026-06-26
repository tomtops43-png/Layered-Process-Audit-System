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
  lastNotificationKey: ''
};

const PERMISSION_CATALOG = [
  'users.view', 'users.create', 'users.update', 'users.deactivate', 'users.resetPassword', 'users.managePermission',
  'audit.manager.create', 'audit.supervisor.create', 'audit.engineer.create', 'audit.leader.create', 'audit.view.all', 'audit.view.line', 'audit.view.own',
  'findings.view.all', 'findings.view.line', 'findings.view.assigned', 'findings.view.created', 'findings.assign',
  'findings.update.line', 'findings.update.assigned', 'findings.verify', 'findings.close.minor',
  'findings.close.major', 'findings.close.critical', 'dashboard.view', 'dashboard.view.all',
  'reports.view', 'reports.export', 'checklist.view', 'checklist.manage',
  'audit.plan.view', 'audit.plan.manage', 'audit.plan.generate', 'audit.plan.refresh'
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
let busyDepth = 0;
const busyMessages = [];
const busyDisabledState = new Map();

window.addEventListener('DOMContentLoaded', initApp);

function initApp() {
  document.title = CONFIG.APP_NAME;
  bindVisualViewport();
  bindEvents();
  setDefaultDates();
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
  $('#findingLine').addEventListener('change', () => populateStationSelect('#findingStation', $('#findingLine').value, true));
  $('#checklistLine').addEventListener('change', () => populateStationSelect('#checklistStation', $('#checklistLine').value, false));
  $('#applyFindingFilters').addEventListener('click', loadFindings);
  $('#refreshFindings').addEventListener('click', () => loadFindings(true));
  $('#loadReportButton').addEventListener('click', loadMonthlyReport);
  $('#printReportButton').addEventListener('click', () => window.print());
  $('#exportCsvButton').addEventListener('click', exportReportCsv);
  $('#loadMasterChecklistButton').addEventListener('click', loadMasterChecklist);
  $('#findingForm').addEventListener('submit', event => event.preventDefault());
  $('#editAfterPhoto').addEventListener('change', event => renderPhotoPreview(event.target, '#editPhotoPreview', state.editingFinding?.AfterPhotoURL));
  $('#closeFindingDialog').addEventListener('click', () => $('#findingDialog').close());
  $('#cancelFindingEdit').addEventListener('click', () => $('#findingDialog').close());
  $('#submitVerificationButton').addEventListener('click', submitFindingForVerification);
  $('#approveFindingButton').addEventListener('click', () => verifyFinding('Approve'));
  $('#rejectFindingButton').addEventListener('click', () => verifyFinding('Reject'));
  ['#editCloseRemark', '#editRejectReason'].forEach(selector => {
    $(selector).addEventListener('input', event => event.target.classList.remove('field-error'));
  });
  $('#addUserButton').addEventListener('click', () => openUserEditor());
  $('#migrateRulesBtn').addEventListener('click', async () => {
    if (!confirm('แปลง Rule ระดับ Station ทั้งหมด → Line Level?\n(ลบ Rule เก่า สร้าง Rule ใหม่ 1 ต่อ 1 Line)\nไม่สามารถย้อนกลับได้')) return;
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
    if (!confirm('ลบ Rule ที่ซ้ำกัน (Line+Role+Frequency เดียวกัน) ออก?\nจะเหลือ 1 Rule ต่อ Line')) return;
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

async function apiCall(action, payload = {}) {
  const TIMEOUT_MS = (action === 'uploadFile' || action === 'saveAudit') ? 90000 : 45000;
  const { promise: timeoutPromise, cancel: cancelTimeout } = makeWorkerTimeout(TIMEOUT_MS);
  const timeoutMsg = `ระบบใช้เวลานานเกินไป (${TIMEOUT_MS / 1000}s) กรุณาลองใหม่อีกครั้ง`;
  const fetchPromise = fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token: state.token || '', payload })
  }).then(async response => {
    cancelTimeout();
    if (!response.ok) throw new Error(`เซิร์ฟเวอร์ตอบกลับ HTTP ${response.status}`);
    const result = await response.json();
    if (!result.success) {
      const message = result.message || 'ไม่สามารถดำเนินการได้';
      if (isTokenError(message) && action !== 'login') {
        logout(false);
        showToast('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่', 'warning');
      }
      throw new Error(message);
    }
    return result.data || {};
  });
  try {
    return await Promise.race([fetchPromise, timeoutPromise]);
  } catch (error) {
    cancelTimeout();
    if (error.message === '__timeout__') throw new Error(timeoutMsg);
    if (error instanceof TypeError) throw new Error('ไม่สามารถเชื่อมต่อระบบได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
    throw error;
  }
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
  if (validateSession) {
    showLoading('กำลังตรวจสอบ Session...');
    try {
      const current = await apiCall('getCurrentUser', {});
      state.user = current;
      localStorage.setItem('lpa_user', JSON.stringify(state.user));
    } catch (error) {
      showToast(error.message, 'error');
      return;
    } finally {
      hideLoading();
    }
  }
  $('#currentUserName').textContent = state.user.FullName || state.user.Username || '-';
  $('#currentUserRole').textContent = state.user.Role || '-';
  applyPermissionVisibility();
  applyAuditPlanRoleScope();
  applyAuditLayerPermissions();
  showDashboardSkeleton();
  await navigateTo('dashboard');
  // Pre-warm GAS findings cache in background so Finding Tracking page loads fast on first visit
  setTimeout(() => apiCall('getFindings', {}).then(data => {
    if (!state.findingsCache) {
      state.findingsCache = { key: JSON.stringify({}), data: Array.isArray(data.findings) ? data.findings : [], ts: Date.now() };
    }
  }).catch(() => {}), 3000);
  // Prefetch schedule rules when browser is idle (speeds up first LPA Schedule Rules tab visit)
  const idlePrefetch = () => {
    if (!state.auditRules.length && hasPermission('audit.plan.view')) {
      apiCall('getAuditPlanRules', { activeStatus: 'Active', limit: 300 })
        .then(data => { if (!state.auditRules.length) state.auditRules = data.rules || []; })
        .catch(() => {});
    }
  };
  if ('requestIdleCallback' in window) requestIdleCallback(idlePrefetch, { timeout: 8000 });
  else setTimeout(idlePrefetch, 8000);
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
  const isMgrRole = role === 'Manager';
  const isDirRole = role === 'Admin';
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
async function ensureProductionPlan() {
  if (state.productionPlan) return true;
  if (state.productionPlanSkipped) return true;
  // Check sessionStorage cache before hitting GAS
  const planCacheKey = `prod_plan_${localDateInput(new Date())}`;
  const planCached = GASCache.get(planCacheKey);
  if (planCached) {
    if (planCached.isSet) state.productionPlan = { activeLineIds: planCached.activeLineIds, date: planCached.date };
    else state.productionPlanSkipped = true;
    return true;
  }
  try {
    const data = await apiCall('getProductionPlan', {});
    GASCache.set(planCacheKey, data, 60); // cache 60 min — plan doesn't change during the day
    if (data.isSet) {
      state.productionPlan = { activeLineIds: data.activeLineIds, date: data.date };
      return true;
    }
    // Ensure lines are loaded before showing modal
    if (!(state.masterData.lines || []).length) await ensureMasterDataLoaded(false);
    // Not set today — show modal
    await openProductionPlanModal(data);
    if (!state.productionPlan) state.productionPlanSkipped = true; // dismissed → don't show again
    return true;
  } catch (_) {
    return true; // on error, don't block dashboard
  }
}

async function openProductionPlanModal(planData) {
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

    const currentIds = planData?.activeLineIds || null;
    const isAllSelected = currentIds === null; // null = not set yet → default all checked

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
      const countEl = $('.prod-plan-count');
      if (countEl) countEl.textContent = checked > 0 ? `เลือกแล้ว ${checked} จาก ${total} Line` : 'ยังไม่ได้เลือก Line';
      $('#prodPlanToggleAll').textContent = checked === total ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด';
    };

    $('#prodPlanLines').innerHTML =
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
        const saved = await apiCall('saveProductionPlan', { lineIds: selected });
        state.productionPlan = { activeLineIds: saved.activeLineIds, date: saved.date };
        GASCache.invalidate(`prod_plan_${saved.date || localDateInput(new Date())}`);
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
  state.leaderDashData = null;
  GASCache.invalidatePrefix('leader_');
  // Ensure lines are available for the modal
  if (!(state.masterData.lines || []).length) {
    await ensureMasterDataLoaded(false);
  }
  await openProductionPlanModal(null);
  loadLeaderDashboard();
}

async function loadLeaderDashboard() {
  const today = localDateInput(new Date());
  const role = state.user.Role;
  const rolesToFetch = role === 'Supervisor' ? ['Supervisor', 'Leader'] : ['Leader'];
  const ldKey = `leader_${state.user?.UserID}_${today}`;

  // Restore from sessionStorage cache first (survives page refresh — no loading flash)
  if (!state.leaderDashData) {
    const sessionCached = GASCache.get(ldKey);
    if (sessionCached) state.leaderDashData = sessionCached;
  }

  // Render immediately if we have any data
  if (state.leaderDashData) {
    renderLeaderFromData(state.leaderDashData);
    // Check production plan async AFTER render (no blocking)
    ensureProductionPlan();
    // Silent background refresh if cache expired
    if (!GASCache.get(ldKey)) fetchLeaderDashData(ldKey, today, rolesToFetch, true);
    return;
  }

  // True first load (no cache at all) — show skeleton, then check plan, then fetch
  $('#ldHeader').innerHTML = '<div class="ld-header-left"><div class="ld-greeting">กำลังโหลด Dashboard...</div></div>';
  $('#ldMetrics').innerHTML = Array.from({length: 4}, () => '<div class="ld-card skeleton-card" style="min-height:90px"></div>').join('');
  $('#ldTasks').innerHTML = '<div class="empty-state">กำลังโหลด...</div>';
  $('#ldFindings').innerHTML = '<div class="empty-state">กำลังโหลด...</div>';
  await ensureProductionPlan();
  await fetchLeaderDashData(ldKey, today, rolesToFetch, false);
}

function renderLeaderFromData(d) {
  renderLeaderHeader(d.dashData);
  renderLeaderMetrics(d.dashData, d.rules, d.todayAudits, d.myFindings);
  renderLeaderTasks(d.rules, d.todayAudits);
  renderLeaderFindings(d.myFindings);
}

async function fetchLeaderDashData(ldKey, today, rolesToFetch, silent) {
  try {
    const [dashData, rulesData] = await Promise.all([
      cachedApiCall('getDashboard', {}, 'dashboard', 5),
      apiCall('getAuditPlanRules', { activeStatus: 'Active', limit: 300 })
    ]);
    const [auditsData, findingsData] = await Promise.all([
      apiCall('getAuditList', { auditDate: today, limit: 500 }).catch(() => ({ audits: [] })),
      apiCall('getFindings', { myFindings: 'assigned', limit: 200 }).catch(() => ({ findings: [] }))
    ]);
    state.dashboard = dashData;
    const activeLineIds = state.productionPlan?.activeLineIds || null;
    const rules = (rulesData.rules || [])
      .filter(r => rolesToFetch.includes(r.RequiredRole))
      .filter(r => !activeLineIds || activeLineIds.includes(r.LineID));
    const todayAudits = auditsData.audits || [];
    const myFindings = (findingsData.findings || []).filter(f => (f.Status || '').toLowerCase() !== 'closed');
    const d = { dashData, rules, todayAudits, myFindings };
    state.leaderDashData = d;
    GASCache.set(ldKey, d, 10); // 10-minute cache — today's data rarely changes
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
  let activeBadge, btnLabel;
  if (plan && plan.activeLineIds && plan.activeLineIds.length > 0) {
    const activeNames = allLines.filter(l => plan.activeLineIds.includes(l.LineID)).map(l => l.LineName || l.LineID);
    activeBadge = `<span class="prod-active-badge">🟢 ${activeNames.length} Line ผลิตวันนี้: ${activeNames.join(', ')}</span>`;
    btnLabel = 'เปลี่ยน';
  } else {
    activeBadge = `<span class="prod-active-badge" style="background:rgba(211,41,41,.45)">⚠️ ยังไม่ได้เลือก Line ที่ผลิต</span>`;
    btnLabel = 'เลือก Line';
  }

  const todayTasks = (state.leaderDashData?.rules || []).filter(r => rulesMatchToday(r)).length;
  $('#ldHeader').innerHTML = `
    <div class="ld-header-left">
      <div class="ld-greeting">สวัสดี, ${escapeHtml(user.FullName || user.Username)} 👋</div>
      <div class="ld-sub">${escapeHtml(user.Role)} · ${escapeHtml(thaiDate)}</div>
      <div style="margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        ${activeBadge}
        <button class="prod-change-btn" onclick="changeProdPlan()">${btnLabel}</button>
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
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todayMap = {};
  todayAudits.forEach(a => { todayMap[`${a.LineID}|${a.StationID}|${String(a.AuditLayer||'').toLowerCase()}`] = true; });
  const todayRules = rules.filter(rulesMatchToday).sort((a, b) => (a.DueTime||'17:00').localeCompare(b.DueTime||'17:00'));
  if (!todayRules.length) {
    $('#ldTasks').innerHTML = '<div class="empty-state">ไม่มีงานตรวจวันนี้</div>';
    return;
  }
  $('#ldTasks').innerHTML = todayRules.map(r => {
    const key = `${r.LineID}|${r.StationID}|${r.RequiredRole.toLowerCase()}`;
    const done = !!todayMap[key];
    // เกินกำหนด = ข้ามวันเท่านั้น (หลังเที่ยงคืน) — ระหว่างวันยังเป็น "รอตรวจ"
    const badge = done ? '<span class="ld-badge done">✅ ตรวจแล้ว</span>'
      : '<span class="ld-badge pending">🕐 รอตรวจ</span>';
    const timeLabel = '';
    const startBtn = done ? '' : `<button class="btn btn-primary btn-compact" onclick="startAuditFromDashboard('${escapeAttr(r.LineID)}','${escapeAttr(r.StationID)}','${escapeAttr(r.RequiredRole)}')">เริ่มตรวจ</button>`;
    return `<div class="ld-task-row">
      ${badge}
      <div class="ld-task-info"><div class="ld-task-name">${escapeHtml(r.LineName || r.LineID)}</div><div class="ld-task-meta">${escapeHtml(r.RequiredRole)} · ${escapeHtml(r.Frequency || '')}</div></div>
      <div class="ld-task-time">${escapeHtml(timeLabel)}</div>
      ${startBtn}
    </div>`;
  }).join('');
}

function renderLeaderFindings(findings) {
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

function openFindingForEdit(findingId) {
  navigateTo('findings').then(() => {
    setTimeout(() => openFindingEditor(findingId), 800);
  });
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

function renderDirHeader(data) {
  const user = state.user;
  const ts = new Date().toLocaleString('th-TH', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  const m = data.months;
  $('#dirHeader').innerHTML = `
    <div>
      <div class="dir-title">LPA Overview Dashboard</div>
      <div class="dir-sub">${escapeHtml(user.Department||user.FullName||'Plant')}</div>
    </div>
    <div class="dir-period-row">
      <button class="dir-period-btn ${m===1?'active':''}" onclick="loadDirectorDashboard(1)">1 เดือน</button>
      <button class="dir-period-btn ${m===3?'active':''}" onclick="loadDirectorDashboard(3)">3 เดือน</button>
      <button class="dir-period-btn ${m===6?'active':''}" onclick="loadDirectorDashboard(6)">6 เดือน</button>
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
if (!state.mgrData) state.mgrData = { complianceData: null, dashData: null, findings: [], period: 'month', selectedLine: '' };

async function loadManagerDashboard(period) {
  if (period) state.mgrData.period = period;
  const p = state.mgrData.period;
  const mgrKey = `mgr_comp_${p}`;
  const mgrCached = GASCache.get(mgrKey);
  if (mgrCached && !period) {
    try {
      const { complianceData, dashData, findings } = mgrCached;
      state.mgrData.complianceData = complianceData; state.mgrData.dashData = dashData; state.mgrData.findings = findings;
      renderMgrHeader(p); renderMgrMetrics(complianceData, dashData); renderMgrBarChart(complianceData.byLine || []);
      renderMgrHeatmap(complianceData.byStationRole || [], state.mgrData.selectedLine); renderMgrEscalation(findings); return;
    } catch (_) { GASCache.invalidate(mgrKey); }
  }
  $('#mgrHeader').innerHTML = '<div class="mgr-header-left"><div class="ld-greeting">กำลังโหลด Dashboard...</div></div>';
  $('#mgrMetrics').innerHTML = Array.from({length:4}, () => '<div class="ld-card skeleton-card" style="min-height:90px"></div>').join('');
  $('#mgrBarChart').innerHTML = '<div class="empty-state">กำลังโหลด...</div>';
  $('#mgrHeatmap').innerHTML = '<div class="empty-state">กำลังโหลด...</div>';
  $('#mgrEscalation').innerHTML = '<div class="empty-state">กำลังโหลด...</div>';
  try {
    const today = localDateInput(new Date());
    const [complianceData, dashData, findingsData, todayAuditsData] = await Promise.all([
      cachedApiCall('getManagerComplianceData', { period: p }, mgrKey, 3),
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
    renderMgrHeader(p);
    renderMgrMetrics(complianceData, dashData);
    renderMgrBarChart(complianceData.byLine || []);
    renderMgrHeatmap(complianceData.byStationRole || [], state.mgrData.selectedLine);
    renderMgrEscalation(state.mgrData.findings);
    renderTodayAudits(todayAuditsData.audits || [], '#mgrTodayAudits');
    GASCache.set(mgrKey, { complianceData, dashData, findings: state.mgrData.findings }, 3);
  } catch (error) {
    $('#mgrHeader').innerHTML = `<div class="mgr-header-left"><div class="ld-greeting">❌ โหลดไม่สำเร็จ</div><div class="ld-sub">${escapeHtml(error.message)}</div></div><button class="mgr-export-btn" onclick="loadManagerDashboard()">↻ ลองใหม่</button>`;
    ['#mgrMetrics','#mgrBarChart','#mgrHeatmap','#mgrEscalation'].forEach(s => { const el = $(s); if (el) el.innerHTML = ''; });
    showToast(error.message, 'error');
  }
}

function renderMgrHeader(period) {
  const user = state.user;
  const cd = state.mgrData.complianceData || {};
  const dateLabel = cd.startDate && cd.endDate ? `${formatDate(cd.startDate)} – ${formatDate(cd.endDate)}` : '';
  $('#mgrHeader').innerHTML = `
    <div class="mgr-header-left">
      <div class="ld-greeting">👔 ${escapeHtml(user.FullName || user.Username)} · Manager</div>
      <div class="ld-sub">Plant Overview Dashboard</div>
    </div>
    <div class="mgr-period-row">
      <button class="mgr-period-btn ${period==='month'?'active':''}" onclick="loadManagerDashboard('month')">เดือนนี้</button>
      <button class="mgr-period-btn ${period==='week'?'active':''}" onclick="loadManagerDashboard('week')">สัปดาห์นี้</button>
      <span style="font-size:.78rem;opacity:.75">${escapeHtml(dateLabel)}</span>
      <button class="mgr-export-btn" onclick="window.print()">⬇ Export PDF</button>
    </div>`;
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
  const delay = document.visibilityState === 'hidden' ? 90000 : 30000;
  state.notificationTimer = setTimeout(() => pollFindingNotifications(false), delay);
}

function handleNotificationVisibilityChange() {
  if (!state.token || !state.user) return;
  if (document.visibilityState === 'visible') pollFindingNotifications(true);
  else scheduleNextFindingNotificationPoll();
}

async function pollFindingNotifications(immediate = false) {
  if (!state.token || !state.user || state.notificationInFlight) return;
  state.notificationInFlight = true;
  try {
    const data = await apiCall('getMyFindingNotificationSummary', { lastSeenAt: getLastSeenFindingNotificationAt(), limit: 5 });
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
  const assignmentFields = `<label>มอบหมายให้ตำแหน่ง<select data-field="assignedRole"><option value="">เลือกตำแหน่งรับผิดชอบ</option>${roleOptions}</select></label><label>ตำแหน่งรับผิดชอบ<input data-field="responsiblePerson" readonly></label><input data-field="assignmentMode" type="hidden" value="ROLE"><input data-field="findingStatus" type="hidden" value="Assigned">`;
  container.innerHTML = state.checklist.map((item, index) => `<article class="checklist-card" data-checklist-id="${escapeAttr(item.ChecklistID)}"><div class="checklist-head"><p class="eyebrow">ข้อ ${index + 1} · ${escapeHtml(item.Category || 'ทั่วไป')}</p><h3>${escapeHtml(item.CheckItem || '-')}</h3></div><div class="criteria-grid"><div class="criteria-box"><strong>เกณฑ์มาตรฐาน</strong>${escapeHtml(item.StandardCriteria || '-')}</div><div class="criteria-box ok-example"><strong>ตัวอย่าง OK</strong>${escapeHtml(item.ExampleOK || '-')}</div><div class="criteria-box ng-example"><strong>ตัวอย่าง NG</strong>${escapeHtml(item.ExampleNG || '-')}</div></div><div class="result-buttons"><button type="button" class="result-button ok" data-result="OK">OK</button><button type="button" class="result-button ng" data-result="NG">NG</button><button type="button" class="result-button na" data-result="N/A">N/A</button></div><div class="ng-fields hidden"><p class="required-note">กรุณากรอกข้อมูล Finding ให้ครบ</p><div class="form-grid"><label>รายละเอียดปัญหา *<textarea data-field="findingDetail" rows="2"></textarea></label>${assignmentFields}<label>กำหนดวันแก้ไข *<input data-field="dueDate" type="date"></label><label>รูปก่อนแก้ไข *<input data-field="beforePhoto" type="file" accept="image/*"><span class="photo-preview" data-field="beforePhotoPreview"></span></label><label>หมายเหตุ<textarea data-field="remark" rows="2"></textarea></label></div></div></article>`).join('');
  $$('.checklist-card', container).forEach(card => {
    $$('.result-button', card).forEach(button => button.addEventListener('click', () => selectAuditResult(card, button.dataset.result)));
    $$('input, select, textarea', card).forEach(field => {
      field.addEventListener('input', updateAuditSaveButtonState);
      field.addEventListener('change', event => {
        if (field.dataset.field === 'beforePhoto') renderPhotoPreview(field, `[data-field=\"beforePhotoPreview\"]`, '', card);
        updateAuditSaveButtonState();
      });
    });
    const roleSelect = $('select[data-field="assignedRole"]', card);
    if (roleSelect) roleSelect.addEventListener('change', event => {
        $('[data-field="responsiblePerson"]', card).value = event.target.value || '';
        $('[data-field="findingStatus"]', card).value = event.target.value ? 'Assigned' : 'Open';
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
    return Boolean(card && fieldValue(card, 'findingDetail') &&
      fieldValue(card, 'assignedRole') && fieldValue(card, 'dueDate'));
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
      record.findingDetail = fieldValue(card, 'findingDetail');
      record.correctiveAction = '';
      record.assignmentMode = fieldValue(card, 'assignmentMode') || 'ROLE';
      record.assignedRole = fieldValue(card, 'assignedRole');
      record.assignedRoleName = record.assignedRole;
      record.assignedUserId = '';
      record.assignedToUserId = '';
      record.picUserId = '';
      record.assignedToName = '';
      record.responsiblePerson = record.assignedRole;
      record.picName = record.assignedRole;
      record.assignedToRole = record.assignedRole;
      record.severity = item.Severity || 'Minor';
      record.dueDate = fieldValue(card, 'dueDate');
      record.status = record.assignedRole ? 'Assigned' : 'Open';
      record.findingStatus = record.status;
      if (!record.findingDetail || !record.assignedRole || !record.dueDate) {
        setAuditSavingState(false);
        return showToast(`กรุณากรอก รายละเอียดปัญหา, ตำแหน่งรับผิดชอบ และ กำหนดวันแก้ไข ของ ${item.ChecklistID} ให้ครบ`, 'warning');
      }
      const photo = fieldFile(card, 'beforePhoto');
      if (photo) record._photo = photo;
    }
    records.push(record);
  }
  if (!window.confirm(`ยืนยันบันทึก Audit จำนวน ${records.length} ข้อ?`)) {
    setAuditSavingState(false);
    return;
  }
  if (!state.auditClientSubmissionId) state.auditClientSubmissionId = createClientSubmissionId();
  const photoRecords = records.filter(r => r._photo);
  const totalPhotos = photoRecords.length;
  try {
    // Step 1: upload all photos in parallel
    if (totalPhotos > 0) {
      showLoading(`กำลังอัปโหลดรูปภาพ ${totalPhotos} รูป... กรุณารอสักครู่`);
      await Promise.all(photoRecords.map(async record => {
        const upload = await uploadFile(record._photo, 'AuditDraft', `DRAFT-${Date.now()}`, 'BeforePhoto', false);
        record.beforePhotoUrl = upload.DriveFileURL;
        delete record._photo;
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
    loadDashboard(false);
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

function renderPhotoPreview(input, targetSelector, existingUrl = '', scope = document) {
  const target = typeof targetSelector === 'string' ? $(targetSelector, scope) : targetSelector;
  if (!target) return;
  const file = input && input.files ? input.files[0] : null;
  if (!file) {
    target.innerHTML = existingUrl ? `<a href="${escapeAttr(existingUrl)}" target="_blank" rel="noopener">ดูรูปปัจจุบัน</a>` : '';
    return;
  }
  if (!String(file.type || '').startsWith('image/')) {
    target.innerHTML = '<span class="required-note">กรุณาเลือกไฟล์รูปภาพเท่านั้น</span>';
    return;
  }
  const url = URL.createObjectURL(file);
  target.innerHTML = `<img src="${escapeAttr(url)}" alt="Photo preview"><span>${escapeHtml(file.name)} · ${Math.ceil(file.size / 1024)} KB</span>`;
  const img = $('img', target);
  if (img) img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
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

async function loadFindings(force = false) {
  const payload = {
    lineId: optionalFilterValue($('#findingLine').value), stationId: optionalFilterValue($('#findingStation').value),
    category: optionalFilterValue($('#findingCategory').value), status: optionalFilterValue($('#findingStatus').value),
    pic: optionalFilterValue($('#findingPicName').value), picName: optionalFilterValue($('#findingPicName').value),
    periodMonth: monthToPeriod($('#findingMonth').value),
    myFindings: optionalFilterValue($('#findingMine').value),
    overdueOnly: $('#findingOverdue').checked
  };
  Object.keys(payload).forEach(key => { if (payload[key] === '' || payload[key] === false) delete payload[key]; });
  const cacheKey = JSON.stringify(payload);
  const CACHE_TTL = 5 * 60 * 1000;
  if (!force && state.findingsCache && state.findingsCache.key === cacheKey &&
      Date.now() - state.findingsCache.ts < CACHE_TTL) {
    state.findings = state.findingsCache.data;
    renderFindings();
    return;
  }
  $('#findingsList').innerHTML = Array.from({length: 4}, () => '<article class="finding-card skeleton-card" style="min-height:110px"></article>').join('');
  showLoading('กำลังโหลด Finding...');
  try {
    const data = await apiCall('getFindings', payload);
    state.findings = Array.isArray(data.findings) ? data.findings : [];
    state.findingsCache = { key: cacheKey, data: state.findings, ts: Date.now() };
    renderFindings();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    hideLoading();
  }
}

function renderFindings() {
  const container = $('#findingsList');
  if (!state.findings.length) return container.innerHTML = emptyHtml('ไม่พบ Finding ตามเงื่อนไข');
  container.innerHTML = state.findings.map(row => `<article class="finding-card ${String(row.OverdueFlag).toLowerCase() === 'yes' ? 'overdue' : ''}"><div class="finding-summary"><div><span class="finding-id">${escapeHtml(row.FindingID)}</span><span class="data-label">${formatDate(row.FoundDate)} · ${escapeHtml(row.Category || '-')} · ${escapeHtml(row.Severity || row.Priority || '-')}</span></div><div><span class="data-label">Line</span>${escapeHtml(row.LineName || row.LineID || '-')}</div><div><span class="data-label">Station</span>${escapeHtml(row.StationName || row.StationID || '-')}</div><div><span class="data-label">รับผิดชอบโดย</span>${escapeHtml(formatFindingAssignment(row))}<span class="table-subtext">${escapeHtml(formatFindingAssignmentMode(row))}</span></div><div><span class="data-label">Due Date</span>${formatDate(row.DueDate)}</div><div><span class="status-badge ${String(row.OverdueFlag).toLowerCase() === 'yes' ? 'status-overdue' : statusClass(row.Status)}">${String(row.OverdueFlag).toLowerCase() === 'yes' ? `Overdue ${number(row.DaysOverdue)}d` : escapeHtml(row.Status || '-')}</span></div></div><div class="finding-detail"><div><span class="data-label">Problem Detail</span>${escapeHtml(row.ProblemDetail || '-')}</div><div><span class="data-label">Corrective Action</span>${escapeHtml(row.CorrectiveAction || '-')}</div><div class="photo-link"><span class="data-label">Photo</span>${photoLinks(row)}</div></div><div class="finding-actions"><button class="btn btn-outline" data-edit-finding="${escapeAttr(row.FindingID)}">เปิด Finding</button></div></article>`).join('');
  $$('[data-edit-finding]', container).forEach(button => button.addEventListener('click', () => openFindingEditor(button.dataset.editFinding)));
}

function openFindingEditor(findingId) {
  const row = state.findings.find(item => item.FindingID === findingId);
  if (!row) return;
  state.editingFinding = row;
  $('#findingDialogTitle').textContent = `${row.FindingID} · ${row.ProblemDetail || ''}`;
  $('#editFindingId').value = row.FindingID;
  $('#editRootCause').value = row.RootCause || '';
  $('#editCorrectiveAction').value = row.CorrectiveAction || '';
  $('#editStatus').value = row.Status || 'Open';
  $('#editStatus').closest('label').classList.toggle('hidden', ['Leader', 'User'].includes(state.user.Role));
  $('#editActionRemark').value = row.ActionRemark || '';
  $('#editCloseRemark').value = '';
  $('#editRejectReason').value = '';
  $('#editCloseRemark').classList.remove('field-error');
  $('#editRejectReason').classList.remove('field-error');
  $('#editAfterPhoto').value = '';
  renderPhotoPreview($('#editAfterPhoto'), '#editPhotoPreview', row.AfterPhotoURL || '');
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
  $('#approveFindingButton').classList.toggle('hidden', isLeaderOrUser || !canVerify || !hasPermission(closePermission));
  $('#rejectFindingButton').classList.toggle('hidden', isLeaderOrUser || !canVerify);
  $('#submitVerificationButton').classList.toggle('hidden', !canSubmit);
  $('#editRootCause').disabled = !canEditFollowUp;
  $('#editCorrectiveAction').disabled = !canEditFollowUp;
  $('#editActionRemark').disabled = !canEditFollowUp;
  $('#editCloseRemark').disabled = !canVerify;
  $('#editRejectReason').disabled = !canVerify;
  $('#editAfterPhotoField').classList.toggle('hidden', !canEditFollowUp);
  $('#editAfterPhoto').disabled = !canEditFollowUp;
  $('#findingDialog').showModal();
}

async function submitFindingForVerification() {
  const findingId = $('#editFindingId').value;
  const rootCause = $('#editRootCause').value.trim();
  const correctiveAction = $('#editCorrectiveAction').value.trim();
  const existingPhoto = state.editingFinding ? state.editingFinding.AfterPhotoURL : '';
  const file = $('#editAfterPhoto').files[0];
  if (!rootCause || !correctiveAction || (!file && !existingPhoto)) {
    return showToast('กรุณากรอก Root Cause, Corrective Action และแนบ After Photo ให้ครบก่อนส่งตรวจยืนยัน', 'warning');
  }
  if (!window.confirm(`ส่ง Finding ${findingId} เพื่อตรวจสอบ?`)) return;
  await runFindingWorkflow('submitFinding', {
    findingId, rootCause, correctiveAction,
    actionRemark: $('#editActionRemark').value.trim(),
    remark: $('#editActionRemark').value.trim() || 'Submitted for verification'
  }, {
    loadingMessage: 'กำลังส่ง Finding ให้ตรวจยืนยัน...',
    successMessage: 'ส่ง Finding เพื่อตรวจสอบแล้ว'
  });
}

async function verifyFinding(decision) {
  const findingId = $('#editFindingId').value;
  const remarkField = decision === 'Reject' ? $('#editRejectReason') : $('#editCloseRemark');
  const verifierRemark = remarkField.value.trim();
  if (!verifierRemark) {
    remarkField.classList.add('field-error');
    remarkField.focus();
    const warning = decision === 'Reject'
      ? 'กรุณาระบุเหตุผลการ Reject ก่อนส่งกลับให้ผู้รับผิดชอบแก้ไข'
      : 'กรุณาระบุ Close Remark ก่อนปิด Finding';
    return showToast(warning, 'warning');
  }
  remarkField.classList.remove('field-error');
  const confirmation = decision === 'Reject'
    ? 'ยืนยัน Reject Finding นี้และส่งกลับให้ผู้รับผิดชอบแก้ไข?'
    : 'ยืนยันปิด Finding นี้?';
  if (!window.confirm(confirmation)) return;
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
    const file = $('#editAfterPhoto').files[0];
    if (file) {
      const upload = await uploadFile(file, 'Finding', payload.findingId, 'AfterPhoto', false);
      payload.afterPhotoUrl = upload.DriveFileURL;
    } else if (state.editingFinding) {
      payload.afterPhotoUrl = state.editingFinding.AfterPhotoURL || '';
    }
    await apiCall(action, payload);
    $('#findingDialog').close();
    state.findingsCache = null;
    state.leaderDashData = null;
    GASCache.invalidate('dashboard'); GASCache.invalidatePrefix('mgr_comp_'); GASCache.invalidatePrefix('dir_dash_');
    await loadFindings(true);
    await loadDashboard(false);
    showToast(settings.successMessage, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    hideLoading();
    actionBtns.forEach(b => { b.disabled = false; });
  }
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
      apiCall('getAuditList', { auditDate: today, limit: 500 }).catch(() => ({ audits: [] }))
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
    const todayKey = `${lid}|${sid}|${role.toLowerCase()}`;
    const [h, m] = (rule.DueTime || '17:00').split(':').map(Number);
    const status = todayMap[todayKey] ? 'done' : nowMin > (h * 60 + m) ? 'overdue' : 'pending';
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
    const confirmed = window.confirm(`ระบบจะสร้างกฎสำหรับ Station ที่ Active ทั้งหมดใน ${lineLabel} ต้องการดำเนินการต่อหรือไม่?`);
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
  if (!window.confirm(`ยืนยันลบกฎตารางตรวจ?\n${ruleLabel}`)) return;
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
  const metrics = [['Total Audit', data.TotalAudit], ['Planned Audit', data.PlannedAuditCount], ['Completed Plan', data.CompletedAuditCount], ['Completion Rate', `${number(data.CompletionRate).toFixed(2)}%`], ['Overdue Audit', data.OverdueAuditCount], ['Missed Audit', data.MissedAuditCount], ['Late Submitted', data.LateSubmittedCount], ['Total OK', data.TotalOK], ['Total NG', data.TotalNG], ['NG Rate', `${number(data.NGRate).toFixed(2)}%`], ['Open Finding', data.OpenFinding], ['Overdue Action', data.OverdueAction]];
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
  if (!userId || !window.confirm('ยืนยันปิดใช้งานผู้ใช้นี้?')) return;
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
  const auditLines = (activeIds && activeIds.length > 0) ? allLines.filter(l => activeIds.includes(l.LineID)) : allLines;
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
  populateSelect('#adminLineFilter', state.masterData.lines || [], 'LineID', 'LineName', 'ทั้งหมด');
  populateSelect('#adminLineDefault', state.masterData.lines || [], 'LineID', 'LineName', 'ไม่ระบุ');
  const shifts = (state.masterData.lists || [])
    .filter(row => String(row.ListType || '').toLowerCase() === 'shift')
    .sort((a, b) => Number(a.SortOrder || 0) - Number(b.SortOrder || 0));
  populateSelect('#auditShift', shifts, 'ListValue', 'DisplayText', 'เลือก Shift');
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

function populateSelect(selector, rows, valueField, textField, firstLabel, allOptionLabel) {
  const select = $(selector);
  const current = select.value;
  const allOpt = allOptionLabel ? `<option value="ALL">${escapeHtml(allOptionLabel)}</option>` : '';
  select.innerHTML = `<option value="">${escapeHtml(firstLabel)}</option>${allOpt}` + rows.map(row => `<option value="${escapeAttr(row[valueField])}">${escapeHtml(row[textField] || row[valueField])}</option>`).join('');
  if (current === 'ALL' && allOptionLabel) select.value = 'ALL';
  else if (rows.some(row => String(row[valueField]) === current)) select.value = current;
}

function assignableRoles() {
  const order = ['Leader', 'Supervisor', 'Engineer', 'Manager', 'Admin'];
  const roles = new Set(order);
  (state.masterData.users || []).forEach(user => {
    if ((!user.ActiveStatus || String(user.ActiveStatus).toLowerCase() === 'active') && user.Role) roles.add(user.Role);
  });
  return Array.from(roles).sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
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

function isFindingAssignedToCurrentUser(row) {
  if (findingAssignmentMode(row) === 'ROLE') return String(row.AssignedRole || row.AssignedRoleName || row.AssignedToRole || '').toLowerCase() === String(state.user?.Role || '').toLowerCase();
  const assignedUserId = String(row.AssignedUserID || row.AssignedToUserID || row.ResponsibleUserID || row.PICUserID || '');
  return assignedUserId ? assignedUserId === String(state.user?.UserID || '') : String(row.AssignedUserName || row.AssignedToName || row.PICName || '') === String(state.user?.FullName || '');
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
  if (page === 'dashboard') loadDashboard(false);
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
function showLoading(message = 'กำลังโหลด...') {
  busyDepth++;
  busyMessages.push(message);
  $('#loadingText').textContent = message;
  $('#loadingOverlay').classList.remove('hidden');
  document.body.classList.add('is-busy');
  document.body.setAttribute('aria-busy', 'true');
  if (busyDepth === 1) {
    $$('button, input, select, textarea').forEach(element => {
      busyDisabledState.set(element, element.disabled);
      element.disabled = true;
    });
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
  $('#loadingOverlay').classList.add('hidden');
  document.body.classList.remove('is-busy');
  document.body.removeAttribute('aria-busy');
  busyDisabledState.forEach((wasDisabled, element) => {
    if (element.isConnected) element.disabled = wasDisabled;
  });
  busyDisabledState.clear();
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

function findingReportTable(rows) {
  return rows.length ? tableHtml(['FindingID', 'Problem', 'Line', 'PIC', 'Due Date', 'Status'], rows.map(row => [row.FindingID, row.ProblemDetail, row.LineName || row.LineID, row.PICName, formatDate(row.DueDate), row.Status])) : emptyHtml('ไม่มีข้อมูล');
}

function tableHtml(headers, rows, extraClass = '') {
  if (!rows.length) return emptyHtml('ไม่มีข้อมูล');
  return `<table class="data-table${extraClass ? ' ' + extraClass : ''}"><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(String(cell ?? '-'))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function photoLinks(row) {
  const links = [];
  if (row.BeforePhotoURL) links.push(`<a href="${escapeAttr(row.BeforePhotoURL)}" target="_blank" rel="noopener">Before</a>`);
  if (row.AfterPhotoURL) links.push(`<a href="${escapeAttr(row.AfterPhotoURL)}" target="_blank" rel="noopener">After</a>`);
  return links.length ? links.join(' · ') : '-';
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
  // Leader / Supervisor: lock date to today only (no backdating across days)
  const role = state.user?.Role || '';
  if (role === 'Leader' || role === 'Supervisor') {
    dateEl.min = today;
    dateEl.max = today;
    dateEl.readOnly = true;
  } else {
    dateEl.min = '';
    dateEl.max = '';
    dateEl.readOnly = false;
  }
  $('#auditTime').value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  $('#findingMonth').value = '';
  $('#reportMonth').value = month;
  updateLateReasonVisibility();
}

function fileToBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ')); reader.readAsDataURL(file); }); }
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
        findingDetail: fieldValue(card, 'findingDetail'),
        correctiveAction: fieldValue(card, 'correctiveAction'),
        assignedRole: fieldValue(card, 'assignedRole'),
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
      set('findingDetail', ng.findingDetail);
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
function readStoredJson(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]); }
function escapeAttr(value) { return escapeHtml(value); }
function cssEscape(value) { return window.CSS && CSS.escape ? CSS.escape(String(value)) : String(value).replace(/["\\]/g, '\\$&'); }
