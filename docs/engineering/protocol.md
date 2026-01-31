# WebSocket RPC Protocol Specification (OpenClaw Gateway)

## 概述

OpenClaw Gateway 使用基于 JSON 的 WebSocket RPC 协议进行双向通信。本文档详细说明协议规范、消息格式、RPC 方法目录及实现细节。

**核心实现文件**:
- `src/gateway/protocol/index.ts` (522 行) - 协议验证与类型定义
- `src/gateway/protocol/schema/*.ts` (17 个文件) - JSON Schema 定义
- `src/gateway/server/ws-connection.ts` (268 行) - 连接生命周期管理
- `src/gateway/server-methods/*.ts` (20+ 文件) - RPC 方法处理器

**协议版本**: `PROTOCOL_VERSION` 常量定义于 `protocol/schema/protocol-schemas.ts`  
**默认端口**: 18789  
**传输层**: WebSocket (RFC 6455)  
**序列化**: JSON  
**验证**: JSON Schema (via AJV)

---

## 1. 传输层与连接管理

### 1.1 WebSocket Endpoint

**URL 格式**:
```
ws://<host>:<port>/
wss://<host>:<port>/  (TLS enabled)
```

**默认绑定地址**:
- `127.0.0.1:18789` (仅本地)
- `0.0.0.0:18789` (所有接口，需配置)

**配置位置**: `~/.openclaw/config.json5` → `gateway.port` / `gateway.host`

### 1.2 连接建立流程

```
Client                        Gateway Server
  |                                |
  |--- WebSocket Upgrade Req ---->|
  |                                |
  |<-- HTTP 101 Switching Proto --|
  |                                |
  |<----- connect.challenge -------|  (Event: nonce + timestamp)
  |                                |
  |------ connect (Request) ------>|  (Method: auth token)
  |                                |
  |<----- connect (Response) ------|  (Result: HelloOk)
  |                                |
  |  (Connection Authenticated)    |
  |                                |
  |<======= Bi-directional =======>|  (Requests, Responses, Events)
```

**实现**: `attachGatewayWsConnectionHandler()` (`ws-connection.ts`, 269 行)

**关键步骤**:

1. **Upgrade Request** - HTTP → WebSocket 协议升级
2. **Challenge Event** - Server 发送 `connect.challenge` 事件：
   ```json
   {
     "type": "event",
     "event": "connect.challenge",
     "payload": {
       "nonce": "uuid-v4",
       "ts": 1704067200000
     }
   }
   ```
3. **Connect Request** - Client 必须在 handshake timeout 内发送 `connect` 请求
4. **Auth Validation** - Server 验证 token/credentials
5. **Connection Ready** - 握手成功，进入正常通信模式

### 1.3 Handshake Timeout

**默认超时**: 10 秒  
**配置函数**: `getHandshakeTimeoutMs()` (`server-constants.ts`)

**超时处理** (`ws-connection.ts`, line 220-230):
```typescript
const handshakeTimer = setTimeout(() => {
  if (!client) {
    handshakeState = "failed";
    setCloseCause("handshake-timeout", {
      handshakeMs: Date.now() - openedAt,
    });
    logWsControl.warn(`handshake timeout conn=${connId} remote=${remoteAddr ?? "?"}`);
    close();  // 关闭连接
  }
}, handshakeTimeoutMs);
```

**失败原因**:
- Client 未发送 `connect` 请求
- `connect` 请求格式错误
- 认证失败
- 网络延迟过高

### 1.4 连接元数据提取

**HTTP Headers 解析** (`ws-connection.ts`, line 68-76):
```typescript
const remoteAddr = socket._socket?.remoteAddress;
const requestHost = upgradeReq.headers.host;
const requestOrigin = upgradeReq.headers.origin;
const requestUserAgent = upgradeReq.headers["user-agent"];
const forwardedFor = upgradeReq.headers["x-forwarded-for"];
const realIp = upgradeReq.headers["x-real-ip"];
```

