/** User-facing account APIs. */
function getCurrentUser(currentUser) {
  try {
    var user = findById_(SHEET_NAMES.USERS, 'UserID', currentUser.UserID);
    if (!user || !isActive_(user.ActiveStatus)) return jsonResponse(false, 'User account is unavailable.', {});
    var data = publicUser_(user);
    var context = permissionContext_(user);
    data.permissions = context.permissions;
    data.lineAccess = context.lineAccess;
    return jsonResponse(true, 'Current user loaded.', data);
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function listUsers(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'users.view');
    var search = cleanString_(payload.search).toLowerCase();
    var role = cleanString_(payload.role);
    var status = cleanString_(payload.status);
    var lineId = cleanString_(payload.lineId);
    var lineRows = getCachedUserLineAccessRows_();
    var users = getRowsAsObjects(SHEET_NAMES.USERS).filter(function (user) {
      var searchText = [user.Username, user.FullName, user.EmployeeID, user.Email].join(' ').toLowerCase();
      var hasLine = isAllFilter_(lineId) || lineRows.some(function (row) {
        return valuesEqual_(row.UserID, user.UserID) && isActive_(row.ActiveStatus) &&
          (valuesEqual_(row.LineID, lineId) || valuesEqual_(row.LineID, 'ALL'));
      });
      return (!search || searchText.indexOf(search) !== -1) &&
        (isAllFilter_(role) || valuesEqual_(user.Role, role)) &&
        (isAllFilter_(status) || valuesEqual_(user.ActiveStatus, status)) && hasLine;
    }).map(function (user) {
      var safeUser = publicUser_(user);
      safeUser.ActiveStatus = user.ActiveStatus;
      safeUser.LastLogin = user.LastLogin;
      safeUser.CreatedAt = user.CreatedAt;
      safeUser.UpdatedAt = user.UpdatedAt;
      safeUser.LineAccess = lineRows.filter(function (row) {
        return valuesEqual_(row.UserID, user.UserID) && isActive_(row.ActiveStatus);
      }).map(sanitizeForClient_);
      return safeUser;
    });
    return jsonResponse(true, 'Users loaded.', { users: users, count: users.length });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function createUser(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'users.create');
    requireFields_(payload, ['username', 'password', 'fullName', 'role']);
    if (cleanString_(payload.password).length < 8) throw new Error('Password must contain at least 8 characters.');
    validateUserRole_(payload.role);
    assertUniqueUsername_(payload.username, '');
    var timestamp = formatDateTimeBangkok(new Date());
    var userId = generateId('U', SHEET_NAMES.USERS, 'UserID', '');
    var user = {
      UserID: userId, EmployeeID: payload.employeeId || '', Username: cleanString_(payload.username),
      PasswordHash: hashPassword(payload.password), FullName: cleanString_(payload.fullName),
      Nickname: payload.nickname || '', Role: cleanString_(payload.role), Department: payload.department || '',
      LineDefault: payload.lineDefault || '', Email: payload.email || '', Phone: payload.phone || '',
      ActiveStatus: payload.activeStatus || 'Active', LastLogin: '',
      CreatedAt: timestamp, CreatedBy: currentUser.UserID, UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
    };
    appendObject(SHEET_NAMES.USERS, user);
    return jsonResponse(true, 'User created.', { user: publicUser_(user) });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function updateUser(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'users.update');
    requireFields_(payload, ['userId']);
    var existing = findById_(SHEET_NAMES.USERS, 'UserID', payload.userId);
    if (!existing) throw new Error('User not found: ' + payload.userId);
    if (payload.username !== undefined) assertUniqueUsername_(payload.username, payload.userId);
    if (payload.role !== undefined) validateUserRole_(payload.role);
    var aliases = {
      employeeId: 'EmployeeID', username: 'Username', fullName: 'FullName', nickname: 'Nickname',
      role: 'Role', department: 'Department', lineDefault: 'LineDefault', email: 'Email',
      phone: 'Phone', activeStatus: 'ActiveStatus'
    };
    var updates = {};
    Object.keys(aliases).forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) updates[aliases[key]] = payload[key];
    });
    if (!Object.keys(updates).length) throw new Error('No supported user fields were provided.');
    updates.UpdatedAt = formatDateTimeBangkok(new Date());
    updates.UpdatedBy = currentUser.UserID;
    var updated = updateObjectById(SHEET_NAMES.USERS, 'UserID', payload.userId, updates);
    return jsonResponse(true, 'User updated.', { user: publicUser_(updated) });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function deactivateUser(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'users.deactivate');
    requireFields_(payload, ['userId']);
    if (valuesEqual_(payload.userId, currentUser.UserID)) throw new Error('You cannot deactivate your own account.');
    var updated = updateObjectById(SHEET_NAMES.USERS, 'UserID', payload.userId, {
      ActiveStatus: 'Inactive', UpdatedAt: formatDateTimeBangkok(new Date()), UpdatedBy: currentUser.UserID
    });
    if (!updated) throw new Error('User not found: ' + payload.userId);
    return jsonResponse(true, 'User deactivated.', { user: publicUser_(updated) });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function resetUserPassword(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'users.resetPassword');
    requireFields_(payload, ['userId', 'password']);
    if (cleanString_(payload.password).length < 8) throw new Error('Password must contain at least 8 characters.');
    var updated = updateObjectById(SHEET_NAMES.USERS, 'UserID', payload.userId, {
      PasswordHash: hashPassword(payload.password), UpdatedAt: formatDateTimeBangkok(new Date()), UpdatedBy: currentUser.UserID
    });
    if (!updated) throw new Error('User not found: ' + payload.userId);
    return jsonResponse(true, 'Password reset successfully.', { UserID: payload.userId });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function listRolePermissions(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'users.managePermission');
    var rows = getRowsAsObjects(SHEET_NAMES.ROLE_PERMISSIONS).filter(function (row) {
      return isAllFilter_(payload.role) || valuesEqual_(row.Role, payload.role);
    }).map(sanitizeForClient_);
    return jsonResponse(true, 'Role permissions loaded.', { rolePermissions: rows });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function updateRolePermissions(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'users.managePermission');
    var entries = normalizeEntries_(payload, 'rolePermissions');
    entries.forEach(function (entry) {
      requireFields_(entry, ['role', 'permissionKey']);
      validateUserRole_(entry.role);
      upsertCompositeRow_(SHEET_NAMES.ROLE_PERMISSIONS, { Role: entry.role, PermissionKey: entry.permissionKey }, {
        Role: entry.role, PermissionKey: entry.permissionKey, Allowed: isAllowed_(entry.allowed) ? 'Yes' : 'No',
        Description: entry.description || '', UpdatedAt: formatDateTimeBangkok(new Date()), UpdatedBy: currentUser.UserID
      });
    });
    invalidateRolePermissionsCache_();
    return jsonResponse(true, 'Role permissions updated.', { updatedCount: entries.length });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function listUserPermissions(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'users.managePermission');
    requireFields_(payload, ['userId']);
    var rows = getRowsAsObjects(SHEET_NAMES.USER_PERMISSIONS).filter(function (row) {
      return valuesEqual_(row.UserID, payload.userId);
    }).map(sanitizeForClient_);
    return jsonResponse(true, 'User permissions loaded.', { userPermissions: rows });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function updateUserPermissions(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'users.managePermission');
    requireFields_(payload, ['userId']);
    if (!findById_(SHEET_NAMES.USERS, 'UserID', payload.userId)) throw new Error('User not found: ' + payload.userId);
    var entries = normalizeEntries_(payload, 'permissions');
    var timestamp = formatDateTimeBangkok(new Date());
    entries.forEach(function (entry) {
      requireFields_(entry, ['permissionKey']);
      upsertCompositeRow_(SHEET_NAMES.USER_PERMISSIONS, { UserID: payload.userId, PermissionKey: entry.permissionKey }, {
        UserID: payload.userId, PermissionKey: entry.permissionKey,
        Allowed: cleanString_(entry.allowed).toLowerCase() === 'inherit' ? 'Inherit' : (isAllowed_(entry.allowed) ? 'Yes' : 'No'),
        Reason: entry.reason || '', CreatedAt: timestamp, CreatedBy: currentUser.UserID,
        UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
      });
    });
    invalidateUserPermissionsCache_();
    return jsonResponse(true, 'User permissions updated.', { updatedCount: entries.length });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function listUserLineAccess(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'users.managePermission');
    requireFields_(payload, ['userId']);
    var rows = getRowsAsObjects(SHEET_NAMES.USER_LINE_ACCESS).filter(function (row) {
      return valuesEqual_(row.UserID, payload.userId);
    }).map(sanitizeForClient_);
    return jsonResponse(true, 'User line access loaded.', { lineAccess: rows });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function updateUserLineAccess(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'users.managePermission');
    requireFields_(payload, ['userId']);
    if (!findById_(SHEET_NAMES.USERS, 'UserID', payload.userId)) throw new Error('User not found: ' + payload.userId);
    var entries = normalizeEntries_(payload, 'lineAccess');
    var timestamp = formatDateTimeBangkok(new Date());
    entries.forEach(function (entry) {
      requireFields_(entry, ['lineId']);
      var line = valuesEqual_(entry.lineId, 'ALL') ? { LineName: 'ALL' } : findById_(SHEET_NAMES.LINES, 'LineID', entry.lineId);
      if (!line) throw new Error('Line not found: ' + entry.lineId);
      upsertCompositeRow_(SHEET_NAMES.USER_LINE_ACCESS, { UserID: payload.userId, LineID: entry.lineId }, {
        UserID: payload.userId, LineID: entry.lineId, LineName: entry.lineName || line.LineName || '',
        AccessLevel: entry.accessLevel || 'View', ActiveStatus: entry.activeStatus || 'Active',
        CreatedAt: timestamp, CreatedBy: currentUser.UserID, UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
      });
    });
    invalidateUserLineAccessCache_();
    return jsonResponse(true, 'User line access updated.', { updatedCount: entries.length });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function validateUserRole_(role) {
  if (VALID_ROLES.indexOf(cleanString_(role)) === -1) throw new Error('Invalid user role: ' + cleanString_(role));
}

