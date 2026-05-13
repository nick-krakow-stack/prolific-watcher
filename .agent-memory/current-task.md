# Current Task Checklist

Last updated: 2026-05-13

## Active Task: Package ZIP Top-Level Folder And Version Routine

- [x] Read startup protocol, memory files, and git status.
- [x] Demonstrate current package layout lacks `prolific-watcher/`.
- [x] Update `scripts/package-extension.ps1`.
- [x] Re-run packaging and inspect ZIP entries.
- [x] Confirm no repository-only files are included.
- [x] Record that ZIPs are only created on explicit request, not automatically.
- [x] Record extension version bump routine.
- [x] Run final git status and report changed files.

## Requirements

1. Generated release ZIPs must contain a top-level `prolific-watcher/` folder.
2. Chrome runtime files must live inside that folder.
3. Repository-only files such as `.agent-memory`, `.codex`, `scripts`, Markdown docs, release tooling, and `.tmp` must not be included.
4. Do not touch runtime extension files.
5. Do not commit.
6. Do not create a new release ZIP now; only remember the future behavior.
7. Runtime updates must bump `manifest.json` version:
   - patch for small changes, e.g. `1.5.2` -> `1.5.3`.
   - minor for larger updates, e.g. `1.5.x` -> `1.6.0`.
8. Repo-only changes do not require an extension version bump.

## Verification

- Pre-change package check to temp output showed root-level entries such as `manifest.json`, `background.js`, and `icons\...`, with no top-level `prolific-watcher/` folder.
- Post-change package check to temp output showed entries including `prolific-watcher/manifest.json`, `prolific-watcher/background.js`, `prolific-watcher/content.js`, `prolific-watcher/popup.html`, `prolific-watcher/popup.css`, `prolific-watcher/popup.js`, and `prolific-watcher/icons/...`.
- Post-change ZIP inspection reported `MISSING_EXPECTED_COUNT=0`, `BAD_PREFIX_COUNT=0`, and `FORBIDDEN_COUNT=0`.
- Final temp package inspection reported `ENTRY_COUNT=18`, `MISSING_REQUIRED_COUNT=0`, `ICON_ENTRY_COUNT=12`, `BAD_PREFIX_COUNT=0`, and `FORBIDDEN_COUNT=0`.
- `git diff --check` exited 0.
