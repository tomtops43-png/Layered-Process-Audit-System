/** Google Drive upload API. Base64 content is never persisted to Sheets. */
function uploadFile(payload, currentUser) {
  try {
    requireFields_(payload, ['relatedType', 'relatedId', 'fileType', 'fileName', 'mimeType', 'base64Data']);
    var folderSettings = {
      BeforePhoto: 'BEFORE_PHOTO_FOLDER_ID', AfterPhoto: 'AFTER_PHOTO_FOLDER_ID',
      Evidence: 'EVIDENCE_FOLDER_ID', Report: 'REPORT_FOLDER_ID', Attachment: 'ATTACHMENT_FOLDER_ID'
    };
    var fileType = cleanString_(payload.fileType);
    if (!folderSettings[fileType]) throw new Error('Unsupported fileType: ' + fileType);
    if (valuesEqual_(payload.relatedType, 'TrainingSignedPDF')) {
      if (fileType !== 'Attachment' && fileType !== 'BeforePhoto') throw new Error('PDF ใบเซ็น Training ต้องจัดเก็บเป็นไฟล์แนบเท่านั้น');
      var trainingPostId = cleanString_(payload.relatedId);
      ensureMeetingPostsSheet_();
      var trainingPost = findById_(SHEET_NAMES.MEETING_POSTS, 'PostID', trainingPostId);
      if (!trainingPost || valuesEqual_(trainingPost.Status, 'Deleted') || !isTrainingMeetingPost_(trainingPost)) {
        throw new Error('ไม่พบรายการ Training สำหรับแนบ PDF');
      }
      if (!canEditMeetingPost_(currentUser, trainingPost)) throw new Error('คุณไม่มีสิทธิ์แนบไฟล์ในรายการ Training นี้');
      var mimeType = cleanString_(payload.mimeType).toLowerCase().split(';')[0];
      if (!/\.pdf$/i.test(cleanString_(payload.fileName)) || (mimeType && mimeType !== 'application/pdf' && mimeType !== 'application/octet-stream')) {
        throw new Error('กรุณาเลือกไฟล์ PDF เท่านั้น');
      }
    }
    if (valuesEqual_(payload.relatedType, 'Finding')) {
      var relatedFinding = findById_(SHEET_NAMES.FINDINGS, 'FindingID', payload.relatedId);
      if (!relatedFinding || (!canUpdateFinding_(currentUser, relatedFinding) && !canVerifyFinding_(currentUser, relatedFinding))) {
        return jsonResponse(false, 'You do not have permission to upload to this finding.', {});
      }
    }
    if (valuesEqual_(payload.relatedType, 'FiveSInspection')) {
      if (fileType !== 'Evidence') throw new Error('รูปตรวจ 5.ส ต้องจัดเก็บเป็น Evidence เท่านั้น');
      fiveSValidatePhotoUpload_(payload.relatedId, currentUser);
    }
    if (valuesEqual_(payload.relatedType, 'FiveSCheckpoint')) {
      if (fileType !== 'Evidence') throw new Error('รูปอ้างอิงจุดตรวจ 5.ส ต้องจัดเก็บเป็น Evidence เท่านั้น');
      if (!fiveSCanManageCheckpoints_(currentUser)) throw new Error('คุณไม่มีสิทธิ์จัดการรูปอ้างอิงจุดตรวจ 5.ส');
      if (!fiveSCheckpointById_(payload.relatedId)) throw new Error('ไม่พบจุดตรวจ 5.ส สำหรับแนบรูปอ้างอิง');
    }

    var folderId = cleanString_(getSetting(folderSettings[fileType]));
    if (!folderId) throw new Error(folderSettings[fileType] + ' is not configured in Settings.');
    var bytes;
    try { bytes = Utilities.base64Decode(String(payload.base64Data)); }
    catch (decodeError) { throw new Error('base64Data is invalid.'); }
    if (!bytes.length) throw new Error('Uploaded file is empty.');
    if (valuesEqual_(payload.relatedType, 'TrainingSignedPDF')) {
      var pdfSignature = '';
      for (var signatureIndex = 0; signatureIndex < 5 && signatureIndex < bytes.length; signatureIndex++) {
        pdfSignature += String.fromCharCode((bytes[signatureIndex] + 256) % 256);
      }
      if (pdfSignature !== '%PDF-') throw new Error('ไฟล์ที่เลือกไม่ใช่เอกสาร PDF ที่ถูกต้อง');
    }
    var maximumBytes = 10 * 1024 * 1024;
    if (bytes.length > maximumBytes) throw new Error('File exceeds the 10 MB upload limit.');

    // Build filename: {RelatedID}_{FileType}_{YYYYMMDD_HHMMSS}.{ext}
    var now = new Date();
    var dateTag = Utilities.formatDate(now, APP_TIMEZONE, 'yyyyMMdd_HHmmss');
    var relatedId = cleanString_(payload.relatedId);
    var origExt = sanitizeFileName_(payload.fileName).split('.').pop() || 'jpg';
    var safeName = relatedId + '_' + fileType + '_' + dateTag + '.' + origExt;

    // Upload into subfolder named after RelatedID (create if not exists)
    var parentFolder = DriveApp.getFolderById(folderId);
    var subFolder = getOrCreateDriveSubfolder_(parentFolder, relatedId);

    var blob = Utilities.newBlob(bytes, cleanString_(payload.mimeType), safeName);
    var file = subFolder.createFile(blob);
    // Settings row FILE_LINK_SHARING = 'restricted' keeps uploads private to the
    // Drive folder ACL; anything else (or no row) keeps link sharing so photos
    // render for users without Google accounts.
    var sharingMode = '';
    try { sharingMode = cleanString_(getSetting('FILE_LINK_SHARING')).toLowerCase(); } catch (settingError) { sharingMode = ''; }
    if (sharingMode !== 'restricted') {
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
      catch (sharingError) { console.warn('Drive sharing could not be changed: ' + sharingError.message); }
    }

    var timestamp = formatDateTimeBangkok(now);
    var periodMonth = getPeriodMonth(now);
    var attachmentId = generateId('ATT', SHEET_NAMES.ATTACHMENTS, 'AttachmentID', periodMonth);
    var fileUrl = file.getUrl();
    appendObject(SHEET_NAMES.ATTACHMENTS, {
      AttachmentID: attachmentId, RelatedType: payload.relatedType, RelatedID: relatedId,
      FileType: fileType, FileName: safeName, MimeType: payload.mimeType,
      DriveFileID: file.getId(), DriveFileURL: fileUrl, FolderID: subFolder.getId(),
      UploadedBy: currentUser.UserID, UploadedAt: timestamp, Remark: payload.remark || ''
    });
    return jsonResponse(true, 'File uploaded successfully.', {
      AttachmentID: attachmentId, DriveFileID: file.getId(), DriveFileURL: fileUrl,
      FileName: safeName, MimeType: payload.mimeType, FileSize: bytes.length
    });
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

/** Checkpoint managers can upload a reference photo only to an existing 5S checkpoint. */
function uploadFiveSCheckpointReferencePhoto(payload, currentUser) {
  try {
    if (!fiveSCanManageCheckpoints_(currentUser)) throw new Error('คุณไม่มีสิทธิ์จัดการรูปอ้างอิงจุดตรวจ 5.ส');
    requireFields_(payload, ['checkpointId', 'fileName', 'mimeType', 'base64Data']);
    if (String(payload.mimeType).toLowerCase().indexOf('image/') !== 0) throw new Error('กรุณาเลือกไฟล์รูปภาพ');
    return uploadFile({
      relatedType: 'FiveSCheckpoint', relatedId: cleanString_(payload.checkpointId),
      fileType: 'Evidence', fileName: payload.fileName, mimeType: payload.mimeType,
      base64Data: payload.base64Data, remark: '5S checkpoint reference photo'
    }, currentUser);
  } catch (error) {
    return jsonResponse(false, safeErrorMessage_(error), {});
  }
}

function getOrCreateDriveSubfolder_(parentFolder, folderName) {
  var safe = cleanString_(folderName).replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').slice(0, 100) || 'misc';
  var existing = parentFolder.getFoldersByName(safe);
  if (existing.hasNext()) return existing.next();
  return parentFolder.createFolder(safe);
}

function sanitizeFileName_(fileName) {
  var name = cleanString_(fileName).replace(/[\\/:*?"<>|\x00-\x1F]/g, '_');
  if (!name) name = 'upload-' + new Date().getTime();
  return name.slice(0, 180);
}
