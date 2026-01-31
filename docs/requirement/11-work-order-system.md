# Work Order System (工作订单系统)

**文档状态**: Tier 2 - 能力文档  
**目标受众**: 架构师、开发工程师  
**最后更新**: 2026-01-31  
**版本**: 2.0

---

## 导读

本文档定义PonyBunny的**"工作会计系统"**——如何表示、存储和追踪自主工作。它描述实体模型、不变量、关系，以及可追溯性/幂等性/可恢复性的保证。

阅读本文档后，你应该理解：Goals/Work Items/Runs/Artifacts的关系？数据完整性如何保证？

**前置阅读**:
- [02-glossary-and-terminology.md](./02-glossary-and-terminology.md) — 术语定义
- [10-autonomous-execution-model.md](./10-autonomous-execution-model.md) — 生命周期机制

---

## 核心概念：Work Order System的作用

### 为什么需要Work Order System？

**问题**: 传统AI助手是无状态的，每次对话从零开始。

**解决**: Work Order System提供：
1. **持久化目标**：Goals表存储长期目标
2. **可追溯性**：Runs表记录每次执行
3. **问责制**：Artifacts和Decisions表作为证据
4. **可恢复性**：Context Packs支持跨天恢复

**类比**: 就像公司的项目管理系统（Jira/Linear），但AI自己使用。

---

## 实体关系图（Entity Relationship Diagram）

```
┌─────────────────┐
│ Goals           │ 1:N
│ ─────────────── │──────┐
│ id (PK)         │      │
│ title           │      │
│ success_criteria│      │
│ budget          │      │
│ status          │      ↓ goal_id (FK)
└─────────────────┘   ┌──────────────────┐
                      │ Work Items        │ 1:N
                      │ ───────────────── │──────┐
                      │ id (PK)           │      │
                      │ goal_id (FK)      │      │
                      │ dependencies      │      │
                      │ verification_plan │      ↓ work_item_id (FK)
                      └──────────────────┘   ┌──────────────────┐
                                             │ Runs              │ 1:N
                                             │ ───────────────── │──────┐
                                             │ id (PK)           │      │
                                             │ work_item_id (FK) │      │
                                             │ error_signature   │      │
                                             │ next_action       │      ↓ run_id (FK)
                                             └──────────────────┘   ┌──────────────────┐
                                                                    │ Artifacts         │
                                                                    │ ───────────────── │
                                                                    │ id (PK)           │
                                                                    │ run_id (FK)       │
                                                                    │ type              │
                                                                    │ path              │
                                                                    │ content_hash      │
                                                                    └──────────────────┘
                      ┌──────────────────┐
                      │ Decisions         │
                      │ ───────────────── │
                      │ id (PK)           │
                      │ work_item_id (FK) │
                      │ rationale         │
                      │ alternatives      │
                      └──────────────────┘
                      
                      ┌──────────────────┐
                      │ Escalations       │
                      │ ───────────────── │
                      │ id (PK)           │
                      │ work_item_id (FK) │
                      │ packet (JSON)     │
                      │ resolved_at       │
                      └──────────────────┘
```

---

## 实体模型详细定义

### 1. Goals表（目标）

**用途**: 存储人类设定的高层工作目标

**Schema**:
```sql
CREATE TABLE goals (
  -- 主键
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- 基本信息
  owner_id          VARCHAR(255),        -- 创建者ID
  title             TEXT NOT NULL,        -- 简短标题
  description       TEXT,                 -- 详细描述
  
  -- 优先级与状态
  priority          INTEGER DEFAULT 50,   -- 0-100
  status            VARCHAR(20) NOT NULL, -- queued, active, blocked, completed, cancelled
  
  -- 验收与权限
  success_criteria  JSON NOT NULL,        -- 自动生成的Definition of Done
  allowed_actions   JSON NOT NULL,        -- 工具白名单
  
  -- 资源限制
  budget            JSON NOT NULL,        -- {max_tokens, max_hours, max_cost_usd, max_retries}
  deadline          TIMESTAMP,
  
  -- 审计
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW(),
  completed_at      TIMESTAMP,
  
  -- 元数据
  metadata          JSON DEFAULT '{}'     -- 扩展字段
);

-- 索引
CREATE INDEX idx_goals_status ON goals(status);
CREATE INDEX idx_goals_owner ON goals(owner_id);
CREATE INDEX idx_goals_priority ON goals(priority DESC);
```

