# 系统边界与集成点 (System Boundaries)

本文档定义PonyBunny系统的边界、外部依赖和集成接口。

---

## 1. 系统边界

### 1.1 核心系统范围（In Scope）

PonyBunny负责的核心功能：

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
│  │ Manager       │  │ Executor     │  │ Store       │ │
│  └───────────────┘  └──────────────┘  └─────────────┘ │
│         │                  │                  │        │
│  ┌───────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ Node          │  │ Scheduler    │  │ Config      │ │
│  │ Registry      │  │ (Lanes)      │  │ Manager     │ │
│  └───────────────┘  └──────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**职责**：
- ✅ 管理Agent生命周期
- ✅ 调度并发任务
- ✅ 存储和检索Session数据
- ✅ 执行工具调用（通过沙箱）
- ✅ 管理设备（Node）连接和权限
- ✅ 提供WebSocket API给客户端

---

### 1.2 外部系统范围（Out of Scope）

PonyBunny **不负责**以下功能：

❌ **模型训练/微调**
- 不提供Fine-tuning能力
- 不处理训练数据集管理
- 不优化模型参数

❌ **消息平台本身**
- 不是WhatsApp/Telegram的替代品
- 仅适配其开放API

❌ **企业IM系统**
- 不提供自有的聊天UI（仅适配第三方）
- 不管理企业通讯录

❌ **知识库管理**
- 不是专门的文档管理系统
- RAG仅为辅助功能

❌ **AI模型托管**
- 不托管LLM模型
- 不提供GPU推理服务（可对接外部）

---

## 2. 外部依赖

### 2.1 必需依赖（Critical）

| 依赖 | 用途 | 可用性要求 | 降级策略 |
|:-----|:-----|:----------|:--------|
| **LLM Provider API** | Agent推理 | 99%+ | Failover到备用模型 |
| **Docker Runtime** | 沙箱执行 | 99.9%+ | 禁用沙箱模式（仅测试环境） |
| **文件系统** | Session持久化 | 100% | 无（必需） |

**LLM Provider详情**：
- OpenAI API (api.openai.com)
- Anthropic API (api.anthropic.com)
- Google Gemini API (generativelanguage.googleapis.com)
- 本地模型（Ollama、LM Studio）

**API协议**：REST/SSE（OpenAI/Anthropic）、gRPC（Gemini）

**故障影响**：
- LLM API全部不可用 → Agent无法响应（需至少一个可用Provider）
- Docker故障 → 工具调用失败（可配置跳过沙箱，风险较高）

---

### 2.2 可选依赖（Optional）

| 依赖 | 用途 | 无此依赖时的行为 |
|:-----|:-----|:----------------|
| **Embedding API** | Vector Search | 降级到纯关键字搜索（FTS5） |
| **Webhook Provider** | 事件通知 | 不支持外部触发 |
| **监控系统** | 指标收集 | 系统仍正常运行，无可视化 |

---

## 3. 集成接口

### 3.1 入站接口（Inbound）

#### A. WebSocket API（客户端连接）

**端点**：`ws://<host>:18789/`

**协议**：JSON-based RPC（参考`/docs/engineering/protocol.md`）

**客户端类型**：
- Web UI（浏览器）
- CLI工具
- 第三方应用（通过SDK）

**认证**：Token-based（Bearer或WebSocket握手参数）

**示例流**：
```
Client → Gateway: { "type": "req", "method": "connect", "params": { "auth": "token" } }
Gateway → Client: { "type": "res", "ok": true, "result": { "version": "1.0.0" } }
Client → Gateway: { "type": "req", "method": "agent", "params": { "message": "Hello" } }
Gateway → Client: { "type": "event", "event": "agent.delta", "payload": { "text": "Hi" } }
```

---

#### B. HTTP Webhook（外部事件）

**端点**：`POST /webhook/<channel>`

**用途**：接收消息平台的事件通知（WhatsApp、Telegram等）

