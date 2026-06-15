/** Admin-managed values stored in DO_NOT_DELETE_Lists. */
function getMasterLists(payload, currentUser) {
  try {
    if (!isAdmin_(currentUser)) throw new Error('เฉพาะ Admin เท่านั้นที่จัดการ Master List ได้');
    var listType = cleanString_(payload.listType);
    var rows = getRowsAsObjects(SHEET_NAMES.LISTS).filter(function (row) {
      return !listType || valuesEqual_(row.ListType, listType);
    }).sort(function (a, b) {
      return cleanString_(a.ListType).localeCompare(cleanString_(b.ListType)) ||
        compareMasterListRows_(a, b);
    });
    return jsonResponse(true, 'Master lists loaded.', { lists: rows.map(sanitizeForClient_) });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function upsertMasterList(payload, currentUser) {
  try {
    if (!isAdmin_(currentUser)) throw new Error('เฉพาะ Admin เท่านั้นที่จัดการ Master List ได้');
    requireFields_(payload, ['listType', 'listValue', 'displayText', 'activeStatus']);
    var listType = cleanString_(payload.listType);
    var listValue = cleanString_(payload.listValue);
    if (!/^[A-Za-z0-9 _-]+$/.test(listValue)) throw new Error('List Value มีอักขระที่ไม่รองรับ');
    var activeStatus = isActive_(payload.activeStatus) ? 'Active' : 'Inactive';
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    var sortOrder;
    try {
      var rows = normalizeMasterListSortOrders_(listType);
      var matchingRows = rows.filter(function (row) { return valuesEqual_(row.ListValue, listValue); });
      var existing = matchingRows[0];
      sortOrder = existing ? toNumber_(existing.SortOrder) : rows.reduce(function (maximum, row) {
        return Math.max(maximum, toNumber_(row.SortOrder));
      }, 0) + 1;
      deactivateDuplicateMasterListRows_(matchingRows.slice(1));
      upsertCompositeRow_(SHEET_NAMES.LISTS, { ListType: listType, ListValue: listValue }, {
        ListType: listType,
        ListValue: existing ? existing.ListValue : listValue,
        DisplayText: cleanString_(payload.displayText),
        SortOrder: sortOrder,
        ActiveStatus: activeStatus
      });
    } finally {
      lock.releaseLock();
    }
    incrementMasterDataVersion_();
    return jsonResponse(true, 'Master list saved.', {
      list: { ListType: listType, ListValue: listValue, DisplayText: cleanString_(payload.displayText),
        SortOrder: sortOrder, ActiveStatus: activeStatus }
    });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function deactivateDuplicateMasterListRows_(rows) {
  if (!rows.length) return;
  var sheet = getSheet(SHEET_NAMES.LISTS);
  var headers = getHeaders_(sheet);
  var activeColumn = headers.indexOf('ActiveStatus') + 1;
  rows.forEach(function (row) {
    sheet.getRange(row._rowNumber, activeColumn).setValue('Inactive');
  });
}

function normalizeMasterListSortOrders_(listType) {
  var rows = getRowsAsObjects(SHEET_NAMES.LISTS).filter(function (row) {
    return valuesEqual_(row.ListType, listType);
  }).sort(function (a, b) {
    return toNumber_(a._rowNumber) - toNumber_(b._rowNumber) ||
      cleanString_(a.ListValue).localeCompare(cleanString_(b.ListValue));
  });
  var used = {};
  var maximum = 0;
  rows.forEach(function (row) {
    var order = Number(row.SortOrder);
    var valid = isFinite(order) && order > 0 && Math.floor(order) === order && !used[order];
    if (valid) {
      used[order] = row._rowNumber;
      maximum = Math.max(maximum, order);
    }
  });
  var sheet = getSheet(SHEET_NAMES.LISTS);
  var headers = getHeaders_(sheet);
  var sortColumn = headers.indexOf('SortOrder') + 1;
  rows.forEach(function (row) {
    var order = Number(row.SortOrder);
    var valid = isFinite(order) && order > 0 && Math.floor(order) === order && used[order] === row._rowNumber;
    if (valid) return;
    while (used[++maximum]) {}
    sheet.getRange(row._rowNumber, sortColumn).setValue(maximum);
    row.SortOrder = maximum;
    used[maximum] = row._rowNumber;
  });
  return rows.sort(compareMasterListRows_);
}
