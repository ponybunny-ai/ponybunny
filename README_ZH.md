# PonyBunny - 自主 AI 员工系统

[English](./README.md) | 简体中文

**生产级自主 AI 员工系统，采用 Gateway + Scheduler 架构。**

像小马一样可靠，像兔子一样敏捷。Local-first、安全优先、按需裁剪 —— 像了解员工一样了解你的 AI。  
一句话：PonyBunny 是一个“AI 员工系统”，你只设定目标，它负责拆解、执行、验证与交付。

## PonyBunny 做什么

- **目标 → 结果**：提交目标，系统自动规划、执行、验证并交付产物。
- **默认自主**，对高风险操作引入人工审批。
- **本地优先**：SQLite 持久化，确保工作记录可追溯。
- **多模型路由**：按任务复杂度分层选模，支持失败回退。

## 设计理念（AI 员工范式）

- **自治优先于协助**：端到端负责，而不是只给建议。
- **透明优先于黑盒**：记录决策，解释升级，不掩盖失败。
- **安全优先于速度**：高风险操作必须审批，并有审计轨迹。
- **升级是功能**：遇阻自动升级，附带上下文与可选方案。

## 实现状态（2026-02-20）

### 已实现模块

✅ **Gateway**：WebSocket JSON‑RPC 服务、认证、路由与 `system.status`  
✅ **Scheduler（8 阶段生命周期）**：澄清 → 拆解 → 验证 → 执行 → 评估 → 重试  
✅ **工单系统**：目标/工作项 DAG、运行记录、产物、升级追踪（SQLite）  
✅ **LLM Provider Manager**：Claude 优先策略，支持 OpenAI/Gemini 与 OpenAI‑兼容端点  
✅ **MCP 集成**：多服务器 MCP 客户端、工具适配、完整 CLI（`pb mcp ...`）  
✅ **服务管理 CLI**：Gateway + Scheduler 的 start/stop/status/logs/ps  
✅ **Debug Server**：Web UI + TUI，系统与连接实时监控  
✅ **Web UI（Next.js）**：`/status` 仪表盘（系统/进程/调度/网络）  
✅ **配置系统**：JSON Schema 校验 + 独立凭据文件

### 计划中 / 设计中

🟨 **Debug server 事件回放与时光回溯**（设计文档：`docs/plans/2026-02-09-debug-server-replay-design.md`）

## 端口与界面

- **Gateway WS**：`ws://localhost:18789`
- **主 Web UI（Next.js）**：`http://localhost:3000`（包含 `/status`）
- **Debug Server UI**：`http://localhost:3001`（通过 `pb debug web` 启动）

## 快速开始

### 安装

```bash
git clone https://github.com/ponybunny-ai/ponybunny.git
cd ponybunny
npm install
npm run build
npm run build:cli
```

### 初始化配置

```bash
# 在 ~/.ponybunny/ 创建配置文件
pb init

# 查看配置文件状态
pb init --list
```

生成文件：
- `~/.ponybunny/credentials.json` - API Key（编辑此文件添加密钥）
- `~/.ponybunny/credentials.schema.json` - JSON Schema 校验
- `~/.ponybunny/llm-config.json` - LLM 端点/模型/分层/代理
- `~/.ponybunny/llm-config.schema.json` - JSON Schema 校验
- `~/.ponybunny/mcp-config.json` - MCP 服务器配置（默认禁用）
- `~/.ponybunny/mcp-config.schema.json` - JSON Schema 校验

### 配置 API Key

编辑 `~/.ponybunny/credentials.json`：

```json
{
  "$schema": "https://ponybunny.dho.ai/schemas/credentials.schema.json",
  "endpoints": {
    "anthropic-direct": {
      "enabled": true,
      "apiKey": "sk-ant-xxx",
      "baseUrl": ""
    },
    "openai-direct": {
      "enabled": true,
      "apiKey": "sk-xxx",
      "baseUrl": ""
    },
    "openai-compatible": {
      "enabled": false,
      "apiKey": "your-api-key",
      "baseUrl": "http://localhost:8000/v1"
    },
    "google-ai-studio": {
      "enabled": true,
      "apiKey": "xxx",
      "baseUrl": ""
    }
  }
}
```

