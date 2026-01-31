# 自主执行模型 (Autonomous Execution Model)

**文档状态**: Tier 2 - 能力文档  
**目标受众**: 产品经理、架构师、开发工程师  
**最后更新**: 2026-01-31  
**版本**: 2.0

---

## 导读

本文档定义PonyBunny **自主性的核心机制**——从接收目标到交付结果的完整生命周期。它是概念性的（不锁定实现细节），描述"自主执行如何从根本上运作"。

阅读本文档后，你应该理解：Work Order从创建到完成经历哪些阶段？Agent在每个阶段做什么决策？

**前置阅读**:
- [00-vision-and-problem.md](./00-vision-and-problem.md) — 理解"自主完成"的定义
- [01-ai-employee-paradigm.md](./01-ai-employee-paradigm.md) — 理解AI责任边界

---

## 核心概念：自主执行的本质

### 什么是"自主执行"？

**定义**: Agent从接收高层目标到交付验证结果的全过程，只在明确定义的触发点请求人类介入。

**与传统执行的区别**:

| 特征 | 传统执行（如CI/CD） | 自主执行（PonyBunny） |
|:-----|:-------------------|:---------------------|
| **目标输入** | 详细脚本/配置 | 高层目标（自然语言） |
| **任务分解** | 人类预定义 | **Agent动态分解** |
| **错误处理** | 失败即停止 | **自主重试+Plan B** |
| **质量验证** | 外部触发 | **自动生成+执行** |
| **升级决策** | 无智能判断 | **基于规则自动升级** |

### 自主执行的三大支柱

1. **目标驱动（Goal-Driven）**: 从"做X"而非"执行步骤1,2,3"开始
2. **反馈循环（Feedback Loop）**: Observation → Thought → Action → Verify
3. **持久状态（Persistent State）**: 跨天/跨周保持工作上下文

---

## 完整生命周期（8个阶段）

```
1. Goal Intake（目标接收）
   ↓
2. Goal Elaboration（目标细化）
   ↓
3. Planning（规划分解）
   ↓
4. Execution Loop（执行循环）
   ├─ 4.1 Work Item Selection
   ├─ 4.2 ReAct Cycle
   ├─ 4.3 Tool Invocation
   └─ 4.4 Error Recovery
   ↓
5. Verification（质量验证）
   ├─ 5.1 Deterministic Gates
   └─ 5.2 LLM Review
   ↓
6. Evaluation（结果评估）
   ├─ 达标 → 7. Publish
   └─ 未达标 → Escalate or Retry
   ↓
7. Publish（交付发布）
   ↓
8. Monitor（持续监控）
```

---

## 阶段1: Goal Intake（目标接收）

### 输入形式

**人类提供**:
```json
{
  "title": "实现用户登录功能",
  "description": "使用JWT认证，支持邮箱+密码登录，测试覆盖率>80%",
  "priority": 80,
  "budget": {
    "max_tokens": 50000,
    "max_hours": 4,
    "max_cost_usd": 2.0
  },
  "deadline": "2026-02-05T18:00:00Z"
}
```

### Agent处理

**步骤**:
1. **验证输入**:
   - 检查title非空
   - 验证budget格式正确
   - 确认priority在0-100范围

2. **生成goal_id**: UUID

3. **初始化状态**:
   ```sql
   INSERT INTO goals (id, title, status, budget, ...)
   VALUES ('uuid-xxx', '实现用户登录功能', 'queued', {...}, ...);
   ```

4. **触发下一阶段**: Goal Elaboration

**输出**: Goal记录（status=queued）

---

## 阶段2: Goal Elaboration（目标细化）

### 目的

将模糊的高层目标转化为明确的、可验证的工作定义。

### Agent分析

**输入**: Goal title + description

**LLM Prompt**:
```
Goal: "实现用户登录功能"
Description: "使用JWT认证，支持邮箱+密码登录，测试覆盖率>80%"

请分析：
1. 涉及哪些技术组件？
2. 有哪些隐含需求？
3. Success Criteria是什么？
4. Allowed Actions需要哪些权限？
```

