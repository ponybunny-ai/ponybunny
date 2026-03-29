# PonyBunny Harness Gap Analysis
**Agent Harness Engineering — 差距分析与升级路线图**

> **文档版本**: v3.0 · 2026-03-29
> **基准文档**: `docs/reverse-engineering/20260329/`（9章）+ `CLAUDE.md`（当前生效版本）
> **ADR-001 状态**: 全部5个阶段已验证，1928 个测试通过
> **适用读者**: PonyBunny 核心开发者、DarkhorseOne 产品规划
>
> **v3.0 修订说明**：基于2026-03-29版本文档更新。ADR-001全面落地：`src/harness/`层已实现并验证（GoalHarness、HarnessDaemon、PostGoalEvaluator），`GlobalKnowledgeService`已落入`src/domain/knowledge/`，`global_knowledge`表已入库，Elaboration阶段已实际注入全局知识。`AutonomyDaemon`已删除。各维度评分全面更新。

---

## 概述

**当前系统状态的最准确描述：**

> **架构正确、核心机制扎实、Harness 宪法成型、学习飞轮基础设施齐备——唯一缺口是飞轮最后一公里的连接。**

ADR-001 的完成是一次重大架构里程碑：GoalHarness 将 Elaboration/Planning 与 SchedulerCore 的 Execution 干净分离，PostGoalEvaluator 提供了不影响调度器状态的观测性评估层，GlobalKnowledgeService 已实装并在 Elaboration 注入知识。这三件事合在一起，意味着 PonyBunny 的 Harness 工程飞轮的基础设施层已完整。

**剩余的真实缺口集中在两处**：
1. PostGoalEvaluator 产出的 `GoalEvaluationReport` 与 `GlobalKnowledgeService.extractFromContextPack()` 之间的自动连接管道——这是飞轮最后一公里
2. 若干 CLI 工具和 UX 的未完成项（pb webui、pb work --plan-first、pb learn）

**总体成熟度评分（2026-03-29版本）：**

| 维度 | v2分数（03-28） | v3分数（03-29） | 缺口等级 |
|------|----------------|----------------|---------|
| 规范文件 | 88 | 90 | 低 |
| 上下文管理 | 72 | 85 | 低 |
| 验证回路 | 78 | 82 | 低 |
| **失败学习** | **52** | **70** | **中（最后一公里）** |
| 护栏系统 | 82 | 88 | 低 |
| 可观测性 | 72 | 76 | 中 |
| **总体** | **69** | **82** | — |

---

## 维度一：规范文件（Specification Files）

### 当前实际情况

**状态：已成熟，处于自然演化阶段。**

`CLAUDE.md` 是有效的 Harness 宪法（10条原则、七类子 Agent 角色、强制状态词汇表、Evidence Standards、Session End Requirements）。`docs/reverse-engineering/20260329/` 提供了 9 章完整的系统技术规格，包含 ADR-001 全部变更的准确记录（`src/harness/` 层的完整描述、GoalHarness 不变量、PostGoalEvaluator 边界）。

### 已对齐

- Agent cold start 上下文充足（CLAUDE.md + 逆向工程文档集）✅
- Plan-before-code 制度化（Required Working Model）✅
- Generator/Evaluator 角色分离（七类子 Agent）✅
- 架构不变量书面化（ADR-001 不变量节）✅

### 剩余差距

**差距 1.A：CLAUDE.md 尚无历史失败防范积累**

这不是架构缺陷，是时间积累的问题。系统刚建立 Harness 工程宪法，还没有足够多的历史失败可提炼。随着实际使用积累，这个节会自然填充——但需要建立约定，否则不会自动发生。

**建议**：在 `CLAUDE.md` 末尾预留节，建立写入约定：

```markdown
## Known Failure Patterns (Accumulated)
<!-- 约定：每次 Agent 在此仓库犯错并被修复，在此追加一条。
     格式：[日期] 错误描述 → 防范措施
     由 harness-optimizer 定期汇总，也可手动追加 -->
```

**差距 1.B：docs/reverse-engineering 更新策略未定义**

文档已是两个日期版本（03-28、03-29），随着 ADR 持续推进，版本管理策略需要明确：是追加新版本目录，还是 in-place 更新？建议在 `docs/development/` 中记录一条 ADR，规定逆向工程文档的更新触发条件和职责（由 docs-writer 子 Agent 负责，在每次重大架构变更后执行）。

---

## 维度二：上下文管理（Context Management）

### 当前实际情况

