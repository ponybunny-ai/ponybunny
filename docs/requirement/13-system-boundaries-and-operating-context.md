# 系统边界与运行环境 (System Boundaries and Operating Context)

**文档状态**: Tier 2 - 能力文档  
**目标受众**: 架构师、运维工程师、产品经理  
**最后更新**: 2026-01-31  
**版本**: 2.0

---

## 导读

本文档定义**PonyBunny系统的职责范围、外部依赖、集成接口以及部署环境**。它明确：系统负责什么？不负责什么？如何与外部系统交互？在哪些环境下运行？

阅读本文档后，你应该理解：PonyBunny在整个生态系统中的定位、它依赖哪些外部服务、如何与其他系统集成。

**前置阅读**:
- [00-vision-and-problem.md](./00-vision-and-problem.md) — 系统愿景与目标
- [10-autonomous-execution-model.md](./10-autonomous-execution-model.md) — 执行模型

---

## 核心边界原则

### 定位（Positioning）

**PonyBunny是什么**:
- ✅ 自主执行引擎（Agent Runtime）
- ✅ 工作流调度器（Task Scheduler）
- ✅ 状态持久化管理（Session Manager）
- ✅ 多渠道接入网关（Channel Gateway）

**PonyBunny不是什么**:
- ❌ LLM训练平台（不做模型微调）
- ❌ 消息平台本身（不替代WhatsApp/Telegram）
- ❌ 企业IM系统（不提供自有聊天UI）
- ❌ 知识库管理系统（RAG仅为辅助）

---

## 1. 系统范围划分

### 1.1 核心系统范围（In Scope）

PonyBunny系统内部包含的功能模块：

