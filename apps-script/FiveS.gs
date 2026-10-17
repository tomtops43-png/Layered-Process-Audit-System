/** Daily 5S checkpoint assignments and photo-backed inspection records. */
function ensureFiveSSheets_() {
  [SHEET_NAMES.FIVE_S_CHECKPOINTS, SHEET_NAMES.FIVE_S_INSPECTIONS].forEach(function (name) {
    var sheet = getSpreadsheet_().getSheetByName(name);
    if (!sheet) {
      sheet = getSpreadsheet_().insertSheet(name);
      sheet.getRange(1, 1, 1, SHEET_HEADERS[name].length).setValues([SHEET_HEADERS[name]]);
      _SHEET_HANDLE_MEMO_[name] = sheet;
      invalidateSheetMatrixCache_(name);
      return;
    }
    var headers = getHeaders_(sheet);
    if (!headers.length) {
      sheet.getRange(1, 1, 1, SHEET_HEADERS[name].length).setValues([SHEET_HEADERS[name]]);
      invalidateSheetMatrixCache_(name);
    }
    _SHEET_HANDLE_MEMO_[name] = sheet;
  });
}

function fiveSToday_() {
  return Utilities.formatDate(new Date(), APP_TIMEZONE, 'yyyy-MM-dd');
}

function fiveSDate_(value) {
  var date = cleanString_(value) || fiveSToday_();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('กรุณาเลือกวันที่ให้ถูกต้อง');
  return date;
}

function fiveSActiveShifts_() {
  return getRowsAsObjects(SHEET_NAMES.LISTS).filter(function (row) {
    return valuesEqual_(row.ListType, 'Shift') && isActive_(row.ActiveStatus);
  }).sort(compareMasterListRows_).map(function (row) {
    return { value: cleanString_(row.ListValue), label: cleanString_(row.DisplayText || row.ListValue) };
  });
}

function fiveSLeaderUsers_() {
  return getRowsAsObjects(SHEET_NAMES.USERS).filter(function (row) {
    return valuesEqual_(row.Role, 'Leader') && isActive_(row.ActiveStatus);
  }).map(function (row) {
    return { UserID: cleanString_(row.UserID), FullName: cleanString_(row.FullName), Username: cleanString_(row.Username) };
  }).sort(function (a, b) { return a.FullName.localeCompare(b.FullName); });
}

function fiveSCheckpointById_(checkpointId) {
  return getRowsAsObjects(SHEET_NAMES.FIVE_S_CHECKPOINTS).filter(function (row) {
    return valuesEqual_(row.CheckpointID, checkpointId);
  })[0] || null;
}

function fiveSInspectionId_(date, checkpointId) {
  return date + '|' + cleanString_(checkpointId);
}

function fiveSCanViewAll_(user) {
  return isAdmin_(user) || hasPermission_(user, 'fiveS.view.all') || hasPermission_(user, 'fiveS.manage');
}

function fiveSCanManageCheckpoints_(user) {
  return hasPermission_(user, 'fiveS.manage') || hasPermission_(user, 'fiveS.checkpoint.manage');
}

function getFiveSSetupData(payload, currentUser) {
  try {
    if (!fiveSCanManageCheckpoints_(currentUser)) throw new Error('คุณไม่มีสิทธิจัดการจุดตรวจ 5.ส');
    ensureFiveSSheets_();
    return jsonResponse(true, 'โหลดข้อมูลตั้งค่าจุดตรวจ 5.ส แล้ว', {
      shifts: fiveSActiveShifts_(), leaders: fiveSLeaderUsers_(),
      checkpoints: getRowsAsObjects(SHEET_NAMES.FIVE_S_CHECKPOINTS).sort(function (a, b) {
        return toNumber_(a.SortOrder) - toNumber_(b.SortOrder) || cleanString_(a.CheckpointName).localeCompare(cleanString_(b.CheckpointName));
      })
    });
  } catch (error) { return jsonResponse(false, safeErrorMessage_(error), {}); }
}

