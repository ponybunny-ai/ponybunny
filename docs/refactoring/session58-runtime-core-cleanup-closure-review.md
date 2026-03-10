# Session 58: Runtime-Core Cleanup Closure Review

## Scope of this review

This session is a closure review for the runtime-core tooling-context cleanup line completed across Sessions 54-57.

It does not introduce new runtime behavior. It does not change gateway behavior, IPC, direct vs evented execution semantics, execution/recovery design, `ToolWorker`, or `ConversationWorker`.

## What is now implemented on this cleanup line

The runtime-core hotspot identified in Session 54 was the mutable global prompt/tool capability shape centered on `globalToolProvider` and `globalPromptProvider`.

Sessions 55-57 established and then tightened an explicit runtime-owned boundary around that capability shape:

- [`src/runtime/tooling-context/runtime-tooling-context.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/tooling-context/runtime-tooling-context.ts) now defines `RuntimeToolingContext` as the runtime-owned carrier for:
  - `toolRegistry`
  - `toolAllowlist`
  - `toolEnforcer`
  - `toolProvider`
  - `skillRegistry`
  - lazily created `PromptProvider`
- [`src/app/lifecycle/execution/execution-service.ts`](/Users/nickma/Develop/nick-ma/pony/src/app/lifecycle/execution/execution-service.ts) now creates the runtime tool/prompt graph once, wraps it in `RuntimeToolingContext`, and passes that context into migrated runtime-owned consumers.
- [`src/autonomy/react-integration.ts`](/Users/nickma/Develop/nick-ma/pony/src/autonomy/react-integration.ts), [`src/app/lifecycle/planning/planning-service.ts`](/Users/nickma/Develop/nick-ma/pony/src/app/lifecycle/planning/planning-service.ts), and [`src/app/conversation/response-generator.ts`](/Users/nickma/Develop/nick-ma/pony/src/app/conversation/response-generator.ts) all accept explicit `RuntimeToolingContext` and use it as their runtime-owned source of truth when provided.
- [`src/cli/commands/scheduler-daemon.ts`](/Users/nickma/Develop/nick-ma/pony/src/cli/commands/scheduler-daemon.ts), [`src/scheduler-daemon/daemon.ts`](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/daemon.ts), and [`src/scheduler-daemon/session-intake.ts`](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/session-intake.ts) now thread that same context through the daemon-owned conversation bootstrap path.
- The migrated scheduler-daemon session-intake path now requires explicit `RuntimeToolingContext` rather than silently recovering or inferring it.

## What remains intentionally conservative

This line was tightened only around runtime-owned composition roots already proven to be live and important.

The codebase still intentionally retains:

- constructor fallback in `PlanningService`, `ResponseGenerator`, and `ReActIntegration`
- compatibility globals in [`src/infra/prompts/prompt-provider.ts`](/Users/nickma/Develop/nick-ma/pony/src/infra/prompts/prompt-provider.ts) and [`src/infra/tools/tool-provider.ts`](/Users/nickma/Develop/nick-ma/pony/src/infra/tools/tool-provider.ts)
- mirror writes through `RuntimeToolingContext.syncLegacyGlobals()`
- outer/global tool setup still writing to the legacy global tool-provider surface in [`src/gateway/gateway-server.ts`](/Users/nickma/Develop/nick-ma/pony/src/gateway/gateway-server.ts)
- test/demo/legacy callers that still instantiate fallback-capable constructors or read globals directly

That conservatism is deliberate. The current line contained runtime-core ownership risk without broadening into repo-wide singleton removal or a new container architecture.

## What is stable enough for current use

For current runtime-owned paths, the cleanup line is stable enough in its intended scope:

- `ExecutionService` is now the concrete runtime-owned assembly point for tool/prompt capability shape.
- migrated runtime-owned consumers read tooling shape from explicit `RuntimeToolingContext` rather than from mutable globals
- the daemon-owned conversation bootstrap/session-intake path is explicitly threaded and hardened against silent omission
- regression tests exist for the migrated runtime-owned consumers and the daemon threading path

## What is still not ready for broader/global singleton removal

This line is not yet a basis for repo-wide singleton removal.

The remaining blockers are structural, not urgent defects:

- constructor fallback still exists in migrated classes for outer, legacy, and test callers
- `PromptProvider` still defaults to `getGlobalToolProvider()`
- compatibility globals are still part of the supported compatibility surface
- gateway-owned tool setup still mutates the global tool-provider surface
- some tests, demos, and non-runtime callers still depend on global prompt/tool access patterns

That means the runtime-owned boundary is now credible and locally authoritative, but the repository as a whole is not yet ready for broad singleton purge.

## Assessment

### A. RuntimeToolingContext as explicit runtime-owned boundary

**Current strengths**

- `RuntimeToolingContext` is narrow, explicit, and runtime-owned.
- It captures the actual capability-shape components that were previously inferred through globals.
- It centralizes the runtime prompt provider on top of the explicit tool and skill surfaces.
- It keeps compatibility shims separate via `syncLegacyGlobals()` instead of making globals part of the boundary definition.

**Remaining risks**

- `syncLegacyGlobals()` still means the boundary coexists with mutable process-global mirrors.
- The boundary is authoritative only on migrated paths; other callers can still bypass it.
- It is still seeded from runtime/service assembly, not yet enforced as universal construction policy.

**Current recommended usage posture**

- Treat `RuntimeToolingContext` as the authoritative runtime-owned capability shape for any runtime-core composition root.
- Pass it explicitly through constructor/config seams.
- Use compatibility-global sync only as a mirror for non-migrated callers.

**Further immediate work required**

- No immediate follow-up is required to keep the current migrated scope safe.
- Further work is only required if a new runtime-owned composition root is introduced and would otherwise omit the context.

### B. Migrated runtime-core consumers

**Current strengths**

- `ReActIntegration`, `PlanningService`, and `ResponseGenerator` can all consume explicit runtime-owned tooling shape.
- Focused tests verify that these consumers use the explicit context instead of global singletons when that context is supplied.
- The first migrated consumers now behave correctly even if the global provider shape changes afterward.

**Remaining risks**

- Their constructors still tolerate fallback, so they are not self-enforcing outside migrated assembly paths.
- Non-runtime callers can still instantiate them without context and silently land on globals.
- This makes them safe on migrated paths, but not strong enough to justify removing fallback globally.

**Current recommended usage posture**

- In runtime-owned code, always pass explicit `RuntimeToolingContext`.
- Leave fallback in place only for compatibility, tests, demos, and non-migrated outer paths.

**Further immediate work required**

- No immediate work is required on the currently live runtime-owned constructor sites.
- Removal of fallback from these classes can be deferred until there is a narrower repo-wide migration plan.

### C. Constructor-threaded composition roots

**Current strengths**

- The live runtime-owned composition roots identified on this line now thread the context explicitly.
- `ExecutionService` owns creation.
- `main.ts` passes the context into `PlanningService`.
- scheduler-daemon bootstrap passes the context into `SchedulerDaemon`, and the daemon passes it into `SchedulerSessionIntake`.
- the daemon-owned session-intake path now fails fast if the explicit context is omitted.

**Remaining risks**

- The hard requirement is currently specific to the daemon-owned session-intake path, not every constructor in the repo.
- Future runtime-owned roots could regress if they instantiate migrated consumers without following the same threading rule.

**Current recommended usage posture**

- Preserve constructor-threaded explicit ownership on runtime-owned roots.
- When adding a new runtime-owned composition root, require the context there instead of reintroducing singleton recovery.

**Further immediate work required**

- No immediate cleanup appears required on the currently live runtime-owned composition roots.
- The next work here should be reactive only if a newly added runtime-owned root opens another omission path.

### D. Remaining compatibility-global fallback surfaces

**Current strengths**

- They preserve backward compatibility and avoid a broad migration blast radius.
- They keep tests, demos, and older direct callers running while the runtime-owned path has been tightened first.
- They let current runtime-owned code coexist with legacy callers without transport or worker seam changes.

**Remaining risks**

- Globals remain mutable process-wide state.
- Global writes still exist in both runtime-owned sync and outer gateway-owned setup.
- Fallback-capable constructors plus global defaults mean broader singleton removal would still be risky and incomplete.

**Current recommended usage posture**

- Treat these globals as compatibility mirrors only on migrated paths.
- Do not use them as the design basis for new runtime-owned code.
- Do not attempt removal until remaining legacy/test/demo callers are deliberately migrated or isolated.

**Further immediate work required**

- No must-fix cleanup is required before moving primary focus elsewhere.
- These surfaces belong in a deferred, narrower singleton-removal pass rather than in the current line.

## Readiness judgment

### Is the runtime-core tooling-context cleanup line now stable enough to pause as the primary focus?

Yes.

For its intended scope, this line is now stable enough to pause as the primary architectural focus. The main runtime-owned composition roots have been tightened, the source-of-truth change is real on migrated paths, and the most dangerous hotspot is no longer authoritative in runtime core.

### What are the remaining short-tail tasks, if any?

1. Preserve the explicit-threading rule for any future runtime-owned composition root that creates `PlanningService`, `ResponseGenerator`, or `ReActIntegration`.
2. Keep focused regression coverage around explicit-context usage and daemon fail-fast behavior.
3. Maintain a small inventory of legacy/global fallback callers so any later singleton-removal pass starts from concrete scope.

### Which of those are must-fix before moving on?

None of them are must-fix before moving primary focus.

The current migrated runtime-owned paths are already explicit enough to move on.

### Which can safely be deferred?

- constructor fallback removal in migrated classes
- `PromptProvider` default/global cleanup
- gateway/global tool-provider cleanup
- migration of tests, demos, and other legacy callers away from direct global usage
- any broader repo-wide singleton purge

## Do not lose these invariants

- `RuntimeToolingContext` is the authoritative source of runtime-owned capability shape on migrated runtime paths.
- On migrated paths, compatibility globals are mirrors only, not source of truth.
- `ExecutionService` remains the runtime-owned assembly point that creates the runtime tool/prompt graph and the initial `RuntimeToolingContext`.
- Constructor-threaded ownership remains explicit across runtime-owned composition roots.
- The daemon-owned session-intake path must not silently recover or infer `RuntimeToolingContext`.
- `ReActIntegration` continuation ownership remains unchanged.
- Worker seam ownership remains unchanged; this line does not redesign `ToolWorker` or `ConversationWorker`.
- Outer transport ownership remains unchanged; gateway behavior and IPC remain untouched.
- Durable execution/recovery ownership lines remain unchanged.
- This cleanup line is about runtime-owned source-of-truth tightening, not about repo-wide IoC or topology change.

## Recommended handoff to next module or focus

Runtime-core cleanup should not remain the main focus after this session.

The runtime-owned tooling boundary is now stable enough for its current scope, and the remaining issues are compatibility/deferred cleanup rather than active runtime-core instability.

The next architectural focus should move to `RF-033` import-cycle cleanup, starting with a narrow discovery/design pass around the highest-value cross-layer cycle.

If runtime-core cleanup had to remain active, the only single remaining task that would justify it would be a newly discovered live runtime-owned composition root that still instantiates a migrated consumer without explicit `RuntimeToolingContext`. The current code scan does not show such a blocker.

## Deferred runtime-core cleanup backlog

1. Catalog remaining non-runtime callers that still rely on constructor fallback or direct global prompt/tool access.
2. Narrow `PromptProvider` away from defaulting to `getGlobalToolProvider()` when a later singleton-removal pass is intentionally started.
3. Decide, in a future scoped session, whether gateway-owned global tool-provider writes should be isolated behind a clearer compatibility seam.

## Recommended Session 59

Session 59 should begin `RF-033` with a focused import-cycle cleanup discovery/design review.

Rationale: the runtime-core tooling-context line is now sufficiently contained, while import-cycle cleanup is the next architectural task already on the board that can improve code-boundary clarity without disturbing gateway behavior, IPC, runtime semantics, or worker ownership.

## What should not be done next

- Do not start a repo-wide singleton purge.
- Do not introduce a broad IoC/container rewrite.
- Do not split the daemon or relocate scheduler-factory ownership without a narrower demonstrated need.
- Do not redesign `ToolWorker` or `ConversationWorker`.
- Do not use this pause point as a pretext for execution/recovery redesign.

## Validation

This session is documentation-only.

Validated for scope:

- reviewed the runtime-core implementation and tests in the migrated paths
- confirmed the remaining global setter/getter surfaces in runtime and gateway code
- verified that this session changed only this review document and the master task list