**LLM输出**:
```json
{
  "components": ["database", "auth_middleware", "api_endpoint", "tests"],
  "implicit_requirements": [
    "密码需要加密存储（bcrypt）",
    "JWT token有效期设置",
    "登录失败限流"
  ],
  "success_criteria": [
    "POST /auth/login返回200 + JWT token",
    "测试覆盖率 >= 80%",
    "Build成功",
    "Lint clean"
  ],
  "allowed_actions": [
    "read_file", "write_file", "run_test", "create_migration"
  ]
}
```

### Agent更新Goal

```sql
UPDATE goals SET
  success_criteria = {...},
  allowed_actions = {...},
  status = 'active'
WHERE id = 'uuid-xxx';
```

**输出**: Goal记录（status=active, success_criteria已生成）

---

## 阶段3: Planning（规划分解）

### 目的

将goal分解为可执行的work items（DAG）。

### Agent分解策略

**原则**:
- 每个work item应在2小时内完成
- 识别明确的依赖关系
- 按type分类（code, test, doc, refactor）

**示例分解**（goal: "实现用户登录功能"）:

```
Work Item 1 (type=code, priority=90):
  title: "创建users表schema"
  dependencies: []
  estimated_effort: "S"

Work Item 2 (type=code, priority=85):
  title: "实现JWT中间件"
  dependencies: [WI-1]
  estimated_effort: "M"

Work Item 3 (type=code, priority=85):
  title: "实现POST /auth/login端点"
  dependencies: [WI-1, WI-2]
  estimated_effort: "M"

Work Item 4 (type=test, priority=80):
  title: "编写单元测试"
  dependencies: [WI-2, WI-3]
  estimated_effort: "M"

Work Item 5 (type=test, priority=75):
  title: "编写集成测试"
  dependencies: [WI-3, WI-4]
  estimated_effort: "S"
```

### 依赖图（DAG）

```
WI-1 (users表)
 ├─→ WI-2 (JWT中间件)
 │    ├─→ WI-3 (login端点)
 │    │    ├─→ WI-4 (单元测试)
 │    │    └─→ WI-5 (集成测试)
 │    └─→ WI-4
 └─→ WI-3
```

### 输出

```sql
INSERT INTO work_items (id, goal_id, title, dependencies, status, ...)
VALUES 
  ('wi-1', 'goal-xxx', '创建users表schema', '[]', 'ready', ...),
  ('wi-2', 'goal-xxx', '实现JWT中间件', '["wi-1"]', 'queued', ...),
  ...;
```

**状态转换**: Goal remains `active`, Work Items created (`ready` or `queued`)

---

## 阶段4: Execution Loop（执行循环）

### 核心机制：Autonomy Daemon

**实现位置**: 基于Cron Lane，周期性触发（默认15分钟）

**伪代码**:
```python
while True:
    # 4.1 Work Item Selection
    work_item = select_next_ready_work_item()
    
    if not work_item:
        sleep(HEARTBEAT_INTERVAL)
        continue
    
    # Budget Check
    if work_item.budget.exhausted:
        escalate(work_item, reason='budget_exceeded')
        continue
    
    # Mark in-progress
    work_item.update(status='in_progress')
    
    try:
        # 4.2 ReAct Cycle
        run = execute_react_cycle(work_item)
        
        # 4.3 Tool Invocation (内部细节)
        # ... Agent调用read_file, write_file等工具 ...
        
        # 4.4 Error Recovery
        if run.failed:
            handle_error(run, work_item)
        elif run.success:
            work_item.update(status='verify')
            proceed_to_verification(work_item, run)
    
    except Exception as e:
        # 4.4 Error Recovery
        handle_exception(work_item, e)
    
    # 5. Checkpoint
    save_context_pack(work_item)
```

### 4.1 Work Item Selection（选择策略）

