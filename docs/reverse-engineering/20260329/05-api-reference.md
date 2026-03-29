# 05 - API Reference

## 5.1 WebSocket Protocol

### Connection

- **Endpoint**: `ws://127.0.0.1:18789` (default)
- **Frame format**: JSON-serialized, newline-delimited

### Frame Types

**Request** (Client → Gateway):
```json
{
  "type": "req",
  "id": "unique-request-id",
  "method": "goal.submit",
  "params": { ... }
}
```

**Response** (Gateway → Client):
```json
{
  "type": "res",
  "id": "matching-request-id",
  "result": { ... }
}
```

**Response Error**:
```json
{
  "type": "res",
  "id": "matching-request-id",
  "error": {
    "code": -32010,
    "message": "Goal not found",
    "data": { ... }
  }
}
```

**Event** (Gateway → Client, asynchronous push):
```json
{
  "type": "event",
  "event": "goal.completed",
  "data": { "goalId": "...", "timestamp": 1234567890 }
}
```

## 5.2 RPC Methods

### Authentication (no auth required)

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `auth.hello` | `{ publicKey }` | `{ challenge }` | Start auth for known client |
| `auth.pair` | `{ token }` | `{ challenge }` | Start auth with pairing token |
| `auth.verify` | `{ signature, publicKey?, channelType?, channelSessionId? }` | `{ success, sessionId, permissions }` | Complete auth with Ed25519 signature |
| `auth.token` | `{ token, channelType?, channelSessionId? }` | `{ success, sessionId, permissions }` | Direct token auth (admin only) |

### System (public/read)

| Method | Permission | Params | Returns |
|--------|-----------|--------|---------|
| `system.ping` | none | `{}` | `{ pong, timestamp }` |
| `system.info` | none | `{}` | `{ name, version, timestamp }` |
| `system.methods` | read | `{}` | `{ methods: string[] }` |
| `system.stats` | admin | `{}` | `{ connections: ConnectionStats }` |

### Goals (read/write)

| Method | Permission | Params | Returns |
|--------|-----------|--------|---------|
| `goal.submit` | write | `{ title, description, success_criteria, priority?, budget_tokens?, budget_time_minutes?, budget_cost_usd?, context? }` | Goal |
| `goal.status` | read | `{ goalId }` | Goal |
| `goal.cancel` | write | `{ goalId, reason? }` | `{ success }` |
| `goal.delete` | write | `{ goalId }` | `{ success }` |
| `goal.list` | read | `{ status?, limit?, offset?, sessionId? }` | `{ goals, total }` |
| `goal.subscribe` | read | `{ goalId }` | `{ success }` |
| `goal.unsubscribe` | read | `{ goalId }` | `{ success }` |
| `agent.command.submit` | write | `{ command, agentId?, priority? }` | Goal |

### Work Items (read/write)

| Method | Permission | Params | Returns |
|--------|-----------|--------|---------|
| `workitem.get` | read | `{ workItemId }` | WorkItem |
| `workitem.list` | read | `{ goalId?, status?, limit?, offset? }` | `{ workItems, total }` |
| `workitem.byGoal` | read | `{ goalId }` | `{ workItems }` |
| `workitem.runs` | read | `{ workItemId }` | `{ runs: WorkItemRunResultDTO[] }` |
| `workitem.retry` | write | `{ workItemId }` | `{ success, workItem }` |

### Escalations (read/write)

| Method | Permission | Params | Returns |
|--------|-----------|--------|---------|
| `escalation.list` | read | `{ goalId?, status?, limit?, offset? }` | `{ escalations, total }` |
| `escalation.get` | read | `{ escalationId }` | Escalation |
| `escalation.respond` | write | `{ escalationId, action, data? }` | `{ success }` |
| `escalation.pending` | read | `{}` | `{ count }` |

### Approvals (read/write/admin)

