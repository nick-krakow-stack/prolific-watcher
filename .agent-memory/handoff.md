# Handoff

Last updated: 2026-05-13
Update mode: Live mode heartbeat bugfix

## Latest Notes

Live mode heartbeat bugfix implemented and awaiting final handoff. Current task
status is tracked in .agent-memory/current-task.md.

## Git Snapshot

- Branch: main
- Last commit: b19c86c Remove unused extension code

## Working Tree

~~~text
Runtime files updated for version 1.5.3 live heartbeat behavior, plus a new
static regression check under scripts/. Existing untracked
releases/prolific-watcher-v1.5.2.zip was present at startup and was not
modified intentionally. No ZIP was created.
~~~

## Current State Summary

See .agent-memory/current-state.md.

## Next Planned Work

See .agent-memory/next-steps.md.

## Required Startup For Next Agent

1. Read AGENTS.md.
2. Read .agent-memory/current-state.md.
3. Read this handoff.
4. Read .agent-memory/next-steps.md.
5. Run git status --short.

## Operating Constraints

- Codex acts as Orchestrator only.
- Delegate implementation to Sub-Agents whenever tooling supports it.
- No Cloudflare deployment workflow applies to this repository.
- Do not write secrets, tokens, passwords, raw bearer tokens, or personal Prolific data into memory files.
- Keep Chrome extension release ZIPs limited to runtime extension files under
  top-level `prolific-watcher/`.
