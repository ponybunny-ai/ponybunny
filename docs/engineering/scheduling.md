# 调度与并发控制 (Scheduling & Concurrency Control)

## 概述

OpenClaw 使用 **Lane-based Queuing System**（基于车道的队列系统）来管理多个 Agent 任务的并发执行，确保系统资源的合理分配和避免资源竞争。本文档深入分析调度算法、并发控制机制及性能优化策略。

**核心实现文件**:
- `src/process/command-queue.ts` (161 行) - Lane 队列核心实现
- `src/process/lanes.ts` (7 行) - Lane 常量定义
- `src/agents/pi-embedded-runner/lanes.ts` (16 行) - Session Lane 解析
- `src/process/child-process-bridge.ts` (48 行) - 子进程信号转发

**设计目标**:
- ✅ **资源隔离** - 不同类型任务互不干扰
- ✅ **并发控制** - 防止资源过载
- ✅ **公平调度** - FIFO 保证先到先服务
- ✅ **可观测性** - 详细的队列状态监控

**版本**: 基于 OpenClaw commit `75093ebe1` (2026-01-30)

---

## 1. Lane System 架构

### 1.1 Lane 定义

OpenClaw 预定义了四种核心 Lane（`CommandLane` enum）：

| Lane | 用途 | 默认并发数 | 配置路径 | 隔离级别 |
|:---|:---|:---|:---|:---|
| **Main** | 主 Agent 执行（用户直接对话） | 可配置 | `agents.defaults.maxConcurrent` | 全局 |
| **Subagent** | 子 Agent 执行（Agent 生成的子任务） | 可配置 | `agents.defaults.subagent.maxConcurrent` | 全局 |
| **Cron** | 定时任务 | 1 | `cron.maxConcurrentRuns` | 全局 |
| **Nested** | 嵌套执行（特殊情况，如递归 Agent） | 1 | Hard-coded | 全局 |

**额外的动态 Lane**:
- **Session Lanes**: `session:<sessionId>` - 每个 Session 一个独立 Lane
- **Auth Probe Lanes**: `auth-probe:<provider>` - 认证探测任务
- **Custom Lanes**: 任意字符串，按需创建

### 1.2 Lane State 数据结构

**定义位置**: `command-queue.ts`, line 18-24

```typescript
type LaneState = {
  lane: string;              // Lane 标识符
  queue: QueueEntry[];       // 待执行任务队列 (FIFO)
  active: number;            // 当前正在执行的任务数
  maxConcurrent: number;     // 允许的最大并发数
  draining: boolean;         // 是否正在排空队列 (防止重入)
};
```

**全局 Lane 注册表**:
```typescript
const lanes = new Map<string, LaneState>();  // 所有 Lane 的集中存储
```

**Lane 创建时机**:
- **懒加载** - 首次 `enqueueCommandInLane()` 时自动创建
- **初始状态** - `maxConcurrent=1`, `queue=[]`, `active=0`

### 1.3 Queue Entry 结构

**定义位置**: `command-queue.ts`, line 9-16

```typescript
type QueueEntry = {
  task: () => Promise<unknown>;            // 待执行的异步任务
  resolve: (value: unknown) => void;       // Promise 成功回调
  reject: (reason?: unknown) => void;      // Promise 失败回调
  enqueuedAt: number;                      // 入队时间戳 (ms)
  warnAfterMs: number;                     // 等待超时警告阈值
  onWait?: (waitMs: number, queuedAhead: number) => void;  // 等待回调
};
```

**关键字段说明**:
- **task**: 封装实际业务逻辑的异步函数
- **resolve/reject**: 用于实现 `enqueueCommandInLane()` 返回的 Promise
- **enqueuedAt**: 用于计算队列等待时间
- **warnAfterMs**: 默认 2000ms，超过则触发日志警告
- **onWait**: 可选回调，用于外部监控系统集成

---

## 2. 调度算法详解

