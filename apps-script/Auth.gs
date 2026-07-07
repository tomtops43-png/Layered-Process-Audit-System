/** Authentication, token persistence, and role authorization. */
var LOGIN_MAX_FAILED_ATTEMPTS = 5;
var LOGIN_LOCKOUT_SECONDS = 600;

function loginFailureKey_(username) {
  return 'LPA_LOGIN_FAIL_' + cleanString_(username).toLowerCase();
}

function registerLoginFailure_(username) {
  var key = loginFailureKey_(username);
  var cache = CacheService.getScriptCache();
  var count = (Number(cache.get(key)) || 0) + 1;
  cache.put(key, String(count), LOGIN_LOCKOUT_SECONDS);
  return count;
}

function isLoginLocked_(username) {
  return (Number(CacheService.getScriptCache().get(loginFailureKey_(username))) || 0) >= LOGIN_MAX_FAILED_ATTEMPTS;
}

function clearLoginFailures_(username) {
  CacheService.getScriptCache().remove(loginFailureKey_(username));
}

function login(payload) {
  try {
    requireFields_(payload, ['username', 'password']);
    var username = cleanString_(payload.username).toLowerCase();
    if (isLoginLocked_(username)) {
      return jsonResponse(false, 'Too many failed login attempts. Please try again in 10 minutes.', {});
    }
    var user = getRowsAsObjects(SHEET_NAMES.USERS).filter(function (row) {
      return cleanString_(row.Username).toLowerCase() === username;
    })[0];
    if (!user || !isActive_(user.ActiveStatus)) {
      registerLoginFailure_(username);
      return jsonResponse(false, 'Invalid username or password.', {});
    }
    if (!verifyPassword_(payload.password, user.PasswordHash)) {
      registerLoginFailure_(username);
      return jsonResponse(false, 'Invalid username or password.', {});
    }
    if (VALID_ROLES.indexOf(cleanString_(user.Role)) === -1) return jsonResponse(false, 'User role is not valid.', {});
    clearLoginFailures_(username);

    var now = new Date();
    var token = createToken_(user, now);
    var loginUpdates = {
      LastLogin: formatDateTimeBangkok(now), UpdatedAt: formatDateTimeBangkok(now), UpdatedBy: user.UserID
    };
    // Transparently migrate legacy unsalted hashes now that we know the password.
    if (isLegacyPasswordHash_(user.PasswordHash)) {
      loginUpdates.PasswordHash = createPasswordHash_(payload.password);
      invalidateUserCache_();
    }
    updateObjectById(SHEET_NAMES.USERS, 'UserID', user.UserID, loginUpdates);
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

// Cached Users lookup so validateToken does not hit the spreadsheet on every
// API request. Shares the Users row cache in Utils.gs (invalidated on user edits).
function findUserByIdCached_(userId) {
  return getCachedUserRows_().filter(function (row) {
    return valuesEqual_(row.UserID, userId);
  })[0] || null;
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
    var user = findUserByIdCached_(session.UserID);
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
  var identities = [user.UserID, user.Username, user.FullName];
  return identities.some(function (id) { return csvContains_(finding.AssignedToUserID || finding.PICUserID, id); }) ||
    identities.some(function (id) { return csvContains_(finding.AssignedToName || finding.PICName, id); }) ||
    identities.some(function (id) { return csvContains_(finding.AuditorUserID || finding.CreatedBy, id); }) ||
    identities.some(function (id) { return csvContains_(finding.VerifierUserID, id); });
}
