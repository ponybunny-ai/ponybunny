# PonyBunny Harness Gap Analysis
**Agent Harness Engineering — 差距分析与升级路线图**

> **文档版本**: v2.0 · 2026-03-28
> **基准文档**: `docs/reverse-engineering/20260328/` 九章逆向工程文档集 + `CLAUDE.md`（当前生效版本）
> **分析框架**: Mitchell Hashimoto / OpenAI Codex / Anthropic Claude Agent SDK 最佳实践
> **适用读者**: PonyBunny 核心开发者、DarkhorseOne 产品规划
>
> **v2.0 修订说明**: 基于最新 `CLAUDE.md` 更新。AGENTS.md 已删除（原为 Codex 时期产物），以 CLAUDE.md 替代；Evaluator 子 Agent、Skills、七类子 Agent 角色均已建立完毕。相关差距评分和建议已全面修订。

---

## 概述

PonyBunny 当前状态的最准确描述是：

> **架构正确、核心机制扎实、Harness 宪法已成型、唯一飞轮尚未闭合。**

`CLAUDE.md` 本身已是一份高质量的 Harness 开发宪法——包含 10 条核心原则、强制状态词汇表、会话结束结构化要求、Evidence Standards、以及七类子 Agent 角色的职责分工。这代表 PonyBunny 不仅在构建一个 Harness 产品，它的开发过程本身也在被 Harness 化。

唯一仍然未闭合的飞轮是：**单次 Goal 内积累的失败知识，不能自动传播到未来的 Goal**。这是本文档重点分析的核心缺口。

**总体成熟度评分**（基于完整文档集 + 最新 CLAUDE.md）：

| 维度 | 当前成熟度 | 目标 | 缺口等级 |
|------|-----------|------|---------|
| 规范文件 | 88/100 | 95/100 | 低 |
| 上下文管理 | 72/100 | 90/100 | 中 |
| 验证回路 | 78/100 | 88/100 | 低-中 |
| **失败学习** | **52/100** | **90/100** | **高（唯一关键缺口）** |
| 护栏系统 | 82/100 | 88/100 | 低 |
| 可观测性 | 72/100 | 85/100 | 中 |

---

## 维度一：规范文件（Specification Files）

### 1.1 当前实际情况

**CLAUDE.md（强，已成为 Harness 宪法）**

当前 `CLAUDE.md` 已超越"开发规范文件"的定位，成为一份完整的 Harness 工程宪法：

- **Mission 声明**：明确 PonyBunny 是"harness-first agent system"，开发偏向 explicit contracts / observable execution / evaluable changes / structured session handoff
- **10 条核心原则**：特别是 Principle 7（Generator does not self-certify correctness）和 Principle 9（Failed runs, traces, and evals are inputs for harness improvement）——这两条是 Harness Engineering 的核心思想，已制度化
- **强制工作模型**（Required Working Model）：非简单任务必须按 Understand → Clarify → Plan → Implement → Evaluate → Record → Handoff 顺序执行，Plan-before-code 已内建
- **七类子 Agent 角色分工**（均已建立完毕）：
  - `harness-architect`：架构边界、Harness 迁移策略
  - `planner`：阶段规划、里程碑分解
  - `generator`：批准范围内的实现
  - `evaluator`：验证、接受度审查、回归分析
  - `debugger`：运行时失败分析与根因工作
  - `harness-optimizer`：基于证据的 Harness 级改进
  - `docs-writer`：ADR、技术文档、交接文档
- **强制状态词汇表**（proposed / planned / implemented / verified / documented / blocked）：消除"implemented vs verified"的模糊，这是 Harness 可信度的基础
- **Evidence Standards**：明确区分可接受证据（测试、trace、日志审查）和不可接受证据（"it should work"、"the code looks right"）
- **会话结束结构化要求**（Session End Requirements）：每次有意义的工作会话必须输出包含 7 个字段的交接文档

**逆向工程文档集（亮点）**

`docs/reverse-engineering/20260328/` 包含 9 章完整技术规格（覆盖 100+ 源文件），是典型的"将知识推入仓库"实践——让 Agent 在任意 cold start 时能独立理解系统全貌。

### 1.2 Harness 目标标准