function getFiveSBoard(payload, currentUser) {
  try {
    if (!hasPermission_(currentUser, 'fiveS.audit') && !hasPermission_(currentUser, 'fiveS.view.all') && !fiveSCanManageCheckpoints_(currentUser)) {
      throw new Error('คุณไม่มีสิทธิ์ดูรายการตรวจ 5.ส');
    }
    ensureFiveSSheets_();
    var date = fiveSDate_(payload && payload.inspectionDate);
    var shift = cleanString_(payload && payload.shift);
    var canViewAll = fiveSCanViewAll_(currentUser);
    var inspections = getRowsAsObjects(SHEET_NAMES.FIVE_S_INSPECTIONS).filter(function (row) {
      return valuesEqual_(dateOnly_(row.InspectionDate), date);
    });
    var latestByCheckpoint = {};
    inspections.forEach(function (row) { latestByCheckpoint[cleanString_(row.CheckpointID)] = row; });
    var checkpoints = getRowsAsObjects(SHEET_NAMES.FIVE_S_CHECKPOINTS).filter(function (row) {
      if (!isActive_(row.ActiveStatus)) return false;
      if (shift && !valuesEqual_(row.Shift, shift)) return false;
      if (canViewAll) return true;
      return valuesEqual_(row.LeaderUserID, currentUser.UserID);
    }).sort(function (a, b) {
      return cleanString_(a.Shift).localeCompare(cleanString_(b.Shift)) ||
        toNumber_(a.SortOrder) - toNumber_(b.SortOrder) || cleanString_(a.CheckpointName).localeCompare(cleanString_(b.CheckpointName));
    }).map(function (row) {
      var inspection = latestByCheckpoint[cleanString_(row.CheckpointID)] || null;
      return {
        CheckpointID: cleanString_(row.CheckpointID), Category: cleanString_(row.Category),
        CheckpointName: cleanString_(row.CheckpointName), Area: cleanString_(row.Area),
        StandardText: cleanString_(row.StandardText), Shift: cleanString_(row.Shift),
        LeaderUserID: cleanString_(row.LeaderUserID), LeaderName: cleanString_(row.LeaderName),
        Inspection: inspection ? {
          InspectionDate: date, Result: cleanString_(inspection.Result), Remark: cleanString_(inspection.Remark),
          PhotoURL: cleanString_(inspection.PhotoURL), SubmittedAt: cleanString_(inspection.SubmittedAt),
          InspectorName: cleanString_(inspection.LeaderName)
        } : null
      };
    });
    var shifts = fiveSActiveShifts_();
    var summary = shifts.map(function (item) {
      var assigned = checkpoints.filter(function (row) { return valuesEqual_(row.Shift, item.value); });
      return {
        shift: item.value, label: item.label, total: assigned.length,
        submitted: assigned.filter(function (row) { return Boolean(row.Inspection); }).length
      };
    }).filter(function (item) { return !shift || valuesEqual_(item.shift, shift); });
    return jsonResponse(true, 'โหลดรายการตรวจ 5.ส แล้ว', {
      inspectionDate: date, today: fiveSToday_(), shift: shift,
      canManage: fiveSCanManageCheckpoints_(currentUser), canViewAll: canViewAll,
      canInspect: hasPermission_(currentUser, 'fiveS.audit'), shifts: shifts,
      checkpoints: checkpoints, summary: summary
    });
  } catch (error) { return jsonResponse(false, safeErrorMessage_(error), {}); }
}

