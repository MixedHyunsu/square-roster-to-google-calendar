# Square Roster → Google Calendar

Automatically copies **your own** published shifts from Square (Square Team / Square Shifts) into your Google Calendar, twice a day.

- Free. Runs inside Google Apps Script. No server, nothing to host.
- Read-only access to Square. It can't change schedules or see payments.
- Only touches events it created. The rest of your calendar is left alone.

> Not affiliated with or endorsed by Square / Block, Inc.

---

## Contents

1. [Before you start](#before-you-start)
2. [How it works](#how-it-works)
3. [Setup (step by step)](#setup-step-by-step)
   - [Step 1 – Create the Apps Script project](#step-1--create-the-apps-script-project)
   - [Step 2 – Deploy it as a web app](#step-2--deploy-it-as-a-web-app)
   - [Step 3 – Create your Square developer app](#step-3--create-your-square-developer-app)
   - [Step 4 – (Recommended) Create a separate Work calendar](#step-4--recommended-create-a-separate-work-calendar)
   - [Step 5 – Add Script Properties](#step-5--add-script-properties)
   - [Step 6 – Get the owner's approval](#step-6--get-the-owners-approval)
   - [Step 7 – Test](#step-7--test)
   - [Step 8 – Turn on automatic sync](#step-8--turn-on-automatic-sync)
   - [Step 9 – Clean up](#step-9--clean-up)
4. [Updating the code later](#updating-the-code-later)
5. [Troubleshooting](#troubleshooting)
6. [Other functions](#other-functions)
7. [Security & privacy](#security--privacy)
8. [FAQ](#faq)

---

## Before you start

### What you need

| | What | Where |
|---|---|---|
| ✅ | **A Google account** (Gmail is fine) | [accounts.google.com](https://accounts.google.com) |
| ✅ | **A Square Developer account** — your own, free. Not your employer's account. You can sign up with any email. | [developer.squareup.com](https://developer.squareup.com) |
| ✅ | **Your employer's (Square account owner's) OK.** They will click "Allow" once. | — |
| ✅ | **The email address your employer has on file for you in Square** (the one Square Team invites/notifications go to) | Square Team app → your profile, or ask your manager |
| ⏱ | About **20–30 minutes** | — |

You do **not** need to install anything on your computer.

### Sites you'll use

| Site | Used for |
|---|---|
| [script.google.com](https://script.google.com) | Where the code lives and runs |
| [developer.squareup.com/apps](https://developer.squareup.com/apps) | Creating your Square app (Application ID / secret, Redirect URL) |
| [calendar.google.com](https://calendar.google.com) | Creating a Work calendar and finding its Calendar ID |

> 💡 **Tip:** If you're signed in to several Google accounts in one browser, Google's permission screens often get confused. Use a **Chrome Incognito window** (or a separate Chrome profile) signed in to **only** the Google account you want to use.

---

## How it works

```
Square Labor API ──(read-only OAuth, approved once by the business owner)──► Apps Script ──► Google Calendar
```

1. Twice a day (around 00:00 and 12:00), the script asks Square for **your** published shifts for the next 28 days.
2. It compares them with the events it previously created and **adds, updates or removes** events so the calendar matches Square.
3. Each event is tagged with its Square shift ID, so nothing else in your calendar is touched.
4. Past events are left alone as history. Draft (unpublished) shifts are ignored.

---

## Setup (step by step)

### Step 1 – Create the Apps Script project

1. Go to [script.google.com](https://script.google.com) and click **New project**.
2. Click **Untitled project** (top left) and rename it, e.g. `square-roster-to-google-calendar`.
3. In the file list on the left you'll see **`Code.gs`**. Click it, select everything (Ctrl/Cmd + A), delete it, and paste in the full contents of this repo's [`Code.gs`](Code.gs).
   > ⚠️ **Don't create a new file called `Code.gs`.** Apps Script adds `.gs` automatically, so you'd end up with `Code.gs.gs` *and* `Code.gs`, and get
   > `SyntaxError: Identifier 'SQUARE_API_VERSION' has already been declared`.
   > Paste into the existing `Code.gs`. If you already have duplicates, see [Troubleshooting](#troubleshooting).
4. Click **⚙ Project Settings** (left sidebar) → tick **Show "appsscript.json" manifest file in editor**.
5. Go back to **< > Editor**, open **`appsscript.json`**, replace its contents with this repo's [`appsscript.json`](appsscript.json).
   - If you're not in Melbourne, change `"timeZone"` to your [IANA time zone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) (e.g. `Australia/Sydney`, `America/New_York`).
6. **Save** (Ctrl/Cmd + S).

✅ **Check:** the file list shows exactly two files: `Code.gs` and `appsscript.json`.

---

### Step 2 – Deploy it as a web app

This creates the page your employer will see when approving access, and the address Square sends them back to.

1. Click the blue **Deploy** button (top right) → **New deployment**.
2. Next to **Select type**, click the **⚙ gear** → choose **Web app**.
3. Fill in:
   - **Description:** anything, e.g. `v1`
   - **Execute as:** **Me (your email)**
   - **Who has access:** **Anyone**  ← *not* "Anyone with a Google account"; your employer may not have one
4. Click **Deploy**.
5. Google asks you to **Authorize access**. Pick your account. You'll see **"Google hasn't verified this app"** — this is normal because *you* are the developer. Click **Advanced → Go to (project name) (unsafe) → Allow**.
6. Copy the **Web app URL**. It looks like:
   ```
   https://script.google.com/macros/s/AKfycb.................../exec
   ```

✅ **Check:** the URL ends in **`/exec`** (not `/dev`). Paste it somewhere handy — you'll need it twice.

> ⚠️ **Never use "New deployment" again** after this. Each new deployment gets a **different URL**, and then nothing matches. To update later, see [Updating the code later](#updating-the-code-later).

---

### Step 3 – Create your Square developer app

1. Go to [developer.squareup.com/apps](https://developer.squareup.com/apps) and sign in (create a free account if needed).
2. Click **+** / **Create your first application**, give it a name (e.g. `My roster sync`), and finish the wizard.
3. Open the app. At the top of the page there's a **Sandbox / Production** toggle. **Switch it to Production.**
   > ⚠️ This is the most common mistake. Sandbox values start with `sandbox-` and **will not work** with a real business.
4. In the left menu, open **OAuth**.
5. In **Redirect URL**, paste the `/exec` URL from Step 2 — exactly, with no spaces and no trailing `/`.
6. Click **Save**. Refresh the page to make sure it stuck.
7. In the left menu, open **Credentials** (still in **Production**) and copy:
   - **Application ID** → starts with `sq0idp-`
   - **Application secret** → starts with `sq0csp-` (click *Show*)

✅ **Check:** neither value starts with `sandbox-`.

> 🔒 The Application secret is a password. Never commit it, paste it into an issue, or share screenshots of it.

---

### Step 4 – (Recommended) Create a separate Work calendar

Keeping shifts in their own calendar means you can colour them, hide them, or delete them all at once without touching anything else.

1. Open [calendar.google.com](https://calendar.google.com).
2. Left sidebar → **Other calendars** → **+** → **Create new calendar**. Name it e.g. `Work` → **Create calendar**.
3. Click the new calendar in the left list → **⋮** → **Settings and sharing**.
4. Check **Time zone** is yours (e.g. *(GMT+11:00) Melbourne*).
5. Under **Access permissions for events**, make sure **Make available to public** is **off** (otherwise anyone with the link can see your work hours and location).
6. Scroll to **Integrate calendar** and copy the **Calendar ID**. It looks like:
   ```
   59c56f50....................................@group.calendar.google.com
   ```
   > ⚠️ Copy the **Calendar ID**, not "Public address in iCal format" or "Secret address" (those start with `https://` and will give `Calendar not found`).

Skip this step if you want shifts in your main calendar.

---

### Step 5 – Add Script Properties

Your settings and secrets live here, **not** in the code. That's what keeps the code safe to share.

1. In Apps Script, click **⚙ Project Settings** (left sidebar).
2. Scroll to the bottom → **Script Properties** → **Add script property**.
3. Add each row below (left box = **Property**, right box = **Value**). Click **Add script property** for each new row.
4. Click **Save script properties**.

| Property | Required | Value | Example |
|---|---|---|---|
| `SQUARE_APPLICATION_ID` | ✅ | Production Application ID (Step 3) | `sq0idp-AbC…` |
| `SQUARE_APPLICATION_SECRET` | ✅ | Production Application secret (Step 3) | `sq0csp-XyZ…` |
| `REDIRECT_URL` | ✅ | Web app URL from Step 2 | `https://script.google.com/macros/s/…/exec` |
| `MY_SQUARE_EMAIL` | ✅ | The email your employer has for you in Square | `you@example.com` |
| `CALENDAR_ID` | – | Calendar ID from Step 4. Default: your main calendar | `…@group.calendar.google.com` |
| `SYNC_DAYS_AHEAD` | – | How many days ahead to sync. Default `28` | `28` |
| `SYNC_HOURS` | – | Hours (0–23) for the daily runs. Default `0,12` | `0,12` |
| `EVENT_TITLE` | – | Event title. Default: location name + job title | `Work` |
| `SQUARE_ENVIRONMENT` | – | `production` (default) or `sandbox` for testing | `production` |

✅ **Check:**
- Property names are spelled **exactly** as above (all caps, underscores).
- No spaces before/after values.
- The **same** `/exec` URL is in `REDIRECT_URL` **and** in Square's Redirect URL (Step 3).

---

### Step 6 – Get the owner's approval

1. **Tell your employer first.** Something like:
   > I've set up a small tool that copies my own shifts from Square into my Google Calendar. It only needs read-only access to the schedule (it can't change anything or see payments), and you can disconnect it anytime in Square. I'll send you a link — could you click "Continue to Square", sign in, and press Allow?
2. In Apps Script, go to **< > Editor** → open `Code.gs`.
3. In the toolbar above the code there's a **function dropdown** (it may say `syncRoster`). Select **`printSetupLink`** and click **▷ Run**.
   - First run: Google asks for permission again → **Advanced → Go to … (unsafe) → Allow**.
4. The **Execution log** opens at the bottom and shows:
   ```
   Send this link to the Square account owner:
   https://script.google.com/macros/s/…/exec?setup=…
   ```
5. **Check the link yourself before sending it:** open it. You should see a **"Connect Square shifts"** page.
   - Hover over (or right-click → copy) **Continue to Square**. The link must contain `client_id=sq0idp-…` (no `sandbox-`) and your `/exec` URL.
   - **Don't click the button yourself** — you'd connect your own Square account instead of the business.
6. Send the link to the **Square account owner**. They open it → **Continue to Square** → sign in → **Allow**.
7. They should see **"Connected"**.

> 🔒 Treat this link as private. Anyone holding it could connect a different Square account. You'll disable it in Step 9.

---

### Step 7 – Test

1. Run **`checkConnection`** (same dropdown → ▷ Run). A healthy log looks like:
   ```
   Square connected. Team member ID: TMxxxxxxxxxxxx
   Calendar: Work
   Published shifts in the next 28 days: 5
     2026-11-08T10:00:00+11:00 -> 2026-11-08T15:00:00+11:00
     2026-11-09T11:00:00+11:00 -> 2026-11-09T20:30:00+11:00
   ```
   - Times are shown with their UTC offset. `+11:00` means the time shown **is** Melbourne time; a `Z` ending means UTC.
   - Compare a couple of shifts with the Square Team app.
2. Run **`syncRoster`**. The log ends with something like `Sync done. shifts=5 created=5 updated=0 deleted=0`.
3. Open Google Calendar and check the events and times.

---

### Step 8 – Turn on automatic sync

1. Run **`installTriggers`**. The log shows:
   ```
   Installed daily triggers at hours: 0, 12 (Australia/Melbourne)
   ```
2. Optional check: left sidebar **⏰ Triggers** shows two `syncRoster` triggers.

Apps Script runs each trigger **at some point within that hour** (e.g. between 12:00 and 13:00), not on the dot. You can always run `syncRoster` manually for an immediate update. If a scheduled run fails, Google emails you.

---

### Step 9 – Clean up

1. **Disable the approval link:** ⚙ Project Settings → Script Properties → delete **`SETUP_KEY`** → Save.
   Syncing keeps working. If you ever need to reconnect, run `printSetupLink` again and a fresh link is generated.
2. Make sure the Work calendar is **not public** (Step 4.5).

🎉 Done.

---

## Updating the code later

When this repo gets an update:

1. Replace the contents of `Code.gs` in Apps Script with the new version → **Save**.
2. **Deploy → Manage deployments** → select your existing deployment → **✏ Edit** → **Version: New version** → **Deploy**.

This keeps the **same `/exec` URL**, so nothing else needs to change.

> Saving the code updates scheduled runs immediately, but the **web app page** (the approval link) keeps running the old version until you do step 2.

---

## Troubleshooting

| Error / symptom | Cause | Fix |
|---|---|---|
| `SyntaxError: Identifier 'SQUARE_API_VERSION' has already been declared` | The code exists in two `.gs` files (often `Code.gs` and `Code.gs.gs`), or was pasted twice into one file. | Delete every `.gs` file except one (⋮ → Delete). Search it for `const SQUARE_API_VERSION` — there must be exactly **1** match. Refresh the browser. |
| Same `SyntaxError`, but only when **opening the approval link** | The web app is still running the version deployed before you fixed the files. | [Update the deployment](#updating-the-code-later) (Manage deployments → New version). |
| `Missing Script Properties: …` | A required property is missing or misspelled. | Check the names listed in the error against [Step 5](#step-5--add-script-properties). Remember to click **Save script properties**. |
| `REDIRECT_URL should be your web app URL ending in /exec` | Wrong URL (e.g. `/dev`, or a typo). | Use the `/exec` URL from Deploy → Manage deployments. |
| Two different `/exec` URLs | You clicked **New deployment** more than once. | Pick one. Put it in `REDIRECT_URL` **and** Square's Production Redirect URL, then run `printSetupLink` again. Archive the other deployment. |
| "Google hasn't verified this app" | Normal for personal scripts. | **Advanced → Go to … (unsafe) → Allow**. |
| Can't get past Google's permission screen | Signed in to multiple Google accounts, or pop-ups blocked. | Use an Incognito window with only one account, allow pop-ups for script.google.com. |
| Square: *"Application does not have a Redirect URL registered in the Developer Console"* | Redirect URL saved in **Sandbox** instead of **Production**, not saved, or saved on a different app. | Square app → **Production** → OAuth → paste `/exec` URL → **Save**. Then ask the owner to reopen the link. |
| Approval link's button contains `client_id=sandbox-…` | Sandbox credentials in Script Properties. | Replace `SQUARE_APPLICATION_ID` **and** `SQUARE_APPLICATION_SECRET` with **Production** values. |
| Approval page says **"Link expired"** | The link is older than 24 h, or `SETUP_KEY` changed. | Run `printSetupLink` again and send the new link. |
| Approval page says **"Something went wrong: Square token request failed…"** | Usually the Application secret doesn't match the Application ID (e.g. sandbox secret with production ID). | Re-copy both from **Production → Credentials**, then retry the link. |
| `Square is not connected yet` | The owner hasn't finished approving, or approval failed. | Open **☰ Executions** → click the latest `doGet` to see the log, fix the cause, ask the owner to retry. |
| Square dashboard shows an active token, but the script says not connected | Approval reached Square but the script didn't save the token. | Same as above — check the `doGet` log in **Executions**. |
| `No active team member with email "…"` | `MY_SQUARE_EMAIL` doesn't match what the business has on file. | Ask your manager which email is on your Square profile. |
| `Calendar not found: https://calendar.google.com/…` | `CALENDAR_ID` is a URL (iCal address), not the ID. | Use the value that ends in `@group.calendar.google.com` ([Step 4](#step-4--recommended-create-a-separate-work-calendar)). |
| `Published shifts in the next 28 days: 0` | No published shifts yet, or only drafts. | Wait until the roster is published. Drafts are ignored on purpose. |
| `Square rejected the token (401)` | The owner disconnected the app. | Run `printSetupLink` and get approval again. |
| Times look off by hours | Calendar or script time zone isn't yours. | Check the calendar's **Settings → Time zone** and `timeZone` in `appsscript.json`. |

**Where to see logs:** Apps Script left sidebar → **☰ Executions**. Click a row to expand its log. Approval attempts appear as `doGet`.

---

## Other functions

Run any of these from the function dropdown in the editor.

| Function | What it does |
|---|---|
| `syncRoster` | Sync now |
| `checkConnection` | Show your team member ID, calendar, and upcoming shifts without changing anything |
| `printSetupLink` | Generate the approval link for the business owner |
| `installTriggers` | Turn on the daily automatic sync |
| `uninstallTriggers` | Turn off the daily automatic sync |
| `disconnectSquare` | Revoke Square access, forget tokens, remove triggers |
| `removeSyncedEvents` | Delete all upcoming events this tool created |

---

## Security & privacy

- **Secrets never go in the code.** Application ID/secret and tokens live only in Script Properties.
- **Read-only.** The app requests `TIMECARDS_READ`, `EMPLOYEES_READ` and `MERCHANT_PROFILE_READ` only.
- The Square token can read the business's whole schedule and staff list. The script only writes **your** shifts to **your** calendar, and only caches job titles and location names for a few hours.
- Access tokens are refreshed automatically every 7 days.
- Anyone with **edit access to your Apps Script project** can read Script Properties. Don't share the project.
- Don't post screenshots of Script Properties or of the `printSetupLink` log.
- The business owner can revoke access at any time from their Square account.
- **Only use this with your employer's consent.**

---

## FAQ

**Does this cost anything?**
No. Google Apps Script is free, and two runs a day use around 1–2% of the daily free quota. Square doesn't charge for API access.

**Does my computer need to be on?**
No. It runs on Google's servers.

**Can I make it sync more often?**
Yes. Set `SYNC_HOURS`, e.g. `0,6,12,18`, then run `installTriggers` again.

**What if I edit a synced event in Google Calendar?**
Your edits are overwritten at the next sync. Square is the source of truth.

**What if a shift is cancelled or moved to someone else?**
It's removed from your calendar at the next sync.

**Can my coworkers use it?**
Yes — each person sets up their own copy (their own Apps Script project and Square developer app), and the owner approves each one.

**How do I stop using it?**
Run `disconnectSquare`, optionally `removeSyncedEvents`, then delete the Apps Script project.

---

## License

[MIT](LICENSE)
