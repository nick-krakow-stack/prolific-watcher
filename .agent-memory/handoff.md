# Handoff

Last updated: 2026-05-13
Update mode: Live mode auth fix

## Latest Notes

Live mode auth bugfix is implemented in the working tree and verified. Current
task status is tracked in .agent-memory/current-task.md. No ZIP was created and
no commit was made.

## Git Snapshot

- Branch: main
- Last commit: 14ff53b Finalize live mode notes

## Working Tree

~~~text
Runtime files updated for version 1.5.4 live auth behavior. The Live-mode
content poll now reads the current Prolific login token and sends it in the
Authorization header before sending Live updates or heartbeats. Existing
untracked release ZIPs were present and were not modified intentionally. No ZIP
was created.
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
