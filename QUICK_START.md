# Quick Start Guide - Daemon-Gateway IPC Architecture

## 快速启动指南

### 前提条件

1. 已构建项目：
```bash
npm run build
npm run build:cli
```

2. 已配置 LLM API keys（在 `~/.ponybunny/credentials.json`）

### 启动步骤

#### 方式 1：分别启动（推荐用于调试）

**终端 1 - 启动 Gateway：**
```bash
pb gateway start --foreground --debug
```

**终端 2 - 启动 Scheduler Daemon：**
```bash
pb scheduler start --foreground --debug
```

**终端 3 - 启动 Debug Server（可选）：**
```bash
cd debug-server/server
npm run dev
```

然后访问 http://localhost:18790 查看 Debug WebUI

#### 方式 2：后台启动（生产环境）

```bash
# 启动 Gateway（后台）
pb gateway start

# 启动 Scheduler Daemon（后台）
pb scheduler start

# 查看日志
tail -f ~/.ponybunny/gateway.log
tail -f ~/.ponybunny/scheduler.log
```

### 验证系统运行

1. **检查 Gateway 是否运行：**
```bash
# 应该看到 WebSocket 服务器监听在 18789 端口
lsof -i :18789
```

2. **检查 IPC Socket 是否创建：**
```bash
# 应该看到 gateway.sock 文件
ls -la ~/.ponybunny/gateway.sock
```

3. **检查 Scheduler Daemon 是否连接：**
在 Gateway 的日志中应该看到：
```
[IPCServer] Client connected: client-1
[IPCBridge] Connected to IPC server
```

在 Daemon 的日志中应该看到：
```
[IPCClient] Connected to /Users/xxx/.ponybunny/gateway.sock
[SchedulerDaemon] Started successfully
```

### 测试任务执行

#### 通过 WebUI（如果可用）

1. 打开 WebUI
2. 发送消息："帮我创建一个测试文件"
3. 观察：
   - WebUI 显示实时进度
   - Gateway 日志显示接收到事件
   - Daemon 日志显示执行过程

#### 通过 CLI（如果有 work 命令）

```bash
pb work create "Create a test file named hello.txt"
```

### 查看 Debug 事件

1. 打开 Debug Server WebUI: http://localhost:18790
2. 应该看到实时的 debug 事件流
3. 可以按类型过滤：
   - `scheduler.*` - Scheduler 事件
   - `execution.*` - 执行事件
   - `llm.*` - LLM 调用事件
   - `tool.*` - 工具调用事件

### 测试重连机制

1. **停止 Gateway（Ctrl+C）**
   - Daemon 应该显示：`[IPCClient] Connection closed`
   - Daemon 应该显示：`[IPCClient] State changed: reconnecting`

2. **重启 Gateway**
   ```bash
   pb gateway start --foreground --debug
   ```
   - Daemon 应该显示：`[IPCClient] Attempting to reconnect...`
   - Daemon 应该显示：`[IPCClient] Connected to ...`
   - Daemon 应该显示：`[IPCClient] Flushing X buffered messages`

### 停止系统

**前台模式：**
- 在每个终端按 `Ctrl+C`

**后台模式：**
```bash
pb gateway stop
pb scheduler stop
```

### 常见问题

#### 1. Daemon 无法连接到 Gateway

**症状：**
```
[IPCClient] Failed to connect to /Users/xxx/.ponybunny/gateway.sock
```

**解决：**
- 确保 Gateway 先启动
- 检查 socket 文件是否存在：`ls -la ~/.ponybunny/gateway.sock`
- 检查文件权限

#### 2. 没有看到任务执行

**症状：**
- Goal 被创建但没有执行

**检查：**
1. Daemon 是否运行：查看进程 `ps aux | grep scheduler`
2. Daemon 是否连接：查看 Gateway 日志
3. 数据库中是否有 queued goals：
   ```bash
   sqlite3 ~/.ponybunny/pony.db "SELECT id, title, status FROM goals WHERE status='queued';"
   ```

#### 3. Debug 事件没有出现

**症状：**
- Debug Server 没有显示事件

**检查：**
1. Gateway 是否启用 debug 模式：`--debug` 参数
2. Daemon 是否启用 debug 模式：`--debug` 参数
3. Debug Server 是否连接到 Gateway：查看 Debug Server 日志

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│ Gateway (Port 18789)                                         │
│  ├─ WebSocket Server ← WebUI                                │
│  ├─ IPC Server (~/.ponybunny/gateway.sock) ← Daemon        │
│  ├─ EventBus → BroadcastManager → WebSocket Clients        │
│  └─ DebugBroadcaster → Debug Server                        │
└─────────────────────────────────────────────────────────────┘
                              ↕ (Unix Socket)
┌─────────────────────────────────────────────────────────────┐
│ Scheduler Daemon                                             │
│  ├─ SchedulerCore (8-phase lifecycle)                      │
│  ├─ ExecutionService (ReAct)                               │
│  ├─ IPC Client → Gateway                                   │
│  └─ Debug Events → IPC → Gateway → Debug Server           │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│ SQLite Database (~/.ponybunny/pony.db)                     │
│  ├─ Goals (shared state)                                   │
│  ├─ WorkItems                                              │
│  └─ Runs                                                   │
└─────────────────────────────────────────────────────────────┘
```

### 下一步

1. 测试完整的任务执行流程
2. 添加更多 debug 事件到执行服务
3. 实现后台模式和进程管理
4. 从 Gateway 命令中移除 Scheduler 创建代码

## 已知问题

### Debug Server 编译失败

**问题：** Debug Server 的 better-sqlite3 在 Node.js 25.x 上编译失败

**解决方案：**
1. **降级 Node.js**（推荐）：
   ```bash
   nvm install 20
   nvm use 20
   cd debug-server/server && npm install
   ```

2. **跳过 Debug Server**：
   - 核心功能（Gateway + Daemon）不依赖 Debug Server
   - 可以通过 Gateway 和 Daemon 的日志查看事件流
   - WebUI 仍然能收到实时进度更新

### 不影响核心测试

即使没有 Debug Server，你仍然可以验证：
- ✅ Gateway 和 Daemon 通过 IPC 通信
- ✅ Goal 被 Daemon 执行
- ✅ WebUI 收到实时进度更新
- ✅ 自动重连机制
- ✅ 消息缓冲

只是无法通过 Debug WebUI 查看详细的 debug 事件。