**算法**:
```typescript
function selectNextWorkItem(): WorkItem | null {
  const candidates = db.work_items.findAll({
    status: 'ready',  // 所有依赖已完成
    goal_status: 'active'
  });
  
  if (candidates.length === 0) return null;
  
  // 按综合优先级排序
  return candidates.sort((a, b) => {
    const scoreA = calculatePriority(a);
    const scoreB = calculatePriority(b);
    return scoreB - scoreA;
  })[0];
}

function calculatePriority(item: WorkItem): number {
  return (
    item.priority * 0.6 +           // 显式优先级
    freshnessScore(item) * 0.2 +    // 越旧越紧急
    dependencyScore(item) * 0.2     // 无依赖优先
  );
}
```

**状态转换**:
```
queued → ready (当所有dependencies完成)
ready → in_progress (被Daemon选中)
```

### 4.2 ReAct Cycle（推理-行动循环）

**模式**: Observation → Thought → Action → Observation ...

**示例**（work item: "创建users表schema"）:

```
Cycle 1:
  Observation: 需要创建users表，支持邮箱+密码登录
  Thought: 先检查现有数据库schema，确定表是否已存在
  Action: read_file("db/schema.sql")
  Result: 文件不存在，需要创建

Cycle 2:
  Observation: 数据库schema文件为空，需要设计users表结构
  Thought: 需要字段：id, email, password_hash, created_at
  Action: write_file("db/migrations/001_create_users.sql", "CREATE TABLE...")
  Result: 文件已创建

Cycle 3:
  Observation: Migration文件已创建
  Thought: 应该验证SQL语法正确性
  Action: run_command("sqlite3 :memory: < db/migrations/001_create_users.sql")
  Result: 执行成功，语法正确

Cycle 4:
  Observation: Migration验证通过
  Thought: Work item完成，标记为verify状态
  Action: mark_complete()
  Result: Work item → verify状态
```

**终止条件**:
- ✅ Work item目标达成（进入verify阶段）
- ❌ Budget耗尽（escalate）
- ❌ 连续3次相同错误（escalate）
- ❌ 超时（escalate）

### 4.3 Tool Invocation（工具调用）

**工具白名单**（work item的allowed_actions继承自goal）:
```json
{
  "allowed_actions": [
    "read_file",
    "write_file",
    "run_test",
    "create_branch",
    "run_command"
  ]
}
```

**权限检查**:
```typescript
async function invokeTool(tool: string, args: any): Promise<any> {
  // 检查1: 工具在白名单？
  if (!work_item.goal.allowed_actions.includes(tool)) {
    throw new Error(`Tool ${tool} not in allowlist`);
  }
  
  // 检查2: 沙箱隔离（如果是命令执行）
  if (tool === 'run_command') {
    return execInDockerSandbox(args.command);
  }
  
  // 执行工具
  return await tools[tool](args);
}
```

### 4.4 Error Recovery（错误恢复）

**四层恢复机制**:

```
Error发生
  ↓
Tier 1: Auto-Retry (同策略，<3次)
  → 成功 → 继续
  → 失败3次 → Tier 2
  ↓
Tier 2: Model Failover (切换LLM模型)
  → 成功 → 继续
  → 失败 → Tier 3
  ↓
Tier 3: Plan B (切换策略)
  → 成功 → 继续
  → 失败 → Tier 4
  ↓
Tier 4: Escalation (生成Escalation Packet)
```

**错误指纹（Error Signature）**:
```typescript
function generateErrorSignature(error: Error): string {
  // 提取关键信息，忽略细节
  return hash({
    type: error.name,
    message: normalizeMessage(error.message),
    context: work_item.type
  });
}

// 检测重复失败
function isStuck(work_item: WorkItem): boolean {
  const recentRuns = getRecentRuns(work_item, limit=5);
  const signatures = recentRuns.map(r => r.error_signature);
  
  // 连续3次相同错误
  return signatures.slice(0, 3).every(s => s === signatures[0]);
}
```

**Plan B示例**:
```
原策略: 使用ORM生成migration
  ↓ 失败（ORM不支持某特性）
Plan B: 手写SQL migration文件
  ↓ 成功
```

---

## 阶段5: Verification（质量验证）

### 5.1 Deterministic Gates（确定性门禁）

**优先级**: 最高，必须通过

**类型**:

| Gate类型 | 命令 | 必须通过 | 失败处理 |
|:---------|:-----|:---------|:---------|
| **Tests** | `npm test` | ✅ Yes | 标记failed，replan |
| **Build** | `npm run build` | ✅ Yes | 标记failed，replan |
| **Lint** | `npm run lint` | ✅ Yes | 标记failed，replan |
| **Type Check** | `tsc --noEmit` | ✅ Yes | 标记failed，replan |

**执行流程**:
```typescript
async function runDeterministicGates(work_item: WorkItem): Promise<GateResult> {
  const plan = work_item.verification_plan.deterministic;
  const results = [];
  
  for (const gate of plan) {
    const result = await execInSandbox(gate.command);
    
    if (result.exitCode !== 0 && gate.mustPass) {
      return {
        passed: false,
        failed_gate: gate.type,
        error: result.stderr,
        next_action: 'replan_and_retry'
      };
    }
    
    results.push({ gate: gate.type, passed: true });
  }
  
  return { passed: true, results };
}
```

### 5.2 LLM Review Gates（辅助验证）

**优先级**: 低，仅供参考

**触发条件**: 所有确定性gates通过后

**方面**:
- **Code Smell**: 检测反模式（如大量重复代码）
- **Security Risk**: 识别潜在漏洞（如SQL注入）
- **Performance**: 性能问题建议（如N+1查询）

**核心原则**: **LLM Review不能override failing deterministic gates**

**示例**:
```
Deterministic Gates: ✅ All Passed
LLM Review:
  - Code Smell: ⚠️ "JWT secret硬编码，建议使用环境变量"
  - Security: ✅ No critical issues
  - Performance: ✅ No issues

Action: 标记为done（警告不阻塞），但记录建议到Decisions表
```

---

## 阶段6: Evaluation（结果评估）

### 评估标准

**达标条件** (所有满足):
- ✅ 所有确定性gates通过
- ✅ Artifacts已生成
- ✅ Work item目标达成

**评估逻辑**:
```typescript
function evaluateWorkItem(work_item: WorkItem, run: Run): EvaluationResult {
  // 检查1: Quality Gates
  if (!run.quality_gates.all_passed) {
    return {
      status: 'failed',
      reason: `Quality gate failed: ${run.quality_gates.failed_gates.join(', ')}`,
      next_action: 'replan_and_retry'
    };
  }
  
  // 检查2: Artifacts
  if (run.artifacts.length === 0) {
    return {
      status: 'incomplete',
      reason: 'No artifacts generated',
      next_action: 'retry'
    };
  }
  
  // 检查3: Success Criteria（从Goal继承）
  const criteria_met = checkSuccessCriteria(work_item.goal, run.artifacts);
  if (!criteria_met.all_passed) {
    return {
      status: 'incomplete',
      reason: `Criteria not met: ${criteria_met.failed.join(', ')}`,
      next_action: 'replan'
    };
  }
  
  // 全部通过
  return {
    status: 'done',
    next_action: 'publish'
  };
}
```

### 决策分支

```
评估结果
  ├─ 达标 → 7. Publish Artifacts
  ├─ 未达标 + Budget充足 → Replan and Retry
  └─ 未达标 + Budget耗尽 → Escalate
```

---

## 阶段7: Publish（交付发布）

### 发布内容

**Artifacts打包**:
```json
{
  "work_item_id": "wi-123",
  "artifacts": [
    {
      "type": "code",
      "path": "db/migrations/001_create_users.sql",
      "hash": "sha256-xxx"
    },
    {
      "type": "branch",
      "name": "feature/user-login-wi-123"
    },
    {
      "type": "test_result",
      "path": "test-output.json",
      "summary": "12/12 passed"
    }
  ],
  "quality_report": {
    "tests_passed": 12,
    "coverage": 85,
    "lint_errors": 0
  }
}
```

### 状态更新

```sql
-- Work Item标记完成
UPDATE work_items SET
  status = 'done',
  completed_at = NOW()
WHERE id = 'wi-123';

-- 检查Goal是否所有Work Items完成
SELECT COUNT(*) FROM work_items
WHERE goal_id = 'goal-xxx' AND status != 'done';

-- 如果全部完成，更新Goal
UPDATE goals SET
  status = 'completed',
  completed_at = NOW()
WHERE id = 'goal-xxx' AND (
  SELECT COUNT(*) FROM work_items WHERE goal_id = 'goal-xxx' AND status != 'done'
) = 0;
```

