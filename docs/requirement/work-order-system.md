# 核心需求：Work Order System（工作订单系统）

## 概述

Work Order System是PonyBunny从"AI助手"转变为"AI员工"的核心架构。它将Agent从被动响应消息转变为主动执行持久化工作订单的自主系统。

---

## 1. 数据模型设计

### 1.1 Goals表（目标）

```sql
CREATE TABLE goals (
  id                UUID PRIMARY KEY,
  owner_id          VARCHAR(255),  -- 谁创建的目标
  title             TEXT NOT NULL,
  description       TEXT,
  priority          INTEGER DEFAULT 50,  -- 0-100
  status            VARCHAR(20),  -- queued, active, blocked, completed, cancelled
  success_criteria  JSON,  -- 自动生成的验收标准
  allowed_actions   JSON,  -- 权限白名单
  budget            JSON,  -- {max_tokens, max_hours, max_cost_usd}
  deadline          TIMESTAMP,
  created_at        TIMESTAMP DEFAULT NOW(),
  completed_at      TIMESTAMP,
  metadata          JSON
);
```

**业务逻辑**：
- 每个Goal代表一个高层目标（如"实现用户认证"）
- `success_criteria`：Agent自动生成的Definition of Done
- `allowed_actions`：该Goal允许的工具/操作（安全控制）
- `budget`：防止无限消耗资源

---

### 1.2 Work Items表（工作项）

```sql
CREATE TABLE work_items (
  id                UUID PRIMARY KEY,
  goal_id           UUID REFERENCES goals(id),
  title             TEXT NOT NULL,
  description       TEXT,
  type              VARCHAR(50),  -- code, test, doc, refactor, analysis
  status            VARCHAR(20),  -- queued, in_progress, verify, done, failed, blocked
  priority          INTEGER,
  dependencies      JSON,  -- [work_item_id...]
  verification_plan JSON,  -- 验证计划
  budget            JSON,  -- 继承goal或自定义
  assigned_to       VARCHAR(50),  -- main_agent, subagent_qa, subagent_refactor
  created_at        TIMESTAMP DEFAULT NOW(),
  started_at        TIMESTAMP,
  completed_at      TIMESTAMP,
  metadata          JSON
);
```

**依赖关系**：
- 使用`dependencies`字段存储前置依赖
- 执行时检查所有依赖是否已完成
- 支持简单的DAG（有向无环图）

---

### 1.3 Runs表（执行记录）

```sql
CREATE TABLE runs (
  id                UUID PRIMARY KEY,
  work_item_id      UUID REFERENCES work_items(id),
  run_number        INTEGER,  -- 第N次重试
  status            VARCHAR(20),  -- running, success, failed, aborted
  started_at        TIMESTAMP,
  ended_at          TIMESTAMP,
  tokens_used       INTEGER,
  model_used        VARCHAR(100),
  artifacts         JSON,  -- 产出物路径
  logs              TEXT,  -- 执行日志
  error_signature   VARCHAR(255),  -- 用于检测重复失败
  next_action       VARCHAR(50),  -- retry, escalate, plan_b, done
  metadata          JSON
);
```

**用途**：
- 记录每次执行的完整信息
- `error_signature`：检测"连续3次相同错误"
- `artifacts`：指向生成的patch、branch、test输出

---

### 1.4 Artifacts表（交付物）

```sql
CREATE TABLE artifacts (
  id                UUID PRIMARY KEY,
  run_id            UUID REFERENCES runs(id),
  type              VARCHAR(50),  -- patch, branch, log, report, test_result
  path              TEXT,  -- 文件系统路径
  content_hash      VARCHAR(64),  -- SHA256
  size_bytes        INTEGER,
  created_at        TIMESTAMP,
  metadata          JSON
);
```

---

### 1.5 Decisions表（决策日志）

```sql
CREATE TABLE decisions (
  id                UUID PRIMARY KEY,
  work_item_id      UUID,
  decision_type     VARCHAR(50),  -- plan_chosen, tool_selected, escalated
  rationale         TEXT,  -- LLM的推理过程
  alternatives      JSON,  -- 考虑过的其他方案
  confidence        FLOAT,  -- 0.0-1.0
  created_at        TIMESTAMP
);
```

---

## 2. Autonomy Daemon（自主调度守护进程）

### 2.1 核心算法

