# Handoff

Last updated: 2026-05-13 17:12:28 +02:00
Update mode: Stop

## Latest Notes

Automatic handoff snapshot written by .codex/hooks/agent-protocol.ps1.
Current task status is tracked in .agent-memory/current-task.md.
Owner, browser, and review feedback are persisted in .agent-memory/feedback.md.

## Git Snapshot

- Branch: main
- Last commit: 2e8479d Initial commit

## Working Tree

~~~text
?? .agent-memory/
?? .codex/
?? .gitattributes
?? AGENTS.md
?? releases/
?? scripts/
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
- Keep Chrome extension release ZIPs limited to runtime extension files only.
