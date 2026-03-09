# 16. Production Threshold Matrix

## Purpose

This matrix defines operator actions for rollout windows, using the metric model from `docs/refine/to-be/08-risk-and-observability.md`.

Window defaults:

- Main evaluation window: 5 minutes.
- Confirmation window for recovery after mitigation: 15 minutes.

## Threshold matrix

| Metric | Healthy | Warn | rollback_now | Action owner |
| --- | --- | --- | --- | --- |
| `session_message_success_rate` | `>= 99.0%` | `< 99.0%` for 1 window | `< 98.0%` for 1 window | Runtime oncall |
| `run_success_rate` vs baseline | `>= baseline` | `< baseline` and `>= baseline-5%` | `< baseline-10%` | Runtime oncall |
| `ipc_command_timeout_rate` | `<= 1.0%` | `> 1.0%` and `<= 2.0%` | `> 2.0%` | Gateway oncall |
| `event_misroute_detected_total` | `= 0` | N/A | `> 0` immediately | Gateway oncall |
| `stream_interruption_rate` | `<= 1.0%` | `> 1.0%` and `<= 3.0%` | `> 3.0%` | Runtime oncall |
| ACK latency P95 | `< 300ms` | `>= 300ms` and `< 500ms` | `>= 500ms` | Gateway oncall |
| stream chunk latency P95 | `< 1000ms` | `>= 1000ms` and `< 1500ms` | `>= 1500ms` | Gateway oncall |

## Action protocol

### On warn

1. Hold rollout progression (no traffic increase).
2. Capture a new snapshot and compare with previous window.
3. Open incident thread if warn lasts 2 consecutive windows.

### On rollback_now

1. Execute immediate rollback:

```bash
node scripts/refine/rollback-drill.mjs --url ws://127.0.0.1:18789
```

2. Confirm mode is `legacy`.
3. Keep rollback mode for at least one 15-minute confirmation window.
4. Do not resume rollout until root cause is identified and fixed.

## Escalation map

- Runtime oncall: decision/intake/execution regressions.
- Gateway oncall: routing/misroute/latency and channel fanout regressions.
- Release owner: go/no-go decision, release note updates, compatibility window tracking.
