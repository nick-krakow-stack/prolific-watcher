# Current Task Checklist

Last updated: 2026-05-13

## Active Task: Codex Hooks And Release Packaging Setup

- [x] Review `supplement-stack` hook and memory setup.
- [x] Decide which hooks and memory files apply to `prolific-watcher`.
- [x] Add Orchestrator-only and Sub-Agent delegation rules.
- [x] Add minimal Codex hook configuration.
- [x] Add central memory files.
- [x] Add release ZIP packaging routine.
- [x] Run verification checks.
- [ ] Commit and push setup changes.

## Requirements

1. Keep memory-file workflow from `supplement-stack`.
2. Do not include Cloudflare, Wrangler, D1, KV, R2, or Pages deployment rules.
3. Do not include multi-KI coordination rules beyond Codex Orchestrator/Sub-Agent operation.
4. Codex should act as Orchestrator and delegate implementation work to Sub-Agents where tooling supports it.
5. Add a packaging routine that creates a Chrome extension ZIP only on explicit request.
6. ZIP packages must contain only Chrome runtime files, not hooks, Markdown, scripts, memory files, or Git files.
7. ZIP packages can be committed to GitHub when requested.

## Verification

- `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-extension.ps1 -Suffix test`
- ZIP content inspection confirmed only runtime extension files were included.
- Test ZIP was removed after verification.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\.codex\hooks\agent-protocol.ps1 -Mode Stop`
- `node --check background.js`
- `node --check content.js`
- `node --check popup.js`
- `git diff --check`