**状态：大幅改善，跨 Goal 知识注入已激活。**

ADR-001 Phase 1 已将 GlobalKnowledge 注入 Elaboration 阶段，数据流步骤 6a 明确："Elaborate — inject GlobalKnowledge pitfalls"。这意味着新 Goal 开始时，系统会自动查询 `GlobalKnowledgeService.getRelevantKnowledge()` 并将历史 pitfalls 注入到 Elaboration 的 system prompt 中。

结合 ContextPack 的三种类型（`daily_checkpoint | error_recovery | handoff`）、向量记忆系统、Session archive/resume 生命周期，跨会话上下文管理的完整性已相当高。

### 已对齐

- per-goal 跨会话状态桥接（ContextPack）✅
- 跨 Goal 知识注入（GlobalKnowledge → Elaboration）✅
- 向量记忆 + FTS5 检索 ✅
- CLAUDE.md Session End Requirements（开发会话结构化交接）✅

### 剩余差距

**差距 2.A：ContextPack 生成触发机制未明确**

`ContextSnapshot` 设计完整，但 `daily_checkpoint` 和 `handoff` 类型的生成触发条件在文档中没有明确记录。如果创建 ContextPack 依赖外部调用而非系统自动触发，长任务的状态持久化可靠性低于设计意图。

**建议**：在 Scheduler 或 HarnessDaemon 中明确两个自动触发点：
- Goal 进入 `completed` 或 `blocked` 状态时，自动创建 `daily_checkpoint`
- HarnessDaemon 轮询到活跃 Goal 超过设定时长时，自动创建 `daily_checkpoint`

这个变更不涉及新接口，只需要在现有触发点（SchedulerCore 完成 goal 时）加入 `createContextPack` 调用。

**差距 2.B：GlobalKnowledgeService.getRelevantKnowledge 的查询策略未记录**

文档指出 Elaboration 阶段注入知识，但没有记录 `getRelevantKnowledge(type, tags, threshold)` 的实际查询策略——confidence 阈值是多少？domain_tags 如何匹配？注入的条目上限是多少（防止 prompt 膨胀）？这些参数直接影响知识注入的质量和成本。

**建议**：在 `docs/development/` 中记录全局知识注入策略文档（或作为 GlobalKnowledgeService 的内联注释），包括：默认 confidence 阈值（建议 ≥0.6）、domain tags 匹配算法、每次注入的最大条目数（建议 5-10）。

---

## 维度三：验证回路（Verification Loops）

### 当前实际情况

**状态：已完善，PostGoalEvaluator 增加了 goal 级观测评估层。**

**PostGoalEvaluator（ADR-001 Phase 5）**：订阅 `goal_completed` / `goal_failed` 事件，评估所有 WorkItem 的最终 Run，产出 `GoalEvaluationReport`（包含每个 WorkItem 的 EvaluationResult 和 summary 聚合）。设计为纯观测性（never modifies scheduler state），fire-and-forget（never crashes scheduler），有界存储（max 100 reports）。

结合已有的 Quality Gates 双模式（deterministic + llm_review）、WorkItem 级 `verification_plan`、EvaluationService（第6阶段），验证体系现在覆盖了两个粒度：WorkItem 级（Quality Gates）和 Goal 级（PostGoalEvaluator）。

### 已对齐

- Quality Gates 双模式（deterministic + llm_review）✅
- WorkItem 级 verification_plan + verify 状态机 ✅
- Goal 级 PostGoalEvaluator（观测性）✅
- Generator/Evaluator 角色分离（CLAUDE.md + 子 Agent）✅
- EvaluationService 决策（publish/retry/replan/escalate）✅

### 剩余差距

**差距 3.A：GoalEvaluationReport 无 API 暴露**

PostGoalEvaluator 产出 GoalEvaluationReport 并存储（max 100），但目前 API Reference（第05章）中没有查询这些 Report 的 RPC 方法。这意味着 `harness-optimizer` 子 Agent 和 Web UI 无法通过标准接口读取评估报告。

**建议**：增加 RPC 方法：
```
evaluation.list   read   { goalId?, trigger?, limit? }   { reports }
evaluation.get    read   { goalId }                       GoalEvaluationReport
```

**差距 3.B：verification_plan 的 Planning 阶段归属未书面化**

`WorkItem.verification_plan` 字段存在且完整，但 CLAUDE.md 和文档中没有明确记录"verification_plan 由 planner 子 Agent 在 Planning 阶段生成"这一约定。如果 generator 可以自行填写，会出现被验证者自定义验证标准的问题，削弱验证独立性。

