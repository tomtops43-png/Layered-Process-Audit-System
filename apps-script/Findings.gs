/** Finding search, update, and closure APIs. */
var FINDINGS_RAW_CACHE_KEY = 'LPA_FINDINGS_RAW';
var FINDINGS_RAW_CACHE_TTL = 300;
var FINDINGS_DEFAULT_PAGE_SIZE = 300;
var FINDINGS_MAX_PAGE_SIZE = 1000;

// AuditID -> AuditLayer map, built once per execution. Looking this up per finding row
// via findById_ used to re-read the whole AUDIT_SESSIONS sheet for every row.
var FINDING_AUDIT_LAYER_MEMO_ = null;

function getAuditLayerForFinding_(auditId) {
  var id = cleanString_(auditId).toLowerCase();
  if (!id) return '';
  if (!FINDING_AUDIT_LAYER_MEMO_) {
    FINDING_AUDIT_LAYER_MEMO_ = {};
    safeRowsAsObjects_(SHEET_NAMES.AUDIT_SESSIONS).forEach(function (row) {
      var key = cleanString_(row.AuditID).toLowerCase();
      if (key) FINDING_AUDIT_LAYER_MEMO_[key] = cleanString_(row.AuditLayer);
    });
  }
  return FINDING_AUDIT_LAYER_MEMO_[id] || '';
}

function getCachedFindingRows_() {
  var cached = safeCacheGetJson_(FINDINGS_RAW_CACHE_KEY);
  if (cached) return cached;
  var rows = getRowsAsObjects(SHEET_NAMES.FINDINGS);
  safeCachePutJson_(FINDINGS_RAW_CACHE_KEY, rows, FINDINGS_RAW_CACHE_TTL);
  return rows;
}

function invalidateFindingsCache_() {
  safeCacheRemove_(FINDINGS_RAW_CACHE_KEY);
}

