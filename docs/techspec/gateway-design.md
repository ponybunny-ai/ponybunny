# Gateway Design

The Gateway is the communication layer between external clients and the Scheduler.

## Core Responsibilities

| Responsibility | Description |
|:---------------|:------------|
| **Connection Mgmt** | Maintain WS/WSS connections, heartbeat, reconnection |
| **Inbound Messages** | Receive Goal submissions, approvals, info, cancellations |
| **Outbound Messages** | Push status, escalations, results, real-time logs |
| **Auth** | Verify client identity, manage sessions |
| **Routing** | Dispatch messages to correct Scheduler instance/Lane |

## WebSocket Protocol (JSON-RPC Style)

```
Port: 18789 (default)
Protocol: WS (dev) / WSS (prod)

Frame Types:
┌─────────────────────────────────────────────────────────────┐
│ Request (req)                                               │
│ { "type": "req", "id": "uuid", "method": "...", "params": } │
├─────────────────────────────────────────────────────────────┤
│ Response (res)                                              │
│ { "type": "res", "id": "uuid", "result": ... }              │
│ { "type": "res", "id": "uuid", "error": { code, message } } │
├─────────────────────────────────────────────────────────────┤
│ Event (event) - Server push, no response expected           │
│ { "type": "event", "event": "...", "data": ... }            │
└─────────────────────────────────────────────────────────────┘
```

## Connection Lifecycle

```
Client                              Gateway
   │                                   │
   │──── WS Connect ──────────────────►│
   │                                   │
   │◄─── event: connect.challenge ─────│  { challenge: "random-bytes" }
   │                                   │
   │──── req: connect ────────────────►│  { signature, publicKey, pairingToken }
   │                                   │
   │◄─── res: connect ─────────────────│  { sessionId, serverVersion }
   │                                   │
   │         ═══ Authenticated ═══     │
   │                                   │
   │──── req: goal.submit ────────────►│
   │◄─── event: goal.accepted ─────────│
   │◄─── event: workitem.started ──────│
   │◄─── event: workitem.progress ─────│  (streaming)
   │◄─── event: escalation ────────────│  (if needed)
   │──── req: escalation.respond ─────►│
   │◄─── event: workitem.completed ────│
   │◄─── event: goal.completed ────────│
   │                                   │
   │──── ping ────────────────────────►│  (every 30s)
   │◄─── pong ─────────────────────────│
```

## RPC Methods

| Method | Direction | Description |
|:-------|:----------|:------------|
| `goal.submit` | Client→GW→Scheduler | Submit new Goal |
| `goal.cancel` | Client→GW→Scheduler | Cancel running Goal |
| `goal.status` | Client→GW→Scheduler | Query Goal status |
| `workitem.list` | Client→GW→Scheduler | List Work Items for Goal |
| `escalation.respond` | Client→GW→Scheduler | Human response to escalation |
| `approval.grant` | Client→GW→Scheduler | Approve pending operation |
| `approval.deny` | Client→GW→Scheduler | Deny pending operation |
| `config.get` | Client→GW | Get configuration |
| `config.set` | Client→GW | Update configuration |

## Events (Scheduler → Gateway → Client)

| Event | Description | Data |
|:------|:------------|:-----|
| `goal.accepted` | Goal received and queued | `{ goalId, estimatedItems }` |
| `goal.started` | Goal execution began | `{ goalId }` |
| `goal.completed` | Goal finished | `{ goalId, status, artifacts }` |
| `workitem.started` | Work Item execution began | `{ workItemId, title }` |
| `workitem.progress` | Streaming progress | `{ workItemId, delta, tokens }` |
| `workitem.completed` | Work Item finished | `{ workItemId, status, artifacts }` |
| `escalation` | Human intervention needed | `{ escalationId, packet }` |
| `approval.required` | Operation needs approval | `{ approvalId, action, impact }` |
| `error` | System error | `{ code, message, recoverable }` |

## Authentication Flow (Triple-Check)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Authentication (WHO are you?)                                │
│    - Ed25519 signature verification                             │
│    - Client signs challenge with private key                    │
│    - Gateway verifies with stored public key                    │
├─────────────────────────────────────────────────────────────────┤
│ 2. Authorization (WHAT can you do?)                             │
│    - Pairing token validation                                   │
│    - Token grants specific permissions (read/write/admin)       │
│    - Token can be revoked server-side                           │
├─────────────────────────────────────────────────────────────────┤
│ 3. Command Allowlist (HOW can you do it?)                       │
│    - Per-session command whitelist                              │
│    - Dangerous commands require explicit approval               │
│    - Audit log for all commands                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Internal Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Gateway                                  │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ WS Server    │  │ Connection   │  │ Auth         │          │
│  │ (uWebSockets)│  │ Manager      │  │ Manager      │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                   │
│         └────────────┬────┴─────────────────┘                   │
│                      │                                          │
│              ┌───────▼───────┐                                  │
│              │ Message Router │                                  │
│              └───────┬───────┘                                  │
│                      │                                          │
│         ┌────────────┼────────────┐                             │
│         │            │            │                             │
│  ┌──────▼──────┐ ┌───▼───┐ ┌─────▼─────┐                       │
│  │ RPC Handler │ │ Event │ │ Broadcast │                       │
│  │ (req/res)   │ │ Queue │ │ Manager   │                       │
│  └──────┬──────┘ └───┬───┘ └─────┬─────┘                       │
│         │            │           │                              │
│         └────────────┼───────────┘                              │
│                      │                                          │
│              ┌───────▼───────┐                                  │
│              │ Scheduler Bus │  (Internal event bus)            │
│              └───────────────┘                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Error Codes

| Code | Name | Description |
|:-----|:-----|:------------|
| -32700 | PARSE_ERROR | Invalid JSON |
| -32600 | INVALID_REQUEST | Invalid request structure |
| -32601 | METHOD_NOT_FOUND | Unknown RPC method |
| -32602 | INVALID_PARAMS | Invalid method parameters |
| -32603 | INTERNAL_ERROR | Internal server error |
| -32000 | AUTH_REQUIRED | Authentication required |
| -32001 | AUTH_FAILED | Authentication failed |
| -32002 | PERMISSION_DENIED | Insufficient permissions |
| -32003 | RATE_LIMITED | Too many requests |
| -32004 | GOAL_NOT_FOUND | Goal ID not found |
| -32005 | ALREADY_RUNNING | Goal already in progress |
