# LPA Frontend

Static, mobile-responsive frontend for the Layered Process Audit System. It uses plain HTML, CSS, and JavaScript and can be hosted directly on GitHub Pages without a build step.

## Files

- `index.html` — single-page application structure and dialogs.
- `style.css` — factory-friendly responsive interface, mobile navigation, print styles, status colors, loading, and toast components.
- `app.js` — authentication, routing, API calls, audit entry, file upload, findings, dashboard, reports, CSV export, and checklist views.
- `config.js` — Apps Script Web App URL and application name.
- `vendor/qrcode.js` — locally bundled QR generator used in the quiz management panel; see its MIT license beside the file.

## Run locally

A web server is recommended because browser security rules may restrict requests opened directly from `file://`.

```bash
cd frontend
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## GitHub Pages

The repository includes a deployment-ready copy of this static site in `/docs` while keeping the original source files in `/frontend`.

1. Push the repository to GitHub with the deployment files committed.
2. Open the repository's **Settings > Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Select the **main** branch and the **/docs** folder, then click **Save**.
5. Wait for GitHub Pages to publish the site and open the URL shown in the Pages settings.
6. Confirm the deployed site is using the existing Apps Script `/exec` URL from `docs/config.js`.

When frontend files change, copy `frontend/index.html`, `style.css`, `app.js`, `config.js`, and `README.md` to `/docs` before publishing. No Node.js, package installation, bundler, framework, or external CDN is required.

## API behavior

Every call is sent as `POST` with `Content-Type: text/plain;charset=utf-8`:

```json
{
  "action": "getDashboard",
  "token": "TOKEN_FROM_LOGIN",
  "payload": {}
}
```

The frontend expects `{ "success": true, "message": "...", "data": {} }`. Failed API responses, network errors, and expired tokens are shown through Thai toast messages. Tokens and the current user profile are stored in `localStorage`.

## Main workflows

- Login and logout.
- Dashboard KPIs, monthly audit bars, line summaries, and actions near Due Date.
- LPA audit with dynamic checklist, OK/NG/N/A controls, required NG action fields, Before Photo upload, and audit submission.
- Finding filters and update/closure workflow with After Photo upload.
- Meeting board with one bilingual Thai/Myanmar quiz of five questions per day, generated from all of that day's Meeting topics and slides. Both shifts use the same QR and questions; employees select their name from the roster, choose their quiz language, and the backend assigns the shift from the roster. Employees see their own answers and explanations immediately after submitting. Managers can stop each shift after all eligible employees have submitted or been excused, which reveals that shift's top three; the shared answer key opens after every shift is closed and complete.
- After an admin publishes the quiz, its management panel shows a QR code and copyable link. Employees scan it and take the quiz as guests without a website login. The guest link opens only that published quiz; each employee's answer token stays in that browser session.
- Monthly report, print layout, and CSV export.
- Active Checklist Master viewer using the backend’s exact fields.

## Notes

- Image files are converted to base64 only in browser memory for transport. The backend stores the file in Drive and returns `DriveFileURL`; base64 is not stored in the spreadsheet.
- The current backend upload limit is 10 MB after base64 decoding. Mobile users should use reasonably compressed photos.
- Before Photo uploads occur before `saveAudit`, using a temporary related ID. The returned Drive URL is then included in the audit record.
- The quiz API key is stored only in Apps Script Script Properties. Quiz generation sends all Meeting topics and extracted slide text for the selected date to the configured Gemini API.
- Quiz data is written to `MeetingQuizzes`, `MeetingQuizQuestions`, `MeetingQuizParticipants`, `MeetingQuizAnswers`, `MeetingQuizEmployees`, and `MeetingQuizAttendance` in the spreadsheet configured by Apps Script. Fill `MeetingQuizEmployees` with `EmployeeID`, `FirstName`, `LastName` (or `DisplayName`), `Shift`, and `ActiveStatus` (`Active`). Duplicate active rows with the same normalized full name count as one employee; the first active row with a valid shift is canonical. Record each day's `MeetingDate`, `EmployeeID`, and `Status` (`Leave`, `Sick`, or `Absent`) in `MeetingQuizAttendance` to exclude absences from that shift's expected count. The answer key remains private until each shift is closed and all eligible employees have submitted or been excused; a shift's top three are shown only after a manager stops that shift.