规范文件应实现以下功能：
- Agent cold start 时能独立获取足够上下文（✅ 通过 CLAUDE.md + 逆向工程文档集）
- 明确禁止操作和高风险路径（✅ Non-Negotiable Behaviour Rules）
- 计划先于代码的强制要求（✅ Required Working Model）
- Generator/Evaluator 角色分离（✅ 子 Agent 角色分工）
- 会话知识持续积累（⚠️ 部分，见差距描述）

### 1.3 差距描述

**差距 1.A：CLAUDE.md 尚无历史失败防范积累**

`CLAUDE.md` 是近期更新的文档，当前内容是结构性原则，而非历史失败的结晶。Hashimoto 模式要求规范文件随时间积累——每次 Agent 在此仓库犯错并被修复，应在文档中留下对应的防范规则。

目前文档中没有类似"曾在 domain 层引入 infra 依赖导致循环引用，已修复，禁止重复"的条目。这不是架构缺陷，而是时间和使用积累的问题。

**差距 1.B：子 Agent 的 skills 内容与 CLAUDE.md 的对齐程度不明确**

CLAUDE.md 定义了七类子 Agent 的职责边界，但各 skill 文件的具体实现是否与宪法原则保持一致（特别是 Evidence Standards 和 Status Vocabulary 的执行），需要定期通过 Entropy Agent 检验（见维度四）。

### 1.4 建议方案

**随时间积累的历史规则节**（低优先级，自然演化）：

在 `CLAUDE.md` 末尾预留一个节：
```markdown
## Known Failure Patterns (Accumulated)

<!-- 每次 Agent 犯错被修复后，在此追加一条。格式：
- [日期] 问题描述 → 防范措施 → 相关 PR
-->
```

这个节最初为空，通过真实失败逐渐充实。配合维度四的失败学习管道（`pb learn`），可以半自动填充。

**子 Agent skills 定期一致性检查**（通过 Entropy Agent，见维度四）。

### 1.5 参考资料

- Mitchell Hashimoto《My AI Adoption Journey》(2026-02-05) — `mitchellh.com/writing/my-ai-adoption-journey`（"Engineer the Harness"命名及历史积累原则）
- Pollinations AGENTS.md — `github.com/pollinations/pollinations/blob/main/AGENTS.md`（含历史失败条目的参考格式）
- Anthropic《Effective Harnesses for Long-Running Agents》— 初始化 Agent 模式与文档即上下文

---

## 维度二：上下文管理（Context Management）

### 2.1 当前实际情况

**ContextPack（强）**

```typescript
// 三种跨会话快照类型
ContextPack.pack_type: 'daily_checkpoint' | 'error_recovery' | 'handoff'

// 知识库字段（per-goal 维度）
ContextSnapshot.knowledge_base = {
  learned_patterns: string[],
  pitfalls_discovered: string[],
  successful_approaches: string[]
}

// 下一会话行动建议
ContextSnapshot.next_actions = {
  recommended_work_items: string[],
  risk_factors: string[],
  required_human_input?: string[]
}
```

**向量记忆（强）**

- `memory_entries`：FTS5 全文检索 + cosine similarity 向量搜索
- `core_memories`：importance scoring + 摘要
- `embedding_cache`：LRU 淘汰策略
- Session archive/resume：`active → archived → active`

**CLAUDE.md Session Handoff（强）**

`CLAUDE.md` 已通过制度化的 Session End Requirements 解决跨会话连续性：会话结束必须输出包含"What changed / Current status / What was verified / What remains unverified / Known risks / Next safest step / Files to read first"的交接文档。这是 Anthropic 推荐的 Initializer Agent 模式在开发工作流层面的实现。

### 2.2 Harness 目标标准

- Goal 内跨会话状态完整传递（✅ ContextPack 已实现）
- 开发会话的结构化交接（✅ CLAUDE.md Session End Requirements）
- 跨 Goal 知识传播（❌ 核心缺口，见维度四）
- Context compaction 防止 token 窗口耗尽（⚠️ 需确认实现细节）

### 2.3 差距描述

**差距 2.A：ContextPack 是 per-goal 孤岛（共享于维度四）**

这是跨维度的根本缺口，在维度四详细展开。简述：Goal A 的 `pitfalls_discovered` 对 Goal B 不可见，系统无法从历史任务中学习。

**差距 2.B：ContextPack 生成时机的自动化**

文档未明确说明 `daily_checkpoint` 由什么机制自动触发。如果依赖人工调用，长任务的状态持久化可靠性低于设计意图。