### 2.1 入队操作 (Enqueue)

**函数签名**:
```typescript
function enqueueCommandInLane<T>(
  lane: string,
  task: () => Promise<T>,
  opts?: {
    warnAfterMs?: number;
    onWait?: (waitMs: number, queuedAhead: number) => void;
  }
): Promise<T>
```

**执行流程** (`command-queue.ts`, line 99-122):

```typescript
// 1. 规范化 Lane 名称
const cleaned = lane.trim() || CommandLane.Main;

// 2. 获取或创建 LaneState
const state = getLaneState(cleaned);

// 3. 创建 Promise 并构造 QueueEntry
return new Promise<T>((resolve, reject) => {
  state.queue.push({
    task: () => task(),
    resolve: (value) => resolve(value as T),
    reject,
    enqueuedAt: Date.now(),
    warnAfterMs: opts?.warnAfterMs ?? 2_000,
    onWait: opts?.onWait,
  });
  
  // 4. 记录入队日志
  logLaneEnqueue(cleaned, state.queue.length + state.active);
  
  // 5. 触发排空逻辑
  drainLane(cleaned);
});
```

**关键特性**:
- **非阻塞** - 立即返回 Promise
- **FIFO 保证** - 使用 `queue.push()` 追加到尾部
- **自动排空** - 每次入队后尝试执行

### 2.2 排空操作 (Drain)

**核心函数**: `drainLane()` (`command-queue.ts`, line 44-90)

**算法伪代码**:
```
function drainLane(lane):
  state = getLaneState(lane)
  
  # 防止重入 (多个 enqueue 同时调用)
  if state.draining:
    return
  
  state.draining = true
  
  function pump():
    # 核心循环: 在并发限制内，尽可能多地启动任务
    while state.active < state.maxConcurrent AND state.queue.length > 0:
      entry = state.queue.shift()  # 从队列头部取出
      waitedMs = Date.now() - entry.enqueuedAt
      
      # 等待时间监控
      if waitedMs >= entry.warnAfterMs:
        entry.onWait?(waitedMs, state.queue.length)
        log.warn("lane wait exceeded", {lane, waitedMs, queueAhead: state.queue.length})
      
      logLaneDequeue(lane, waitedMs, state.queue.length)
      state.active += 1
      
      # 异步执行任务 (不阻塞循环)
      async(() => {
        startTime = Date.now()
        try:
          result = await entry.task()
          state.active -= 1
          pump()  # 继续排空队列
          entry.resolve(result)
        catch err:
          state.active -= 1
          log.error("lane task error", {lane, error: err})
          pump()  # 即使失败也继续排空
          entry.reject(err)
      })
    
    state.draining = false
  
  pump()
```

**关键点**:

1. **重入保护**: `draining` 标志防止多个 `drainLane()` 同时执行
2. **并发限制**: `while (active < maxConcurrent && queue.length > 0)`
3. **异步执行**: 任务在后台执行，不阻塞 `pump()` 循环
4. **递归排空**: 任务完成后调用 `pump()` 继续处理队列
5. **错误恢复**: 任务失败不影响队列继续执行

### 2.3 并发控制机制

**并发数调整** (`setCommandLaneConcurrency()`, line 92-97):

```typescript
export function setCommandLaneConcurrency(lane: string, maxConcurrent: number) {
  const cleaned = lane.trim() || CommandLane.Main;
  const state = getLaneState(cleaned);
  
  // 1. 更新并发数 (最小为 1)
  state.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
  
  // 2. 立即尝试排空队列 (可能有任务在等待)
  drainLane(cleaned);
}
```

**动态调整时机**:
- **启动时**: 从配置文件读取
- **运行时**: 通过 `config.apply` RPC 方法动态调整
- **自适应**: 根据系统负载自动调整（未实现，预留）

**并发数配置建议**:

