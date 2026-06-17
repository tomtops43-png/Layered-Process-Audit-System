'use strict';

const state = {
  token: localStorage.getItem('lpa_token') || '',
  user: readStoredJson('lpa_user'),
  masterData: { lines: [], stations: [], users: [], lists: [], settings: {} },
  masterDataLoadedAt: 0,
  masterDataPromise: null,
  checklist: [],
  auditAnswers: {},
  findings: [],
  dashboard: null,
  auditPlans: [],
  auditRules: [],
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
  $('#refreshFindings').addEventListener('click', loadFindings);
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

async function apiCall(action, payload = {}) {
  const TIMEOUT_MS = action === 'uploadFile' ? 90000 : 45000;
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`ระบบใช้เวลานานเกินไป (${TIMEOUT_MS / 1000}s) กรุณาลองใหม่อีกครั้ง`)), TIMEOUT_MS)
  );
  const fetchPromise = fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token: state.token || '', payload })
  }).then(async response => {
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
  const refreshButton = $('#refreshDashboard');
  refreshButton.disabled = true;
  showDashboardSkeleton();
  try {
    state.dashboard = await apiCall('getDashboard', {});
    renderDashboard(state.dashboard);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    refreshButton.disabled = false;
  }
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
  $('#auditNavBadge').textContent = '0';
  $('#auditNavBadge').classList.add('hidden');
  $('#auditPlanAlert').classList.add('hidden');
  $('#auditPlanAlert').innerHTML = '';
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
  if (!lineId || !stationId || !auditLayer) return showToast('กรุณาเลือก Line, Station และ Audit Layer', 'warning');
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
  const assignmentFields = `<label>มอบหมายให้ตำแหน่ง<select data-field="assignedRole"><option value="">เลือกตำแหน่งรับผิดชอบ</option>${roleOptions}</select></label><label>Responsible Role<input data-field="responsiblePerson" readonly></label><input data-field="assignmentMode" type="hidden" value="ROLE"><input data-field="findingStatus" type="hidden" value="Assigned">`;
  container.innerHTML = state.checklist.map((item, index) => `<article class="checklist-card" data-checklist-id="${escapeAttr(item.ChecklistID)}"><div class="checklist-head"><p class="eyebrow">ข้อ ${index + 1} · ${escapeHtml(item.Category || 'ทั่วไป')}</p><h3>${escapeHtml(item.CheckItem || '-')}</h3></div><div class="criteria-grid"><div class="criteria-box"><strong>Standard Criteria</strong>${escapeHtml(item.StandardCriteria || '-')}</div><div class="criteria-box ok-example"><strong>Example OK</strong>${escapeHtml(item.ExampleOK || '-')}</div><div class="criteria-box ng-example"><strong>Example NG</strong>${escapeHtml(item.ExampleNG || '-')}</div></div><div class="result-buttons"><button type="button" class="result-button ok" data-result="OK">OK</button><button type="button" class="result-button ng" data-result="NG">NG</button><button type="button" class="result-button na" data-result="N/A">N/A</button></div><div class="ng-fields hidden"><p class="required-note">กรุณากรอกข้อมูล Finding ให้ครบ</p><div class="form-grid"><label>Finding Detail *<textarea data-field="findingDetail" rows="2"></textarea></label><label>Corrective Action *<textarea data-field="correctiveAction" rows="2"></textarea></label>${assignmentFields}<label>Due Date *<input data-field="dueDate" type="date"></label><label>Before Photo *<input data-field="beforePhoto" type="file" accept="image/*"><span class="photo-preview" data-field="beforePhotoPreview"></span></label><label>Remark<textarea data-field="remark" rows="2"></textarea></label></div></div></article>`).join('');
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
}

function selectAuditResult(card, result) {
  const checklistId = card.dataset.checklistId;
  state.auditAnswers[checklistId] = { ...(state.auditAnswers[checklistId] || {}), result };
  $$('.result-button', card).forEach(button => button.classList.toggle('selected', button.dataset.result === result));
  $('.ng-fields', card).classList.toggle('hidden', result !== 'NG');
  updateAuditProgress();
  updateAuditSaveButtonState();
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
    return Boolean(card && fieldValue(card, 'findingDetail') && fieldValue(card, 'correctiveAction') &&
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
      record.correctiveAction = fieldValue(card, 'correctiveAction');
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
      if (!record.findingDetail || !record.correctiveAction || !record.assignedRole || !record.dueDate) {
        setAuditSavingState(false);
        return showToast(`กรุณากรอก Finding Detail, Corrective Action, ตำแหน่งรับผิดชอบ และ Due Date ของ ${item.ChecklistID} ให้ครบ`, 'warning');
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
    // Step 1: upload photos first with per-photo progress
    for (let i = 0; i < photoRecords.length; i++) {
      const record = photoRecords[i];
      showLoading(`กำลังอัปโหลดรูปภาพ ${i + 1}/${totalPhotos}... กรุณารอสักครู่`);
      const upload = await uploadFile(record._photo, 'AuditDraft', `DRAFT-${Date.now()}`, 'BeforePhoto', false);
      record.beforePhotoUrl = upload.DriveFileURL;
      delete record._photo;
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

async function uploadFile(file, relatedType, relatedId, fileType, manageLoading = true) {
  if (!file) throw new Error('ไม่พบไฟล์สำหรับอัปโหลด');
  const uploadMessage = fileType === 'BeforePhoto' ? 'กำลังอัปโหลด Before Photo...' :
    (fileType === 'AfterPhoto' ? 'กำลังอัปโหลด After Photo...' : 'กำลังอัปโหลดไฟล์...');
  if (manageLoading) showLoading(uploadMessage);
  try {
    const base64Data = await fileToBase64(file);
    return await apiCall('uploadFile', { relatedType, relatedId, fileType, fileName: file.name, mimeType: file.type || 'application/octet-stream', base64Data });
  } finally {
    if (manageLoading) hideLoading();
  }
}

async function loadFindings() {
  showLoading('กำลังโหลด Finding...');
  try {
    const payload = {
      lineId: optionalFilterValue($('#findingLine').value), stationId: optionalFilterValue($('#findingStation').value),
      category: optionalFilterValue($('#findingCategory').value), status: optionalFilterValue($('#findingStatus').value),
      pic: optionalFilterValue($('#findingPicName').value), picName: optionalFilterValue($('#findingPicName').value),
      periodMonth: monthToPeriod($('#findingMonth').value),
      myFindings: optionalFilterValue($('#findingMine').value),
      overdueOnly: $('#findingOverdue').checked
    };
    Object.keys(payload).forEach(key => { if (payload[key] === '' || payload[key] === false) delete payload[key]; });
    const data = await apiCall('getFindings', payload);
    state.findings = Array.isArray(data.findings) ? data.findings : [];
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
    await loadFindings();
    await loadDashboard(false);
    showToast(settings.successMessage, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    hideLoading();
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
    const data = await apiCall('getAuditPlanRules', {
      lineId: optionalFilterValue($('#planLine').value),
      stationId: optionalFilterValue($('#planStation').value),
      requiredRole: optionalFilterValue($('#planRole').value),
      requiredUserId: optionalFilterValue($('#planUser').value),
      frequency: optionalFilterValue($('#planFrequency').value),
      activeStatus: optionalFilterValue($('#planRuleStatus').value),
      limit: 100
    });
    state.auditRules = data.rules || [];
    renderAuditRules();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    hideLoading();
  }
}

function renderAuditRules() {
  if (!state.auditRules.length) {
    $('#auditPlanTable').innerHTML = emptyHtml('ไม่พบกฎตารางตรวจตามตัวกรอง');
    return;
  }
  const canManage = hasPermission('audit.plan.manage');
  $('#auditPlanTable').innerHTML = `<table class="data-table audit-plan-table"><thead><tr><th>Role</th><th>Assignment</th><th>User</th><th>Line</th><th>Station</th><th>Frequency</th><th>Day</th><th>Due Time</th><th>Status</th><th>Action</th></tr></thead><tbody>${state.auditRules.map(rule => `<tr><td>${escapeHtml(rule.RequiredRole || '-')}</td><td>${escapeHtml(formatAssignmentMode(rule))}</td><td>${escapeHtml(formatRuleUser(rule))}</td><td>${escapeHtml(rule.LineName || rule.LineID)}</td><td>${escapeHtml(rule.StationName || rule.StationID)}</td><td>${escapeHtml(rule.Frequency || '-')}</td><td>${escapeHtml(rule.Frequency === 'Monthly' ? rule.DayOfMonth : (rule.DayOfWeek || 'Working days'))}</td><td>${escapeHtml(formatDueTime(rule.DueTime || '17:00'))}</td><td><span class="status-badge ${String(rule.ActiveStatus).toLowerCase() === 'active' ? 'status-ok' : 'status-na'}">${escapeHtml(rule.ActiveStatus || '-')}</span></td><td class="action-cell">${canManage ? `<button class="btn btn-outline btn-compact" data-rule-id="${escapeAttr(rule.RuleID)}">แก้ไข</button><button class="btn btn-danger btn-compact" data-delete-rule-id="${escapeAttr(rule.RuleID)}" data-rule-label="${escapeAttr((rule.RequiredRole||'') + ' / ' + (rule.LineName||rule.LineID) + ' / ' + (rule.StationName||rule.StationID))}">ลบ</button>` : '-'}</td></tr>`).join('')}</tbody></table>`;
  $$('#auditPlanTable [data-delete-rule-id]').forEach(btn => btn.addEventListener('click', () => deleteAuditRule(btn.dataset.deleteRuleId, btn.dataset.ruleLabel)));
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
    const stationCount = activeStationsForLine(payload.lineId).length;
    if (!stationCount) return showToast('ไม่พบ Station ที่ Active ใน Line ที่เลือก', 'warning');
    const confirmed = window.confirm('ระบบจะสร้างกฎสำหรับ Station ที่ Active ทั้งหมดใน Line นี้ ต้องการดำเนินการต่อหรือไม่?');
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
  if (!lineId || !stationId || !auditLayer) return showToast('กรุณาเลือก Line, Station และ Audit Layer', 'warning');
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
  $('#masterChecklistTable').innerHTML = rows.length ? tableHtml(headers, rows.map(row => headers.map(header => row[header] ?? ''))) : emptyHtml('ไม่พบ Checklist');
}

function populateAllMasterSelects() {
  ['#auditLine', '#findingLine', '#checklistLine', '#planLine'].forEach((selector, index) => populateSelect(selector, state.masterData.lines || [], 'LineID', 'LineName', [1, 3].includes(index) ? 'ทั้งหมด' : 'เลือก Line'));
  populateStationSelect('#auditStation', '', false);
  populateStationSelect('#findingStation', '', true);
  populateStationSelect('#checklistStation', '', false);
  populateStationSelect('#planStation', '', true);
  populateSelect('#auditRuleLine', state.masterData.lines || [], 'LineID', 'LineName', 'เลือก Line');
  populateAuditRuleStationSelect('', true);
  populateSelect('#planUser', state.masterData.users || [], 'UserID', 'FullName', 'ทั้งหมด');
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
  populateAuditRuleStationSelect($('#auditRuleLine').value, true);
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

function populateSelect(selector, rows, valueField, textField, firstLabel) {
  const select = $(selector);
  const current = select.value;
  select.innerHTML = `<option value="">${escapeHtml(firstLabel)}</option>` + rows.map(row => `<option value="${escapeAttr(row[valueField])}">${escapeHtml(row[textField] || row[valueField])}</option>`).join('');
  if (rows.some(row => String(row[valueField]) === current)) select.value = current;
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
  populateStationSelect('#auditStation', $('#auditLine').value, false);
  updateAuditArea();
}

function updateAuditArea() {
  const station = (state.masterData.stations || []).find(row => String(row.StationID) === $('#auditStation').value);
  const line = (state.masterData.lines || []).find(row => String(row.LineID) === $('#auditLine').value);
  $('#auditArea').value = (station && station.Area) || (line && line.Area) || '';
}

function resetAuditForm() {
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
  if (page === 'audit' && !state.startingPlanAudit) enterManualAuditMode();
  if (page === 'dashboard') loadDashboard(false);
  if (['audit', 'audit-plan', 'findings', 'checklist', 'admin'].includes(page)) {
    try {
      await ensureMasterDataLoaded(true);
    } catch (_) {
      return;
    }
  }
  if (page === 'findings') { loadFindings(); pollFindingNotifications(true); }
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

function tableHtml(headers, rows) {
  if (!rows.length) return emptyHtml('ไม่มีข้อมูล');
  return `<table class="data-table"><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(String(cell ?? '-'))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
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
  $('#auditDate').value = localDateInput(now);
  $('#auditTime').value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  $('#findingMonth').value = '';
  $('#reportMonth').value = month;
  updateLateReasonVisibility();
}

function fileToBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ')); reader.readAsDataURL(file); }); }
function fieldValue(root, field) { const element = $(`[data-field="${field}"]`, root); return element ? element.value.trim() : ''; }
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
