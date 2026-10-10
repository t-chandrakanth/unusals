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
- **More**: backup and restore, to move data between phone and computer.

Every change is saved with its date and time, which is what the history and
the past-date reports are built from.

## Where the data lives

The app has two modes, chosen by `js/config.js`.

**On the device only** (config left empty). Data is stored in the browser on
the device you use and is not uploaded anywhere. Use **More > Download
backup** and **Restore backup** to move it between devices.

**Shared database** (config filled in). Data is kept in a Supabase database
and shared by everyone who signs in, so the phone and the computer, and all
users, see the same thing. Each change records who made it. The app still
works without internet: changes are kept on the device and uploaded when the
connection returns. If two people change the same loco, the later change
wins and both are kept in the history.

The app starts with the position sheet dated 08-10-2026. The first person to
sign in to an empty database uploads the data from their device; everyone
after that receives the shared data.

## Setting up the shared database (one time)

1. Create a free project at https://supabase.com.
2. In **SQL Editor**, paste the contents of `supabase/setup.sql` and run it.
3. In **Authentication > Sign In / Providers**, turn off **Allow new users to
   sign up**, so only people you add can get in.
4. In **Authentication > Users**, use **Add user** for each person (email and
   password, with "Auto Confirm User" ticked).
5. From **Project Settings > API**, copy the **Project URL** and the
   **anon public** key into `js/config.js`.

The anon key is designed to be public. It gives no access by itself: the
rules in `setup.sql` only allow signed-in users to read or change data.
Never put the `service_role` key or the database password in this repo.

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
- `supabase/setup.sql`: database tables and access rules
- `js/app.js`: the screens
- `js/seed.js`: starting data