```
┌─────────────────────────────────────────────────────────┐
│                    PonyBunny System                     │
│                                                         │
│  ┌───────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ Gateway       │  │ Agent        │  │ Memory      │ │
│  │ Server        │  │ Runtime      │  │ Manager     │ │
│  └───────────────┘  └──────────────┘  └─────────────┘ │
│         │                  │                  │        │
│  ┌───────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ Channel       │  │ Tool         │  │ Session     │ │
│  │ Adapter       │  │ Executor     │  │ Store       │ │
│  └───────────────┘  └──────────────┘  └─────────────┘ │
│         │                  │                  │        │
│  ┌───────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ Node          │  │ Scheduler    │  │ Config      │ │
│  │ Registry      │  │ (Lanes)      │  │ Manager     │ │
│  └───────────────┘  └──────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**职责清单**:

| 模块 | 职责 | 关键能力 |
|:-----|:-----|:---------|
| **Gateway Server** | 统一入口 | WebSocket/HTTP API、路由、认证 |
| **Agent Runtime** | 推理执行 | LLM调用、ReAct循环、工具编排 |
| **Memory Manager** | 上下文管理 | RAG检索、向量存储、历史管理 |
| **Channel Adapter** | 消息归一化 | 多平台适配（WhatsApp/Telegram/Slack） |
| **Tool Executor** | 工具调用 | Docker沙箱、Node RPC、权限验证 |
| **Session Store** | 状态持久化 | SQLite存储、Context Pack序列化 |
| **Node Registry** | 设备管理 | 配对审批、签名验证、能力注册 |
| **Scheduler** | 任务调度 | Lane隔离、优先级队列、依赖解析 |
| **Config Manager** | 配置管理 | 多环境、热更新、敏感信息加密 |

### 1.2 外部系统范围（Out of Scope）

PonyBunny **明确不负责**以下功能（由外部系统提供）：

#### ❌ 模型训练/微调
- **不包括**: Fine-tuning能力、训练数据集管理、模型参数优化
- **原因**: 专注于推理侧编排，模型训练由专业平台（如OpenAI Fine-tuning API、Hugging Face）提供

#### ❌ 消息平台本身
- **不包括**: 聊天消息存储、用户关系管理、端到端加密传输
- **原因**: 不重复造轮子，适配现有消息平台（WhatsApp/Telegram等）

#### ❌ 企业IM系统
- **不包括**: 企业通讯录、组织架构管理、企业级聊天UI
- **原因**: 定位为"AI员工后端"，前端由第三方平台承载

#### ❌ 知识库管理
- **不包括**: 文档版本控制、协同编辑、权限管理
- **原因**: RAG仅为辅助功能，文档管理由Notion/Confluence等专业系统负责

#### ❌ AI模型托管
- **不包括**: LLM模型部署、GPU推理服务、模型版本管理
- **原因**: 通过API对接外部模型服务商，不自建推理集群（成本与复杂度考量）

---

## 2. 外部依赖清单

### 2.1 必需依赖（Critical）

系统运行的**必要条件**，缺失任一项将导致核心功能不可用：

| 依赖项 | 用途 | 可用性要求 | 降级策略 |
|:------|:-----|:----------|:---------|
| **LLM Provider API** | Agent推理决策 | 99%+ SLA | Failover到备用Provider |
| **Docker Runtime** | 沙箱安全执行 | 99.9%+ SLA | 禁用沙箱模式（仅测试环境）|
| **文件系统** | Session持久化 | 100% (本地) | 无（必需，无替代方案） |

#### LLM Provider详情

**支持的Provider**:
- **OpenAI** (`api.openai.com`)
  - 模型: GPT-4o, GPT-4 Turbo, GPT-3.5 Turbo
  - 协议: HTTPS + Server-Sent Events (SSE)
- **Anthropic** (`api.anthropic.com`)
  - 模型: Claude 3.5 Sonnet, Claude 3 Opus, Claude 3 Haiku
  - 协议: HTTPS + SSE
- **Google Gemini** (`generativelanguage.googleapis.com`)
  - 模型: Gemini 1.5 Pro, Gemini 1.5 Flash
  - 协议: gRPC
- **本地模型**（Ollama、LM Studio）
  - 模型: Llama 3、Mistral等开源模型
  - 协议: OpenAI-compatible HTTP

**故障影响分析**:
- **所有LLM API不可用**: Agent无法响应，系统进入只读模式
- **单个Provider故障**: 自动切换到备用Provider（需配置多Auth Profile）
- **Docker故障**: 工具调用失败，可配置跳过沙箱（高风险，仅开发环境）

#### Docker Runtime详情

**使用场景**:
- 执行shell命令（`bash`, `python`, `node`等）
- 隔离文件系统操作（防止误删除）
- 限制资源消耗（CPU/内存上限）

**版本要求**:
- Docker Engine 20.10+
- Docker Compose 2.0+（多容器场景）

**配置示例**:
```json
{
  "docker": {
    "enabled": true,
    "image": "ponybunny/sandbox:latest",
    "memory_limit": "512m",
    "cpu_limit": "1.0",
    "network_mode": "none",
    "timeout_seconds": 30
  }
}
```

---

### 2.2 可选依赖（Optional）

**无此依赖时系统仍可运行**，但部分功能受限：

| 依赖项 | 用途 | 无此依赖时的行为 |
|:------|:-----|:----------------|
| **Embedding API** | RAG向量检索 | 降级到纯关键字搜索（SQLite FTS5） |
| **Webhook Provider** | 外部事件触发 | 无法接收GitHub/Jira等平台的通知 |
| **消息平台API** | 多渠道交互 | 仅支持WebSocket直连客户端 |
| **监控系统** | 指标可视化 | 系统正常运行，但无Prometheus/Grafana监控 |
| **对象存储（S3）** | Session归档 | 仅本地文件系统存储（无跨机器共享） |

---

## 3. 集成接口定义

### 3.1 入站接口（Inbound）

**外部系统→PonyBunny**的数据流入点

#### A. WebSocket API（客户端实时连接）

**端点**: `ws://<host>:18789/`

**用途**: Web UI、CLI工具、第三方应用实时交互

**协议**: JSON-RPC 2.0

**认证方式**:
- Bearer Token（HTTP Header: `Authorization: Bearer <token>`）
- 或WebSocket握手参数: `ws://host?token=<token>`

**示例交互流程**:
```
Client → Gateway: 
{
  "jsonrpc": "2.0",
  "method": "agent.chat",
  "params": {
    "message": "实现用户登录功能",
    "session_id": "sess-xxx"
  },
  "id": 1
}

Gateway → Client (streaming):
{
  "jsonrpc": "2.0",
  "method": "agent.delta",
  "params": {
    "type": "text",
    "content": "收到,正在分析..."
  }
}

Gateway → Client (final):
{
  "jsonrpc": "2.0",
  "result": {
    "goal_id": "goal-123",
    "status": "active"
  },
  "id": 1
}
```

