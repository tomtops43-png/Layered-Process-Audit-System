/** Authentication, token persistence, and role authorization. */
function login(payload) {
  try {
    requireFields_(payload, ['username', 'password']);
    var username = cleanString_(payload.username).toLowerCase();
    var user = getRowsAsObjects(SHEET_NAMES.USERS).filter(function (row) {
      return cleanString_(row.Username).toLowerCase() === username;
    })[0];
    if (!user || !isActive_(user.ActiveStatus)) return jsonResponse(false, 'Invalid username or password.', {});
    if (cleanString_(user.PasswordHash).toLowerCase() !== hashPassword(payload.password).toLowerCase()) {
      return jsonResponse(false, 'Invalid username or password.', {});
    }
    if (VALID_ROLES.indexOf(cleanString_(user.Role)) === -1) return jsonResponse(false, 'User role is not valid.', {});

    var now = new Date();
    var token = createToken_(user, now);
    updateObjectById(SHEET_NAMES.USERS, 'UserID', user.UserID, {
      LastLogin: formatDateTimeBangkok(now), UpdatedAt: formatDateTimeBangkok(now), UpdatedBy: user.UserID
    });
    var context = permissionContext_(user);
    return jsonResponse(true, 'Login successful.', {
      token: token, expiresIn: TOKEN_TTL_SECONDS, user: publicUser_(user),
      permissions: context.permissions, lineAccess: context.lineAccess
    });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function createToken_(user, now) {
  var random = Utilities.getUuid() + ':' + Utilities.getUuid() + ':' + now.getTime();
  var token = hashPassword(random);
  var session = {
    UserID: user.UserID, Username: user.Username, FullName: user.FullName,
    Role: user.Role, LineDefault: user.LineDefault || '',
    expiry: now.getTime() + TOKEN_TTL_SECONDS * 1000
  };
  var serialized = JSON.stringify(session);
  CacheService.getScriptCache().put(TOKEN_PROPERTY_PREFIX + token, serialized, TOKEN_TTL_SECONDS);
  PropertiesService.getScriptProperties().setProperty(TOKEN_PROPERTY_PREFIX + token, serialized);
  return token;
}

function validateToken(token) {
  token = cleanString_(token);
  if (!token) return null;
  var key = TOKEN_PROPERTY_PREFIX + token;
  var serialized = CacheService.getScriptCache().get(key) || PropertiesService.getScriptProperties().getProperty(key);
  if (!serialized) return null;
  try {
    var session = JSON.parse(serialized);
    if (!session.expiry || Number(session.expiry) <= new Date().getTime()) {
      CacheService.getScriptCache().remove(key);
      PropertiesService.getScriptProperties().deleteProperty(key);
      return null;
    }
    var user = findById_(SHEET_NAMES.USERS, 'UserID', session.UserID);
    if (!user || !isActive_(user.ActiveStatus)) return null;
    session.Role = user.Role;
    session.FullName = user.FullName;
    session.LineDefault = user.LineDefault || '';
    CacheService.getScriptCache().put(key, JSON.stringify(session), Math.max(1, Math.floor((session.expiry - new Date().getTime()) / 1000)));
    return session;
  } catch (error) {
    return null;
  }
}

function hasPermission(role, action) {
  role = cleanString_(role);
  if (role === 'Admin') return true;
  var permissions = {
    Manager: ['getCurrentUser', 'getMasterData', 'getChecklist', 'saveAudit', 'getAuditList', 'getFindings', 'updateFinding', 'submitFinding', 'verifyFinding', 'closeFinding', 'uploadFile', 'getDashboard', 'getMonthlyReport', 'exportReportCsv'],
    Supervisor: ['getCurrentUser', 'getMasterData', 'getChecklist', 'saveAudit', 'getAuditList', 'getFindings', 'updateFinding', 'submitFinding', 'uploadFile', 'getDashboard', 'getMonthlyReport', 'exportReportCsv'],
    Engineer: ['getCurrentUser', 'getMasterData', 'getChecklist', 'saveAudit', 'getAuditList', 'getFindings', 'updateFinding', 'submitFinding', 'verifyFinding', 'closeFinding', 'uploadFile', 'getDashboard', 'getMonthlyReport', 'exportReportCsv'],
    Leader: ['getCurrentUser', 'getMasterData', 'getChecklist', 'saveAudit', 'getAuditList', 'getFindings', 'updateFinding', 'submitFinding', 'closeFinding', 'uploadFile'],
    User: ['getCurrentUser', 'getMasterData', 'getAuditList', 'getFindings', 'updateFinding', 'submitFinding', 'uploadFile']
  };
  return permissions[role] ? permissions[role].indexOf(action) !== -1 : false;
}

function publicUser_(user) {
  return {
    UserID: user.UserID, EmployeeID: user.EmployeeID, Username: user.Username,
    FullName: user.FullName, Nickname: user.Nickname, Role: user.Role,
    Department: user.Department, LineDefault: user.LineDefault, Email: user.Email, Phone: user.Phone
  };
}

function canAccessFinding_(user, finding) {
  if (['Admin', 'Manager', 'Supervisor', 'Engineer'].indexOf(user.Role) !== -1) return true;
  var identityValues = [user.UserID, user.Username, user.FullName].map(function (value) { return cleanString_(value).toLowerCase(); });
  return identityValues.indexOf(cleanString_(finding.AssignedToUserID || finding.PICUserID).toLowerCase()) !== -1 ||
    identityValues.indexOf(cleanString_(finding.AssignedToName || finding.PICName).toLowerCase()) !== -1 ||
    identityValues.indexOf(cleanString_(finding.AuditorUserID || finding.CreatedBy).toLowerCase()) !== -1 ||
    identityValues.indexOf(cleanString_(finding.VerifierUserID).toLowerCase()) !== -1;
}
