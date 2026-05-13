# Current Task Checklist

Last updated: 2026-05-13

## Active Task: Low-Risk Dead Code Cleanup

- [x] Read startup protocol, memory files, and git status.
- [x] Delegate implementation cleanup to a Sub-Agent.
- [x] Review implementation diff.
- [x] Delegate independent cleanup review to a review Sub-Agent.
- [x] Run local verification checks.
- [x] Commit and push cleanup.

## Requirements

1. Remove only demonstrably unused code.
2. Do not change polling, auth, notifications, exports, storage shape, or UI behavior.
3. Add a lightweight check for the removed dead-code markers.
4. Keep Chrome runtime files valid JavaScript.

## Cleanup Result

- Removed unused `ALARM_KEEPALIVE` from `background.js`.
- Removed unused `tryRefreshTokenFromTabBool()` from `background.js`.
- Removed unused `formatGbp()` from `popup.js`.
- Removed unused `formatEur()` from `popup.js`.
- Removed unused `STATUS_APPROVED`, `STATUS_AWAITING`, `STATUS_SCREENED`, and `STATUS_PENDING_DUMMY` from `popup.js`.
- Added `scripts/check-dead-code-cleanup.js`.

## Verification

- `node scripts\check-dead-code-cleanup.js`
- `node --check background.js`
- `node --check popup.js`
- `node --check content.js`
- `node --check scripts\check-dead-code-cleanup.js`
- `git diff --check`
- Review Sub-Agent reported no findings.
- Commit `b19c86c Remove unused extension code` pushed to `origin/main`.
