'use strict';

const state = {
  token: localStorage.getItem('lpa_token') || '',
  user: readStoredJson('lpa_user'),
  masterData: { lines: [], stations: [], users: [], lists: [], settings: {} },
  checklist: [],
  auditAnswers: {},
  findings: [],
  dashboard: null,
  report: null,
  editingFinding: null,
  adminUsers: [],
  editingUser: null
};

const PERMISSION_CATALOG = [
  'users.view', 'users.create', 'users.update', 'users.deactivate', 'users.resetPassword', 'users.managePermission',
  'audit.manager.create', 'audit.engineer.create', 'audit.leader.create', 'audit.view.all', 'audit.view.line', 'audit.view.own',
  'findings.view.all', 'findings.view.line', 'findings.view.assigned', 'findings.view.created', 'findings.assign',
  'findings.update.line', 'findings.update.assigned', 'findings.verify', 'findings.close.minor',
  'findings.close.major', 'findings.close.critical', 'dashboard.view', 'dashboard.view.all',
  'reports.view', 'reports.export', 'checklist.view', 'checklist.manage'
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

window.addEventListener('DOMContentLoaded', initApp);

function initApp() {
  document.title = CONFIG.APP_NAME;
  bindEvents();
  setDefaultDates();
  if (state.token && state.user) {
    showApplication();
    initializeAuthenticatedApp();
  } else {
    showLogin();
  }
}

function bindEvents() {
  $('#loginForm').addEventListener('submit', event => { event.preventDefault(); login(); });
  $('#logoutButton').addEventListener('click', logout);
  $('#sidebarLogoutButton').addEventListener('click', logout);
  $('#menuButton').addEventListener('click', openSidebar);
  $('#closeMenuButton').addEventListener('click', closeSidebar);
  $('#sidebarBackdrop').addEventListener('click', closeSidebar);
  $$('#mainNav [data-page], .bottom-nav [data-page]').forEach(button => button.addEventListener('click', () => navigateTo(button.dataset.page)));
  $('#refreshDashboard').addEventListener('click', loadDashboard);
  $('#auditLine').addEventListener('change', handleAuditLineChange);
  $('#auditStation').addEventListener('change', updateAuditArea);
  $('#loadChecklistButton').addEventListener('click', loadChecklist);
  $('#auditForm').addEventListener('submit', event => { event.preventDefault(); saveAudit(); });
  $('#findingLine').addEventListener('change', () => populateStationSelect('#findingStation', $('#findingLine').value, true));
  $('#checklistLine').addEventListener('change', () => populateStationSelect('#checklistStation', $('#checklistLine').value, false));
  $('#applyFindingFilters').addEventListener('click', loadFindings);
  $('#refreshFindings').addEventListener('click', loadFindings);
  $('#loadReportButton').addEventListener('click', loadMonthlyReport);
  $('#printReportButton').addEventListener('click', () => window.print());
  $('#exportCsvButton').addEventListener('click', exportReportCsv);
  $('#loadMasterChecklistButton').addEventListener('click', loadMasterChecklist);
  $('#findingForm').addEventListener('submit', event => { event.preventDefault(); updateFinding(); });
  $('#closeFindingDialog').addEventListener('click', () => $('#findingDialog').close());
  $('#cancelFindingEdit').addEventListener('click', () => $('#findingDialog').close());
  $('#submitVerificationButton').addEventListener('click', submitFindingForVerification);
  $('#approveFindingButton').addEventListener('click', () => verifyFinding('Approve'));
  $('#rejectFindingButton').addEventListener('click', () => verifyFinding('Reject'));
  $('#addUserButton').addEventListener('click', () => openUserEditor());
  $('#searchUsersButton').addEventListener('click', loadUsers);
  $('#adminUsersTable').addEventListener('click', event => {
    const button = event.target.closest('[data-user-id]');
    if (button) openUserEditor(button.dataset.userId);
  });
  $('#userForm').addEventListener('submit', event => { event.preventDefault(); saveUser(); });
  $('#closeUserDialog').addEventListener('click', () => $('#userDialog').close());
  $('#cancelUserEdit').addEventListener('click', () => $('#userDialog').close());
  $('#deactivateUserButton').addEventListener('click', deactivateSelectedUser);
  $('#resetPasswordButton').addEventListener('click', resetSelectedUserPassword);
}

async function apiCall(action, payload = {}) {
  try {
    const response = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: state.token || '', payload })
    });
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
  showLoading('กำลังตรวจสอบผู้ใช้...');
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
    await initializeAuthenticatedApp();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'เข้าสู่ระบบ';
    hideLoading();
  }
}

