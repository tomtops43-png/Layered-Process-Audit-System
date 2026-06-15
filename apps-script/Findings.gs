/** Finding search, update, and closure APIs. */
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
    var rows = getRowsAsObjects(SHEET_NAMES.FINDINGS).map(refreshOverdueForRead_).filter(function (row) {
      var rowPeriodMonth = normalizeFindingPeriod_(row.PeriodMonth) || normalizeFindingPeriod_(row.FoundDate);
      return (!lineId || valuesEqual_(row.LineID, lineId)) &&
        (!stationId || valuesEqual_(row.StationID, stationId)) &&
        (!category || valuesEqual_(row.Category, category)) &&
        (!status || (status.toLowerCase() === 'overdue' ? valuesEqual_(row.OverdueFlag, 'Yes') : valuesEqual_(row.Status, status))) &&
        (!picName || valuesEqual_(row.AssignedToName || row.PICName, picName)) &&
        (!picUserId || valuesEqual_(row.AssignedToUserID || row.PICUserID, picUserId)) &&
        (!periodMonth || rowPeriodMonth === periodMonth) &&
        (!overdueOnly || valuesEqual_(row.OverdueFlag, 'Yes')) &&
        (!myFindings || matchesMyFindingFilter_(row, currentUser, myFindings));
    });
    rows = rows.filter(function (row) { return canViewFindingRbac_(currentUser, row); });
    rows.sort(function (a, b) { return cleanString_(a.DueDate).localeCompare(cleanString_(b.DueDate)); });
    return jsonResponse(true, 'Findings loaded.', { findings: rows.map(sanitizeForClient_), count: rows.length });
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

    var allowed = ['CorrectiveAction', 'RootCause', 'PICName', 'PICUserID', 'AssignedToUserID', 'AssignedToName', 'AssignedToRole', 'DueDate', 'Status', 'Priority', 'Severity', 'AfterPhotoURL', 'CloseRemark'];
    var aliases = {
      correctiveAction: 'CorrectiveAction', rootCause: 'RootCause', picName: 'PICName', picUserId: 'PICUserID',
      assignedToUserId: 'AssignedToUserID', assignedToName: 'AssignedToName', assignedToRole: 'AssignedToRole',
      dueDate: 'DueDate', status: 'Status', priority: 'Priority', severity: 'Severity',
      afterPhotoUrl: 'AfterPhotoURL', closeRemark: 'CloseRemark'
    };
    var updates = {};
    allowed.forEach(function (field) { if (Object.prototype.hasOwnProperty.call(payload, field)) updates[field] = payload[field]; });
    Object.keys(aliases).forEach(function (key) { if (Object.prototype.hasOwnProperty.call(payload, key)) updates[aliases[key]] = payload[key]; });
    if (!Object.keys(updates).length) throw new Error('No supported finding fields were provided to update.');
    if (updates.AssignedToUserID && !valuesEqual_(updates.AssignedToUserID, finding.AssignedToUserID || finding.PICUserID)) {
      requirePermission_(currentUser, 'findings.assign');
      var assignee = findById_(SHEET_NAMES.USERS, 'UserID', updates.AssignedToUserID);
      if (!assignee || !isActive_(assignee.ActiveStatus)) throw new Error('Assigned user was not found or is inactive.');
      updates.AssignedToName = assignee.FullName;
      updates.AssignedToRole = assignee.Role;
      updates.PICUserID = assignee.UserID;
      updates.PICName = assignee.FullName;
      if (!updates.Status || valuesEqual_(updates.Status, 'Open')) updates.Status = 'Assigned';
    }
    if (updates.DueDate) updates.DueDate = formatDateBangkok_(updates.DueDate);

    var oldStatus = finding.Status;
    var newStatus = updates.Status !== undefined ? updates.Status : oldStatus;
    if (valuesEqual_(newStatus, 'Pending Verification')) throw new Error('Use submitFinding to submit for verification.');
    if (isClosedStatus_(newStatus) && !isClosedStatus_(oldStatus)) {
      throw new Error('Use closeFinding to close a finding. AfterPhotoURL or CloseRemark must be verified.');
    }
    var overdue = calculateOverdue(updates.DueDate || finding.DueDate, newStatus);
    var timestamp = formatDateTimeBangkok(new Date());
    updates.OverdueFlag = overdue.OverdueFlag;
    updates.DaysOverdue = overdue.DaysOverdue;
    updates.UpdatedAt = timestamp;
    updates.UpdatedBy = currentUser.UserID;
    var updated = updateObjectById(SHEET_NAMES.FINDINGS, 'FindingID', payload.findingId, updates);
    appendActionLog_(payload.findingId, oldStatus, newStatus, updates, payload.remark || '', payload.evidenceUrl || '', currentUser, timestamp);
    return jsonResponse(true, 'Finding updated successfully.', { finding: sanitizeForClient_(updated) });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function submitFinding(payload, currentUser) {
  try {
    requireFields_(payload, ['findingId']);
    var finding = findById_(SHEET_NAMES.FINDINGS, 'FindingID', payload.findingId);
    if (!finding) throw new Error('Finding not found: ' + payload.findingId);
    if (!isAssignedToUser_(finding, currentUser) && ['Admin', 'Manager'].indexOf(currentUser.Role) === -1) {
      return jsonResponse(false, 'Only the assigned user can submit this finding.', {});
    }
    var correctiveAction = cleanString_(payload.correctiveAction || payload.CorrectiveAction || finding.CorrectiveAction);
    var rootCause = cleanString_(payload.rootCause || payload.RootCause || finding.RootCause);
    var afterPhoto = cleanString_(payload.afterPhotoUrl || payload.AfterPhotoURL || finding.AfterPhotoURL);
    if (!correctiveAction) throw new Error('CorrectiveAction is required before submission.');
    if (!afterPhoto) throw new Error('AfterPhotoURL is required before submission.');
    var timestamp = formatDateTimeBangkok(new Date());
    var updates = {
      CorrectiveAction: correctiveAction, RootCause: rootCause, AfterPhotoURL: afterPhoto,
      Status: 'Pending Verification', VerificationStatus: 'Pending',
      SubmittedAt: timestamp, SubmittedBy: currentUser.UserID,
      RejectedAt: '', RejectedBy: '', RejectReason: '',
      UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
    };
    var updated = updateObjectById(SHEET_NAMES.FINDINGS, 'FindingID', payload.findingId, updates);
    appendActionLog_(payload.findingId, finding.Status, updates.Status, updates, payload.remark || 'Submitted for verification', payload.evidenceUrl || afterPhoto, currentUser, timestamp);
    return jsonResponse(true, 'Finding submitted for verification.', { finding: sanitizeForClient_(updated) });
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
    var decision = cleanString_(payload.decision).toLowerCase();
    if (['approve', 'approved', 'reject', 'rejected'].indexOf(decision) === -1) throw new Error('Decision must be Approve or Reject.');
    if (!canVerifyFinding_(currentUser, finding)) return jsonResponse(false, 'You do not have permission to verify this finding.', {});
    if ((decision === 'approve' || decision === 'approved') && !canCloseFinding_(currentUser, finding)) {
      return jsonResponse(false, 'You do not have permission to close this finding severity.', {});
    }
    var timestamp = formatDateTimeBangkok(new Date());
    var updates = {
      VerifierUserID: currentUser.UserID, VerifierName: currentUser.FullName, VerifierRole: currentUser.Role,
      UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
    };
    if (decision === 'reject' || decision === 'rejected') {
      var rejectReason = cleanString_(payload.rejectReason || payload.RejectReason);
      if (!rejectReason) throw new Error('RejectReason is required.');
      updates.Status = 'Rejected';
      updates.VerificationStatus = 'Rejected';
      updates.RejectedAt = timestamp;
      updates.RejectedBy = currentUser.UserID;
      updates.RejectReason = rejectReason;
    } else {
      updates.Status = 'Closed';
      updates.VerificationStatus = 'Approved';
      updates.ClosedDate = timestamp;
      updates.ClosedAt = timestamp;
      updates.ClosedBy = currentUser.UserID;
      updates.CloseRemark = cleanString_(payload.closeRemark || payload.CloseRemark || finding.CloseRemark);
      updates.OverdueFlag = 'No';
      updates.DaysOverdue = 0;
    }
    var updated = updateObjectById(SHEET_NAMES.FINDINGS, 'FindingID', payload.findingId, updates);
    appendActionLog_(payload.findingId, finding.Status, updates.Status, updates, payload.remark || updates.RejectReason || updates.CloseRemark || '', payload.evidenceUrl || '', currentUser, timestamp);
    return jsonResponse(true, updates.Status === 'Closed' ? 'Finding approved and closed.' : 'Finding rejected.', { finding: sanitizeForClient_(updated) });
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
    var afterPhoto = payload.afterPhotoUrl || payload.AfterPhotoURL || finding.AfterPhotoURL;
    var closeRemark = payload.closeRemark || payload.CloseRemark || finding.CloseRemark;
    if (!afterPhoto && !closeRemark) throw new Error('AfterPhotoURL or CloseRemark is required to close a finding.');

    var timestamp = formatDateTimeBangkok(new Date());
    var updates = {
      Status: 'Closed', AfterPhotoURL: afterPhoto || '', CloseRemark: closeRemark || '',
      ClosedDate: timestamp, ClosedAt: timestamp, ClosedBy: currentUser.UserID,
      VerifierUserID: currentUser.UserID, VerifierName: currentUser.FullName, VerifierRole: currentUser.Role,
      VerificationStatus: 'Approved', OverdueFlag: 'No', DaysOverdue: 0,
      UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
    };
    var updated = updateObjectById(SHEET_NAMES.FINDINGS, 'FindingID', payload.findingId, updates);
    appendActionLog_(payload.findingId, finding.Status, 'Closed', updates, payload.remark || closeRemark || '', payload.evidenceUrl || '', currentUser, timestamp);
    return jsonResponse(true, 'Finding closed successfully.', { finding: sanitizeForClient_(updated) });
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
    return valuesEqual_(finding.Status, 'Pending Verification') &&
      valuesEqual_(finding.VerifierUserID, currentUser.UserID);
  }
  return true;
}

