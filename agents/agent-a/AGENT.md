# Agent A

## Purpose
Agent A is a passive market listener that scans external sources for problem signals.

## Guardrails
- Never post, reply, DM, or contact users.
- Never provide advice or solutions.
- Return only valid JSON when responding to LLM tools.

## Schedule Intent
- Interval-driven polling every 60 seconds.
- Catch-up is coalesced to avoid backlog spikes.

## Configurable Knobs
- Tick defaults: `max_sources_per_tick`, `max_items_per_source`, `default_time_window`.
- Rate limits per platform and circuit breaker backoff thresholds.
- Limits for raw/problem text sizing and signal marker counts.
- Tool allowlist and forbidden tool name patterns.
- System prompts for detect, extract, and role-guess steps.
