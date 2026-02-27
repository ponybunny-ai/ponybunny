下面是一份“**系统级兜底来忍受低智模型**”导向的完整设计文档：从 **Planner → Plan Compiler/Verifier → Deterministic Runtime Executor → Tools/Skills/MCP/Local/Script** 的架构、流程、数据结构与核心 Schema（含 JSON Schema 片段与约束）。你可以直接拿它去对比 PonyBunny 现有实现，产出改造计划并落地。

---

# PonyBunny vNext 架构设计（系统级兜底，容忍低智模型）

## 设计目标

1. **稳定可预期**：稳定来自 Runtime 的确定性执行与策略约束，而非模型“聪明/稳定”。
2. **可审计可重放**：每一次执行都能 replay（基于事件日志与已执行事实），不依赖模型再次生成相同计划。
3. **低智模型可用**：低智模型只负责产出受限 Plan；任何错误只能导致“生成失败/校验失败/执行失败”，**不能导致越权/隐性副作用/不可审计行为**。
4. **工具体系主导**：可一键禁用模型 native tools，只使用系统可发现/可加载的 Skills、MCP、本地工具、受控脚本（AppleScript 等）。
5. **渐进式升级**：优先最小可用版本（直线 plan + 串行执行 + 事件日志），逐步引入 DAG、条件、循环、人审与脚本沙箱。

---

## 核心原则：确定性来自“编译 + 运行时”

### 你要的不是“deterministic model”

而是 **deterministic runtime**：

* **Plan 是代码**：LLM 写“受限代码”（Plan DSL）
* **Compiler/Verifier**：像编译器一样做静态检查、策略检查、类型检查（schema）
* **Runtime**：像解释器一样按固定规则执行，每步都有幂等键、超时、重试、审计事件

> 低智模型写出来的 plan 可能很烂，但只要 Compiler 和 Runtime 足够硬，它也只能“被拒绝”或“失败”，不会乱跑。

---

# 总体架构

```
User/TUI
  |
  v
Gateway
  |-----------------------------|
  |                             |
  v                             v
Plan Generate (Planner LLM)   Runtime Execute (Deterministic Runtime)
  |                             |
  v                             v
Plan DSL (JSON)            Tool Registry Resolver (Skills/MCP/Local/Script)
  |
  v
Plan Compiler/Verifier
  |
  v
Accepted Plan -> Run
  |
  v
Event Sourcing Log + Replay
```

## 组件职责

### 1) Planner（LLM）

* 输入：用户目标、上下文、工具目录摘要（Tool Catalog）、失败错误码（用于修 plan）
* 输出：**只允许输出 Plan JSON**（严格 schema）
* 不允许：直接 tool call、直接写 shell/AppleScript 并执行

### 2) Plan Compiler/Verifier（确定性组件）

* 静态验证：

  * JSON Schema
  * tool_ref 是否存在
  * 参数 schema 是否匹配
  * 依赖关系 / DAG 是否有效
  * 变量读写声明（reads/writes）是否越权或不一致
  * side_effect 等级是否允许
* 策略验证（Policy）：

  * 白名单工具
  * 参数范围
  * 文件系统范围
  * 网络权限
  * UI automation 是否需要人审
* 输出：`AcceptedPlan` 或 `CompilerErrors[]`（结构化错误）

### 3) Deterministic Runtime Executor

* 固定执行规则：

  * 拓扑排序 + 稳定排序
  * 固定超时、固定重试、固定退避
  * 每步生成/绑定 idempotency_key
* 工具路由：

  * 严格使用 Tool Registry（可禁用模型 native tools）
* 事件日志：

  * step start/stop、tool request/response、artifact、errors
* Replay：

  * 默认重放“已发生事实”（工具请求/响应），必要时重新执行工具但带幂等键

### 4) Tool Registry（系统工具目录）

* 来源：

  * `skills://` 本地 skills
  * `mcp://` MCP server tools
  * `local://` 本地可执行工具/CLI
  * `script://` 受控脚本工具（例如 `osascript.run`）
