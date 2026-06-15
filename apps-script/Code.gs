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

    var handlers = {
      login: function () { return login(payload); },
      getCurrentUser: function (user) { return getCurrentUser(user); },
      getMasterData: function (user) { return getMasterData(payload, user); },
      getChecklist: function (user) { return getChecklist(payload, user); },
      saveAudit: function (user) { return saveAudit(payload, user); },
      getAuditList: function (user) { return getAuditList(payload, user); },
      getAuditPlan: function (user) { return getAuditPlan(payload, user); },
      generateAuditPlan: function (user) { return generateAuditPlan(payload, user); },
      refreshAuditPlanStatus: function (user) { return refreshAuditPlanStatus(payload, user); },
      getMyAuditPlanSummary: function (user) { return getMyAuditPlanSummary(payload, user); },
      getFindings: function (user) { return getFindings(payload, user); },
      updateFinding: function (user) { return updateFinding(payload, user); },
      submitFinding: function (user) { return submitFinding(payload, user); },
      verifyFinding: function (user) { return verifyFinding(payload, user); },
      closeFinding: function (user) { return closeFinding(payload, user); },
      uploadFile: function (user) { return uploadFile(payload, user); },
      getDashboard: function (user) { return getDashboard(payload, user); },
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

/** Lightweight deployment/status endpoint. */
function doGet() {
  return jsonResponse(true, 'LPA backend API is running.', {
    appName: getSetting('APP_NAME') || 'Layered Process Audit',
    timezone: APP_TIMEZONE,
    timestamp: formatDateTimeBangkok(new Date())
  });
}
