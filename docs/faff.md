# Faff

Faff lives at [kkonrad.com/faff/](https://kkonrad.com/faff/). Its source and automated checks live in [the standalone Faff repository](https://github.com/0xkkonrad/faff). Releases copy that repository’s `web/` directory to `static/faff/`; Hugo publishes those files unchanged. It has no build dependencies, accounts, analytics, or backend.

## Daily flow

Set the morning plan and commit. Each session lasts 30 minutes. Rate every completed session as focused or faff; the rating consumes one slot in the same daily limit. Tap either budget to edit the committed counts. Completed and active sessions keep their slots. Increasing an ended day’s total reopens it.

Pause before ending a day early. Unfinished minutes are recorded separately and do not count as a full session. A streak day meets its focus target and stays within its faff allowance. Planned days off hold a streak without adding to it. Correcting a historical rating recalculates the streak.

The calendar shows session tiles: one fixed-size tile per session, dark for focus and citron for faff. Days off use `-`. The logo returns to the timer.

## Installation and saved data

In Android Chrome, open Faff and use the browser’s Install app / Add to Home screen command, or the app’s install option. Installation opens it without browser controls. All assets, including fonts, are local and cached after the first successful online visit.

IndexedDB stores plans, ratings, settings, and the active timer on the current device/browser. Transactions serialize changes across windows. Running timers use a persisted deadline, so returning after a reload or suspension recovers the elapsed time. Paused timers preserve their remaining time. Sessions crossing midnight belong to the date they started.

Android can suspend or close a PWA. Sound and notifications are best effort while its page can run; this static app cannot guarantee an alarm after the OS suspends it. A completed session still waits for its rating on return. Keep screen on is optional and may be declined by battery saver.

Settings include local storage protection and JSON backup download/restore. Protection depends on browser policy; clearing site data removes the local history. Restore asks for confirmation and keeps the previous state in IndexedDB under `before-restore`. Backups contain no credentials. There is no automatic device sync.

## Development and checks

Use the [standalone repository’s development and test commands](https://github.com/0xkkonrad/faff#checks). They cover model behavior, browser workflows, keyboard access, concurrent backup restoration, and two-window PWA upgrades with running, paused, and completed timers.

The [22 September QA report](https://github.com/0xkkonrad/faff/blob/main/docs/qa-2026-09-22.md) records verified fixes, performance measurements, rejected findings, and testing limits.

## Deployment

Push to the existing site’s `master` branch. `.github/workflows/deploy.yml` builds Hugo and deploys GitHub Pages. Bump the `faff-shell-…` cache name in `sw.js` whenever changing a cached asset. The new worker waits; existing users apply it through “update available” in the options sheet. Timer state is saved before an update reload.

The manifest and worker are scoped to `/faff/`. They do not cache or control the main site or 15:60. A rollback should be a new commit restoring the desired app files with a new cache name, then the same deployment workflow. Never clear users’ IndexedDB as part of a code rollback.

Provisional design: 01A Loose end logo, IBM Plex Mono 400/500, paper/graphite/citron palette, large countdown, tiny budget blocks, no bottom tabs. Font licensing is in `static/faff/fonts/OFL.txt`.

The [logo picker](https://kkonrad.com/faff/brand/index.html) has 10 directions and 5 variations each. The former app route contains only the redirect, replacement service worker, and install manifest from the source repository’s `legacy/` directory. Keep these files for installed apps and old bookmarks. Installed users apply the existing “update available” control to move to Faff; first visits redirect immediately.

Faff migrates the previous database on first open and accepts old backups. The source repository’s migration suite verifies running, paused, and completed timers across the route change. The previous database is retained; new Faff state takes precedence thereafter.
