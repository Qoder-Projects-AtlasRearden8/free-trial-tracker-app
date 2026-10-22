# Trialwise — project status

**Status: complete for the requested scope, verified October 22, 2026 (v1.1.0).**

Trialwise is a local-first tracker for free trials and ongoing subscriptions,
built for Asdale Dynamics, LLC. It has no accounts, analytics, tracking, cloud
sync, or data backend. The only server included is a dependency-free static file
server for local use.

## What was built

- **Two entry types on one watchlist.** Free trials use a start date and length;
  subscriptions use a next renewal date and a weekly, monthly, or yearly cycle.
  Older trial-only backups and CSV files still load.
- **Correct date handling.** Trials calculate the last safe cancel-by day and
  first billing date with the start day counted as day 1. Subscriptions roll
  forward from their original anchor without month-end or leap-day drift
  (January 31 → February 28 → March 31).
- **Mixed dashboard.** Next deadline, open-item count, and monthly-equivalent
  cost; deadline-sorted cards; trial progress; search and All/Open/Canceled
  filters; edit, mark-canceled/restore, account-link, and confirmed-delete flows.
- **Reminders before each renewal.** In-app alerts for overdue trials, last-day
  trials, renewals due today, and upcoming reminder windows. Optional browser
  notifications fire while the app is open or running in the background, with a
  duplicate guard per item and renewal cycle.
- **Calendar export.** `.ics` events for each open trial's reminder and cancel-by
  date, and each subscription's next reminder and renewal, with display alarms
  where calendar clients honor them.
- **Live form previews and validation.** A segmented trial/subscription form
  changes labels, fields, and preview copy without losing context. Subscription
  schedules require a renewal date and recurring cycle; unsafe URLs, bad dates,
  and invalid prices are rejected.
- **JSON and mixed CSV backups.** JSON preserves every field. CSV adds `type`
  and `renewal_date` columns, infers subscriptions from a lone renewal date,
  accepts common header aliases, protects against spreadsheet formula injection,
  validates row by row, and supports merge or replace imports.
- **Local-only persistence.** Data stays in `localStorage` with cross-tab
  synchronization and a session-only fallback when storage is blocked.
- **Installable offline app.** Service-worker app-shell cache, install prompt,
  offline reload, security-conscious static server, and scoped CSP headers.
- **Accessible, responsive interface.** Keyboard-visible focus, reduced-motion
  support, responsive layouts, and semantic labels.
- **Project docs and license.** Rewritten README covering both entry types,
  date rules, mixed CSV schema, reminders, privacy, development, and limitations.
  MIT license with the exact Asdale Dynamics, LLC copyright.
- **Automated tests.** 54 Node tests covering dates, records, JSON, CSV, ICS,
  and the local server.

## How to run it

Requires Node.js 20 or newer. There is nothing to install.

```sh
npm start
```

Open <http://127.0.0.1:4173>. Stop with `Ctrl+C`. To use another port:

```sh
PORT=4174 npm start
```

The server only serves local static files; it does not receive or store trial
data. The app should be opened over localhost or HTTPS so modules, the service
worker, offline caching, and installation work.

## How to test it

```sh
npm test       # 54 tests using Node's built-in test runner
npm run check  # syntax-check all browser, library, and server JavaScript
```

Browser end-to-end and accessibility checks were run with temporary tooling
outside the repository, so the shipped project remains dependency-free.

## Verification results

- `npm test`: **54 passed, 0 failed**.
- `npm run check`: **passed**.
- ESLint static analysis (temporary external config): **0 errors, 0 warnings**.
- Browser end-to-end run in Google Chrome against a fresh local server:
  - Welcome and mixed dashboard rendered.
  - Trial and subscription kind switching updated fields, labels, previews, and
    the hidden one-time billing option correctly.
  - Empty subscription validation required a renewal date.
  - Subscription add, normalization, persistence, reload, edit, cancel, and
    restore worked; total monthly cost updated correctly.
  - A trial and subscription coexisted, sorted by their next deadline, and
    showed distinct cancel-by versus renewal wording.
  - Search matched names and entry kind.
  - CSV import inferred a subscription from `renewal_date`, previewed its next
    renewal without an invalid date, and merged it successfully.
  - Invalid CSV import showed row-level errors.
  - JSON, mixed CSV, and renewal `.ics` downloads completed with valid content.
  - Reminders dialog reflected trial and renewal notification language.
  - With notification permission granted and a hidden tab simulated, both a
    subscription renewal alert and a trial deadline alert reached the service
    worker and were recorded in the duplicate log; a second trigger did not
    resend either one.
  - Service worker cached the shell; an offline reload still showed all mixed
    records.
  - Mobile layouts at 390 px and 320 px had no horizontal overflow. At 320 px
    the kind selector stacks cleanly so labels are not clipped.
  - **0 console errors, 0 page errors, 0 failed requests.**
- Axe WCAG 2.0/2.1 A and AA scans: **0 violations** on the welcome screen, mixed
  desktop dashboard, trial and subscription forms, data dialog, reminders
  dialog, about dialog, and mobile dashboard.
- The about dialog's scrollable content received a keyboard-focusable region to
  resolve the only accessibility issue found during the audit.
- Service-worker cache version bumped so existing installs receive the updated
  shell.
- Final visual review completed at desktop and mobile sizes.
- No remote repository was created; nothing was pushed or published.

## Known gaps and limitations

- **Closed-app notifications are impossible without a server.** Browser
  notifications work only while Trialwise is open or running in the background.
  The calendar export is the fallback, and it includes only each open item's next
  occurrence, not an infinite recurring series.
- **OS notification presentation is outside the app's control.** Headless
  Chrome verified that both record kinds reach the service-worker notification
  path and that duplicate alerts are suppressed, but the appearance, timing,
  and reliability of system banners vary by browser, OS, and device.
- **One rolling renewal date, no billing history.** Editing a plan's date or
  price changes the current record rather than preserving per-cycle history.
- **Local data is unencrypted and profile-bound.** There is no account, sync,
  recovery service, or encryption. Clearing browser data removes the watchlist;
  JSON export is the portable backup.
- **Cancellation is self-reported.** Trialwise records a canceled status but
  cannot confirm that a provider processed it.
- **Prices are USD only**, and the interface is light-theme only.
- **CSV import is column-name based.** There is no interactive column mapper.
  Files are limited to 5 MB and 1,000 entries.
- **Provider cutoff times vary.** A cancel-by date is a reminder aid, not a
  guarantee of billing behavior.
- **Notification, install, and offline behavior vary by browser and platform.**
- **Automated browser and Axe checks are not part of the committed test suite**
  because they require external tooling; the committed tests are dependency-free
  Node tests.

## License and credit

MIT. Copyright (c) 2026 Asdale Dynamics, LLC.

Built by [Asdale Dynamics, LLC](https://dylanasdale.github.io).
