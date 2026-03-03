# Session-First Input Routing and Conversation Decision Contract (2026-03-03)

## Scope

This note freezes the contract for Session-First natural input routing and the conversation decision payload used by TUI and gateway.

## Input Routing Contract

- Runtime config keys:
  - `tui.sessionFirstEnabled`
  - `tui.goalSubmitFastPathEnabled`
- Effective mode:
  - `goalSubmitFastPathEnabled=true` -> `fast-path`
  - otherwise -> `session-first`
- TUI command:
  - `/input-mode [session-first|fast-path|toggle]`
- Event markers:
  - `tui.input_mode.used`
  - `tui.input_mode.updated`

## Conversation Response Decision Contract

The conversation response payload includes:

```ts
type ConversationDecision = 'goal_created' | 'clarification_requested' | 'response_only';

interface ConversationMessageResponse {
  sessionId: string;
  response: string;
  state: string;
  taskInfo?: {
    goalId: string;
    title?: string;
    status?: string;
  };
  decision?: ConversationDecision;
  decisionReason?: string;
}
```

Decision semantics:

- `goal_created`: this turn generated executable task intent and created a goal.
- `clarification_requested`: this turn needs follow-up/clarification before creating a goal.
- `response_only`: this turn returned a conversational response and did not create a goal.

`decisionReason` is a human-readable reason string for eventing and diagnostics.

## Session/Turn Linkage Expectations

- Session-First path must call `conversation.message` with a concrete `sessionId`.
- If no active session exists, TUI creates one via `conversation.new` before sending input.
- Any goal created from conversation path must include source linkage in `goal.context` with canonical keys:
  - `createdViaConversation: true`
  - `sessionId: string`
  - `turnId: string`

## Error Semantics

- Invalid `/input-mode` args:
  - `Usage: /input-mode [session-first|fast-path|toggle]`
- Gateway unavailable while routing input:
  - `Not connected to gateway`
- Conversation pipeline failure:
  - `Conversation failed: <error>`

## Files Bound By This Contract

- `src/cli/tui/commands/handlers.ts`
- `src/cli/gateway/tui-gateway-client.ts`
- `src/gateway/rpc/handlers/conversation-handlers.ts`
- `src/app/conversation/session-manager.ts`
- `src/gateway/rpc/handlers/internal-runtime-handlers.ts`
- `src/infra/config/runtime-config.ts`