function saveFiveSCheckpoint(payload, currentUser) {
  try {
    if (!fiveSCanManageCheckpoints_(currentUser)) throw new Error('คุณไม่มีสิทธิจัดการจุดตรวจ 5.ส');
    ensureFiveSSheets_();
    requireFields_(payload, ['category', 'checkpointName', 'area', 'standardText', 'shift', 'leaderUserId']);
    var category = cleanString_(payload.category);
    var allowedCategories = ['สะสาง (Seiri)', 'สะดวก (Seiton)', 'สะอาด (Seiso)', 'มาตรฐาน (Seiketsu)', 'สร้างนิสัย (Shitsuke)'];
    if (allowedCategories.indexOf(category) === -1) throw new Error('กรุณาเลือกหัวข้อ 5.ส ให้ถูกต้อง');
    var checkpointName = cleanString_(payload.checkpointName);
    var area = cleanString_(payload.area);
    var standardText = cleanString_(payload.standardText);
    if (!checkpointName || checkpointName.length > 120) throw new Error('ชื่อจุดตรวจต้องมีความยาวไม่เกิน 120 ตัวอักษร');
    if (!area || area.length > 120) throw new Error('กรุณาระบุพื้นที่ของจุดตรวจ');
    if (!standardText || standardText.length > 1000) throw new Error('กรุณาระบุมาตรฐานการตรวจ (ไม่เกิน 1,000 ตัวอักษร)');
    var shift = fiveSActiveShifts_().filter(function (row) { return valuesEqual_(row.value, payload.shift); })[0];
    if (!shift) throw new Error('กะนี้ไม่มีใน Master List หรือถูกปิดใช้งาน');
    var leader = fiveSLeaderUsers_().filter(function (row) { return valuesEqual_(row.UserID, payload.leaderUserId); })[0];
    if (!leader) throw new Error('กรุณาเลือก Leader ที่เปิดใช้งาน');
    var activeStatus = isActive_(payload.activeStatus || 'Active') ? 'Active' : 'Inactive';
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    var result;
    try {
      var timestamp = formatDateTimeBangkok(new Date());
      var checkpointId = cleanString_(payload.checkpointId);
      var existing = checkpointId ? fiveSCheckpointById_(checkpointId) : null;
      if (checkpointId && !existing) throw new Error('ไม่พบจุดตรวจ 5.ส ที่ต้องการแก้ไข');
      var sortOrder = existing ? toNumber_(existing.SortOrder) : getRowsAsObjects(SHEET_NAMES.FIVE_S_CHECKPOINTS).reduce(function (max, row) {
        return Math.max(max, toNumber_(row.SortOrder));
      }, 0) + 1;
      var row = {
        CheckpointID: checkpointId || generateIdWithoutLock_('FSC', SHEET_NAMES.FIVE_S_CHECKPOINTS, 'CheckpointID', getPeriodMonth(new Date())),
        Category: category, CheckpointName: checkpointName, Area: area, StandardText: standardText,
        Shift: shift.value, LeaderUserID: leader.UserID, LeaderName: leader.FullName,
        ActiveStatus: activeStatus, SortOrder: sortOrder,
        CreatedAt: existing ? existing.CreatedAt : timestamp,
        CreatedBy: existing ? existing.CreatedBy : currentUser.UserID,
        UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
      };
      if (existing) updateObjectById(SHEET_NAMES.FIVE_S_CHECKPOINTS, 'CheckpointID', checkpointId, row);
      else appendObject(SHEET_NAMES.FIVE_S_CHECKPOINTS, row);
      result = row;
    } finally { lock.releaseLock(); }
    return jsonResponse(true, 'บันทึกจุดตรวจ 5.ส แล้ว', { checkpoint: result });
  } catch (error) { return jsonResponse(false, safeErrorMessage_(error), {}); }
}

function fiveSValidatePhotoUpload_(relatedId, currentUser) {
  ensureFiveSSheets_();
  var parts = cleanString_(relatedId).split('|');
  if (parts.length !== 2 || parts[0] !== fiveSToday_()) throw new Error('รูปตรวจ 5.ส ต้องเป็นของวันที่วันนี้');
  var checkpoint = fiveSCheckpointById_(parts[1]);
  if (!checkpoint || !isActive_(checkpoint.ActiveStatus) || !valuesEqual_(checkpoint.LeaderUserID, currentUser.UserID)) {
    throw new Error('คุณไม่ได้รับมอบหมายให้ตรวจจุดนี้');
  }
  return checkpoint;
}