**差距 2.C：Context Compaction 的明确边界**

ReAct 循环 max iterations = 20，但没有当接近 token 上限时自动执行状态压缩/归档的文档描述。Anthropic Claude Agent SDK 的 Compaction 机制专门解决这个问题。

### 2.4 建议方案

**自动触发 ContextPack**：
- Goal 每次进入 `blocked` 或 `completed` 状态时，调度器自动创建 `daily_checkpoint`
- Cron 每日对所有 `active` goal 触发快照

**跨 Goal 知识传播**（见维度四完整方案）。

**明确 Compaction 阈值**：
在 `SchedulerConfig` 中增加 `contextWindowWarningThreshold`（默认 80%），触发 ContextPack snapshot 并压缩历史消息。

### 2.5 参考资料

- Anthropic Claude Agent SDK Compaction 文档 — `docs.anthropic.com`
- Anthropic《Effective Harnesses for Long-Running Agents》— ContextPack 与 Initializer Agent 设计
- OpenAI 百万行代码实验报告 — `openai.com/index/harness-engineering/`（跨会话状态桥接实践）

---

## 维度三：验证回路（Verification Loops）

### 3.1 当前实际情况

**Quality Gates（强）**

```typescript
// 双模式验证
QualityGate.type: 'deterministic' | 'llm_review'

// deterministic: shell 命令 + exit code，60s 超时
QualityGate.command = "npm test"
QualityGate.expected_exit_code = 0

// llm_review: LLM 语义审查，120s 超时
QualityGate.review_prompt = "..."
QualityGate.required: boolean   // 必须通过 vs 可选
```

每个 WorkItem 携带 `verification_plan`（quality_gates + acceptance_criteria），状态机有明确的 `verify` 状态，Evaluation 阶段决策 publish / retry / replan / escalate。

**Evaluator 子 Agent（已存在，消除最大缺口）**

`CLAUDE.md` 明确定义 `evaluator` 子 Agent 负责"validation, checks, acceptance review, regression analysis"，且与 `generator` 角色严格分离。Principle 7："Generator does not self-certify correctness"已制度化。

这直接关闭了初版报告中"无独立 Evaluator Agent"的差距——PonyBunny 在开发工作流层面已实现 Generator/Evaluator 分离。

**Evidence Standards（强）**

CLAUDE.md 明确区分可接受与不可接受的验证证据，彻底禁止"it should work"类的自我认证。

### 3.2 Harness 目标标准

- Deterministic + LLM 双模式质量门（✅ 已实现）
- Generator/Evaluator 角色分离（✅ 子 Agent 已建立）
- Plan-before-code（✅ Required Working Model）
- UI/端对端产物的浏览器验证（❌ 缺口）
- verification_plan 自动生成（⚠️ 机制不明确）

### 3.3 差距描述

**差距 3.A：无浏览器自动化验证**

当 WorkItem 产物是 Web UI 功能时，`deterministic` gates 只能通过命令行验证代码逻辑，无法验证用户实际可见的行为。Anthropic 实践表明，Puppeteer/Playwright 集成后 Agent 能自行发现并修复大量命令行无法检测的 UI bug。

**差距 3.B：verification_plan 的填充来源不明确**

`WorkItem.verification_plan` 字段存在，但无文档说明它在 Planning 阶段由什么机制生成。如果完全由 `generator` 自行填写验证计划，则存在"验证者由被验证者指定"的问题，削弱独立性。

**差距 3.C：evaluator 子 Agent 与运行时 Quality Gate Runner 的集成**

`evaluator` 角色目前是开发工作流层面的子 Agent（在 coding sessions 中使用），而运行时的 `QualityGateRunner`（`src/scheduler/quality-gate-runner/`）是独立的调度器组件。两者的职责边界和协作方式需要明确——`evaluator` 是否参与运行时的 `llm_review` 类型门？

### 3.4 建议方案

**Playwright MCP 集成（中优先级）**：

```json
// mcp-config.json 新增
{
  "mcpServers": {
    "playwright": {
      "enabled": true,
      "transport": "stdio",
      "command": "npx",
      "args": ["@playwright/mcp@latest"],
      "allowedTools": [
        "browser_navigate", "browser_screenshot",
        "browser_click", "browser_type", "browser_evaluate"
      ]
    }
  }
}
```