function logout(notify = true) {
  state.token = '';
  state.user = null;
  state.masterData = { lines: [], stations: [], users: [], lists: [], settings: {} };
  state.checklist = [];
  state.auditAnswers = {};
  localStorage.removeItem('lpa_token');
  localStorage.removeItem('lpa_user');
  showLogin();
  if (notify) showToast('ออกจากระบบแล้ว', 'success');
}

async function initializeAuthenticatedApp() {
  try {
    const current = await apiCall('getCurrentUser', {});
    state.user = current;
    localStorage.setItem('lpa_user', JSON.stringify(state.user));
  } catch (error) {
    showToast(error.message, 'error');
    return;
  }
  $('#currentUserName').textContent = state.user.FullName || state.user.Username || '-';
  $('#currentUserRole').textContent = state.user.Role || '-';
  applyPermissionVisibility();
  navigateTo('dashboard');
  showLoading('กำลังเตรียมข้อมูล...');
  try {
    await loadMasterData(false);
    await loadDashboard(false);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    hideLoading();
  }
}

async function loadMasterData(withLoading = true) {
  if (withLoading) showLoading('กำลังโหลด Master Data...');
  try {
    state.masterData = await apiCall('getMasterData', {});
    populateAllMasterSelects();
    return state.masterData;
  } catch (error) {
    showToast(error.message, 'error');
    throw error;
  } finally {
    if (withLoading) hideLoading();
  }
}

async function loadDashboard(withLoading = true) {
  if (withLoading) showLoading('กำลังโหลด Dashboard...');
  try {
    state.dashboard = await apiCall('getDashboard', {});
    renderDashboard(state.dashboard);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    if (withLoading) hideLoading();
  }
}

function renderDashboard(data) {
  const topCategory = data.TopNGCategory && data.TopNGCategory.Category ? `${data.TopNGCategory.Category} (${data.TopNGCategory.Count})` : '-';
  const cards = [
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
  $('#findingNavBadge').textContent = notificationCount;
  $('#findingNavBadge').classList.toggle('hidden', notificationCount < 1);
  renderMonthlyBars(data.MonthlyAuditResult || []);
  $('#lineSummary').innerHTML = tableHtml(['Line', 'Total Audit', 'Total NG', 'Open Finding'], (data.SummaryByLine || []).map(row => [row.LineName || row.LineID, row.TotalAudit, row.TotalNG, row.OpenFinding]));
  const nearDue = data.ActionsNearDueDate || [];
  $('#nearDueList').innerHTML = nearDue.length ? nearDue.map(row => `<div class="near-due-item"><div><strong>${escapeHtml(row.FindingID)}</strong><span class="data-label">${escapeHtml(row.ProblemDetail || '-')}</span></div><div><span class="data-label">Line / Station</span>${escapeHtml(row.LineName || row.LineID)} / ${escapeHtml(row.StationName || row.StationID)}</div><div><span class="data-label">PIC</span>${escapeHtml(row.PICName || '-')}</div><div><span class="data-label">Due Date</span>${formatDate(row.DueDate)}</div><span class="status-badge ${statusClass(row.Status)}">${escapeHtml(row.Status || '-')}</span></div>`).join('') : emptyHtml('ไม่มี Action ที่ใกล้ Due Date');
}

function renderMonthlyBars(rows) {
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
  }
}

