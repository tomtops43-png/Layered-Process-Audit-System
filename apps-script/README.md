# Layered Process Audit — Google Apps Script Backend

Deployable backend API for the QF8 customer audit-finding closure application. It uses Google Apps Script as the API runtime, Google Sheets as the database, and Google Drive for uploaded files. This directory intentionally contains **no frontend code**.

## Repository files

| File | Responsibility |
| --- | --- |
| `Code.gs` | `doPost(e)` API router and `doGet()` status endpoint |
| `Config.gs` | Constants, sheet names, and required headers |
| `Utils.gs` | Sheet CRUD, IDs, settings, dates, validation, hashing, and JSON responses |
| `Auth.gs` | Login, SHA-256 verification, tokens, roles, and permissions |
| `Users.gs` | Current-user API |
| `MasterData.gs` | Lines, stations, users, lists, settings, and checklist filtering |
| `Audit.gs` | Audit creation, records, automatic findings, and audit list |
| `Findings.gs` | Finding filters, updates, closure, overdue calculation, and action logs |
| `Dashboard.gs` | KPI and dashboard summaries |
| `Reports.gs` | Monthly report and CSV export |
| `Files.gs` | Base64 decoding, Drive upload, sharing, and attachment metadata |
| `Meeting.gs` / `MeetingQuiz.gs` | Meeting board, slide text extraction, and bilingual quizzes |
| `FiveS.gs` | Shift-assigned daily 5S checkpoints, photo validation, and inspection records |
| `Setup.gs` | Non-destructive setup and manual test helpers |

## Installation

1. Create or open the Google Sheet named `LPA_Database`.
2. Open **Extensions → Apps Script**.
3. Create one Apps Script file for each `.gs` file in this directory and copy its contents. Apps Script combines all `.gs` files into one global runtime, so file order is not significant.
4. In **Project Settings → Script Properties**, add:
   - `SPREADSHEET_ID`: ID from the `LPA_Database` spreadsheet URL.
   - Optional `DEFAULT_ADMIN_PASSWORD`: temporary password used only when `createDefaultAdmin()` is called without arguments.
   - `GEMINI_API_KEY`: API key used by Meeting quiz generation; keep it in Script Properties and never put it in frontend files. Quiz generators can set or rotate it from the Meeting quiz admin panel; the stored value is never returned to the browser.
   - Optional `GEMINI_MODEL` (defaults to `gemini-3.8-flash`).
5. For quiz generation from attached files, enable the Advanced Google services for **Drive API** and **Google Slides API** in the Apps Script project. The quiz can also use the Meeting topic and detail text when no slide file is attached.
6. In Apps Script project settings, set the project timezone to **Asia/Bangkok**. The code also explicitly formats business dates in `Asia/Bangkok`.
7. Run `setupRbac()` once from the editor and authorize access. It runs the existing non-destructive header setup, creates the RBAC sheets when missing, and inserts only missing default role permissions; it does not delete existing users or data.
8. Confirm the `Settings` sheet contains these keys and valid values:
   - `APP_NAME`
   - `TIMEZONE` (`Asia/Bangkok`)
   - `SPREADSHEET_ID`
   - `BEFORE_PHOTO_FOLDER_ID`
   - `AFTER_PHOTO_FOLDER_ID`
   - `EVIDENCE_FOLDER_ID`
   - `REPORT_FOLDER_ID`
   - `ATTACHMENT_FOLDER_ID`
   - `DEFAULT_DUE_DAYS`
   - `CUSTOMER_NAME`
   - `COMPANY_NAME`
9. Create an administrator by running `createDefaultAdmin('admin', 'replace-with-a-strong-password')`. Remove any temporary password from Script Properties afterward.
10. Deploy with **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: select the option appropriate for the GitHub Pages client (commonly **Anyone**)
11. Copy the `/exec` deployment URL for the future frontend.

## Request contract

Send all API calls with `POST`. The GitHub Pages client should use `Content-Type: text/plain;charset=utf-8` to keep the request CORS-simple and avoid an OPTIONS preflight.

```javascript
fetch(APPS_SCRIPT_EXEC_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({
    action: 'getDashboard',
    token: loginToken,
    payload: {}
  })
});
```

Request body:

```json
{
  "action": "login",
  "token": "",
  "payload": {}
}
```

Every response has the same envelope:

```json
{
  "success": true,
  "message": "text",
  "data": {}
}
```

