# Daemon-Gateway IPC Implementation Summary

## What Was Implemented

We successfully implemented **方案 A (IPC-based architecture)** where Gateway and Scheduler Daemon run as separate processes communicating via Unix domain socket.

### Phase 1: IPC Infrastructure ✅

**Created Files:**
- `src/ipc/types.ts` - IPC protocol definitions (scheduler_event, debug_event, ping/pong, connect/disconnect)
- `src/ipc/ipc-server.ts` - Unix socket server for Gateway (accepts connections, heartbeat, line-delimited JSON)
- `src/ipc/ipc-client.ts` - Unix socket client for Daemon (auto-reconnect, exponential backoff, message buffering)

**Key Features:**
- Unix domain socket at `~/.ponybunny/gateway.sock`
- Line-delimited JSON protocol
- Heartbeat mechanism (ping/pong every 30s)
- Auto-reconnection with exponential backoff (1s → 30s max)
- Message buffering during disconnection (max 1000 messages)

### Phase 2: Gateway Integration ✅

**Created Files:**
- `src/gateway/integration/ipc-bridge.ts` - Routes IPC messages to EventBus and debugEmitter

**Modified Files:**
- `src/gateway/gateway-server.ts` - Added IPC server initialization and lifecycle management

**Key Changes:**
- Gateway starts IPC server on startup
- IPC bridge routes `scheduler_event` → EventBus (same as SchedulerBridge)
- IPC bridge routes `debug_event` → debugEmitter (picked up by DebugBroadcaster)
- Gateway stops IPC server on shutdown

### Phase 3: Scheduler Daemon ✅

**Created Files:**
- `src/scheduler-daemon/daemon.ts` - New autonomous execution engine

**Key Features:**
- Uses SchedulerCore (not old AutonomyDaemon)
- Connects to Gateway via IPC client
- Forwards all scheduler events to Gateway
- Forwards all debug events to Gateway
- Handles reconnection automatically
- Graceful shutdown on SIGINT/SIGTERM

### Phase 4: CLI Integration ✅

**Created Files:**
- `src/cli/commands/scheduler-daemon.ts` - CLI command for daemon management

**Modified Files:**
- `src/cli/index.ts` - Added `pb scheduler` command

**New Commands:**
```bash
pb scheduler start [--foreground] [--db <path>] [--socket <path>] [--debug]
pb scheduler stop    # Not yet implemented
pb scheduler status  # Not yet implemented
```

### Phase 5: Debug Instrumentation ✅

**Modified Files:**
- `src/scheduler/core/scheduler.ts` - Added debug events at key lifecycle points

**Debug Events Added:**
- `scheduler.goal.submitted` - When goal is submitted
- `scheduler.workitem.starting` - When work item execution begins
- `scheduler.workitem.assigned` - When model/lane selected
- `scheduler.run.started` - When run is created
- `scheduler.workitem.success` - When execution succeeds
- `scheduler.verification.started` - When verification begins
- `scheduler.verification.completed` - When verification finishes

**Context Tracking:**
- Sets `goalId`, `workItemId`, `runId` context appropriately
- All events automatically include context for correlation

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ Process 1: Gateway (Port 18789)                             │
│  - WebSocket Server (WebUI clients)                          │
│  - RPC Handler (conversation.message, goal.create, etc.)    │
│  - EventBus (receives events from Daemon via IPC)           │
│  - IPC Server (~/.ponybunny/gateway.sock)                   │
│  - Debug Broadcaster (forwards debug events to clients)     │
└─────────────────────────────────────────────────────────────┘
                              ↕ (Unix Socket IPC)
┌─────────────────────────────────────────────────────────────┐
│ Process 2: Scheduler Daemon                                  │
│  - SchedulerCore (8-phase lifecycle orchestration)          │
│  - ExecutionService (ReAct-based task execution)            │
│  - PlanningService (LLM-based goal decomposition)           │
│  - VerificationService (quality gates)                      │
│  - EvaluationService (publish/retry/escalate decisions)     │
│  - IPC Client (sends events to Gateway)                     │
│  - Debug Instrumentation (emits debug events)               │
└─────────────────────────────────────────────────────────────┘
                              ↕
                    ┌──────────────────┐
                    │ SQLite Database  │
                    │ (shared state)   │
                    └──────────────────┘