### 验证配置

```bash
pb status
```

### 启动系统

```bash
# 启动所有服务（Gateway + Scheduler）
pb service start all

# 查看服务状态
pb service status

# 查看日志
pb service logs gateway -f
pb service logs scheduler -f

# 停止所有服务
pb service stop all
```

### 可选 UI

```bash
# Debug server UI（可观测性）
pb debug web

# 主 Web UI（Next.js，包含 /status 页面）
cd web
npm install
npm run dev
# 打开 http://localhost:3000/status
```

### 提交任务

```bash
pb work "Build a feature and include tests"
```

或分别启动服务：

```bash
# 启动 Gateway
pb gateway start           # 后台模式（默认）
pb gateway start --daemon  # 自动重启

# 启动 Scheduler
pb scheduler start         # 后台模式（默认）
pb scheduler start --foreground  # 前台模式

# 启动 Debug Server
pb debug web               # Web UI at http://localhost:3001
pb debug tui               # Terminal UI
```

## 架构

PonyBunny 使用 **Gateway + Scheduler** 架构：

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Gateway                                    │
│  WebSocket server handling connections, auth, message routing        │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Scheduler                                   │
│  Task orchestration, model selection, 8-phase lifecycle execution    │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      LLM Provider Manager                            │
│  Multi-provider routing, fallback chains, agent-based model selection│
└─────────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
           Anthropic        OpenAI          Google
           (Claude)         (GPT)          (Gemini)
```

### 项目结构

```
src/
├── gateway/              # WebSocket server, connection management
├── scheduler/            # Task orchestration, model selection
│   └── agent/            # 8-phase lifecycle agents
├── domain/               # Pure business logic
│   ├── work-order/       # Goal, WorkItem, Run, Artifact + state machine
│   ├── conversation/     # Persona + session state rules
│   ├── permission/       # Permission boundaries for OS services
│   ├── escalation/       # Escalation packet types
│   ├── audit/            # Audit trail types
│   └── skill/            # Skill definitions
├── infra/                # Infrastructure adapters
│   ├── config/           # Configuration & onboarding
│   ├── mcp/              # MCP client + tool integration
│   ├── persistence/      # SQLite repository
│   ├── llm/              # LLM providers & routing
│   │   ├── provider-manager/  # JSON config-driven provider management
│   │   ├── protocols/         # Anthropic, OpenAI, Gemini adapters
│   │   └── routing/           # Model routing & fallback
│   └── tools/            # Tool registry & allowlist
├── autonomy/             # ReAct integration & daemon
├── cli/                  # Commander.js CLI with Ink TUI
└── app/                  # Application services
    └── conversation/     # Conversation agent