```typescript
async function autonomyDaemonLoop() {
  while (true) {
    // 1. 选择下一个work item
    const workItem = await selectNextWorkItem({
      priorityWeight: 0.6,
      freshnessWeight: 0.2,
      dependencyWeight: 0.2
    });
    
    if (!workItem) {
      await sleep(HEARTBEAT_INTERVAL);  // 15分钟
      continue;
    }
    
    // 2. 检查预算
    const budget = checkBudget(workItem);
    if (budget.exhausted) {
      await escalate(workItem, 'budget_exceeded');
      continue;
    }
    
    // 3. 执行ReAct循环
    const run = await executeWorkCycle(workItem, budget);
    
    // 4. 验证结果
    if (run.status === 'success') {
      const verifyResult = await runQualityGates(run.artifacts);
      
      if (verifyResult.passed) {
        await publishArtifacts(run);
        await markComplete(workItem);
      } else {
        await replanAndRetry(workItem, verifyResult.failures);
      }
    } else if (run.shouldEscalate) {
      await escalate(workItem, run.escalation_packet);
    } else {
      await retryWithPlanB(workItem, run);
    }
    
    // 5. Checkpoint
    await saveContextPack(workItem);
  }
}
```

### 2.2 Work Item选择策略

```typescript
function calculatePriority(item: WorkItem): number {
  const scores = {
    priority: item.priority / 100,  // 0-1
    freshness: Math.min(
      (Date.now() - item.created_at) / (7 * 24 * 3600 * 1000),
      1.0
    ),  // 越旧越urgent
    dependency: item.dependencies.length === 0 ? 1.0 : 0.5  // 无依赖优先
  };
  
  return (
    scores.priority * 0.6 +
    scores.freshness * 0.2 +
    scores.dependency * 0.2
  );
}
```

---

## 3. Quality Gates（质量门禁系统）

### 3.1 Verification Plan生成

```typescript
async function generateVerificationPlan(workItem: WorkItem): Promise<VerificationPlan> {
  // Step 1: 分析目标和仓库约定
  const context = await analyzeRepository();
  
  // Step 2: LLM生成Definition of Done
  const dod = await llm.generate({
    prompt: `
      Goal: ${workItem.goal.title}
      Task: ${workItem.description}
      Repo conventions: ${context.conventions}
      
      Generate a Definition of Done with:
      1. Deterministic checks (tests, build, lint)
      2. Behavioral checks (login flow works)
      3. Documentation requirements
    `
  });
  
  // Step 3: 转换为可执行验证计划
  return {
    deterministic: [
      { type: 'test', command: 'npm test', mustPass: true },
      { type: 'build', command: 'npm run build', mustPass: true },
      { type: 'lint', command: 'npm run lint', mustPass: true },
      { type: 'typecheck', command: 'tsc --noEmit', mustPass: true }
    ],
    behavioral: [
      { type: 'flow', script: './scripts/test-login-flow.sh' }
    ],
    llm_review: {
      enabled: true,
      aspects: ['code_smell', 'security_risk', 'performance']
    }
  };
}
```

### 3.2 执行验证

```typescript
async function runQualityGates(artifacts: Artifact[]): Promise<VerificationResult> {
  const plan = artifacts[0].verification_plan;
  const results = { passed: [], failed: [] };
  
  // 确定性检查（优先）
  for (const gate of plan.deterministic) {
    const result = await execInSandbox(gate.command);
    
    if (result.exitCode !== 0 && gate.mustPass) {
      results.failed.push({
        gate: gate.type,
        error: result.stderr,
        output: result.stdout
      });
    } else {
      results.passed.push(gate.type);
    }
  }
  
  // 如果确定性检查全部通过，才运行LLM review
  if (results.failed.length === 0) {
    const llmReview = await runLLMReview(artifacts);
    if (llmReview.hasRisks) {
      results.failed.push({
        gate: 'llm_review',
        error: llmReview.risks.join('; ')
      });
    }
  }
  
  return {
    passed: results.failed.length === 0,
    failures: results.failed,
    details: results
  };
}
```

---

## 4. Escalation Packet（升级包）

### 4.1 数据结构

```typescript
interface EscalationPacket {
  work_item: {
    id: string;
    title: string;
    goal: string;
  };
  
  // 尝试过的方案
  attempts: Array<{
    run_id: string;
    strategy: string;
    what_tried: string[];
    why_failed: string;
    error_signature: string;
  }>;
  
  // 当前状态
  current_state: {
    artifacts: Artifact[];
    passing_gates: string[];
    failing_gates: string[];
    budget_remaining: Budget;
  };
  
  // AI建议的选项
  suggested_options: Array<{
    option: string;  // "A", "B", "C"
    description: string;
    pros: string[];
    cons: string[];
    estimated_effort: string;
  }>;
  
  // 最小化问题
  minimal_question: string;
  
  // 紧急程度
  urgency: 'low' | 'medium' | 'high' | 'critical';
}
```

### 4.2 生成策略

