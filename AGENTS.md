# Prolific Watcher Agent Protocol

This file is the shared operating protocol for Codex work in this repository.

## Required Startup

Before changing code, the active orchestrator must read these files in order:

1. `AGENTS.md`
2. `.agent-memory/current-state.md`
3. `.agent-memory/handoff.md`
4. `.agent-memory/next-steps.md`

Then run:

```powershell
git status --short
```

Use code as the final source of truth when documentation conflicts. `manifest.json`
is the source of truth for the Chrome extension version.

## Orchestrator-Only Rule

Codex acts as the Orchestrator in this repository.

- The Orchestrator coordinates, investigates, plans, reviews, integrates, and reports.
- Implementation work should be delegated to Sub-Agents whenever the environment supports it.
- The Orchestrator selects the Sub-Agent model and reasoning effort according to task risk:
  - routine scoped edits: faster coding model, medium reasoning
  - risky behavior changes, auth, persistence, or release logic: stronger model, high reasoning
  - architecture, security, or hard-to-test changes: strongest available model, high or xhigh reasoning
- Sub-Agents must be given concrete ownership of files or responsibilities.
- The Orchestrator reviews Sub-Agent results before final delivery.
- The Orchestrator keeps `.agent-memory/current-task.md` updated as the live checklist.

If Sub-Agent tooling is unavailable, the Orchestrator must state that limitation and keep
changes small, explicit, and well verified.

## Project Scope

`prolific-watcher` is a Chrome Manifest V3 extension for monitoring Prolific studies and
tracking earnings.

Core files:

- `manifest.json`
- `background.js`
- `content.js`
- `popup.html`
- `popup.css`
- `popup.js`
- `icons/*`

Repository-only files such as `.agent-memory`, `.codex`, `scripts`, Markdown docs, and
release tooling must not be included in the Chrome extension ZIP.

## GitHub Workflow

- GitHub is the only remote target.
- Remote: `https://github.com/nick-krakow-stack/prolific-watcher.git`
- Main branch: `main`
- No Cloudflare, Wrangler, D1, KV, R2, or Pages deployment rules apply here.
- Commit memory/protocol changes separately from product behavior changes when practical.

## Memory Rules

Keep the central memory files current:

- `.agent-memory/current-state.md`: compact project state and known architecture.
- `.agent-memory/current-task.md`: live checklist for the active task.
- `.agent-memory/feedback.md`: owner feedback, browser feedback, review notes.
- `.agent-memory/handoff.md`: latest continuation point and git snapshot.
- `.agent-memory/next-steps.md`: prioritized backlog.
- `.agent-memory/decisions.md`: durable workflow/product/architecture decisions.
- `.agent-memory/progress.md`: chronological work log.

Never write secrets, tokens, passwords, private API keys, raw bearer tokens, or personal
Prolific data into memory files.

## Release Packaging

On explicit request, create a Chrome extension ZIP with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-extension.ps1
```

The ZIP must contain a top-level `prolific-watcher/` folder with only Chrome
extension runtime files inside it:

- `prolific-watcher/manifest.json`
- `prolific-watcher/background.js`
- `prolific-watcher/content.js`
- `prolific-watcher/popup.html`
- `prolific-watcher/popup.css`
- `prolific-watcher/popup.js`
- `prolific-watcher/icons/*`

The ZIP should be written under `releases/` and may be committed to GitHub when requested.

Do not create a new ZIP automatically after every change. Create one only when the owner
explicitly asks for a package.

## Versioning Routine

Every Chrome runtime update must update `manifest.json` version before packaging:

- Small fixes and cleanups: patch bump, e.g. `1.5.2` -> `1.5.3`.
- Larger feature updates or meaningful behavior changes: minor bump, e.g. `1.5.3` -> `1.6.0`.
- Packaging, memory, hooks, docs, or repository-only changes do not require an extension
  version bump unless runtime files also changed.

The package filename follows the `manifest.json` version.

## Verification Before Completion

For code changes, run checks appropriate to the change. At minimum for JavaScript edits:

```powershell
node --check background.js
node --check content.js
node --check popup.js
```

For release packaging changes, run the packaging script and inspect the ZIP contents.

Before final response on meaningful work:

1. Update relevant memory files.
2. Run `git status --short`.
3. Report what changed and what was verified.
