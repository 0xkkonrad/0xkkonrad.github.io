# Waffle

Waffle lives at [kkonrad.com/waffle/](https://kkonrad.com/waffle/). Its source is `static/waffle/`; Hugo copies it unchanged. It has no build dependencies, accounts, analytics, or backend.

## Daily flow

Set the morning plan and commit. Each session lasts 30 minutes. Rate every completed session as focused or waffle; the rating consumes one slot in the same daily limit. Tap either budget to edit the committed counts. Completed and active sessions keep their slots. Increasing an ended day’s total reopens it.

Pause before ending a day early. Unfinished minutes are recorded separately and do not count as a full session. A streak day meets its focus target and stays within its waffle allowance. Planned days off hold a streak without adding to it. Correcting a historical rating recalculates the streak.

The calendar uses the approved D waffle patches: one fixed-size tile per session, dark for focus and yellow for waffle. Days off use `-`. The logo returns to the timer.

## Installation and saved data

In Android Chrome, open Waffle and use the browser’s Install app / Add to Home screen command, or the app’s install option. Installation opens it without browser controls. All assets, including fonts, are local and cached after the first successful online visit.

IndexedDB stores plans, ratings, settings, and the active timer on the current device/browser. Transactions serialize changes across windows. Running timers use a persisted deadline, so returning after a reload or suspension recovers the elapsed time. Paused timers preserve their remaining time. Sessions crossing midnight belong to the date they started.

Android can suspend or close a PWA. Sound and notifications are best effort while its page can run; this static app cannot guarantee an alarm after the OS suspends it. A completed session still waits for its rating on return. Keep screen on is optional and may be declined by battery saver.

Settings include local storage protection and JSON backup download/restore. Protection depends on browser policy; clearing site data removes the local history. Restore asks for confirmation and keeps the previous state in IndexedDB under `before-restore`. Backups contain no credentials. There is no automatic device sync.

## Development and checks

Serve the site’s `static/` directory over localhost, using port 8777 when free. Open `http://localhost:8777/waffle/index.html`. Use a fresh browser profile or unregister this app’s service worker while changing cached assets.

```sh
node --test tests/waffle/model.test.mjs
WAFFLE_PLAYWRIGHT=/absolute/path/to/@playwright/test node tests/waffle/browser.cjs
```

The browser suite needs Playwright and its Chromium browser. `WAFFLE_URL` overrides the app URL (include the trailing slash); `WAFFLE_QA` selects a screenshot/output directory. Test histories stay in isolated browser contexts. No fixture or timer-skip controls ship in the app.

Coverage includes pause/reload recovery, deadlines, midnight ownership, edited limits, mandatory ratings, corrections, streaks, off days, undo, two-window rating races, offline use, backups, calendar tiles, and small/large layouts.

## Deployment

Push to the existing site’s `master` branch. `.github/workflows/deploy.yml` builds Hugo and deploys GitHub Pages. Bump the `waffle-shell-…` cache name in `sw.js` whenever changing a cached asset. The new worker waits; existing users apply it through “update available” in the options sheet. Timer state is saved before an update reload.

The manifest and worker are scoped to `/waffle/`. They do not cache or control the main site or 15:60. A rollback should be a new commit restoring the desired app files with a new cache name, then the same deployment workflow. Never clear users’ IndexedDB as part of a code rollback.

Approved design: L33a Grin logo, IBM Plex Mono 400/500, Butter palette, large countdown, tiny budget blocks, no bottom tabs. Font licensing is in `static/waffle/fonts/OFL.txt`.
