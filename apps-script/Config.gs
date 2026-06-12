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
SHEET_HEADERS[SHEET_NAMES.LINES] = ['LineID', 'LineName', 'Description', 'ActiveStatus', 'SortOrder', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'];
SHEET_HEADERS[SHEET_NAMES.STATIONS] = ['StationID', 'LineID', 'StationName', 'Description', 'ActiveStatus', 'SortOrder', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'];
SHEET_HEADERS[SHEET_NAMES.CHECKLIST] = ['ChecklistID', 'LineID', 'StationID', 'AuditLayer', 'Category', 'Question', 'Requirement', 'Guidance', 'ActiveStatus', 'SortOrder', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'];
SHEET_HEADERS[SHEET_NAMES.AUDIT_SESSIONS] = ['AuditID', 'PeriodMonth', 'AuditDate', 'LineID', 'StationID', 'AuditLayer', 'AuditorUserID', 'AuditorName', 'Shift', 'TotalCheck', 'TotalOK', 'TotalNG', 'TotalNA', 'ResultSummary', 'NGRate', 'Remark', 'Status', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'];
SHEET_HEADERS[SHEET_NAMES.AUDIT_RECORDS] = ['AuditRecordID', 'AuditID', 'ChecklistID', 'Category', 'Question', 'Result', 'Comment', 'BeforePhotoURL', 'EvidenceURL', 'FindingID', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'];
SHEET_HEADERS[SHEET_NAMES.FINDINGS] = ['FindingID', 'PeriodMonth', 'AuditID', 'AuditRecordID', 'ChecklistID', 'LineID', 'StationID', 'AuditLayer', 'Category', 'FindingDetail', 'BeforePhotoURL', 'CorrectiveAction', 'RootCause', 'PIC', 'PICUserID', 'DueDate', 'Status', 'AfterPhotoURL', 'CloseRemark', 'ClosedDate', 'ClosedBy', 'OverdueFlag', 'DaysOverdue', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'];
SHEET_HEADERS[SHEET_NAMES.ACTION_LOGS] = ['ActionLogID', 'FindingID', 'ActionType', 'OldStatus', 'NewStatus', 'ChangeDetail', 'Comment', 'CreatedAt', 'CreatedBy'];
SHEET_HEADERS[SHEET_NAMES.ATTACHMENTS] = ['AttachmentID', 'RelatedType', 'RelatedID', 'FileType', 'FileName', 'MimeType', 'DriveFileID', 'DriveFileURL', 'FileSize', 'CreatedAt', 'CreatedBy'];
SHEET_HEADERS[SHEET_NAMES.SETTINGS] = ['SettingKey', 'SettingValue', 'Description', 'UpdatedAt', 'UpdatedBy'];
SHEET_HEADERS[SHEET_NAMES.REPORT_LOGS] = ['ReportID', 'PeriodMonth', 'ReportType', 'DriveFileID', 'DriveFileURL', 'GeneratedAt', 'GeneratedBy'];
SHEET_HEADERS[SHEET_NAMES.AUDIT_PLAN] = ['PlanID', 'PeriodMonth', 'PlanDate', 'LineID', 'StationID', 'AuditLayer', 'AssignedUserID', 'Status', 'Remark', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'];
SHEET_HEADERS[SHEET_NAMES.LISTS] = ['ListType', 'ListValue', 'DisplayText', 'SortOrder', 'ActiveStatus'];

var PUBLIC_ACTIONS = ['login'];
var VALID_ROLES = ['Admin', 'Manager', 'Supervisor', 'Engineer', 'Leader', 'User'];
