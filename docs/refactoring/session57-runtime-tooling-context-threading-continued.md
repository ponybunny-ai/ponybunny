# Session 57: Runtime Tooling Context Threading Continued

## What changed

Session 57 stayed on the same narrow runtime-core constructor-threading line and used the current codebase findings rather than broadening into a new seam redesign.

The live runtime-owned constructor sites for the targeted classes are still:

- [`src/app/lifecycle/execution/execution-service.ts`](/Users/nickma/Develop/nick-ma/pony/src/app/lifecycle/execution/execution-service.ts)
- [`src/scheduler-daemon/session-intake.ts`](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/session-intake.ts)
- [`src/main.ts`](/Users/nickma/Develop/nick-ma/pony/src/main.ts)

Direct scan results showed that:

- `ExecutionService` already instantiates `ReActIntegration` with an explicit `RuntimeToolingContext`
- `SchedulerSessionIntake` already instantiates `ResponseGenerator` with an explicit `RuntimeToolingContext`
- `main.ts` already instantiates `PlanningService` with an explicit `RuntimeToolingContext`

Because Session 56 had already reached the last live scheduler-daemon conversation constructor site, the next smallest safe cleanup in Session 57 was to finish that migrated daemon-owned path by making the threaded context mandatory instead of optional.

The concrete files tightened in this session are:

- [`src/scheduler-daemon/daemon.ts`](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/daemon.ts)
- [`src/scheduler-daemon/session-intake.ts`](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/session-intake.ts)

## Explicit threading path

The authoritative daemon-owned conversation tooling path is now:

1. `ExecutionService` creates the runtime-owned tool/prompt graph and the `RuntimeToolingContext`.
2. [`src/cli/commands/scheduler-daemon.ts`](/Users/nickma/Develop/nick-ma/pony/src/cli/commands/scheduler-daemon.ts) passes `executionService.getRuntimeToolingContext()` into `SchedulerDaemon`.
3. `SchedulerDaemonConfig.runtimeToolingContext` is now required for that runtime-owned daemon path.
4. `SchedulerDaemon.createSessionIntake()` now refuses to build a session intake when that explicit context is missing.
5. `SessionIntakeDependencies.runtimeToolingContext` is now required.
6. `SchedulerSessionIntake` passes that same explicit context into `ResponseGenerator`.

This keeps the migrated daemon conversation path on explicit constructor-threading only. It does not move ownership into gateway, IPC, workers, or a broader container.

## Source-of-truth ownership change

For the daemon-owned session-intake path, `RuntimeToolingContext` is now not only explicitly threaded but also required.

Before Session 57:

- the daemon/session-intake composition path already accepted explicit `RuntimeToolingContext`
- but the daemon config and session-intake dependency types still allowed omission
- so the migrated path could still silently fall back to compatibility globals if miscomposed

After Session 57:

- daemon/session-intake composition requires `RuntimeToolingContext`
- the daemon raises an explicit error instead of permitting silent fallback on that migrated path
- compatibility prompt/tool globals remain mirrors only, not the authoritative source for this runtime-owned path

## What still remains on singleton fallback

This session intentionally did not remove constructor fallback globally.

The following still remain temporarily capable of fallback for non-migrated or test/legacy callers:

- `PlanningService` constructor fallback to `getGlobalPromptProvider()`
- `ResponseGenerator` constructor fallback to `getGlobalToolProvider()`
- `ReActIntegration` constructor fallback to global prompt/tool providers
- compatibility mirrors established by `RuntimeToolingContext.syncLegacyGlobals()`

Those fallbacks remain for outer or legacy callers that were not part of this session. This session only hardened the already-migrated scheduler-daemon conversation path.

## What did not change

Session 57 did not change:

- gateway behavior
- IPC ownership or protocol
- direct vs evented execution semantics
- scheduler-owned run identity or execution/recovery ownership
- `ReActIntegration` continuation ownership
- `ToolWorker` design or ownership
- `ConversationWorker` design or ownership
- durable ownership lines
- scheduler-factory location
- transport ownership

## Focused tests and validation

Validated in this session:

- `npx jest test/scheduler-daemon/daemon-runtime-tooling-context.test.ts test/scheduler-daemon/session-intake.test.ts test/scheduler-daemon/pid-lock.test.ts test/scheduler-daemon/daemon-manual-replay-control.test.ts test/scheduler-daemon/daemon-startup-reconciliation.test.ts test/app/conversation/response-generator-runtime-tooling-context.test.ts test/app/lifecycle/planning/planning-service-runtime-tooling-context.test.ts test/autonomy/react-integration.test.ts`
- `npm run build`

The added daemon regression test verifies that the migrated scheduler-daemon session-intake path no longer recovers or infers `RuntimeToolingContext` when omitted.

## Next safest cleanup step

The next safest runtime-core cleanup step is to find the next runtime-owned composition entry that still treats one of these already-migrated consumers as optional-input tolerant and tighten that path so omission cannot silently fall back to compatibility globals.

If no additional live runtime-owned constructor sites appear beyond the current set, the next step should remain a similarly small ownership-tightening pass around existing explicit composition roots rather than broadening into scheduler-factory relocation, daemon splitting, worker redesign, or repo-wide IoC.
