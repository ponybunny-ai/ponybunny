# Session 102: LocalExecutionAdapter Boundary Completion

## Summary

Session 102 completes the first coding phase selected by Session 101 for the broader runtime-core singleton / service-locator cleanup line.

The bounded target was the live `LocalExecutionAdapter` agent-tick execution path. Before this session, that path reached directly into `getGlobalAgentRegistry()` and `getGlobalRunnerRegistry()` from inside the runtime execution boundary. This session removes those direct reads from the adapter and replaces them with one explicit injected dependency owned by runtime composition.

This session does not reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`; does not continue the paused source-of-truth line from Sessions 95-100; and does not broaden into daemon startup registry ownership, provider-manager cleanup, gateway RPC registry cleanup, TUI cleanup, or repo-wide singleton removal.

## Injected boundary introduced

Session 102 adds one narrow boundary in [`src/runtime/execution-boundary/local-execution-agent-tick-resolver.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/execution-boundary/local-execution-agent-tick-resolver.ts):

- `LocalExecutionAgentTickResolver`
- `RegistryBackedLocalExecutionAgentTickResolver`

The boundary covers only what the agent-tick execution path already needed:

- load an agent definition by id
- determine whether the current definition has a runner-backed path
- resolve the concrete runner when the runner path applies

`LocalExecutionAdapter` still owns the existing agent-tick control flow, including:

- agent-not-found handling
- definition-hash mismatch warning behavior
- fallback-to-`ExecutionService` routing when no runner-backed path exists
- runner execution result/error normalization

## Direct global reads removed from LocalExecutionAdapter

The live adapter path no longer directly calls:

- `getGlobalAgentRegistry()`
- `getGlobalRunnerRegistry()`

Those reads were removed from [`src/runtime/execution-boundary/local-execution-adapter.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/execution-boundary/local-execution-adapter.ts) and moved to composition-owned construction of `RegistryBackedLocalExecutionAgentTickResolver`.

To avoid leaving a second competing resolution path behind, the adjacent scheduler-owned compatibility wrapper [`src/scheduler/composition/execution-engine-adapter.ts`](/Users/nickma/Develop/nick-ma/pony/src/scheduler/composition/execution-engine-adapter.ts) was also updated to require the same injected boundary instead of constructing `LocalExecutionAdapter` with any hidden fallback.

## Composition sites updated

The current composition sites identified in Session 101 were updated:

- [`src/scheduler/composition/default-scheduler.ts`](/Users/nickma/Develop/nick-ma/pony/src/scheduler/composition/default-scheduler.ts)
  - now constructs `RegistryBackedLocalExecutionAgentTickResolver(getGlobalAgentRegistry(), getGlobalRunnerRegistry())`
  - injects that resolver into `LocalExecutionAdapter` when the default execution port is composed
- [`src/scheduler-daemon/bootstrap/default-daemon-runtime.ts`](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/bootstrap/default-daemon-runtime.ts)
  - now constructs the same resolver explicitly
  - injects it into the daemon-owned `LocalExecutionAdapter` used by both the worker and scheduler assembly

This keeps registry access owned by local composition while leaving runtime semantics unchanged.

## Semantics intentionally preserved

This session intentionally preserves:

- current agent-tick routing decisions
- current runner selection behavior, including explicit-engine and type/default fallback rules already owned by `RunnerRegistry`
- current definition-hash comparison and warning behavior
- current fallback-to-`ExecutionService` behavior when no runner-backed path applies
- current scheduler/worker execution behavior
- current startup/bootstrap behavior
- current RPC/event/payload shapes

No public RPC surface, runtime event payload shape, daemon IPC behavior, scheduler semantics, or startup semantics were changed.

## What remains out of scope after this session

The following singleton/service-locator issues remain intentionally out of scope:

- gateway RPC handler reads of the global agent registry
- daemon-wide startup registry ownership and runner-registration cleanup
- provider-manager / endpoint-manager / workload-resolver singleton cleanup
- prompt/tool global fallback cleanup outside this execution boundary
- paused source-of-truth follow-up work from Sessions 95-100
- TUI, transport-mirror, or public-surface cleanup
- repo-wide registry abstraction or broader DI conversion

## Why this completes the current coding phase for this target

This target is considered complete for the current coding phase because:

- the live `LocalExecutionAdapter` agent-tick path no longer reads global agent/runner registries directly
- both main composition sites identified in Session 101 now provide the dependency explicitly
- the nearby compatibility wrapper no longer preserves a hidden alternative constructor path
- the resulting change remains tightly bounded to the execution-boundary cluster without broadening into adjacent singleton cleanup lines
- focused validation confirms preserved behavior on the affected adapter/composition path

The next session can therefore be a review/re-ranking session for the broader runtime-core singleton / service-locator cleanup line rather than another small follow-up coding pass on this same target.

## Validation

Focused validation performed:

- `npm test -- --runTestsByPath test/runtime/execution-boundary/local-execution-adapter.test.ts test/scheduler/composition/execution-engine-adapter.test.ts`
- `npx tsc --noEmit`
- targeted source check:
  - `src/runtime/execution-boundary/local-execution-adapter.ts` no longer contains `getGlobalAgentRegistry` or `getGlobalRunnerRegistry`
  - `src/scheduler/composition/default-scheduler.ts` and `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts` now own those reads for explicit resolver wiring

Validation stayed intentionally narrow to the affected execution-boundary and scheduler/daemon composition path.
