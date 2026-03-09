# 14. Migration Baseline Comparison Guide

## Goal (E3)

Ensure post-migration quality does not regress versus baseline for:

- `conversationMessageSuccessRate`
- `runSuccessRate`

## Capture snapshots

- Before migration: save `system.runtime.rollout.status` (or `system.status`) response as JSON.
- After migration: save the same response shape as JSON.

## Generate comparison output

```bash
node scripts/refine/compare-rollout-baseline.mjs \
  --before /path/to/before.json \
  --after /path/to/after.json \
  --out docs/refine/to-be/artifacts/baseline-comparison.md
```

Script output:

- Prints JSON summary with before/after/delta/non-regression flags.
- Optionally writes a markdown table when `--out` is provided.
- Exits with non-zero code if either metric regresses.
