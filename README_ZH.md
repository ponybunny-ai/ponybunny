# PonyBunny

自主 AI 员工 CLI 与运行时系统（面向目标驱动执行）。

PonyBunny 是一个本地优先（local-first）的系统，核心由以下部分组成：
- Gateway（WebSocket 控制平面）
- Scheduler（自主执行引擎）
- CLI/TUI 交互层
- SQLite 持久化（目标、运行记录、产物）

英文版本请见 `README.md`。

## 它能做什么

- 从目标到结果：提交任务，自动执行、验证并输出产物。
- 人在回路：审批/升级是流程内建能力，不是补丁。
- 多模型支持：通过配置实现模型与 provider 路由。
- 可观测性：内置 debug TUI 与 debug Web。

## 当前能力范围（基于仓库真实状态）

- 已实现并可直接使用：
  - `pb` 默认交互 TUI（`src/cli/tui/`）
  - `pb gateway ...`、`pb scheduler ...`、`pb service ...`
  - `pb debug tui|web|start|stop|status|logs`
  - `pb work`、`pb results`、`pb mcp ...`、`pb skills ...`、`pb agent ...`
- 当前限制：
  - `pb webui ...` 目前主要是提示型命令，尚未由 CLI 完整托管（见 `src/cli/commands/webui.ts`）。

## 快速开始

### 1）安装与构建

```bash
git clone https://github.com/ponybunny-ai/ponybunny.git
cd ponybunny
npm install
npm run build:cli
```

可选（全局使用 `pb`）：

```bash
npm link
```

如果不 link，可直接运行：

```bash
node dist/cli/index.js --help
```

### 2）初始化配置

```bash
pb init
pb init --list
```

默认配置目录：
- `~/.config/ponybunny/`

旧目录 `~/.ponybunny/` 在适用时会自动迁移。

### 3）填写凭据与模型配置

编辑：
- `~/.config/ponybunny/credentials.json`
- `~/.config/ponybunny/llm-config.json`
- `~/.config/ponybunny/ponybunny.json`

然后验证：

```bash
pb status
```

### 4）启动服务

```bash
pb service start all
pb service status
```

### 5）进入交互 TUI

```bash
pb
```

默认连接地址：`ws://127.0.0.1:18789`。

## 常见工作流

### 服务生命周期

```bash
pb service start all
pb service stop all
pb service restart all
pb service logs gateway -f
pb service logs scheduler -f
pb service ps
```

### 直接管理 Gateway / Scheduler

```bash
pb gateway start
pb gateway status
pb gateway pair
pb gateway tokens

pb scheduler start
pb scheduler status
pb scheduler logs -f
```

### 自主任务执行

```bash
pb work "Build a feature and include tests"
pb results
pb results --run <run-id>
```

### 调试与可观测性

```bash
pb debug tui
pb debug web
pb debug start
pb debug status
pb debug logs -f
```

### Skills 与 MCP

```bash
pb skills search <query>
pb skills install <publisher/skill>
pb skills list --stats

pb mcp list
pb mcp add <name>
pb mcp test <name>
pb mcp inspector <name>
```

## CLI 顶层命令

基于 `pb --help`：

- `auth`：认证命令
- `config`：配置查看命令
- `models`：模型列表与探测
- `gateway`：Gateway 管理
- `scheduler`：Scheduler Daemon 管理
- `debug`：Debug TUI/Web 与 Debug Server 生命周期管理
- `init`：初始化配置文件
- `install`：安装运行时 bundle 到 `~/.ponybunny`
- `service`：统一服务管理
- `reset`：重置数据库
- `mcp`：MCP 连接管理
- `prompts`：提示词诊断
- `agent`：主代理选择与自定义
- `results`：查看运行结果与产物
- `webui`：Web UI 辅助命令（当前托管有限）
- `work`：提交自主执行任务
- `skills`：技能检索/安装/管理
- `status`：系统与认证状态

## 架构概览

运行时主链路：

```text
CLI/TUI -> Gateway (WebSocket) -> Scheduler -> Execution/LLM/Tools
                                -> SQLite (goals/work items/runs/artifacts)
```

核心目录：

```text
src/
  app/              应用服务层
  autonomy/         自主执行组件
  cli/              Commander CLI + Ink TUI
  debug/            调试 API/服务集成
  domain/           领域核心逻辑
  gateway/          Gateway 服务与认证
  infra/            配置、持久化、LLM、MCP、工具
  ipc/              进程间通信工具
  scheduler/        Scheduler 运行时
  scheduler-daemon/ Daemon 封装与进程管理
  work-order/       工单实体与数据库管理
```

## 开发

### 构建

```bash
npm run build
npm run build:cli
```

### 测试

```bash
npm test
npm run test:cli
npm run test:gateway
npm run test:scheduler
npm run test:coverage
```

### 常用本地校验

```bash
node dist/cli/index.js --help
pb status
pb service status
```

## 文档入口

- 文档总览：`docs/README.md`
- CLI 文档：`docs/cli/CLI-USAGE.md`
- 开发规范：`docs/development/AGENTS.md`
- 技术规格：`docs/techspec/`

## License

MIT
