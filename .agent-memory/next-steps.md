# Next Steps

Last updated: 2026-05-13

## Immediate

- Refresh `README.md` so it matches extension version `1.5.2`.

## Product Backlog

- Consider splitting `background.js` into smaller modules if the project gains a build step.
- Decide whether to add a lightweight automated regression harness for pure helper logic.
- Decide release naming convention after the first packaged ZIP is created.

## Release Routine

- On explicit request, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-extension.ps1
```

- Inspect the ZIP contents.
- Commit the generated ZIP under `releases/` only when requested.