function submitFiveSInspection(payload, currentUser) {
  try {
    if (!hasPermission_(currentUser, 'fiveS.audit')) throw new Error('เฉพาะ Leader ที่ได้รับมอบหมายเท่านั้นที่บันทึกผลตรวจได้');
    ensureFiveSSheets_();
    requireFields_(payload, ['checkpointId', 'result', 'photoUrl']);
    var date = fiveSDate_(payload.inspectionDate);
    if (date !== fiveSToday_()) throw new Error('บันทึกผลตรวจได้เฉพาะรายการของวันนี้');
    var checkpoint = fiveSCheckpointById_(payload.checkpointId);
    if (!checkpoint || !isActive_(checkpoint.ActiveStatus)) throw new Error('ไม่พบจุดตรวจที่เปิดใช้งาน');
    if (!valuesEqual_(checkpoint.LeaderUserID, currentUser.UserID)) throw new Error('คุณไม่ได้รับมอบหมายให้ตรวจจุดนี้');
    var result = cleanString_(payload.result);
    if (['Pass', 'NeedAction'].indexOf(result) === -1) throw new Error('กรุณาเลือกผลตรวจ');
    var remark = cleanString_(payload.remark);
    if (result === 'NeedAction' && !remark) throw new Error('กรุณาระบุสิ่งที่ต้องแก้ไขเมื่อผลเป็นต้องปรับปรุง');
    if (remark.length > 1000) throw new Error('หมายเหตุต้องไม่เกิน 1,000 ตัวอักษร');
    var relatedId = fiveSInspectionId_(date, checkpoint.CheckpointID);
    var photoUrl = cleanString_(payload.photoUrl);
    var attachment = getRowsAsObjects(SHEET_NAMES.ATTACHMENTS).filter(function (row) {
      return valuesEqual_(row.RelatedType, 'FiveSInspection') && valuesEqual_(row.RelatedID, relatedId) &&
        valuesEqual_(row.FileType, 'Evidence') && valuesEqual_(row.UploadedBy, currentUser.UserID) &&
        cleanString_(row.DriveFileURL) === photoUrl;
    })[0];
    if (!attachment) throw new Error('กรุณาถ่ายและอัปโหลดรูปของจุดตรวจนี้ก่อนบันทึก');
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      var timestamp = formatDateTimeBangkok(new Date());
      var inspectionId = relatedId;
      var existing = getRowsAsObjects(SHEET_NAMES.FIVE_S_INSPECTIONS).filter(function (row) {
        return valuesEqual_(row.InspectionID, inspectionId);
      })[0];
      var row = {
        InspectionID: inspectionId, InspectionDate: date, CheckpointID: checkpoint.CheckpointID,
        CheckpointName: checkpoint.CheckpointName, Category: checkpoint.Category, Area: checkpoint.Area,
        Shift: checkpoint.Shift, LeaderUserID: currentUser.UserID,
        LeaderName: cleanString_(currentUser.FullName) || cleanString_(checkpoint.LeaderName),
        Result: result, Remark: remark, PhotoURL: photoUrl, AttachmentID: attachment.AttachmentID,
        SubmittedAt: timestamp, CreatedAt: existing ? existing.CreatedAt : timestamp,
        CreatedBy: existing ? existing.CreatedBy : currentUser.UserID,
        UpdatedAt: timestamp, UpdatedBy: currentUser.UserID
      };
      if (existing) updateObjectById(SHEET_NAMES.FIVE_S_INSPECTIONS, 'InspectionID', inspectionId, row);
      else appendObject(SHEET_NAMES.FIVE_S_INSPECTIONS, row);
    } finally { lock.releaseLock(); }
    return jsonResponse(true, 'บันทึกผลตรวจ 5.ส พร้อมรูปแล้ว', { inspectionId: relatedId, photoUrl: photoUrl, submittedAt: formatDateTimeBangkok(new Date()) });
  } catch (error) { return jsonResponse(false, safeErrorMessage_(error), {}); }
}