| Method | Permission | Params | Returns |
|--------|-----------|--------|---------|
| `approval.list` | read | `{ goalId?, status?, limit?, offset? }` | `{ approvals, total }` |
| `approval.get` | read | `{ approvalId }` | ApprovalRequest |
| `approval.grant` | admin | `{ approvalId, conditions? }` | `{ success }` |
| `approval.deny` | admin | `{ approvalId, reason? }` | `{ success }` |
| `approval.pending` | read | `{}` | `{ count }` |
| `approval.create` | admin | `{ goalId, workItemId?, runId?, requestType, description, details? }` | ApprovalRequest |

### Conversations (read/write)

| Method | Permission | Params | Returns |
|--------|-----------|--------|---------|
| `conversation.new` | write | `{ personaId?, userProfileId? }` | `{ sessionId, personaId, state, lifecycleState }` |
| `conversation.list` | read | `{ limit?, lifecycleState? }` | `{ sessions }` |
| `conversation.message` | write | `{ sessionId?, personaId?, userProfileId?, agentId?, message, attachments?, stream? }` | ConversationMessageResult |
| `conversation.history` | read | `{ sessionId, limit? }` | `{ turns }` |
| `conversation.end` | write | `{ sessionId }` | `{ success }` |
| `conversation.archive` | write | `{ sessionId }` | `{ success, archivedAt?, summary? }` |
| `conversation.resume` | write | `{ sessionId }` | `{ success }` |
| `conversation.status` | read | `{ sessionId }` | `{ exists, state?, lifecycleState?, archivedAt?, turnCount? }` |

### Clarification (read/write)

| Method | Permission | Params | Returns |
|--------|-----------|--------|---------|
| `clarify.analyze` | read | `{ goal: { title, description, success_criteria } }` | `{ needsClarification, confidence, questions }` |
| `clarify.generate` | read | `{ goal: { title, description }, categories? }` | `{ questions }` |
| `clarify.init` | write | `{ goalId, questions }` | `{ state }` |
| `clarify.respond` | write | `{ goalId, responses }` | `{ state, isComplete }` |
| `clarify.process` | write | `{ goalId, responses }` | `{ updatedDescription?, updatedCriteria?, additionalContext? }` |
| `clarify.skip` | write | `{ goalId, reason }` | `{ success }` |
| `clarify.state` | read | `{ goalId }` | `{ state }` |
| `clarify.isComplete` | read | `{ goalId }` | `{ complete, state }` |

### Permissions (read/write/admin)

| Method | Permission | Params | Returns |
|--------|-----------|--------|---------|
| `permission.list` | read | `{ goalId?, status?, limit? }` | `{ requests }` |
| `permission.get` | read | `{ requestId }` | `{ request }` |
| `permission.approve` | write | `{ requestId, note?, grantDurationMs? }` | `{ success }` |
| `permission.deny` | write | `{ requestId, reason? }` | `{ success }` |
| `permission.revoke` | write | `{ toolName, goalId }` | `{ success }` |
| `permission.revokeAll` | write | `{ goalId }` | `{ revoked }` |
| `permission.check` | read | `{ toolName, goalId }` | `{ granted, expires_at? }` |
| `permission.stats` | read | `{}` | `{ pending_requests, approved_requests, denied_requests, active_grants }` |
| `permission.layers` | read | `{}` | `{ autonomous, approval_required, forbidden }` |
| `permission.cleanup` | admin | `{}` | `{ expired_requests, expired_grants }` |

### Goal Tool Management (read/write)

| Method | Permission | Description |
|--------|-----------|-------------|
| `goal.tools.init` | write | Initialize tool config for goal |
| `goal.tools.check` | read | Check if tool allowed for goal |
| `goal.tools.allow` / `disallow` | write | Allow/disallow tool |
| `goal.tools.block` / `unblock` | write | Block/unblock tool |
| `goal.tools.setLayer` / `getLayer` | write/read | Set/get tool responsibility layer |
| `goal.tools.setAll` | write | Set all allowed tools at once |
| `goal.tools.list` | read | List allowed/blocked tools |
| `goal.tools.filter` | read | Filter which tools are allowed |
| `goal.tools.history` | read | Get tool config change history |
| `goal.tools.remove` | write | Remove tool config |
| `goal.tools.defaults.*` | read/write | Manage default tool allowlists |

### Audit (read/admin)