在工具责任模型中，`playwright` 工具放入 Layer 2（Approval Required），允许 Verification 阶段使用。

**verification_plan 生成责任归属**：

由 `planner` 子 Agent 负责生成 WorkItem 的 `verification_plan`（不由 `generator` 生成），明确记录在 CLAUDE.md 的 Preferred Delegation 节中：
```markdown
# 在 Preferred Delegation 下追加：
- verification plan generation for work items -> planner
```

**evaluator 角色与 llm_review 门的连接**：

将运行时 `QualityGate.type = 'llm_review'` 的执行逻辑，路由到与 `evaluator` 子 Agent 相同的 system prompt 和模型配置，确保运行时评估与开发工作流评估使用一致的质量标准。

### 3.5 参考资料

- Playwright MCP Server — `github.com/microsoft/playwright-mcp`
- Anthropic《Effective Harnesses for Long-Running Agents》— Puppeteer 验证截图案例
- Anthropic GAN-inspired Evaluator 研究

---

## 维度四：失败学习（Failure Learning）

> ⚠️ **这是当前唯一低于 60 分的维度，也是 PonyBunny 与完整 Harness 飞轮之间最后一道关键差距。**

### 4.1 当前实际情况

**错误签名系统（强）**

```typescript
// 归一化哈希（文件路径→<PATH>，数字→<NUM>，十六进制→<HEX>）
Run.error_signature: string

// 高频错误检测
getRepeatedErrorSignatures()  // 触发 'repeated_same_error' stuck 检测
```

**per-goal 错误学习（中）**

```typescript
ContextSnapshot.execution_summary.most_common_errors[]
ContextSnapshot.knowledge_base = {
  learned_patterns: string[],
  pitfalls_discovered: string[],
  successful_approaches: string[]
}
```

**决策日志（强）**

```typescript
Decision {
  decision_type: 'approach' | 'tool' | 'model' | 'retry' | 'escalate',
  options_considered: DecisionOption[],
  reasoning: string,
  confidence_score: number   // 0.0-1.0
}
```

**Retry Handler 错误模式匹配（强）**

结构化的错误模式 → 恢复策略映射已实现（rate_limit → same_model，context_length → switch_model，401 → escalate）。

**CLAUDE.md 的 harness-optimizer 角色（已存在）**

`harness-optimizer` 子 Agent 专责"harness-level improvement based on evidence"，且 Principle 9 明确："Failed runs, traces, and evals are inputs for harness improvement"。这是组织层面对失败学习的制度承诺，但执行管道尚未建立。

### 4.2 Harness 目标标准

> "每当你发现 Agent 犯了一个错误，就花时间工程化一个解决方案，使得 Agent 永远不会再犯这个错误。"
> — Mitchell Hashimoto

> "The ability to improve a system is proportional to how easily you can verify its output. A Harness turns vague, multi-step agent workflows into structured data that we can log and grade."
> — Phil Schmid

目标：
- per-goal 错误模式识别（✅ 已实现）
- 跨 Goal 失败知识传播（❌ 核心缺口）
- 失败 → 永久防范规则的工程化管道（❌ 缺口，`harness-optimizer` 角色已就位但缺工具支撑）
- Entropy Agent：周期性一致性检测（❌ 缺口）
- 全局错误签名知识库（❌ 缺口）

### 4.3 差距描述

**差距 4.A：知识孤岛——飞轮未闭合（核心缺口）**

当前知识积累的边界是单个 Goal：

```
Goal A → 失败 → 分析 → ContextPack A (pitfalls: ["X 模式导致循环引用"])
Goal B → 重新开始 → 再次遭遇同样问题 → ContextPack B (pitfalls: [])
```

`harness-optimizer` 子 Agent 的存在说明改进意图已有，但它缺少：
1. 跨 Goal 的失败签名聚类数据
2. 将聚类结果注入到新 Goal 的 Elaboration 阶段的机制
3. 将高频失败转化为 `CLAUDE.md` 防范规则的自动化通道

**差距 4.B：`harness-optimizer` 缺乏工具支撑**

`harness-optimizer` 角色有明确职责（基于证据改进 Harness），但目前没有专属工具：
- 无 `pb failure-analysis` 命令提供聚类视图
- 无 `pb learn` 命令将失败转化为规则
- 无全局知识库可供查询和写入
- `harness-optimizer` 当前只能通过读取日志和 SQLite 进行手工分析

