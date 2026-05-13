# Current Task Checklist

Last updated: 2026-05-13

## Active Task: Live Mode Heartbeat Bugfix

- [x] Read startup protocol, memory files, and git status.
- [x] Add a lightweight regression/static check for live heartbeat behavior.
- [x] Run the new check against current code and confirm it fails.
- [x] Bump `manifest.json` from `1.5.2` to `1.5.3`.
- [x] Update live content polling to send the first successful update even when empty.
- [x] Add an unchanged-signature live heartbeat without reprocessing studies.
- [x] Use a live freshness window compatible with the 15s hidden-tab interval.
- [x] Run required verification.
- [x] Update memory files and final git status.
- [x] Commit and push fix `5c7ec44 Fix live mode heartbeat`.

## Constraints

- Do not change API URLs, notification behavior, auth token extraction, or earnings logic.
- Do not create a ZIP.
- Do not touch `releases/prolific-watcher-v1.5.2.zip`.

## Verification

- Pre-fix `node scripts/check-live-heartbeat.js` exited 1 and reported the missing
  heartbeat behavior, old freshness literal, and version `1.5.2`.
- Post-fix `node scripts/check-live-heartbeat.js` exited 0.
- `node --check content.js` exited 0.
- `node --check background.js` exited 0.
- `node --check popup.js` exited 0.
- `node --check scripts/check-live-heartbeat.js` exited 0.
- `git diff --check` exited 0.
- Final `git status --short` showed modified runtime and memory files, new
  `scripts/check-live-heartbeat.js`, and the pre-existing untracked
  `releases/prolific-watcher-v1.5.2.zip`.
- Commit `5c7ec44 Fix live mode heartbeat` pushed to `origin/main`.
