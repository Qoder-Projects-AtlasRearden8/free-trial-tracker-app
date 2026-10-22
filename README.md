# Trialwise

A calm, offline-first tracker for free trials and the subscriptions that follow them.

Add a service, its start date, and how long the trial lasts. Trialwise works out
the last safe day to cancel, nudges you before that day, and reminds you what the
service will cost afterward. Everything stays in your browser on your device.

Built by [ASDALE DYNAMICS, LLC](https://dylanasdale.github.io) as a small,
practical, local-first tool.

## What it does

- **Keeps the important dates straight.** Enter a start date and trial length,
  and Trialwise calculates the cancel-by date and the first billing date.
- **Shows what happens next.** Trials are grouped as upcoming, active, ending
  soon, on their last day, ended, or canceled.
- **Reminds you in the way that fits.** In-app alerts are always available;
  browser notifications can fire while Trialwise is open or running in the
  background. A calendar file gives you an offline backup for reminders.
- **Remembers the cost.** Track the price after the trial, the billing cycle,
  and a link to the service's cancellation page.
- **Moves with you.** Export a complete JSON backup, a spreadsheet-friendly CSV,
  or upcoming deadlines as an iCalendar (`.ics`) file. Import JSON or CSV back
  when you need it.
- **Works offline.** Once loaded and installed, the app shell is cached by a
  service worker. There are no accounts, no analytics, no remote fonts, and no
  network requests for your data.

## Your privacy

Trial data is saved in this browser with `localStorage`. It is not encrypted,
not synced, and not sent anywhere by this app. That also means:

- Clearing your browser's site data deletes your trials.
- Another person using the same browser profile can open the app and see them.
- A JSON export is your best portable backup. Keep it somewhere you trust.

Avoid typing sensitive information into notes. No API keys, passwords, or
payment details belong in this app.

## Start it locally

You need [Node.js](https://nodejs.org/) 20 or newer. There are no packages to
install.

1. Open a terminal in this folder.
2. Start the local server:

   ```sh
   npm start
   ```

3. Open <http://127.0.0.1:4173> in Chrome, Edge, or Firefox.

Use `Ctrl+C` in the terminal to stop the server. If port 4173 is busy, run
`PORT=4174 npm start` and open that port instead.

The app must be served over `http://localhost` or HTTPS for module loading, the
service worker, offline caching, and the install prompt to work. Browsers
commonly block JavaScript modules over `file://`, so use the local server rather
than opening `index.html` directly.

### Install it like an app

- **Chrome or Edge on a computer:** look for the install icon in the address
  bar, or open the browser menu and choose **Install Trialwise**. If the install
  button in the app header is visible, it does the same thing.
- **Android:** use the browser menu and choose **Add to Home screen** or
  **Install app**.
- **iPhone or iPad:** open the site in Safari, tap **Share**, then choose
  **Add to Home Screen**. Notification behavior varies by iOS version.

Installing is optional. The app still works in a normal browser tab.

## A quick tour

1. Choose **Add a trial**.
2. Enter the service name, start date, and trial length.
3. Optionally add the price after the trial, a billing cycle, the cancel page
   link, and a reminder lead time.
4. Watch the preview: Trialwise shows the cancel-by date and first billing date
   before you save.
5. Save the trial. Use the search box and status filters to find it later.
6. When you are ready, open the cancel link, then mark the trial **Canceled**.
   You can restore it if you change your mind.

### How the date math works

Trialwise treats the start date as day 1. For a 7-day trial that starts on
October 1:

- The last safe day to cancel is **October 7**.
- Billing starts **October 8**.

This convention is stated plainly in the app because services can define trial
periods slightly differently. If a service says "cancel by October 8," use that
date as a note or start the trial one day later so the reminder arrives with a
little room.

All date math uses date-only values in UTC. That avoids the off-by-one surprises
that daylight saving time can cause.

### Reminders, honestly

In-app reminders appear whenever Trialwise is open. Browser notifications are
also checked while the tab is hidden or the window is in the background, at most
once a minute.

A purely offline, browser-based app **cannot wake itself when it is completely
closed**. There is no server to send a push notification. For a reminder you can
trust even when the app is closed:

1. Open **Reminders**.
2. Choose **Download calendar reminders**.
3. Open the `.ics` file to add the deadlines to your own calendar.

The calendar file contains all-day events for open trials. Those events include
alarms, so your calendar app can notify you independently of Trialwise.

Notification permission is optional. If you decline it, every other feature
still works.

## Backups and moving data

Open **Your data** in the app header.

- **JSON** contains every field, including notes and timestamps. Use it for a
  complete backup or to move to another browser.
- **CSV** is convenient for spreadsheets. It contains the fields shown in the
  app, with dates as `YYYY-MM-DD`. Spreadsheet formula injection is neutralized
  on export.
- **iCalendar** contains reminders and billing dates for open trials.

Re-importing a JSON backup with **Merge** updates matching IDs and adds new
trials. **Replace everything** swaps the current board for the imported one.
Imports are validated first and report row-specific problems rather than
silently accepting bad data.

CSV imports require at least `name`, `start_date` (or `startDate`), and
`trial_days` (or `trialDays`). Optional columns are recognized, and a header
row is required. Export a CSV once to see the exact column names.

## Development

```sh
npm test       # date, CSV/data, and calendar unit tests with node --test
npm run check  # syntax-check the browser and server JavaScript
npm start      # serve locally at http://127.0.0.1:4173
```

The project has no runtime or development dependencies. The stack is plain
HTML, CSS, and ES modules. Tests use Node's built-in test runner.

### Project layout

```text
app.js                  UI, storage, reminders, import/export
index.html              semantic app shell and dialogs
styles.css              responsive visual design
server.js               dependency-free local static server
sw.js                   offline app-shell cache and notification clicks
manifest.webmanifest    install metadata
lib/dates.js            date-only trial calculations
lib/data.js             validation, storage records, JSON/CSV import and export
lib/csv.js              strict CSV parser and safe writer
lib/ics.js              iCalendar reminder export
tests/                  node --test suites
icons/                  app icons (SVG plus generated PNGs)
assets/                 decorative artwork
```

### Browser notes

- Modern evergreen browsers are supported.
- The app assumes `localStorage` is available. If it is blocked, the app warns
  you and keeps working for the current session.
- Notification support depends on the browser and operating system. The app
  detects unsupported setups and explains the calendar fallback.
- The interface is light-theme only for now.

## Known limitations

- Prices are tracked in US dollars.
- Data lives in one browser profile. There is no account or cross-device sync;
  use a JSON backup or CSV to move it.
- Notifications cannot reach a fully closed offline app. Use the calendar
  export for that.
- Trialwise is a memory aid, not billing advice. Always confirm a service's
  actual cancellation terms and deadlines.

## License

MIT. See [LICENSE](LICENSE).

Copyright (c) 2026 Asdale Dynamics, LLC.
