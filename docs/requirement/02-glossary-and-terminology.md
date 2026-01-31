# 术语表与规范 (Glossary and Terminology)

**文档状态**: Tier 1 - 基础文档  
**目标受众**: 所有角色（建立共同语言）  
**最后更新**: 2026-01-31  
**版本**: 2.0

---

## 导读

本文档是PonyBunny需求和设计的**术语单一真理来源**（Single Source of Truth）。所有其他文档使用这些术语时必须链接回本文档，而不是重新定义。

**使用规则**：
- ✅ 在代码注释、文档、讨论中使用这些标准术语
- ✅ 遇到歧义时，以本文档定义为准
- ❌ 不要创造新术语或重新定义这些概念

---

## 核心概念（按字母顺序）

### Agent（代理）

**定义**: PonyBunny的AI执行实体，负责自主完成工作订单。

**类型**:
- **Main Agent**: 主Agent，处理用户直接发起的Session
- **Subagent**: 子Agent，由Main Agent委派处理特定子任务
- **Cron Agent**: 定时Agent，执行周期性任务

**不要混淆**:
- ❌ "AI助手" — Agent是主动工作者，不是被动助手
- ❌ "Bot" — Agent有目标驱动和自主决策能力

**相关文档**: [01-ai-employee-paradigm.md](./01-ai-employee-paradigm.md)

---

### Artifact（交付物）

**定义**: Agent执行work item产生的可验证证据，包括代码、文档、测试结果、决策日志等。

**类型**:
| 类型 | 说明 | 示例 |
|:-----|:-----|:-----|
| **Code** | 生成的代码文件 | `src/auth/login.ts` |
| **Patch** | 代码变更补丁 | `feature-login.patch` |
| **Branch** | Git分支 | `feature/user-login` |
| **Test Result** | 测试运行报告 | `test-output.json` |
| **Build Log** | 构建日志 | `build.log` |
| **Decision** | 决策记录 | "为什么选择JWT而非Session" |
| **PR** | Pull Request | GitHub PR #123 |

**存储**: SQLite表 `artifacts`，关联 `run_id`

**用途**:
- 提供可追溯性（问责制）
- 支持Checkpoint/Resume
- 人类审查和批准