HTTP status codes are not used to distinguish API errors because Apps Script `ContentService` has limited response-status control. Always inspect `success`.

## API actions

- Public: `login`
- QR guest: `getMeetingQuiz`, `registerMeetingQuizParticipant`, `submitMeetingQuiz`, and `getMeetingQuizAnswerKey`, only with a valid published-quiz token.
- Protected: `getCurrentUser`, `getMasterData`, `getChecklist`, `saveAudit`, `getAuditList`, `getFindings`, `updateFinding`, `closeFinding`, `uploadFile`, `getDashboard`, `getMonthlyReport`, `exportReportCsv`, quiz management actions, authenticated Meeting quiz access, and daily 5S checkpoint actions.

`Admin` has full access. `Engineer` can generate quizzes and users granted `meeting.quiz.manage` can review, edit, and publish drafts. Employees without accounts can use the published quiz's QR link; authenticated Meeting users can also take the quiz through the board.

## Meeting quiz flow

- On the TV-mode QR Code slide, Admin and Engineer can generate one daily set of five bilingual Thai/Myanmar multiple-choice questions from all non-deleted Meeting topics, details, and extractable slide text for that date. The prompt asks AI to identify the main problem, risk, and preventive action, with emphasis on process errors described in the source. It creates a draft only; authorized quiz managers review/edit and publish it from the Meeting board.
- Each Meeting date has at most one published quiz. Both shifts use the same five questions, while each shift has its own participant list, intake state, and stop state. The source hash covers all topics and slide text for that date; publishing checks that the content has not changed since generation.
- QR participants do not need an account. They type their first and last name. If the name matches an active `MeetingQuizEmployees` row, the server derives the shift from that row; if it is new, the participant must choose an open shift and the server adds the employee to the roster before starting the quiz. Matching names are normalized for Unicode, case, and whitespace, checked while holding the registration lock, and never inserted twice. Duplicate active rows with the same normalized full name count as one employee; the first active row with a valid shift is canonical for registration, shift counts, and ranking. Use `MeetingQuizAttendance` for daily `Leave`, `Sick`, or `Absent` records so those staff are removed from the expected submission count. A manager can stop a shift after all eligible employees submit or are excused; then the top three for that shift become visible. The shared answer key stays locked until every shift is closed and complete.
- On submission, the employee receives their score, their own selected answers, the correct answers for mistakes, and explanations. The shared `getMeetingQuizAnswerKey` action returns only the key and explanations after both shifts are complete.
- To find the QR, open the Meeting board and choose `📱 QR / จัดการข้อสอบ` on that date's card. The management panel shows the QR code after publishing and also provides a copyable link. Employees open that daily quiz directly, without a website account, type their first and last name, and choose the quiz language. Existing names get their shift from the roster; new names are added to the roster with the selected open shift. A manager can stop each completed shift from the TV status slide or quiz panel, then see its top three. The guest link is a long random bearer token scoped to that published quiz; it cannot access meeting posts or other APIs.
- Quiz state is stored in the Google spreadsheet configured by the Apps Script `SPREADSHEET_ID` property (the setup guide names it `LPA_Database`), in `MeetingQuizzes`, `MeetingQuizQuestions`, `MeetingQuizParticipants`, `MeetingQuizAnswers`, `MeetingQuizEmployees`, and `MeetingQuizAttendance`. `MeetingQuizzes.PublicToken` holds the QR link token and per-shift intake/stop state. `MeetingQuizQuestions` holds the daily questions, choices, correct options, and explanations. `MeetingQuizEmployees` is the active employee roster (`EmployeeID`, `FirstName`, `LastName` or `DisplayName`, `Shift`, `ActiveStatus`). `MeetingQuizAttendance` records date-specific absences (`MeetingDate`, `EmployeeID`, `Status`, `Reason`). `MeetingQuizParticipants` records employee ID, name, roster-derived shift, language, submission status, answers, and score; participant answer tokens are stored as hashes. `MeetingQuizAnswers` stores one row per question submitted. A resume token is kept in the employee's browser session storage so they can reopen their own attempt.
- Quiz generation sends the Meeting date, all topics, details, and extracted slide text for that date to the Gemini API. It does not send participant names or answers. Configure `GEMINI_API_KEY` in Script Properties.

## Daily 5S inspections

