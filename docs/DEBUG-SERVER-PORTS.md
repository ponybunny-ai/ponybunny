# Debug Server 端口说明

## 问题：为什么有两个端口？

你可能注意到 Debug Server 有两个不同的端口配置：

- **18790** - 在 `http://localhost:18790/`
- **3001** - 在 `http://localhost:3001/`

## 答案：它们是同一个服务

这两个端口指向的是**同一个 Debug Server**，只是默认端口配置不同。

### 端口配置来源

#### 1. 原始默认端口：18790

**定义位置：** `debug-server/server/src/types.ts`

```typescript
export const DEFAULT_CONFIG: DebugServerConfig = {
  server: {
    port: 18790,  // 原始默认端口
    host: '127.0.0.1',
  },
  // ...
};
```

**使用场景：**
- 直接运行 Debug Server：`npx tsx debug-server/server/src/index.ts`
- 所有官方文档（QUICKSTART.md, WEBUI-IMPLEMENTATION.md）
- 与 Gateway 端口 18789 保持连续性

#### 2. CLI 默认端口：3001

**定义位置：** `src/cli/commands/debug.ts`

```typescript
const DEFAULT_DEBUG_SERVER_PORT = parseInt(
  process.env.DEBUG_SERVER_PORT || '3001',
  10
);
```

**使用场景：**
- CLI 命令：`pb debug web`（不指定端口时）
- 可能是为了避免与其他服务冲突
- 或者为了与 Next.js 开发服务器端口保持一致

## 推荐使用方式

### 方案 1：使用 18790（推荐）

**优点：**
- 与官方文档一致
- 端口号连续（Gateway 18789 → Debug 18790）
- 更容易记忆

```bash
# 启动在 18790 端口
pb debug web --web-port 18790

# 访问
open http://localhost:18790
```

### 方案 2：使用 3001（CLI 默认）

**优点：**
- 不需要指定端口参数
- 与 Next.js 开发服务器端口一致

```bash
# 启动在 3001 端口（默认）
pb debug web

# 访问
open http://localhost:3001
```

## 完整的端口映射

PonyBunny 系统使用的所有端口：

```
┌─────────────────────────────────────────────────────────┐
│  PonyBunny 端口映射                                      │
├─────────────────────────────────────────────────────────┤
│  18789  │  Gateway WebSocket Server                     │
│  18790  │  Debug Server (原始默认)                      │
│  3001   │  Debug Server (CLI 默认) / Next.js Dev       │
└─────────────────────────────────────────────────────────┘
```

## 功能完全相同

无论使用哪个端口，Debug Server 提供的功能都是一样的：

### Web UI 页面
- `/` - Overview（系统概览）
- `/goals` - Goals 列表
- `/goals/:id` - Goal 详情
- `/events` - 事件流
- `/metrics` - 性能指标
- `/replay/:goalId` - 时间旅行调试

### HTTP API
- `GET /api/health` - 健康检查
- `GET /api/events` - 查询事件
- `GET /api/goals` - 查询 Goals
- `GET /api/goals/:id` - Goal 详情
- `GET /api/workitems` - 查询 WorkItems
- `GET /api/runs` - 查询 Runs
- `GET /api/metrics` - 查询指标
- `GET /api/replay/:goalId/*` - Replay API

### WebSocket
- `ws://localhost:PORT/` - 实时事件流

## 如何选择端口？

### 使用 18790 如果：
- ✅ 你想与官方文档保持一致
- ✅ 你喜欢连续的端口号（18789, 18790）
- ✅ 你在生产环境或团队协作

### 使用 3001 如果：
- ✅ 你想使用 CLI 默认值（少打字）
- ✅ 你在本地开发
- ✅ 你习惯 Next.js 的端口号

## 环境变量配置

你可以通过环境变量覆盖默认端口：

```bash
# 设置 Debug Server 端口
export DEBUG_SERVER_PORT=18790

# 启动（会使用环境变量）
pb debug web

# 或者直接指定
pb debug web --web-port 18790
```

## 当前状态检查

```bash
# 检查 Debug Server 是否运行
curl http://localhost:18790/api/health
curl http://localhost:3001/api/health

# 检查端口占用
lsof -i :18790
lsof -i :3001

# 检查所有服务状态
pb service status
```

## 完整启动流程

### 1. 启动所有服务

```bash
# 启动 Gateway 和 Scheduler
pb service start all

# 启动 Debug Server（18790 端口）
pb debug web --web-port 18790
```

### 2. 验证连接

```bash
# 检查 Gateway
curl http://localhost:18789  # 应该返回 WebSocket 升级错误（正常）

# 检查 Debug Server
curl http://localhost:18790/api/health
# 应该返回：
# {
#   "status": "ok",
#   "gatewayConnected": true,  ← 应该是 true
#   "eventCount": 0,
#   "timestamp": 1234567890
# }
```

### 3. 访问 Web UI

```bash
# 在浏览器中打开
open http://localhost:18790
```

## 故障排查

### 问题：gatewayConnected 显示 false

**原因：** Gateway 未运行或 Debug Server 无法连接

**解决：**
```bash
# 1. 检查 Gateway 状态
pb service status

# 2. 启动 Gateway
pb service start gateway

# 3. 重启 Debug Server
# 先停止（Ctrl+C）
# 再启动
pb debug web --web-port 18790
```

### 问题：端口已被占用

**错误信息：** `Error: listen EADDRINUSE: address already in use`

**解决：**
```bash
# 查找占用端口的进程
lsof -i :18790

# 杀死进程
kill -9 <PID>

# 或者使用不同端口
pb debug web --web-port 18791
```

### 问题：Web UI 显示 404

**原因：** Next.js WebUI 未构建

**解决：**
```bash
cd debug-server/webui
npm install
npm run build
```

## 总结

- **18790 和 3001 是同一个 Debug Server**，只是端口不同
- **推荐使用 18790** 以保持与文档一致
- **功能完全相同**，选择你喜欢的端口即可
- **可以通过 `--web-port` 参数或环境变量自定义端口**

## 相关文档

- [DEBUG-SERVER-GUIDE.md](./DEBUG-SERVER-GUIDE.md) - 完整使用指南
- [debug-server/QUICKSTART.md](../debug-server/QUICKSTART.md) - 快速开始
- [debug-server/WEBUI-IMPLEMENTATION.md](../debug-server/WEBUI-IMPLEMENTATION.md) - WebUI 实现细节
