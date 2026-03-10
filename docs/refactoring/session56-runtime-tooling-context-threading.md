# Session 56: Runtime Tooling Context Threading

## What changed

Session 56 continued the narrow runtime-core composition cleanup by making the scheduler-daemon conversation bootstrap path take `RuntimeToolingContext` explicitly instead of recovering it indirectly from `ExecutionService`.

The migrated composition root in this session is:

- [`src/cli/commands/scheduler-daemon.ts`](/Users/nickma/Develop/nick-ma/pony/src/cli/commands/scheduler-daemon.ts)

The migrated runtime-core assembly path in this session is:

- [`src/scheduler-daemon/daemon.ts`](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/daemon.ts)

## Explicit threading path

The authoritative path for the migrated daemon-owned conversation runtime is now:

1. `ExecutionService` still builds the runtime tool graph and owns the initial `RuntimeToolingContext`.
2. The scheduler-daemon CLI bootstrap reads that context explicitly from `executionService.getRuntimeToolingContext()`.
3. `SchedulerDaemonConfig.runtimeToolingContext` now carries that context into `SchedulerDaemon`.
4. `SchedulerDaemon` passes `config.runtimeToolingContext` directly into `SchedulerSessionIntake`.
5. `SchedulerSessionIntake` passes the same explicit context into `ResponseGenerator`.

For that migrated path, daemon/session-intake composition no longer needs to infer tooling shape by reaching back into `ExecutionService` internals or by relying on prompt/tool singletons as the authoritative source.

## Source-of-truth change for the migrated path

Before Session 56:

- `SchedulerDaemon` recovered the runtime tooling context through a local helper that duck-typed `ExecutionService`
- the daemon bootstrap path was still indirectly coupled to the execution-service singleton-compatibility shape

After Session 56:

- the daemon bootstrap path receives `RuntimeToolingContext` explicitly as config
- `SchedulerSessionIntake` receives that explicit context from the daemon-owned composition root
- the migrated daemon conversation path now treats `RuntimeToolingContext` as the source of truth, with global prompt/tool singletons remaining compatibility mirrors only

## What remains on singleton fallback

Session 56 intentionally leaves some fallback paths in place:

- `PlanningService`, `ResponseGenerator`, and `ReActIntegration` constructors still support global fallback when direct callers do not provide `RuntimeToolingContext`
- `getGlobalToolProvider()` and `getGlobalPromptProvider()` still exist for compatibility
- non-runtime or legacy callers outside the migrated runtime-core composition roots can still temporarily rely on those globals
- gateway-owned tool composition still mirrors into the legacy singleton path

Those remaining fallbacks were not widened or redesigned in this session.

## What did not change

Session 56 did not change:

- gateway behavior
- IPC ownership or protocol
- direct vs evented execution semantics
- scheduler-owned run identity or execution/recovery ownership
- `ReActIntegration` continuation ownership
- `ToolWorker` ownership or design
- `ConversationWorker` ownership or design
- durable ownership lines

## Focused validation

Validated in this session:

- `npx jest test/scheduler-daemon/daemon-runtime-tooling-context.test.ts test/scheduler-daemon/session-intake.test.ts test/app/conversation/response-generator-runtime-tooling-context.test.ts test/app/lifecycle/planning/planning-service-runtime-tooling-context.test.ts`
- `npm run build`

The added daemon test verifies that the migrated daemon-owned session-intake path threads the explicit `RuntimeToolingContext` from scheduler-daemon config without recovering it from `ExecutionService`.

## Next safest cleanup step

The next safest runtime-core cleanup step is to migrate the next direct runtime-owned callers that still instantiate `PlanningService`, `ResponseGenerator`, or `ReActIntegration` without an explicit `RuntimeToolingContext`, while leaving outer transport, gateway, IPC, worker seams, and durable ownership unchanged.

That should remain a constructor-threading pass only, not a broader scheduler-factory relocation, daemon split, worker redesign, or repo-wide IoC rewrite.