**差距 4.C：无 Entropy Agent 检测系统漂移**

随着代码演化，`CLAUDE.md` 中的规则、`docs/` 文档、各子 Agent 的 skills 内容与实际代码实现之间会逐渐产生漂移。OpenAI Codex 实践中有专门的 background agent 定期扫描文档一致性并开 PR 修复——PonyBunny 目前没有对等机制。Cron Agent 基础设施已存在，但未配置此类 Entropy 检测任务。

**差距 4.D：Decision 日志未形成可复用知识**

`Decision` 实体存储了推理过程（`options_considered`、`reasoning`、`confidence_score`），但没有分析层将高置信度的决策提炼为"决策模式库"。`harness-optimizer` 应能从历史决策中提炼建议，注入到 Elaboration 阶段。

### 4.4 建议方案

**全局知识库（核心实现）**

新增数据库表：
```sql
CREATE TABLE global_knowledge (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  source_goal_id TEXT,
  source_context_pack_id TEXT,
  knowledge_type TEXT NOT NULL CHECK(knowledge_type IN ('pitfall', 'pattern', 'approach', 'decision')),
  domain_tags TEXT,               -- JSON: ["typescript", "api", "testing"]
  content TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,   -- 随复现频率提升
  occurrence_count INTEGER DEFAULT 1,
  last_reinforced_at INTEGER NOT NULL,
  FOREIGN KEY(source_goal_id) REFERENCES goals(id)
);

CREATE INDEX idx_global_knowledge_type ON global_knowledge(knowledge_type);
CREATE INDEX idx_global_knowledge_confidence ON global_knowledge(confidence DESC);
```

新增服务 `GlobalKnowledgeService`：
```typescript
interface GlobalKnowledgeService {
  // Goal 完成时，由 harness-optimizer 调用提取知识
  extractFromContextPack(pack: ContextPack): Promise<GlobalKnowledge[]>

  // 新 Goal Elaboration 阶段注入相关知识
  getRelevantKnowledge(goalContext: GoalContext, limit?: number): Promise<GlobalKnowledge[]>

  // 同类 pitfall 再次发生时，强化 confidence
  reinforce(knowledgeId: string): Promise<void>

  // harness-optimizer 手动录入新知识
  record(entry: GlobalKnowledgeEntry): Promise<void>
}
```

在 Elaboration 阶段系统提示中注入：
```typescript
// src/app/lifecycle/elaboration-service.ts
const pitfalls = await globalKnowledge.getRelevantKnowledge(goal.context, 5);
if (pitfalls.length > 0) {
  promptBuilder.addSection('known-pitfalls', pitfalls);
}
```

**`pb learn` 命令（为 harness-optimizer 提供工具支撑）**

```bash
pb learn --goal <goal-id>          # 分析单个 goal，生成知识条目草稿
pb learn --all --min-occurrences 2 # 跨 goal 聚类，提取高频失败
pb learn --dry-run                 # 预览，不写入
```

实现逻辑：
1. 提取目标 goal 的 `ContextPack.knowledge_base` 和 `error_signature` 聚类
2. 调用 LLM（通过 `harness-optimizer` 角色的 system prompt）生成简洁的防范规则
3. 写入 `global_knowledge` 表
4. 输出可追加到 `CLAUDE.md` 的规则草稿，人工确认后合并

**`pb failure-analysis` 命令（为 harness-optimizer 提供数据视图）**

```bash
pb failure-analysis                    # 全局失败模式报告
pb failure-analysis --top 10           # 最高频 10 种失败模式
pb failure-analysis --goal <goal-id>   # 单 goal 分析
```

**Entropy Agent（Cron 配置，利用现有基础设施）**

在 `config/personas/` 新增 entropy-check agent，使用已有的 Cron Scheduling 基础设施：
```json
{
  "agent_id": "entropy-checker",
  "schedule": { "cron": "0 3 * * 1", "timezone": "Europe/London" },
  "task": "检查以下一致性：1) CLAUDE.md 中的子 Agent 角色与 skills/ 目录中的实际 skill 文件是否对齐；2) docs/reverse-engineering/20260328/ 中的 API 描述与 src/gateway/rpc/ 实现是否一致；3) docs/schemas/ 与 src/infra/config/ 中的实际配置结构是否匹配。发现不一致时创建 Escalation（类型: ambiguous，严重级别: low）并列出差异。",
  "policy": {
    "toolAllowlist": ["read_file", "list_dir", "search_code"],
    "limits": { "maxTokens": 30000, "maxCost": 0.8 }
  }
}
```

