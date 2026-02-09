# Debug Server 使用指南

## 概述

Debug Server 是 PonyBunny 的实时调试和可观测性系统，提供两种界面：
1. **Web UI** - 基于 Next.js 的现代化 Web 界面（推荐）
2. **TUI** - 终端界面（Terminal UI）

## 端口说明

Debug Server 有两个端口配置：

- **18790** - Debug Server 的原始默认端口（在 `debug-server/server/src/types.ts` 中定义）
- **3001** - CLI 命令 `pb debug web` 的默认端口（在 `src/cli/commands/debug.ts` 中定义）

**推荐使用 18790 端口**以保持与文档一致：

```bash
# 使用 18790 端口（推荐）
pb debug web --web-port 18790

# 或使用 3001 端口（CLI 默认）
pb debug web
```

## 架构说明

### Gateway 是否需要更改？

**不需要**。Gateway 已经完全支持 Debug Server 的所有功能：

1. **Debug Event Broadcasting** (`src/gateway/debug-broadcaster.ts`)
   - Gateway 在 debug 模式下会自动广播调试事件
   - 通过 `debugEmitter` 发送事件到订阅的客户端

2. **Debug RPC Handlers** (`src/gateway/rpc/handlers/debug-handlers.ts`)
   - 提供完整的 RPC 接口：
     - `debug.snapshot` - 系统快照
     - `debug.scheduler` - Scheduler 状态
     - `debug.goals` - Goal 列表
     - `debug.events` - 事件查询
     - `debug.events.subscribe` - 订阅实时事件流
     - `debug.gateway` - Gateway 状态

3. **Event Bus Integration**
   - Gateway 的 EventBus 会捕获所有系统事件
   - Debug Server 通过 WebSocket 订阅这些事件

### Debug Server 工作流程

```
┌─────────────┐         WebSocket          ┌──────────────┐
│   Gateway   │◄──────────────────────────►│ Debug Server │
│  (18789)    │   RPC + Event Stream       │   (3001)     │
└─────────────┘                            └──────────────┘
      │                                            │
      │ EventBus                                   │ HTTP/WS
      │ broadcasts                                 │
      ▼                                            ▼
┌─────────────┐                            ┌──────────────┐
│  Scheduler  │                            │   Web UI     │
│   Events    │                            │  (Browser)   │
└─────────────┘                            └──────────────┘
```

## 启动 Debug Server

### 方法 1: 使用 Web UI（推荐）

```bash
# 启动 Web UI（自动打开浏览器）
pb debug web

# 指定端口
pb debug web --web-port 3001

# 不自动打开浏览器
pb debug web --no-open

# 指定 Gateway 地址
pb debug web --host 127.0.0.1 --port 18789
```

访问 `http://localhost:3001` 查看 Web 界面。

### 方法 2: 使用 TUI

```bash
# 启动终端界面
pb debug tui

# 或者直接使用 debug 命令（默认是 tui）
pb debug
```

## Web UI 功能说明

### 1. Overview 页面 (`/`)

**功能：**
- 系统整体状态概览
- 实时指标（Metrics）
- 最近事件流
- 活跃 Goals

**使用场景：**
- 快速了解系统运行状态
- 监控关键指标
- 发现异常事件

### 2. Goals 页面 (`/goals`)

**功能：**
- 所有 Goals 列表
- 按状态筛选（pending, in_progress, completed, failed）
- Goal 详情查看
- WorkItems 和 Runs 层级结构

**使用场景：**
- 追踪 Goal 执行进度
- 查看 WorkItem 分解结构
- 分析失败原因

### 3. Events 页面 (`/events`)

**功能：**
- 实时事件流
- 按类型筛选（goal.*, workitem.*, run.*）
- 事件详情查看
- 时间线视图

**使用场景：**
- 调试事件流
- 追踪系统行为
- 分析事件序列

### 4. Metrics 页面 (`/metrics`)

**功能：**
- 系统性能指标
- Token 使用统计
- 执行时间分析
- 成功率统计

**使用场景：**
- 性能监控
- 成本分析
- 容量规划

### 5. Replay 页面 (`/replay/:goalId`)

**功能：**
- Goal 执行回放
- 时间轴导航
- 状态快照
- 事件差异对比

**使用场景：**
- 调试复杂问题
- 理解执行流程
- 复现错误场景

## 两种界面的区别

### Web UI 优势

1. **功能更丰富**
   - 图形化展示（图表、时间线）
   - 多标签页切换
   - 更好的数据可视化
   - Replay 功能（时间旅行调试）

2. **用户体验更好**
   - 现代化界面
   - 响应式设计
   - 实时更新
   - 更直观的交互

3. **适合场景**
   - 深度调试
   - 数据分析
   - 长时间监控
   - 团队协作

### TUI 优势

1. **轻量级**
   - 无需浏览器
   - 资源占用少
   - 启动快速

2. **适合场景**
   - 快速查看状态
   - SSH 远程调试
   - 终端环境
   - 脚本集成

## 实时事件订阅

Debug Server 通过 WebSocket 订阅 Gateway 的实时事件：