function renderAuditChecklist() {
  const container = $('#auditChecklist');
  $('#auditSaveBar').classList.toggle('hidden', !state.checklist.length);
  if (!state.checklist.length) {
    container.innerHTML = emptyHtml('ไม่พบ Checklist');
    return;
  }
  const userOptions = activeUserOptions();
  const assignmentFields = `<label>Assign To<select data-field="assignedToUserId"><option value="">ไม่ระบุผู้รับผิดชอบ</option>${userOptions}</select></label><label>Responsible Person<input data-field="responsiblePerson" readonly></label><input data-field="findingStatus" type="hidden" value="Open">`;
  container.innerHTML = state.checklist.map((item, index) => `<article class="checklist-card" data-checklist-id="${escapeAttr(item.ChecklistID)}"><div class="checklist-head"><p class="eyebrow">ข้อ ${index + 1} · ${escapeHtml(item.Category || 'ทั่วไป')}</p><h3>${escapeHtml(item.CheckItem || '-')}</h3></div><div class="criteria-grid"><div class="criteria-box"><strong>Standard Criteria</strong>${escapeHtml(item.StandardCriteria || '-')}</div><div class="criteria-box ok-example"><strong>Example OK</strong>${escapeHtml(item.ExampleOK || '-')}</div><div class="criteria-box ng-example"><strong>Example NG</strong>${escapeHtml(item.ExampleNG || '-')}</div></div><div class="result-buttons"><button type="button" class="result-button ok" data-result="OK">OK</button><button type="button" class="result-button ng" data-result="NG">NG</button><button type="button" class="result-button na" data-result="N/A">N/A</button></div><div class="ng-fields hidden"><p class="required-note">กรุณากรอกข้อมูล Finding ให้ครบ</p><div class="form-grid"><label>Finding Detail *<textarea data-field="findingDetail" rows="2"></textarea></label><label>Corrective Action *<textarea data-field="correctiveAction" rows="2"></textarea></label>${assignmentFields}<label>Due Date *<input data-field="dueDate" type="date"></label><label>Before Photo *<input data-field="beforePhoto" type="file" accept="image/*" capture="environment"></label><label>Remark<textarea data-field="remark" rows="2"></textarea></label></div></div></article>`).join('');
  $$('.checklist-card', container).forEach(card => {
    $$('.result-button', card).forEach(button => button.addEventListener('click', () => selectAuditResult(card, button.dataset.result)));
    const assigneeSelect = $('select[data-field="assignedToUserId"]', card);
    if (assigneeSelect) assigneeSelect.addEventListener('change', event => {
        const user = (state.masterData.users || []).find(item => String(item.UserID) === event.target.value);
        $('[data-field="responsiblePerson"]', card).value = user ? user.FullName : '';
        $('[data-field="findingStatus"]', card).value = user ? 'Assigned' : 'Open';
      });
  });
  updateAuditProgress();
}

function selectAuditResult(card, result) {
  const checklistId = card.dataset.checklistId;
  state.auditAnswers[checklistId] = { ...(state.auditAnswers[checklistId] || {}), result };
  $$('.result-button', card).forEach(button => button.classList.toggle('selected', button.dataset.result === result));
  $('.ng-fields', card).classList.toggle('hidden', result !== 'NG');
  updateAuditProgress();
}

function updateAuditProgress() {
  const answered = Object.keys(state.auditAnswers).filter(key => state.auditAnswers[key].result).length;
  $('#auditProgress').textContent = `ตอบแล้ว ${answered} / ${state.checklist.length} ข้อ`;
}

