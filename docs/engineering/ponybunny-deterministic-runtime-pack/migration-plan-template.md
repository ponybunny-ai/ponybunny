# PonyBunny vNext Migration Plan Template (Deterministic Runtime, Low-IQ Tolerant)

> Goal: Make execution stable, auditable, replayable by shifting determinism to **Compiler + Runtime**, not the model.

## 0. Current State Snapshot (fill in)
- [ ] Current execution path: (TUI → gateway → scheduler → ??? → tools)
- [ ] Does LLM call tools directly? Y/N
- [ ] Existing tool system: skills/mcp/local?
- [ ] Logging/audit: what exists (per step? per tool?)
- [ ] Idempotency: any idempotency keys? Y/N
- [ ] Replay: exists? Y/N
- [ ] Human confirmation flow: exists? Y/N

## 1. Target State Summary
- Planner outputs **Plan JSON only** (Plan DSL v1)
- Deterministic **Plan Compiler/Verifier**
- Deterministic Runtime Executor:
  - stable step ordering (topo + lexicographic)
  - idempotency keys per step
  - event-sourcing log
  - replay (facts_only first)
- Tool routing mode switch:
  - default: system_only (no model native tools)

## 2. Workstreams

### WS-A: Schemas & Contracts (must-have)
- [ ] Add `/schemas/plan.schema.v1.json`
- [ ] Add `/schemas/tool-manifest.schema.v1.json`
- [ ] Add `/schemas/runtime-profile.schema.v1.json`
- [ ] Decide storage location and loading method (/schemas static via Caddy etc.)

**Acceptance**
- Given a plan JSON, schema validation passes/fails deterministically.
- Given a tool manifest JSON, validation passes and can be loaded into registry.

### WS-B: Tool Registry (must-have)
- [ ] Implement registry loader for:
  - skills manifests
  - MCP tool listings
  - local tool manifests
  - script tools (sandbox)
- [ ] Define `tool_ref` URI conventions.
- [ ] Implement handler adapters for each namespace.

**Acceptance**
- `registry.has(tool_ref)` works for all loaded tools.
- Tool input/output schemas available for compiler checks.

### WS-C: Plan Compiler/Verifier (must-have)
- [ ] Deterministic checks:
  - step ids unique
  - dependency graph valid + cycle detection
  - tool existence
  - args schema validation (JSON Schema)
  - policy checks (allowlist/denylist, network/fs/app)
  - high-risk tools require human_confirm per runtime profile
- [ ] Emit structured errors with stable error codes.

**Acceptance**
- Same plan + same registry + same profile => same compile result (bit-for-bit error list ordering).
- Low quality plans are rejected, never partially executed.

### WS-D: Runtime Executor (must-have)
- [ ] Stable scheduling:
  - topo sort with stable tie-breaking
- [ ] Idempotency keys:
  - `hash(session_id|run_id|plan_id|step_id|tool_ref|args_hash|tool_version)`
- [ ] Tool invocation wrapper:
  - timeouts
  - retries (deterministic backoff, no jitter)
- [ ] Event log (event-sourcing):
  - run started/ended
  - step started/succeeded/failed
  - tool requested/responded
  - artifact written

**Acceptance**
- Re-running the same accepted plan with deterministic tools yields deterministic results.
- A failed run produces full audit trail.

### WS-E: Replay (should-have)
- [ ] `facts_only` replay:
  - rebuild final output state from run_events without re-executing tools
- [ ] optional `reexecute_tools` replay:
  - re-run tool calls with same idempotency keys (only if tool supports)

**Acceptance**
- Facts-only replay reproduces the same final state snapshot.

### WS-F: Human Confirmation (should-have)
- [ ] Runtime can pause with `paused_for_human`
- [ ] TUI can display pending confirm
- [ ] Resume run with approval/deny event

**Acceptance**
- Any `ui_automation` or `script_execute` is blocked until confirmation (per profile).

### WS-G: Script Sandbox / AppleScript (phase-2)
- [ ] Implement `script_generate` -> artifact
- [ ] Implement `script_execute` -> `script://osascript.run` tool
- [ ] Enforce:
  - allowlisted apps
  - no_network
  - filesystem scope
  - max_runtime
  - output limits

**Acceptance**
- Script execution is auditable and cannot escape policy.

## 3. Cutover Strategy
- Stage 1: run new pipeline in shadow mode (no side effects) to compare behavior
- Stage 2: enable for a subset of agents/tasks (feature flag)
- Stage 3: make deterministic runtime default; keep old path behind flag for rollback

## 4. Risk Register
- UI automation flakiness => default human approval, add preflight checks
- Tool idempotency gaps => wrap with local "once" cache where possible
- External network tools nondeterminism => accept, but ensure audit + snapshot inputs/outputs

## 5. Test Plan
- Unit: topo sort stability, stable stringify, idempotency key generation
- Unit: compiler error ordering stability
- Integration: tool registry + compile + execute with fake tools
- Replay: facts_only reconstructs state
- Policy: deny network, deny write outside scope, require approval for ui_automation

## 6. Deliverables Checklist
- [ ] 3 schemas committed
- [ ] runtime implemented with registry/compiler/executor/log
- [ ] gateway endpoints wired:
  - /plans:generate
  - /plans:compile
  - /runs
  - /runs/{id}/events
  - /runs/{id}:replay
- [ ] feature flags + rollout plan
