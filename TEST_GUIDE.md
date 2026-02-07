# 测试指南 - Daemon-Gateway IPC 架构

## 核心功能测试（不需要 Debug Server）

### 准备工作

```bash
# 1. 构建项目
npm run build
npm run build:cli

# 2. 确保有 LLM API keys
cat ~/.ponybunny/credentials.json
```

### 测试 1：基本连接测试

**目标：** 验证 Gateway 和 Daemon 能够通过 IPC 通信

**步骤：**

1. **启动 Gateway（终端 1）：**
```bash
pb gateway start --foreground --debug
```

**预期输出：**
```
[GatewayServer] IPC server started
[IPCServer] Listening on /Users/xxx/.ponybunny/gateway.sock
[GatewayServer] Listening on ws://127.0.0.1:18789
```

2. **启动 Scheduler Daemon（终端 2）：**
```bash
pb scheduler start --foreground --debug
```

**预期输出：**
```
[SchedulerDaemon] Starting...
[IPCClient] Connected to /Users/xxx/.ponybunny/gateway.sock
[SchedulerDaemon] Debug mode enabled
[SchedulerDaemon] Started successfully
```

3. **在 Gateway 终端查看：**
```
[IPCServer] Client connected: client-1
[IPCBridge] Connected to IPC server
```

**✅ 成功标志：** 两个进程都启动，Daemon 显示已连接

---

### 测试 2：重连机制测试

**目标：** 验证 Daemon 能够自动重连 Gateway

**步骤：**

1. **在 Gateway 终端按 Ctrl+C 停止 Gateway**

2. **在 Daemon 终端观察：**
```
[IPCClient] Connection closed
[IPCClient] State changed: disconnecting
[IPCClient] State changed: reconnecting
[IPCClient] Attempting to reconnect...
```

3. **重启 Gateway：**
```bash
pb gateway start --foreground --debug
```

4. **在 Daemon 终端观察：**
```
[IPCClient] Connected to /Users/xxx/.ponybunny/gateway.sock
[IPCClient] Flushing X buffered messages
```

**✅ 成功标志：** Daemon 自动重连，缓冲的消息被发送

---

### 测试 3：任务执行测试

**目标：** 验证通过 WebUI 创建的 Goal 能被 Daemon 执行

**前提：** Gateway 和 Daemon 都在运行

**步骤：**

1. **通过 CLI 创建一个简单的 Goal：**
```bash
# 在终端 3 执行
sqlite3 ~/.ponybunny/pony.db << 'SQL'
INSERT INTO goals (id, title, description, status, priority, budget_tokens, created_at, updated_at)
VALUES (
  'test-goal-' || hex(randomblob(8)),
  'Test Goal',
  'This is a test goal',
  'queued',
  5,
  100000,
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000
);
SELECT 'Created goal: ' || id FROM goals WHERE title = 'Test Goal' ORDER BY created_at DESC LIMIT 1;
SQL
```

2. **在 Daemon 终端观察：**
```
[SchedulerDaemon] Processing goal: test-goal-xxx
[SchedulerCore] Submitting goal: test-goal-xxx
```

3. **在 Gateway 终端观察：**
```
[IPCBridge] Received scheduler_event: goal_started
[EventBus] Emitting event: goal.started
```

**✅ 成功标志：** 
- Daemon 开始处理 Goal
- Gateway 收到 scheduler 事件
- 事件通过 EventBus 广播

---

### 测试 4：Debug 事件流测试

**目标：** 验证 debug 事件从 Daemon 流向 Gateway

**步骤：**

1. **确保两个进程都以 `--debug` 模式运行**

2. **在 Daemon 终端观察 debug 事件：**
```
[SchedulerCore] Debug event: scheduler.goal.submitted
[SchedulerCore] Debug event: scheduler.workitem.starting
```

3. **在 Gateway 终端观察：**
```
[IPCBridge] Received debug_event: scheduler.goal.submitted
[DebugBroadcaster] Broadcasting debug event to X clients
```

**✅ 成功标志：** Debug 事件从 Daemon 发送到 Gateway

---

### 测试 5：消息缓冲测试

**目标：** 验证断线期间消息不丢失

**步骤：**

1. **Gateway 和 Daemon 都在运行**

2. **停止 Gateway（Ctrl+C）**