**建议**：在 CLAUDE.md 的 Preferred Delegation 节追加：
```
- verification_plan generation for all work items → planner (not generator)
```

**差距 3.C：无浏览器自动化验证**

对于产出 Web UI 功能的 WorkItem，`deterministic` gates 只能验证命令行可检查的内容（测试通过、lint 清洁），无法验证用户实际可见的 UI 行为。这是验证体系目前唯一的盲区。

**建议**：将 Playwright MCP 作为 Verification 阶段的可选工具（Layer 2 - Approval Required）：
```json
// mcp-config.json
{
  "mcpServers": {
    "playwright": {
      "enabled": false,
      "transport": "stdio",
      "command": "npx",
      "args": ["@playwright/mcp@latest"],
      "allowedTools": ["browser_navigate", "browser_screenshot", "browser_click", "browser_evaluate"]
    }
  }
}
```
默认 disabled，用户按需启用。

---

## 维度四：失败学习（Failure Learning）

> ⚠️ **这是当前系统与"完整 Harness 飞轮"之间唯一的中等差距。基础设施已完备，缺的是最后一公里的连接。**

### 当前实际情况

**状态：基础设施完整，飞轮未完全闭合。**

**已实现的部分（ADR-001 带来的重大改进）**：

- `src/domain/knowledge/` — GlobalKnowledgeService 在 Domain 层
- `global_knowledge` 表已入库（knowledge_type, domain_tags, content, confidence, occurrence_count, last_reinforced_at）
- GlobalKnowledgeService 四个方法：`extractFromContextPack`, `getRelevantKnowledge`, `record`, `reinforce`
- GoalHarness Elaboration 阶段主动注入 GlobalKnowledge pitfalls（数据流步骤 6a）
- PostGoalEvaluator 产出 `GoalEvaluationReport.unactionableDecisions[]`（决策审计）
- 错误签名系统（`Run.error_signature` + `getRepeatedErrorSignatures()`）
- per-goal `ContextSnapshot.knowledge_base`（learned_patterns, pitfalls_discovered, successful_approaches）
- Decision 实体（完整推理日志 + confidence_score）
- `harness-optimizer` 子 Agent（已建立，专责基于证据的 Harness 改进）

**飞轮的当前状态**：

```
已实现的路径：
GlobalKnowledge.getRelevantKnowledge()
    ↓ (在 Elaboration 注入) ✅
新 Goal 获得历史知识

尚未连接的路径：
Goal 完成
    → PostGoalEvaluator 产出 GoalEvaluationReport ✅
    → ??? → GlobalKnowledgeService.extractFromContextPack() ❌
    → GlobalKnowledge 表写入新条目 ❌
    → 下一个 Goal 的 Elaboration 注入 ✅

飞轮状态：读取端已通，写入端管道未接通。
```

### 剩余差距

**差距 4.A：PostGoalEvaluator → GlobalKnowledge 写入管道（核心缺口）**

这是飞轮唯一真正缺失的连接。PostGoalEvaluator 在 `src/harness/post-goal-evaluator.ts` 中，评估完成后产出报告，但没有调用 `GlobalKnowledgeService.extractFromContextPack()` 或 `GlobalKnowledgeService.record()`。

目前 global_knowledge 表存在但可能为空——GlobalKnowledgeService 的 `extractFromContextPack` 方法存在，但没有任何地方自动触发调用它。

PostGoalEvaluator 是接入 GlobalKnowledge 写入的最自然位置：

```typescript
// src/harness/post-goal-evaluator.ts 建议扩展
async function onGoalEvent(event: GoalEvent): Promise<void> {
  const report = await evaluateGoal(event.goalId);
  storeReport(report);  // 已有

  // 新增：提取知识并写入全局库
  const contextPack = await contextPackRepo.getLatestForGoal(event.goalId);
  if (contextPack) {
    const entries = await globalKnowledge.extractFromContextPack(contextPack);
    // extractFromContextPack 已实现，只需在这里调用
  }
}
```

注意：PostGoalEvaluator 的设计原则是"observational, never modifies scheduler state"——写入 GlobalKnowledge 不违反此原则，GlobalKnowledge 是独立的知识存储，不是 scheduler 状态。

**差距 4.B：GlobalKnowledge 写入的其他触发点缺失**

除 goal 完成路径外，还有两个高价值的知识来源尚未连接：