**字段说明**:

| 字段 | 类型 | 说明 | 示例 |
|:-----|:-----|:-----|:-----|
| `success_criteria` | JSON Array | AI生成的完成标准 | `[{"description": "Tests pass", "type": "deterministic"}]` |
| `allowed_actions` | JSON Array | 工具白名单 | `["read_file", "write_file", "run_test"]` |
| `budget.max_tokens` | Integer | Token上限 | `50000` |
| `budget.max_hours` | Float | 时长上限（小时） | `4.0` |
| `budget.max_cost_usd` | Float | 成本上限（美元） | `2.0` |
| `budget.max_retries` | Integer | 重试上限 | `3` |

**状态机**:
```
queued → active → blocked ↔ active → completed
         ↓
      cancelled
```

**不变量**:
- ✅ `title`不能为空
- ✅ `success_criteria`至少有1个条件
- ✅ `allowed_actions`至少有1个工具（否则无法执行）
- ✅ `budget.max_tokens > 0`
- ✅ `status`只能是预定义值

---

### 2. Work Items表（工作项）

**用途**: 存储goal分解后的可执行任务

**Schema**:
```sql
CREATE TABLE work_items (
  -- 主键与外键
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id           UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  
  -- 基本信息
  title             TEXT NOT NULL,
  description       TEXT,
  type              VARCHAR(50) NOT NULL, -- code, test, doc, refactor, analysis
  
  -- 状态与优先级
  status            VARCHAR(20) NOT NULL, -- queued, ready, in_progress, verify, done, failed, blocked
  priority          INTEGER DEFAULT 50,
  
  -- 依赖关系（DAG）
  dependencies      JSON DEFAULT '[]',    -- [work_item_id...]
  
  -- 验证计划
  verification_plan JSON NOT NULL,        -- 如何判断完成
  
  -- 资源分配
  budget            JSON,                 -- 继承goal或自定义
  assigned_to       VARCHAR(50),          -- main_agent, subagent_qa, subagent_refactor
  
  -- 时间戳
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW(),
  started_at        TIMESTAMP,
  completed_at      TIMESTAMP,
  
  -- 元数据
  estimated_effort  VARCHAR(10),          -- S, M, L
  metadata          JSON DEFAULT '{}'
);

-- 索引
CREATE INDEX idx_work_items_goal ON work_items(goal_id);
CREATE INDEX idx_work_items_status ON work_items(status);
CREATE INDEX idx_work_items_priority ON work_items(priority DESC);
```

**字段说明**:

| 字段 | 类型 | 说明 | 示例 |
|:-----|:-----|:-----|:-----|
| `type` | Enum | 任务类型 | `code`, `test`, `doc`, `refactor`, `analysis` |
| `dependencies` | JSON Array | 前置work item IDs | `["wi-1", "wi-2"]` |
| `verification_plan` | JSON Object | 验证方案 | 见下文 |
| `estimated_effort` | Enum | 估算工作量 | `S` (1h), `M` (2-4h), `L` (>4h) |

**verification_plan结构**:
```json
{
  "deterministic": [
    { "type": "test", "command": "npm test", "mustPass": true },
    { "type": "build", "command": "npm run build", "mustPass": true },
    { "type": "lint", "command": "npm run lint", "mustPass": true }
  ],
  "behavioral": [
    { "type": "flow", "script": "./scripts/test-login-flow.sh" }
  ],
  "llm_review": {
    "enabled": true,
    "aspects": ["code_smell", "security_risk", "performance"]
  }
}
```