function getFindings(payload, currentUser) {
  try {
    payload = payload || {};
    var lineId = findingFilterValue_(payload.lineId);
    var stationId = findingFilterValue_(payload.stationId);
    var category = findingFilterValue_(payload.category);
    var status = findingFilterValue_(payload.status);
    var picName = findingFilterValue_(payload.picName || payload.pic);
    var picUserId = findingFilterValue_(payload.picUserId);
    var periodMonth = normalizeFindingPeriod_(payload.periodMonth);
    var myFindings = findingFilterValue_(payload.myFindings).toLowerCase();
    var overdueOnly = payload.overdueOnly === true ||
      ['true', 'yes', '1'].indexOf(cleanString_(payload.overdueOnly).toLowerCase()) !== -1;
    var rows = getCachedFindingRows_().map(refreshOverdueForRead_).filter(function (row) {
      var rowPeriodMonth = normalizeFindingPeriod_(row.PeriodMonth) || normalizeFindingPeriod_(row.FoundDate);
      return (!lineId || valuesEqual_(row.LineID, lineId)) &&
        (!stationId || valuesEqual_(row.StationID, stationId)) &&
        (!category || valuesEqual_(row.Category, category)) &&
        (!status || (status.toLowerCase() === 'overdue' ? valuesEqual_(row.OverdueFlag, 'Yes') : valuesEqual_(row.Status, status))) &&
        (!picName || csvContains_(row.AssignedToName || row.PICName, picName)) &&
        (!picUserId || csvContains_(row.AssignedToUserID || row.PICUserID, picUserId)) &&
        (!periodMonth || rowPeriodMonth === periodMonth) &&
        (!overdueOnly || valuesEqual_(row.OverdueFlag, 'Yes')) &&
        (!myFindings || matchesMyFindingFilter_(row, currentUser, myFindings));
    });
    rows = rows.filter(function (row) { return canViewFindingRbac_(currentUser, row); });
    rows.sort(function (a, b) { return cleanString_(a.DueDate).localeCompare(cleanString_(b.DueDate)); });
    // Paginate so the response stays small as the sheet grows (mobile clients
    // were timing out parsing multi-MB payloads). Clients pass offset to page.
    var total = rows.length;
    var offset = Math.max(Math.floor(toNumber_(payload.offset)) || 0, 0);
    var limit = Math.floor(toNumber_(payload.limit)) || FINDINGS_DEFAULT_PAGE_SIZE;
    limit = Math.min(Math.max(limit, 1), FINDINGS_MAX_PAGE_SIZE);
    var page = rows.slice(offset, offset + limit);
    return jsonResponse(true, 'Findings loaded.', {
      findings: page.map(sanitizeFindingForClient_),
      count: page.length, total: total, offset: offset, limit: limit,
      hasMore: offset + page.length < total
    });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function getMyFindingNotificationSummary(payload, currentUser) {
  try {
    payload = payload || {};
    var lastSeenAt = cleanString_(payload.lastSeenAt);
    var now = formatDateTimeBangkok(new Date());
    var visible = getCachedFindingRows_().map(refreshOverdueForRead_).filter(function (row) {
      return canViewFindingRbac_(currentUser, row);
    }).map(sanitizeFindingForClient_);
    var assignedOpen = visible.filter(function (row) {
      return isAssignedToUser_(row, currentUser) && ['closed', 'pending verification'].indexOf(cleanString_(row.Status).toLowerCase()) === -1;
    });
    var pendingVerification = visible.filter(function (row) { return canHandlePendingVerification_(currentUser, row); });
    var overdue = visible.filter(function (row) {
      return valuesEqual_(row.OverdueFlag, 'Yes') && ['closed'].indexOf(cleanString_(row.Status).toLowerCase()) === -1;
    });
    var actionableIds = {};
    assignedOpen.concat(pendingVerification).forEach(function (item) {
      actionableIds[cleanString_(item.FindingID).toLowerCase()] = true;
    });
    var actionable = visible.filter(function (row) {
      return actionableIds[cleanString_(row.FindingID).toLowerCase()] === true;
    });
    var latest = actionable.slice().sort(function (a, b) {
      return cleanString_(b.UpdatedAt || b.CreatedAt || b.FoundDate).localeCompare(cleanString_(a.UpdatedAt || a.CreatedAt || a.FoundDate));
    });
    var newCount = lastSeenAt ? latest.filter(function (row) {
      return cleanString_(row.UpdatedAt || row.CreatedAt || row.FoundDate) > lastSeenAt;
    }).length : 0;
    return jsonResponse(true, 'Finding notification summary loaded.', {
      serverTime: now,
      assignedOpenCount: assignedOpen.length,
      pendingVerificationCount: pendingVerification.length,
      overdueCount: overdue.length,
      newFindingCount: newCount,
      actionableCount: actionable.length,
      latestFindings: latest.slice(0, Math.min(Math.max(toNumber_(payload.limit) || 5, 1), 10)).map(function (row) {
        return {
          FindingID: row.FindingID, LineName: row.LineName || row.LineID, StationName: row.StationName || row.StationID,
          AuditLayer: row.AuditorRole || row.AuditLayer || '', Status: row.Status || '', AssignedRole: row.AssignedRole || row.AssignedRoleName || '',
          AssignedUserName: row.AssignedUserName || row.AssignedToName || '', Detail: cleanString_(row.ProblemDetail).slice(0, 140),
          DueDate: row.DueDate || '', CreatedAt: row.CreatedAt || row.FoundDate || '', UpdatedAt: row.UpdatedAt || row.CreatedAt || row.FoundDate || '',
          AssignmentMode: row.AssignmentMode || '', AssignmentDisplay: row.AssignmentDisplay || ''
        };
      })
    });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function findingFilterValue_(value) {
  var normalized = cleanString_(value);
  return ['', 'all', 'ทั้งหมด', 'null', 'undefined'].indexOf(normalized.toLowerCase()) !== -1 ? '' : normalized;
}

function normalizeFindingPeriod_(value) {
  var digits = cleanString_(value).replace(/\D/g, '');
  return digits.length >= 6 ? digits.slice(0, 6) : '';
}

function updateFinding(payload, currentUser) {
  try {
    requireFields_(payload, ['findingId']);
    var finding = findById_(SHEET_NAMES.FINDINGS, 'FindingID', payload.findingId);
    if (!finding) throw new Error('Finding not found: ' + payload.findingId);
    if (!canUpdateFinding_(currentUser, finding)) return jsonResponse(false, 'You can update only findings assigned to you.', {});
    if (valuesEqual_(finding.Status, 'Closed') || valuesEqual_(finding.Status, 'Pending Verification')) {
      throw new Error('This finding cannot be edited in its current status.');
    }

    var allowed = ['CorrectiveAction', 'RootCause', 'RootCauseCategory', 'ActionRemark', 'DueDate', 'Status', 'AfterPhotoURL', 'BeforePhotoURL'];
    var aliases = {
      correctiveAction: 'CorrectiveAction', rootCause: 'RootCause', rootCauseCategory: 'RootCauseCategory', dueDate: 'DueDate', status: 'Status',
      actionRemark: 'ActionRemark', afterPhotoUrl: 'AfterPhotoURL', beforePhotoUrl: 'BeforePhotoURL'
    };
    var updates = {};
    allowed.forEach(function (field) { if (Object.prototype.hasOwnProperty.call(payload, field)) updates[field] = payload[field]; });
    Object.keys(aliases).forEach(function (key) { if (Object.prototype.hasOwnProperty.call(payload, key)) updates[aliases[key]] = payload[key]; });

    var isReassign = Object.prototype.hasOwnProperty.call(payload, 'assignedToUserId') || Object.prototype.hasOwnProperty.call(payload, 'reassignRole');
    if (Object.prototype.hasOwnProperty.call(payload, 'assignedToUserId')) {
      requirePermission_(currentUser, 'findings.assign');
      var assignedUserIds = csvList_(payload.assignedToUserId);
      var assignees = assignedUserIds.map(function (id) {
        var u = findById_(SHEET_NAMES.USERS, 'UserID', id);
        if (!u || !isActive_(u.ActiveStatus)) throw new Error('Assigned user was not found or is inactive: ' + id);
        return u;
      });
      var assignedUserIdCsv = assignedUserIds.join(',');
      var assignedNameCsv = assignees.map(function (u) { return u.FullName; }).join(',');
      var assignedRoleCsv = Array.from(new Set(assignees.map(function (u) { return u.Role; }))).join(',');
      updates.AssignmentMode = assignedUserIds.length ? 'USER' : 'ROLE';
      updates.AssignedUserID = assignedUserIdCsv;
      updates.AssignedUserName = assignedNameCsv;
      updates.AssignedToUserID = assignedUserIdCsv;
      updates.AssignedToName = assignedNameCsv;
      updates.AssignedToRole = assignedRoleCsv;
      updates.AssignedRole = assignedRoleCsv;
      updates.AssignedRoleName = assignedRoleCsv;
      updates.PICUserID = assignedUserIdCsv;
      updates.PICName = assignedNameCsv;
      updates.ResponsiblePerson = assignedNameCsv;
    } else if (Object.prototype.hasOwnProperty.call(payload, 'reassignRole')) {
      requirePermission_(currentUser, 'findings.assign');
      var newRoles = csvList_(payload.reassignRole);
      if (!newRoles.length) throw new Error('reassignRole cannot be empty.');
      var roleCsv = newRoles.join(',');
      updates.AssignmentMode = 'ROLE';
      updates.AssignedRole = roleCsv;
      updates.AssignedRoleName = roleCsv;
      updates.AssignedToRole = roleCsv;
      updates.AssignedToName = roleCsv;
      updates.AssignedUserID = '';
      updates.AssignedUserName = '';
      updates.AssignedToUserID = '';
      updates.PICUserID = '';
      updates.PICName = roleCsv;
      updates.ResponsiblePerson = roleCsv;
    }
    if (!Object.keys(updates).length) throw new Error('No supported finding fields were provided to update.');
    if (updates.DueDate) updates.DueDate = formatDateBangkok_(updates.DueDate);

    var oldStatus = cleanString_(finding.Status) || 'Open';
    var newStatus = oldStatus;
    if (updates.Status !== undefined && !valuesEqual_(updates.Status, oldStatus)) {
      var requestedStatus = cleanString_(updates.Status);
      if (!valuesEqual_(requestedStatus, 'In Progress') ||
          (!valuesEqual_(oldStatus, 'Assigned') && !valuesEqual_(oldStatus, 'Rejected'))) {
        throw new Error('Invalid status transition. Use Submit for Verification, Close Finding, or Reject Finding.');
      }
      newStatus = 'In Progress';
      updates.Status = newStatus;
    } else {
      delete updates.Status;
    }
    if (isReassign && (valuesEqual_(oldStatus, 'Open') || valuesEqual_(oldStatus, 'Assigned'))) {
      newStatus = 'Assigned';
      updates.Status = newStatus;
    }
    var overdue = calculateOverdue(updates.DueDate || finding.DueDate, newStatus);
    var timestamp = formatDateTimeBangkok(new Date());
    updates.OverdueFlag = overdue.OverdueFlag;
    updates.DaysOverdue = overdue.DaysOverdue;
    updates.ActionBy = currentUser.UserID;
    updates.ActionByName = currentUser.FullName;
    updates.UpdatedAt = timestamp;
    updates.UpdatedBy = currentUser.UserID;
    var updated = updateObjectById(SHEET_NAMES.FINDINGS, 'FindingID', payload.findingId, updates);
    appendActionLog_(payload.findingId, oldStatus, newStatus, updates, payload.remark || '', payload.evidenceUrl || '', currentUser, timestamp);
    invalidateFindingsCache_();
    return jsonResponse(true, 'Finding updated successfully.', { finding: sanitizeFindingForClient_(updated) });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function submitFinding(payload, currentUser) {
  try {
    requireFields_(payload, ['findingId']);
    var finding = findById_(SHEET_NAMES.FINDINGS, 'FindingID', payload.findingId);
    if (!finding) throw new Error('Finding not found: ' + payload.findingId);
    if (!canSubmitFinding_(currentUser, finding)) {
      return jsonResponse(false, 'Only the assigned user or an authorized finding manager can submit this finding.', {});
    }
    if (valuesEqual_(finding.Status, 'Closed') || valuesEqual_(finding.Status, 'Pending Verification')) {
      throw new Error('Finding cannot be submitted from its current status.');
    }
    var oldStatus = finding.Status;
    var correctiveAction = cleanString_(payload.correctiveAction || payload.CorrectiveAction || finding.CorrectiveAction);
    var rootCause = cleanString_(payload.rootCause || payload.RootCause || finding.RootCause);
    var afterPhoto = cleanString_(payload.afterPhotoUrl || payload.AfterPhotoURL || finding.AfterPhotoURL);
    if (!rootCause) throw new Error('RootCause is required before submission.');
    if (!correctiveAction) throw new Error('CorrectiveAction is required before submission.');
    if (!afterPhoto) throw new Error('AfterPhotoURL is required before submission.');
    var rootCauseCategory = cleanString_(payload.rootCauseCategory || payload.RootCauseCategory || finding.RootCauseCategory) || mapCategoryTo5m1e_(finding.Category);
    // BeforePhotoURL is optional here — audits sometimes get submitted without one,
    // and the assignee can attach it retroactively; falls back to whatever was there.
    var beforePhoto = cleanString_(payload.beforePhotoUrl || payload.BeforePhotoURL || finding.BeforePhotoURL);
    var timestamp = formatDateTimeBangkok(new Date());
    var updates = {
      CorrectiveAction: correctiveAction, RootCause: rootCause, RootCauseCategory: rootCauseCategory, AfterPhotoURL: afterPhoto,
      BeforePhotoURL: beforePhoto,
      Status: 'Pending Verification', VerificationStatus: 'Pending',
      SubmittedAt: timestamp, SubmittedBy: currentUser.UserID, SubmittedByName: currentUser.FullName,
      ActionBy: currentUser.UserID, ActionByName: currentUser.FullName,
      RejectedAt: '', RejectedBy: '', RejectReason: '',
      UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
    };
    var actionRemark = cleanString_(payload.actionRemark || payload.ActionRemark || finding.ActionRemark);
    updates.ActionRemark = actionRemark;
    var updated = updateObjectById(SHEET_NAMES.FINDINGS, 'FindingID', payload.findingId, updates);
    appendActionLog_(payload.findingId, oldStatus, updates.Status, updates, payload.remark || 'Submitted for verification', payload.evidenceUrl || afterPhoto, currentUser, timestamp);
    invalidateFindingsCache_();
    return jsonResponse(true, 'Finding submitted for verification.', { finding: sanitizeFindingForClient_(updated) });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function verifyFinding(payload, currentUser) {
  try {
    requireFields_(payload, ['findingId', 'decision']);
    var finding = findById_(SHEET_NAMES.FINDINGS, 'FindingID', payload.findingId);
    if (!finding) throw new Error('Finding not found: ' + payload.findingId);
    if (!valuesEqual_(finding.Status, 'Pending Verification')) throw new Error('Finding is not pending verification.');
    var oldStatus = finding.Status;
    var decision = cleanString_(payload.decision).toLowerCase();
    if (['approve', 'approved', 'reject', 'rejected'].indexOf(decision) === -1) throw new Error('Decision must be Approve or Reject.');
    if (!canVerifyFinding_(currentUser, finding)) return jsonResponse(false, 'You do not have permission to verify this finding.', {});
    if ((decision === 'approve' || decision === 'approved') && !canCloseFinding_(currentUser, finding)) {
      return jsonResponse(false, 'You do not have permission to close this finding severity.', {});
    }
    var timestamp = formatDateTimeBangkok(new Date());
    var updates = {
      VerifierUserID: currentUser.UserID, VerifierName: currentUser.FullName, VerifierRole: currentUser.Role,
      ActionBy: currentUser.UserID, ActionByName: currentUser.FullName,
      UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
    };
    if (decision === 'reject' || decision === 'rejected') {
      var rejectReason = cleanString_(payload.rejectReason || payload.RejectReason || payload.closeRemark || payload.CloseRemark);
      if (!rejectReason) throw new Error('RejectReason is required.');
      updates.Status = 'Rejected';
      updates.VerificationStatus = 'Rejected';
      updates.RejectedAt = timestamp;
      updates.RejectedBy = currentUser.UserID;
      updates.RejectedByName = currentUser.FullName;
      updates.RejectReason = rejectReason;
    } else {
      var closeRemark = cleanString_(payload.closeRemark || payload.CloseRemark);
      if (!closeRemark) throw new Error('CloseRemark is required to close a finding.');
      updates.Status = 'Closed';
      updates.VerificationStatus = 'Approved';
      updates.ClosedDate = timestamp;
      updates.ClosedAt = timestamp;
      updates.ClosedBy = currentUser.UserID;
      updates.ClosedByName = currentUser.FullName;
      updates.CloseRemark = closeRemark;
      updates.OverdueFlag = 'No';
      updates.DaysOverdue = 0;
    }
    var updated = updateObjectById(SHEET_NAMES.FINDINGS, 'FindingID', payload.findingId, updates);
    appendActionLog_(payload.findingId, oldStatus, updates.Status, updates, payload.remark || updates.RejectReason || updates.CloseRemark || '', payload.evidenceUrl || '', currentUser, timestamp);
    invalidateFindingsCache_();
    invalidateDashboardCachesForUser_(currentUser);
    return jsonResponse(true, updates.Status === 'Closed' ? 'Finding approved and closed.' : 'Finding rejected.', { finding: sanitizeFindingForClient_(updated) });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function closeFinding(payload, currentUser) {
  try {
    requireFields_(payload, ['findingId']);
    var finding = findById_(SHEET_NAMES.FINDINGS, 'FindingID', payload.findingId);
    if (!finding) throw new Error('Finding not found: ' + payload.findingId);
    if (!canCloseFinding_(currentUser, finding)) return jsonResponse(false, 'Your role cannot close this finding.', {});
    var directMinorClosure = canDirectlyCloseMinorFinding_(currentUser, finding);
    if (!valuesEqual_(finding.Status, 'Pending Verification') && !directMinorClosure) {
      throw new Error('Finding must be Pending Verification before it can be closed.');
    }
    var afterPhoto = payload.afterPhotoUrl || payload.AfterPhotoURL || finding.AfterPhotoURL;
    var closeRemark = cleanString_(payload.closeRemark || payload.CloseRemark);
    if (!closeRemark) throw new Error('CloseRemark is required to close a finding.');

    var timestamp = formatDateTimeBangkok(new Date());
    var updates = {
      Status: 'Closed', AfterPhotoURL: afterPhoto || '', CloseRemark: closeRemark || '',
      ClosedDate: timestamp, ClosedAt: timestamp, ClosedBy: currentUser.UserID, ClosedByName: currentUser.FullName,
      VerifierUserID: currentUser.UserID, VerifierName: currentUser.FullName, VerifierRole: currentUser.Role,
      VerificationStatus: 'Approved', OverdueFlag: 'No', DaysOverdue: 0,
      ActionBy: currentUser.UserID, ActionByName: currentUser.FullName,
      UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
    };
    var updated = updateObjectById(SHEET_NAMES.FINDINGS, 'FindingID', payload.findingId, updates);
    appendActionLog_(payload.findingId, finding.Status, 'Closed', updates, payload.remark || closeRemark || '', payload.evidenceUrl || '', currentUser, timestamp);
    invalidateFindingsCache_();
    invalidateDashboardCachesForUser_(currentUser);
    return jsonResponse(true, 'Finding closed successfully.', { finding: sanitizeFindingForClient_(updated) });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function matchesMyFindingFilter_(finding, currentUser, filter) {
  if (['assigned', 'assigned-to-me', 'mine'].indexOf(filter) !== -1) return isAssignedToUser_(finding, currentUser);
  if (['created', 'created-by-me'].indexOf(filter) !== -1) {
    return isCreatedByUser_(finding, currentUser);
  }
  if (['verification', 'pending-verification', 'verify'].indexOf(filter) !== -1) {
    return canHandlePendingVerification_(currentUser, finding);
  }
  return true;
}

function isAssignedToUser_(finding, currentUser) {
  var mode = normalizeFindingAssignmentMode_(finding.AssignmentMode, finding);
  if (mode === 'ROLE') {
    var assignedRole = cleanString_(finding.AssignedRole || finding.AssignedRoleName || finding.AssignedToRole || finding.AssignedToName || finding.ResponsiblePerson || finding.PICName);
    return assignedRole && (csvContains_(assignedRole, currentUser.Role) || csvContains_(assignedRole, currentUser.FullName)) && canAccessLine_(currentUser, finding.LineID, 'View');
  }

  var assignedUserId = cleanString_(finding.AssignedUserID || finding.AssignedToUserID || finding.ResponsibleUserID || finding.PICUserID);
  if (assignedUserId) return csvContains_(assignedUserId, currentUser.UserID);

  return csvContains_(finding.AssignedUserName || finding.AssignedToName || finding.PICName, currentUser.FullName);
}

function isCreatedByUser_(finding, currentUser) {
  return valuesEqual_(finding.AuditorUserID, currentUser.UserID) ||
    valuesEqual_(finding.CreatedBy, currentUser.UserID);
}

function canUpdateFinding_(currentUser, finding) {
  if (isAdmin_(currentUser)) return true;
  if (hasPermission_(currentUser, 'findings.view.all')) return true;
  if (isAssignedToUser_(finding, currentUser) && hasPermission_(currentUser, 'findings.update.assigned')) return true;
  return hasPermission_(currentUser, 'findings.update.line') && canAccessLine_(currentUser, finding.LineID, 'Update');
}

function canSubmitFinding_(currentUser, finding) {
  if (isAdmin_(currentUser) || hasPermission_(currentUser, 'findings.view.all')) return true;
  if (isAssignedToUser_(finding, currentUser) && hasPermission_(currentUser, 'findings.update.assigned')) return true;
  return hasPermission_(currentUser, 'findings.update.line') && canAccessLine_(currentUser, finding.LineID, 'Update');
}

function canVerifyFinding_(currentUser, finding) {
  if (!hasPermission_(currentUser, 'findings.verify')) return false;
  return isAdmin_(currentUser) || hasPermission_(currentUser, 'findings.view.all') ||
    canAccessLine_(currentUser, finding.LineID, 'View');
}

function canHandlePendingVerification_(currentUser, finding) {
  if (!valuesEqual_(finding.Status, 'Pending Verification') ||
      !hasPermission_(currentUser, 'findings.verify')) return false;
  var verifierUserId = cleanString_(finding.VerifierUserID);
  if (verifierUserId) {
    return valuesEqual_(verifierUserId, currentUser.UserID) || isAdmin_(currentUser) ||
      cleanString_(currentUser.Role).toLowerCase() === 'manager';
  }
  return canVerifyFinding_(currentUser, finding) && canCloseFinding_(currentUser, finding);
}

function canCloseFinding_(currentUser, finding) {
  var severity = cleanString_(finding.Severity || finding.Priority).toLowerCase();
  var permissionKey = severity === 'critical' ? 'findings.close.critical' :
    (severity === 'major' ? 'findings.close.major' : 'findings.close.minor');
  if (!hasPermission_(currentUser, permissionKey)) return false;
  return canVerifyFinding_(currentUser, finding) || canDirectlyCloseMinorFinding_(currentUser, finding);
}

function canDirectlyCloseMinorFinding_(currentUser, finding) {
  if (normalizeFindingAssignmentMode_(finding.AssignmentMode, finding) === 'ROLE') return false;
  var severity = cleanString_(finding.Severity || finding.Priority).toLowerCase();
  if (severity !== 'minor' || !hasPermission_(currentUser, 'findings.close.minor') ||
      !isAssignedToUser_(finding, currentUser)) return false;
  var layer = getAuditLayerForFinding_(finding.AuditID).toLowerCase();
  var verificationRequired = cleanString_(finding.VerificationRequired).toLowerCase();
  return verificationRequired === 'no' || (!verificationRequired && (!layer || layer === 'leader'));
}

function canViewFindingRbac_(currentUser, finding) {
  if (isAdmin_(currentUser) || hasPermission_(currentUser, 'findings.view.all')) return true;
  if (canHandlePendingVerification_(currentUser, finding)) return true;
  if (cleanString_(finding.LineID) && !canAccessLine_(currentUser, finding.LineID, 'View')) return false;
  if (hasPermission_(currentUser, 'findings.view.line') && cleanString_(finding.LineID) &&
      canAccessLine_(currentUser, finding.LineID, 'View')) return true;
  if (hasPermission_(currentUser, 'findings.view.assigned') && isAssignedToUser_(finding, currentUser) && (!cleanString_(finding.LineID) || canAccessLine_(currentUser, finding.LineID, 'View'))) return true;
  return hasPermission_(currentUser, 'findings.view.created') && isCreatedByUser_(finding, currentUser);
}

function normalizeFindingAssignmentMode_(mode, source) {
  var normalized = cleanString_(mode).toUpperCase();
  if (normalized === 'ROLE' || normalized === 'USER') return normalized;
  source = source || {};
  if (cleanString_(source.AssignedUserID || source.AssignedToUserID || source.ResponsibleUserID || source.PICUserID || source.assignedUserId || source.assignedToUserId || source.picUserId)) return 'USER';
  return 'ROLE';
}

function getAssignableFindingRoles_() {
  var fallback = ['Leader', 'Supervisor', 'Engineer', 'Manager', 'Admin'];
  var excludedRoles = { viewer: true, customer: true };
  var seen = {};
  getRowsAsObjects(SHEET_NAMES.USERS).forEach(function (user) {
    var role = cleanString_(user.Role);
    if (role && isActive_(user.ActiveStatus) && !excludedRoles[role.toLowerCase()]) seen[role.toLowerCase()] = role;
  });
  fallback.forEach(function (role) { if (!seen[role.toLowerCase()]) seen[role.toLowerCase()] = role; });
  var order = { leader: 1, supervisor: 2, engineer: 3, manager: 4, admin: 5 };
  return Object.keys(seen).map(function (key) { return seen[key]; }).sort(function (a, b) {
    return (order[a.toLowerCase()] || 99) - (order[b.toLowerCase()] || 99) || a.localeCompare(b);
  });
}

function validateAssignableFindingRole_(role) {
  var selected = cleanString_(role);
  var match = getAssignableFindingRoles_().filter(function (entry) { return valuesEqual_(entry, selected); })[0];
  if (!match) throw new Error('AssignedRole is not valid or has no active users: ' + selected);
  return match;
}

function sanitizeFindingForClient_(row) {
  var copy = sanitizeForClient_(row);
  copy.AssignmentMode = normalizeFindingAssignmentMode_(copy.AssignmentMode, copy);
  if (copy.AssignmentMode === 'ROLE') {
    copy.AssignedRole = cleanString_(copy.AssignedRole || copy.AssignedRoleName || copy.AssignedToRole || copy.AssignedToName || copy.ResponsiblePerson || copy.PICName);
    copy.AssignedRoleName = copy.AssignedRole;
    copy.AssignedUserID = '';
    copy.AssignedUserName = '';
    copy.AssignedToUserID = cleanString_(copy.AssignedToUserID); // keep legacy if present for display compatibility
  } else {
    copy.AssignedUserID = cleanString_(copy.AssignedUserID || copy.AssignedToUserID || copy.ResponsibleUserID || copy.PICUserID);
    copy.AssignedUserName = cleanString_(copy.AssignedUserName || copy.AssignedToName || copy.PICName);
  }
  copy.AssignmentDisplay = copy.AssignmentMode === 'ROLE'
    ? (copy.AssignedRoleName || copy.ResponsiblePerson || '-')
    : (copy.AssignedUserName || copy.ResponsiblePerson || '-');
  return copy;
}

function appendActionLog_(findingId, oldStatus, newStatus, changes, remark, evidenceUrl, currentUser, timestamp) {
  var periodMonth = getPeriodMonth(new Date());
  appendObject(SHEET_NAMES.ACTION_LOGS, {
    LogID: generateId('LOG', SHEET_NAMES.ACTION_LOGS, 'LogID', periodMonth), FindingID: findingId,
    ActionDate: timestamp, ActionByUserID: currentUser.UserID, ActionByName: currentUser.FullName,
    OldStatus: oldStatus || '', NewStatus: newStatus || '', ActionDetail: JSON.stringify(changes || {}),
    EvidenceURL: evidenceUrl || '', Remark: remark || '', CreatedAt: timestamp
  });
}

function refreshOverdueForRead_(finding) {
  var overdue = calculateOverdue(finding.DueDate, finding.Status);
  finding.OverdueFlag = overdue.OverdueFlag;
  finding.DaysOverdue = overdue.DaysOverdue;
  return finding;
}