async function saveAudit() {
  if (!state.checklist.length) return showToast('กรุณาโหลด Checklist ก่อนบันทึก', 'warning');
  if (Object.keys(state.auditAnswers).length !== state.checklist.length) return showToast('กรุณาระบุผลให้ครบทุกข้อ', 'warning');
  const records = [];
  for (const item of state.checklist) {
    const card = $(`.checklist-card[data-checklist-id="${cssEscape(item.ChecklistID)}"]`);
    const answer = state.auditAnswers[item.ChecklistID];
    const record = { checklistId: item.ChecklistID, category: item.Category, checkItem: item.CheckItem, standardCriteria: item.StandardCriteria, checklistRevision: item.Revision, result: answer.result, remark: fieldValue(card, 'remark') };
    if (answer.result === 'NG') {
      record.findingDetail = fieldValue(card, 'findingDetail');
      record.correctiveAction = fieldValue(card, 'correctiveAction');
      record.responsiblePerson = fieldValue(card, 'responsiblePerson');
      record.picName = record.responsiblePerson;
      record.picUserId = fieldValue(card, 'assignedToUserId');
      record.assignedToUserId = record.picUserId;
      record.assignedToName = record.responsiblePerson;
      const assignedUser = (state.masterData.users || []).find(user => String(user.UserID) === record.assignedToUserId);
      record.assignedToRole = assignedUser ? assignedUser.Role : '';
      record.severity = item.Severity || 'Minor';
      record.dueDate = fieldValue(card, 'dueDate');
      record.status = assignedUser ? 'Assigned' : 'Open';
      record.findingStatus = record.status;
      const photo = fieldFile(card, 'beforePhoto');
      if (!record.findingDetail || !record.correctiveAction || !record.dueDate || !photo) return showToast(`กรุณากรอก Finding และ Before Photo ของ ${item.ChecklistID} ให้ครบ`, 'warning');
      record._photo = photo;
    }
    records.push(record);
  }
  if (!window.confirm(`ยืนยันบันทึก Audit จำนวน ${records.length} ข้อ?`)) return;
  showLoading('กำลังอัปโหลดรูปและบันทึก Audit...');
  try {
    for (const record of records) {
      if (record._photo) {
        const upload = await uploadFile(record._photo, 'AuditDraft', `DRAFT-${Date.now()}`, 'BeforePhoto', false);
        record.beforePhotoUrl = upload.DriveFileURL;
        delete record._photo;
      }
    }
    const auditDate = $('#auditDate').value;
    const payload = {
      auditDate, auditTime: $('#auditTime').value, periodMonth: auditDate.slice(0, 7),
      lineId: $('#auditLine').value, lineName: selectedText('#auditLine'),
      stationId: $('#auditStation').value, stationName: selectedText('#auditStation'),
      area: $('#auditArea').value, shift: $('#auditShift').value, auditLayer: $('#auditLayer').value,
      checklistLanguage: $('#checklistLanguage').value,
      remark: $('#auditRemark').value.trim(), records
    };
    const data = await apiCall('saveAudit', payload);
    const findingText = (data.FindingIDs || []).length ? ` | Finding: ${data.FindingIDs.join(', ')}` : '';
    showToast(`บันทึกสำเร็จ AuditID: ${data.AuditID}${findingText}`, 'success', 7000);
    resetAuditForm();
    loadDashboard(false);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    hideLoading();
  }
}