**用途**:
- IP 白名单验证
- Logging / Audit
- Canvas Host URL 解析 (用于 Browser mode)
- 反向代理支持 (`X-Forwarded-For`, `X-Real-IP`)

### 1.5 连接关闭处理

**Close Codes** (遵循 RFC 6455):
- `1000` - Normal closure
- `1001` - Going away (server shutdown)
- `1002` - Protocol error
- `1003` - Unsupported data
- `1011` - Internal server error

**关闭时清理** (`ws-connection.ts`, line 155-218):
```typescript
socket.once("close", (code, reason) => {
  // 1. 记录关闭上下文
  const closeContext = {
    cause: closeCause,  // "handshake-timeout", "auth-failure", etc.
    handshake: handshakeState,
    durationMs: Date.now() - openedAt,
    lastFrameType, lastFrameMethod, lastFrameId,
  };
  
  // 2. 移除 presence (如果已注册)
  if (client?.presenceKey) {
    upsertPresence(client.presenceKey, { reason: "disconnect" });
    broadcast("presence", { presence: listSystemPresence() });
  }
  
  // 3. 注销 Node (如果是 Node 连接)
  if (client?.connect?.role === "node") {
    const nodeId = context.nodeRegistry.unregister(connId);
    if (nodeId) {
      context.nodeUnsubscribeAll(nodeId);
    }
  }
  
  // 4. 从 clients 集合移除
  clients.delete(client);
});
```

---

## 2. 协议帧格式 (Frame Structure)

---

## 2. 协议帧格式 (Frame Structure)

### 2.1 顶层帧类型

OpenClaw 定义了三种顶层帧类型（`GatewayFrame`）：

| 帧类型 | 方向 | 用途 | 是否需要 ID |
|:---|:---|:---|:---|
| **Request** (`req`) | Client → Server | 调用 RPC 方法 | ✅ 必须 (用于匹配 Response) |
| **Response** (`res`) | Server → Client | 响应 Request | ✅ 必须 (与 Request ID 相同) |
| **Event** (`event`) | Server → Client | 单向推送事件 | ❌ 不需要 |

### 2.2 Request Frame Schema

**TypeScript 定义**:
```typescript
type RequestFrame = {
  type: "req";
  id: string;           // Client 生成的唯一 ID (通常是 UUID)
  method: string;       // RPC 方法名 (e.g., "agent", "chat.send")
  params?: unknown;     // 方法参数 (可选，根据 method 的 Schema 验证)
};
```

**JSON Schema 验证**: `RequestFrameSchema` (`protocol/schema/frames.ts`)

**示例**:
```json
{
  "type": "req",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "method": "sessions.list",
  "params": {
    "limit": 10,
    "offset": 0
  }
}
```

**验证逻辑** (`protocol/index.ts`, line 201):
```typescript
export const validateRequestFrame = ajv.compile<RequestFrame>(RequestFrameSchema);

// 使用
if (!validateRequestFrame(frame)) {
  const errorMsg = formatValidationErrors(validateRequestFrame.errors);
  throw new Error(`Invalid request frame: ${errorMsg}`);
}
```

### 2.3 Response Frame Schema

**TypeScript 定义**:
```typescript
type ResponseFrame = {
  type: "res";
  id: string;           // 与对应 Request 的 ID 相同
  ok: boolean;          // true = 成功, false = 失败
  result?: unknown;     // ok=true 时的返回值
  error?: ErrorShape;   // ok=false 时的错误对象
};

type ErrorShape = {
  code: string;         // 错误码 (见 ErrorCodes enum)
  message: string;      // 人类可读的错误消息
  details?: unknown;    // 额外的错误上下文
};
```

**成功响应示例**:
```json
{
  "type": "res",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "ok": true,
  "result": {
    "sessions": [
      { "id": "ses_abc123", "title": "Debug session", "lastUsed": 1704067200000 }
    ],
    "total": 1
  }
}
```