### 通知人类

**场景**: Goal完成时

**内容**:
```
Goal Completed: "实现用户登录功能"
Duration: 2.5 hours
Work Items: 5/5 completed
Artifacts:
  - PR #123: feature/user-login
  - Test Coverage: 85%
  - Cost: $1.20 (budget: $2.00)

Next Steps:
  - Review PR #123
  - Approve DB migration
```

---

## 阶段8: Monitor（持续监控）

### 长期监控（可选）

**场景**: Recurring Goals（如"每周代码质量检查"）

**机制**: Cron Lane定期触发

**示例**:
```json
{
  "goal_type": "recurring",
  "schedule": "0 9 * * 1",  // 每周一9点
  "template": {
    "title": "Weekly code quality check",
    "success_criteria": [
      "Lint violations < 10",
      "Test coverage >= 80%",
      "No critical security issues"
    ]
  }
}
```

---

## 状态机（完整视图）

### Goal状态机

```
queued → active → blocked ↔ active → completed
         ↓
      cancelled
```

### Work Item状态机

```
queued → ready → in_progress → verify → done
                    ↓            ↓
                  failed  ←  ←  ← 
                    ↓
                 blocked → escalated
```

### Run状态机

```
running → success → done
  ↓
failed → retry
  ↓
aborted
```

---

## 进度语义（Progress Semantics）

### 如何计算Goal进度？

```typescript
function calculateGoalProgress(goal: Goal): number {
  const work_items = getWorkItems(goal);
  const total_effort = work_items.reduce((sum, wi) => sum + wi.estimated_effort_points, 0);
  const completed_effort = work_items
    .filter(wi => wi.status === 'done')
    .reduce((sum, wi) => sum + wi.estimated_effort_points, 0);
  
  return completed_effort / total_effort;
}
```

**Effort Points映射**:
```
S (Small) = 1 point
M (Medium) = 3 points
L (Large) = 5 points
```

**示例**:
```
Goal: "实现用户登录功能"
Work Items:
  - WI-1 (S, done): 1 point
  - WI-2 (M, done): 3 points
  - WI-3 (M, in_progress): 3 points
  - WI-4 (M, queued): 3 points
  - WI-5 (S, queued): 1 point

Total: 11 points
Completed: 4 points
Progress: 36%
```

---

## Checkpoint与Resume

### Context Pack生成

**时机**: 每个work item完成后

**内容**: 参见 [02-glossary-and-terminology.md#context-pack](./02-glossary-and-terminology.md#context-pack-上下文快照)

### Resume逻辑

**场景**: Agent重启或跨天恢复

**流程**:
```typescript
async function resumeWork() {
  // 1. 查找所有in_progress的work items
  const active_items = db.work_items.findAll({
    status: 'in_progress'
  });
  
  // 2. 加载最新Context Pack
  for (const item of active_items) {
    const context = await loadLatestContextPack(item);
    
    // 3. 恢复执行（从中断点继续）
    await continueExecution(item, context);
  }
}
```

---

## 文档导航

**前置阅读**:
- [00-vision-and-problem.md](./00-vision-and-problem.md) — 理解"自主完成"
- [01-ai-employee-paradigm.md](./01-ai-employee-paradigm.md) — 责任边界

**下一步阅读**:
- [11-work-order-system.md](./11-work-order-system.md) — 实体模型和不变量
- [12-human-interaction-contracts.md](./12-human-interaction-contracts.md) — 人类交互接触点

**实现参考**:
- [../engineering/scheduling.md](../engineering/scheduling.md) — Lane调度实现
- [work-order-system.md](./work-order-system.md) — 详细算法（待整合）

---

**版本历史**:
- v2.0 (2026-01-31): 从work-order-system.md拆分生命周期机制，建立概念性执行模型
- v1.0 (2026-01-15): 初始版本（已整合到work-order-system.md）
