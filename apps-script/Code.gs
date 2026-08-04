/** Main JSON API entry point. */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse(false, 'Request body is required.', {});
    }

    var request;
    try {
      request = JSON.parse(e.postData.contents);
    } catch (parseError) {
      return jsonResponse(false, 'Invalid JSON request body.', {});
    }

    var action = cleanString_(request.action);
    var payload = request.payload && typeof request.payload === 'object' ? request.payload : {};
    var token = cleanString_(request.token);
    if (!action) return jsonResponse(false, 'Action is required.', {});
    if (action === 'batch') return runBatch_(payload, token);

    var handlers = buildApiHandlers_(payload);
    if (!handlers[action]) return jsonResponse(false, 'Unknown action: ' + action, {});
    if (PUBLIC_ACTIONS.indexOf(action) !== -1) return handlers[action]();

    var currentUser = getCurrentUserFromRequest_(token);
    if (!hasApiAccess_(currentUser, action)) return jsonResponse(false, 'Permission denied for action: ' + action, {});

    return handlers[action](currentUser);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

/**
 * Runs several actions inside one Apps Script execution.
 *
 * Each web-app invocation costs ~2s of platform overhead before any of our code
 * runs, so a 6-call page load spends more time waiting on round trips than on
 * work. Batching shares that overhead, the token check, and the per-execution
 * sheet cache in Utils.gs across every sub-call.
 */
var MAX_BATCH_CALLS = 10;

function runBatch_(payload, token) {
  var calls = payload && Array.isArray(payload.calls) ? payload.calls : [];
  if (!calls.length) return jsonResponse(false, 'batch requires a non-empty calls array.', {});
  if (calls.length > MAX_BATCH_CALLS) return jsonResponse(false, 'batch accepts at most ' + MAX_BATCH_CALLS + ' calls.', {});

  var currentUser = getCurrentUserFromRequest_(token);
  var results = calls.map(function (call) {
    var subAction = cleanString_(call && call.action);
    var subPayload = call && call.payload && typeof call.payload === 'object' ? call.payload : {};
    try {
      // login mutates auth state and batch would recurse — neither belongs inside a batch.
      if (!subAction || subAction === 'batch' || PUBLIC_ACTIONS.indexOf(subAction) !== -1) {
        return { action: subAction, success: false, message: 'Action not allowed in batch: ' + subAction, data: {} };
      }
      var handlers = buildApiHandlers_(subPayload);
      if (!handlers[subAction]) return { action: subAction, success: false, message: 'Unknown action: ' + subAction, data: {} };
      if (!hasApiAccess_(currentUser, subAction)) {
        return { action: subAction, success: false, message: 'Permission denied for action: ' + subAction, data: {} };
      }
      var result = JSON.parse(handlers[subAction](currentUser).getContent());
      result.action = subAction;
      return result;
    } catch (error) {
      console.error(error && error.stack ? error.stack : error);
      return { action: subAction, success: false, message: safeErrorMessage_(error), data: {} };
    }
  });
  return jsonResponse(true, 'Batch executed.', { results: results });
}

function buildApiHandlers_(payload) {
  return {
    login: function () { return login(payload); },
    getCurrentUser: function (user) { return getCurrentUser(user); },
    getMasterData: function (user) { return getMasterData(payload, user); },
    getMasterLists: function (user) { return getMasterLists(payload, user); },
    upsertMasterList: function (user) { return upsertMasterList(payload, user); },
    getChecklist: function (user) { return getChecklist(payload, user); },
    saveAudit: function (user) { return saveAudit(payload, user); },
    getAuditList: function (user) { return getAuditList(payload, user); },
    getAuditPlan: function (user) { return getAuditPlan(payload, user); },
    getAuditPlanRules: function (user) { return getAuditPlanRules(payload, user); },
    getManagerComplianceData: function (user) { return getManagerComplianceData(payload, user); },
    getDirectorDashboardData: function (user) { return getDirectorDashboardData(payload, user); },
    migrateRulesToLineLevel: function (user) { return migrateRulesToLineLevel(payload, user); },
    deduplicateLineRules: function (user) { return deduplicateLineRules(payload, user); },
    getProductionPlan: function (user) { return getProductionPlan(payload, user); },
    saveProductionPlan: function (user) { return saveProductionPlan(payload, user); },
    upsertAuditPlanRule: function (user) { return upsertAuditPlanRule(payload, user); },
    deleteAuditRule: function (user) { return deleteAuditRule(payload, user); },
    generateAuditPlan: function (user) { return generateAuditPlan(payload, user); },
    refreshAuditPlanStatus: function (user) { return refreshAuditPlanStatus(payload, user); },
    getMyAuditPlanSummary: function (user) { return getMyAuditPlanSummary(payload, user); },
    getFindings: function (user) { return getFindings(payload, user); },
    getMyFindingNotificationSummary: function (user) { return getMyFindingNotificationSummary(payload, user); },
    updateFinding: function (user) { return updateFinding(payload, user); },
    submitFinding: function (user) { return submitFinding(payload, user); },
    verifyFinding: function (user) { return verifyFinding(payload, user); },
    closeFinding: function (user) { return closeFinding(payload, user); },
    uploadFile: function (user) { return uploadFile(payload, user); },
    getDashboard: function (user) { return getDashboard(payload, user); },
    getLeaderDashboardBatch: function (user) { return getLeaderDashboardBatch(payload, user); },
    getFindingShiftDigest: function (user) { return getFindingShiftDigest(payload, user); },
    getMeetingPosts: function (user) { return getMeetingPosts(payload, user); },
    acknowledgeMeetingPost: function (user) { return acknowledgeMeetingPost(payload, user); },
    getMyPendingMeetingAcks: function (user) { return getMyPendingMeetingAcks(payload, user); },
    saveMeetingPost: function (user) { return saveMeetingPost(payload, user); },
    deleteMeetingPost: function (user) { return deleteMeetingPost(payload, user); },
    updateMeetingPostStatus: function (user) { return updateMeetingPostStatus(payload, user); },
    convertMeetingSlideFile: function (user) { return convertMeetingSlideFile(payload, user); },
    getMonthlyReport: function (user) { return getMonthlyReport(payload, user); },
    exportReportCsv: function (user) { return exportReportCsv(payload, user); },
    listUsers: function (user) { return listUsers(payload, user); },
    createUser: function (user) { return createUser(payload, user); },
    updateUser: function (user) { return updateUser(payload, user); },
    deactivateUser: function (user) { return deactivateUser(payload, user); },
    resetUserPassword: function (user) { return resetUserPassword(payload, user); },
    listRolePermissions: function (user) { return listRolePermissions(payload, user); },
    updateRolePermissions: function (user) { return updateRolePermissions(payload, user); },
    listUserPermissions: function (user) { return listUserPermissions(payload, user); },
    updateUserPermissions: function (user) { return updateUserPermissions(payload, user); },
    listUserLineAccess: function (user) { return listUserLineAccess(payload, user); },
    updateUserLineAccess: function (user) { return updateUserLineAccess(payload, user); }
  };
}

/** Lightweight deployment/status endpoint. */
function doGet() {
  return jsonResponse(true, 'LPA backend API is running.', {
    appName: getSetting('APP_NAME') || 'Layered Process Audit',
    timezone: APP_TIMEZONE,
    timestamp: formatDateTimeBangkok(new Date())
  });
}