### 4.5 参考资料

- Mitchell Hashimoto《My AI Adoption Journey》— "Engineer the Harness" 原则
- OpenAI《Harness Engineering: Leveraging Codex in an Agent-First World》— Golden Principles + Garbage Collection Agent
- Phil Schmid《The importance of Agent Harness in 2026》— Hill Climbing via Real-World Feedback
- LangChain DeepAgents 案例 — Terminal Bench 2.0 从第30名→第5名（未改模型，仅改 Harness）

---

## 维度五：护栏系统（Guardrails）

### 5.1 当前实际情况

**三层责任模型（非常强）**

```
Layer 1 - Autonomous: read_file, list_dir, search_code → 自由执行
Layer 2 - Approval Required: execute_command, write_file, web_search → 人工审批
Layer 3 - Forbidden: 破坏性系统命令 → 永远禁用
```

**工具风险分级**：`safe | moderate | dangerous | critical`

**Per-Goal 工具配置（强）**：11 个 `goal.tools.*` RPC 方法，含历史追踪（`goal.tools.history`）。

**Permission Grant 完整流程（强）**：创建 → 审批/拒绝 → TTL-based grant，持久化。

**ToolEnforcer 五层检查（强）**：存在 → allowlist → blocklist → layer → grant 有效期。

**Budget 三维追踪（强）**：tokens / time / cost，三级警告 + 自动 escalation。

**CLAUDE.md 的规划前置（强）**

Required Working Model 强制"Produce a plan before broad code changes"，Non-Negotiable Rules 明确"Do not perform a broad rewrite without a migration plan"——这是 Plan-first 的制度化实现，在开发工作流层面完全覆盖。

### 5.2 Harness 目标标准

- 工具访问白名单/黑名单（✅）
- 人工审批门（✅）
- Budget 控制（✅）
- Plan-first 开发工作流（✅ CLAUDE.md Required Working Model）
- 执行环境沙箱隔离（❌ 缺口，视部署场景）
- `pb work` 命令级 plan-first（⚠️ CLAUDE.md 覆盖了 coding sessions，但直接 `pb work` 调用无此前置）

### 5.3 差距描述

**差距 5.A：`pb work` 命令缺少显式计划审批步骤**

`CLAUDE.md` 的 Required Working Model 在 coding session 中强制 Plan-first，但 `pb work <task>` 直接提交任务到自主执行，没有"先展示计划 → 人工确认 → 再执行"的工作流。对于复杂任务，自主执行前的计划审批是避免大范围错误的关键。

注意区别：这与 `clarify.*` 流程的目标不同——clarify 处理目标的模糊性，而 Plan-first 是对执行方案的审批。

**差距 5.B：Layer 2 审批 UX 的完整性**

Layer 2 工具的审批流程在后端已完整实现，但由于 `pb webui` 未完成，审批操作目前只能通过 TUI 或 API 完成。可视化的审批界面（展示 args_summary + reason + 批准/拒绝）是生产环境中 Human-in-the-Loop 的重要体验保障。

**差距 5.C：无执行环境沙箱隔离**

所有 Agent 任务共享同一宿主环境。Stripe Minions 模式使用独立的预热 devbox per-task，隔离生产系统和互联网访问。这对于本地优先（local-first）的 PonyBunny 而言，主要影响的是高危险级别工具的侧效应隔离。

### 5.4 建议方案

**`pb work --plan-first`（高优先级）**：

```bash
pb work "实现 X 功能" --plan-first
# 输出：
# Goal 理解
# WorkItems DAG（含估算和依赖关系）
# 每个 WorkItem 的 verification_plan
# 预估 token / 成本 / 时长
# > 是否批准执行？[y/N]
```

实现：Planning 阶段后，Gateway 向客户端推送 `plan.ready` 事件，暂停调度直到收到 `plan.approve` RPC。

**加速完成 `pb webui`**（见维度六）：Layer 2 审批是 Web UI 最高价值的功能之一。

### 5.5 参考资料