**错误处理**:
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32600,
    "message": "Invalid request format",
    "data": { "field": "params.message", "issue": "required" }
  },
  "id": 1
}
```

---

#### B. HTTP Webhook（外部平台事件推送）

**端点**: `POST /webhook/<channel>`

**用途**: 接收消息平台/代码托管平台的事件通知

**支持的Channel**:
- `/webhook/telegram` — Telegram Bot Updates
- `/webhook/whatsapp` — WhatsApp Business API
- `/webhook/github` — GitHub Push/PR Events
- `/webhook/slack` — Slack App Events

**安全验证**:
- **HMAC签名验证**: 
  - Telegram: `X-Telegram-Bot-Api-Secret-Token`
  - GitHub: `X-Hub-Signature-256`
  - Slack: Request timestamp + signature
- **IP白名单**（可选）

**示例请求（GitHub PR创建）**:
```http
POST /webhook/github HTTP/1.1
Host: ponybunny.example.com
Content-Type: application/json
X-Hub-Signature-256: sha256=abc123...
X-GitHub-Event: pull_request

{
  "action": "opened",
  "pull_request": {
    "number": 42,
    "title": "Add user authentication",
    "html_url": "https://github.com/user/repo/pull/42"
  },
  "repository": {
    "full_name": "user/repo"
  }
}
```

**PonyBunny响应**:
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "ok": true,
  "goal_id": "goal-456"
}
```

---

#### C. Node连接（物理设备接入）

**端点**: `ws://<host>:18789/node`

**用途**: iPhone/Android/Mac设备接入，提供本地能力（拍照、定位等）

**认证**: Ed25519签名验证

**握手流程**:
```
1. Node → Gateway: Handshake请求
{
  "type": "handshake",
  "device": {
    "id": "device-xxx",
    "public_key": "ed25519:...",
    "signature": "...",
    "capabilities": ["camera", "location", "file_access"]
  }
}

2. Gateway验证签名 + 检查配对状态

3a. 若未配对 → Gateway → Node:
{
  "type": "pair.requested",
  "message": "等待管理员批准配对请求"
}

3b. 若已配对 → Gateway → Node:
{
  "type": "pair.approved",
  "token": "node-token-xxx",
  "expires_at": "2026-02-28T00:00:00Z"
}

4. Node保存token，后续请求携带此token
```

**安全考量**:
- 配对**必须人工批准**（防止恶意设备接入）
- Token定期轮换（默认30天）
- 能力白名单（仅允许声明的能力被调用）

---

### 3.2 出站接口（Outbound）

**PonyBunny→外部系统**的数据流出点

#### A. LLM Provider API

**目标端点**: 各LLM服务商的推理API

**请求频率**: 动态（取决于用户活跃度）
- 典型：10-100 requests/min
- 峰值：1000+ requests/min（大批量任务）

**重试策略**:
| 错误类型 | 响应策略 |
|:--------|:---------|
| **429 Rate Limit** | 指数退避（初始1秒，最大32秒） |
| **5xx Server Error** | 立即切换Auth Profile或Failover模型 |
| **401 Unauthorized** | 标记Auth Profile失效，通知管理员 |
| **408 Timeout** | 重试2次，失败后escalate |

**成本优化**:
- 智能模型选择（简单任务用Fast模型，复杂任务用Powerful模型）
- Response缓存（相同prompt 24小时内复用）
- Token预算管理（超预算自动停止）

---

#### B. Embedding API

**目标**: LLM Provider或独立Embedding服务（如OpenAI `text-embedding-3-large`）

**用途**: 生成文本向量用于RAG检索

**缓存策略**:
- 本地SQLite缓存（`embedding_cache`表）
- 缓存Key: `sha256(model + text)`
- 缓存命中率目标: >90%

**批量优化**:
- 批量请求（一次最多100条文本）
- 异步处理（不阻塞主流程）

---

#### C. 消息平台API（Outbound）

**目标**: WhatsApp/Telegram/Slack的发送消息API

**示例（Telegram）**:
```http
POST https://api.telegram.org/bot<token>/sendMessage
Content-Type: application/json

{
  "chat_id": 123456789,
  "text": "目标\"实现用户登录\"已完成,请查看PR #42",
  "parse_mode": "Markdown"
}
```

**错误处理**:
| 错误码 | 原因 | 处理方式 |
|:------|:-----|:---------|
| **401/403** | Token失效 | 记录日志 + 通知管理员更新Token |
| **429** | Rate Limit | 遵守Retry-After header，排队重试 |
| **400** | 请求格式错误 | 记录错误详情 + escalate（可能是API变更） |

---

#### D. Node RPC（工具调用）