* 每个 tool 必须提供 manifest（input/output schema、side_effect、permissions、idempotency）

### 5) Script Sandbox（受控脚本）

* 生成与执行分离：

  * `script_generate`：生成脚本 artifact
  * `script_execute`：执行脚本（通常需要人审 + allowlist + 无网络 + 超时）
* 默认高风险：UI automation 必须 `human_confirm`

---

# 执行流程（支持低智模型兜底）

## Flow A：生成并执行（正常路径）

1. **Gateway** 收到任务请求：`POST /v1/tasks`
2. Gateway 调用 **Planner**：`/v1/plans:generate`

   * 附带 Tool Catalog（简化版工具说明，避免模型胡编）
3. Planner 输出 `Plan(JSON)`
4. 进入 **Plan Compiler/Verifier**：

   * `validate_schema()`
   * `resolve_tools()`
   * `validate_args_schema()`
   * `policy_check()`
   * `static_checks()`（依赖、变量、side_effect 等）
5. 通过 -> 创建 `Run`，交给 **Runtime Execute**
6. Runtime：

   * 生成 `run_id`
   * 按固定顺序执行 steps
   * 全程写入 `run_events`
7. 返回结果：run 状态、产物、摘要、可重放入口

---

## Flow B：低智模型失败兜底（Plan Repair Loop）

当 Compiler/Runtime 发现问题，**系统不让它“将错就错执行”**：

* Compiler 阶段失败：直接拒绝执行，返回结构化错误码给 Planner 再写一版 plan
* Runtime 阶段失败：返回最后失败 step 的错误码与上下文，允许 Planner “仅修 plan”，然后重新编译执行（可从上次成功步骤继续）

> 低智模型只要能根据错误码修正 JSON，它就能逐步“被牵引到正确轨道”。

### 关键：错误码必须明确、可操作

例如：

* `ERR_TOOL_NOT_FOUND`
* `ERR_ARGS_SCHEMA_INVALID`
* `ERR_POLICY_DENY_NETWORK`
* `ERR_POLICY_REQUIRE_HUMAN_APPROVAL`
* `ERR_STEP_DEPENDENCY_CYCLE`
* `ERR_ARTIFACT_NOT_FOUND`
* `ERR_TOOL_TIMEOUT`

Planner 提示词必须规定：
**只能输出新的 Plan JSON，不要解释，不要调用工具。**

---

## Flow C：缺工具兜底（Tool Acquire & Script Assist）

当 Planner 想要能力但系统没有对应 tool：

1. Compiler 报 `ERR_TOOL_NOT_FOUND` + 提供建议：

   * 可用替代工具
   * 是否支持 `script_generate`（例如 AppleScript 自动化）
2. Planner 生成一个 Plan：

   * Step1: `script_generate`（生成 AppleScript）
   * Step2: `human_confirm`（让用户确认脚本将要做什么）
   * Step3: `script_execute`（受控执行）
3. Runtime 执行时强制沙箱与人审策略

---

# Tool Routing 开关（禁用模型 native tools）

## Runtime Profile：ToolRoutingPolicy

* `system_only`：完全禁用模型 native tools（推荐）
* `system_preferred`：系统优先，缺失时允许模型 native tools（不推荐用于审计场景）
* `model_preferred`：模型优先（不符合你目标）

并支持分层 fallback 顺序：skills → mcp → local → script

---

# 数据模型（Run / Plan / Event）

## Plan 存储

* `plans(plan_id, session_id, schema_version, planner_model, plan_json, created_at, status)`

## Run 存储

* `runs(run_id, plan_id, session_id, runtime_profile, status, started_at, finished_at, last_error)`

## 事件日志（核心）

* `run_events(run_id, seq, ts, type, payload_json)`

事件类型建议最小集合：