```

## 配置

### LLM 配置（`~/.ponybunny/llm-config.json`）

用于控制端点、模型和代理：

```json
{
  "$schema": "https://ponybunny.dho.ai/schemas/llm-config.schema.json",

  "endpoints": {
    "anthropic-direct": {
      "enabled": true,
      "protocol": "anthropic",
      "baseUrl": "https://api.anthropic.com/v1/messages",
      "priority": 1
    },
    "openai-direct": {
      "enabled": true,
      "protocol": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "priority": 1
    }
  },

  "models": {
    "claude-opus-4-5": {
      "displayName": "Claude Opus 4.5",
      "endpoints": ["anthropic-direct", "aws-bedrock"],
      "costPer1kTokens": { "input": 0.015, "output": 0.075 },
      "maxContextTokens": 200000,
      "capabilities": ["text", "vision", "function-calling"]
    },
    "claude-sonnet-4-5": {
      "displayName": "Claude Sonnet 4.5",
      "endpoints": ["anthropic-direct", "aws-bedrock"],
      "costPer1kTokens": { "input": 0.003, "output": 0.015 },
      "maxContextTokens": 200000,
      "capabilities": ["text", "vision", "function-calling"]
    },
    "claude-haiku-4-5": {
      "displayName": "Claude Haiku 4.5",
      "endpoints": ["anthropic-direct", "aws-bedrock"],
      "costPer1kTokens": { "input": 0.001, "output": 0.005 },
      "maxContextTokens": 200000,
      "capabilities": ["text", "vision", "function-calling"]
    },
    "gpt-5.2": {
      "displayName": "GPT-5.2",
      "endpoints": ["openai-direct", "azure-openai"],
      "costPer1kTokens": { "input": 0.01, "output": 0.03 },
      "maxContextTokens": 128000,
      "capabilities": ["text", "vision", "function-calling"]
    }
  },

  "tiers": {
    "simple": {
      "primary": "claude-haiku-4-5",
      "fallback": "gpt-5.2"
    },
    "medium": {
      "primary": "claude-sonnet-4-5",
      "fallback": "gpt-5.2"
    },
    "complex": {
      "primary": "claude-opus-4-5",
      "fallback": "gpt-5.2"
    }
  },

  "agents": {
    "input-analysis": { "tier": "simple" },
    "planning": { "tier": "complex" },
    "execution": { "tier": "medium", "primary": "claude-sonnet-4-5" },
    "verification": { "tier": "medium" },
    "response-generation": { "tier": "simple" },
    "conversation": { "tier": "medium" }
  },

  "defaults": {
    "timeout": 120000,
    "maxTokens": 4096,
    "temperature": 0.7
  }
}
```

### 凭据（`~/.ponybunny/credentials.json`）

API Key 独立存放：

```json
{
  "$schema": "https://ponybunny.dho.ai/schemas/credentials.schema.json",
  "endpoints": {
    "anthropic-direct": {
      "enabled": true,
      "apiKey": "sk-ant-xxx"
    },
    "aws-bedrock": {
      "enabled": false,
      "accessKeyId": "",
      "secretAccessKey": "",
      "region": "us-east-1"
    },
    "openai-direct": {
      "enabled": true,
      "apiKey": "sk-xxx"
    },
    "azure-openai": {
      "enabled": false,
      "apiKey": "",
      "endpoint": ""
    },
    "google-ai-studio": {
      "enabled": true,
      "apiKey": "xxx"
    },
    "google-vertex-ai": {
      "enabled": false,
      "projectId": "",
      "region": ""
    }
  }
}
```

### 环境变量

环境变量会覆盖配置文件：

```bash
# Direct API keys (override credentials.json)
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx
GOOGLE_API_KEY=xxx

# AWS Bedrock
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
AWS_REGION=us-east-1

# Azure OpenAI
AZURE_OPENAI_API_KEY=xxx
AZURE_OPENAI_ENDPOINT=https://xxx.openai.azure.com

# Google Vertex AI
GOOGLE_PROJECT_ID=xxx
GOOGLE_LOCATION=us-central1

# Database
PONY_DB_PATH=./pony.db
```

## CLI 命令

### 服务管理

```bash
# 启动/停止所有服务
pb service start all       # 启动 Gateway + Scheduler
pb service stop all        # 停止所有服务
pb service restart all     # 重启所有服务
pb service status          # 查看所有服务状态

# 单独控制服务
pb service start gateway
pb service start scheduler
pb service stop gateway
pb service stop scheduler

# 查看日志
pb service logs gateway    # 最近 50 行
pb service logs gateway -f # 实时追踪
pb service logs scheduler -n 100  # 最近 100 行

