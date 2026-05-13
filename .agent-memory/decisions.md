# Decisions

## 2026-05-13 - Workflow Setup

- Use GitHub as the only remote target for this repository.
- Do not include Cloudflare, Wrangler, D1, KV, R2, or Pages workflow rules.
- Keep the central memory workflow from `supplement-stack`:
  - current state
  - current task
  - feedback
  - handoff
  - next steps
  - decisions
  - progress
- Use only two Codex hooks:
  - `UserPromptSubmit`
  - `Stop`
- Keep hook behavior quiet and local-only.
- Codex operates as Orchestrator and delegates implementation to Sub-Agents when tooling supports it.
- Chrome release ZIPs are created only on explicit request and include only runtime extension files.
