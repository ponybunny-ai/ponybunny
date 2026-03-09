# 13. Compatibility Window and Rollback Drill Playbook

## Compatibility window (E1)

- Legacy RPC compatibility is kept for two release cycles after Phase 4 stabilizes.
- During the compatibility window, legacy entry points remain callable but are marked deprecated in release notes.
- Target deprecation order:
  1. Phase 2 complete: stop exposing client-side fast-path entry points.
  2. Phase 4 complete + 2 stable release cycles: remove legacy RPC paths.

## Rollback controls (E2)

- Runtime rollback switch: `system.runtime.rollout.update` with `rollbackToLegacy: true`.
- Rollback path:
  1. Connect to gateway control plane.
  2. Apply rollback switch.
  3. Verify mode is `legacy` through `system.runtime.rollout.status`.

## 15-minute recovery drill script

Use:

```bash
node scripts/refine/rollback-drill.mjs --url ws://127.0.0.1:18789
```

Behavior:

- Captures rollout status before mutation.
- Applies a canary mutation (`system.runtime.rollout.update`).
- Applies rollback (`rollbackToLegacy: true`).
- Polls status until mode becomes `legacy`.
- Emits JSON with:
  - `durationMs`
  - `recoveredWithin15Minutes`
  - `beforeMode` / `mutatedMode` / `finalMode`

The script exits with non-zero code when recovery is not completed within 15 minutes.