async function uploadFile(file, relatedType, relatedId, fileType, manageLoading = true) {
  if (!file) throw new Error('ไม่พบไฟล์สำหรับอัปโหลด');
  if (manageLoading) showLoading('กำลังอัปโหลดไฟล์...');
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
  container.innerHTML = state.findings.map(row => `<article class="finding-card ${String(row.OverdueFlag).toLowerCase() === 'yes' ? 'overdue' : ''}"><div class="finding-summary"><div><span class="finding-id">${escapeHtml(row.FindingID)}</span><span class="data-label">${formatDate(row.FoundDate)} · ${escapeHtml(row.Category || '-')} · ${escapeHtml(row.Severity || row.Priority || '-')}</span></div><div><span class="data-label">Line</span>${escapeHtml(row.LineName || row.LineID || '-')}</div><div><span class="data-label">Station</span>${escapeHtml(row.StationName || row.StationID || '-')}</div><div><span class="data-label">Assigned To</span>${escapeHtml(row.AssignedToName || row.PICName || '-')}</div><div><span class="data-label">Due Date</span>${formatDate(row.DueDate)}</div><div><span class="status-badge ${String(row.OverdueFlag).toLowerCase() === 'yes' ? 'status-overdue' : statusClass(row.Status)}">${String(row.OverdueFlag).toLowerCase() === 'yes' ? `Overdue ${number(row.DaysOverdue)}d` : escapeHtml(row.Status || '-')}</span></div></div><div class="finding-detail"><div><span class="data-label">Problem Detail</span>${escapeHtml(row.ProblemDetail || '-')}</div><div><span class="data-label">Corrective Action</span>${escapeHtml(row.CorrectiveAction || '-')}</div><div class="photo-link"><span class="data-label">Photo</span>${photoLinks(row)}</div></div><div class="finding-actions"><button class="btn btn-outline" data-edit-finding="${escapeAttr(row.FindingID)}">เปิด Finding</button></div></article>`).join('');
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
  populateFindingAssignee(row.AssignedToUserID || row.PICUserID || '');
  $('#editDueDate').value = dateInputValue(row.DueDate);
  $('#editStatus').value = row.Status || 'Open';
  $('#editCloseRemark').value = row.CloseRemark || '';
  $('#editAfterPhoto').value = '';
  $('#editPhotoPreview').innerHTML = row.AfterPhotoURL ? `<a href="${escapeAttr(row.AfterPhotoURL)}" target="_blank" rel="noopener">ดู After Photo ปัจจุบัน</a>` : '';
  const status = String(row.Status || '').toLowerCase();
  const pending = status === 'pending verification';
  const canVerify = pending && hasPermission('findings.verify');
  const assignedUserId = String(row.AssignedToUserID || row.PICUserID || '');
  const assignedToMe = assignedUserId
    ? assignedUserId === String(state.user.UserID || '')
    : String(row.AssignedToName || row.PICName || '') === String(state.user.FullName || '');
  const canUpdate = status !== 'closed' && (hasPermission('findings.view.all') || hasPermission('findings.update.line') ||
    (assignedToMe && hasPermission('findings.update.assigned')));
  const canSubmit = canUpdate && !pending && status !== 'closed';
  const severity = String(row.Severity || row.Priority || 'Minor').toLowerCase();
  const closePermission = severity === 'critical' ? 'findings.close.critical' : severity === 'major' ? 'findings.close.major' : 'findings.close.minor';
  $('#approveFindingButton').classList.toggle('hidden', !canVerify || !hasPermission(closePermission));
  $('#rejectFindingButton').classList.toggle('hidden', !canVerify);
  $('#submitVerificationButton').classList.toggle('hidden', !canSubmit);
  $('#saveFindingButton').classList.toggle('hidden', !canUpdate);
  $('#editRootCause').disabled = !canUpdate;
  $('#editCorrectiveAction').disabled = !canUpdate;
  $('#editAssignedTo').disabled = !canUpdate || !hasPermission('findings.assign');
  $('#editDueDate').disabled = !canUpdate;
  $('#editCloseRemark').disabled = !canUpdate && !canVerify;
  $('#editAfterPhoto').disabled = !canUpdate && !canVerify;
  $('#findingDialog').showModal();
}

async function updateFinding() {
  const findingId = $('#editFindingId').value;
  const closeRemark = $('#editCloseRemark').value.trim();
  const file = $('#editAfterPhoto').files[0];
  const existingPhoto = state.editingFinding ? state.editingFinding.AfterPhotoURL : '';
  if (!window.confirm(`ยืนยันบันทึกการแก้ไข Finding ${findingId}?`)) return;
  showLoading('กำลังบันทึก Finding...');
  try {
    let afterPhotoUrl = existingPhoto || '';
    if (file) {
      const upload = await uploadFile(file, 'Finding', findingId, 'AfterPhoto', false);
      afterPhotoUrl = upload.DriveFileURL;
    }
    const common = {
      findingId, rootCause: $('#editRootCause').value.trim(), correctiveAction: $('#editCorrectiveAction').value.trim(),
      dueDate: $('#editDueDate').value, afterPhotoUrl, closeRemark, remark: 'Updated from web application'
    };
    if (hasPermission('findings.assign')) common.assignedToUserId = $('#editAssignedTo').value;
    await apiCall('updateFinding', common);
    $('#findingDialog').close();
    showToast('บันทึกการแก้ไข Finding สำเร็จ', 'success');
    await loadFindings();
    loadDashboard(false);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    hideLoading();
  }
}

