# Current State

Last updated: 2026-05-13

## Project

`prolific-watcher` is a Chrome Manifest V3 extension for monitoring Prolific
studies and tracking Prolific earnings.

## Repository

- Local path: `C:\Users\email\prolific-watcher`
- GitHub remote: `https://github.com/nick-krakow-stack/prolific-watcher.git`
- Main branch: `main`
- Initial commit pushed: `2e8479d Initial commit`
- Workflow setup commit pushed: `afd34f8 Add Codex workflow and packaging routine`

## Extension Runtime Files

- `manifest.json`
- `background.js`
- `content.js`
- `popup.html`
- `popup.css`
- `popup.js`
- `icons/*`

Only these runtime files should go into Chrome extension ZIP packages.

## Architecture Summary

- `background.js` is the service worker. It owns settings, polling, Prolific API
  calls, notifications, earnings sync, balance sync, currency rates, exports, and
  Chrome runtime message handling.
- `content.js` runs on `https://app.prolific.com/*`. It extracts the OIDC access
  token and user id from browser storage and provides live studies polling from
  the Prolific tab.
- `popup.*` implements the extension popup UI, status rendering, earnings tiles,
  notification history, quote metrics, settings, and export modal.

## Known Notes

- `manifest.json` currently reports version `1.5.2`.
- `README.md` still describes older `v1.2` architecture and should be refreshed.
- The codebase is plain JavaScript/HTML/CSS; there is no package manager or test
  harness yet.
- Baseline syntax checks passed before protocol setup:
  - `node --check background.js`
  - `node --check content.js`
  - `node --check popup.js`
- Codex memory and hook setup is installed under `.agent-memory` and `.codex`.
- Release packaging is available through `scripts/package-extension.ps1`.
- The packaging routine was test-run with suffix `test`; the ZIP contained only
  runtime extension files and the test artifact was removed.
- Low-risk dead-code cleanup removed unused helper declarations from
  `background.js` and `popup.js`; `scripts/check-dead-code-cleanup.js` guards
  against those exact markers returning.
- Cleanup commit pushed: `b19c86c Remove unused extension code`.

## Operating Model

- Codex acts as Orchestrator only.
- Implementation should be delegated to Sub-Agents when tooling supports it.
- No Cloudflare deployment workflow applies.
- GitHub is the only remote target.