**相关文档**: [11-work-order-system.md](./11-work-order-system.md), [01-ai-employee-paradigm.md#问责制模型](./01-ai-employee-paradigm.md#问责制模型)

---

### Autonomy Daemon（自主调度守护进程）

**定义**: PonyBunny的核心调度器，持续从work item队列中选择任务并执行，无需人类干预。

**实现位置**: 基于Cron Lane，配置为周期性触发（默认15分钟）

**核心算法**:
```python
while True:
    work_item = select_next()  # 按优先级+依赖
    run = execute_react_cycle(work_item, budget)
    
    if run.success:
        verify_and_publish()
    elif budget.exhausted:
        escalate_to_human()
    else:
        retry_with_plan_b()
```

**配置参数**:
- `heartbeat_interval_minutes`: 检查频率（默认15分钟）
- `max_concurrent_work_items`: 并发执行的work item上限（默认3）

**相关文档**: [10-autonomous-execution-model.md](./10-autonomous-execution-model.md)

---

### Autonomy Rate（自主完成率）

**定义**: 无需人类干预即完成的work items比例。

**计算公式**:
```
Autonomy Rate = (自主完成的Work Items数) / (总Work Items数) × 100%
```

**判定标准**:
- **自主完成**: 从ready状态到done状态，无escalation记录
- **非自主**: 有任何一次escalation（不论升级原因）

**目标值**: > 70%

**为什么重要**: 这是衡量PonyBunny核心价值（"可放手委派"）的关键指标。

**相关文档**: [00-vision-and-problem.md#成功指标](./00-vision-and-problem.md#成功指标)

---

### Budget（预算）

**定义**: 为goal或work item分配的资源限额，包括Token、时间、金钱成本。

**结构**:
```typescript
interface Budget {
  max_tokens: number;        // 最大Token数
  max_hours: number;         // 最大时长（小时）
  max_cost_usd: number;      // 最大成本（美元）
  max_retries: number;       // 最大重试次数
}
```

**用途**:
- 防止无限循环消耗资源
- 触发escalation（budget耗尽时）
- 成本控制（个人用户月成本<$10）

**继承规则**:
- Work Item默认继承Goal的budget
- 可为特定work item单独设置budget

**相关文档**: [01-ai-employee-paradigm.md#升级触发器](./01-ai-employee-paradigm.md#升级触发器)

---

### Context Pack（上下文快照）

**定义**: work item执行过程中的结构化状态快照，用于支持多日项目的checkpoint/resume。

**结构**:
```typescript
interface ContextPack {
  work_item_id: string;
  created_at: Date;
  
  // 结构化状态（非纯文本）
  state: {
    current_phase: string;
    completed_steps: string[];
    next_planned_steps: string[];
    open_questions: string[];
  };
  
  // 代码相关
  code_context: {
    files_touched: string[];
    key_functions: string[];
    dependencies_added: string[];
  };
  
  // 验证状态
  quality_status: {
    tests_added: number;
    tests_passing: number;
    coverage_delta: number;
    lint_errors: number;
  };
  
  // 紧凑的叙述摘要（Compaction生成）
  narrative_summary: string;
}
```

**与Compaction的区别**:
- **Context Pack**: 结构化快照，保留所有关键状态
- **Compaction**: 对话压缩，减少Token数

**相关文档**: [11-work-order-system.md#context-packs](./11-work-order-system.md#context-packs)

---

### "Done"（完成定义）

**定义**: Work item被标记为完成的条件。

**三层标准**:

#### 1. 功能完成
- 所有计划的代码/文档已生成
- 实现了goal指定的功能

#### 2. 质量验证通过
- 所有确定性Quality Gates通过（tests/build/lint）
- LLM review无critical issues（如果启用）

#### 3. 交付物就绪
- Artifacts已生成并存储
- PR已创建（如适用）
- 文档已更新

**判定规则**:
```typescript
function isDone(workItem: WorkItem): boolean {
  return (
    workItem.planned_actions.all(action => action.completed) &&
    workItem.verification_plan.all(gate => gate.passed) &&
    workItem.artifacts.length > 0
  );
}
```

**反例（不算完成）**:
- ❌ 代码写了但测试失败
- ❌ 功能实现但未生成PR
- ❌ 跳过Quality Gates直接标记

**相关文档**: [01-ai-employee-paradigm.md#问责标准](./01-ai-employee-paradigm.md#问责标准)

---

### Escalation（升级）

**定义**: Agent主动停止执行并请求人类介入的过程。

**不是失败**: 升级是Agent的智能决策，识别出超出自主处理能力的情况。

**触发条件**: 参见 [Escalation Trigger](#escalation-trigger-升级触发器)

**输出**: [Escalation Packet](#escalation-packet-升级包)

**分类**:
| 类型 | 说明 | 示例 | 期望人类响应 |
|:-----|:-----|:-----|:------------|
| **缺失信息** | 需要人类提供数据 | 缺少API Key | 提供信息后恢复 |
| **歧义消除** | 目标定义模糊 | "提升性能"无具体指标 | 澄清目标后重启 |
| **风险批准** | 操作需要批准 | 数据库migration | 批准或拒绝 |
| **能力边界** | 超出AI能力 | 物理设备操作 | 人类接管或调整目标 |

**相关文档**: [01-ai-employee-paradigm.md#升级哲学](./01-ai-employee-paradigm.md#升级哲学)

---

### Escalation Packet（升级包）

**定义**: Agent升级时生成的结构化信息包，包含完整上下文、尝试历史、分析和建议。

**标准结构**: 参见 [01-ai-employee-paradigm.md#escalation-packet的标准](./01-ai-employee-paradigm.md#升级包escalation-packet的标准)

**必须包含**:
1. 问题上下文（work item, goal）
2. 尝试历史（what tried, why failed）
3. 当前状态（artifacts, passing/failing gates, budget）
4. AI分析（root cause, suggested options）
5. 紧急程度（low/medium/high/critical）

**质量标准**:
- ✅ 最小化问题（只问必要信息）
- ✅ 提供3个建议选项（pros/cons）
- ✅ 根因分析（而非症状描述）

**反例**:
- ❌ "出错了，不知道怎么办"（无上下文）
- ❌ "测试失败"（无尝试历史）

---

### Escalation Trigger（升级触发器）

**定义**: 自动触发escalation的条件。

**明确触发条件**:

| 触发器 | 说明 | 阈值 | 示例 |
|:------|:-----|:-----|:-----|
| **重复失败** | 连续相同错误 | 3次 | 同一测试失败3次 |
| **Budget耗尽** | 资源用完 | 95% | Token用了9500/10000 |
| **歧义** | 目标定义模糊 | N/A | "提升性能"无具体指标 |
| **缺失凭证** | 需要外部资源无访问权限 | N/A | 部署需AWS Key但未配置 |
| **风险边界** | 接近安全/合规红线 | N/A | 即将删除生产数据 |
| **能力边界** | 超出AI能力 | N/A | 需要物理设备操作 |

**配置**:
```json
{
  "escalation_policy": {
    "max_retries_per_error_signature": 3,
    "budget_warning_threshold": 0.8,
    "auto_escalate_after_hours": 24,
    "require_approval_for": [
      "database_migration",
      "production_deploy",
      "delete_resources"
    ]
  }
}
```

---

### Goal（目标）

**定义**: 人类设定的高层工作目标，是work order system的顶层实体。

**示例**:
- "实现用户认证功能"
- "提升代码质量到80%测试覆盖率"
- "重构认证模块"

**数据模型**: 参见 [11-work-order-system.md#goals表](./11-work-order-system.md#goals表)

**关键字段**:
- `title`: 简短标题
- `description`: 详细描述
- `success_criteria`: 成功标准（自动生成的DoD）
- `budget`: 资源限额
- `priority`: 优先级（0-100）
- `status`: queued, active, blocked, completed, cancelled

**生命周期**:
```
queued → active → blocked ↔ active → completed
         ↓
      cancelled
```

**与Work Item的关系**: 1个Goal分解为N个Work Items（DAG）

---

### Quality Gate（质量门禁）

**定义**: 自动验证work item输出质量的检查点。

**类型**:

#### 确定性Gates（Deterministic）
优先级高，必须通过：
- **Tests**: `npm test` 退出码 = 0
- **Build**: `npm run build` 成功
- **Lint**: `npm run lint` 0错误
- **Type Check**: `tsc --noEmit` 通过

#### LLM Review Gates（辅助）
优先级低，供参考：
- **Code Smell**: 检测反模式
- **Security Risk**: 识别潜在漏洞
- **Performance**: 性能问题建议

**核心原则**: **LLM判断不能override failing deterministic gates**

**验证流程**:
```
1. 运行所有确定性gates
2. 任一失败 → 标记work item为failed
3. 全部通过 → 运行LLM review（可选）
4. LLM review有风险 → 警告但不阻塞
5. 全部通过 → 标记done
```

**配置**:
```json
{
  "quality_gates": {
    "deterministic_required": true,
    "llm_review_enabled": true,
    "allow_override_failing_tests": false
  }
}
```

**相关文档**: [11-work-order-system.md#quality-gates](./11-work-order-system.md#quality-gates)

---

### Run（执行记录）

**定义**: 单次执行work item的记录，包含开始时间、结束时间、使用的模型、Token数、结果等。

**数据模型**: 参见 [11-work-order-system.md#runs表](./11-work-order-system.md#runs表)

**关键字段**:
- `run_number`: 第N次重试
- `status`: running, success, failed, aborted
- `tokens_used`: Token消耗
- `model_used`: 使用的LLM模型
- `error_signature`: 错误指纹（用于检测重复失败）
- `next_action`: retry, escalate, plan_b, done

**用途**:
- 可追溯性（每次执行都有记录）
- 失败模式检测（error_signature）
- 成本分析（tokens_used）
- Escalation Packet生成（尝试历史）

---

### Shift（工作班次）

**定义**: Agent连续自主工作的时长，类似人类员工的"工作班次"。

**测量方式**: 从接收goal到完成（或升级）的elapsed time

**目标值**: ≥ 8小时

**为什么重要**: 验证"可放手不管"的核心能力。如果Agent只能工作30分钟就需要人类干预，则不符合"AI员工"定位。

**示例**:
- ✅ 早上9点设定goal，下午5点完成（8小时shift）
- ✅ 周一开始5天重构项目，周五交付（120小时shift）
- ❌ 每小时需要人类回答问题（不算shift）

**相关文档**: [00-vision-and-problem.md#成功指标](./00-vision-and-problem.md#成功指标)

---

### Verification Plan（验证计划）

**定义**: work item的自动生成验证方案，定义"如何判断完成"。

**生成时机**: 在work item创建或开始执行时

**结构**:
```typescript
interface VerificationPlan {
  deterministic: Array<{
    type: 'test' | 'build' | 'lint' | 'typecheck';
    command: string;
    mustPass: boolean;
  }>;
  
  behavioral: Array<{
    type: 'flow' | 'integration';
    script: string;
    description: string;
  }>;
  
  llm_review: {
    enabled: boolean;
    aspects: string[];  // ['code_smell', 'security', 'performance']
  };
}
```

**示例**:
```json
{
  "deterministic": [
    { "type": "test", "command": "npm test", "mustPass": true },
    { "type": "build", "command": "npm run build", "mustPass": true },
    { "type": "lint", "command": "npm run lint", "mustPass": true }
  ],
  "behavioral": [
    { "type": "flow", "script": "./scripts/test-login-flow.sh", "description": "验证登录流程" }
  ],
  "llm_review": {
    "enabled": true,
    "aspects": ["code_smell", "security_risk"]
  }
}
```

**相关文档**: [11-work-order-system.md#verification-plan生成](./11-work-order-system.md#verification-plan生成)

---

### Work Item（工作项）

**定义**: goal分解后的可执行任务单元。

**粒度**: 应足够小以在单个execution cycle（<2小时）内完成

**示例**（goal: "实现用户登录"）:
1. Work Item: "创建users数据表schema"
2. Work Item: "实现JWT中间件"
3. Work Item: "编写POST /auth/login端点"
4. Work Item: "添加单元测试"
5. Work Item: "添加集成测试"

**数据模型**: 参见 [11-work-order-system.md#work-items表](./11-work-order-system.md#work-items表)

**关键字段**:
- `type`: code, test, doc, refactor, analysis
- `status`: queued, in_progress, verify, done, failed, blocked
- `dependencies`: 前置work item IDs（支持DAG）
- `verification_plan`: 如何验证完成

**状态机**:
```
queued → in_progress → verify → done
          ↓             ↓
        failed ← ──── blocked
```

---

### Work Order（工作订单）

**定义**: 广义概念，指Goal + 其分解的Work Items + 所有Runs/Artifacts的完整工作包。

**不是单一实体**: Work Order是概念性术语，对应数据库中的goal/work_items/runs/artifacts多表关联。

**用途**: 描述整个自主工作系统的抽象（"Work Order System"）

**类比**: 
- Goal = 客户订单
- Work Items = 订单明细
- Runs = 生产记录
- Artifacts = 交付物

**相关文档**: [11-work-order-system.md](./11-work-order-system.md), [00-vision-and-problem.md](./00-vision-and-problem.md)

---

## 缩写与首字母缩略词

| 缩写 | 全称 | 说明 |
|:-----|:-----|:-----|
| **WO** | Work Order | 工作订单 |
| **WI** | Work Item | 工作项 |
| **QG** | Quality Gate | 质量门禁 |
| **EP** | Escalation Packet | 升级包 |
| **CP** | Context Pack | 上下文快照 |
| **AR** | Autonomy Rate | 自主完成率 |
| **DoD** | Definition of Done | 完成定义 |
| **VP** | Verification Plan | 验证计划 |

---

## 术语使用示例

### ✅ 正确用法

**场景：讨论自主性指标**
```
"我们需要将Autonomy Rate提升到75%。当前的主要问题是
Escalation Trigger太敏感，Budget设置不合理导致频繁升级。"
```

**场景：代码注释**
```typescript
// 生成Escalation Packet并暂停执行
async function escalate(workItem: WorkItem, reason: string) {
  const packet = await generateEscalationPacket(workItem, reason);
  await db.escalations.create(packet);
  await workItem.update({ status: 'blocked' });
}
```

### ❌ 错误用法

**场景：混淆术语**
```
❌ "这个Task的Done标准是什么？"
✅ "这个Work Item的完成定义（Done）是什么？"

❌ "Agent报错了需要人工处理"
✅ "Agent触发了Escalation，生成了Escalation Packet"

❌ "保存当前状态到checkpoint"
✅ "生成Context Pack以支持checkpoint/resume"
```

---

## 术语演进规则

### 新增术语

**流程**:
1. 在本文档中添加定义
2. 提交PR并注明理由
3. 团队审查通过后合并
4. 更新CHANGELOG.md

### 修改现有术语

**限制**: 仅在以下情况修改：
- 原定义有歧义或错误
- 技术实现变化导致定义过时
- 发现与业界标准术语冲突

**流程**: 与新增术语相同，但需要extra审查

### 废弃术语

**流程**:
1. 标记为`@deprecated`
2. 提供替代术语
3. 保留至少2个版本后删除

---

## 文档导航

**前置阅读**:
- [00-vision-and-problem.md](./00-vision-and-problem.md) — 了解核心概念的WHY
- [01-ai-employee-paradigm.md](./01-ai-employee-paradigm.md) — 理解AI员工范式

**术语详细定义**:
- [11-work-order-system.md](./11-work-order-system.md) — Work Order实体模型
- [10-autonomous-execution-model.md](./10-autonomous-execution-model.md) — 执行生命周期
- [12-human-interaction-contracts.md](./12-human-interaction-contracts.md) — 人类交互术语

---

**版本历史**:
- v2.0 (2026-01-31): 从所有文档提取标准术语，建立单一真理来源
- v1.0 (2026-01-15): 初始版本（分散在各文档中）
