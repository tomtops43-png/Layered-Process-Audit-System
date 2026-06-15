/** Monthly report and CSV export APIs. */
function getMonthlyReport(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'reports.view');
    requireFields_(payload, ['periodMonth']);
    var period = normalizeFindingPeriod_(payload.periodMonth);
    if (!period) throw new Error('periodMonth must use YYYY-MM or YYYYMM format.');
    var audits = getRowsAsObjects(SHEET_NAMES.AUDIT_SESSIONS).filter(function (row) { return valuesEqual_(row.PeriodMonth, period); });
    if (!hasPermission_(currentUser, 'audit.view.all')) {
      audits = audits.filter(function (row) {
        return canAccessLine_(currentUser, row.LineID, 'View') || valuesEqual_(row.AuditorUserID, currentUser.UserID);
      });
    }
    var auditIds = {};
    audits.forEach(function (row) { auditIds[row.AuditID] = true; });
    var records = getRowsAsObjects(SHEET_NAMES.AUDIT_RECORDS).filter(function (row) { return Boolean(auditIds[row.AuditID]); });
    var findings = getRowsAsObjects(SHEET_NAMES.FINDINGS).filter(function (row) {
      return normalizeFindingPeriod_(row.PeriodMonth || row.FoundDate) === period && canViewFindingRbac_(currentUser, row);
    }).map(refreshOverdueForRead_);
    var reportNow = new Date();
    var allAuditSessions = getRowsAsObjects(SHEET_NAMES.AUDIT_SESSIONS);
    var plans = getRowsAsObjects(SHEET_NAMES.AUDIT_PLAN).map(function (row) {
      return effectiveAuditPlan_(row, allAuditSessions, reportNow);
    }).filter(function (row) {
      return cleanString_(row.DueDate).slice(0, 7).replace('-', '') === period &&
        canViewAuditPlan_(currentUser, row, false);
    });
    var completedPlans = plans.filter(function (row) { return ['Completed', 'Late Submitted'].indexOf(cleanString_(row.Status)) !== -1; });
    var planByRole = {};
    var planByLine = {};
    plans.forEach(function (row) {
      var role = cleanString_(row.RequiredRole) || 'Unassigned';
      var lineKey = cleanString_(row.LineID) || 'Unassigned';
      if (!planByRole[role]) planByRole[role] = { Role: role, Planned: 0, Completed: 0, LateSubmitted: 0, Missed: 0 };
      if (!planByLine[lineKey]) planByLine[lineKey] = { LineID: lineKey, LineName: row.LineName || '', Planned: 0, Completed: 0, LateSubmitted: 0, Missed: 0 };
      [planByRole[role], planByLine[lineKey]].forEach(function (group) {
        group.Planned++;
        if (['Completed', 'Late Submitted'].indexOf(cleanString_(row.Status)) !== -1) group.Completed++;
        if (valuesEqual_(row.Status, 'Late Submitted')) group.LateSubmitted++;
        if (valuesEqual_(row.Status, 'Missed')) group.Missed++;
      });
    });

    var categorySummary = groupReport_(records, 'Category');
    var lineSummary = {};
    audits.forEach(function (row) {
      var key = cleanString_(row.LineID) || 'Unassigned';
      if (!lineSummary[key]) lineSummary[key] = { LineID: key, LineName: cleanString_(row.LineName), TotalAudit: 0, TotalOK: 0, TotalNG: 0, TotalNA: 0 };
      if (!lineSummary[key].LineName) lineSummary[key].LineName = cleanString_(row.LineName);
      lineSummary[key].TotalAudit++; lineSummary[key].TotalOK += toNumber_(row.TotalOK);
      lineSummary[key].TotalNG += toNumber_(row.TotalNG); lineSummary[key].TotalNA += toNumber_(row.TotalNA);
    });
    var totalOk = records.filter(function (row) { return valuesEqual_(row.Result, 'OK'); }).length;
    var totalNg = records.filter(function (row) { return valuesEqual_(row.Result, 'NG'); }).length;
    var totalNa = records.filter(function (row) { return ['na', 'n/a'].indexOf(cleanString_(row.Result).toLowerCase()) !== -1; }).length;
    var checked = totalOk + totalNg;
    var topFinding = findings.slice().sort(function (a, b) { return toNumber_(b.DaysOverdue) - toNumber_(a.DaysOverdue); }).slice(0, 10).map(sanitizeForClient_);
    var actionPlan = findings.filter(function (row) { return !isClosedStatus_(row.Status); }).sort(function (a, b) { return cleanString_(a.DueDate).localeCompare(cleanString_(b.DueDate)); }).map(sanitizeForClient_);

    return jsonResponse(true, 'Monthly report loaded.', {
      Period: period, TotalAudit: audits.length, TotalOK: totalOk, TotalNG: totalNg, TotalNA: totalNa,
      NGRate: checked ? Number((totalNg * 100 / checked).toFixed(2)) : 0,
      OpenFinding: findings.filter(function (row) { return !isClosedStatus_(row.Status); }).length,
      ClosedFinding: findings.filter(function (row) { return isClosedStatus_(row.Status); }).length,
      OverdueAction: findings.filter(function (row) { return valuesEqual_(row.OverdueFlag, 'Yes'); }).length,
      PlannedAuditCount: plans.length, CompletedAuditCount: completedPlans.length,
      CompletionRate: plans.length ? Number((completedPlans.length * 100 / plans.length).toFixed(2)) : 0,
      OverdueAuditCount: plans.filter(function (row) { return valuesEqual_(row.Status, 'Overdue'); }).length,
      MissedAuditCount: plans.filter(function (row) { return valuesEqual_(row.Status, 'Missed'); }).length,
      LateSubmittedCount: plans.filter(function (row) { return valuesEqual_(row.Status, 'Late Submitted'); }).length,
      AuditPlanByRole: Object.keys(planByRole).sort().map(function (key) { return planByRole[key]; }),
      AuditPlanByLine: Object.keys(planByLine).sort().map(function (key) { return planByLine[key]; }),
      SummaryByCategory: categorySummary,
      SummaryByLine: Object.keys(lineSummary).sort().map(function (key) { return lineSummary[key]; }),
      TopFinding: topFinding, ActionPlanList: actionPlan
    });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function exportReportCsv(payload, currentUser) {
  try {
    requirePermission_(currentUser, 'reports.export');
    requireFields_(payload, ['periodMonth']);
    var period = normalizeFindingPeriod_(payload.periodMonth);
    if (!period) throw new Error('periodMonth must use YYYY-MM or YYYYMM format.');
    var findings = getRowsAsObjects(SHEET_NAMES.FINDINGS).filter(function (row) {
      return normalizeFindingPeriod_(row.PeriodMonth || row.FoundDate) === period && canViewFindingRbac_(currentUser, row);
    }).map(refreshOverdueForRead_);
    var headers = ['FindingID', 'AuditID', 'RecordID', 'FoundDate', 'LineID', 'LineName', 'StationID', 'StationName', 'Area', 'Category', 'ProblemDetail', 'StandardCriteria', 'CorrectiveAction', 'RootCause', 'PICUserID', 'PICName', 'DueDate', 'Status', 'Priority', 'OverdueFlag', 'DaysOverdue', 'ClosedDate', 'ClosedBy', 'CloseRemark'];
    var csvRows = [headers].concat(findings.map(function (row) { return headers.map(function (header) { return row[header] === undefined ? '' : row[header]; }); }));
    var csv = '\uFEFF' + csvRows.map(function (row) { return row.map(csvEscape_).join(','); }).join('\r\n');
    logReportExport_(period, currentUser, findings);
    return jsonResponse(true, 'CSV report generated.', { Period: period, FileName: 'LPA_Report_' + period + '.csv', MimeType: 'text/csv', Csv: csv });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function groupReport_(records, field) {
  var groups = {};
  records.forEach(function (row) {
    var key = cleanString_(row[field]) || 'Uncategorized';
    if (!groups[key]) groups[key] = { Category: key, Total: 0, OK: 0, NG: 0, NA: 0 };
    groups[key].Total++;
    var result = cleanString_(row.Result).toUpperCase();
    if (result === 'N/A') result = 'NA';
    if (Object.prototype.hasOwnProperty.call(groups[key], result)) groups[key][result]++;
  });
  return Object.keys(groups).sort().map(function (key) { return groups[key]; });
}

function csvEscape_(value) {
  var text = value === null || value === undefined ? '' : String(value);
  return '"' + text.replace(/"/g, '""') + '"';
}

function logReportExport_(period, currentUser, findings) {
  var reportId = 'RPT-' + period;
  if (findById_(SHEET_NAMES.REPORT_LOGS, 'ReportID', reportId)) return;
  var audits = getRowsAsObjects(SHEET_NAMES.AUDIT_SESSIONS).filter(function (row) { return valuesEqual_(row.PeriodMonth, period); });
  var totalOk = audits.reduce(function (sum, row) { return sum + toNumber_(row.TotalOK); }, 0);
  var totalNg = audits.reduce(function (sum, row) { return sum + toNumber_(row.TotalNG); }, 0);
  var checked = totalOk + totalNg;
  appendObject(SHEET_NAMES.REPORT_LOGS, {
    ReportID: reportId, PeriodMonth: period, ReportTitle: 'LPA Monthly Report ' + period,
    TotalAudit: audits.length, TotalOK: totalOk, TotalNG: totalNg,
    NGRate: checked ? Number((totalNg * 100 / checked).toFixed(2)) : 0,
    OpenFinding: findings.filter(function (row) { return !isClosedStatus_(row.Status); }).length,
    ClosedFinding: findings.filter(function (row) { return isClosedStatus_(row.Status); }).length,
    OverdueAction: findings.filter(function (row) { return valuesEqual_(row.OverdueFlag, 'Yes'); }).length,
    ReportFileURL: '', GeneratedBy: currentUser.UserID, GeneratedAt: formatDateTimeBangkok(new Date()),
    SentTo: '', Remark: 'CSV generated through exportReportCsv'
  });
}
