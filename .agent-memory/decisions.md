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

## 2026-05-13 - Release Packaging And Versioning

- Future release ZIPs must contain a top-level `prolific-watcher/` folder.
- Chrome runtime files live inside that folder, so the extracted folder can be
  copied directly over the local Chrome plugin folder.
- Do not create ZIPs automatically after every update; create them only on owner request.
- Every runtime update must bump `manifest.json` version before packaging:
  - patch bump for small fixes/cleanups, e.g. `1.5.2` -> `1.5.3`.
  - minor bump for larger updates, e.g. `1.5.x` -> `1.6.0`.
- Repo-only changes such as memory, hooks, docs, or packaging scripts do not require
  a Chrome extension version bump.