**安全**：
- 签名验证（HMAC-SHA256）
- IP白名单（可选）

**示例请求**（Telegram）：
```json
POST /webhook/telegram
Content-Type: application/json
X-Telegram-Bot-Api-Secret-Token: <secret>

{
  "update_id": 123456,
  "message": {
    "chat": { "id": 789 },
    "text": "Hello Agent"
  }
}
```

**响应**：
```json
{ "ok": true }
```

---

#### C. Node连接（设备接入）

**端点**：`ws://<host>:18789/node`

**认证**：Ed25519签名验证

**握手流程**：
```
Node → Gateway: { "type": "handshake", "device": { "id": "...", "signature": "..." } }
Gateway → Node: { "type": "pair.requested" }  // 如果未配对
Admin批准 → Gateway: { "method": "node.pair.approve", "nodeId": "..." }
Gateway → Node: { "type": "pair.approved", "token": "..." }
```

---

### 3.2 出站接口（Outbound）

#### A. LLM Provider API

**目标**：各LLM服务商的API端点

**协议**：
- OpenAI：HTTPS + SSE（Server-Sent Events）
- Anthropic：HTTPS + SSE
- Gemini：gRPC

**请求频率**：动态（取决于用户活跃度）

**重试策略**：
- 429错误：指数退避（初始1秒，最多32秒）
- 5xx错误：立即切换Auth Profile或Failover模型

---

#### B. Embedding API

**目标**：同LLM Provider（或独立Embedding服务）

**用途**：生成文本向量用于RAG

**缓存**：本地SQLite（`embedding_cache`表）

**请求优化**：
- 批量请求（一次最多100条）
- 缓存命中率 > 90%后，调用频率大幅下降

---

#### C. 消息平台API

**目标**：WhatsApp、Telegram、Slack等的发送消息API

**示例**（Telegram）：
```
POST https://api.telegram.org/bot<token>/sendMessage
{
  "chat_id": 789,
  "text": "Agent回复内容"
}
```

**错误处理**：
- 401/403：记录到日志，通知管理员Token失效
- 429：遵守Rate Limit，排队重试

---

#### D. Node RPC（工具调用）

**目标**：已配对的物理设备（iPhone、Android、macOS）

**协议**：WebSocket双向RPC

**示例流**：
```
Gateway → Node: { "type": "invoke.request", "id": "req123", "command": "camera.snap" }
Node执行拍照
Node → Gateway: { "type": "invoke.result", "id": "req123", "result": { "imageUrl": "..." } }
```

**超时**：默认10秒，可配置

---

## 4. 数据流图

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
                                            │Session  │ ◀────────────
                                            │Store    │              │
                                            └─────────┘              │
                                                                ┌─────────┐
                                                                │Memory   │
                                                                │DB       │
                                                                └─────────┘
```

**步骤说明**：
1. 用户在WhatsApp发送消息
2. Channel Adapter归一化为`ChatEvent`
3. Gateway根据`sessionKey`路由到对应Session
4. Session触发Agent执行
5. Agent读取历史对话
6. 如需RAG，查询Memory DB
7. Agent调用LLM API推理
8. LLM返回工具调用指令，Agent执行
9. 结果通过Channel返回用户

---

### 4.2 工具调用流程（跨设备）

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

**权限验证**（步骤④）：
- 设备签名 ✅
- Pairing Token ✅
- 命令白名单 ✅

---

## 5. 外部系统集成示例

### 5.1 集成GitHub（Webhook）

**目标**：PR创建时自动触发代码审查

**配置**：
1. 在GitHub仓库设置Webhook：`https://ponybunny.example.com/webhook/github`
2. Secret：`<shared-secret>`
3. 事件：`pull_request.opened`

**PonyBunny配置**：
```json
{
  "webhooks": {
    "github": {
      "secret": "<shared-secret>",
      "route": "agent:code-reviewer:default"
    }
  }
}
```