1. Escalation 解决时——人工解决的 Escalation 通常包含高价值知识（特别是 `risk` 和 `stuck` 类型），解决后应自动提取到 GlobalKnowledge
2. 高置信度 Decision 实体——`confidence_score ≥ 0.8` 的决策是经过充分推理的方案，应成为推荐模式

**差距 4.C：harness-optimizer 缺乏 CLI 工具支撑**

`harness-optimizer` 子 Agent 有明确职责（基于证据改进 Harness），但缺少配套 CLI 工具。目前 `harness-optimizer` 只能通过读取原始 SQLite 数据进行手工分析。

**建议**：

`pb learn` 命令（GlobalKnowledge 管道的 CLI 接口）：
```bash
pb learn --goal <goal-id>          # 对单个 goal 执行知识提取
pb learn --since 7d                # 处理过去7天所有完成的 goal
pb learn --dry-run                 # 预览会写入的条目，不实际写入
```
实现逻辑：获取目标范围内的 ContextPack → 调用 `GlobalKnowledgeService.extractFromContextPack()` → 写入 `global_knowledge` 表 → 输出摘要。

`pb failure-analysis` 命令（为 harness-optimizer 提供数据视图）：
```bash
pb failure-analysis                    # 全局 error_signature 聚类报告
pb failure-analysis --top 10           # 最高频 10 种失败模式
pb failure-analysis --goal <goal-id>   # 单 goal 失败分析
```

`pb knowledge` 命令（GlobalKnowledge 管理）：
```bash
pb knowledge list --type pitfall       # 列出全局知识条目
pb knowledge stats                     # 条目数、平均置信度、最近强化时间
pb knowledge reinforce <id>            # 手动强化条目
```

**差距 4.D：无 Entropy Agent 检测系统漂移**

随着代码演化，CLAUDE.md、docs/、各子 Agent 的 skill 文件与实际代码之间会产生语义漂移。Cron Agent 基础设施已存在，但没有配置此类检测任务。

**建议**：在 `config/personas/` 中配置 entropy-check agent（利用现有 Cron 基础设施）：
```json
{
  "agent_id": "entropy-checker",
  "schedule": { "cron": "0 3 * * 1", "timezone": "Europe/London" },
  "task": "检查以下一致性：1) CLAUDE.md 中的子 Agent 角色与 skills/ 目录中的实际 skill 文件描述是否一致；2) docs/reverse-engineering/ 中的 API 方法列表与 src/gateway/rpc/ 实现是否对齐；3) docs/schemas/ 中的配置结构与 src/infra/config/ 实际实现是否匹配。发现不一致时创建 Escalation（类型: ambiguous，严重级别: low）并列出具体差异。",
  "policy": {
    "toolAllowlist": ["read_file", "list_dir", "search_code"],
    "limits": { "maxTokens": 40000, "maxCost": 1.0 }
  }
}
```

---

## 维度五：护栏系统（Guardrails）

### 当前实际情况

**状态：已成熟，ADR-001 在架构层面提供了 Plan-first 保障。**

GoalHarness 的引入从架构层面实现了 Plan-first：所有 Goal 必须经过 Elaboration → Plan（生成 WorkItem DAG）才会进入 SchedulerCore 执行。这是比 `pb work --plan-first` 标志更根本的保障——GoalHarness 的不变量之一是"GoalHarness NEVER performs execution"。

三层责任模型、ToolEnforcer 五层检查、per-goal 工具配置、Permission Grant 流程、Budget 三维追踪均已成熟。

### 已对齐

- 三层责任模型（Layer 1/2/3）✅
- 工具风险分级（safe/moderate/dangerous/critical）✅
- Per-goal allowlist/blocklist + 11 个 goal.tools.* RPC ✅
- Permission Grant 完整流程（TTL-based）✅
- ToolEnforcer 五层检查 ✅
- Budget 三维追踪 + 分级警告 ✅
- **Plan-before-execution（GoalHarness 架构层面）✅**

### 剩余差距

**差距 5.A：`pb work` 命令缺少显式计划展示步骤**

GoalHarness 保证了所有 Goal 在执行前经过 Planning，但用户通过 `pb work <task>` 提交任务后，目前没有"先展示生成的 WorkItem DAG → 等待确认 → 再执行"的交互。对于复杂任务，用户看到计划并有机会中止，是人工审批门的完整体现。

注意：这与 `clarify.*` 流程不同——clarify 处理目标的模糊性，plan review 是对执行方案的审批。