```typescript
async function generateEscalationPacket(workItem: WorkItem, reason: string): Promise<EscalationPacket> {
  const recentRuns = await db.runs.findAll({
    where: { work_item_id: workItem.id },
    order: [['created_at', 'DESC']],
    limit: 5
  });
  
  // 检测重复失败模式
  const errorSignatures = recentRuns.map(r => r.error_signature);
  const isStuck = new Set(errorSignatures).size === 1 && errorSignatures.length >= 3;
  
  // LLM生成分析和建议
  const analysis = await llm.generate({
    prompt: `
      Task: ${workItem.description}
      Recent attempts: ${JSON.stringify(recentRuns.map(r => ({
        strategy: r.metadata.strategy,
        error: r.logs
      })))}
      
      Generate:
      1. Root cause analysis
      2. 3 alternative options with pros/cons
      3. A minimal question to unblock (if human input needed)
    `
  });
  
  return {
    work_item: { ... },
    attempts: recentRuns.map(formatAttempt),
    current_state: await getCurrentState(workItem),
    suggested_options: analysis.options,
    minimal_question: analysis.question,
    urgency: isStuck ? 'high' : 'medium'
  };
}
```

---

## 5. Context Packs（上下文快照）

### 5.1 结构设计

```typescript
interface ContextPack {
  work_item_id: string;
  created_at: Date;
  
  // 结构化状态（非纯文本）
  state: {
    current_phase: string;  // 'planning' | 'implementing' | 'testing' | 'documenting'
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
  
  // 紧凑的叙述摘要
  narrative_summary: string;  // Compaction生成
}
```

### 5.2 生成与恢复

```typescript
async function createContextPack(workItem: WorkItem): Promise<ContextPack> {
  const recentRuns = await getRecentRuns(workItem.id);
  const artifacts = await getArtifacts(recentRuns);
  
  return {
    work_item_id: workItem.id,
    created_at: new Date(),
    state: extractStructuredState(recentRuns),
    code_context: analyzeCodeChanges(artifacts),
    quality_status: extractQualityMetrics(artifacts),
    narrative_summary: await compactConversation(recentRuns)
  };
}

async function restoreFromContextPack(pack: ContextPack): Promise<WorkContext> {
  // 重建Agent的工作上下文
  return {
    background: pack.narrative_summary,
    current_state: pack.state,
    files_to_focus: pack.code_context.files_touched,
    quality_baseline: pack.quality_status,
    next_actions: pack.state.next_planned_steps
  };
}
```

---

## 6. 实现优先级

### Phase 1: MVP（Week 1-2）

**核心交付**：
- [x] 数据模型（goals, work_items, runs表）
- [x] Autonomy Daemon基础循环
- [x] 简单的Quality Gates（仅test/build/lint）
- [x] 基础Escalation策略

**验证场景**：
```
Goal: "添加health check端点"
→ Agent分解为work items
→ 自主编码 + 测试
→ 通过gates后标记完成
```

---

### Phase 2: 质量增强（Week 3-4）

**核心交付**：
- [x] Verification Plan自动生成
- [x] 多层retry机制
- [x] Context Packs（结构化）
- [x] Escalation Packet完整实现

**验证场景**：
```
Goal: "实现JWT认证"
→ 中途遇到错误（缺少secret配置）
→ 自动重试2次
→ 生成Escalation Packet升级给人类
→ 人类提供secret后恢复执行
```

---

### Phase 3: 多日持久化（Week 5-8）

**核心交付**：
- [x] Daily Rollup机制
- [x] Artifacts完整管理
- [x] Decisions Log
- [x] Checkpoint/Resume

**验证场景**：
```
Goal: "重构认证模块"（5天）
→ Day 1: 分析并生成plan
→ Day 2-4: 逐步重构（每天checkpoint）
→ Day 5: 完成并生成PR
```

---

## 7. 配置示例

```json
{
  "work_order_system": {
    "enabled": true,
    "autonomy_daemon": {
      "heartbeat_interval_minutes": 15,
      "max_concurrent_work_items": 3
    },
    "quality_gates": {
      "deterministic_required": true,
      "llm_review_enabled": true,
      "allow_override_failing_tests": false
    },
    "escalation_policy": {
      "max_retries_per_error_signature": 3,
      "auto_escalate_after_hours": 24,
      "require_approval_for": [
        "database_migration",
        "production_deploy",
        "delete_resources"
      ]
    },
    "persistence": {
      "context_pack_frequency": "every_run",
      "artifacts_retention_days": 90,
      "daily_rollup_hour": 2
    }
  }
}
```

---

## 总结

Work Order System是PonyBunny的"大脑"，它将Agent从被动工具转变为主动工作者：

1. **持久化目标**：Goals表存储长期目标
2. **自主调度**：Autonomy Daemon持续选择和执行任务
3. **质量保证**：确定性验证 + LLM辅助
4. **智能升级**：结构化Escalation Packet
5. **多日记忆**：Context Packs支持长期项目

这不是增量改进，而是**架构范式的转变**。