| Method | Permission | Params | Returns |
|--------|-----------|--------|---------|
| `audit.list` | read | `{ limit?, offset? }` | `{ logs, total }` |
| `audit.byGoal` | read | `{ goalId, limit? }` | `{ logs }` |
| `audit.byEntity` | read | `{ entityType, entityId, limit? }` | `{ logs }` |
| `audit.byAction` | read | `{ action?, actionPrefix?, limit? }` | `{ logs }` |
| `audit.byTimeRange` | read | `{ from, to, limit? }` | `{ logs }` |
| `audit.byActor` | read | `{ actor, limit? }` | `{ logs }` |
| `audit.stats` | read | `{}` | Audit statistics |
| `audit.prune` | admin | `{ olderThanDays }` | `{ deleted }` |

### Debug (admin only)

| Method | Description |
|--------|-------------|
| `debug.snapshot` | Full system state (scheduler, gateway, goals, work items, events) |
| `debug.scheduler` | Scheduler state details |
| `debug.lanes` | Lane status (active count, queued count, availability) |
| `debug.goals` | All goals with optional filters |
| `debug.goal` | Single goal tree (goal + work items + runs) |
| `debug.workitems` | Work items with optional filters |
| `debug.runs` | Runs with optional filters |
| `debug.events` | Recent runtime events with pagination |
| `debug.events.subscribe` / `unsubscribe` | Subscribe to real-time debug events |
| `debug.gateway` | Gateway state (connections, sessions) |

## 5.3 Event Types

Events are pushed to subscribed clients asynchronously.

### Goal Events
| Event | Data |
|-------|------|
| `goal.created` | Goal object |
| `goal.started` | `{ goalId, timestamp }` |
| `goal.updated` | Goal object |
| `goal.completed` | `{ goalId, timestamp }` |
| `goal.failed` | `{ goalId, error, timestamp }` |
| `goal.cancelled` | `{ goalId, reason, timestamp }` |
| `goal.deleted` | `{ goalId, timestamp }` |

### Work Item Events
| Event | Data |
|-------|------|
| `workitem.created` | WorkItem object |
| `workitem.started` | `{ workItemId, goalId, timestamp }` |
| `workitem.in_progress` | `{ workItemId, goalId, timestamp }` |
| `workitem.ended` | `{ workItemId, goalId, timestamp }` |
| `workitem.updated` | WorkItem object |
| `workitem.completed` | `{ workItemId, goalId, timestamp }` |
| `workitem.failed` | `{ workItemId, goalId, error, timestamp }` |

### Run & Verification Events
| Event | Data |
|-------|------|
| `run.started` | `{ runId, workItemId, goalId, timestamp }` |
| `run.completed` | `{ runId, workItemId, goalId, status, timestamp }` |
| `verification.started` | `{ workItemId, goalId, timestamp }` |
| `verification.completed` | `{ workItemId, goalId, allPassed, timestamp }` |

### Budget Events
| Event | Data |
|-------|------|
| `budget.warning` | `{ goalId, warningLevel, budget, timestamp }` |
| `budget.exceeded` | `{ goalId, budget, timestamp }` |

### Escalation Events
| Event | Data |
|-------|------|
| `escalation.created` | Escalation object |
| `escalation.resolved` | `{ escalationId, action, timestamp }` |

### Conversation Events
| Event | Data |
|-------|------|
| `conversation.new` | `{ sessionId, personaId, timestamp }` |
| `conversation.message.started` | `{ sessionId, timestamp }` |
| `conversation.message.succeeded` | `{ sessionId, timestamp }` |
| `conversation.response` | `{ sessionId, content, timestamp }` |
| `conversation.typing` | `{ sessionId, timestamp }` |
| `conversation.ended` | `{ sessionId, timestamp }` |
| `conversation.archived` | `{ sessionId, timestamp }` |
| `conversation.resumed` | `{ sessionId, timestamp }` |

### LLM Streaming Events
| Event | Data |
|-------|------|
| `llm.stream.start` | `{ sessionId, model, timestamp }` |
| `llm.stream.chunk` | `{ sessionId, content, timestamp }` |
| `llm.stream.end` | `{ sessionId, timestamp }` |
| `llm.stream.error` | `{ sessionId, error, timestamp }` |

