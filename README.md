# Trialwise

A calm, local-first tracker for free trials and the subscriptions you keep.

Add a trial's start date and length, or a subscription's next renewal date.
Trialwise works out the last safe day to cancel, or the next charge date, and
reminds you before it arrives. Dates, prices, account links, and notes stay in
your browser — no account, no cloud, no analytics, no data server.

Built by [ASDALE DYNAMICS, LLC](https://dylanasdale.github.io) as a small,
practical tool for avoiding surprise renewals.

## What it does

- **Tracks both kinds of plans.** A free trial has a start date and length. A
  subscription has an ongoing renewal schedule. Both live on one watchlist.
- **Keeps the important date visible.** Trial cards show the cancel-by date and
  first billing date. Subscription cards show the next renewal and how soon it
  arrives.
- **Repeats subscription reminders.** Choose 14, 7, 3, 1, or 0 days before a
  renewal. The reminder reappears before each new cycle, not just once.
- **Shows the money.** Cards display the post-trial or renewal price, billing
  cycle, and a monthly-equivalent total for open recurring plans.
- **Reminds you in more than one way.** In-app alerts are always available.
  Optional browser notifications work while the app is open or running in the
  background. Calendar export gives you an offline reminder you control.
- **Moves with you.** Export a complete JSON backup, a spreadsheet-friendly CSV,
  or upcoming dates as an iCalendar (`.ics`) file. Import JSON or CSV later.
- **Works offline.** Once loaded and installed, the app shell is cached by a
  service worker. Data never leaves the device.

## Start it locally

You need [Node.js](https://nodejs.org/) 20 or newer. There are no packages to
install.

1. Open a terminal in this folder.
2. Start the local static server:

   ```sh
   npm start
   ```

3. Open <http://127.0.0.1:4173> in Chrome, Edge, Firefox, or Safari.

Use `Ctrl+C` to stop the server. If port 4173 is busy:

```sh
PORT=4174 npm start
```

Then open <http://127.0.0.1:4174>.

`server.js` only serves the app's own files. There is no backend, database, or
outbound request from the app. A local HTTP server is still needed because
browsers restrict ES modules, service workers, and install prompts on `file://`.

### Install it like an app

- **Chrome or Edge on a computer:** use the install icon in the address bar, or
  the browser menu → **Install Trialwise**. The app's **Install** button does
  the same when the browser offers it.
- **Android:** browser menu → **Add to Home screen** or **Install app**.
- **iPhone or iPad:** open the site in Safari → **Share** → **Add to Home
  Screen**. Notification behavior varies by iOS version.

Installing is optional. Trialwise still works in a normal browser tab.

## Two kinds of entries

### Free trials

A trial entry uses:

- a start date,
- a trial length in days,
- an optional post-trial price and billing cycle,
- an optional cancellation or account link,
- a reminder lead time,
- and optional notes.

Trialwise treats the start date as day 1. A 7-day trial that starts on
October 1 has:

- **October 7** as the last safe cancel-by day;
- **October 8** as the first possible billing date.

Providers can define trial periods or cut-off times differently. Treat the
cancel-by date as a reminder to act early, then confirm the provider's actual
terms.

### Subscriptions

A subscription entry uses a **next renewal date** plus a weekly, monthly, or
yearly billing cycle. The date you enter is an *anchor*, not a one-time deadline.
Trialwise rolls it forward one cycle at a time so the plan stays current without
manual edits.

Anchoring also handles month ends and leap days without drifting. A monthly plan
anchored on January 31 renews on February 28 in a non-leap year, then returns to
March 31 — not March 28. The reminder is recalculated before each renewal, and a
same-day option is available for a final nudge.

If the provider changes the price or schedule, edit the entry. If you cancel a
plan, mark it canceled to stop reminders while keeping the record.

## The watchlist at a glance

The summary row answers three questions:

1. **Next deadline** — the soonest open trial cancel-by or subscription renewal.
2. **Open items** — everything not marked canceled, and how many dates fall
   within the next seven days.
3. **Monthly equivalent** — weekly, monthly, and yearly prices normalized to an
   approximate monthly total in USD.

Below that, cards are sorted by the next date that matters. Use **All**, **Open**,
and **Canceled** filters, or search names, notes, links, and entry types. Each
card has edit, mark-canceled/restore, account-link, and confirmed-delete actions.

## Reminders, honestly

In-app reminder banners appear on the watchlist. Browser notifications are
checked at most once a minute while the page is open, including when the tab is
hidden or the window is in the background.

A fully offline web app **cannot wake itself when it is completely closed**.
There is no push server. For a reminder that survives a closed browser:

1. Open **Reminders**.
2. Choose **Download calendar reminders**.
3. Import the `.ics` file into your calendar app.

The calendar file contains an all-day event for each open entry's next reminder
and next renewal or cancel-by date, with a display alarm where the calendar app
honors it. Because a recurring subscription has no end date, the export includes
its next cycle only — re-export periodically if you rely on the calendar alone.

Notification permission is optional. If you decline it, every other feature
still works.

## Backups and imports

Open **Data** in the app header.

### JSON

JSON is the complete, portable backup: every field, including kind, notes,
timestamps, status, and cancellation time. Use it to move to another browser or
restore after clearing site data.

### CSV

CSV is intended for spreadsheets and hand editing. Trialwise exports UTF-8 with
a byte-order mark so Excel recognizes the encoding, and neutralizes spreadsheet
formula injection. Exported values that needed protection are restored on
re-import.

The export uses these columns:

| Column | Notes |
| --- | --- |
| `id` | Optional. Stable ID used by **Merge** to update an existing entry. |
| `name` | Required. Up to 80 characters. |
| `type` | `trial` or `subscription`. Optional when the dates make it obvious. |
| `start_date` | Required for a trial. `YYYY-MM-DD`. |
| `trial_days` | Required for a trial. Whole number from 1 to 3650. |
| `renewal_date` | Required for a subscription. `YYYY-MM-DD` anchor. |
| `cost_after_trial` | Amount in USD. Also used as the subscription renewal cost. |
| `billing_cycle` | `weekly`, `monthly`, `yearly`, or `one-time`. Trials may be one-time; subscriptions may not. |
| `cancel_url` | Optional `http://` or `https://` link to the cancel or account page. |
| `reminder_days` | Days before the date to remind. 0–365; defaults to 3. |
| `status` | `active` or `canceled`; defaults to active. |
| `canceled_at` | Optional ISO timestamp; set automatically in the app. |
| `notes` | Optional account details, plan names, or cancellation steps. |
| `created_at`, `updated_at` | Optional ISO timestamps. |

A row with a `renewal_date` and no `start_date` is treated as a subscription even
when `type` is blank. A row with only trial fields is treated as a trial. Common
header spellings such as `startDate`, `renewalDate`, `service`, `price`,
`renewal_cost`, and `next_billing_date` are also recognized.

Example trial row:

```csv
name,type,start_date,trial_days,cost_after_trial,billing_cycle,reminder_days
Example Photo,trial,2026-10-20,7,4.50,monthly,3
```

Example subscription row:

```csv
name,type,renewal_date,cost_after_trial,billing_cycle,reminder_days
Example Stream,subscription,2026-10-30,12.99,monthly,3
```

Imports are validated row by row before anything changes. **Merge** updates
matching IDs and adds new entries; **Replace everything** swaps the current
watchlist for the file. Trialwise accepts up to 1,000 entries and import files up
to 5 MB.

## Your privacy

Data is saved in this browser's `localStorage` under `trialwise.data.v1`. It is
not encrypted, not synced, and not sent anywhere by Trialwise. That also means:

- Clearing browser site data deletes the watchlist.
- Anyone using the same browser profile can open the app and see it.
- There is no password or recovery service. A JSON export is the portable backup.

Avoid entering passwords, payment-card numbers, API keys, or other sensitive
secrets. Notes are for plan names and cancellation instructions, not credentials.
Account links open the provider's site only when you click them.

## Development

```sh
npm test       # unit tests with Node's built-in test runner
npm run check  # syntax-check browser, library, and server JavaScript
npm start      # serve locally at http://127.0.0.1:4173
```

The app has no runtime or development dependencies. The stack is plain HTML, CSS,
and ES modules, with tests written for Node 20+.

### Project layout

```text
app.js                  UI, storage, reminders, notifications, import/export
index.html              semantic app shell and dialogs
styles.css              responsive visual design
server.js               dependency-free local static server
sw.js                   offline app-shell cache and notification clicks
manifest.webmanifest    install metadata
lib/dates.js            trial and subscription date calculations
lib/data.js             validation, records, JSON/CSV backup and import
lib/csv.js              strict CSV parser and injection-safe writer
lib/ics.js              iCalendar reminder export
tests/                  Node test suites for dates, data, CSV, ICS, and server
icons/                  app icons (SVG plus generated PNGs)
assets/                 decorative artwork
```

### Browser support

Modern evergreen browsers are supported. Notification delivery, install prompts,
and service-worker behavior vary by browser and operating system. If
`localStorage` is blocked, Trialwise warns you and continues for the current
session only. The interface is intentionally light-theme for now.

## Known limitations

- The watchlist is tied to one browser profile. There is no account, cross-device
  sync, or automatic recovery.
- Browser notifications cannot reach a fully closed offline app. Calendar export
  is the fallback, and it includes only each entry's next occurrence.
- Subscriptions keep one rolling next-renewal date. Trialwise does not store a
  charge history or per-cycle price changes; edit the entry when terms change.
- Prices are USD only. Currency conversion is not provided.
- CSV import relies on recognized column names; there is no interactive column
  mapper.
- Canceled entries retain their dates, but the app does not verify that a provider
  processed a cancellation.
- Trialwise is a memory aid, not billing or legal advice. Always check the
  provider's own cancellation terms and deadlines.

## License

MIT. See [LICENSE](LICENSE).

Copyright (c) 2026 Asdale Dynamics, LLC.