**目标**: 已配对的物理设备（iPhone/Android/macOS）

**协议**: WebSocket双向RPC

**调用流程**:
```
1. Gateway → Node: 工具调用请求
{
  "type": "invoke.request",
  "id": "req-123",
  "tool": "camera.snap",
  "params": {
    "camera": "front",
    "flash": false
  },
  "timeout": 10000
}

2. Node执行拍照（调用系统API）

3. Node → Gateway: 返回结果
{
  "type": "invoke.result",
  "id": "req-123",
  "success": true,
  "result": {
    "image_url": "data:image/jpeg;base64,...",
    "metadata": {
      "timestamp": "2026-01-31T12:00:00Z",
      "location": { "lat": 37.7749, "lon": -122.4194 }
    }
  }
}
```

**超时配置**:
- 默认超时: 10秒
- 长时任务（如视频录制）: 60秒
- 超时后Gateway标记任务失败并escalate

---

## 4. 数据流图示

### 4.1 典型对话流程

```
┌────────┐   ①消息    ┌─────────┐   ②归一化   ┌─────────┐
│WhatsApp│ ────────▶ │Channel  │ ────────▶  │Gateway  │
│        │           │Adapter  │            │Server   │
└────────┘           └─────────┘            └─────────┘
                                                  │
                                            ③路由到Session
                                                  ▼
                                            ┌─────────┐
                                            │Session  │
                                            │Manager  │
                                            └─────────┘
                                                  │
                                            ④触发Agent
                                                  ▼
┌────────┐   ⑨响应    ┌─────────┐   ⑧工具调用  ┌─────────┐   ⑦推理    ┌────────┐
│用户    │ ◀──────── │Channel  │ ◀──────────  │Agent    │ ────────▶ │LLM API │
│        │           │Adapter  │              │Runtime  │           │        │
└────────┘           └─────────┘              └─────────┘           └────────┘
                                                  │ ⑤读历史
                                                  ▼
                                            ┌─────────┐   ⑥Vector检索
                                            │Session  │ ◀────────────┐
                                            │Store    │              │
                                            └─────────┘              │
                                                                ┌─────────┐
                                                                │Memory   │
                                                                │DB       │
                                                                └─────────┘
```

**步骤说明**:
1. 用户在WhatsApp发送消息
2. Channel Adapter归一化为`ChatEvent`（统一格式）
3. Gateway根据`sessionKey`路由到对应Session
4. Session触发Agent执行（创建或恢复Run）
5. Agent读取历史对话（包括Work Order状态）
6. 如需RAG，查询Memory DB（向量检索）
7. Agent调用LLM API推理（获取下一步行动）
8. LLM返回工具调用指令，Agent执行工具
9. 结果通过Channel Adapter返回用户

---

### 4.2 跨设备工具调用流程

```
┌────────┐          ┌─────────┐          ┌─────────┐          ┌────────┐
│Agent   │  ①调用   │Gateway  │  ②RPC    │Node     │  ③执行   │iOS     │
│Runtime │ ───────▶ │Server   │ ───────▶ │(iPhone) │ ───────▶ │Camera  │
└────────┘          └─────────┘          └─────────┘          └────────┘
    ▲                    │                     │                    │
    │                    │ ④验证权限             │                    │
    │                    ├─────────────────────┘                    │
    │                    │ ⑤转发请求                                  │
    │                    ├─────────────────────────────────────────┘
    │                    │ ⑥返回结果
    └────────────────────┘
```

**权限验证**（步骤④）:
- ✅ 设备签名验证（Ed25519）
- ✅ Pairing Token有效性
- ✅ 命令白名单（设备声明的capabilities）
- ✅ 预算检查（调用次数/成本限制）

---

## 5. 运行环境（Operating Context）

### 5.1 部署拓扑

#### 拓扑A: 单机部署（Local Development）

**适用场景**: 个人开发者、单用户使用

```
┌──────────────────────────────────┐
│       MacBook Pro / Linux        │
│                                  │
│  ┌─────────────────────────────┐ │
│  │  PonyBunny Gateway          │ │
│  │  (Node.js Process)          │ │
│  └─────────────────────────────┘ │
│                                  │
│  ┌─────────────────────────────┐ │
│  │  SQLite Database            │ │
│  │  (/var/ponybunny/data.db)   │ │
│  └─────────────────────────────┘ │
│                                  │
│  ┌─────────────────────────────┐ │
│  │  Docker Engine              │ │
│  │  (Sandbox Containers)       │ │
│  └─────────────────────────────┘ │
└──────────────────────────────────┘
```