### Connection Events
| Event | Data |
|-------|------|
| `connection.authenticated` | `{ sessionId, permissions, timestamp }` |
| `connection.disconnected` | `{ sessionId, timestamp }` |

## 5.4 Error Codes

### JSON-RPC Standard
| Code | Name |
|------|------|
| -32700 | PARSE_ERROR |
| -32600 | INVALID_REQUEST |
| -32601 | METHOD_NOT_FOUND |
| -32602 | INVALID_PARAMS |
| -32603 | INTERNAL_ERROR |

### Gateway-Specific (-32000 to -32099)
| Code | Name | Description |
|------|------|-------------|
| -32001 | AUTH_REQUIRED | Method requires authentication |
| -32002 | AUTH_FAILED | Authentication failed |
| -32003 | AUTH_EXPIRED | Session expired |
| -32004 | PERMISSION_DENIED | Insufficient permissions |
| -32005 | RATE_LIMITED | Too many requests |
| -32006 | CONNECTION_LIMIT | Max connections per IP reached |
| -32007 | INVALID_TOKEN | Invalid pairing/auth token |
| -32008 | CHALLENGE_EXPIRED | Auth challenge timed out (60s) |
| -32009 | SIGNATURE_INVALID | Ed25519 signature verification failed |
| -32010 | GOAL_NOT_FOUND | Goal ID doesn't exist |
| -32011 | WORKITEM_NOT_FOUND | Work item ID doesn't exist |
| -32012 | ESCALATION_NOT_FOUND | Escalation ID doesn't exist |
| -32013 | RUN_NOT_FOUND | Run ID doesn't exist |
| -32014 | PERMISSION_REQUEST_NOT_FOUND | Permission request ID doesn't exist |
| -32020 | GOAL_ALREADY_CANCELLED | Goal is already cancelled |
| -32021 | ESCALATION_ALREADY_RESOLVED | Escalation is already resolved |
| -32022 | INVALID_STATE_TRANSITION | State machine rejects the transition |

## 5.5 IPC Protocol

### Transport
- **Socket**: Unix domain socket at `/tmp/ponybunny-ipc.sock`
- **Format**: Line-delimited JSON (one JSON object per line)
- **Reliability**: Auto-reconnect with exponential backoff (1s → 30s), message buffering (max 1000)

### Message Structure

```typescript
interface IPCMessage {
  type: 'scheduler_event' | 'session_event' | 'debug_event'
       | 'run_event_retention' | 'scheduler_command'
       | 'scheduler_command_result' | 'ping' | 'pong'
       | 'connect' | 'disconnect';
  timestamp: number;
  data?: unknown;
}
```

### Scheduler → Gateway Messages

| Type | Data | Description |
|------|------|-------------|
| `scheduler_event` | `{ event: SchedulerEvent }` | Goal/workitem/run state changes |
| `session_event` | `{ event, gatewaySessionId?, sessionId?, payload? }` | Conversation events routed to specific session |
| `debug_event` | `{ event: DebugEvent }` | Instrumentation for debug dashboard |
| `run_event_retention` | `{ deleted, ok }` | Cleanup notification |

### Gateway → Scheduler Commands

| Command | Description |
|---------|-------------|
| `materialize_goal` | Create goal from conversation (routes through GoalHarness if available) |
| `submit_goal` | Submit goal for execution |
| `cancel_goal` | Cancel active goal |
| `replay_run` | Replay a failed/orphaned run |
| `apply_runtime_rollout` | Apply runtime configuration changes |
| `set_agent_model_override` | Override model for specific agent |
| `session_open` | Open new conversation session |
| `session_message` | Send message to session |
| `session_history` | Get session history |
| `session_end` | End conversation session |

### Control Messages

| Type | Direction | Description |
|------|-----------|-------------|
| `connect` | Client → Server | `{ clientType, version, pid }` |
| `disconnect` | Client → Server | `{ reason? }` |
| `ping` | Server → Client | Heartbeat |
| `pong` | Client → Server | Heartbeat response |