- Admin or an individually authorized user (`fiveS.checkpoint.manage`) assigns each checkpoint to an active Leader and shift, with a 5S category, area, and inspection standard. Leaders see only checkpoints assigned to their account and submit a Pass or Need Action result with a mandatory photo; a note is also required for Need Action.
- Checkpoint definitions are stored in `FiveSCheckpoints`; the daily result, assigned shift and Leader, remark, and photo reference are stored in `FiveSInspections`. The image file is stored in the configured Google Drive `EVIDENCE_FOLDER_ID` folder, while its Drive metadata is recorded in `Attachments` as `FiveSInspection`. Uploads are accepted only for today's active checkpoint assigned to that Leader.
- Admin, Manager, Supervisor, and Engineer can view daily progress and evidence across shifts. Leaders can view and submit their assigned checkpoints.

## Login example

```json
{
  "action": "login",
  "token": "",
  "payload": {
    "username": "admin",
    "password": "your-password"
  }
}
```

Tokens expire after six hours. Session data is cached in `CacheService` and backed by `PropertiesService`; the password itself is never stored in a token.

## Audit payload example

```json
{
  "action": "saveAudit",
  "token": "TOKEN_FROM_LOGIN",
  "payload": {
    "auditDate": "2026-06-12",
    "lineId": "LINE-01",
    "stationId": "ST-01",
    "auditLayer": "L1",
    "shift": "Day",
    "remark": "Routine layered audit",
    "records": [
      {
        "checklistId": "CK0001",
        "result": "NG",
        "findingDetail": "Guard label is missing",
        "beforePhotoUrl": "https://drive.google.com/...",
        "picName": "Somchai",
        "picUserId": "U0002",
        "dueDate": "2026-06-19"
      }
    ]
  }
}
```

A session row and all record rows are created. Every `NG` record creates a finding, and its `FindingID` is written back to the corresponding audit record.

## File upload

Upload payloads carry raw base64 **without** a data-URL prefix. The API decodes the content, writes the file to the configured Drive folder, and stores only the template attachment fields, including `DriveFileID`, `DriveFileURL`, and `FolderID`, in `Attachments`. The backend enforces a 10 MB decoded-file limit.

```json
{
  "action": "uploadFile",
  "token": "TOKEN_FROM_LOGIN",
  "payload": {
    "relatedType": "Finding",
    "relatedId": "F-202606-0001",
    "fileType": "BeforePhoto",
    "fileName": "photo.jpg",
    "mimeType": "image/jpeg",
    "base64Data": "/9j/4AAQSk..."
  }
}
```

Supported `fileType` values are `BeforePhoto`, `AfterPhoto`, `Evidence`, `Report`, and `Attachment`. Link sharing is attempted but may be blocked by Google Workspace administrator policy; upload still succeeds in that case.

## Setup and maintenance helpers

- `setupHeaders()` — creates missing sheets/headers and appends missing required columns without clearing data.
- `setupRbac()` — creates missing `RolePermissions`, `UserPermissions`, and `UserLineAccess` headers and inserts only missing default role-permission rows.
- `resetChecklistMasterBilingualFromSpreadsheet(sourceSpreadsheetId)` — deliberately clears and rebuilds only `ChecklistMaster` from the `ChecklistMaster_Bilingual` tab of a converted Google Sheets workbook. It validates the exact bilingual headers, exactly 39 data rows, and `LineID`/`StationID = ALL` before clearing the target.
- `createDefaultAdmin(username, password)` — creates one administrator only when that username does not exist.
- `hashExistingPasswords()` — hashes non-empty `PasswordHash` cells that are not already 64-character SHA-256 hex values. Run only when legacy cells currently contain plaintext passwords.
- `testApi()` — runs the status endpoint.
- `testSaveAudit()` — creates a real OK audit row using the first active checklist and admin; use only in a test database or remove the generated audit manually.

## Operational notes

- Keep sheet header names unchanged. All reads and writes map by header text rather than fixed column numbers.
- The backend uses the existing template headers exactly, including `CheckItem`, `StandardCriteria`, `RecordID`, `PICName`, and `LogID`; `setupHeaders()` only appends genuinely missing template columns and never renames or removes existing columns.
- Set the spreadsheet locale/date formats consistently. API date input should use `YYYY-MM-DD`; report periods use `YYYYMM`.
- Drive folder IDs are configuration values, not full folder URLs.
- Passwords are compared as lowercase SHA-256 hexadecimal digests.
- Do not expose `PasswordHash`, folder IDs, or the spreadsheet ID to the frontend.
- Publish a new web-app deployment version after backend changes; the `/exec` URL can remain stable when updating an existing deployment.