**建议**：新增 `pb work --review-plan` 标志（区别于 `--plan-first` 的更准确命名）：
- GoalHarness 完成 Planning 后，向客户端发送 `plan.ready` 事件（携带 WorkItem DAG + 估算成本）
- `pb work --review-plan` 模式下，CLI 展示计划并等待用户输入 y/N
- 确认后发送 `plan.approve` RPC，触发 `goal active` 转换
- 不确认则发送 `goal.cancel`

**差距 5.B：Layer 2 审批 UX 依赖 pb webui 完成**

Layer 2 工具的 Permission Grant 流程后端完整，但用户友好的审批界面依赖 `pb webui` 完成。在 `pb webui` 完成之前，审批操作只能通过 TUI 或直接 RPC 完成，对非技术用户使用障碍较高。

---

## 维度六：可观测性（Observability）

### 当前实际情况

**状态：生产级指标已有，缺 Web UI 管理和跨目标聚类视图。**

`SchedulerMetrics`（successRate, averageWorkItemDurationMs, totalRunsExecuted），完整审计链，per-run 成本追踪，`pb events tail`，`debug.snapshot` RPC 均已实现。ADR-001 新增了 PostGoalEvaluator 的 GoalEvaluationReport（含 summary 聚合），增加了一个 goal 级评估的可观测维度。

### 已对齐

- SchedulerMetrics（生产级指标）✅
- 完整审计链（audit_logs）✅
- Per-run 成本追踪 ✅
- GoalEvaluationReport（goal 级评估，max 100）✅
- debug.snapshot + pb events tail ✅
- CLAUDE.md Status Vocabulary ✅

### 剩余差距

**差距 6.A：`pb webui` CLI 服务管理未完成**

`web/` 目录包含完整的 Next.js 16 + React 19 + Tailwind 4 + shadcn/ui + Monaco Editor 实现，但 `pb webui` 的 `start/stop/status/logs` 命令未完成（第08章 CLI Reference 无此命令）。这是开源社区接受度的最大单项障碍：新用户的首次体验需要可视化界面，Layer 2 审批和 GoalEvaluationReport 也最适合在 Web UI 呈现。

**建议**：在 `src/cli/commands/webui.ts` 中对齐 `pb gateway` / `pb scheduler` 的实现模式：
```bash
pb webui start   # 启动 web/，写入 PID，默认 port 3000
pb webui stop    # 停止
pb webui status  # PID、端口、uptime
pb webui logs -f # 日志跟踪
```

**差距 6.B：GoalEvaluationReport 无 RPC 接口**

`PostGoalEvaluator` 产出的报告存储在内存（max 100），但没有 RPC 方法可以查询。对于 `harness-optimizer` 子 Agent 分析 Harness 效能、Web UI 展示历史评估，这个接口是必要的。

**建议**：在 Gateway RPC 体系中增加：
```
evaluation.list   read   { goalId?, limit? }  { reports: GoalEvaluationReport[] }
evaluation.get    read   { goalId }            GoalEvaluationReport | null
```

同时考虑将 GoalEvaluationReport 从内存存储持久化到 SQLite（新增 `goal_evaluation_reports` 表），以便在 Daemon 重启后保留历史记录。

**差距 6.C：缺跨 Goal 失败模式聚类视图**

目前没有面向用户的视图展示"哪种 error_signature 最常见"、"哪类 WorkItem item_type 失败率最高"。这类聚类视图是 `harness-optimizer` "hill climbing"的核心数据来源，也是 Web UI Harness Dashboard 的核心内容。

补全差距 6.A（pb webui）+ 差距 4.A（GlobalKnowledge 写入管道）后，实现此视图的数据基础才完整。

---

## 综合实施路线图

### 阶段一：最后一公里（3-7 天，高价值，低风险）

| 任务 | 维度 | 工作量 | 说明 |
|------|------|--------|------|
| PostGoalEvaluator 写入 GlobalKnowledge | 失败学习 | 1-2天 | 飞轮闭合。在现有 `onGoalEvent` 中调用已有的 `extractFromContextPack()`，无新接口 |
| 在 CLAUDE.md 追加"Known Failure Patterns"节 | 规范文件 | 1小时 | 建立积累约定 |
| 在 CLAUDE.md Preferred Delegation 中明确 verification_plan → planner | 验证回路 | 30分钟 | 规范 |
| `evaluation.list` / `evaluation.get` RPC 接口 | 可观测性 | 1天 | 暴露已有的 GoalEvaluationReport |