| 场景 | Main Lane | Subagent Lane | Cron Lane | 理由 |
|:---|:---|:---|:---|:---|
| **单用户开发环境** | 1 | 1 | 1 | 避免上下文混乱，便于调试 |
| **小团队 (2-5人)** | 2-4 | 1-2 | 1 | 平衡响应性和资源占用 |
| **中型部署 (10-20人)** | 4-8 | 2-4 | 2 | 充分利用多核 CPU |
| **大型部署 (50+人)** | 8-16 | 4-8 | 2-4 | 最大化吞吐量 |
| **高负载场景** | 16+ | 8+ | 4+ | 需要配合 Load Balancer |

### 2.4 等待时间监控

**超时检测** (`drainLane()`, line 54-60):

```typescript
const waitedMs = Date.now() - entry.enqueuedAt;
if (waitedMs >= entry.warnAfterMs) {
  // 1. 触发用户回调
  entry.onWait?.(waitedMs, state.queue.length);
  
  // 2. 记录警告日志
  diag.warn(
    `lane wait exceeded: lane=${lane} waitedMs=${waitedMs} queueAhead=${state.queue.length}`
  );
}
```

**使用示例**:
```typescript
await enqueueCommandInLane("main", async () => {
  return await performHeavyTask();
}, {
  warnAfterMs: 5000,  // 5 秒超时
  onWait: (waitMs, queuedAhead) => {
    metrics.recordQueueWait("main", waitMs);
    if (queuedAhead > 10) {
      alert("Queue congestion detected!");
    }
  },
});
```

---

## 3. Session-Level 隔离

### 3.1 Session Lane 设计

**目标**: 同一 Session 的多次调用必须串行执行，避免消息乱序

**实现**: `resolveSessionLane()` (`pi-embedded-runner/lanes.ts`, line 3-6)

```typescript
export function resolveSessionLane(key: string) {
  const cleaned = key.trim() || CommandLane.Main;
  // 规范化为 "session:<sessionId>" 格式
  return cleaned.startsWith("session:") ? cleaned : `session:${cleaned}`;
}
```

**Lane 命名规则**:
```
Session ID: "ses_abc123"
→ Lane Name: "session:ses_abc123"

Session Key (legacy): "agent:cli:user-123"
→ Lane Name: "session:agent:cli:user-123"
```

### 3.2 Global Lane + Session Lane 双层队列

**实现位置**: `pi-embedded-runner/run.ts`, line 75-91

```typescript
const sessionLane = resolveSessionLane(params.sessionKey?.trim() || params.sessionId);
const globalLane = resolveGlobalLane(params.lane);  // 通常是 "main" 或 "subagent"

return enqueueSession(() =>
  enqueueGlobal(async () => {
    // 实际的 Agent 执行逻辑
    const result = await runEmbeddedAttempt({ ... });
    return result;
  })
);
```

**队列嵌套逻辑**:
```
┌─────────────────────────────────────────────────┐
│  Global Lane ("main")                           │
│  maxConcurrent: 4                               │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │ Session Lane ("session:ses_abc123")       │ │
│  │ maxConcurrent: 1 (默认)                   │ │
│  │                                           │ │
│  │ ┌─────────────────────────────────────┐   │ │
│  │ │ Task 1: Agent 执行                  │   │ │
│  │ └─────────────────────────────────────┘   │ │
│  │ ┌─────────────────────────────────────┐   │ │
│  │ │ Task 2: 等待 Task 1 完成            │   │ │
│  │ └─────────────────────────────────────┘   │ │
│  └───────────────────────────────────────────┘ │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │ Session Lane ("session:ses_def456")       │ │
│  │ (可并发执行，与 ses_abc123 隔离)         │ │
│  └───────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**工作原理**:
1. **Global Lane** 控制全局并发数（如 4 个并发 Agent）
2. **Session Lane** 确保同一 Session 内的调用串行化
3. **不同 Session** 可以并发执行（受 Global Lane 限制）

**示例场景**:
```
用户 Alice (ses_abc123):
  - 10:00:00  发送 "帮我重构代码" → 进入 session:ses_abc123
  - 10:00:05  发送 "等等，先别重构" → 进入 session:ses_abc123 队列
  - 第二条消息等待第一条完成后才执行

