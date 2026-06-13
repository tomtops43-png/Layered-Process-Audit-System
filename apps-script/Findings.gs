/** Finding search, update, and closure APIs. */
function getFindings(payload, currentUser) {
  try {
    var rows = getRowsAsObjects(SHEET_NAMES.FINDINGS).map(refreshOverdueForRead_).filter(function (row) {
      return (!payload.lineId || valuesEqual_(row.LineID, payload.lineId)) &&
        (!payload.stationId || valuesEqual_(row.StationID, payload.stationId)) &&
        (!payload.category || valuesEqual_(row.Category, payload.category)) &&
        (!payload.status || valuesEqual_(row.Status, payload.status)) &&
        (!payload.pic || valuesEqual_(row.PICName, payload.pic) || valuesEqual_(row.PICUserID, payload.pic)) &&
        (!payload.periodMonth || valuesEqual_(row.PeriodMonth, payload.periodMonth)) &&
        (!payload.overdueOnly || valuesEqual_(row.OverdueFlag, 'Yes'));
    });
    if (['Leader', 'User'].indexOf(currentUser.Role) !== -1) rows = rows.filter(function (row) { return canAccessFinding_(currentUser, row); });
    rows.sort(function (a, b) { return cleanString_(a.DueDate).localeCompare(cleanString_(b.DueDate)); });
    return jsonResponse(true, 'Findings loaded.', { findings: rows.map(sanitizeForClient_), count: rows.length });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function updateFinding(payload, currentUser) {
  try {
    requireFields_(payload, ['findingId']);
    var finding = findById_(SHEET_NAMES.FINDINGS, 'FindingID', payload.findingId);
    if (!finding) throw new Error('Finding not found: ' + payload.findingId);
    if (!canAccessFinding_(currentUser, finding)) return jsonResponse(false, 'You can update only findings assigned to you.', {});

    var allowed = ['CorrectiveAction', 'RootCause', 'PICName', 'PICUserID', 'DueDate', 'Status', 'Priority', 'AfterPhotoURL', 'CloseRemark'];
    var aliases = {
      correctiveAction: 'CorrectiveAction', rootCause: 'RootCause', picName: 'PICName', picUserId: 'PICUserID',
      dueDate: 'DueDate', status: 'Status', priority: 'Priority', afterPhotoUrl: 'AfterPhotoURL', closeRemark: 'CloseRemark'
    };
    var updates = {};
    allowed.forEach(function (field) { if (Object.prototype.hasOwnProperty.call(payload, field)) updates[field] = payload[field]; });
    Object.keys(aliases).forEach(function (key) { if (Object.prototype.hasOwnProperty.call(payload, key)) updates[aliases[key]] = payload[key]; });
    if (!Object.keys(updates).length) throw new Error('No supported finding fields were provided to update.');
    if (updates.DueDate) updates.DueDate = formatDateBangkok_(updates.DueDate);

    var oldStatus = finding.Status;
    var newStatus = updates.Status !== undefined ? updates.Status : oldStatus;
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

function closeFinding(payload, currentUser) {
  try {
    requireFields_(payload, ['findingId']);
    var finding = findById_(SHEET_NAMES.FINDINGS, 'FindingID', payload.findingId);
    if (!finding) throw new Error('Finding not found: ' + payload.findingId);
    if (!canAccessFinding_(currentUser, finding)) return jsonResponse(false, 'You can close only findings assigned to you.', {});
    var afterPhoto = payload.afterPhotoUrl || payload.AfterPhotoURL || finding.AfterPhotoURL;
    var closeRemark = payload.closeRemark || payload.CloseRemark || finding.CloseRemark;
    if (!afterPhoto && !closeRemark) throw new Error('AfterPhotoURL or CloseRemark is required to close a finding.');

    var timestamp = formatDateTimeBangkok(new Date());
    var updates = {
      Status: 'Closed', AfterPhotoURL: afterPhoto || '', CloseRemark: closeRemark || '',
      ClosedDate: timestamp, ClosedBy: currentUser.UserID, OverdueFlag: 'No', DaysOverdue: 0,
      UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
    };
    var updated = updateObjectById(SHEET_NAMES.FINDINGS, 'FindingID', payload.findingId, updates);
    appendActionLog_(payload.findingId, finding.Status, 'Closed', updates, payload.remark || closeRemark || '', payload.evidenceUrl || '', currentUser, timestamp);
    return jsonResponse(true, 'Finding closed successfully.', { finding: sanitizeForClient_(updated) });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
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