**状态机**:
```
queued → ready → in_progress → verify → done
                    ↓            ↓
                  failed  ←  ←  ← 
                    ↓
                 blocked → escalated
```

**不变量**:
- ✅ `goal_id`必须引用存在的goal
- ✅ `dependencies`中的ID必须引用存在的work items
- ✅ 不能有循环依赖（必须是DAG）
- ✅ `status=ready` 当且仅当所有dependencies的status=done
- ✅ `verification_plan.deterministic`至少有1个gate

---

### 3. Runs表（执行记录）

**用途**: 记录每次执行work item的详细信息

**Schema**:
```sql
CREATE TABLE runs (
  -- 主键与外键
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id      UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  
  -- 执行序号
  run_number        INTEGER NOT NULL, -- 第N次重试
  
  -- 状态
  status            VARCHAR(20) NOT NULL, -- running, success, failed, aborted
  
  -- 时间
  started_at        TIMESTAMP DEFAULT NOW(),
  ended_at          TIMESTAMP,
  
  -- 资源使用
  tokens_used       INTEGER DEFAULT 0,
  cost_usd          DECIMAL(10,4) DEFAULT 0,
  model_used        VARCHAR(100),
  
  -- 输出
  artifacts         JSON DEFAULT '[]', -- artifact_id列表
  logs              TEXT,              -- 执行日志
  
  -- 错误处理
  error_signature   VARCHAR(255),      -- 用于检测重复失败
  error_message     TEXT,
  next_action       VARCHAR(50),       -- retry, escalate, plan_b, done
  
  -- 元数据
  metadata          JSON DEFAULT '{}',
  
  -- 约束：同一work_item的run_number唯一
  UNIQUE(work_item_id, run_number)
);

-- 索引
CREATE INDEX idx_runs_work_item ON runs(work_item_id);
CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_runs_error_sig ON runs(error_signature);
```

**字段说明**:

| 字段 | 类型 | 说明 | 示例 |
|:-----|:-----|:-----|:-----|
| `run_number` | Integer | 第几次尝试（从1开始） | `1`, `2`, `3` |
| `error_signature` | String | 错误指纹（hash） | `sha256:abc123...` |
| `next_action` | Enum | 下一步操作 | `retry`, `escalate`, `plan_b`, `done` |

**状态机**:
```
running → success → done
  ↓
failed → retry (if run_number < max_retries)
  ↓
aborted (user cancelled)
```

**不变量**:
- ✅ `work_item_id`必须引用存在的work item
- ✅ `run_number`递增，无重复
- ✅ `status=running` → `ended_at IS NULL`
- ✅ `status!=running` → `ended_at IS NOT NULL`
- ✅ `tokens_used >= 0`

---

### 4. Artifacts表（交付物）

**用途**: 存储run产生的证据文件

**Schema**:
```sql
CREATE TABLE artifacts (
  -- 主键与外键
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  
  -- 基本信息
  type              VARCHAR(50) NOT NULL, -- patch, branch, log, report, test_result, pr
  path              TEXT,                 -- 文件系统路径或URL
  
  -- 完整性
  content_hash      VARCHAR(64),          -- SHA256
  size_bytes        INTEGER DEFAULT 0,
  
  -- 时间
  created_at        TIMESTAMP DEFAULT NOW(),
  
  -- 元数据
  metadata          JSON DEFAULT '{}'     -- 扩展字段（如PR number）
);

-- 索引
CREATE INDEX idx_artifacts_run ON artifacts(run_id);
CREATE INDEX idx_artifacts_type ON artifacts(type);
CREATE INDEX idx_artifacts_hash ON artifacts(content_hash);
```

**Artifact类型**:

| 类型 | 说明 | path示例 | metadata示例 |
|:-----|:-----|:---------|:------------|
| `code` | 代码文件 | `src/auth/login.ts` | `{"language": "typescript"}` |
| `patch` | Git补丁 | `/tmp/patches/wi-123.patch` | `{"lines_added": 50, "lines_deleted": 10}` |
| `branch` | Git分支 | `feature/user-login-wi-123` | `{"base": "main", "commits": 3}` |
| `test_result` | 测试输出 | `/tmp/test-results/wi-123.json` | `{"passed": 12, "failed": 0, "coverage": 85}` |
| `log` | 执行日志 | `/tmp/logs/run-456.log` | `{"level": "info"}` |
| `pr` | Pull Request | `https://github.com/user/repo/pull/123` | `{"number": 123, "state": "open"}` |

**不变量**:
- ✅ `run_id`必须引用存在的run
- ✅ `type`必须是预定义值
- ✅ `content_hash`对同一文件内容唯一
- ✅ `size_bytes >= 0`

---

### 5. Decisions表（决策日志）

**用途**: 记录AI的决策过程和理由

**Schema**:
```sql
CREATE TABLE decisions (
  -- 主键与外键
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id      UUID REFERENCES work_items(id) ON DELETE CASCADE,
  run_id            UUID REFERENCES runs(id) ON DELETE CASCADE,
  
  -- 决策信息
  decision_type     VARCHAR(50) NOT NULL, -- plan_chosen, tool_selected, escalated, model_switched
  rationale         TEXT NOT NULL,        -- LLM的推理过程
  alternatives      JSON DEFAULT '[]',    -- 考虑过的其他方案
  confidence        FLOAT,                -- 0.0-1.0
  
  -- 时间
  created_at        TIMESTAMP DEFAULT NOW(),
  
  -- 元数据
  metadata          JSON DEFAULT '{}'
);

-- 索引
CREATE INDEX idx_decisions_work_item ON decisions(work_item_id);
CREATE INDEX idx_decisions_run ON decisions(run_id);
CREATE INDEX idx_decisions_type ON decisions(decision_type);
```

**决策类型**:

| 类型 | 说明 | rationale示例 |
|:-----|:-----|:-------------|
| `plan_chosen` | 选择执行方案 | "选择使用JWT而非Session，因为需要支持移动端" |
| `tool_selected` | 选择工具 | "使用write_file而非run_command，避免沙箱限制" |
| `escalated` | 决定升级 | "连续3次相同错误，无法自主解决" |
| `model_switched` | 切换模型 | "GPT-4遇到429，切换到Claude Sonnet" |
| `plan_b_activated` | 启用Plan B | "ORM不支持该特性，改用手写SQL" |

**用途**:
- **可追溯性**: 事后审查AI为什么做某决策
- **学习**: 分析成功/失败的决策模式
- **审计**: 合规要求的证据链

---

### 6. Escalations表（升级记录）

**用途**: 存储升级事件和人类响应

**Schema**:
```sql
CREATE TABLE escalations (
  -- 主键与外键
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id      UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  
  -- 升级信息
  reason            VARCHAR(50) NOT NULL,  -- budget_exceeded, stuck, ambiguous, missing_credential
  packet            JSON NOT NULL,          -- 完整的Escalation Packet
  urgency           VARCHAR(20) NOT NULL,   -- low, medium, high, critical
  
  -- 状态
  status            VARCHAR(20) DEFAULT 'pending', -- pending, resolved, ignored
  
  -- 人类响应
  human_response    JSON,                   -- 人类提供的信息
  resolved_by       VARCHAR(255),           -- 处理人ID
  resolved_at       TIMESTAMP,
  
  -- 时间
  created_at        TIMESTAMP DEFAULT NOW(),
  
  -- 元数据
  metadata          JSON DEFAULT '{}'
);

-- 索引
CREATE INDEX idx_escalations_work_item ON escalations(work_item_id);
CREATE INDEX idx_escalations_status ON escalations(status);
CREATE INDEX idx_escalations_urgency ON escalations(urgency);
```