**流程**：
```
GitHub → PonyBunny Webhook → Agent分析PR → 评论到GitHub
```

---

### 5.2 集成Slack（双向）

**目标**：团队在Slack频道与Agent对话

**架构**：
```
Slack API ↔ PonyBunny Channel Adapter ↔ Gateway ↔ Agent
```

**配置**：
- Slack App安装到Workspace
- Bot Token配置到PonyBunny
- Event Subscriptions: `message.channels`

**双向流**：
- **入站**：Slack用户消息 → Webhook → Agent
- **出站**：Agent回复 → `chat.postMessage` API → Slack频道

---

### 5.3 集成Prometheus（监控）

**目标**：收集系统指标到时序数据库

**导出器**：PonyBunny内置`/metrics`端点（Prometheus格式）

**指标示例**：
```
# HELP ponybunny_agent_runs_total Total number of agent runs
# TYPE ponybunny_agent_runs_total counter
ponybunny_agent_runs_total{status="success"} 1234
ponybunny_agent_runs_total{status="failed"} 56

# HELP ponybunny_llm_api_latency_seconds LLM API response time
# TYPE ponybunny_llm_api_latency_seconds histogram
ponybunny_llm_api_latency_seconds_bucket{le="1.0"} 800
ponybunny_llm_api_latency_seconds_bucket{le="2.0"} 950
```

**Prometheus配置**：
```yaml
scrape_configs:
  - job_name: 'ponybunny'
    static_configs:
      - targets: ['localhost:18789']
```

---

## 6. 边界限制与约束

### 6.1 技术约束

| 约束 | 说明 | 影响 |
|:-----|:-----|:-----|
| **SQLite并发写** | 不支持多进程并发写 | 水平扩展需切换到PostgreSQL |
| **Docker依赖** | 沙箱模式需要Docker | 无Docker环境需禁用沙箱 |
| **WebSocket连接数** | 受Node.js单进程限制 | 极高并发需反向代理 |

---

### 6.2 业务约束

| 约束 | 说明 | 原因 |
|:-----|:-----|:-----|
| **不存储原始API Key** | 仅存储加密后的Key | 安全考虑 |
| **Session文件不跨实例共享** | 默认本地文件系统 | 简化部署，可配置NFS |
| **Node配对需人工批准** | 无自动配对 | 安全第一 |

---

## 7. 接口版本策略

### 7.1 WebSocket API版本

**当前版本**：`v1`

**向后兼容**：
- 新增字段：兼容旧客户端（忽略新字段）
- 修改字段：提前1个大版本标记为`deprecated`
- 删除字段：需要主版本升级（v1 → v2）

**示例**：
```json
{
  "type": "res",
  "apiVersion": "v1",
  "result": { ... }
}
```

---

### 7.2 Plugin API版本

**当前版本**：`plugin-api@1.0.0`

**兼容性检查**：
- 插件声明`minApiVersion`和`maxApiVersion`
- Gateway启动时验证兼容性
- 不兼容的插件拒绝加载

---

## 8. 未来集成扩展点

### 8.1 计划中的集成

- [ ] **Kubernetes Operator**：自动化部署和扩展
- [ ] **S3兼容存储**：Session文件存储到对象存储
- [ ] **OAuth 2.0**：支持企业SSO登录
- [ ] **LDAP/AD集成**：用户目录同步

---

### 8.2 社区请求的集成

- [ ] **Jira/Confluence**：任务管理和知识库
- [ ] **Notion API**：笔记和数据库操作
- [ ] **Google Workspace**：Gmail、Calendar、Drive

---

## 总结

PonyBunny的系统边界明确：
- **核心职责**：Agent管理、调度、存储、工具执行
- **外部依赖**：LLM API（必需）、Docker（可选）、消息平台（可选）
- **集成模式**：WebSocket（客户端）、Webhook（事件）、RPC（设备）

所有外部集成通过标准化接口进行，保持系统的模块化和可扩展性。
