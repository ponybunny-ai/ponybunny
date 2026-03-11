# Session 120: RF-071 Line Review

## Scope

Session 120 is a bounded review / re-ranking session for `RF-071` after the first major coding cluster landed in Session 119.

This session is documentation only. It does not:

- change runtime behavior
- reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`
- resume paused Sessions 95-100, 101-103, 104-109, `RF-062`, `RF-030`, or `RF-036` by default
- redesign provider execution/fallback behavior
- redesign startup/bootstrap behavior
- redesign gateway/daemon transport semantics
- redesign scheduler semantics
- redesign conversation lifecycle semantics
- change existing RPC/event/status payload shapes
- change TUI behavior

## Files Reviewed

Primary current-code review targets:

- `src/infra/prompts/legacy-prompt-tooling-compatibility.ts`
- `src/infra/prompts/prompt-provider.ts`
- `src/runtime/tooling-context/runtime-tooling-context.ts`
- `src/gateway/runtime/gateway-tool-provider-runtime.ts`
- `src/autonomy/react-integration.ts`
- `src/app/lifecycle/planning/planning-service.ts`
- `src/app/conversation/response-generator.ts`
- `src/app/lifecycle/execution/execution-service.ts`
- `src/runtime/execution-boundary/local-execution-cycle-runtime-factory.ts`
- `src/infra/tools/tool-provider.ts`
- `src/infra/skills/skill-registry.ts`

Prior session outputs reviewed:

- `docs/refactoring/session118-major-block-reranking-review.md`
- `docs/refactoring/session119-runtime-tooling-compatibility-boundary.md`

## What Session 119 Achieved

Session 119 completed the one clearly high-value first RF-071 coding cluster and materially improved the live compatibility boundary.

### 1. An explicit legacy prompt/tooling compatibility owner now exists

The current codebase now has `src/infra/prompts/legacy-prompt-tooling-compatibility.ts` as the explicit owner for:

- legacy fallback prompt/tool dependency reads through `readLegacyPromptToolingFallback()`
- legacy fallback tool-provider reads through `getLegacyCompatibleToolProvider()`
- the legacy prompt-provider singleton mirror through `getLegacyCompatiblePromptProvider(...)`
- legacy/global installation writes through `installLegacyPromptToolingGlobals(...)`

That was the main ownership clarification missing in Session 118.

### 2. `PromptProvider` default/global fallback now delegates through that seam

`src/infra/prompts/prompt-provider.ts` no longer embeds direct global reads/writes itself:

- the no-argument constructor now calls `readLegacyPromptToolingFallback()`
- `getGlobalPromptProvider()` now delegates through `getLegacyCompatiblePromptProvider(...)`
- `setGlobalPromptProvider()` now delegates through `setLegacyCompatiblePromptProvider(...)`

This preserves historical behavior while making the compatibility path explicit.

### 3. Legacy-global installation now routes through one shared write seam

The two live legacy/global installation paths reviewed in Session 118 now converge:

- `RuntimeToolingContext.syncLegacyGlobals()` installs runtime-owned prompt/tool globals through `installLegacyPromptToolingGlobals(...)`
- `GatewayToolProviderRuntime` installs the gateway-owned legacy tool-provider global through the same `installLegacyPromptToolingGlobals(...)` helper

The write owner is now explicit instead of being split across `PromptProvider`, `RuntimeToolingContext`, and `GatewayToolProviderRuntime`.

### 4. Explicit runtime-owned tooling authority was preserved on migrated paths

The migrated execution path still remains the authority:

- `LocalExecutionCycleRuntimeFactory` still constructs `new PromptProvider(params.skillRegistry, toolProvider)` directly
- `RuntimeToolingContext` still owns the explicit runtime `toolProvider`, `toolEnforcer`, `toolRegistry`, and `skillRegistry`
- `ReActIntegration`, `PlanningService`, and `ResponseGenerator` still prefer the explicit `RuntimeToolingContext` when it is provided

This is still a compatibility cleanup, not a runtime-authority redesign.

### 5. What Session 119 intentionally left untouched

The current code still intentionally leaves the following in place:

- legacy fallback-capable reads still exist for non-migrated construction paths
- `getGlobalToolProvider()` and `getGlobalSkillRegistry()` still exist as compatibility/global surfaces
- `ExecutionService` still seeds its runtime-owned skill registry from `getGlobalSkillRegistry()`
- provider execution/fallback behavior is unchanged
- startup/bootstrap behavior is unchanged
- gateway/daemon transport semantics are unchanged
- conversation, scheduler, payload, and TUI behavior are unchanged

## Remaining Plausible RF-071 Candidates

Only candidates grounded in the current post-119 codebase are included here.

### Candidate 1: remove the remaining compatibility-helper reads from fallback-capable consumers

Current code evidence:

- `ReActIntegration` still falls back to `getLegacyCompatiblePromptProvider(...)` and `getLegacyCompatibleToolProvider()` when no `RuntimeToolingContext` is provided
- `PlanningService` still falls back to `getLegacyCompatiblePromptProvider(...)` when no `RuntimeToolingContext` is provided
- `ResponseGenerator` still falls back to `getLegacyCompatibleToolProvider()` when no `RuntimeToolingContext` is provided

Evaluation:

- Structural gain: low. These consumers already route their fallback through the explicit compatibility seam introduced in Session 119.
- Semantic risk: low to medium. Any attempt to remove the fallback outright would change behavior; any attempt to wrap it differently is mostly constructor/API churn.
- Scope tightness: moderate.
- True compatibility/boundary cleanup: only weakly now. The compatibility boundary is already explicit; the remaining issue is that compatibility consumers still exist.
- Drift risk: medium. This can easily slide into broader runtime-tooling injection churn or singleton cleanup.

Judgment:

This is not a strong second slice. The remaining consumer fallback is now residue behind the intended seam, not a split-owner problem.

### Candidate 2: unify the remaining legacy read surfaces into one fuller compatibility accessor

Current code evidence:

- `readLegacyPromptToolingFallback()` returns `skillRegistry` plus `toolProvider` for `PromptProvider`
- `getLegacyCompatibleToolProvider()` separately exposes the legacy tool-provider read for other consumers
- `getLegacyCompatiblePromptProvider(...)` separately owns the prompt-provider singleton mirror

Evaluation:

- Structural gain: low.
- Semantic risk: low.
- Scope tightness: good.
- True compatibility/boundary cleanup: marginal. The compatibility owner already centralizes these reads; changing the helper shape would mostly be internal API polishing.
- Drift risk: medium if it propagates to consumer constructor rewiring without real ownership gain.

Judgment:

This is too small and too cosmetic to justify another RF-071 session immediately.

### Candidate 3: align legacy skill-registry compatibility ownership with the new prompt/tooling seam

Current code evidence:

- `readLegacyPromptToolingFallback()` still reads `getGlobalSkillRegistry()` directly
- `ExecutionService` still seeds `this.skillRegistry` from `getGlobalSkillRegistry()`
- unlike tool-provider and prompt-provider compatibility, there is no live Session-119-style skill-registry installation seam to consolidate

Evaluation:

- Structural gain: low to moderate in the abstract.
- Semantic risk: medium.
- Scope tightness: weak. This would reach into execution startup, skill loading, and broader singleton ownership.
- True compatibility/boundary cleanup: only partly. It quickly becomes broader skill-registry/global-state cleanup rather than prompt/tool fallback cleanup.
- Drift risk: high.

Judgment:

This is the most tempting local follow-up, but it is not a clean RF-071 continuation. It drifts toward the already-paused singleton/source-of-truth field.

### Candidate 4: further align prompt-provider/global installation semantics

Current code evidence:

- `installLegacyPromptToolingGlobals(...)` can install tool-provider and prompt-provider together
- `setGlobalPromptProvider(...)` still updates only the prompt-provider mirror
- `getGlobalToolProvider()` still remains the underlying legacy tool-provider singleton

Evaluation:

- Structural gain: low.
- Semantic risk: medium, because the current setter/getter behavior is a compatibility surface that existing call sites may rely on
- Scope tightness: moderate.
- True compatibility/boundary cleanup: only partially.
- Drift risk: medium to high, because preserving exact historical behavior while trying to tighten prompt/tool pairing would likely introduce awkward compatibility branching

Judgment:

This is not a good next slice. It would spend risk budget on a weak, compatibility-sensitive edge case.

## Conclusion

`RF-071` should pause now and be re-ranked against the broader remaining candidates.

Why:

- Session 119 already captured the highest-value ownership split that Session 118 identified: the legacy prompt/tool fallback read/write seam is now explicit and localized.
- The current remaining RF-071 residue is mostly compatibility consumption behind that seam, helper-shape polish, or skill-registry-adjacent drift.
- None of the remaining candidates provides another clearly high-value, tightly bounded, semantics-preserving structural gain comparable to Session 119.
- Pushing another RF-071 session immediately would likely stretch the line into broader singleton cleanup, tool-topology redesign, or constructor churn for limited payoff.

This is the point of diminishing returns for the current RF-071 block.

## Practical Re-Ranking Against Broader Remaining Candidates

With `RF-071` paused, the remaining live candidates rank roughly as follows:

### 1. `RF-036` runtime-internal `task.ready` seam

Why it ranks first:

- it is still the only remaining incomplete line with meaningful structural payoff rather than mostly-local residue
- the substantive remaining seam is still real in current code: `SchedulerCore` publishes `task.ready` and `LocalExecutionWorker` consumes it
- the risk is higher than `RF-071` was, but the structural upside is still larger than the remaining `RF-030`, `RF-024`, or `RF-026` work

Constraint:

- this should restart as a bounded design/review session, not immediate rename churn

### 2. `RF-030` post-materialization observation split

Why it ranks second:

- it remains safer and more local than `RF-036`
- but Session 114's diminishing-returns conclusion still holds: the remaining bridge observation/cancel surfaces are thin and lower-yield

### 3. `RF-024` tool mode switch

Why it stays low:

- Session 39's conclusion still stands in the current codebase: a formal tool-dispatch mode is not justified yet

### 4. `RF-026` broader tool hardening

Why it stays low:

- the current code still reflects the same local-authoritative `LocalToolWorker` topology that justified deferral in Session 45

## What Should Not Be Done Next

- Do not force a second RF-071 session just to remove or wrap the remaining compatibility-helper reads in `ReActIntegration`, `PlanningService`, or `ResponseGenerator`.
- Do not widen RF-071 into global skill-registry ownership cleanup, startup/bootstrap cleanup, or broader singleton removal.
- Do not redesign provider fallback behavior, prompt semantics, or gateway/runtime tool-topology ownership under the banner of compatibility cleanup.
- Do not spend a session on helper-shape polish inside `legacy-prompt-tooling-compatibility.ts` unless it is attached to a stronger architectural payoff.
- Do not reopen closed gateway/runtime wiring or compatibility/public-surface lines through naming-only cleanup around prompt/tool globals.

## Recommended Session 121

Recommend exactly one next session:

Start a bounded `RF-036` design/review follow-up focused only on whether the runtime-internal `task.ready` seam still has one safe compatibility-backed normalization slice worth doing now.

Why this is the best next move:

- `RF-071` no longer has a comparably strong second slice
- `RF-030` remains lower-yield
- `RF-024` and `RF-026` remain topology-dependent or weakly justified
- `RF-036` is the strongest remaining line, but it needs another deliberate design pass before any coding because its last live seam is meaningfully more entangled than the gateway compatibility cleanup finished in Session 116

## Validation

Validation for Session 120 was review-oriented:

- reviewed the current post-119 RF-071 code paths listed above
- compared them against the Session 118 candidate inventory and the Session 119 completed scope
- searched the repository for remaining live legacy prompt/tool fallback reads and legacy-global installation paths
- made no runtime code changes

## Files Changed

- `docs/refactoring/session120-rf071-line-review.md`
- `docs/refactoring/ponybunny_refactor_master_task_list.md`