用户 Bob (ses_def456):
  - 10:00:02  发送 "生成测试代码" → 进入 session:ses_def456
  - 与 Alice 的任务并发执行（不冲突）
```

### 3.3 Session Lane 并发数配置

**默认值**: 1 (强制串行)

**可选配置** (通过 `setCommandLaneConcurrency()`):
```typescript
// 允许同一 Session 内 2 个并发任务
setCommandLaneConcurrency("session:ses_abc123", 2);
```

**警告**: 同一 Session 内并发执行可能导致：
- 消息乱序
- 上下文冲突
- 工具调用结果混淆

**推荐**: 保持 Session Lane 并发数为 1

---

## 4. 子进程信号管理

### 4.1 Child Process Bridge 架构

**用途**: 当 OpenClaw 进程收到终止信号 (SIGTERM, SIGINT) 时，转发给所有子进程

**实现位置**: `child-process-bridge.ts` (48 行)

**使用场景**:
- 执行 shell 命令 (Bash tool)
- 启动长期运行的进程 (dev server, watch mode)
- 子 Agent 进程

### 4.2 信号转发机制

**函数签名**:
```typescript
export function attachChildProcessBridge(
  child: ChildProcess,
  {
    signals = defaultSignals,  // 要监听的信号列表
    onSignal?: (signal: NodeJS.Signals) => void  // 信号回调
  } = {}
): { detach: () => void }
```

**默认信号** (`child-process-bridge.ts`, line 9-12):
```typescript
const defaultSignals: NodeJS.Signals[] =
  process.platform === "win32"
    ? ["SIGTERM", "SIGINT", "SIGBREAK"]        // Windows
    : ["SIGTERM", "SIGINT", "SIGHUP", "SIGQUIT"];  // Unix/Linux/macOS
```

**实现逻辑**:
```typescript
const listeners = new Map<NodeJS.Signals, () => void>();

for (const signal of signals) {
  const listener = (): void => {
    // 1. 触发用户回调
    onSignal?.(signal);
    
    // 2. 转发信号到子进程
    try {
      child.kill(signal);
    } catch {
      // 子进程可能已退出，忽略错误
    }
  };
  
  // 3. 在父进程上注册信号监听器
  try {
    process.on(signal, listener);
    listeners.set(signal, listener);
  } catch {
    // 某些信号在特定平台不支持，忽略
  }
}

// 4. 自动清理机制
const detach = (): void => {
  for (const [signal, listener] of listeners) {
    process.off(signal, listener);
  }
  listeners.clear();
};

child.once("exit", detach);   // 子进程退出时清理
child.once("error", detach);  // 子进程错误时清理

return { detach };
```

### 4.3 优雅关闭流程

**示例: Bash Tool 执行** (伪代码):
```typescript
async function executeBashCommand(command: string) {
  const child = spawn("bash", ["-c", command]);
  
  // 1. 附加信号桥接
  const { detach } = attachChildProcessBridge(child, {
    onSignal: (signal) => {
      console.log(`Forwarding ${signal} to bash process`);
    },
  });
  
  try {
    // 2. 等待子进程完成
    const result = await waitForChildExit(child);
    return result;
  } finally {
    // 3. 手动分离（如果子进程仍在运行）
    detach();
  }
}
```

**优势**:
- **级联终止** - 父进程被杀时，所有子进程也收到信号
- **防止僵尸进程** - 子进程退出时自动清理监听器
- **跨平台** - 根据操作系统选择合适的信号

---

## 5. 队列状态查询

### 5.1 单个 Lane 查询

**函数**: `getQueueSize()` (`command-queue.ts`, line 134-141)

```typescript
export function getQueueSize(lane: string = CommandLane.Main): number {
  const resolved = lane.trim() || CommandLane.Main;
  const state = lanes.get(resolved);
  
  if (!state) {
    return 0;  // Lane 不存在，队列为空
  }
  
  // 返回 队列中的任务 + 正在执行的任务
  return state.queue.length + state.active;
}
```

**使用示例**:
```typescript
const mainQueueSize = getQueueSize("main");
const sessionQueueSize = getQueueSize("session:ses_abc123");