**错误响应示例**:
```json
{
  "type": "res",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "ok": false,
  "error": {
    "code": "ERR_METHOD_NOT_FOUND",
    "message": "Method 'invalid.method' not found",
    "details": {
      "method": "invalid.method",
      "available": ["agent", "chat.send", "sessions.list", ...]
    }
  }
}
```

### 2.4 Event Frame Schema

**TypeScript 定义**:
```typescript
type EventFrame = {
  type: "event";
  event: string;        // 事件名称 (e.g., "chat", "agent", "presence")
  payload?: unknown;    // 事件数据 (根据 event 类型的 Schema 验证)
};
```

**事件推送示例 - Chat Event**:
```json
{
  "type": "event",
  "event": "chat",
  "payload": {
    "channel": "slack",
    "channelMeta": { "team": "T123", "channel": "C456" },
    "from": { "id": "U789", "name": "Alice" },
    "text": "Hello, OpenClaw!",
    "ts": 1704067200000
  }
}
```

**事件推送示例 - Agent Event** (流式输出):
```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "sessionId": "ses_abc123",
    "kind": "text",
    "text": "Let me analyze the code...",
    "partial": true
  }
}
```

### 2.5 错误码表 (Error Codes)

**定义位置**: `protocol/schema/error-codes.ts`

```typescript
export enum ErrorCodes {
  ERR_INVALID_REQUEST = "ERR_INVALID_REQUEST",          // 请求格式错误
  ERR_METHOD_NOT_FOUND = "ERR_METHOD_NOT_FOUND",        // RPC 方法不存在
  ERR_INVALID_PARAMS = "ERR_INVALID_PARAMS",            // 参数验证失败
  ERR_AUTH_REQUIRED = "ERR_AUTH_REQUIRED",              // 未认证
  ERR_AUTH_FAILED = "ERR_AUTH_FAILED",                  // 认证失败
  ERR_PERMISSION_DENIED = "ERR_PERMISSION_DENIED",      // 权限不足
  ERR_INTERNAL = "ERR_INTERNAL",                        // 服务器内部错误
  ERR_TIMEOUT = "ERR_TIMEOUT",                          // 请求超时
  ERR_RATE_LIMIT = "ERR_RATE_LIMIT",                    // 速率限制
  ERR_NOT_FOUND = "ERR_NOT_FOUND",                      // 资源不存在 (session, node, etc.)
  ERR_CONFLICT = "ERR_CONFLICT",                        // 资源冲突
  ERR_VALIDATION = "ERR_VALIDATION",                    // 业务逻辑验证失败
}
```

**错误构造辅助函数** (`protocol/index.ts`, line 87-91):
```typescript
export function errorShape(code: string, message: string, details?: unknown): ErrorShape {
  return {
    code,
    message,
    ...(details !== undefined ? { details } : {}),
  };
}
```

### 2.6 Frame 序列化与反序列化

**发送 Frame** (`ws-connection.ts`, line 114-120):
```typescript
const send = (obj: unknown) => {
  try {
    socket.send(JSON.stringify(obj));  // 直接 JSON 序列化
  } catch {
    /* ignore - connection may be closed */
  }
};
```

**接收 Frame** (在 `ws-connection/message-handler.ts` 中):
```typescript
socket.on("message", (rawData) => {
  let frame: unknown;
  
  try {
    const text = rawData.toString("utf-8");
    frame = JSON.parse(text);  // JSON 反序列化
  } catch {
    send({
      type: "res",
      id: "unknown",
      ok: false,
      error: errorShape("ERR_INVALID_REQUEST", "Malformed JSON"),
    });
    return;
  }
  
  // 验证 frame 类型并路由
  if (validateRequestFrame(frame)) {
    handleRequest(frame);
  } else {
    send({
      type: "res",
      id: frame.id ?? "unknown",
      ok: false,
      error: errorShape("ERR_INVALID_REQUEST", formatValidationErrors(validateRequestFrame.errors)),
    });
  }
});
```

