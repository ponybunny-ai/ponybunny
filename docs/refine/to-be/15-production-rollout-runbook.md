# 15. Production Rollout Runbook

## Scope

This runbook is the operator handoff for production rollout after refine Phase-0..Phase-2 closure.

Primary references:

- `docs/refine/to-be/11-acceptance-review-matrix.md`
- `docs/refine/to-be/12-stage-summary-and-release-readiness.md`
- `docs/refine/to-be/13-compatibility-and-rollback-playbook.md`
- `docs/refine/to-be/14-migration-baseline-comparison.md`
- `docs/refine/to-be/16-production-threshold-matrix.md`

## Pre-flight checklist

1. Build and focused regression are green:

```bash
npm test -- test/gateway test/scheduler-daemon test/cli/tui
npm run -s build
```

2. Control plane is reachable and can return rollout status:

```bash
pb gateway status
```

3. Save pre-cutover baseline snapshot:

```bash
mkdir -p docs/refine/to-be/artifacts
# capture from control-plane response body into file
cp /path/to/runtime-rollout-status-pre.json docs/refine/to-be/artifacts/runtime-rollout-status-pre.json
```

4. Confirm rollback script is executable in current environment:

```bash
node scripts/refine/rollback-drill.mjs --url ws://127.0.0.1:18789 --timeout-ms 120000 --poll-ms 1000
```

## Cutover procedure

1. Start with shadow/canary posture using runtime rollout update.
2. Observe 15-minute stabilization window and monitor thresholds in `docs/refine/to-be/16-production-threshold-matrix.md`.
3. If no rollback trigger fires, increase traffic lane percentages in planned increments.
4. Keep compatibility window active per `docs/refine/to-be/13-compatibility-and-rollback-playbook.md`.

## Monitoring loop (during rollout)

Every 5 minutes:

1. Pull latest runtime status and telemetry snapshot.
2. Compare against threshold matrix.
3. Record result in rollout log (`time`, `snapshot`, `status`, `action`).

Suggested log format:

```text
<timestamp> | window=5m | session_message_success_rate=... | run_success_rate=... | ipc_timeout_rate=... | misroute_total=... | action=hold|promote|rollback
```

## Rollback trigger and action

If any `rollback_now` condition is met in `docs/refine/to-be/16-production-threshold-matrix.md`:

1. Execute rollback command path immediately.
2. Confirm rollout mode returns to `legacy`.
3. Re-check core chain health for 15 minutes.
4. Preserve incident timeline with snapshot artifacts.

Rollback command:

```bash
node scripts/refine/rollback-drill.mjs --url ws://127.0.0.1:18789
```

## Post-cutover closure

1. Save post-cutover snapshot:

```bash
cp /path/to/runtime-rollout-status-post.json docs/refine/to-be/artifacts/runtime-rollout-status-post.json
```

2. Run baseline comparison and export report:

```bash
node scripts/refine/compare-rollout-baseline.mjs \
  --before docs/refine/to-be/artifacts/runtime-rollout-status-pre.json \
  --after docs/refine/to-be/artifacts/runtime-rollout-status-post.json \
  --out docs/refine/to-be/artifacts/baseline-comparison.md
```

3. Mark release gate pass only when:

- baseline comparison is non-regressing,
- no active rollback trigger remains,
- compatibility window notes are recorded in release notes.
