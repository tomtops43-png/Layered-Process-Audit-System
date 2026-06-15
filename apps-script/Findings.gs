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
    if (valuesEqual_(finding.Status, 'Closed') || valuesEqual_(finding.Status, 'Pending Verification')) {
      throw new Error('This finding cannot be edited in its current status.');
    }

    var allowed = ['CorrectiveAction', 'RootCause', 'ActionRemark', 'DueDate', 'Status', 'AfterPhotoURL'];
    var aliases = {
      correctiveAction: 'CorrectiveAction', rootCause: 'RootCause', dueDate: 'DueDate', status: 'Status',
      actionRemark: 'ActionRemark', afterPhotoUrl: 'AfterPhotoURL'
    };
    var updates = {};
    allowed.forEach(function (field) { if (Object.prototype.hasOwnProperty.call(payload, field)) updates[field] = payload[field]; });
    Object.keys(aliases).forEach(function (key) { if (Object.prototype.hasOwnProperty.call(payload, key)) updates[aliases[key]] = payload[key]; });

    if (Object.prototype.hasOwnProperty.call(payload, 'assignedToUserId')) {
      requirePermission_(currentUser, 'findings.assign');
      var assignedUserId = cleanString_(payload.assignedToUserId);
      var assignee = assignedUserId ? findById_(SHEET_NAMES.USERS, 'UserID', assignedUserId) : null;
      if (assignedUserId && (!assignee || !isActive_(assignee.ActiveStatus))) {
        throw new Error('Assigned user was not found or is inactive.');
      }
      updates.AssignedToUserID = assignedUserId;
      updates.AssignedToName = assignee ? assignee.FullName : '';
      updates.AssignedToRole = assignee ? assignee.Role : '';
      updates.PICUserID = assignedUserId;
      updates.PICName = assignee ? assignee.FullName : '';
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
    if (Object.prototype.hasOwnProperty.call(payload, 'assignedToUserId') &&
        (valuesEqual_(oldStatus, 'Open') || valuesEqual_(oldStatus, 'Assigned'))) {
      newStatus = updates.AssignedToUserID ? 'Assigned' : 'Open';
      updates.Status = newStatus;
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
    var timestamp = formatDateTimeBangkok(new Date());
    var updates = {
      CorrectiveAction: correctiveAction, RootCause: rootCause, AfterPhotoURL: afterPhoto,
      Status: 'Pending Verification', VerificationStatus: 'Pending',
      SubmittedAt: timestamp, SubmittedBy: currentUser.UserID,
      RejectedAt: '', RejectedBy: '', RejectReason: '',
      UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
    };
    var actionRemark = cleanString_(payload.actionRemark || payload.ActionRemark || finding.ActionRemark);
    updates.ActionRemark = actionRemark;
    var updated = updateObjectById(SHEET_NAMES.FINDINGS, 'FindingID', payload.findingId, updates);
    appendActionLog_(payload.findingId, oldStatus, updates.Status, updates, payload.remark || 'Submitted for verification', payload.evidenceUrl || afterPhoto, currentUser, timestamp);
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
      UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
    };
    if (decision === 'reject' || decision === 'rejected') {
      var rejectReason = cleanString_(payload.rejectReason || payload.RejectReason || payload.closeRemark || payload.CloseRemark);
      if (!rejectReason) throw new Error('RejectReason is required.');
      updates.Status = 'Rejected';
      updates.VerificationStatus = 'Rejected';
      updates.RejectedAt = timestamp;
      updates.RejectedBy = currentUser.UserID;
      updates.RejectReason = rejectReason;
    } else {
      var closeRemark = cleanString_(payload.closeRemark || payload.CloseRemark);
      if (!closeRemark) throw new Error('CloseRemark is required to close a finding.');
      updates.Status = 'Closed';
      updates.VerificationStatus = 'Approved';
      updates.ClosedDate = timestamp;
      updates.ClosedAt = timestamp;
      updates.ClosedBy = currentUser.UserID;
      updates.CloseRemark = closeRemark;
      updates.OverdueFlag = 'No';
      updates.DaysOverdue = 0;
    }
    var updated = updateObjectById(SHEET_NAMES.FINDINGS, 'FindingID', payload.findingId, updates);
    appendActionLog_(payload.findingId, oldStatus, updates.Status, updates, payload.remark || updates.RejectReason || updates.CloseRemark || '', payload.evidenceUrl || '', currentUser, timestamp);
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
    return canHandlePendingVerification_(currentUser, finding);
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
  var severity = cleanString_(finding.Severity || finding.Priority).toLowerCase();
  if (severity !== 'minor' || !hasPermission_(currentUser, 'findings.close.minor') ||
      !isAssignedToUser_(finding, currentUser)) return false;
  var audit = findById_(SHEET_NAMES.AUDIT_SESSIONS, 'AuditID', finding.AuditID) || {};
  var layer = cleanString_(audit.AuditLayer).toLowerCase();
  var verificationRequired = cleanString_(finding.VerificationRequired).toLowerCase();
  return verificationRequired === 'no' || (!verificationRequired && (!layer || layer === 'leader'));
}

function canViewFindingRbac_(currentUser, finding) {
  if (isAdmin_(currentUser) || hasPermission_(currentUser, 'findings.view.all')) return true;
  if (canHandlePendingVerification_(currentUser, finding)) return true;
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