function assertUniqueUsername_(username, excludedUserId) {
  var normalized = cleanString_(username).toLowerCase();
  if (!normalized) throw new Error('Username is required.');
  var duplicate = getRowsAsObjects(SHEET_NAMES.USERS).some(function (row) {
    return cleanString_(row.Username).toLowerCase() === normalized && !valuesEqual_(row.UserID, excludedUserId);
  });
  if (duplicate) throw new Error('Username already exists.');
}

function normalizeEntries_(payload, key) {
  var entries = payload[key] || payload.entries;
  if (!Array.isArray(entries) || !entries.length) throw new Error(key + ' must contain at least one entry.');
  return entries;
}

function upsertCompositeRow_(sheetName, keys, object) {
  var row = getRowsAsObjects(sheetName).filter(function (candidate) {
    return Object.keys(keys).every(function (key) { return valuesEqual_(candidate[key], keys[key]); });
  })[0];
  if (!row) return appendObject(sheetName, object);
  var sheet = getSheet(sheetName);
  var headers = getHeaders_(sheet);
  var values = sheet.getRange(row._rowNumber, 1, 1, headers.length).getValues()[0];
  headers.forEach(function (header, index) {
    if ((header === 'CreatedAt' || header === 'CreatedBy') && values[index]) return;
    if (Object.prototype.hasOwnProperty.call(object, header)) values[index] = object[header];
  });
  sheet.getRange(row._rowNumber, 1, 1, headers.length).setValues([values]);
  return object;
}