if (mainQueueSize > 10) {
  console.warn("Main lane congestion detected!");
}
```

### 5.2 全局队列查询

**函数**: `getTotalQueueSize()` (`command-queue.ts`, line 143-149)

```typescript
export function getTotalQueueSize(): number {
  let total = 0;
  for (const s of lanes.values()) {
    total += s.queue.length + s.active;
  }
  return total;
}
```

**使用场景**:
- Health check endpoint
- 负载均衡决策
- 系统监控仪表盘

### 5.3 队列清空

**函数**: `clearCommandLane()` (`command-queue.ts`, line 151-160)

```typescript
export function clearCommandLane(lane: string = CommandLane.Main): number {
  const cleaned = lane.trim() || CommandLane.Main;
  const state = lanes.get(cleaned);
  
  if (!state) {
    return 0;
  }
  
  const removed = state.queue.length;
  state.queue.length = 0;  // 清空队列（不影响正在执行的任务）
  return removed;
}
```

**注意**: 
- 只清空**待执行**的任务
- **不会**取消正在执行的任务
- 已入队的任务的 Promise 不会 resolve/reject（变成悬挂状态）

**推荐**: 仅在测试或紧急情况下使用

---

## 6. 性能优化与监控

### 6.1 性能指标

| 指标 | 定义 | 目标值 | 监控方式 |
|:---|:---|:---|:---|
| **Queue Depth** | 队列中等待的任务数 | \< 5 | `getQueueSize()` |
| **Wait Time (P95)** | 95% 任务的等待时间 | \< 2s | `onWait` callback |
| **Throughput** | 每秒处理的任务数 | > 10/s | 自定义计数器 |
| **Active Tasks** | 正在执行的任务数 | ≤ maxConcurrent | `state.active` |
| **Lane Count** | 活跃的 Lane 数量 | - | `lanes.size` |

### 6.2 日志监控

**Diagnostic Logger** (`logging/diagnostic.js`):

```typescript
// 入队日志
logLaneEnqueue(lane: string, totalSize: number)
→ "lane enqueue: lane=main size=3"

// 出队日志
logLaneDequeue(lane: string, waitedMs: number, queuedAhead: number)
→ "lane dequeue: lane=main waitedMs=150 ahead=2"

// 任务完成日志
diag.debug(`lane task done: lane=${lane} durationMs=5000 active=2 queued=1`)