# 进程信息
pb service ps              # 进程详情
```

### Gateway 管理

```bash
pb gateway start           # 后台启动（默认）
pb gateway start --daemon  # 自动重启
pb gateway start --foreground  # 前台运行
pb gateway stop            # 优雅停止
pb gateway stop --force    # 强制结束
pb gateway status          # 查看状态
pb gateway logs -f         # 实时日志
pb gateway pair            # 生成配对 token
pb gateway tokens          # 列出 token
pb gateway revoke <id>     # 撤销 token
```

### Scheduler 管理

```bash
pb scheduler start         # 后台启动（默认）
pb scheduler start --foreground  # 前台运行
pb scheduler stop          # 优雅停止
pb scheduler stop --force  # 强制结束
pb scheduler status        # 查看状态与运行时长
pb scheduler logs          # 查看日志
pb scheduler logs -f       # 实时日志
```

### Debug 与可观测性

```bash
pb debug web               # 启动 Web UI (http://localhost:3001)
pb debug web --no-open     # 不打开浏览器
pb debug tui               # 启动终端 UI
```

### 配置与认证

```bash
# 初始化配置
pb init                    # 创建配置文件
pb init --list             # 查看配置文件状态
pb init --force            # 覆盖已有文件
pb init --dry-run          # 预览，不创建

# 认证
pb auth login              # 登录 OpenAI Codex
pb auth list               # 查看已登录账号
pb auth whoami             # 当前账号
pb auth switch <id>        # 切换账号
pb auth remove <id>        # 移除账号
pb auth logout             # 清理凭据
pb auth set-strategy <s>   # 负载策略（stick/round-robin）

# 系统状态
pb status                  # 查看系统与认证状态

# 模型管理
pb models list             # 列出可用模型
pb models refresh          # 刷新模型缓存
pb models clear            # 清除缓存
pb models info             # 查看缓存信息
```

### 任务执行

```bash
# 给自主代理分配任务
pb work "task description"
pb work "task" --db ./custom.db
```

## 8 阶段自主生命周期

PonyBunny 按 8 个阶段执行任务：

1. **Intake** - 验证目标需求与约束
2. **Elaboration** - 发现歧义并请求澄清
3. **Planning** - 拆解工作项（DAG）
4. **Execution** - 自主 ReAct 执行
5. **Verification** - 运行质量门禁（测试/构建/检查）
6. **Evaluation** - 决策发布/重试/升级
7. **Publish** - 打包产物并生成摘要
8. **Monitor** - 跟踪指标与预算

### 实体模型

```
Goal
├── success_criteria[]      # 确定性 + 启发式标准
├── budget_tokens/time/cost # 资源限制
└── WorkItem[]
    ├── verification_plan   # 质量门禁
    ├── dependencies[]      # DAG 依赖
    └── Run[]
        ├── artifacts[]     # 输出产物
        ├── decisions[]     # 决策记录
        └── escalations[]   # 人工升级请求
```

## LLM Provider Manager

Provider Manager 统一接入多模型，采用 **Claude 优先策略**：

### 模型策略

**默认分层模型：**
- **Simple**：`claude-haiku-4-5` → 回退 `gpt-5.2`
- **Medium**：`claude-sonnet-4-5` → 回退 `gpt-5.2`
- **Complex**：`claude-opus-4-5` → 回退 `gpt-5.2`

**支持模型（示例）：**
- **Anthropic**：Claude Opus 4.5 / Sonnet 4.5 / Haiku 4.5
- **OpenAI**：GPT‑5.2、GPT‑4 Turbo、o1、o1‑mini
- **Google**：Gemini 2.5 Pro / 2.5 Flash / 2.0 Flash

### 使用示例

```typescript
import { getLLMProviderManager } from './src/infra/llm/provider-manager/index.js';

const manager = getLLMProviderManager();

// 按代理选择模型
const response = await manager.complete('execution', [
  { role: 'system', content: 'You are a coding assistant' },
  { role: 'user', content: 'Write a function to sort an array' },
]);

// 按层级选择模型
const response = await manager.completeWithTier('medium', messages);

// 指定模型
const response = await manager.completeWithModel('claude-sonnet-4-5', messages);

// 获取代理对应模型
const model = manager.getModelForAgent('planning'); // 'claude-opus-4-5'

