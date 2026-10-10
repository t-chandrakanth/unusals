# DPWS Loco Tracker

A small app for tracking DPWS locos: where each one is, which train it is on,
and whether it is in SC division or handed over to another division. It
produces the position report in the usual two-table format and keeps a
day-wise history of every loco.

It runs in any browser, on a phone or a computer, and can be installed on a
phone's home screen. It works without internet once opened.

## What it does

- **Locos**: all locos in two groups, "In other divisions" and "In SC
  division". Tap one to update train number, location, H/O details, working
  status or remarks. Switching a loco between divisions renumbers the list.
- **Report**: the position report in the sheet format. Share it as an image
  (for WhatsApp), an Excel file, plain text, or print it to PDF. Each time
  today's report is shared, a copy is kept under "Reports sent". Pick an
  earlier date to see the position as it stood on that day.
- **History**: day-wise summary of one loco over any date range, with the
  same share options.
- **Backup**: at the foot of History, download a copy of all data as a file.
  The top bar shows the sync state (tap it to sync now) and your name (tap to
  change it).

Every change is saved with its date and time, which is what the history and
the past-date reports are built from.

## Where the data lives

The app has two modes, chosen by `js/config.js`.

**On the device only** (config left empty). Data is stored in the browser on
the device you use and is not uploaded anywhere. Use **Download backup** and **Restore backup** at the foot of History to
move it between devices.

**Shared database** (config filled in). Data is kept in a Supabase database
and shared by everyone who opens the app, so every phone and computer shows
the same thing. Each person types their name once, and each change records
who made it. The app still works without internet: changes are kept on the
device and uploaded when the connection returns. If two people change the
same loco, the later change wins and both are kept in the history.

The app starts with the position sheet dated 08-10-2026. The first device to
connect to an empty database uploads its data; everyone after that receives
the shared data.

## Older records

The history from before the app existed is loaded once, automatically, from
`js/history-data.js`. It combines two sources, and History shows which one
each entry came from:

- **sheet**: the position reports in the " DPWCS LOCO" tab (17-08-2026 to
  10-10-2026). These are also kept whole under **Reports sent**.
- **shed**: the loco shed's daily statements (13-07-2026 to 10-10-2026).
  These fill the days between position reports.

Neither source records a time of day, so position reports are filed at
12:00 and shed statements at 07:00. To rebuild the data file from fresh
exports, run `tools/build_history.py` (see the notes at the top of it).

## Setting up the shared database (one time)

1. Create a free project at https://supabase.com.
2. In **SQL Editor**, paste the contents of `supabase/setup.sql` and run it.
3. From **Project Settings > API**, copy the **Project URL** and the
   **anon public** key into `js/config.js`.

Never put the `service_role` key or the database password in this repo.

### Who can edit

By default (`REQUIRE_LOGIN = false`) there is no sign-in: **anyone who has
the app link can view and edit**. That is simple for a team, but it also
means a stranger who finds the link could change the data. Two things limit
the damage: nothing can be deleted outright, and the log of changes can only
be added to, never rewritten, so the true history is always there.

To restrict access to named people instead, set `REQUIRE_LOGIN = true`, run
`supabase/setup-login.sql`, turn off **Allow new users to sign up** under
Authentication, and add each person under **Authentication > Users**.

## Publishing it (one time)

1. Open the repository on github.com, then **Settings > Pages**.
2. Under "Build and deployment", choose **Deploy from a branch**, branch
   **main**, folder **/ (root)**, and save.
3. After a minute the app is live at
   `https://t-chandrakanth.github.io/unusals/`.

Open that link on the phone in Chrome and choose **Add to Home screen** from
the menu to install it.

## For developers

No build step and no dependencies: plain HTML, CSS and JavaScript modules.

```
npm test     # runs the logic tests with Node's built-in test runner
npm start    # serves the app at http://localhost:8080
```

- `js/logic.js`: data rules (numbering, change log, day-wise summary)
- `js/sheet.js`: the report layout, shared by screen, image and Excel
- `js/xlsx.js`, `js/canvas.js`: Excel and image export
- `js/sync.js`, `js/syncdata.js`: shared database sync and offline queue
- `js/config.js`: database connection (empty means device-only)
- `js/historyimport.js`, `js/history-data.js`: one-time import of older records
- `supabase/setup.sql`: database tables and open-access rules
- `supabase/setup-login.sql`: the same, restricted to signed-in users
- `js/app.js`: the screens
- `js/seed.js`: starting data
