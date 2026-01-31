# 调度与并发控制 (Scheduling & Concurrency)

## 概述

OpenClaw使用**Lane-based Queuing System**来管理多个Agent任务的并发执行，确保系统资源的合理分配和避免资源竞争。

## Lane System 设计

### Lane 定义

系统内置了多种 Lane（车道），每种对应不同的执行上下文：

| Lane | 用途 | 默认并发数 | 配置路径 |
| :--- | :--- | :--- | :--- |
| **Main** | 主Agent执行（用户直接对话） | Config可调 | `agents.defaults.maxConcurrent` |
| **Subagent** | 子Agent执行（Agent生成的子任务） | Config可调 | `agents.defaults.subagent.maxConcurrent` |
| **Cron** | 定时任务 | 1 | `cron.maxConcurrentRuns` |
| **Nested** | 嵌套执行（特殊情况） | 1 | Hard-coded |

### Lane 并发控制机制

**实现位置**: `src/process/command-queue.ts`

每个Lane维护一个独立的状态对象：

```typescript
type LaneState = {
  lane: string;              // Lane标识符
  queue: QueueEntry[];       // 待执行任务队列
  active: number;            // 当前正在执行的任务数
  maxConcurrent: number;     // 允许的最大并发数
  draining: boolean;         // 是否正在排空队列
};
```

### 调度算法

**FIFO (First-In-First-Out)** + **并发限制**：

1.  **入队** (`enqueueCommandInLane`):
    - 任务被添加到Lane的队列尾部
    - 记录入队时间 (`enqueuedAt`)
    - 触发 `drainLane` 尝试执行

2.  **排空** (`drainLane`):
    ```
    WHILE (active < maxConcurrent && queue.length > 0):
        - 从队列头部取出一个任务
        - active += 1
        - 异步执行任务
        - 任务完成后: active -= 1, pump()继续排空
    ```

3.  **等待监控**:
    - 如果任务在队列中等待超过阈值 (`warnAfterMs`)，触发警告
    - 通过 `onWait` 回调通知监控层

##  Session 级别的隔离

虽然Lane提供了粗粒度的并发控制，但**Session级别的串行化**也很重要。

### Agent Run Sequence

**位置**: `src/gateway/server-runtime-state.ts`

- 每个Agent调用分配一个唯一的 `runId` (UUID)
- `agentRunSeq` 是一个全局计数器，用于跟踪Agent调用顺序
- **同一Session内的调用不会并发**（通过Lane + Session Key组合保证）

### Chat Run State

**位置**: `chatRunState` 对象

```typescript
{
  buffers: Map<string, MessageBuffer>,     // Session -> 消息缓冲区
  deltaSentAt: Map<string, number>,        // Session -> 上次发送时间
  abortedRuns: Set<string>                 // 已取消的runId集合
}
```

**Abort机制**:
- 每个运行中的Agent任务都有一个 `AbortController`
- 客户端可以发送 `chat.abort` 请求来取消任务
- 取消后，任务的 `runId` 被加入 `abortedRuns` 集合

## 多租户隔离

### 按Channel隔离

- 每个Channel (WhatsApp, Telegram, Slack) 都有独立的状态
- 不同Channel的Agent调用彼此独立，不共享上下文

### 按User隔离

- `sessionKey` 格式: `agent:{agentId}:{chatId}`
- 每个User的Session完全隔离
- 同一用户的多个Session可以并发执行（受Lane限制）

## 性能优化策略

### Lane 配置建议

| 场景 | Main Lane | Subagent Lane | 说明 |
| :--- | :--- | :--- | :--- |
| **单用户** | 1 | 1 | 避免上下文混乱 |
| **小团队** | 2-4 | 1-2 | 平衡响应性和资源 |
| **大型部署** | 8-16 | 4-8 | 充分利用多核CPU |

### 资源竞争避免

- **Database**: SQLite使用Write-Ahead Logging (WAL)，支持并发读
- **Session Files**: 使用文件锁 (`proper-lockfile`) 防止冲突
- **Memory Index**: 读操作无锁，写操作串行化
