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
| `Setup.gs` | Non-destructive setup and manual test helpers |

## Installation

1. Create or open the Google Sheet named `LPA_Database`.
2. Open **Extensions → Apps Script**.
3. Create one Apps Script file for each `.gs` file in this directory and copy its contents. Apps Script combines all `.gs` files into one global runtime, so file order is not significant.
4. In **Project Settings → Script Properties**, add:
   - `SPREADSHEET_ID`: ID from the `LPA_Database` spreadsheet URL.
   - Optional `DEFAULT_ADMIN_PASSWORD`: temporary password used only when `createDefaultAdmin()` is called without arguments.
5. In Apps Script project settings, set the project timezone to **Asia/Bangkok**. The code also explicitly formats business dates in `Asia/Bangkok`.
6. Run `setupHeaders()` once from the editor and authorize access. It creates missing sheets/headers and appends missing columns; it does not delete existing data.
7. Confirm the `Settings` sheet contains these keys and valid values:
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
8. Create an administrator by running `createDefaultAdmin('admin', 'replace-with-a-strong-password')`. Remove any temporary password from Script Properties afterward.
9. Deploy with **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: select the option appropriate for the GitHub Pages client (commonly **Anyone**)
10. Copy the `/exec` deployment URL for the future frontend.

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
- Protected: `getCurrentUser`, `getMasterData`, `getChecklist`, `saveAudit`, `getAuditList`, `getFindings`, `updateFinding`, `closeFinding`, `uploadFile`, `getDashboard`, `getMonthlyReport`, `exportReportCsv`

`Admin` has full access. `Manager`, `Supervisor`, and `Engineer` can audit, report, update, and close findings. `Leader` can create audits and update assigned findings. `User` access is restricted to assigned findings/actions and their own audit-list entries.

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
        "comment": "Guard label is missing",
        "beforePhotoUrl": "https://drive.google.com/...",
        "pic": "Somchai",
        "picUserId": "U0002",
        "dueDate": "2026-06-19"
      }
    ]
  }
}
```

A session row and all record rows are created. Every `NG` record creates a finding, and its `FindingID` is written back to the corresponding audit record.

## File upload

Upload payloads carry raw base64 **without** a data-URL prefix. The API decodes the content, writes the file to the configured Drive folder, and stores only file metadata, `DriveFileID`, and `DriveFileURL` in `Attachments`. The backend enforces a 10 MB decoded-file limit.

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
- `createDefaultAdmin(username, password)` — creates one administrator only when that username does not exist.
- `hashExistingPasswords()` — hashes non-empty `PasswordHash` cells that are not already 64-character SHA-256 hex values. Run only when legacy cells currently contain plaintext passwords.
- `testApi()` — runs the status endpoint.
- `testSaveAudit()` — creates a real OK audit row using the first active checklist and admin; use only in a test database or remove the generated audit manually.

## Operational notes

- Keep sheet header names unchanged. All reads and writes map by header text rather than fixed column numbers.
- Set the spreadsheet locale/date formats consistently. API date input should use `YYYY-MM-DD`; report periods use `YYYYMM`.
- Drive folder IDs are configuration values, not full folder URLs.
- Passwords are compared as lowercase SHA-256 hexadecimal digests.
- Do not expose `PasswordHash`, folder IDs, or the spreadsheet ID to the frontend.
- Publish a new web-app deployment version after backend changes; the `/exec` URL can remain stable when updating an existing deployment.