* `PLAN_ACCEPTED`
* `RUN_STARTED`
* `STEP_STARTED`
* `TOOL_REQUESTED`
* `TOOL_RESPONDED`
* `STEP_SUCCEEDED`
* `STEP_FAILED`
* `ARTIFACT_WRITTEN`
* `RUN_SUCCEEDED`
* `RUN_FAILED`
* `HUMAN_CONFIRM_REQUESTED`
* `HUMAN_CONFIRM_RECEIVED`

## Replay

* 默认 replay “TOOL_REQUESTED/RESPONDED 事实”，必要时允许 re-execute，但必须带同一个 `idempotency_key`

---

# Plan DSL 设计（v1）

> v1 先只做：`tool_call` / `transform` / `human_confirm` / `script_generate` / `script_execute`

## Plan JSON 示例（简化）

```json
{
  "schema_version": "plan.v1",
  "plan_id": "uuid",
  "goal": "Export current Pages document to PDF and save to a folder",
  "tool_routing": { "mode": "system_only" },
  "variables": {
    "out_dir": "/Users/nick/Library/Application Support/ponybunny/out"
  },
  "steps": [
    {
      "id": "s1",
      "type": "script_generate",
      "language": "applescript",
      "goal": "Use Pages to export the front document to PDF into ${out_dir}",
      "constraints": { "allowed_apps": ["Pages"], "no_network": true, "time_limit_ms": 5000 },
      "writes": ["artifact:scripts/pages_export.applescript"]
    },
    {
      "id": "s2",
      "type": "human_confirm",
      "message": "About to run AppleScript to control Pages and export a PDF. Proceed?"
    },
    {
      "id": "s3",
      "type": "script_execute",
      "script_ref": "artifact:scripts/pages_export.applescript",
      "depends_on": ["s1", "s2"],
      "capture": { "stdout": true, "stderr": true }
    }
  ]
}
```

---

# JSON Schema（关键片段）

下面给出 **可直接落地** 的 Schema 结构（不是完整文件，但足够你实现与对比）。你可以把这些拆成 `plan.schema.json` / `runtime-profile.schema.json` / `tool.manifest.schema.json`。

## 1) plan.schema.json（核心字段）

```json
{
  "$id": "https://ponybunny.ai/schemas/plan.v1.json",
  "type": "object",
  "required": ["schema_version", "plan_id", "goal", "steps"],
  "properties": {
    "schema_version": { "const": "plan.v1" },
    "plan_id": { "type": "string", "minLength": 8 },
    "goal": { "type": "string", "minLength": 1 },

    "tool_routing": {
      "type": "object",
      "properties": {
        "mode": { "enum": ["system_only", "system_preferred", "model_preferred"] },
        "resolution_order": {
          "type": "array",
          "items": { "enum": ["skills", "mcp", "local_tools", "sandbox_scripts"] }
        }
      },
      "additionalProperties": false
    },

    "variables": { "type": "object", "additionalProperties": true },

    "steps": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/$defs/step" }
    }
  },
  "additionalProperties": false,
  "$defs": {
    "step": {
      "type": "object",
      "required": ["id", "type"],
      "properties": {
        "id": { "type": "string", "pattern": "^[a-zA-Z0-9_\\-]+$" },
        "type": {
          "enum": ["tool_call", "transform", "human_confirm", "script_generate", "script_execute"]
        },
        "depends_on": {
          "type": "array",
          "items": { "type": "string" },
          "uniqueItems": true
        },

        "tool_ref": { "type": "string", "pattern": "^(skills|mcp|local|script)://.+$" },
        "args": { "type": "object" },

        "reads": { "type": "array", "items": { "type": "string" } },
        "writes": { "type": "array", "items": { "type": "string" } },

        "language": { "enum": ["applescript", "bash"] },
        "goal": { "type": "string" },
        "constraints": { "type": "object" },
        "script_ref": { "type": "string" },

        "message": { "type": "string" },

        "capture": {
          "type": "object",
          "properties": {
            "stdout": { "type": "boolean" },
            "stderr": { "type": "boolean" }
          },
          "additionalProperties": false
        }
      },
      "allOf": [
        {
          "if": { "properties": { "type": { "const": "tool_call" } } },
          "then": { "required": ["tool_ref", "args"] }
        },
        {
          "if": { "properties": { "type": { "const": "human_confirm" } } },
          "then": { "required": ["message"] }
        },
        {
          "if": { "properties": { "type": { "const": "script_generate" } } },
          "then": { "required": ["language", "goal"] }
        },
        {
          "if": { "properties": { "type": { "const": "script_execute" } } },
          "then": { "required": ["script_ref"] }
        }
      ],
      "additionalProperties": false
    }
  }
}
```

