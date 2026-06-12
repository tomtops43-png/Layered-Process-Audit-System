/** Audit session and audit-record APIs. */
function saveAudit(payload, currentUser) {
  try {
    requireFields_(payload, ['auditDate', 'lineId', 'stationId', 'auditLayer', 'records']);
    if (!Array.isArray(payload.records) || !payload.records.length) throw new Error('At least one audit record is required.');
    payload.records.forEach(function (record, index) {
      try { requireFields_(record, ['checklistId', 'result']); } catch (error) { throw new Error('Record ' + (index + 1) + ': ' + error.message); }
      if (['OK', 'NG', 'NA'].indexOf(cleanString_(record.result).toUpperCase()) === -1) throw new Error('Record ' + (index + 1) + ': result must be OK, NG, or NA.');
    });

    var now = new Date();
    var timestamp = formatDateTimeBangkok(now);
    var auditDate = formatDateBangkok_(payload.auditDate);
    var periodMonth = getPeriodMonth(parseDate_(auditDate) || now);
    var auditId = generateId('LPA', SHEET_NAMES.AUDIT_SESSIONS, 'AuditID', periodMonth);
    var totals = { OK: 0, NG: 0, NA: 0 };
    payload.records.forEach(function (record) { totals[cleanString_(record.result).toUpperCase()]++; });
    var checked = totals.OK + totals.NG;
    var ngRate = checked ? Number((totals.NG * 100 / checked).toFixed(2)) : 0;
    var resultSummary = totals.NG > 0 ? 'NG' : (totals.OK > 0 ? 'OK' : 'NA');

    appendObject(SHEET_NAMES.AUDIT_SESSIONS, {
      AuditID: auditId, PeriodMonth: periodMonth, AuditDate: auditDate,
      LineID: payload.lineId, StationID: payload.stationId, AuditLayer: payload.auditLayer,
      AuditorUserID: currentUser.UserID, AuditorName: currentUser.FullName,
      Shift: payload.shift || '', TotalCheck: payload.records.length, TotalOK: totals.OK,
      TotalNG: totals.NG, TotalNA: totals.NA, ResultSummary: resultSummary, NGRate: ngRate,
      Remark: payload.remark || '', Status: payload.status || 'Completed',
      CreatedAt: timestamp, CreatedBy: currentUser.UserID, UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
    });

    var findingIds = [];
    payload.records.forEach(function (record) {
      var checklist = findById_(SHEET_NAMES.CHECKLIST, 'ChecklistID', record.checklistId) || {};
      var auditRecordId = generateId('AR', SHEET_NAMES.AUDIT_RECORDS, 'AuditRecordID', periodMonth);
      var auditRecord = {
        AuditRecordID: auditRecordId, AuditID: auditId, ChecklistID: record.checklistId,
        Category: record.category || checklist.Category || '', Question: record.question || checklist.Question || '',
        Result: cleanString_(record.result).toUpperCase(), Comment: record.comment || '',
        BeforePhotoURL: record.beforePhotoUrl || record.BeforePhotoURL || '', EvidenceURL: record.evidenceUrl || record.EvidenceURL || '',
        FindingID: '', CreatedAt: timestamp, CreatedBy: currentUser.UserID, UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
      };
      appendObject(SHEET_NAMES.AUDIT_RECORDS, auditRecord);

      if (auditRecord.Result === 'NG') {
        var findingId = generateId('F', SHEET_NAMES.FINDINGS, 'FindingID', periodMonth);
        var defaultDays = toNumber_(getSetting('DEFAULT_DUE_DAYS')) || 7;
        var dueDate = record.dueDate ? formatDateBangkok_(record.dueDate) : addDays_(parseDate_(auditDate) || now, defaultDays);
        var pic = record.pic || '';
        var picUserId = record.picUserId || '';
        appendObject(SHEET_NAMES.FINDINGS, {
          FindingID: findingId, PeriodMonth: periodMonth, AuditID: auditId, AuditRecordID: auditRecordId,
          ChecklistID: record.checklistId, LineID: payload.lineId, StationID: payload.stationId,
          AuditLayer: payload.auditLayer, Category: auditRecord.Category,
          FindingDetail: record.findingDetail || record.comment || auditRecord.Question,
          BeforePhotoURL: auditRecord.BeforePhotoURL, CorrectiveAction: record.correctiveAction || '',
          RootCause: record.rootCause || '', PIC: pic, PICUserID: picUserId, DueDate: dueDate,
          Status: record.findingStatus || 'Open', AfterPhotoURL: '', CloseRemark: '', ClosedDate: '', ClosedBy: '',
          OverdueFlag: 'No', DaysOverdue: 0, CreatedAt: timestamp, CreatedBy: currentUser.UserID,
          UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
        });
        updateObjectById(SHEET_NAMES.AUDIT_RECORDS, 'AuditRecordID', auditRecordId, { FindingID: findingId });
        findingIds.push(findingId);
      }
    });

    return jsonResponse(true, 'Audit saved successfully.', { AuditID: auditId, FindingIDs: findingIds });
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
        (!payload.status || valuesEqual_(row.Status, payload.status));
    });
    if (currentUser.Role === 'User') rows = rows.filter(function (row) { return valuesEqual_(row.AuditorUserID, currentUser.UserID); });
    rows.sort(function (a, b) { return cleanString_(b.AuditDate).localeCompare(cleanString_(a.AuditDate)); });
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
