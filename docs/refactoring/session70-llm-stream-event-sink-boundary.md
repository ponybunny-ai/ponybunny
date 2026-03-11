# Session 70: LLM Stream Event Sink Boundary

## Scope

This session implemented the first RF-056 coding step under RF-034:

- remove the direct `LLMProviderManager` dependency on `gatewayEventBus`
- preserve current streaming event names and payload semantics
- avoid gateway, IPC, worker, execution, recovery, and provider-selection redesign

## What changed

A narrow provider-manager-local streaming publication boundary was introduced in:

- `src/infra/llm/provider-manager/stream-event-sink.ts`

That boundary defines only the four stream lifecycle publications currently needed by `LLMProviderManager`:

- `streamStarted(...)`
- `streamChunk(...)`
- `streamEnded(...)`
- `streamErrored(...)`

The boundary is runtime-agnostic and carries the same payload fields already used for current gateway stream events.

`LLMProviderManager` now depends on an injected `LLMStreamEventSink` instead of importing `gatewayEventBus` directly. A no-op default sink is configured so the provider manager can still run safely when no gateway-owned sink is bound.

## Back-edge removed

The concrete back-edge removed in this session was:

- `src/infra/llm/provider-manager/provider-manager.ts`
  -> `src/gateway/events/event-bus.ts`

Before this session, `LLMProviderManager.callEndpointStreaming(...)` emitted `llm.stream.start`, `llm.stream.chunk`, `llm.stream.end`, and `llm.stream.error` directly through the gateway singleton.

After this session, provider-manager streaming emits only into `LLMStreamEventSink`.

## Where gateway event publication now lives

Concrete gateway event publication now lives in the gateway-owned adapter:

- `src/gateway/events/llm-stream-event-sink.ts`

That adapter maps the same stream lifecycle calls to the same gateway event names on `gatewayEventBus`.

Gateway composition now binds that adapter through:

- `src/gateway/gateway-server.ts`

using `configureLLMProviderManagerStreamEventSink(new GatewayLLMStreamEventSink())`.

## What intentionally did not change

This session intentionally did not change:

- gateway event names:
  - `llm.stream.start`
  - `llm.stream.chunk`
  - `llm.stream.end`
  - `llm.stream.error`
- payload meaning for those events
- provider/model selection
- fallback order or endpoint health behavior
- streaming response parsing
- `onChunk`, `onComplete`, or `onError` callback behavior
- direct vs evented execution semantics
- IPC
- `ToolWorker`, `ConversationWorker`, execution/recovery ownership, or transport ownership lines

## Compatibility shims retained

The compatibility shim retained in this session is the no-op default sink in the provider-manager layer. It allows non-gateway callers and tests to keep using `LLMProviderManager` without requiring gateway event infrastructure to be present.

## Next safest RF-034 step

The next safest RF-034 step is not another streaming redesign. The next narrow dependency-direction cleanup should move to the next reviewed constructor/composition pressure point identified in Session 69, most likely a narrow extraction from `SchedulerSessionIntake` rather than reopening provider-manager, gateway protocol, or worker semantics.
