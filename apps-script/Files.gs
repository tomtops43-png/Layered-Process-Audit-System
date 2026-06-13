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
    if (['Leader', 'User'].indexOf(currentUser.Role) !== -1 && valuesEqual_(payload.relatedType, 'Finding')) {
      var relatedFinding = findById_(SHEET_NAMES.FINDINGS, 'FindingID', payload.relatedId);
      if (!relatedFinding || !canAccessFinding_(currentUser, relatedFinding)) return jsonResponse(false, 'You can upload only to findings assigned to you.', {});
    }

    var folderId = cleanString_(getSetting(folderSettings[fileType]));
    if (!folderId) throw new Error(folderSettings[fileType] + ' is not configured in Settings.');
    var bytes;
    try { bytes = Utilities.base64Decode(String(payload.base64Data)); }
    catch (decodeError) { throw new Error('base64Data is invalid.'); }
    if (!bytes.length) throw new Error('Uploaded file is empty.');
    var maximumBytes = 10 * 1024 * 1024;
    if (bytes.length > maximumBytes) throw new Error('File exceeds the 10 MB upload limit.');

    var safeName = sanitizeFileName_(payload.fileName);
    var blob = Utilities.newBlob(bytes, cleanString_(payload.mimeType), safeName);
    var file = DriveApp.getFolderById(folderId).createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
    catch (sharingError) { console.warn('Drive sharing could not be changed: ' + sharingError.message); }

    var timestamp = formatDateTimeBangkok(new Date());
    var periodMonth = getPeriodMonth(new Date());
    var attachmentId = generateId('ATT', SHEET_NAMES.ATTACHMENTS, 'AttachmentID', periodMonth);
    var fileUrl = file.getUrl();
    appendObject(SHEET_NAMES.ATTACHMENTS, {
      AttachmentID: attachmentId, RelatedType: payload.relatedType, RelatedID: payload.relatedId,
      FileType: fileType, FileName: safeName, MimeType: payload.mimeType,
      DriveFileID: file.getId(), DriveFileURL: fileUrl, FolderID: folderId,
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

function sanitizeFileName_(fileName) {
  var name = cleanString_(fileName).replace(/[\\/:*?"<>|\x00-\x1F]/g, '_');
  if (!name) name = 'upload-' + new Date().getTime();
  return name.slice(0, 180);
}
