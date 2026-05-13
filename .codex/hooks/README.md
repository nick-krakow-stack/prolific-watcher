# Codex Hook Protocol

This repository uses a minimal Codex hook setup for memory continuity.

Active hooks in `.codex/hooks.json`:

- `UserPromptSubmit`
- `Stop`

Intentionally inactive:

- `PreCompact`
- `PreToolUse`
- `PostToolUse`

Hook goals:

- `UserPromptSubmit` captures owner feedback into `.agent-memory/feedback.md`.
- `Stop` refreshes `.agent-memory/handoff.md` and `.agent-memory/progress.md`.
- `.agent-memory/current-task.md` remains the live checklist.
- `.agent-memory/current-state.md`, `.agent-memory/next-steps.md`, and
  `.agent-memory/decisions.md` provide continuity between sessions.

The hook script is intentionally quiet:

- no network actions
- no shell side effects outside memory files
- robust when hook payload is missing or invalid
- no Cloudflare, deployment, or browser automation behavior

The repository protocol is in `AGENTS.md`.
