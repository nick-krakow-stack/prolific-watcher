# Next Steps

Last updated: 2026-05-13

## Immediate

- Refresh `README.md` so it matches extension version `1.5.3`.
- Optional: manually reload the unpacked Chrome extension after the live
  heartbeat fix and confirm the popup stays in Live mode with an unchanged or
  empty studies list.

## Product Backlog

- Consider splitting `background.js` into smaller modules if the project gains a build step.
- Consider adding a broader automated regression harness for pure helper logic.
- Decide release naming convention after the first packaged ZIP is created.

## Release Routine

- On explicit request, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-extension.ps1
```

- Inspect the ZIP contents.
- Confirm entries are under top-level `prolific-watcher/` and contain no
  repository-only files.
- Before packaging a runtime update, update `manifest.json` version:
  - patch for small changes, e.g. `1.5.2` -> `1.5.3`.
  - minor for larger updates, e.g. `1.5.x` -> `1.6.0`.
- Commit the generated ZIP under `releases/` only when requested.