### 阶段二：工具完善（1-2 周）

| 任务 | 维度 | 工作量 | 说明 |
|------|------|--------|------|
| 完成 `pb webui start/stop/status/logs` | 可观测性 | 3-5天 | 社区接受度 + Layer 2 审批 UX |
| `pb learn` 命令 | 失败学习 | 2-3天 | harness-optimizer 核心工具 |
| `pb failure-analysis` 命令 | 失败学习 | 2-3天 | harness-optimizer 数据视图 |
| `pb knowledge list/stats/reinforce` | 失败学习 | 1-2天 | GlobalKnowledge 管理 |
| ContextPack 自动触发（goal completed/blocked） | 上下文管理 | 1天 | 可靠性保障 |

### 阶段三：用户体验与扩展（2-4 周）

| 任务 | 维度 | 工作量 | 说明 |
|------|------|--------|------|
| `pb work --review-plan` 计划审批模式 | 护栏 | 3-5天 | Plan-first 用户交互层 |
| GoalEvaluationReport 持久化（SQLite） | 可观测性 | 2-3天 | 重启后保留历史 |
| Entropy Agent（每周一 Cron 配置） | 失败学习 | 1天（配置为主） | 文档漂移检测 |
| Web UI Harness Dashboard 页面 | 可观测性 | 1-2周 | 失败聚类视图、Quality Gate 效能 |
| Playwright MCP（可选，按需启用） | 验证回路 | 1-2天（配置为主） | UI 产物端对端验证 |

---

## 当前 Harness 完成度总览

```
规范文件          ████████████████████░░  90%
上下文管理        █████████████████░░░░░  85%
验证回路          ████████████████░░░░░░  82%
失败学习          ██████████████░░░░░░░░  70%  ← 唯一中等缺口
护栏系统          █████████████████░░░░░  88%
可观测性          ███████████████░░░░░░░  76%

总体              ████████████████░░░░░░  82%
```

**最高优先级行动**：PostGoalEvaluator → GlobalKnowledge 写入管道（1-2天工作量，闭合唯一的架构级未完成项）。

---

## 附录：参考资料

### 命名源头与核心文献

| 资料 | 链接 | 与 PonyBunny 的关联 |
|------|------|-------------------|
| Mitchell Hashimoto《My AI Adoption Journey》| `mitchellh.com/writing/my-ai-adoption-journey` | "Engineer the Harness" 命名；历史失败积累原则（差距 1.A）|
| OpenAI《Harness Engineering: Leveraging Codex》| `openai.com/index/harness-engineering/` | Golden Principles + Garbage Collection Agent（Entropy Agent 设计参考）|
| Phil Schmid《The importance of Agent Harness in 2026》| `philschmid.de/agent-harness-2026` | "模型是CPU，Harness是OS"；Hill Climbing 原则（GlobalKnowledge 飞轮的理论基础）|
| Anthropic《Effective Harnesses for Long-Running Agents》| `anthropic.com/engineering/effective-harnesses-for-long-running-agents` | Initializer Agent 模式（GoalHarness 设计对齐）；Compaction 策略 |
| Aakash Gupta《2025 Was Agents. 2026 Is Agent Harnesses》| `aakashgupta.medium.com` | "模型是商品，Harness是护城河"；整体趋势定位 |

### 工程实践案例

| 资料 | 链接 | 关联缺口 |
|------|------|---------|
| The Emerging Harness Engineering Playbook | `ignorance.ai/p/the-emerging-harness-engineering` | 差距 5.A（Plan-first）；差距 5.B（审批 UX） |
| Martin Fowler《Harness Engineering》| `martinfowler.com/articles/exploring-gen-ai/harness-engineering.html` | 差距 4.D（Entropy Agent）；上下文工程 + 架构约束三分法 |
| LangChain DeepAgents Terminal Bench 案例 | `github.com/langchain-ai` | 差距 4.A（失败→知识提炼的量化价值：52.8% → 66.5%，未改模型）|

### 工具

| 工具 | 用途 | 关联缺口 |
|------|------|---------|
| Playwright MCP Server | 浏览器端对端验证 | 差距 3.C |
| Anthropic Claude Agent SDK | Compaction 参考实现 | 差距 2.A |

---

*本文档基于 `docs/reverse-engineering/20260329/`（9章，ADR-001 全部5阶段已验证）及当前 `CLAUDE.md` 分析生成。建议在每次重大 ADR 实施后更新，或由 docs-writer 子 Agent 在架构变更后自动重新生成。*