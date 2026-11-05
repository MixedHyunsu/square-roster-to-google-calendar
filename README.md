# Square Shifts → Google Calendar

Copies **your own** published shifts from Square (Square Team / Shifts) into your Google Calendar, twice a day. Runs free inside Google Apps Script — no server, nothing to host.

> Not affiliated with or endorsed by Square / Block, Inc.

## How it works

```
Square Labor API  ──(read-only OAuth, approved by the business owner)──►  Apps Script  ──►  Google Calendar
```

- Every run fetches your published shifts for the next 28 days, then creates, updates or deletes calendar events so they match.
- Each event is tagged with its Square shift ID, so nothing else in your calendar is touched.
- Past events are left alone as history.
- Runs at 00:00 and 12:00 by default (Apps Script fires somewhere within that hour). You can also run `syncRoster` manually.

## What you need

- A Google account
- A free Square Developer account (your own — not the business's)
- The Square account **owner** willing to click "Allow" once. The access is read-only and they can revoke it any time.

## Setup

### 1. Create the Apps Script project
1. Go to [script.google.com](https://script.google.com) → **New project**.
2. Replace the contents of `Code.gs` with this repo's `Code.gs`.
3. **Project Settings** → tick **Show "appsscript.json" manifest file in editor**, then replace it with this repo's `appsscript.json`. Change `timeZone` if you're not in Melbourne.

(Or use [clasp](https://github.com/google/clasp) to push the files.)

### 2. Deploy it as a web app
This page is where Square sends the owner back after they approve.

1. **Deploy** → **New deployment** → type **Web app**.
2. Execute as: **Me**. Who has access: **Anyone**.
3. Copy the **Web app URL** (ends in `/exec`).

> When you change the code later, use **Manage deployments → Edit → New version** so the URL stays the same.

### 3. Create your Square app
1. Sign in at [developer.squareup.com](https://developer.squareup.com) and create an application.
2. Switch to **Production**, open **OAuth**, and set the **Redirect URL** to the `/exec` URL from step 2.
3. Copy the production **Application ID** and **Application secret**.

### 4. Add Script Properties
**Project Settings → Script Properties**:

| Property | Required | Value |
|---|---|---|
| `SQUARE_APPLICATION_ID` | yes | Production Application ID |
| `SQUARE_APPLICATION_SECRET` | yes | Production Application secret |
| `REDIRECT_URL` | yes | The `/exec` web app URL |
| `MY_SQUARE_EMAIL` | yes | The email your employer has on file for you in Square |
| `CALENDAR_ID` | no | Calendar to write to. Default: your main calendar. A separate "Work" calendar is recommended (Calendar settings → Integrate calendar → Calendar ID). |
| `SYNC_DAYS_AHEAD` | no | How far ahead to sync. Default `28` |
| `SYNC_HOURS` | no | Comma-separated hours for the daily runs. Default `0,12` |
| `EVENT_TITLE` | no | Event title. Default: location name, plus job title in brackets |
| `SQUARE_ENVIRONMENT` | no | `production` (default) or `sandbox` |

### 5. Get the owner's approval
1. In the editor, run **`printSetupLink`**. Google will ask you to authorise the script the first time ("Google hasn't verified this app" → **Advanced → Go to project**; it's your own script).
2. Copy the link from the execution log and send it to the Square account owner.
3. They open it, click **Continue to Square**, sign in, and click **Allow**.

Treat that link as private: anyone holding it could connect a different Square account to your script.

### 6. Test and schedule
1. Run **`checkConnection`** — it prints your team member ID and upcoming shifts.
2. Run **`syncRoster`** once and check your calendar.
3. Run **`installTriggers`**.

Done. If a scheduled run fails, Google emails you a failure summary.

## Other functions

| Function | What it does |
|---|---|
| `syncRoster` | Sync now |
| `uninstallTriggers` | Stop the automatic runs |
| `disconnectSquare` | Revoke Square access, forget tokens, remove triggers |
| `removeSyncedEvents` | Delete all upcoming synced events |

## Security & privacy notes

- **Never commit your Application secret or tokens.** They live only in Script Properties.
- Square tokens can read the whole business's schedule and staff list. The script only writes *your* shifts to your calendar, and stores nothing else beyond a short-lived cache of job titles and location names.
- Access tokens are refreshed automatically every 7 days.
- Anyone with edit access to your Apps Script project can read Script Properties — don't share the project.
- Ask before you connect. This needs the business owner's consent; don't use it without it.

## Limits

- Only **published** shifts are synced; drafts are ignored.
- Uses the Square Labor API scheduled-shifts endpoints (API version `2025-05-21`+).
- Well within Apps Script's free quotas at two runs a day.

## License

MIT