> 关键点：Plan 里没有任何“模型 native tools”的结构；只允许 `tool_ref` 指向 registry。

---

## 2) tool.manifest.schema.json（工具注册规范）

```json
{
  "$id": "https://ponybunny.ai/schemas/tool-manifest.v1.json",
  "type": "object",
  "required": ["tool_ref", "display_name", "input_schema", "output_schema", "side_effect", "permissions"],
  "properties": {
    "tool_ref": { "type": "string", "pattern": "^(skills|mcp|local|script)://.+$" },
    "display_name": { "type": "string" },
    "description": { "type": "string" },

    "input_schema": { "type": "object" },
    "output_schema": { "type": "object" },

    "side_effect": { "enum": ["none", "idempotent", "non_idempotent", "ui_automation"] },

    "supports_idempotency_key": { "type": "boolean" },

    "permissions": {
      "type": "object",
      "properties": {
        "network": { "enum": ["deny", "allow"] },
        "filesystem": {
          "type": "object",
          "properties": {
            "read": { "type": "array", "items": { "type": "string" } },
            "write": { "type": "array", "items": { "type": "string" } }
          },
          "additionalProperties": false
        },
        "apps": { "type": "array", "items": { "type": "string" } }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

---

## 3) runtime-profile.schema.json（系统级兜底开关集合）

```json
{
  "$id": "https://ponybunny.ai/schemas/runtime-profile.v1.json",
  "type": "object",
  "required": ["profile_id", "tool_routing", "policy"],
  "properties": {
    "profile_id": { "type": "string" },

    "tool_routing": {
      "type": "object",
      "required": ["mode", "resolution_order", "allow_model_native_tools"],
      "properties": {
        "mode": { "enum": ["system_only", "system_preferred", "model_preferred"] },
        "allow_model_native_tools": { "type": "boolean" },
        "resolution_order": {
          "type": "array",
          "items": { "enum": ["skills", "mcp", "local_tools", "sandbox_scripts"] }
        }
      },
      "additionalProperties": false
    },

    "policy": {
      "type": "object",
      "properties": {
        "default_network": { "enum": ["deny", "allow"] },
        "default_filesystem_scope": {
          "type": "object",
          "properties": {
            "read": { "type": "array", "items": { "type": "string" } },
            "write": { "type": "array", "items": { "type": "string" } }
          },
          "additionalProperties": false
        },

        "require_human_approval_for": {
          "type": "array",
          "items": { "type": "string" }
        },

        "script_sandbox": {
          "type": "object",
          "properties": {
            "allowed_languages": { "type": "array", "items": { "enum": ["applescript", "bash"] } },
            "no_network": { "type": "boolean" },
            "allowed_apps": { "type": "array", "items": { "type": "string" } },
            "max_runtime_ms": { "type": "integer", "minimum": 100 },
            "max_output_bytes": { "type": "integer", "minimum": 1024 }
          },
          "additionalProperties": false
        }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

---

# Compiler/Verifier 规则（“低智容忍”的关键）

## 编译阶段检查顺序（固定顺序、确定性）

1. **Schema**：plan JSON 结构合法
2. **Step 基本约束**：

   * step.id 唯一
   * depends_on 引用存在
3. **依赖合法性**：

   * DAG 无环（有环 -> `ERR_STEP_DEPENDENCY_CYCLE`）
4. **Tool Resolve**（对 tool_call/script_execute）：

   * tool_ref 存在于 registry（否则 `ERR_TOOL_NOT_FOUND`）
5. **Args Schema**：

   * args 必须通过对应 tool 的 input_schema（否则 `ERR_ARGS_SCHEMA_INVALID`）
6. **Policy Check**：

   * 网络/文件系统/app/UI automation 等是否允许（否则 `ERR_POLICY_DENY_*`）
7. **Side-effect rules**：

   * `non_idempotent` 或 `ui_automation` 默认必须 `human_confirm` 在前（否则 `ERR_POLICY_REQUIRE_HUMAN_APPROVAL`）
8. **Variable contracts**（可选但强烈建议）：

   * reads 只能读已定义变量或上游 step 输出
   * writes 不能写入禁区变量

通过后输出 `AcceptedPlan`（可加 compiler 注入字段，比如为每个 step 预生成 `idempotency_key_template`）。

---

# Runtime 执行规则（确定性）

## Step 调度顺序

* 先拓扑排序（Kahn）
* 对同层节点按 `step.id` 字典序稳定排序

## 幂等键

每个 step 执行前生成：

`idempotency_key = hash(session_id, run_id, plan_id, step_id, tool_ref, args_hash, tool_version)`

* 工具若支持 idempotency，则传入
* 不支持则 runtime 做本地“已执行缓存”（根据 idempotency_key 复用结果或阻止重复副作用）

## 超时/重试

* timeout 固定来自 tool manifest 或 runtime profile
* retry 固定来自 plan 或 profile
* 退避算法固定（例如 exponential with capped jitter = 0，避免随机）

## 事件日志

每一步至少写：

* STEP_STARTED
* TOOL_REQUESTED (if tool_call/script_execute)
* TOOL_RESPONDED
* STEP_SUCCEEDED / STEP_FAILED

---

# 低智模型的“系统级兜底”效果说明

你要达到的核心性质：

> **模型越笨，失败次数越多，但失败是可控的；成功后执行结果是稳定的。**

实现这个性质的必要条件：

* Plan DSL 足够窄
* 工具足够原子化
* Compiler 的错误码足够可操作
* Runtime 强制 policy + idempotency + audit events
* 高风险（UI automation / 写文件 / 网络）默认人审

---

# API 建议（用于对比现有 PonyBunny）

## 计划生成

* `POST /v1/plans:generate`

  * 入参：goal + context + tool_catalog + runtime_profile_id
  * 出参：plan_json

## 计划编译

* `POST /v1/plans:compile`

  * 入参：plan_json + runtime_profile_id
  * 出参：accepted_plan 或 errors[]

## 执行

* `POST /v1/runs`

  * 入参：accepted_plan
  * 出参：run_id

## 查询

* `GET /v1/runs/{run_id}`
* `GET /v1/runs/{run_id}/events`

## 重放

* `POST /v1/runs/{run_id}:replay`

  * 参数：`mode = facts_only | reexecute_tools`
  * 默认 `facts_only`

---

# 改造对比清单（你用来做 gap 分析）

你对照 PonyBunny 当前架构时，重点看这些：

1. **LLM 是否直接触发工具调用？**

   * 若是：必须改成 “Plan only”
2. **有没有 Plan Compiler/Verifier？**

   * 若没有：这是最大改造点
3. **Tool Registry 是否统一？工具是否有 manifest schema？**
4. **是否支持 runtime_profile（policy/toolRouting）？**
5. **是否有 event sourcing 级别的 run_events？**
6. **是否有幂等键与 replay？**
7. **脚本执行是否受控（生成与执行分离、人审、allowlist、无网络、超时）？**

---

# v1 落地路线（最小可用）

### Phase 0（最小闭环）

* Plan DSL v1（tool_call + human_confirm）
* Tool manifest v1
* Compiler：schema + tool exists + args schema + policy（基础）
* Runtime：串行执行 + events + idempotency（最基础）

### Phase 1（增强稳定性）

* DAG depends_on
* 标准错误码与 plan repair loop
* replay facts_only

### Phase 2（脚本与 UI automation）

* script_generate / script_execute
* `local://osascript.run`
* 沙箱策略 + 人审