// 获取回退链
const chain = manager.getFallbackChain('execution');
// ['claude-sonnet-4-5', 'gpt-5.2']
```

## 开发

### 构建与测试

```bash
# 构建
npm run build              # 编译 TypeScript
npm run build:cli          # 构建 CLI 二进制

# 测试
npm test                   # 运行全部 Jest 测试（779 个）
npm run test:watch         # 监听模式
npm run test:coverage      # 覆盖率

# 运行单个测试文件
npx jest test/path/to/file.test.ts
npm run test:llm-provider-manager  # 测试 LLM Provider Manager

# E2E（使用 tsx，不是 Jest）
npx tsx test/e2e-lifecycle.ts
npx tsx test/provider-manager-test.ts
npx tsx demo/autonomous-demo.ts
```

### 测试状态

✅ **779 个测试通过**，覆盖 40 个测试套件：
- Gateway & Scheduler 集成
- LLM Provider 管理与路由
- 8 阶段生命周期执行
- 配置与凭据管理
- 工具注册与白名单
- 状态机转换
- 预算与升级处理

### 代码约定

**ESM 导入必须带 `.js` 扩展：**
```typescript
import { Goal } from './types.js';           // ✓ 正确
import { Goal } from './types';              // ✗ 错误
```

**命名：**
- 类：`PascalCase`（如 `IntakeService`）
- 接口：`I` 前缀（如 `IWorkOrderRepository`）
- 文件：`kebab-case`（如 `state-machine.ts`）
- 数据库字段：`snake_case`（如 `goal_id`）

**层级规则：**
- `domain/` 不得依赖 `app/`、`infra/` 或 `gateway/`
- 使用 `import type` 引入类型
- 使用命名导出（避免 `export default`）
- 构造器注入依赖

**测试：**
- 测试中 mock 凭据加载，避免读取 `~/.ponybunny/credentials.json`
- 使用 `jest.mock()` mock `credentials-loader`
- 运行单测：`npx jest test/path/to/file.test.ts`

## 成功指标

- **自主完成率**：>70% 工作项无需人工介入
- **连续运行时间**：≥8 小时无人工输入
- **质量门禁通过率**：>80% 一次通过
- **月度 API 成本**：<$10

## 文档

- `CLAUDE.md` - AI 助手说明
- `AGENTS.md` - 开发规范与测试指南
- `docs/cli/` - CLI 文档与指南
  - `CLI-USAGE.md` - 完整 CLI 参考
  - `SCHEDULER-BACKGROUND-MODE.md` - 后台模式实现
  - `BUG-FIX-SERVICE-START-ALL.md` - 启动命令修复
  - `BUG-FIX-DEBUG-SERVER-NOT-FOUND.md` - Debug Server 修复
- `docs/techspec/` - 技术规格
  - `architecture-overview.md` - 系统架构
  - `gateway-design.md` - WebSocket 协议、认证
  - `scheduler-design.md` - 任务编排、模型选择
  - `ai-employee-paradigm.md` - 责任层级与升级哲学

## 关键功能

### 服务管理
- **统一入口**：一条命令管理全部服务
- **后台模式**：PID 跟踪、守护进程管理
- **日志管理**：持久化日志与实时追踪
- **进程控制**：SIGTERM 优雅停止，SIGKILL 强制结束

### Gateway
- **WebSocket Server**：连接管理与消息路由
- **认证系统**：配对 token + 权限控制
- **守护模式**：崩溃自动重启
- **Debug TUI**：连接与事件实时监控

### Scheduler
- **后台执行**：自主运行
- **PID 管理**：`~/.ponybunny/scheduler.pid` 记录进程
- **IPC 通信**：Unix Socket 连接 Gateway
- **日志流**：`pb scheduler logs -f`

### Debug Server
- **Web UI**：Next.js 仪表盘 `http://localhost:3001`
- **终端 UI**：Ink TUI
- **实时事件**：WebSocket 事件流
- **指标监控**：性能指标可视化

## License

MIT