function isAssignedToUser_(finding, currentUser) {
  var assignedUserId = cleanString_(finding.AssignedToUserID);
  if (assignedUserId) return valuesEqual_(assignedUserId, currentUser.UserID);

  var legacyPicUserId = cleanString_(finding.PICUserID);
  if (legacyPicUserId) return valuesEqual_(legacyPicUserId, currentUser.UserID);

  return valuesEqual_(finding.AssignedToName || finding.PICName, currentUser.FullName);
}

function isCreatedByUser_(finding, currentUser) {
  return valuesEqual_(finding.AuditorUserID, currentUser.UserID) ||
    valuesEqual_(finding.CreatedBy, currentUser.UserID);
}

function canUpdateFinding_(currentUser, finding) {
  if (isAdmin_(currentUser)) return true;
  if (isAssignedToUser_(finding, currentUser) && hasPermission_(currentUser, 'findings.update.assigned')) return true;
  return hasPermission_(currentUser, 'findings.update.line') && canAccessLine_(currentUser, finding.LineID, 'Update');
}

function canVerifyFinding_(currentUser, finding) {
  if (!hasPermission_(currentUser, 'findings.verify')) return false;
  return isAdmin_(currentUser) || hasPermission_(currentUser, 'findings.view.all') ||
    canAccessLine_(currentUser, finding.LineID, 'Update');
}