---

## 3. 认证与授权 (Authentication)

### 3.1 Connect Method

**方法名**: `connect`  
**参数 Schema**: `ConnectParamsSchema` (`protocol/schema/frames.ts`)

**参数定义**:
```typescript
type ConnectParams = {
  auth?: string;          // 认证 Token (可选，本地连接可省略)
  client?: string;        // 客户端类型 (e.g., "webchat", "cli", "vscode")
  clientName?: string;    // 客户端显示名称
  clientVersion?: string; // 客户端版本
  role?: "client" | "node";  // 连接角色 (默认 "client")
  
  // Node 专用字段 (role="node" 时)
  nodeId?: string;        // Node ID
  nodeName?: string;      // Node 显示名称
  nodeCapabilities?: string[];  // Node 能力列表 (e.g., ["camera", "microphone"])
};
```

**响应 Schema**: `HelloOkSchema`

**响应定义**:
```typescript
type HelloOk = {
  hello: "ok";
  version: string;        // Gateway 版本号
  canvasHostUrl?: string; // Canvas Host URL (用于 Browser mode)
  protocolVersion?: string;  // 协议版本
};
```

**示例 - Client 连接**:
```json
Request:
{
  "type": "req",
  "id": "1",
  "method": "connect",
  "params": {
    "client": "vscode",
    "clientName": "VSCode Extension",
    "clientVersion": "1.2.3"
  }
}

Response:
{
  "type": "res",
  "id": "1",
  "ok": true,
  "result": {
    "hello": "ok",
    "version": "0.5.0",
    "protocolVersion": "2024-12-01"
  }
}
```

**示例 - Node 连接**:
```json
Request:
{
  "type": "req",
  "id": "1",
  "method": "connect",
  "params": {
    "role": "node",
    "nodeId": "node-macbook-pro",
    "nodeName": "MacBook Pro M1",
    "nodeCapabilities": ["camera", "microphone", "screen-capture"]
  }
}
```

### 3.2 认证机制

**支持的认证方式**:

| 认证方式 | Token 格式 | 配置位置 | 适用场景 |
|:---|:---|:---|:---|
| **No Auth** (本地环回) | (无需 token) | - | `127.0.0.1` / `::1` 连接 |
| **Shared Secret** | `secret:<token>` | `gateway.auth.token` | 简单部署 |
| **Device Pairing** | `device:<device-id>:<token>` | Device registry | 移动设备 |
| **OAuth** | `Bearer <access-token>` | OAuth provider | 企业集成 |

**验证逻辑** (`gateway/auth.ts`):
```typescript
function validateAuth(params: {
  auth?: string;
  remoteAddr?: string;
  resolvedAuth: ResolvedGatewayAuth;
}): boolean {
  // 1. 本地环回地址免认证
  if (isLoopbackAddress(params.remoteAddr)) {
    return true;
  }
  
  // 2. 检查 Shared Secret
  if (params.resolvedAuth.mode === "token") {
    return params.auth === `secret:${params.resolvedAuth.token}`;
  }
  
  // 3. 检查 Device Token
  if (params.auth?.startsWith("device:")) {
    const [_, deviceId, token] = params.auth.split(":");
    return validateDeviceToken(deviceId, token);
  }
  
  // 4. OAuth (未实现，预留)
  if (params.auth?.startsWith("Bearer ")) {
    return validateOAuthToken(params.auth.slice(7));
  }
  
  return false;
}
```

### 3.3 权限模型

**角色定义**:
- **Client** - 普通客户端，可调用大部分 RPC 方法
- **Node** - 设备节点，可注册能力并接收 `nodes.invoke` 请求

