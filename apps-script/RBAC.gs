/** Permission and line-access helpers shared by API modules. */
function getCurrentUserFromRequest_(token) {
  var user = validateToken(token);
  if (!user) throw new Error('Invalid or expired authentication token.');
  return user;
}

function getUserPermissions_(user) {
  if (!user) return {};
  var permissions = {};
  if (isAdmin_(user)) permissions['*'] = true;
  var defaults = getDefaultRolePermissions_();
  (defaults[user.Role] || []).forEach(function (permissionKey) { permissions[permissionKey] = true; });
  safeRowsAsObjects_(SHEET_NAMES.ROLE_PERMISSIONS).forEach(function (row) {
    if (valuesEqual_(row.Role, user.Role)) permissions[cleanString_(row.PermissionKey)] = isAllowed_(row.Allowed);
  });
  safeRowsAsObjects_(SHEET_NAMES.USER_PERMISSIONS).forEach(function (row) {
    if (valuesEqual_(row.UserID, user.UserID) && cleanString_(row.Allowed).toLowerCase() !== 'inherit') {
      permissions[cleanString_(row.PermissionKey)] = isAllowed_(row.Allowed);
    }
  });
  return permissions;
}

function getUserLineAccess_(user) {
  if (!user) return [];
  if (isAdmin_(user)) return [{ UserID: user.UserID, LineID: 'ALL', LineName: 'ALL', AccessLevel: 'Manage', ActiveStatus: 'Active' }];
  return safeRowsAsObjects_(SHEET_NAMES.USER_LINE_ACCESS).filter(function (row) {
    return valuesEqual_(row.UserID, user.UserID) && isActive_(row.ActiveStatus);
  }).map(sanitizeForClient_);
}

function safeRowsAsObjects_(sheetName) {
  try {
    return getRowsAsObjects(sheetName);
  } catch (error) {
    if (/Required sheet not found/.test(safeErrorMessage_(error))) return [];
    throw error;
  }
}

function hasPermission_(user, permissionKey) {
  if (!user || !permissionKey) return false;
  if (isAdmin_(user)) return true;
  var permissions = getUserPermissions_(user);
  if (permissionKey === 'users.view' && permissions['users.managePermission'] === true) return true;
  return permissions['*'] === true || permissions[permissionKey] === true;
}

function requirePermission_(user, permissionKey) {
  if (!hasPermission_(user, permissionKey)) throw new Error('Permission denied: ' + permissionKey);
  return true;
}

function canAccessLine_(user, lineId, requiredLevel) {
  if (isAdmin_(user) || isAllFilter_(lineId)) return true;
  var levelRank = { view: 1, audit: 2, update: 2, manage: 3, all: 3 };
  var minimum = levelRank[cleanString_(requiredLevel).toLowerCase()] || 1;
  return getUserLineAccess_(user).some(function (row) {
    return (valuesEqual_(row.LineID, lineId) || valuesEqual_(row.LineID, 'ALL')) &&
      (levelRank[cleanString_(row.AccessLevel).toLowerCase()] || 0) >= minimum;
  });
}

function requireLineAccess_(user, lineId, requiredLevel) {
  if (!canAccessLine_(user, lineId, requiredLevel)) throw new Error('Line access denied: ' + cleanString_(lineId));
  return true;
}

function isAdmin_(user) {
  return cleanString_(user && user.Role).toLowerCase() === 'admin';
}

function isAllFilter_(value) {
  var normalized = cleanString_(value).toLowerCase();
  return ['', 'all', 'ทั้งหมด', 'null', 'undefined'].indexOf(normalized) !== -1;
}

function isAllowed_(value) {
  return value === true || ['yes', 'y', 'true', '1', 'allowed'].indexOf(cleanString_(value).toLowerCase()) !== -1;
}

function hasApiAccess_(user, action) {
  var actionPermissions = {
    listUsers: ['users.view'], createUser: ['users.create'], updateUser: ['users.update'],
    deactivateUser: ['users.deactivate'], resetUserPassword: ['users.resetPassword'],
    listRolePermissions: ['users.managePermission'], updateRolePermissions: ['users.managePermission'],
    listUserPermissions: ['users.managePermission'], updateUserPermissions: ['users.managePermission'],
    listUserLineAccess: ['users.managePermission'], updateUserLineAccess: ['users.managePermission'],
    getMasterLists: ['users.managePermission'], upsertMasterList: ['users.managePermission'],
    getChecklist: ['checklist.view', 'checklist.manage', 'audit.manager.create', 'audit.supervisor.create', 'audit.engineer.create', 'audit.leader.create'],
    saveAudit: ['audit.manager.create', 'audit.supervisor.create', 'audit.engineer.create', 'audit.leader.create'],
    getAuditList: ['audit.view.all', 'audit.view.line', 'audit.view.own'],
    getAuditPlan: ['audit.plan.view'], getMyAuditPlanSummary: ['audit.plan.view'],
    getAuditPlanRules: ['audit.plan.view'], upsertAuditPlanRule: ['audit.plan.manage'], deleteAuditRule: ['audit.plan.manage'],
    generateAuditPlan: ['audit.plan.generate'], refreshAuditPlanStatus: ['audit.plan.refresh'],
    getFindings: ['findings.view.all', 'findings.view.line', 'findings.view.assigned', 'findings.view.created', 'findings.verify'],
    getMyFindingNotificationSummary: ['findings.view.all', 'findings.view.line', 'findings.view.assigned', 'findings.view.created', 'findings.verify'],
    updateFinding: ['findings.update.assigned', 'findings.update.line', 'findings.assign', 'findings.view.all'],
    submitFinding: ['findings.update.assigned', 'findings.update.line', 'findings.view.all'],
    verifyFinding: ['findings.verify'],
    closeFinding: ['findings.close.minor', 'findings.close.major', 'findings.close.critical'],
    getDashboard: ['dashboard.view', 'dashboard.view.all'],
    getMonthlyReport: ['reports.view'], exportReportCsv: ['reports.export'],
    uploadFile: ['findings.update.assigned', 'findings.update.line', 'findings.verify', 'findings.view.all',
      'audit.manager.create', 'audit.supervisor.create', 'audit.engineer.create', 'audit.leader.create']
  };
  if (['getCurrentUser', 'getMasterData'].indexOf(action) !== -1) return true;
  if (!actionPermissions[action]) return false;
  return actionPermissions[action].some(function (permissionKey) { return hasPermission_(user, permissionKey); });
}

function permissionContext_(user) {
  var permissionMap = getUserPermissions_(user);
  return {
    permissions: Object.keys(permissionMap).filter(function (key) { return permissionMap[key] === true; }),
    lineAccess: getUserLineAccess_(user)
  };
}