function canCloseFinding_(currentUser, finding) {
  var severity = cleanString_(finding.Severity || finding.Priority).toLowerCase();
  var permissionKey = severity === 'critical' ? 'findings.close.critical' :
    (severity === 'major' ? 'findings.close.major' : 'findings.close.minor');
  if (!hasPermission_(currentUser, permissionKey)) return false;
  var audit = findById_(SHEET_NAMES.AUDIT_SESSIONS, 'AuditID', finding.AuditID) || {};
  var layer = cleanString_(audit.AuditLayer).toLowerCase();
  var verificationRequired = cleanString_(finding.VerificationRequired).toLowerCase();
  var directMinorClosure = severity === 'minor' && isAssignedToUser_(finding, currentUser) &&
    (verificationRequired === 'no' || (!verificationRequired && (!layer || layer === 'leader')));
  return directMinorClosure || canVerifyFinding_(currentUser, finding);
}

function canViewFindingRbac_(currentUser, finding) {
  if (isAdmin_(currentUser) || hasPermission_(currentUser, 'findings.view.all')) return true;
  if (hasPermission_(currentUser, 'findings.view.line') && cleanString_(finding.LineID) &&
      canAccessLine_(currentUser, finding.LineID, 'View')) return true;
  if (hasPermission_(currentUser, 'findings.view.assigned') && isAssignedToUser_(finding, currentUser)) return true;
  return hasPermission_(currentUser, 'findings.view.created') && isCreatedByUser_(finding, currentUser);
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