**资源需求**:
- CPU: 2核+
- RAM: 4GB+
- 磁盘: 10GB+（Session存储）

---

#### 拓扑B: 云部署（Cloud Production）

**适用场景**: 小团队、多用户共享

```
┌───────────────────────────────────────────┐
│           AWS / GCP / Azure              │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  Container Orchestration           │  │
│  │  (Docker Compose / Kubernetes)     │  │
│  │                                    │  │
│  │  ┌──────────┐  ┌──────────┐       │  │
│  │  │ Gateway  │  │ Gateway  │       │  │
│  │  │ Pod 1    │  │ Pod 2    │       │  │
│  │  └──────────┘  └──────────┘       │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  PostgreSQL (替代SQLite)           │  │
│  │  (多实例并发写)                      │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  S3 / GCS (Session文件存储)        │  │
│  └────────────────────────────────────┘  │
└───────────────────────────────────────────┘
```

**资源需求**:
- Container: 每实例2核4GB
- Database: RDS PostgreSQL（db.t3.medium）
- Storage: S3 Standard（按量计费）

---

#### 拓扑C: 混合部署（Hybrid）

**适用场景**: Gateway在云端，Node在本地（隐私需求）

```
┌─────────────────┐             ┌──────────────────┐
│   Cloud VPS     │             │  Local Network   │
│                 │             │                  │
│  ┌───────────┐  │   Secure    │  ┌────────────┐  │
│  │ Gateway   │  │   Tunnel    │  │ Node       │  │
│  │ Server    │◀─┼─────────────┼─▶│ (iPhone)   │  │
│  └───────────┘  │  (WebSocket)│  └────────────┘  │
│                 │             │                  │
│  ┌───────────┐  │             │  ┌────────────┐  │
│  │ Database  │  │             │  │ Node       │  │
│  │ (PG)      │  │             │  │ (MacBook)  │  │
│  └───────────┘  │             │  └────────────┘  │
└─────────────────┘             └──────────────────┘
```

**优势**:
- 敏感数据（照片、文件）不上云
- Gateway提供统一调度和状态管理
- 跨设备协作（云端协调本地Node）

---

### 5.2 环境配置

**开发环境（Development）**:
```json
{
  "environment": "development",
  "log_level": "debug",
  "docker": {
    "enabled": false,
    "reason": "本地直接执行工具（无沙箱）"
  },
  "llm": {
    "provider": "openai",
    "model": "gpt-3.5-turbo",
    "reason": "节省成本"
  },
  "database": {
    "type": "sqlite",
    "path": "./dev.db"
  }
}
```

**生产环境（Production）**:
```json
{
  "environment": "production",
  "log_level": "info",
  "docker": {
    "enabled": true,
    "network_mode": "none",
    "reason": "强制沙箱隔离"
  },
  "llm": {
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-20241022",
    "fallback": {
      "provider": "openai",
      "model": "gpt-4o"
    }
  },
  "database": {
    "type": "postgresql",
    "connection_string": "postgresql://user:pass@db.example.com/ponybunny"
  },
  "session_storage": {
    "type": "s3",
    "bucket": "ponybunny-sessions",
    "region": "us-west-2"
  }
}
```

---

## 6. 安全边界

### 6.1 网络边界

**外部网络 ↔ PonyBunny**:
- HTTPS/WSS加密传输（TLS 1.3）
- 证书验证（生产环境）
- Rate Limiting（防DDoS）

**PonyBunny ↔ LLM API**:
- API Key加密存储（AES-256）
- TLS Mutual Auth（企业部署）
- 流量审计（记录所有LLM请求）

---

### 6.2 进程边界

**Gateway进程 ↔ Docker容器**:
- Docker Socket隔离（仅Gateway进程可访问）
- 容器Network Mode: `none`（禁止联网）
- 文件系统只读挂载（除工作目录外）

**用户权限隔离**:
- Gateway运行在非root用户
- Docker容器使用UID mapping（防提权）

---

### 6.3 认证边界

**Gateway ↔ Client**:
- Token-based认证（JWT）
- Token轮换（7天刷新）
- 多设备登录管理

**Gateway ↔ Node**:
- Ed25519公钥签名（非对称加密）
- 配对审批（人工批准设备接入）
- 能力白名单（限制Node可调用的工具）

---

### 6.4 数据边界