3. **创建多个 Goals（在 Daemon 断线期间）：**
```bash
for i in {1..5}; do
  sqlite3 ~/.ponybunny/pony.db << SQL
  INSERT INTO goals (id, title, description, status, priority, budget_tokens, created_at, updated_at)
  VALUES (
    'buffered-goal-$i-' || hex(randomblob(4)),
    'Buffered Goal $i',
    'Created while disconnected',
    'queued',
    5,
    100000,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
  );
SQL
  sleep 1
done
```

4. **在 Daemon 终端观察：**
```
[IPCClient] Failed to send scheduler event: Connection closed
[IPCClient] Message buffered (buffer size: 1)
[IPCClient] Message buffered (buffer size: 2)
...
```

5. **重启 Gateway：**
```bash
pb gateway start --foreground --debug
```

6. **在 Daemon 终端观察：**
```
[IPCClient] Connected to ...
[IPCClient] Flushing 5 buffered messages
```

7. **在 Gateway 终端观察：**
```
[IPCBridge] Received scheduler_event: goal_started (x5)
```

**✅ 成功标志：** 所有缓冲的消息都被发送，没有丢失

---

## 验证清单

完成以上测试后，你应该能确认：

- ✅ Gateway 启动 IPC Server
- ✅ Daemon 连接到 Gateway IPC
- ✅ Daemon 自动重连 Gateway
- ✅ Scheduler 事件通过 IPC 发送
- ✅ Debug 事件通过 IPC 发送
- ✅ 断线期间消息被缓冲
- ✅ 重连后缓冲消息被发送
- ✅ Gateway 将事件广播到 EventBus
- ✅ 两个进程可以独立重启

## 查看日志

### 实时查看 Gateway 日志
```bash
# 如果是前台模式，直接在终端查看
# 如果是后台模式：
tail -f ~/.ponybunny/gateway.log
```

### 实时查看 Daemon 日志
```bash
# 如果是前台模式，直接在终端查看
# 如果是后台模式：
tail -f ~/.ponybunny/scheduler.log
```

### 查看数据库状态
```bash
# 查看所有 Goals
sqlite3 ~/.ponybunny/pony.db "SELECT id, title, status FROM goals ORDER BY created_at DESC LIMIT 10;"

# 查看 queued Goals
sqlite3 ~/.ponybunny/pony.db "SELECT id, title, status FROM goals WHERE status='queued';"

# 查看 active Goals
sqlite3 ~/.ponybunny/pony.db "SELECT id, title, status FROM goals WHERE status='active';"
```

### 检查 IPC Socket
```bash
# 查看 socket 文件
ls -la ~/.ponybunny/gateway.sock

# 查看连接状态
lsof ~/.ponybunny/gateway.sock
```

## 故障排查

### Daemon 无法连接

**症状：**
```
[IPCClient] Failed to connect: ENOENT
```

**原因：** Gateway 未启动或 socket 文件不存在

**解决：**
1. 先启动 Gateway
2. 确认 socket 文件存在：`ls -la ~/.ponybunny/gateway.sock`

### 没有看到事件

**症状：** Gateway 收不到 Daemon 的事件

**检查：**
1. Daemon 是否连接成功
2. Gateway 日志中是否有 `[IPCServer] Client connected`
3. Daemon 是否在处理 Goals

### Goals 不执行

**症状：** Goals 停留在 queued 状态

**检查：**
1. Daemon 是否运行：`ps aux | grep scheduler`
2. Daemon 是否连接到 Gateway
3. 查看 Daemon 日志是否有错误

## 下一步

测试通过后，你可以：

1. **集成 WebUI** - 让 WebUI 通过 Gateway 创建 Goals
2. **添加更多 debug 事件** - 在 ExecutionService 等服务中添加
3. **实现后台模式** - PID 文件管理和 daemon 模式
4. **移除 Gateway 中的 Scheduler** - 完全分离两个进程

## 成功！

如果所有测试都通过，恭喜！你已经成功实现了：

✅ **进程分离架构** - Gateway 和 Daemon 独立运行
✅ **IPC 通信** - Unix Socket 实现进程间通信
✅ **事件流转** - Scheduler 和 Debug 事件实时传输
✅ **自动重连** - 断线自动恢复，不丢失消息
✅ **消息缓冲** - 断线期间缓冲最多 1000 条消息

现在你的系统已经是一个真正的分布式架构，Gateway 是纯消息枢纽，Daemon 是独立的执行引擎！
