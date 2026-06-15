/** Admin-managed values stored in DO_NOT_DELETE_Lists. */
function getMasterLists(payload, currentUser) {
  try {
    if (!isAdmin_(currentUser)) throw new Error('เฉพาะ Admin เท่านั้นที่จัดการ Master List ได้');
    var listType = cleanString_(payload.listType);
    var rows = getRowsAsObjects(SHEET_NAMES.LISTS).filter(function (row) {
      return !listType || valuesEqual_(row.ListType, listType);
    }).sort(function (a, b) {
      return cleanString_(a.ListType).localeCompare(cleanString_(b.ListType)) ||
        toNumber_(a.SortOrder) - toNumber_(b.SortOrder);
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
    upsertCompositeRow_(SHEET_NAMES.LISTS, { ListType: listType, ListValue: listValue }, {
      ListType: listType,
      ListValue: listValue,
      DisplayText: cleanString_(payload.displayText),
      SortOrder: toNumber_(payload.sortOrder),
      ActiveStatus: activeStatus
    });
    incrementMasterDataVersion_();
    return jsonResponse(true, 'Master list saved.', {
      list: { ListType: listType, ListValue: listValue, DisplayText: cleanString_(payload.displayText),
        SortOrder: toNumber_(payload.sortOrder), ActiveStatus: activeStatus }
    });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}
