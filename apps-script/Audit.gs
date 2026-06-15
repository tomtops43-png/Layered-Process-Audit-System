/** Audit session and audit-record APIs. */
function saveAudit(payload, currentUser) {
  try {
    requireFields_(payload, ['auditDate', 'lineId', 'stationId', 'auditLayer', 'records']);
    var auditLayerPermissions = {
      leader: 'audit.leader.create',
      engineer: 'audit.engineer.create',
      supervisor: 'audit.supervisor.create',
      manager: 'audit.manager.create'
    };
    var auditPermission = auditLayerPermissions[cleanString_(payload.auditLayer).toLowerCase()];
    if (!auditPermission || !hasPermission_(currentUser, auditPermission)) {
      throw new Error('คุณไม่มีสิทธิ์สร้าง Audit Layer นี้');
    }
    if (!isAdmin_(currentUser) && !hasPermission_(currentUser, 'audit.view.all') &&
        (hasPermission_(currentUser, 'audit.supervisor.create') ||
         hasPermission_(currentUser, 'audit.engineer.create') ||
         hasPermission_(currentUser, 'audit.leader.create'))) {
      requireLineAccess_(currentUser, payload.lineId, 'Audit');
    }
    if (!Array.isArray(payload.records) || !payload.records.length) throw new Error('At least one audit record is required.');
    payload.records.forEach(function (record, index) {
      try { requireFields_(record, ['checklistId', 'result']); } catch (error) { throw new Error('Record ' + (index + 1) + ': ' + error.message); }
      var validatedResult = normalizeAuditResult_(record.result);
      if (!validatedResult) throw new Error('Record ' + (index + 1) + ': result must be OK, NG, or N/A.');
      if (validatedResult === 'NG') {
        var selectedUserId = cleanString_(record.assignedToUserId || record.picUserId);
        var selectedUser = selectedUserId ? findById_(SHEET_NAMES.USERS, 'UserID', selectedUserId) : null;
        if (selectedUserId && (!selectedUser || !isActive_(selectedUser.ActiveStatus))) {
          throw new Error('Record ' + (index + 1) + ': assigned user was not found or is inactive.');
        }
      }
    });

    var now = new Date();
    var timestamp = formatDateTimeBangkok(now);
    var auditDate = formatDateBangkok_(payload.auditDate);
    var today = formatDateBangkok_(now);
    var lateReason = cleanString_(payload.lateReason);
    var isBackdated = auditDate < today;
    if (isBackdated && !lateReason) throw new Error('คุณกำลังบันทึก Audit ย้อนหลัง กรุณาระบุเหตุผล');
    var auditTime = cleanString_(payload.auditTime) || Utilities.formatDate(now, APP_TIMEZONE, 'HH:mm:ss');
    var periodMonth = getPeriodMonth(parseDate_(auditDate) || now);
    var line = findById_(SHEET_NAMES.LINES, 'LineID', payload.lineId) || {};
    var station = findById_(SHEET_NAMES.STATIONS, 'StationID', payload.stationId) || {};
    var lineName = cleanString_(payload.lineName) || cleanString_(line.LineName) || cleanString_(station.LineName);
    var stationName = cleanString_(payload.stationName) || cleanString_(station.StationName);
    var area = cleanString_(payload.area) || cleanString_(station.Area) || cleanString_(line.Area);
    var auditId = generateId('LPA', SHEET_NAMES.AUDIT_SESSIONS, 'AuditID', periodMonth);
    var matchingPlan = findMatchingPlanForAudit_(payload);
    if (matchingPlan && (!valuesEqual_(matchingPlan.AuditLayer, payload.auditLayer) ||
        !valuesEqual_(matchingPlan.LineID, payload.lineId) || !valuesEqual_(matchingPlan.StationID, payload.stationId))) {
      throw new Error('Audit Plan does not match the selected audit scope.');
    }
    var planDueAt = matchingPlan ? cleanString_(matchingPlan.DueDate) + ' ' + (cleanString_(matchingPlan.DueTime) || '17:00') + ':00' : '';
    var isLate = isBackdated || (planDueAt && timestamp > planDueAt);
    var planStatus = matchingPlan ? (isLate ? 'Late Submitted' : 'Completed') : '';
    var totals = { OK: 0, NG: 0, NA: 0 };
    payload.records.forEach(function (record) { totals[normalizeAuditResult_(record.result).replace('/', '')]++; });
    var checked = totals.OK + totals.NG;
    var ngRate = checked ? Number((totals.NG * 100 / checked).toFixed(2)) : 0;
    var resultSummary = totals.NG > 0 ? 'NG' : (totals.OK > 0 ? 'OK' : 'N/A');

    appendObject(SHEET_NAMES.AUDIT_SESSIONS, {
      AuditID: auditId, AuditDate: auditDate, AuditTime: auditTime, PeriodMonth: periodMonth,
      LineID: payload.lineId, LineName: lineName, StationID: payload.stationId, StationName: stationName,
      Area: area, Shift: payload.shift || '', AuditorUserID: currentUser.UserID,
      AuditorName: currentUser.FullName, AuditorRole: currentUser.Role, AuditLayer: payload.auditLayer,
      TotalCheck: payload.records.length, TotalOK: totals.OK, TotalNG: totals.NG, TotalNA: totals.NA,
      ResultSummary: resultSummary, NGRate: ngRate, SubmitStatus: payload.submitStatus || 'Submitted',
      Remark: payload.remark || '', SubmittedAt: timestamp, IsLate: isLate ? 'Yes' : 'No',
      LateReason: lateReason, PlanID: matchingPlan ? matchingPlan.PlanID : cleanString_(payload.planId),
      PlanStatus: planStatus, CreatedAt: timestamp, CreatedBy: currentUser.UserID,
      UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
    });
    var findingIds = [];
    payload.records.forEach(function (record) {
      var checklist = findById_(SHEET_NAMES.CHECKLIST, 'ChecklistID', record.checklistId) || {};
      var recordId = generateId('AR', SHEET_NAMES.AUDIT_RECORDS, 'RecordID', periodMonth);
      var result = normalizeAuditResult_(record.result);
      var defaultDays = toNumber_(getSetting('DEFAULT_DUE_DAYS')) || 7;
      var dueDate = record.dueDate ? formatDateBangkok_(record.dueDate) : (result === 'NG' ? addDays_(parseDate_(auditDate) || now, defaultDays) : '');
      var findingDetail = cleanString_(record.findingDetail);
      var assignedUserId = result === 'NG' ? cleanString_(record.assignedToUserId || record.picUserId) : '';
      var assignedUser = assignedUserId ? findById_(SHEET_NAMES.USERS, 'UserID', assignedUserId) : null;
      if (assignedUserId && (!assignedUser || !isActive_(assignedUser.ActiveStatus))) {
        throw new Error('Assigned user was not found or is inactive: ' + assignedUserId);
      }
      var assignedName = assignedUser ? cleanString_(assignedUser.FullName) : '';
      var assignedRole = assignedUser ? cleanString_(assignedUser.Role) : '';
      var initialFindingStatus = assignedUserId ? 'Assigned' : 'Open';
      var auditRecord = {
        RecordID: recordId, AuditID: auditId, AuditDate: auditDate, PeriodMonth: periodMonth,
        LineID: payload.lineId, LineName: lineName, StationID: payload.stationId, StationName: stationName,
        Category: record.category || checklist.Category || '', ChecklistID: record.checklistId,
        CheckItemSnapshot: record.checkItem || checklist.CheckItem || '',
        StandardCriteriaSnapshot: record.standardCriteria || checklist.StandardCriteria || '',
        ChecklistRevision: record.checklistRevision || checklist.Revision || '', Result: result,
        FindingDetail: findingDetail, CorrectiveAction: record.correctiveAction || '',
        ResponsiblePerson: result === 'NG' ? assignedName : cleanString_(record.responsiblePerson || record.picName),
        DueDate: dueDate, Status: result === 'NG' ? initialFindingStatus : 'Completed',
        BeforePhotoURL: record.beforePhotoUrl || '', AfterPhotoURL: record.afterPhotoUrl || '',
        Remark: record.remark || '', FindingID: '', CreatedAt: timestamp, CreatedBy: currentUser.UserID,
        UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
      };
      appendObject(SHEET_NAMES.AUDIT_RECORDS, auditRecord);

      if (result === 'NG') {
        var findingId = generateId('F', SHEET_NAMES.FINDINGS, 'FindingID', periodMonth);
        var severity = cleanString_(record.severity || record.priority || checklist.Severity) || 'Minor';
        var verificationRequired = cleanString_(record.verificationRequired) ||
          (severity.toLowerCase() === 'minor' && cleanString_(payload.auditLayer).toLowerCase() === 'leader' ? 'No' : 'Yes');
        appendObject(SHEET_NAMES.FINDINGS, {
          FindingID: findingId, AuditID: auditId, RecordID: recordId, FoundDate: auditDate,
          PeriodMonth: periodMonth, LineID: payload.lineId, LineName: lineName,
          StationID: payload.stationId, StationName: stationName, Area: area,
          Category: auditRecord.Category,
          ProblemDetail: findingDetail || auditRecord.Remark || auditRecord.CheckItemSnapshot,
          StandardCriteria: auditRecord.StandardCriteriaSnapshot,
          CorrectiveAction: auditRecord.CorrectiveAction, RootCause: record.rootCause || '',
          ActionRemark: cleanString_(record.actionRemark),
          PICUserID: assignedUserId, PICName: assignedName,
          AuditorUserID: currentUser.UserID, AuditorName: currentUser.FullName, AuditorRole: currentUser.Role,
          AssignedToUserID: assignedUserId, AssignedToName: assignedName,
          AssignedToRole: assignedRole,
          VerifierUserID: '', VerifierName: '', VerifierRole: '', Severity: severity,
          VerificationRequired: verificationRequired, VerificationStatus: 'Not Submitted',
          SubmittedAt: '', SubmittedBy: '',
          DueDate: dueDate, Status: initialFindingStatus, Priority: record.priority || severity,
          BeforePhotoURL: auditRecord.BeforePhotoURL, AfterPhotoURL: auditRecord.AfterPhotoURL,
          ClosedDate: '', ClosedAt: '', ClosedBy: '', CloseRemark: '',
          RejectedAt: '', RejectedBy: '', RejectReason: '', OverdueFlag: 'No', DaysOverdue: 0,
          CreatedAt: timestamp, CreatedBy: currentUser.UserID, UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
        });
        updateObjectById(SHEET_NAMES.AUDIT_RECORDS, 'RecordID', recordId, { FindingID: findingId });
        findingIds.push(findingId);
      }
    });
    completeAuditPlan_(matchingPlan, auditId, timestamp, isLate, lateReason, currentUser);

    return jsonResponse(true, 'Audit saved successfully.', {
      AuditID: auditId, FindingIDs: findingIds, PlanID: matchingPlan ? matchingPlan.PlanID : '',
      IsLate: isLate ? 'Yes' : 'No', PlanStatus: planStatus
    });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function getAuditList(payload, currentUser) {
  try {
    var rows = getRowsAsObjects(SHEET_NAMES.AUDIT_SESSIONS).filter(function (row) {
      return (!payload.periodMonth || valuesEqual_(row.PeriodMonth, payload.periodMonth)) &&
        (!payload.lineId || valuesEqual_(row.LineID, payload.lineId)) &&
        (!payload.stationId || valuesEqual_(row.StationID, payload.stationId)) &&
        (!payload.auditLayer || valuesEqual_(row.AuditLayer, payload.auditLayer)) &&
        (!payload.status || valuesEqual_(row.SubmitStatus, payload.status));
    });
    if (!hasPermission_(currentUser, 'audit.view.all')) {
      rows = rows.filter(function (row) {
        return (hasPermission_(currentUser, 'audit.view.line') && canAccessLine_(currentUser, row.LineID, 'View')) ||
          (hasPermission_(currentUser, 'audit.view.own') && valuesEqual_(row.AuditorUserID, currentUser.UserID));
      });
    }
    rows.sort(function (a, b) { return (cleanString_(b.AuditDate) + cleanString_(b.AuditTime)).localeCompare(cleanString_(a.AuditDate) + cleanString_(a.AuditTime)); });
    var limit = Math.min(Math.max(toNumber_(payload.limit) || 100, 1), 500);
    return jsonResponse(true, 'Audit list loaded.', { audits: rows.slice(0, limit).map(sanitizeForClient_), count: rows.length });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function addDays_(date, days) {
  var result = new Date(date.getTime());
  result.setDate(result.getDate() + Number(days));
  return formatDateBangkok_(result);
}

function normalizeAuditResult_(result) {
  var value = cleanString_(result).toUpperCase().replace(/\s/g, '');
  if (value === 'NA' || value === 'N/A') return 'N/A';
  return value === 'OK' || value === 'NG' ? value : '';
}