**权限控制**:
```typescript
function checkPermission(client: GatewayWsClient, method: string): boolean {
  // Node 只能调用少量方法
  if (client.connect.role === "node") {
    const allowedMethods = [
      "connect",
      "poll",
      "node.pair.verify",
      "node.event",
      "node.invoke.result",
    ];
    return allowedMethods.includes(method);
  }
  
  // Client 可调用所有公开方法
  return true;
}
```

---

## 4. RPC 方法目录 (RPC Method Catalog)

### 4.1 方法分类

| 类别 | 前缀 | 文件 | 方法数 |
|:---|:---|:---|:---|
| **Agent** | `agent*`, `agents*` | `server-methods/agent.ts`, `agents.ts` | 5 |
| **Chat** | `chat.*` | `server-methods/chat.ts` | 4 |
| **Sessions** | `sessions.*` | `server-methods/sessions.ts` | 7 |
| **Nodes** | `node.*`, `nodes.*` | `server-methods/nodes.ts` | 8 |
| **Config** | `config.*` | `server-methods/config.ts` | 5 |
| **Wizard** | `wizard.*` | `server-methods/wizard.ts` | 4 |
| **Channels** | `channels.*` | `server-methods/channels.ts` | 2 |
| **Skills** | `skills.*` | `server-methods/skills.ts` | 4 |
| **Cron** | `cron.*` | `server-methods/cron.ts` | 7 |
| **Devices** | `device.*` | `server-methods/devices.ts` | 4 |
| **Exec Approvals** | `exec.approvals.*` | `server-methods/exec-approvals.ts` | 4 |
| **Logs** | `logs.*` | `server-methods/logs.ts` | 2 |
| **Models** | `models.*` | `server-methods/models.ts` | 1 |
| **Misc** | (其他) | 多个文件 | 5+ |

**总计**: ~50+ RPC 方法

### 4.2 核心方法详解

#### 4.2.1 `agent` - 主 AI 循环

**用途**: 执行 AI Agent 任务（代码生成、问答、工具调用等）

**参数 Schema**: `AgentParamsSchema`

**参数定义**:
```typescript
type AgentParams = {
  prompt: string;          // 用户输入
  sessionId?: string;      // Session ID (可选，自动创建新 session)
  model?: string;          // 模型覆盖 (e.g., "anthropic/claude-opus-4-5")
  thinkLevel?: ThinkLevel; // 推理级别 ("off" | "low" | "medium" | "high" | "xhigh")
  workspace?: string;      // 工作目录路径
  files?: string[];        // 附加文件列表
  autoCompact?: boolean;   // 自动压缩 session (默认 true)
  toolFilter?: string[];   // 工具白名单
  // ... 更多参数见 Schema
};
```

**响应**: 无直接响应，通过 `agent` Event 流式返回

**Event Payload** (`AgentEvent`):
```typescript
type AgentEvent = {
  sessionId: string;
  kind: "text" | "thinking" | "tool-call" | "tool-result" | "done" | "error";
  
  // kind="text" 时
  text?: string;
  partial?: boolean;  // true = 部分文本 (流式), false = 完整文本
  
  // kind="tool-call" 时
  toolCalls?: Array<{
    id: string;
    name: string;
    params: unknown;
  }>;
  
  // kind="done" 时
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  
  // kind="error" 时
  error?: string;
};
```

**使用流程**:
```
1. Client → Request("agent", { prompt: "Refactor this code", ... })
2. Server → Response({ ok: true, result: { sessionId: "ses_123" } })
3. Server → Event("agent", { kind: "thinking", text: "Analyzing..." })
4. Server → Event("agent", { kind: "tool-call", toolCalls: [{ name: "read", ... }] })
5. Server → Event("agent", { kind: "tool-result", ... })
6. Server → Event("agent", { kind: "text", text: "Here's the refactored code:", partial: false })
7. Server → Event("agent", { kind: "done", usage: {...} })
```

#### 4.2.2 `chat.send` - 发送聊天消息

