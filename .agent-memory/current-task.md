# Current Task Checklist

Last updated: 2026-05-13

## Active Task: Live Mode Auth Bugfix

- [x] Read startup protocol, memory files, and git status.
- [x] Re-check why version `1.5.3` still showed Background.
- [x] Identify likely missing login token in the Live-mode Prolific request.
- [x] Extend `scripts/check-live-heartbeat.js` so the current code fails.
- [x] Bump `manifest.json` from `1.5.3` to `1.5.4`.
- [x] Add Authorization header to the Live-mode request.
- [x] Add protocol reminder to close completed or unused Sub-Agents when supported.
- [x] Run required verification.
- [x] Update memory files and final git status.

## Constraints

- Do not change API URLs, notification behavior, token extraction format, or earnings logic.
- Do not create a ZIP.
- Do not touch `releases/prolific-watcher-v1.5.2.zip`.
- Do not touch `releases/prolific-watcher-v1.5.3.zip`.
- Do not commit.
- Sub-Agent tooling is not available in this session, so the Orchestrator is keeping the implementation small and directly verified.

## Verification

- Pre-fix `node scripts/check-live-heartbeat.js` exited 1 and reported:
  - manifest version was `1.5.3`, expected `1.5.4`.
  - Live polling did not read the current Prolific login token.
  - Live polling did not send the token in the Authorization header.
- Current working tree `node scripts/check-live-heartbeat.js` exited 0:
  - `Live auth and heartbeat regression check passed.`
- `node --check content.js` exited 0.
- `node --check background.js` exited 0.
- `node --check popup.js` exited 0.
- `node --check scripts/check-live-heartbeat.js` exited 0.
- `node --check content.js background.js popup.js scripts/check-live-heartbeat.js` exited 0.
- `git diff --check` exited 0.
- Final `git status --short` showed modified runtime, protocol, hook, and
  memory files. The untracked `releases/prolific-watcher-v1.5.2.zip` and
  `releases/prolific-watcher-v1.5.3.zip` were still present and were not touched.