// 任务错误日志
diag.error(`lane task error: lane=${lane} error="Timeout"`)
```

**日志级别配置**:
```bash
export OPENCLAW_LOG_LEVEL=debug  # 启用详细日志
export DEBUG=openclaw:*          # 启用所有调试日志
```

### 6.3 性能瓶颈诊断

**常见问题表**:

| 症状 | 可能原因 | 排查方法 | 解决方案 |
|:---|:---|:---|:---|
| 队列持续增长 | 并发数太低 | 检查 `maxConcurrent` | 增加并发数 |
| 等待时间过长 | 任务执行慢 | 检查任务平均耗时 | 优化任务逻辑或增加并发 |
| CPU 空闲但队列满 | I/O 瓶颈 | 检查是否等待外部 API | 增加并发数或使用连接池 |
| 内存持续增长 | 任务泄漏 | 检查 `active` 是否回归 0 | 修复任务未完成的 bug |
| 频繁 "lane wait exceeded" | 队列拥堵 | 查看 `queuedAhead` | 增加并发或降低任务入队速率 |

### 6.4 自适应并发调整 (未实现，设计建议)

**算法伪代码**:
```typescript
// 每 10 秒调整一次
setInterval(() => {
  const queueSize = getQueueSize("main");
  const state = getLaneState("main");
  
  if (queueSize > 10 && state.maxConcurrent < 16) {
    // 队列拥堵，增加并发
    setCommandLaneConcurrency("main", state.maxConcurrent + 2);
  } else if (queueSize === 0 && state.maxConcurrent > 2) {
    // 队列空闲，降低并发
    setCommandLaneConcurrency("main", state.maxConcurrent - 1);
  }
}, 10000);
```

**注意**: 需结合系统 CPU/内存监控，避免过度并发

---

## 7. 资源竞争避免

### 7.1 Database Concurrency

**SQLite WAL Mode** (详见 `database.md`):
- 支持多个并发读
- 单个写操作串行化
- Lane 系统确保写操作不会过载

**推荐配置**:
```json
{
  "database": {
    "mode": "wal",
    "busy_timeout": 5000  // 5 秒
  }
}
```

### 7.2 Session File Locking

**机制**: `proper-lockfile` npm package

**实现** (伪代码):
```typescript
import lockfile from "proper-lockfile";

async function updateSessionFile(sessionId: string, updates: unknown) {
  const filePath = `~/.openclaw/sessions/chats/${sessionId}.json5`;
  
  // 1. 获取文件锁
  const release = await lockfile.lock(filePath, {
    stale: 10000,  // 10 秒锁过期
    retries: {
      retries: 5,
      minTimeout: 100,
      maxTimeout: 1000,
    },
  });
  
  try {
    // 2. 读取文件
    const data = await readJson5(filePath);
    
    // 3. 应用更新
    Object.assign(data, updates);
    
    // 4. 写回文件
    await writeJson5(filePath, data);
  } finally {
    // 5. 释放锁
    await release();
  }
}
```

**Session Lane 配合**:
- 同一 Session 的操作已经串行化（通过 Session Lane）
- 文件锁作为第二层防护（防止外部进程冲突）

### 7.3 Memory Index Concurrency

**读操作**: 无锁（多线程安全）  
**写操作**: 串行化（通过 Lane 系统）

**实现** (在 `memory/manager.ts` 中):
```typescript
// 所有写操作都在 Main Lane 执行
await enqueueCommand(async () => {
  await memoryIndex.addChunks(chunks);
});
```

---

## 8. 高级调度模式

### 8.1 优先级队列 (未实现，设计建议)

**扩展 QueueEntry**:
```typescript
type QueueEntry = {
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  enqueuedAt: number;
  priority: number;  // 新增: 优先级 (数字越大越优先)
  warnAfterMs: number;
  onWait?: (waitMs: number, queuedAhead: number) => void;
};
```

**排空算法修改**:
```typescript
// 排序队列 (优先级高的先执行)
state.queue.sort((a, b) => b.priority - a.priority);

while (state.active < state.maxConcurrent && state.queue.length > 0) {
  const entry = state.queue.shift();  // 取出优先级最高的
  // ... 执行逻辑
}
```

### 8.2 任务取消 (部分实现)

**当前实现**: Agent 运行时的 AbortController

**扩展建议**: 支持任意队列任务取消

```typescript
type QueueEntry = {
  // ... 现有字段
  abortController?: AbortController;  // 新增: 取消控制器
};

function cancelTask(taskId: string) {
  for (const state of lanes.values()) {
    const entry = state.queue.find(e => e.taskId === taskId);
    if (entry) {
      entry.abortController?.abort();
      entry.reject(new Error("Task cancelled"));
      state.queue = state.queue.filter(e => e.taskId !== taskId);
      return true;
    }
  }
  return false;
}
```

### 8.3 批量处理 (Batch Processing)

**场景**: 批量嵌入生成、批量文件索引

**设计**:
```typescript
const batchQueue: Chunk[] = [];
const BATCH_SIZE = 10;