**用途**: 向 Chat Channel (Slack, Discord, etc.) 发送消息

**参数**:
```typescript
type ChatSendParams = {
  channel: string;       // Channel ID
  text: string;          // 消息内容
  threadTs?: string;     // Thread timestamp (Slack)
};
```

**响应**:
```typescript
type ChatSendResult = {
  messageId: string;     // 发送的消息 ID
  ts?: string;           // Timestamp (Slack)
};
```

#### 4.2.3 `sessions.list` - 列出 Sessions

**参数**:
```typescript
type SessionsListParams = {
  limit?: number;        // 默认 50
  offset?: number;       // 默认 0
  sort?: "lastUsed" | "created";  // 默认 "lastUsed"
};
```

**响应**:
```typescript
type SessionsListResult = {
  sessions: Array<{
    id: string;
    title?: string;
    lastUsed: number;
    messageCount: number;
    tokens: number;
  }>;
  total: number;
};
```

#### 4.2.4 `nodes.invoke` - 调用 Node 能力

**用途**: 远程调用已注册 Node 的能力（如拍照、录音）

**参数**:
```typescript
type NodeInvokeParams = {
  nodeId: string;        // Node ID
  capability: string;    // 能力名称 (e.g., "camera.snap")
  params?: unknown;      // 能力参数
  timeout?: number;      // 超时时间 (ms)
};
```

**响应**:
```typescript
type NodeInvokeResult = {
  result: unknown;       // Node 返回的结果
  durationMs: number;
};
```

**实现细节** (见 `server-methods/nodes.ts`):
1. Gateway 验证 nodeId 存在
2. 通过 WebSocket 向 Node 发送 `node.invoke.request` Event
3. Node 执行能力并返回 `node.invoke.result` Request
4. Gateway 将结果返回给调用者

#### 4.2.5 `config.get` - 获取配置

**参数**:
```typescript
type ConfigGetParams = {
  key?: string;          // 配置键 (省略则返回全部)
};
```

**响应**:
```typescript
type ConfigGetResult = {
  config: OpenClawConfig | unknown;  // 完整配置或指定键的值
};
```

#### 4.2.6 `config.apply` - 动态更新配置

**参数**:
```typescript
type ConfigApplyParams = {
  config: Partial<OpenClawConfig>;  // 要更新的配置字段
  persist?: boolean;                // 是否持久化到磁盘 (默认 false)
};
```

**响应**:
```typescript
type ConfigApplyResult = {
  applied: boolean;
  reloadRequired?: boolean;  // 是否需要重启 Gateway
};
```

---

## 5. 事件推送 (Server-Sent Events)

### 5.1 事件类型表

| 事件名称 | Payload Schema | 触发条件 | 频率 |
|:---|:---|:---|:---|
| **`connect.challenge`** | `{ nonce, ts }` | WebSocket 连接建立时 | 一次性 |
| **`agent`** | `AgentEvent` | Agent 执行过程 | 流式 (多次) |
| **`chat`** | `ChatEvent` | 收到 Chat 消息 | 实时 |
| **`presence`** | `{ presence: PresenceEntry[] }` | Client/Node 连接/断开 | 变化时 |
| **`tick`** | `{ ts }` | 心跳 | 每 30 秒 |
| **`shutdown`** | `{ reason }` | Gateway 即将关闭 | 一次性 |

### 5.2 广播机制

**实现**: `broadcast()` 函数 (`gateway/server.ts`)

```typescript
function broadcast(
  event: string,
  payload: unknown,
  opts?: {
    dropIfSlow?: boolean;       // 丢弃慢速连接的消息 (防止阻塞)
    stateVersion?: {            // 状态版本号 (用于客户端去重)
      presence?: number;
      health?: number;
    };
  }
): void {
  const frame: EventFrame = { type: "event", event, payload };
  const json = JSON.stringify(frame);
  
  for (const client of clients) {
    try {
      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(json);
      }
    } catch (err) {
      if (opts?.dropIfSlow) {
        // 静默丢弃，避免慢速客户端拖累整体
        continue;
      }
      throw err;
    }
  }
}
```