- Stripe Minions 实践 — `ignorance.ai/p/the-emerging-harness-engineering`（devbox 隔离 + 400 MCP 工具）
- Boris Tane (Cloudflare) — "规划与执行分离是最重要的单项实践"
- Salesforce《What Is an Agent Harness?》— `salesforce.com/agentforce/ai-agents/agent-harness/`

---

## 维度六：可观测性（Observability）

### 6.1 当前实际情况

**SchedulerMetrics（生产级指标，已存在）**

```typescript
SchedulerMetrics {
  totalGoalsProcessed: number,
  totalWorkItemsCompleted: number,
  totalRunsExecuted: number,
  averageWorkItemDurationMs: number,
  successRate: number,
  currentActiveGoals: number,
  currentActiveWorkItems: number
}
```

**完整审计链**：`audit_logs` 记录每次状态变更，含 actor/action/old_value/new_value，多维度查询 API。

**成本可见性**：`Run.cost_usd` + `Run.tokens_used` + `Goal.spent_cost_usd`。

**Debug 基础设施**：`pb debug web|tui`、`pb events tail`、`debug.snapshot` RPC。

**CLAUDE.md Status Vocabulary（强）**

统一状态词汇表（proposed/planned/implemented/verified/documented/blocked）为可观测性提供了语义标准——任何时间点都能准确报告工作项的真实状态，消除"已实现≠已验证"的混淆。

### 6.2 Harness 目标标准

- 生产级指标（✅ SchedulerMetrics）
- 完整审计链（✅）
- 成本追踪（✅）
- 标准化状态词汇（✅ CLAUDE.md）
- 可视化 Web 界面（⚠️ `web/` 目录存在，CLI 管理未完成）
- 跨 Goal 失败模式聚类（❌ 缺口）
- Harness 效能指标（❌ 缺口）

### 6.3 差距描述

**差距 6.A：`pb webui` CLI 服务管理未完成**

`web/` 目录包含完整的 Next.js 16 + React 19 + Tailwind 4 + shadcn/ui 实现，但 `pb webui` 命令的 `start/stop/status` 服务管理未完成（`src/cli/commands/webui.ts` 仅打印指引）。这是开源社区接受度的最大障碍——新用户的首次体验需要可视化界面，Layer 2 审批操作也最适合在 Web UI 中完成。

**差距 6.B：缺跨 Goal 的失败模式聚类视图**

当前统计是 per-goal 或全系统总量，缺少"哪种错误模式最常见"、"哪类 WorkItem 最容易失败"的聚类视图。这类视图是 `harness-optimizer` 进行"hill climbing"的核心数据来源。

**差距 6.C：无专项 Harness 效能指标**

缺少衡量 Harness 本身价值的指标：
- Quality Gate 有效性（`deterministic` vs `llm_review` 门的通过率和发现 bug 比率）
- Permission 审批等待时长（Human-in-the-Loop 的 UX 瓶颈）
- Escalation 平均解决时间
- Retry Handler 成功率（策略有效性）
- ContextPack 被使用频率（跨会话恢复的实际使用率）

### 6.4 建议方案

**加速完成 `pb webui` CLI 管理（最高社区优先级）**：

对齐 `pb gateway` / `pb scheduler` 的实现模式，在 `src/cli/commands/webui.ts` 中完善：
```bash
pb webui start   # 启动 web/，默认 port 3000，写入 PID 文件
pb webui stop    # 停止
pb webui status  # 状态、PID、端口、uptime
pb webui logs -f # 日志
```

**`pb dashboard` 命令（终端指标看板）**：

```bash
pb dashboard     # 综合指标，最近7天
```

输出：Goal 完成率趋势、最高频失败模式 Top 5、Quality Gate 通过率、Permission 审批队列长度、日均成本。

**Web UI 中新增 Harness Dashboard 页面**：

利用现有 WebSocket RPC 体系（`debug.snapshot`、`audit.stats`、`permission.stats`）聚合：失败模式热力图、Quality Gate 通过率、Retry Handler 效能、每日成本趋势。

**在 `global_knowledge` 建立后（见维度四）**，为 `harness-optimizer` 提供跨 Goal 的失败聚类视图。

### 6.5 参考资料

- Next.js 16 文档 — `nextjs.org`（`pb webui` 服务化参考）
- LangChain LangSmith Observability — Agent 可观测性最佳实践
- Aakash Gupta《2025 Was Agents. 2026 Is Agent Harnesses》— "Measure outcomes, not activity"

---