**Escalation Packet结构**: 参见 [01-ai-employee-paradigm.md#escalation-packet的标准](./01-ai-employee-paradigm.md#升级包escalation-packet的标准)

---

## 不变量（Invariants）

### 全局不变量

**必须始终满足的约束**:

1. **Goal-Work Item一致性**:
   ```sql
   -- Goal为completed时，所有Work Items必须为done
   ∀ goal WHERE goal.status = 'completed'
     → ∀ work_item WHERE work_item.goal_id = goal.id
       → work_item.status = 'done'
   ```

2. **Work Item依赖DAG**:
   ```
   Work Items的dependencies必须形成有向无环图（DAG）
   不允许循环依赖：WI-1 → WI-2 → WI-3 → WI-1 (❌)
   ```

3. **Run序号连续性**:
   ```sql
   -- 同一work_item的run_number必须从1开始连续
   ∀ work_item
     → runs.run_number ∈ {1, 2, 3, ..., N} (连续无间隙)
   ```

4. **Budget守恒**:
   ```sql
   -- 所有Runs的tokens_used之和不能超过goal.budget.max_tokens
   SUM(runs.tokens_used WHERE work_items.goal_id = goal.id)
     <= goal.budget.max_tokens
   ```

5. **Artifact完整性**:
   ```sql
   -- content_hash相同 → 内容必须相同（去重）
   ∀ a1, a2 IN artifacts
     WHERE a1.content_hash = a2.content_hash
     → a1.content = a2.content
   ```

### 状态转换不变量

1. **Work Item ready条件**:
   ```sql
   work_item.status = 'ready'
   ↔ ∀ dep_id IN work_item.dependencies
       → (SELECT status FROM work_items WHERE id = dep_id) = 'done'
   ```

2. **Run终态条件**:
   ```sql
   run.status IN ('success', 'failed', 'aborted')
   → run.ended_at IS NOT NULL
   ```

3. **Goal完成条件**:
   ```sql
   goal.status = 'completed'
   → goal.completed_at IS NOT NULL
   AND ∀ work_item WHERE work_item.goal_id = goal.id
       → work_item.status = 'done'
   ```

---

## 可追溯性（Traceability）

### 证据链

从Goal到最终Artifact的完整追踪：

```
Goal "实现用户登录"
  ├─ Work Item "创建users表"
  │   ├─ Run #1 (failed: syntax error)
  │   │   ├─ Decision: "选择PostgreSQL语法"
  │   │   └─ Artifact: log (错误日志)
  │   └─ Run #2 (success)
  │       ├─ Decision: "改用SQLite语法"
  │       ├─ Artifact: code (db/migrations/001_create_users.sql)
  │       └─ Artifact: test_result (migration测试通过)
  ├─ Work Item "实现JWT中间件"
  │   └─ Run #1 (success)
  │       ├─ Decision: "使用jsonwebtoken库"
  │       ├─ Artifact: code (src/middleware/jwt.ts)
  │       ├─ Artifact: test_result (12/12 passed)
  │       └─ Artifact: branch (feature/jwt-middleware)
  └─ Work Item "集成测试"
      └─ Run #1 (success)
          ├─ Artifact: test_result (integration tests passed)
          └─ Artifact: pr (https://github.com/.../pull/123)
```

### 审计查询

**查询1**: 某个Goal的所有决策
```sql
SELECT d.*
FROM decisions d
JOIN work_items wi ON d.work_item_id = wi.id
WHERE wi.goal_id = 'goal-xxx'
ORDER BY d.created_at;
```

**查询2**: 某个Work Item的尝试历史
```sql
SELECT 
  r.run_number,
  r.status,
  r.error_signature,
  r.next_action,
  array_agg(a.type) AS artifact_types
FROM runs r
LEFT JOIN artifacts a ON a.run_id = r.id
WHERE r.work_item_id = 'wi-123'
GROUP BY r.id
ORDER BY r.run_number;
```

**查询3**: Budget使用情况
```sql
SELECT 
  g.title,
  g.budget->>'max_tokens' AS budget_tokens,
  SUM(r.tokens_used) AS used_tokens,
  (g.budget->>'max_tokens')::INTEGER - SUM(r.tokens_used) AS remaining_tokens
FROM goals g
JOIN work_items wi ON wi.goal_id = g.id
JOIN runs r ON r.work_item_id = wi.id
WHERE g.id = 'goal-xxx'
GROUP BY g.id;
```

---

## 幂等性（Idempotency）

### 工具调用幂等性

**问题**: 网络故障可能导致重复执行

**解决**: `idempotencyKey`

**示例**（调用Node工具）:
```typescript
async function invokeNodeTool(command: string, args: any): Promise<any> {
  // 生成幂等Key
  const idempotencyKey = hash({
    work_item_id: current_work_item.id,
    run_id: current_run.id,
    command,
    args
  });
  
  // 检查是否已执行
  const cached = await cache.get(idempotencyKey);
  if (cached) {
    return cached.result;
  }
  
  // 执行并缓存
  const result = await gateway.nodeInvoke(command, args, idempotencyKey);
  await cache.set(idempotencyKey, { result }, ttl=3600);
  
  return result;
}
```

### Run重试幂等性

**不变量**: 重试不改变最终结果（如果输入相同）

**实现**:
- 每次重试创建新Run记录（run_number递增）
- 前一次失败的Run保留（不删除）
- Artifacts按run_id关联（隔离不同尝试的输出）

---

## 可恢复性（Resumability）

### Context Pack机制

**存储**: JSON文件（`~/.ponybunny/context_packs/{work_item_id}.json`）

**更新频率**: 每次work item状态变化时

**结构**: 参见 [02-glossary-and-terminology.md#context-pack](./02-glossary-and-terminology.md#context-pack-上下文快照)

### Resume流程

**场景**: Agent重启后恢复工作

```typescript
async function resumeInProgressWork() {
  // 1. 查找所有in_progress的work items
  const inProgress = await db.work_items.findAll({
    status: 'in_progress'
  });
  
  // 2. 加载Context Pack
  for (const wi of inProgress) {
    const contextPack = await loadContextPack(wi.id);
    
    if (!contextPack) {
      // Context Pack丢失，标记为blocked并escalate
      await escalate(wi, 'context_pack_missing');
      continue;
    }
    
    // 3. 恢复执行
    const context = await restoreFromContextPack(contextPack);
    await continueExecution(wi, context);
  }
}
```

---

## 配置示例

```json
{
  "work_order_system": {
    "database": {
      "path": "~/.ponybunny/work_orders.db",
      "backup_interval_hours": 24
    },
    
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
    
    "context_packs": {
      "enabled": true,
      "save_frequency": "every_run",
      "retention_days": 90
    },
    
    "artifacts": {
      "storage_path": "~/.ponybunny/artifacts",
      "retention_days": 90,
      "max_size_mb": 100
    }
  }
}
```

---

## 文档导航

**前置阅读**:
- [10-autonomous-execution-model.md](./10-autonomous-execution-model.md) — 理解生命周期
- [02-glossary-and-terminology.md](./02-glossary-and-terminology.md) — 术语定义

**下一步阅读**:
- [12-human-interaction-contracts.md](./12-human-interaction-contracts.md) — 人类交互规范
- [20-capability-requirements.md](./20-capability-requirements.md) — 详细需求（Phase 3）

**实现参考**:
- [../engineering/database.md](../engineering/database.md) — 数据库实现
- [work-order-system.md](./work-order-system.md) — 原始详细文档（待归档）

---

**版本历史**:
- v2.0 (2026-01-31): 从work-order-system.md拆分实体模型和不变量，建立Work Order会计系统
- v1.0 (2026-01-15): 初始版本（整合在work-order-system.md中）