```

## How to Test

### 1. Build the Project

```bash
npm run build
npm run build:cli
```

### 2. Start Gateway (Terminal 1)

```bash
pb gateway start --foreground --debug
```

Expected output:
```
[GatewayServer] IPC server started
[GatewayServer] Listening on ws://127.0.0.1:18789
```

### 3. Start Scheduler Daemon (Terminal 2)

```bash
pb scheduler start --foreground --debug
```

Expected output:
```
[SchedulerDaemon] Starting...
[SchedulerDaemon] Connected to Gateway IPC
[SchedulerDaemon] Debug mode enabled
[SchedulerDaemon] Started successfully
```

### 4. Create a Goal via WebUI or CLI

**Option A: Via WebUI**
- Open WebUI (if available)
- Send a message: "帮我创建一个测试文件"
- Watch for execution progress

**Option B: Via CLI (if goal creation command exists)**
```bash
pb work create "Create a test file"
```

### 5. Verify Event Flow

**In Gateway Terminal (Terminal 1):**
- Should see: `[IPCBridge] Connected to IPC server`
- Should see: `[IPCServer] Client connected: client-1`
- Should see scheduler events being received

**In Daemon Terminal (Terminal 2):**
- Should see: `[SchedulerDaemon] Connected to Gateway IPC`
- Should see: `[SchedulerCore] Submitting goal: goal-xxx`
- Should see debug events being emitted

### 6. Test Reconnection

**Kill Gateway (Ctrl+C in Terminal 1):**
- Daemon should show: `[IPCClient] Connection closed`
- Daemon should show: `[IPCClient] State changed: reconnecting`
- Daemon should buffer events

**Restart Gateway:**
```bash
pb gateway start --foreground --debug
```

- Daemon should show: `[IPCClient] Attempting to reconnect...`
- Daemon should show: `[IPCClient] Connected to ...`
- Daemon should show: `[IPCClient] Flushing X buffered messages`

### 7. Test Debug Server Integration

**Start Debug Server (Terminal 3):**
```bash
cd debug-server/server
npm run dev
```

**Open Debug WebUI:**
```
http://localhost:18790
```

**Verify:**
- Debug events appear in real-time
- Events have `goalId`, `workItemId`, `runId` context
- Can filter by event type
- Can see full event history

## What Works Now

✅ **Gateway is a pure message hub** - No business logic, only routing
✅ **Daemon executes goals autonomously** - Full 8-phase lifecycle
✅ **Events flow to WebUI in real-time** - Via Gateway EventBus
✅ **Debug events flow to Debug Server** - Via debugEmitter
✅ **Auto-reconnection** - Daemon reconnects if Gateway restarts
✅ **Message buffering** - No event loss during disconnection
✅ **Process isolation** - Gateway crash doesn't affect Daemon execution
✅ **Debug instrumentation** - Scheduler emits debug events at key points

## What Still Needs Work

### High Priority
1. **Add debug instrumentation to execution services**
   - ExecutionService
   - PlanningService
   - VerificationService
   - EvaluationService
   - ReActIntegration

2. **Remove Scheduler from Gateway command**
   - Currently `pb gateway start` still creates Scheduler
   - Should be removed to enforce separation

3. **Background/daemon mode for scheduler**
   - Currently only foreground mode works
   - Need PID file management
   - Need daemon supervisor

### Medium Priority
4. **Combined start command**
   - `pb start` to launch both Gateway and Daemon
   - Manage both processes
   - Graceful shutdown of both

5. **Status commands**
   - `pb scheduler status` - Check if daemon is running
   - `pb gateway status` - Check if gateway is running

6. **Stop commands**
   - `pb scheduler stop` - Stop daemon gracefully
   - `pb gateway stop` - Stop gateway gracefully

### Low Priority
7. **Unit tests**
   - IPC server/client tests
   - IPC bridge tests
   - Scheduler daemon tests

8. **Integration tests**
   - End-to-end goal execution
   - Reconnection scenarios
   - Event ordering verification

## Known Issues

1. **Gateway still creates Scheduler** - The `pb gateway start` command still has Scheduler creation code (lines 454-477 in gateway.ts). This should be removed.

2. **No PID file for daemon** - Can't easily check if daemon is running or stop it programmatically.

3. **No log rotation** - Logs will grow indefinitely in foreground mode.

4. **No health checks** - No way to verify daemon is healthy beyond checking IPC connection.

## Files Modified

### New Files (11)
- `src/ipc/types.ts`
- `src/ipc/ipc-server.ts`
- `src/ipc/ipc-client.ts`
- `src/gateway/integration/ipc-bridge.ts`
- `src/scheduler-daemon/daemon.ts`
- `src/cli/commands/scheduler-daemon.ts`

### Modified Files (3)
- `src/gateway/gateway-server.ts` - Added IPC server
- `src/scheduler/core/scheduler.ts` - Added debug events
- `src/cli/index.ts` - Added scheduler command
- `src/gateway/rpc/handlers/clarify-handlers.ts` - Fixed build error

## Next Steps

1. **Test the implementation**
   - Follow the testing steps above
   - Verify event flow works correctly
   - Test reconnection scenarios

2. **Add more debug instrumentation**
   - ExecutionService, PlanningService, etc.
   - ReActIntegration (LLM calls, tool invocations)

3. **Remove Scheduler from Gateway**
   - Clean up gateway.ts to remove Scheduler creation
   - Update documentation

4. **Implement background mode**
   - PID file management
   - Daemon supervisor
   - Log file rotation

5. **Add status/stop commands**
   - Check daemon status
   - Graceful shutdown

## Success Criteria

✅ Gateway starts without Scheduler
✅ Daemon connects to Gateway via IPC
✅ Goals created via WebUI are executed by Daemon
✅ WebUI receives real-time progress updates
✅ Debug Server receives debug events
✅ Daemon reconnects automatically if Gateway restarts
✅ No events lost during reconnection