async function submitFindingForVerification() {
  const findingId = $('#editFindingId').value;
  const rootCause = $('#editRootCause').value.trim();
  const correctiveAction = $('#editCorrectiveAction').value.trim();
  const existingPhoto = state.editingFinding ? state.editingFinding.AfterPhotoURL : '';
  const file = $('#editAfterPhoto').files[0];
  if (!rootCause) return showToast('กรุณาระบุ Root Cause ก่อนส่งตรวจสอบ', 'warning');
  if (!correctiveAction) return showToast('กรุณาระบุ Corrective Action ก่อนส่งตรวจสอบ', 'warning');
  if (!file && !existingPhoto) return showToast('กรุณาอัปโหลด After Photo ก่อนส่งตรวจสอบ', 'warning');
  if (!window.confirm(`ส่ง Finding ${findingId} เพื่อตรวจสอบ?`)) return;
  await runFindingWorkflow('submitFinding', {
    findingId, rootCause, correctiveAction,
    closeRemark: $('#editCloseRemark').value.trim(),
    remark: $('#editCloseRemark').value.trim() || 'Submitted for verification'
  }, 'ส่ง Finding เพื่อตรวจสอบแล้ว');
}

async function verifyFinding(decision) {
  const findingId = $('#editFindingId').value;
  const closeRemark = $('#editCloseRemark').value.trim();
  if (decision === 'Approve' && !closeRemark) return showToast('กรุณาระบุ Close Remark ก่อนปิด Finding', 'warning');
  const rejectReason = decision === 'Reject' ? (window.prompt('กรุณาระบุเหตุผลที่ Reject', closeRemark) || '').trim() : '';
  if (decision === 'Reject' && !rejectReason) return showToast('กรุณาระบุเหตุผลที่ Reject', 'warning');
  if (!window.confirm(`${decision} Finding ${findingId}?`)) return;
  await runFindingWorkflow('verifyFinding', {
    findingId, decision, rejectReason, closeRemark: decision === 'Reject' ? rejectReason : closeRemark
  }, decision === 'Approve' ? 'อนุมัติและปิด Finding แล้ว' : 'Reject Finding แล้ว');
}

