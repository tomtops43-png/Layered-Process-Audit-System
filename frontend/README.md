# LPA Frontend

Static, mobile-responsive frontend for the Layered Process Audit System. It uses plain HTML, CSS, and JavaScript and can be hosted directly on GitHub Pages without a build step.

## Files

- `index.html` — single-page application structure and dialogs.
- `style.css` — factory-friendly responsive interface, mobile navigation, print styles, status colors, loading, and toast components.
- `app.js` — authentication, routing, API calls, audit entry, file upload, findings, dashboard, reports, CSV export, and checklist views.
- `config.js` — Apps Script Web App URL and application name.

## Run locally

A web server is recommended because browser security rules may restrict requests opened directly from `file://`.

```bash
cd frontend
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## GitHub Pages

1. Commit the `frontend/` directory.
2. In the repository settings, open **Pages**.
3. Select the deployment branch and choose `/frontend` if the host supports a custom publishing directory. If GitHub Pages only offers `/` or `/docs`, publish this directory through a Pages workflow or move/copy these five files to the configured Pages root.
4. Confirm `config.js` contains the current Apps Script `/exec` deployment URL.

No Node.js, package installation, bundler, framework, or external CDN is required.

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
- Monthly report, print layout, and CSV export.
- Active Checklist Master viewer using the backend’s exact fields.

## Notes

- Image files are converted to base64 only in browser memory for transport. The backend stores the file in Drive and returns `DriveFileURL`; base64 is not stored in the spreadsheet.
- The current backend upload limit is 10 MB after base64 decoding. Mobile users should use reasonably compressed photos.
- Before Photo uploads occur before `saveAudit`, using a temporary related ID. The returned Drive URL is then included in the audit record.