**优化**:
- **dropIfSlow** - 用于 `presence` 事件等高频事件，避免阻塞
- **stateVersion** - 客户端可根据版本号去重，避免重复处理

---

## 6. JSON Schema 验证系统

### 6.1 验证器生成

**库**: [AJV](https://ajv.js.org/) (Another JSON Schema Validator)

**配置** (`protocol/index.ts`, line 194-198):
```typescript
const ajv = new AjvPkg({
  allErrors: true,        // 收集所有错误（不在第一个错误处停止）
  strict: false,          // 宽松模式（允许额外字段）
  removeAdditional: false,  // 不自动删除额外字段
});
```

**编译示例**:
```typescript
export const validateAgentParams = ajv.compile(AgentParamsSchema);
export const validateConnectParams = ajv.compile<ConnectParams>(ConnectParamsSchema);
```

### 6.2 错误格式化

**实现**: `formatValidationErrors()` (`protocol/index.ts`, line 323-357)

```typescript
function formatValidationErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) {
    return "unknown validation error";
  }
  
  const parts: string[] = [];
  
  for (const err of errors) {
    const keyword = err.keyword;  // e.g., "required", "type", "additionalProperties"
    const instancePath = err.instancePath;  // e.g., "/params/sessionId"
    
    // 特殊处理: additionalProperties (额外字段)
    if (keyword === "additionalProperties") {
      const additionalProperty = err.params.additionalProperty;
      const where = instancePath || "at root";
      parts.push(`${where}: unexpected property '${additionalProperty}'`);
      continue;
    }
    
    // 通用错误消息
    const message = err.message || "validation error";
    const where = instancePath ? `at ${instancePath}: ` : "";
    parts.push(`${where}${message}`);
  }
  
  // 去重并拼接
  const unique = Array.from(new Set(parts.filter(part => part.trim())));
  return unique.join("; ") || "unknown validation error";
}
```

**示例输出**:
```
at /params/sessionId: must be string; at /params/limit: must be integer
```

### 6.3 Schema 定义规范

**文件组织** (`protocol/schema/*.ts`):
- `frames.ts` - 顶层帧类型 (Request, Response, Event)
- `agent.ts` - Agent 相关方法/事件的 Schema
- `sessions.ts` - Session 管理方法的 Schema
- `nodes.ts` - Node 相关方法的 Schema
- `config.ts` - 配置管理方法的 Schema
- ... (每个功能模块一个文件)

**Schema 格式** (JSON Schema Draft 7):
```typescript
export const AgentParamsSchema = {
  type: "object",
  properties: {
    prompt: { type: "string" },
    sessionId: { type: "string" },
    model: { type: "string" },
    thinkLevel: {
      type: "string",
      enum: ["off", "minimal", "low", "medium", "high", "xhigh"]
    },
    workspace: { type: "string" },
    files: {
      type: "array",
      items: { type: "string" }
    },
  },
  required: ["prompt"],  // 只有 prompt 是必填
  additionalProperties: false,  // 不允许额外字段
} as const;
```

---

## 7. 关键文件索引

| 文件路径 | 行数 | 功能职责 |
|:---|:---|:---|
| `src/gateway/protocol/index.ts` | 522 | 协议验证器、类型导出、错误格式化 |
| `src/gateway/protocol/schema.ts` | 17 | Schema 文件统一导出 |
| `src/gateway/protocol/schema/*.ts` | 17 个文件 | 各模块的 JSON Schema 定义 |
| `src/gateway/server-ws-runtime.ts` | 50 | WebSocket 服务器入口 |
| `src/gateway/server/ws-connection.ts` | 268 | 连接生命周期管理（握手、关闭、元数据） |
| `src/gateway/server/ws-connection/message-handler.ts` | ~300 | 消息路由与 RPC 方法分发 |
| `src/gateway/server-methods/*.ts` | 20+ 文件 | RPC 方法实现 |
| `src/gateway/auth.ts` | ~200 | 认证逻辑 |
| `src/gateway/server-utils.ts` | ~100 | 错误处理、格式化工具函数 |

---

## 8. 性能优化与最佳实践

### 8.1 连接池管理

**并发连接限制**: 无硬编码限制，依赖操作系统 ulimit

**推荐配置** (生产环境):
```bash
ulimit -n 10000  # 最大文件描述符数
```

### 8.2 消息大小限制

**WebSocket 消息大小**: 无协议层限制，但建议：
- Request/Response: ≤ 10MB
- Event: ≤ 1MB (避免阻塞其他客户端)

**实现**: 可在 `ws-connection/message-handler.ts` 中添加大小检查：
```typescript
if (rawData.length > 10 * 1024 * 1024) {  // 10MB
  send({
    type: "res",
    id: "unknown",
    ok: false,
    error: errorShape("ERR_INVALID_REQUEST", "Message too large (max 10MB)"),
  });
  close();
  return;
}
```

### 8.3 心跳与超时

**心跳事件**: `tick` Event，每 30 秒发送一次

**用途**:
- 检测死连接
- 保持 NAT/Firewall 映射活跃

**实现** (推荐在客户端):
```typescript
let lastTickTime = Date.now();

socket.on("event", (event) => {
  if (event.event === "tick") {
    lastTickTime = Date.now();
  }
});

// 检测超时
setInterval(() => {
  if (Date.now() - lastTickTime > 60000) {  // 60 秒无心跳
    socket.close();
    reconnect();
  }
}, 10000);
```

### 8.4 错误处理最佳实践

**客户端重连策略** (指数退避):
```typescript
let reconnectDelay = 1000;  // 初始 1 秒
const maxDelay = 30000;     // 最大 30 秒

function reconnect() {
  setTimeout(() => {
    const socket = new WebSocket("ws://localhost:18789");
    socket.on("open", () => {
      reconnectDelay = 1000;  // 重置
    });
    socket.on("error", () => {
      reconnectDelay = Math.min(reconnectDelay * 2, maxDelay);
      reconnect();
    });
  }, reconnectDelay);
}
```

---

## 9. 协议扩展性

### 9.1 自定义 RPC 方法

**扩展点**: `extraHandlers` 参数 (`attachGatewayWsHandlers()`)

```typescript
const customHandlers: GatewayRequestHandlers = {
  "my.custom.method": async (params, context) => {
    // 验证参数
    if (!validateMyCustomParams(params)) {
      throw new Error("Invalid params");
    }
    
    // 执行逻辑
    const result = await performCustomLogic(params);
    
    // 返回结果
    return { ok: true, result };
  },
};

attachGatewayWsHandlers({
  ...commonParams,
  extraHandlers: customHandlers,
});
```

### 9.2 自定义 Event

**触发自定义事件**:
```typescript
broadcast("my.custom.event", {
  customField: "value",
  timestamp: Date.now(),
});
```

**客户端接收**:
```typescript
socket.on("message", (data) => {
  const frame = JSON.parse(data);
  if (frame.type === "event" && frame.event === "my.custom.event") {
    console.log("Custom event received:", frame.payload);
  }
});
```

---

## 10. 适用场景 (Use Cases)

**PonyBunny 项目中的协议参考指南**:
- 设计 Autonomy Daemon 与 Gateway 的通信接口
- Work Order System 的任务状态同步
- Quality Gate 结果的实时推送
- Multi-day Context 的 session 管理

---

**版本**: 基于 OpenClaw commit `75093ebe1` (2026-01-30)  
**文档更新**: 2026-01-31  
**总行数**: ~900 行