## 综合实施路线图

### 阶段一：即时行动（1-2 周）

| 任务 | 维度 | 工作量 | 价值 |
|------|------|--------|------|
| 在 `CLAUDE.md` 末尾增加"Known Failure Patterns"节（初始为空，约定写入规则） | 规范文件 | 1小时 | 建立积累机制 |
| 完成 `pb webui start/stop/status/logs` CLI 管理 | 可观测性 | 3-5天 | 社区优先，Layer 2 审批 UX |
| 实现 `pb work --plan-first` 计划审批模式 | 护栏 | 3-5天 | 生产安全 |
| 在 CLAUDE.md Preferred Delegation 中明确 `verification_plan` 归属 `planner` | 验证回路 | 1小时 | 规范 |

### 阶段二：核心飞轮（2-4 周）

| 任务 | 维度 | 工作量 | 价值 |
|------|------|--------|------|
| `global_knowledge` 表 + `GlobalKnowledgeService` | 失败学习 | 2-3周 | 飞轮核心 |
| `pb learn` 命令（失败→全局知识→CLAUDE.md 草稿） | 失败学习 | 1周 | `harness-optimizer` 工具 |
| `pb failure-analysis` 命令（跨 Goal 聚类视图） | 失败学习+可观测 | 1周 | `harness-optimizer` 数据 |
| Elaboration 阶段注入 `global_knowledge` | 失败学习+上下文 | 3-5天 | 飞轮激活 |

### 阶段三：扩展能力（1-2 月）

| 任务 | 维度 | 工作量 | 价值 |
|------|------|--------|------|
| Playwright MCP 集成 + Layer 2 配置 | 验证回路 | 1-2周 | UI 产物验证 |
| Entropy Agent（Cron，每周一）| 失败学习+规范 | 3-5天（配置为主） | 长期一致性 |
| Harness Dashboard（Web UI 页面）| 可观测性 | 2-3周 | 数据驱动改进 |
| ContextPack 自动触发 + Compaction 阈值 | 上下文管理 | 1周 | 可靠性 |

---

## 附录：参考资料汇总

### 命名源头与核心论文

| 资料 | 链接 | 重点 |
|------|------|------|
| Mitchell Hashimoto《My AI Adoption Journey》| `mitchellh.com/writing/my-ai-adoption-journey` | Harness Engineering 命名，历史积累原则 |
| OpenAI《Harness Engineering: Leveraging Codex》| `openai.com/index/harness-engineering/` | 百万行代码实验，Golden Principles，Entropy Agent |
| Phil Schmid《The importance of Agent Harness in 2026》| `philschmid.de/agent-harness-2026` | "模型是 CPU，Harness 是 OS"，Hill Climbing |
| Anthropic《Effective Harnesses for Long-Running Agents》| `anthropic.com/engineering/effective-harnesses-for-long-running-agents` | Initializer Agent，ContextPack 设计，Compaction |
| Aakash Gupta《2025 Was Agents. 2026 Is Agent Harnesses》| `medium.com/@aakashgupta` | 整体趋势，"模型是商品，Harness 是护城河" |

### 工程实践案例

| 资料 | 链接 | 重点 |
|------|------|------|
| The Emerging Harness Engineering Playbook | `ignorance.ai/p/the-emerging-harness-engineering` | Stripe devbox，Cloudflare plan-first，OpenAI AGENTS.md |
| Martin Fowler《Harness Engineering》| `martinfowler.com/articles/exploring-gen-ai/harness-engineering.html` | 上下文工程 + 架构约束 + Entropy GC 三分法 |
| Salesforce《What Is an Agent Harness?》| `salesforce.com/agentforce/ai-agents/agent-harness/` | 企业级护栏设计 |

### 工具与 SDK

| 工具 | 用途 | 链接 |
|------|------|------|
| Playwright MCP Server | 浏览器自动化验证 | `github.com/microsoft/playwright-mcp` |
| Anthropic Claude Agent SDK | Compaction 参考实现 | `docs.anthropic.com` |
| Awesome Agent Skills | 技能生态参考 | `github.com/VoltAgent/awesome-agent-skills` |

---

*本文档基于 `docs/reverse-engineering/20260328/`（9章）及当前生效 `CLAUDE.md` 分析生成。建议每季度更新一次，或在 `harness-optimizer` 完成重要 Harness 改进后更新。*