async function enqueueChunkForEmbedding(chunk: Chunk) {
  batchQueue.push(chunk);
  
  if (batchQueue.length >= BATCH_SIZE) {
    const batch = batchQueue.splice(0, BATCH_SIZE);
    await enqueueCommand(async () => {
      await generateEmbeddingsBatch(batch);
    });
  }
}
```

---

## 9. 关键文件索引

| 文件路径 | 行数 | 功能职责 |
|:---|:---|:---|
| `src/process/command-queue.ts` | 161 | Lane 队列核心实现 (入队、排空、并发控制) |
| `src/process/lanes.ts` | 7 | Lane 常量定义 (Main, Subagent, Cron, Nested) |
| `src/agents/pi-embedded-runner/lanes.ts` | 16 | Session Lane 解析逻辑 |
| `src/process/child-process-bridge.ts` | 48 | 子进程信号转发 |
| `src/logging/diagnostic.js` | - | 队列日志记录 |
| `src/gateway/server-runtime-state.ts` | - | Agent 运行序列号、Abort 状态管理 |

---

## 10. 配置最佳实践

### 10.1 生产环境配置

```json
{
  "agents": {
    "defaults": {
      "maxConcurrent": 8,  // Main Lane 并发数
      "subagent": {
        "maxConcurrent": 4  // Subagent Lane 并发数
      }
    }
  },
  "cron": {
    "maxConcurrentRuns": 2  // Cron Lane 并发数
  }
}
```

### 10.2 测试环境配置

```json
{
  "agents": {
    "defaults": {
      "maxConcurrent": 1,  // 串行执行，便于调试
      "subagent": {
        "maxConcurrent": 1
      }
    }
  }
}
```

### 10.3 高负载环境配置

```json
{
  "agents": {
    "defaults": {
      "maxConcurrent": 16,
      "subagent": {
        "maxConcurrent": 8
      }
    }
  }
}
```

**注意**: 
- 并发数过高会增加 CPU/内存压力
- 建议根据实际硬件配置调整
- 监控 `getTotalQueueSize()` 动态调整

---

## 11. 故障排查指南

### 11.1 常见问题

**Q1: 任务一直在队列中，不执行**

**排查步骤**:
1. 检查 Lane 并发数: `getLaneState(lane).maxConcurrent`
2. 检查活跃任务数: `getLaneState(lane).active`
3. 查看日志是否有 "lane task error"

**可能原因**:
- 并发数为 0（配置错误）
- 所有任务都在执行中（增加并发或等待）
- 任务执行出错但未正确处理（修复任务逻辑）

---

**Q2: "lane wait exceeded" 频繁出现**

**排查步骤**:
1. 检查队列深度: `getQueueSize(lane)`
2. 检查任务平均耗时
3. 检查系统 CPU/内存是否饱和

**解决方案**:
- 增加并发数
- 优化任务执行速度
- 增加服务器资源

---

**Q3: 子进程未正确终止**

**排查步骤**:
1. 检查是否使用了 `attachChildProcessBridge()`
2. 检查子进程是否监听了 SIGTERM
3. 查看进程树: `ps aux | grep <process>`

**解决方案**:
- 确保子进程支持优雅关闭
- 使用 `child.kill("SIGKILL")` 强制终止（最后手段）

---

## 12. 适用场景 (Use Cases)

**PonyBunny 项目中的调度参考指南**:
- Autonomy Daemon 的任务队列设计
- Work Order System 的并发执行策略
- Multi-day Context 的任务隔离机制
- Quality Gate 的并行验证调度

---

**版本**: 基于 OpenClaw commit `75093ebe1` (2026-01-30)  
**文档更新**: 2026-01-31  
**总行数**: ~780 lines