**本地文件系统 ↔ 外部API**:
- **禁止**: 直接上传Session文件到LLM API
- **允许**: 上传用户明确指定的文件（需审批）
- **审计**: 所有文件操作记录到`audit_log`

**PII处理**:
- 敏感信息脱敏（日志中隐藏API Key/Token）
- Session文件加密存储（可选，企业部署）
- GDPR合规（支持数据导出/删除）

---

## 7. 技术约束

### 7.1 架构约束

| 约束 | 说明 | 影响 |
|:-----|:-----|:-----|
| **SQLite并发写限制** | 单进程写入 | 水平扩展需切换PostgreSQL |
| **Docker依赖** | 沙箱模式需Docker Runtime | 无Docker环境需禁用沙箱 |
| **WebSocket连接数** | Node.js单进程限制 | 极高并发需Nginx反向代理 |
| **文件系统存储** | Session默认本地文件 | 分布式部署需S3/NFS |

---

### 7.2 性能约束

| 指标 | 限制 | 优化方向 |
|:-----|:-----|:--------|
| **并发Agent数** | 100个/实例 | 增加实例数或优化调度算法 |
| **Session存储大小** | 单Session最大100MB | 自动归档到冷存储 |
| **LLM API延迟** | P99 \< 5秒 | 智能模型选择+缓存 |
| **工具调用超时** | 默认30秒 | 长时任务需配置专用timeout |

---

## 8. 集成扩展点

### 8.1 已实现的集成

- ✅ **OpenAI/Anthropic/Gemini** — LLM推理
- ✅ **Telegram/WhatsApp** — 消息平台
- ✅ **Docker** — 沙箱执行
- ✅ **SQLite/PostgreSQL** — 持久化存储

### 8.2 计划中的集成（Roadmap）

- [ ] **GitHub/GitLab** — 代码审查、Issue管理（Webhook触发）
- [ ] **Slack/Teams** — 企业IM集成
- [ ] **Notion/Confluence** — 知识库RAG
- [ ] **Kubernetes Operator** — 云原生部署
- [ ] **OAuth 2.0/LDAP** — 企业SSO登录

### 8.3 社区请求的集成

- [ ] **Jira** — 任务管理
- [ ] **Google Workspace** — Gmail、Calendar、Drive
- [ ] **AWS Lambda** — Serverless工具执行
- [ ] **Zapier/Make** — 低代码集成

---

## 9. 版本与兼容性

### 9.1 API版本策略

**WebSocket API版本**: 当前`v1`

**向后兼容规则**:
- 新增字段: ✅ 兼容（旧客户端忽略新字段）
- 修改字段: ⚠️ 提前1个大版本标记`deprecated`
- 删除字段: ❌ 需要主版本升级（v1 → v2）

**版本协商**:
```json
Client → Gateway:
{
  "type": "handshake",
  "api_version": "v1"
}

Gateway → Client:
{
  "type": "handshake.ack",
  "api_version": "v1",
  "server_version": "1.2.0"
}
```

---

### 9.2 插件API版本

**当前版本**: `plugin-api@1.0.0`

**兼容性检查**:
- 插件声明`minApiVersion`和`maxApiVersion`
- Gateway启动时验证兼容性
- 不兼容的插件拒绝加载并记录警告

**示例插件清单**:
```json
{
  "name": "slack-channel-adapter",
  "version": "2.1.0",
  "plugin_api": {
    "min": "1.0.0",
    "max": "1.9.x"
  }
}
```

---

## 文档导航

**前置阅读**:
- [00-vision-and-problem.md](./00-vision-and-problem.md) — 系统愿景
- [01-ai-employee-paradigm.md](./01-ai-employee-paradigm.md) — 责任模型

**相关Tier 2文档**:
- [10-autonomous-execution-model.md](./10-autonomous-execution-model.md) — 执行模型
- [11-work-order-system.md](./11-work-order-system.md) — 工作单系统
- [12-human-interaction-contracts.md](./12-human-interaction-contracts.md) — 人类交互

**下一步阅读**:
- [20-capability-requirements.md](./20-capability-requirements.md) — 能力需求（Phase 3）

**实现参考**:
- `/docs/engineering/protocol.md` — WebSocket协议规范
- `/docs/engineering/deployment.md` — 部署指南

---

**版本历史**:
- v2.0 (2026-01-31): 从system-boundaries.md重构，明确系统边界、依赖、集成接口、运行环境
- v1.0 (2026-01-15): 初始版本（system-boundaries.md）