```typescript
// Gateway Client 自动订阅
await gatewayClient.connect(gatewayUrl, adminToken);
// 调用 debug.events.subscribe RPC 方法
await subscribeToDebugEvents();

// 接收事件
gatewayClient.onEvent((event) => {
  // 事件被存储到 SQLite
  // 并通过 WebSocket 广播到 Web UI
});
```

## 数据存储

Debug Server 使用独立的 SQLite 数据库：

```
~/.ponybunny/debug.db
```

**存储内容：**
- 所有系统事件（events 表）
- Goal 快照（goals 表）
- WorkItem 快照（work_items 表）
- Run 记录（runs 表）
- 性能指标（metrics 表）
- Replay 快照（snapshots 表）

**数据保留：**
- 默认保留 7 天
- 自动清理旧数据
- 可配置保留期限

## 配置文件

Debug Server 的认证 token 存储在：

```
~/.ponybunny/debug-config.json
```

```json
{
  "adminToken": "tok_xxx",
  "tokenId": "token_xxx",
  "createdAt": 1234567890
}
```

## API 端点

Debug Server 提供 HTTP API：

```
GET  /api/health              # 健康检查
GET  /api/events              # 查询事件
GET  /api/goals               # 查询 Goals
GET  /api/goals/:id           # Goal 详情
GET  /api/workitems           # 查询 WorkItems
GET  /api/runs                # 查询 Runs
GET  /api/metrics             # 查询指标

# Replay API
GET  /api/replay/:goalId/timeline       # 时间线
GET  /api/replay/:goalId/events         # 事件列表
GET  /api/replay/:goalId/state/:ts      # 状态重建
GET  /api/replay/:goalId/diff/:eventId  # 事件差异
```

## WebSocket 协议

### 连接

```javascript
const ws = new WebSocket('ws://localhost:3001');
```

### 订阅事件

```json
{
  "type": "subscribe",
  "goalId": "goal_xxx",  // 可选，筛选特定 Goal
  "types": ["goal.*"]    // 可选，筛选事件类型
}
```

### 接收事件

```json
{
  "type": "event",
  "data": {
    "id": "evt_123",
    "timestamp": 1234567890,
    "type": "goal.created",
    "goalId": "goal_xxx",
    "data": { ... }
  }
}
```

### Replay 控制

```json
// 开始回放
{ "type": "replay.start", "goalId": "goal_xxx", "speed": 1.0 }

// 暂停
{ "type": "replay.pause" }

// 恢复
{ "type": "replay.resume" }

// 跳转
{ "type": "replay.seek", "timestamp": 1234567890 }

// 单步
{ "type": "replay.step", "direction": "forward" }

// 调速
{ "type": "replay.speed", "speed": 2.0 }

// 停止
{ "type": "replay.stop" }
```

## 常见问题

### Q: Web UI 显示 "Gateway: Disconnected"

**原因：**
- Gateway 未启动
- Debug Server 无法连接到 Gateway
- 认证 token 无效

**解决：**
```bash
# 检查 Gateway 状态
pb service status

# 启动 Gateway
pb service start gateway

# 重启 Debug Server
pb debug web
```

### Q: Web UI 显示 404 页面

**原因：**
- Next.js WebUI 未构建

**解决：**
```bash
cd debug-server/webui
npm install
npm run build
```

### Q: 事件不更新

**原因：**
- WebSocket 连接断开
- Gateway 未启用 debug 模式

**解决：**
- 检查浏览器控制台 WebSocket 状态
- 确认 Gateway 以 debug 模式启动

### Q: Replay 功能不可用

**原因：**
- 快照未生成
- Goal 执行时间太短

**解决：**
- 等待 Goal 执行完成
- 快照会在关键事件时自动创建

## 开发调试

### 启动开发模式

```bash
# Terminal 1: 启动 Gateway
pb service start gateway

# Terminal 2: 启动 Debug Server（开发模式）
cd debug-server/server
npx tsx src/index.ts --gateway-url ws://localhost:18789 --port 3001

# Terminal 3: 启动 Next.js 开发服务器
cd debug-server/webui
npm run dev
```

### 查看日志

```bash
# Gateway 日志
pb gateway logs -f

# Debug Server 日志
# 查看 Terminal 2 的输出
```

## 最佳实践

1. **日常监控**
   - 使用 Web UI 的 Overview 页面
   - 关注 Metrics 面板
   - 设置自动刷新

2. **问题调试**
   - 使用 Events 页面追踪事件流
   - 使用 Goals 页面查看执行状态
   - 使用 Replay 功能复现问题

3. **性能分析**
   - 使用 Metrics 页面分析 Token 使用
   - 查看执行时间分布
   - 识别性能瓶颈

4. **团队协作**
   - 分享 Goal 详情页面 URL
   - 导出事件日志
   - 使用 Replay 演示问题

## 总结

- **Gateway 无需修改** - 已完全支持 Debug Server
- **Web UI 功能更强** - 推荐用于深度调试和分析
- **TUI 更轻量** - 适合快速查看和远程调试
- **实时事件流** - 通过 WebSocket 订阅 Gateway 事件
- **独立数据库** - 不影响主系统性能
- **Replay 功能** - 时间旅行调试，复现问题场景
