/**
 * Runtime configuration and database schema for the LPA backend.
 * Set SPREADSHEET_ID in Script Properties before deploying.
 */
var APP_TIMEZONE = 'Asia/Bangkok';
var TOKEN_TTL_SECONDS = 21600; // 6 hours
var TOKEN_PROPERTY_PREFIX = 'LPA_TOKEN_';
var SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';

var SHEET_NAMES = {
  USERS: 'Users',
  LINES: 'Lines',
  STATIONS: 'Stations',
  CHECKLIST: 'ChecklistMaster',
  AUDIT_SESSIONS: 'AuditSessions',
  AUDIT_RECORDS: 'AuditRecords',
  FINDINGS: 'Findings',
  ACTION_LOGS: 'ActionLogs',
  ATTACHMENTS: 'Attachments',
  SETTINGS: 'Settings',
  REPORT_LOGS: 'ReportLogs',
  AUDIT_PLAN: 'AuditPlan',
  LISTS: 'DO_NOT_DELETE_Lists'
};

var SHEET_HEADERS = {};
SHEET_HEADERS[SHEET_NAMES.USERS] = ['UserID', 'EmployeeID', 'Username', 'PasswordHash', 'FullName', 'Nickname', 'Role', 'Department', 'LineDefault', 'Email', 'Phone', 'ActiveStatus', 'LastLogin', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'];
SHEET_HEADERS[SHEET_NAMES.LINES] = ['LineID', 'LineName', 'Area', 'Department', 'ActiveStatus', 'SortOrder', 'CreatedAt', 'UpdatedAt'];
SHEET_HEADERS[SHEET_NAMES.STATIONS] = ['StationID', 'LineID', 'LineName', 'StationName', 'StationNo', 'Area', 'ProcessName', 'ActiveStatus', 'SortOrder', 'CreatedAt', 'UpdatedAt'];
SHEET_HEADERS[SHEET_NAMES.CHECKLIST] = ['ChecklistID', 'Category', 'CheckItem', 'StandardCriteria', 'ExampleOK', 'ExampleNG', 'CheckItemTH', 'CheckItemEN', 'StandardCriteriaTH', 'StandardCriteriaEN', 'ExampleOKTH', 'ExampleOKEN', 'ExampleNGTH', 'ExampleNGEN', 'LineID', 'LineName', 'StationID', 'StationName', 'AuditLayer', 'Frequency', 'Severity', 'RequirePhotoWhenNG', 'RequireActionWhenNG', 'ReferenceDocNo', 'Revision', 'EffectiveDate', 'ActiveStatus', 'SortOrder', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'];
SHEET_HEADERS[SHEET_NAMES.AUDIT_SESSIONS] = ['AuditID', 'AuditDate', 'AuditTime', 'PeriodMonth', 'LineID', 'LineName', 'StationID', 'StationName', 'Area', 'Shift', 'AuditorUserID', 'AuditorName', 'AuditorRole', 'AuditLayer', 'TotalCheck', 'TotalOK', 'TotalNG', 'TotalNA', 'ResultSummary', 'NGRate', 'SubmitStatus', 'Remark', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'];
SHEET_HEADERS[SHEET_NAMES.AUDIT_RECORDS] = ['RecordID', 'AuditID', 'AuditDate', 'PeriodMonth', 'LineID', 'LineName', 'StationID', 'StationName', 'Category', 'ChecklistID', 'CheckItemSnapshot', 'StandardCriteriaSnapshot', 'ChecklistRevision', 'Result', 'FindingDetail', 'CorrectiveAction', 'ResponsiblePerson', 'DueDate', 'Status', 'BeforePhotoURL', 'AfterPhotoURL', 'Remark', 'FindingID', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'];
SHEET_HEADERS[SHEET_NAMES.FINDINGS] = ['FindingID', 'AuditID', 'RecordID', 'FoundDate', 'PeriodMonth', 'LineID', 'LineName', 'StationID', 'StationName', 'Area', 'Category', 'ProblemDetail', 'StandardCriteria', 'CorrectiveAction', 'RootCause', 'PICUserID', 'PICName', 'DueDate', 'Status', 'Priority', 'BeforePhotoURL', 'AfterPhotoURL', 'ClosedDate', 'ClosedBy', 'CloseRemark', 'OverdueFlag', 'DaysOverdue', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'];
SHEET_HEADERS[SHEET_NAMES.ACTION_LOGS] = ['LogID', 'FindingID', 'ActionDate', 'ActionByUserID', 'ActionByName', 'OldStatus', 'NewStatus', 'ActionDetail', 'EvidenceURL', 'Remark', 'CreatedAt'];
SHEET_HEADERS[SHEET_NAMES.ATTACHMENTS] = ['AttachmentID', 'RelatedType', 'RelatedID', 'FileType', 'FileName', 'MimeType', 'DriveFileID', 'DriveFileURL', 'FolderID', 'UploadedBy', 'UploadedAt', 'Remark'];
SHEET_HEADERS[SHEET_NAMES.SETTINGS] = ['SettingKey', 'SettingValue', 'Description', 'UpdatedAt', 'UpdatedBy'];
SHEET_HEADERS[SHEET_NAMES.REPORT_LOGS] = ['ReportID', 'PeriodMonth', 'ReportTitle', 'TotalAudit', 'TotalOK', 'TotalNG', 'NGRate', 'OpenFinding', 'ClosedFinding', 'OverdueAction', 'ReportFileURL', 'GeneratedBy', 'GeneratedAt', 'SentTo', 'Remark'];
SHEET_HEADERS[SHEET_NAMES.AUDIT_PLAN] = ['PlanID', 'PeriodMonth', 'LineID', 'LineName', 'StationID', 'StationName', 'AuditLayer', 'PlannedDate', 'PlannedAuditor', 'ActualAuditID', 'ActualDate', 'PlanStatus', 'Remark', 'CreatedAt', 'UpdatedAt'];
SHEET_HEADERS[SHEET_NAMES.LISTS] = ['ListType', 'ListValue', 'DisplayText', 'SortOrder', 'ActiveStatus'];

var PUBLIC_ACTIONS = ['login'];
var VALID_ROLES = ['Admin', 'Manager', 'Supervisor', 'Engineer', 'Leader', 'User'];
