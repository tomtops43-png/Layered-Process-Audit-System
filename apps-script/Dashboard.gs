/** Dashboard KPI and grouped-summary API. */
function getDashboard(payload, currentUser) {
  try {
    var now = new Date();
    var currentPeriod = getPeriodMonth(now);
    var audits = getRowsAsObjects(SHEET_NAMES.AUDIT_SESSIONS);
    var findings = getRowsAsObjects(SHEET_NAMES.FINDINGS).map(refreshOverdueForRead_);
    var allFindings = findings.slice();
    if (payload.lineId) {
      audits = audits.filter(function (row) { return valuesEqual_(row.LineID, payload.lineId); });
      findings = findings.filter(function (row) { return valuesEqual_(row.LineID, payload.lineId); });
    }
    if (['Leader', 'User'].indexOf(currentUser.Role) !== -1) findings = findings.filter(function (row) { return canAccessFinding_(currentUser, row); });

    var categoryNg = {};
    findings.forEach(function (row) { var key = cleanString_(row.Category) || 'Uncategorized'; categoryNg[key] = (categoryNg[key] || 0) + 1; });
    var topCategory = Object.keys(categoryNg).sort(function (a, b) { return categoryNg[b] - categoryNg[a]; })[0] || '';
    var monthly = {};
    audits.forEach(function (row) {
      var key = cleanString_(row.PeriodMonth);
      if (!monthly[key]) monthly[key] = { PeriodMonth: key, TotalAudit: 0, TotalOK: 0, TotalNG: 0, TotalNA: 0 };
      monthly[key].TotalAudit++;
      monthly[key].TotalOK += toNumber_(row.TotalOK); monthly[key].TotalNG += toNumber_(row.TotalNG); monthly[key].TotalNA += toNumber_(row.TotalNA);
    });
    var byLine = {};
    audits.forEach(function (row) {
      var key = cleanString_(row.LineID) || 'Unassigned';
      if (!byLine[key]) byLine[key] = { LineID: key, LineName: cleanString_(row.LineName), TotalAudit: 0, TotalNG: 0, OpenFinding: 0 };
      if (!byLine[key].LineName) byLine[key].LineName = cleanString_(row.LineName);
      byLine[key].TotalAudit++; byLine[key].TotalNG += toNumber_(row.TotalNG);
    });
    findings.forEach(function (row) {
      var key = cleanString_(row.LineID) || 'Unassigned';
      if (!byLine[key]) byLine[key] = { LineID: key, LineName: cleanString_(row.LineName), TotalAudit: 0, TotalNG: 0, OpenFinding: 0 };
      if (!byLine[key].LineName) byLine[key].LineName = cleanString_(row.LineName);
      if (!isClosedStatus_(row.Status)) byLine[key].OpenFinding++;
    });
    var today = parseDate_(formatDateBangkok_(now));
    var nearDue = findings.filter(function (row) {
      if (isClosedStatus_(row.Status)) return false;
      var due = parseDate_(row.DueDate);
      if (!due) return false;
      var days = Math.floor((due.getTime() - today.getTime()) / 86400000);
      return days >= 0 && days <= 7;
    }).sort(function (a, b) { return cleanString_(a.DueDate).localeCompare(cleanString_(b.DueDate)); }).map(sanitizeForClient_);

    return jsonResponse(true, 'Dashboard loaded.', {
      TotalAudit: audits.length,
      AuditThisMonth: audits.filter(function (row) { return valuesEqual_(row.PeriodMonth, currentPeriod); }).length,
      TotalFinding: findings.length,
      OpenFinding: findings.filter(function (row) { return valuesEqual_(row.Status, 'Open'); }).length,
      OnGoingFinding: findings.filter(function (row) { return ['on going', 'ongoing', 'in progress'].indexOf(cleanString_(row.Status).toLowerCase()) !== -1; }).length,
      ClosedFinding: findings.filter(function (row) { return isClosedStatus_(row.Status); }).length,
      OverdueAction: findings.filter(function (row) { return valuesEqual_(row.OverdueFlag, 'Yes'); }).length,
      MyOpenFindings: allFindings.filter(function (row) {
        return isAssignedToUser_(row, currentUser) && !isClosedStatus_(row.Status);
      }).length,
      MyOverdueFindings: allFindings.filter(function (row) {
        return isAssignedToUser_(row, currentUser) && valuesEqual_(row.OverdueFlag, 'Yes');
      }).length,
      PendingMyVerification: allFindings.filter(function (row) {
        return valuesEqual_(row.Status, 'Pending Verification') && canVerifyFinding_(currentUser, row);
      }).length,
      TopNGCategory: topCategory ? { Category: topCategory, Count: categoryNg[topCategory] } : {},
      MonthlyAuditResult: Object.keys(monthly).sort().slice(-12).map(function (key) { return monthly[key]; }),
      SummaryByLine: Object.keys(byLine).sort().map(function (key) { return byLine[key]; }),
      ActionsNearDueDate: nearDue
    });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}
