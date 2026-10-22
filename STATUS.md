# Trialwise — project status

**Status: complete and verified on October 22, 2026.**

Trialwise is a local-first free-trial and subscription tracker built for
Asdale Dynamics, LLC. It is a dependency-free web app: no accounts, analytics,
tracking, cloud sync, or data backend.

## What was built

- Trial entry with start date, length, reminder lead time, post-trial price,
  billing cycle, cancel-page link, and notes.
- Automatic last-safe-day-to-cancel and first-billing calculations, with a live
  preview while editing.
- Dashboard with next deadline, open-trial count, potential monthly cost,
  status phases, progress, reminders, search, and filters.
- Mark canceled, restore, edit, and confirmed delete flows.
- In-app reminders plus optional browser notifications while the app is open or
  running in the background.
- iCalendar export with reminder and cancel-by events and display alarms.
- JSON backup/restore and CSV spreadsheet export/import, including merge and
  replace modes, validation, row-specific errors, formula-injection protection,
  and camelCase or snake_case CSV headers.
- Local-only storage in `localStorage` with cross-tab synchronization and
  storage-blocked fallbacks.
- Installable PWA with an offline app shell cached by a service worker.
- Responsive, keyboard-accessible interface with reduced-motion and screen
  reader support.
- Security-conscious static server: path traversal protection, strict document
  CSP, scoped service-worker CSP, and restrictive browser headers.
- README with setup, usage, backup, privacy, development, and limitation notes.
- MIT license with Asdale Dynamics, LLC copyright.
- 40 automated tests covering dates, validation, CSV, JSON, ICS, and server
  behavior.

## How to run it

Requires Node.js 20 or newer. There is nothing to install.

```sh
npm start
```

Open <http://127.0.0.1:4173>. Stop with `Ctrl+C`. To use another port:

```sh
PORT=4174 npm start
```

The local server only serves static files. Trial data stays in the browser.

## How to test it

```sh
npm test       # 40 tests using Node's built-in test runner
npm run check  # syntax-check all browser, library, and server JavaScript
```

## Verification results

- `npm test`: **40 passed, 0 failed**.
- `npm run check`: **passed**.
- ESLint static analysis: **0 errors, 0 warnings**.
- Browser end-to-end run in Google Chrome against a fresh local server:
  - Welcome and dashboard rendered.
  - Empty-form validation worked.
  - Add, live date preview, normalization, persistence, reload, and edit worked.
  - Mark canceled, restore, filters, search, and empty-state actions worked.
  - CSV import worked; invalid CSV showed an actionable error.
  - JSON, CSV, and ICS downloads completed with valid content.
  - Reminders dialog worked.
  - Service worker cached the complete app shell; an offline reload still
    showed saved trials.
  - Mobile layout at 390 px had no horizontal overflow.
  - **0 console errors, 0 page errors, 0 failed requests.**
- Axe WCAG 2.0/2.1 A and AA scans: **0 violations** on the welcome screen,
  populated desktop and mobile dashboards, all dialogs, form validation errors,
  and mixed active/canceled/overdue states.
- Final visual review completed at desktop and mobile sizes.

Browser end-to-end and Axe checks used temporary tooling outside the repository;
they are not dependencies of the app, which remains dependency-free.

## Known gaps

- Data is tied to one browser profile. There is no account, sync, or automatic
  recovery. Clearing site data removes trials, so JSON exports are the portable
  backup.
- Notifications cannot wake a fully closed offline web app. The calendar export
  is the reliable fallback outside the app.
- Trialwise is trial-first: it tracks one trial window, its cancellation
  deadline, and the first post-trial billing date. It does not maintain a
  separate perpetual renewal calendar for subscriptions kept after conversion.
- Prices are USD only, and the interface is light-theme only.
- Imported CSV headers must use recognized names; there is no interactive
  column-mapping screen.
- Browser notifications, install prompts, and OS-level alert delivery vary by
  browser and platform.
- Exported backups are unencrypted plain text and should be stored accordingly.

## License and credit

MIT. Copyright (c) 2026 Asdale Dynamics, LLC.

Built by [Asdale Dynamics, LLC](https://dylanasdale.github.io).