async function runFindingWorkflow(action, payload, successMessage) {
  showLoading('กำลังบันทึก Finding...');
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
    showToast(successMessage, 'success');
    await loadFindings();
    loadDashboard(false);
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
  showLoading('กำลังจัดทำรายงาน...');
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

function renderMonthlyReport(data) {
  const metrics = [['Total Audit', data.TotalAudit], ['Total OK', data.TotalOK], ['Total NG', data.TotalNG], ['Total N/A', data.TotalNA], ['NG Rate', `${number(data.NGRate).toFixed(2)}%`], ['Open Finding', data.OpenFinding], ['Closed Finding', data.ClosedFinding], ['Overdue Action', data.OverdueAction]];
  $('#reportContent').innerHTML = `<article class="panel"><div class="panel-title"><div><p class="eyebrow">MONTHLY LPA REPORT</p><h3>ประจำเดือน ${escapeHtml(formatPeriod(data.Period))}</h3></div></div><div class="report-metrics">${metrics.map(item => `<div class="metric-card"><span class="metric-label">${escapeHtml(item[0])}</span><strong class="metric-value">${escapeHtml(String(item[1] ?? 0))}</strong></div>`).join('')}</div></article><div class="content-grid two-columns"><article class="panel report-section"><h3>Summary by Category</h3>${tableHtml(['Category', 'Total', 'OK', 'NG', 'N/A'], (data.SummaryByCategory || []).map(row => [row.Category, row.Total, row.OK, row.NG, row.NA]))}</article><article class="panel report-section"><h3>Summary by Line</h3>${tableHtml(['Line', 'Audit', 'OK', 'NG', 'N/A'], (data.SummaryByLine || []).map(row => [row.LineName || row.LineID, row.TotalAudit, row.TotalOK, row.TotalNG, row.TotalNA]))}</article></div><article class="panel report-section"><h3>Top Finding</h3>${findingReportTable(data.TopFinding || [])}</article><article class="panel report-section"><h3>Action Plan</h3>${findingReportTable(data.ActionPlanList || [])}</article>`;
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
  showLoading('กำลังโหลดผู้ใช้...');
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
  $('#adminAccessEditor').classList.toggle('hidden', !user || !hasPermission('users.managePermission'));
  $('#resetPasswordButton').classList.toggle('hidden', !user || !hasPermission('users.resetPassword'));
  $('#deactivateUserButton').classList.toggle('hidden', !user || !hasPermission('users.deactivate') || user.UserID === state.user.UserID);
  $('#userDialog').showModal();
  if (user && hasPermission('users.managePermission')) {
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
  showLoading('กำลังโหลดสิทธิ์ผู้ใช้...');
  try {
    const [permissionData, lineData] = await Promise.all([
      apiCall('listUserPermissions', { userId }),
      apiCall('listUserLineAccess', { userId })
    ]);
    const permissionMap = {};
    (permissionData.userPermissions || []).forEach(row => { permissionMap[row.PermissionKey] = row.Allowed || 'Inherit'; });
    $('#adminPermissionList').innerHTML = PERMISSION_CATALOG.map(key => {
      const value = permissionMap[key] || 'Inherit';
      return `<label class="permission-item">${escapeHtml(key)}<select data-user-permission="${escapeAttr(key)}"><option ${value === 'Inherit' ? 'selected' : ''}>Inherit</option><option value="Yes" ${value === 'Yes' ? 'selected' : ''}>Allow</option><option value="No" ${value === 'No' ? 'selected' : ''}>Deny</option></select></label>`;
    }).join('');
    const lineMap = {};
    (lineData.lineAccess || []).forEach(row => { lineMap[row.LineID] = row; });
    const lines = [{ LineID: 'ALL', LineName: 'ALL' }, ...(state.masterData.lines || [])];
    $('#adminLineAccessList').innerHTML = lines.map(line => {
      const access = lineMap[line.LineID];
      return `<div class="permission-item line-access-item"><label><input type="checkbox" data-line-access="${escapeAttr(line.LineID)}" ${access && String(access.ActiveStatus).toLowerCase() === 'active' ? 'checked' : ''}> ${escapeHtml(line.LineName || line.LineID)}</label><select data-line-level="${escapeAttr(line.LineID)}"><option>View</option><option ${access && access.AccessLevel === 'Update' ? 'selected' : ''}>Update</option><option ${access && access.AccessLevel === 'Manage' ? 'selected' : ''}>Manage</option></select></div>`;
    }).join('');
  } finally {
    hideLoading();
  }
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
  showLoading('กำลังบันทึกผู้ใช้...');
  try {
    const result = await apiCall(userId ? 'updateUser' : 'createUser', userId ? { ...payload, userId } : payload);
    const savedUserId = userId || result.user.UserID;
    if (userId && hasPermission('users.managePermission')) await saveUserAccess(savedUserId);
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
  const permissions = $$('[data-user-permission]').map(input => ({ permissionKey: input.dataset.userPermission, allowed: input.value, reason: 'Updated from Admin Panel' }));
  const lineAccess = $$('[data-line-access]').map(input => ({
    lineId: input.dataset.lineAccess,
    accessLevel: $(`[data-line-level="${cssEscape(input.dataset.lineAccess)}"]`).value,
    activeStatus: input.checked ? 'Active' : 'Inactive'
  }));
  await apiCall('updateUserPermissions', { userId, permissions });
  await apiCall('updateUserLineAccess', { userId, lineAccess });
}

async function deactivateSelectedUser() {
  const userId = $('#adminEditUserId').value;
  if (!userId || !window.confirm('ยืนยันปิดใช้งานผู้ใช้นี้?')) return;
  try {
    await apiCall('deactivateUser', { userId });
    $('#userDialog').close();
    showToast('ปิดใช้งานผู้ใช้แล้ว', 'success');
    await loadUsers();
  } catch (error) { showToast(error.message, 'error'); }
}

async function resetSelectedUserPassword() {
  const userId = $('#adminEditUserId').value;
  const password = window.prompt('รหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร');
  if (!userId || !password) return;
  try {
    await apiCall('resetUserPassword', { userId, password });
    showToast('Reset password สำเร็จ', 'success');
  } catch (error) { showToast(error.message, 'error'); }
}

function renderMasterChecklist(rows) {
  const headers = ['ChecklistID', 'Category', 'CheckItem', 'StandardCriteria', 'ExampleOK', 'ExampleNG', 'LineName', 'StationName', 'AuditLayer', 'Frequency', 'Severity', 'ActiveStatus'];
  $('#masterChecklistTable').innerHTML = rows.length ? tableHtml(headers, rows.map(row => headers.map(header => row[header] ?? ''))) : emptyHtml('ไม่พบ Checklist');
}

function populateAllMasterSelects() {
  ['#auditLine', '#findingLine', '#checklistLine'].forEach((selector, index) => populateSelect(selector, state.masterData.lines || [], 'LineID', 'LineName', index === 1 ? 'ทั้งหมด' : 'เลือก Line'));
  populateStationSelect('#auditStation', '', false);
  populateStationSelect('#findingStation', '', true);
  populateStationSelect('#checklistStation', '', false);
  populateSelect('#adminLineFilter', state.masterData.lines || [], 'LineID', 'LineName', 'ทั้งหมด');
  populateSelect('#adminLineDefault', state.masterData.lines || [], 'LineID', 'LineName', 'ไม่ระบุ');
}

function populateStationSelect(selector, lineId, allowAll) {
  const rows = (state.masterData.stations || []).filter(row => !lineId || String(row.LineID) === String(lineId));
  populateSelect(selector, rows, 'StationID', 'StationName', allowAll ? 'ทั้งหมด' : 'เลือก Station');
}

function populateSelect(selector, rows, valueField, textField, firstLabel) {
  const select = $(selector);
  const current = select.value;
  select.innerHTML = `<option value="">${escapeHtml(firstLabel)}</option>` + rows.map(row => `<option value="${escapeAttr(row[valueField])}">${escapeHtml(row[textField] || row[valueField])}</option>`).join('');
  if (rows.some(row => String(row[valueField]) === current)) select.value = current;
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
  $('#auditChecklist').innerHTML = emptyHtml('เลือก Line, Station และ Audit Layer แล้วกด “โหลด Checklist”');
  $('#auditSaveBar').classList.add('hidden');
  $('#auditRemark').value = '';
  setDefaultDates();
}

function navigateTo(page) {
  $$('.page').forEach(section => section.classList.toggle('active-page', section.id === `page-${page}`));
  $$('#mainNav [data-page], .bottom-nav [data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  closeSidebar();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (page === 'dashboard' && !state.dashboard) loadDashboard();
  if (page === 'findings' && !state.findings.length) loadFindings();
  if (page === 'admin' && hasPermission('users.view')) loadUsers();
}

function showLogin() { $('#loginView').classList.remove('hidden'); $('#appView').classList.add('hidden'); $('#username').focus(); }
function showApplication() { $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden'); }
function openSidebar() { $('#sidebar').classList.add('open'); $('#sidebarBackdrop').classList.remove('hidden'); }
function closeSidebar() { $('#sidebar').classList.remove('open'); $('#sidebarBackdrop').classList.add('hidden'); }
function showLoading(message = 'กำลังโหลด...') { $('#loadingText').textContent = message; $('#loadingOverlay').classList.remove('hidden'); }
function hideLoading() { $('#loadingOverlay').classList.add('hidden'); }

function showToast(message, type = 'info', duration = 4500) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  $('#toastContainer').appendChild(toast);
  setTimeout(() => toast.remove(), duration);
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
  return 'status-na';
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
}

function setDefaultDates() {
  const now = new Date();
  $('#auditDate').value = localDateInput(now);
  $('#auditTime').value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  $('#findingMonth').value = '';
  $('#reportMonth').value = month;
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
