/** Audit session and audit-record APIs. */
function saveAudit(payload, currentUser) {
  var saveLock = null;
  var saveLockAcquired = false;
  try {
    requireFields_(payload, ['auditDate', 'lineId', 'auditLayer', 'records']);
    if (!payload.stationId) payload.stationId = 'ALL';
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
    requireFields_(payload, ['clientSubmissionId']);
    if (!isAdmin_(currentUser) && !hasPermission_(currentUser, 'audit.view.all') &&
        (hasPermission_(currentUser, 'audit.supervisor.create') ||
         hasPermission_(currentUser, 'audit.engineer.create') ||
         hasPermission_(currentUser, 'audit.leader.create'))) {
      requireLineAccess_(currentUser, payload.lineId, 'Audit');
    }
    if (!Array.isArray(payload.records) || !payload.records.length) throw new Error('At least one audit record is required.');
    var shift = cleanString_(payload.shift);
    // Supervisor/Manager do not use Shift — skip validation for them
    var roleRequiresShift = ['Leader', 'Engineer', 'User'].indexOf(cleanString_(currentUser.Role)) !== -1;
    if (roleRequiresShift) {
      if (!shift) throw new Error('กรุณาเลือก Shift');
      var activeShift = getCachedListRows_().some(function (row) {
        return valuesEqual_(row.ListType, 'Shift') && valuesEqual_(row.ListValue, shift) && isActive_(row.ActiveStatus);
      });
      if (!activeShift) throw new Error('Shift ที่เลือกไม่ได้เปิดใช้งาน กรุณาเลือก Shift ใหม่');
    }
    var checklistIds = {};
    payload.records.forEach(function (record, index) {
      try { requireFields_(record, ['checklistId', 'result']); } catch (error) { throw new Error('Record ' + (index + 1) + ': ' + error.message); }
      var checklistKey = cleanString_(record.checklistId).toLowerCase();
      if (checklistIds[checklistKey]) throw new Error('Duplicate checklist item in audit: ' + record.checklistId);
      checklistIds[checklistKey] = true;
      var validatedResult = normalizeAuditResult_(record.result);
      if (!validatedResult) throw new Error('Record ' + (index + 1) + ': result must be OK, NG, or N/A.');
      if (validatedResult === 'NG') {
        var assignmentMode = normalizeFindingAssignmentMode_(record.assignmentMode, record);
        if (assignmentMode === 'ROLE') {
          var selectedRole = cleanString_(record.assignedRole || record.assignedRoleName || record.responsiblePerson || record.picName);
          if (!selectedRole) throw new Error('Record ' + (index + 1) + ': AssignedRole is required for role-based Finding assignment.');
          validateAssignableFindingRole_(selectedRole);
        } else {
          var selectedUserId = cleanString_(record.assignedUserId || record.assignedToUserId || record.picUserId);
          var _uRows = getCachedUserRows_();
          var selectedUser = selectedUserId ? _uRows.filter(function(u){ return valuesEqual_(u.UserID, selectedUserId); })[0] : null;
          if (!selectedUserId || !selectedUser || !isActive_(selectedUser.ActiveStatus)) {
            throw new Error('Record ' + (index + 1) + ': assigned user was not found or is inactive.');
          }
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
    // Use payload names if provided — avoids LINES/STATIONS sheet reads
    var lineName = cleanString_(payload.lineName);
    var stationName = cleanString_(payload.stationName);
    var area = cleanString_(payload.area);
    if (!lineName) {
      var line = findById_(SHEET_NAMES.LINES, 'LineID', payload.lineId) || {};
      lineName = cleanString_(line.LineName);
      if (!area) area = cleanString_(line.Area);
    }
    if (!stationName) {
      stationName = payload.stationId === 'ALL' ? 'ทั้ง Line'
        : cleanString_((findById_(SHEET_NAMES.STATIONS, 'StationID', payload.stationId) || {}).StationName);
    }
    var clientSubmissionId = cleanString_(payload.clientSubmissionId);
    var explicitPlanId = cleanString_(payload.planId);
    var auditKey = buildAuditKey_(auditDate, payload.lineId, payload.stationId, payload.auditLayer, shift, currentUser.UserID);

    saveLock = LockService.getScriptLock();
    saveLock.waitLock(30000);
    saveLockAcquired = true;

    // Read AUDIT_SESSIONS once — reuse for duplicate check AND ID generation
    var existingSessions = getRowsAsObjects(SHEET_NAMES.AUDIT_SESSIONS);
    var idempotentSession = existingSessions.filter(function (row) {
      return valuesEqual_(row.ClientSubmissionID, clientSubmissionId);
    })[0];
    if (idempotentSession) {
      var existingFindingIds = getCachedFindingRows_().filter(function (row) {
        return valuesEqual_(row.AuditID, idempotentSession.AuditID);
      }).map(function (row) { return row.FindingID; });
      return jsonResponse(true, 'Audit already saved; returning the existing result.', {
        AuditID: idempotentSession.AuditID, FindingIDs: existingFindingIds,
        PlanID: idempotentSession.PlanID || '', IsLate: idempotentSession.IsLate || 'No',
        PlanStatus: idempotentSession.PlanStatus || '', IsDuplicate: true
      });
    }

    var matchingPlan = explicitPlanId ? findById_(SHEET_NAMES.AUDIT_PLAN, 'PlanID', explicitPlanId) : null;
    if (explicitPlanId && !matchingPlan) throw new Error('ไม่พบแผนการตรวจที่ระบุ');
    if (matchingPlan && (cleanString_(matchingPlan.CompletedAuditID) ||
        ['completed', 'late submitted'].indexOf(cleanString_(matchingPlan.Status).toLowerCase()) !== -1)) {
      throw new Error('แผนการตรวจนี้ถูกบันทึกเรียบร้อยแล้ว ไม่สามารถบันทึกซ้ำได้');
    }
    if (explicitPlanId && existingSessions.some(function (row) { return valuesEqual_(row.PlanID, explicitPlanId); })) {
      throw new Error('แผนการตรวจนี้ถูกบันทึกเรียบร้อยแล้ว ไม่สามารถบันทึกซ้ำได้');
    }
    if (!explicitPlanId && existingSessions.some(function (row) {
      var existingAuditKey = cleanString_(row.AuditKey) || buildAuditKey_(
        formatDateBangkok_(row.AuditDate), row.LineID, row.StationID, row.AuditLayer, row.Shift, row.AuditorUserID
      );
      return valuesEqual_(existingAuditKey, auditKey);
    })) {
      throw new Error('มีการบันทึก LPA สำหรับ Line / Station / Layer / Shift นี้แล้วในช่วงเวลานี้');
    }
    if (matchingPlan && (!valuesEqual_(matchingPlan.AuditLayer, payload.auditLayer) ||
        !valuesEqual_(matchingPlan.LineID, payload.lineId) || !valuesEqual_(matchingPlan.StationID, payload.stationId))) {
      throw new Error('Audit Plan does not match the selected audit scope.');
    }
    // Generate LPA ID from already-read existingSessions — no second sheet read
    var auditId = generateMultipleIdsWithoutLock_('LPA', SHEET_NAMES.AUDIT_SESSIONS, 'AuditID', periodMonth, 1)[0];
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
      Area: area, Shift: shift, AuditorUserID: currentUser.UserID,
      AuditorName: currentUser.FullName, AuditorRole: currentUser.Role, AuditLayer: payload.auditLayer,
      TotalCheck: payload.records.length, TotalOK: totals.OK, TotalNG: totals.NG, TotalNA: totals.NA,
      ResultSummary: resultSummary, NGRate: ngRate, SubmitStatus: payload.submitStatus || 'Submitted',
      Remark: payload.remark || '', SubmittedAt: timestamp, IsLate: isLate ? 'Yes' : 'No',
      LateReason: lateReason, PlanID: matchingPlan ? matchingPlan.PlanID : '',
      PlanStatus: planStatus, AuditKey: auditKey, ClientSubmissionID: clientSubmissionId,
      SaveSource: matchingPlan ? 'Plan' : 'Manual', CreatedAt: timestamp, CreatedBy: currentUser.UserID,
      UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
    });

    // Use cached sheet reads — no repeated Sheets API calls
    var checklistMap = {};
    getCachedChecklistRows_().forEach(function (row) { checklistMap[cleanString_(row.ChecklistID)] = row; });
    var usersMap = {};
    getCachedUserRows_().forEach(function (row) { usersMap[cleanString_(row.UserID)] = row; });
    var defaultDays = getDefaultDueDays_();
    var ngCount = payload.records.filter(function (r) { return normalizeAuditResult_(r.result) === 'NG'; }).length;
    // Pre-generate all IDs in two batch calls (one sheet read each)
    var recordIds = generateMultipleIdsWithoutLock_('AR', SHEET_NAMES.AUDIT_RECORDS, 'RecordID', periodMonth, payload.records.length);
    var findingIds_pre = ngCount > 0 ? generateMultipleIdsWithoutLock_('F', SHEET_NAMES.FINDINGS, 'FindingID', periodMonth, ngCount) : [];
    var findingIdIndex = 0;
    var auditRecordsBatch = [];
    var findingsBatch = [];
    var findingIds = [];

    payload.records.forEach(function (record, index) {
      var checklist = checklistMap[cleanString_(record.checklistId)] || {};
      var recordId = recordIds[index];
      var result = normalizeAuditResult_(record.result);
      var dueDate = record.dueDate ? formatDateBangkok_(record.dueDate) : (result === 'NG' ? addDays_(parseDate_(auditDate) || now, defaultDays) : '');
      var findingDetail = cleanString_(record.findingDetail);
      var assignmentMode = result === 'NG' ? normalizeFindingAssignmentMode_(record.assignmentMode, record) : '';
      var assignedUserId = '';
      var assignedName = '';
      var assignedRole = '';
      var assignedRoleName = '';
      if (result === 'NG' && assignmentMode === 'ROLE') {
        assignedRole = validateAssignableFindingRole_(record.assignedRole || record.assignedRoleName || record.responsiblePerson || record.picName);
        assignedRoleName = assignedRole;
      } else if (result === 'NG' && assignmentMode === 'USER') {
        assignedUserId = cleanString_(record.assignedUserId || record.assignedToUserId || record.picUserId);
        var assignedUser = usersMap[assignedUserId] || null;
        if (!assignedUserId || !assignedUser || !isActive_(assignedUser.ActiveStatus)) {
          throw new Error('Assigned user was not found or is inactive: ' + assignedUserId);
        }
        assignedName = cleanString_(assignedUser.FullName);
        assignedRole = cleanString_(assignedUser.Role);
      }
      var responsibleDisplay = assignmentMode === 'ROLE' ? assignedRoleName : assignedName;
      var initialFindingStatus = result === 'NG' ? 'Assigned' : 'Completed';
      var findingId = result === 'NG' ? findingIds_pre[findingIdIndex++] : '';
      var auditRecord = {
        RecordID: recordId, AuditID: auditId, AuditDate: auditDate, PeriodMonth: periodMonth,
        LineID: payload.lineId, LineName: lineName, StationID: payload.stationId, StationName: stationName,
        Category: record.category || checklist.Category || '', ChecklistID: record.checklistId,
        CheckItemSnapshot: record.checkItem || checklist.CheckItem || '',
        StandardCriteriaSnapshot: record.standardCriteria || checklist.StandardCriteria || '',
        ChecklistRevision: record.checklistRevision || checklist.Revision || '', Result: result,
        FindingDetail: findingDetail, CorrectiveAction: record.correctiveAction || '',
        ResponsiblePerson: result === 'NG' ? responsibleDisplay : cleanString_(record.responsiblePerson || record.picName),
        DueDate: dueDate, Status: initialFindingStatus,
        BeforePhotoURL: record.beforePhotoUrl || '', AfterPhotoURL: record.afterPhotoUrl || '',
        Remark: record.remark || '', FindingID: findingId, CreatedAt: timestamp, CreatedBy: currentUser.UserID,
        UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
      };
      auditRecordsBatch.push(auditRecord);

      if (result === 'NG') {
        var severity = cleanString_(record.severity || record.priority || checklist.Severity) || 'Minor';
        var verificationRequired = cleanString_(record.verificationRequired) ||
          (severity.toLowerCase() === 'minor' && cleanString_(payload.auditLayer).toLowerCase() === 'leader' ? 'No' : 'Yes');
        findingsBatch.push({
          FindingID: findingId, AuditID: auditId, RecordID: recordId, FoundDate: auditDate,
          PeriodMonth: periodMonth, LineID: payload.lineId, LineName: lineName,
          StationID: payload.stationId, StationName: stationName, Area: area,
          Category: auditRecord.Category,
          ProblemDetail: findingDetail || auditRecord.Remark || auditRecord.CheckItemSnapshot,
          StandardCriteria: auditRecord.StandardCriteriaSnapshot,
          CorrectiveAction: auditRecord.CorrectiveAction, RootCause: record.rootCause || '',
          ActionRemark: cleanString_(record.actionRemark),
          AssignmentMode: assignmentMode, AssignedRole: assignmentMode === 'ROLE' ? assignedRole : '',
          AssignedRoleName: assignmentMode === 'ROLE' ? assignedRoleName : '',
          AssignedUserID: assignmentMode === 'USER' ? assignedUserId : '',
          AssignedUserName: assignmentMode === 'USER' ? assignedName : '',
          ResponsibleUserID: assignmentMode === 'USER' ? assignedUserId : '',
          ResponsiblePerson: responsibleDisplay, Responsible: responsibleDisplay,
          PICUserID: assignmentMode === 'USER' ? assignedUserId : '', PICName: responsibleDisplay,
          AuditorUserID: currentUser.UserID, AuditorName: currentUser.FullName, AuditorRole: currentUser.Role,
          AssignedToUserID: assignmentMode === 'USER' ? assignedUserId : '', AssignedToName: responsibleDisplay,
          AssignedToRole: assignedRole,
          VerifierUserID: '', VerifierName: '', VerifierRole: '', Severity: severity,
          VerificationRequired: verificationRequired, VerificationStatus: 'Not Submitted',
          SubmittedAt: '', SubmittedBy: '', SubmittedByName: '', ActionBy: '', ActionByName: '',
          DueDate: dueDate, Status: initialFindingStatus, Priority: record.priority || severity,
          BeforePhotoURL: auditRecord.BeforePhotoURL, AfterPhotoURL: auditRecord.AfterPhotoURL,
          ClosedDate: '', ClosedAt: '', ClosedBy: '', ClosedByName: '', CloseRemark: '',
          RejectedAt: '', RejectedBy: '', RejectedByName: '', RejectReason: '', OverdueFlag: 'No', DaysOverdue: 0,
          CreatedAt: timestamp, CreatedBy: currentUser.UserID, UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
        });
        findingIds.push(findingId);
      }
    });

    // Batch write all records and findings in one Sheets API call each
    appendBatch_(SHEET_NAMES.AUDIT_RECORDS, auditRecordsBatch);
    if (findingsBatch.length) appendBatch_(SHEET_NAMES.FINDINGS, findingsBatch);
    completeAuditPlan_(matchingPlan, auditId, timestamp, isLate, lateReason, currentUser);
    invalidateDashboardCachesForUser_(currentUser);

    return jsonResponse(true, 'Audit saved successfully.', {
      AuditID: auditId, FindingIDs: findingIds, PlanID: matchingPlan ? matchingPlan.PlanID : '',
      IsLate: isLate ? 'Yes' : 'No', PlanStatus: planStatus
    });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  } finally {
    if (saveLockAcquired) saveLock.releaseLock();
  }
}

function buildAuditKey_(auditDate, lineId, stationId, auditLayer, shift, auditorId) {
  return [auditDate, lineId, stationId, auditLayer, shift, auditorId].map(function (value) {
    return cleanString_(value);
  }).join('|');
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
