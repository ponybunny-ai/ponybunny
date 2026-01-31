# 人类交互契约 (Human Interaction Contracts)

**文档状态**: Tier 2 - 能力文档  
**目标受众**: 产品经理、用户、开发工程师  
**最后更新**: 2026-01-31  
**版本**: 2.0

---

## 导读

本文档定义**所有人类进入AI工作循环的接触点**。它明确：何时需要人类？如何请求？期望什么响应？如何恢复工作？

这使自主性变得**可理解和可控**——人类知道何时会被打扰，AI知道何时应该自主处理。

阅读本文档后，你应该理解：在什么情况下AI会请求人类介入？人类需要提供什么信息？

**前置阅读**:
- [01-ai-employee-paradigm.md](./01-ai-employee-paradigm.md) — 责任边界和升级哲学

---

## 核心原则：最小化人类干预

### 设计哲学

**目标**: 人类只在**关键决策点**参与，而非每个步骤。

**测量标准**: 
- 平均升级次数 < 2次/goal
- 自主完成率 > 70%

**反模式**:
- ❌ AI每步都询问"接下来做什么？"
- ❌ 遇到任何错误就立即升级
- ❌ 人类必须在线等待AI工作

---

## 人类交互接触点分类

### 按触发方式分类

| 类型 | 触发者 | 时机 | 示例 |
|:-----|:------|:-----|:-----|
| **Goal Intake** | 人类主动 | 开始新目标 | "实现用户登录功能" |
| **Clarification** | AI主动 | 目标定义模糊 | "测试覆盖率目标多少？" |
| **Approval Request** | AI主动 | 风险操作 | "批准数据库migration？" |
| **Escalation** | AI主动 | 自主无法解决 | "连续3次测试失败" |
| **Progress Check** | 人类主动（可选） | 任意时间 | "当前进度如何？" |
| **Hand-off Review** | AI主动 | Goal完成 | "PR已创建，请审查" |

### 按紧急程度分类

| 紧急程度 | 期望响应时间 | 通知方式 | 示例 |
|:--------|:-----------|:---------|:-----|
| **Low** | 24小时内 | 邮件 | "建议添加索引优化性能" |
| **Medium** | 4小时内 | 推送通知 | "缺少API Key，无法继续" |
| **High** | 1小时内 | 推送+短信 | "即将删除生产数据，需批准" |
| **Critical** | 立即 | 电话+推送 | "检测到安全漏洞" |

---

## 接触点1: Goal Intake（目标接收）

### 人类侧契约

**输入格式**:
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

**必填字段**:
- ✅ `title`: 简短清晰的目标
- ✅ `budget`: 至少指定一项（tokens/hours/cost）

**可选字段**:
- `description`: 详细说明（推荐）
- `priority`: 默认50
- `deadline`: 默认无限制

**AI侧契约**

**确认响应**:
```json
{
  "goal_id": "uuid-xxx",
  "status": "queued",
  "estimated_work_items": 5,
  "estimated_completion": "2026-02-02T15:00:00Z",
  "message": "目标已接收，正在分析和分解..."
}
```

**后续通知**:
- Goal进入`active`状态时
- 首个Work Item开始执行时
- Goal完成或遇到问题时

---

## 接触点2: Clarification（需求澄清）

### 触发条件

**何时AI请求澄清**:
1. **目标定义模糊**
   - 示例："提升性能"（无具体指标）
   - AI需要："提升什么指标？目标值多少？"

2. **隐含假设冲突**
   - 示例："使用Session认证"但描述提到"移动端支持"
   - AI需要："移动端是否也用Session？还是JWT？"

3. **多种实现方案可行**
   - 示例："添加缓存"（Redis? Memcached? 本地内存？）
   - AI需要："偏好哪种缓存方案？"

### 交互格式

**AI请求**:
```json
{
  "type": "clarification",
  "goal_id": "uuid-xxx",
  "question": "测试覆盖率目标是多少？",
  "context": "你提到'添加测试'，但未指定覆盖率目标",
  "options": [
    {"value": "60%", "description": "基础覆盖"},
    {"value": "80%", "description": "良好覆盖（推荐）"},
    {"value": "90%+", "description": "严格覆盖"}
  ],
  "default": "80%",
  "urgency": "medium"
}
```

**人类响应**:
```json
{
  "clarification_id": "uuid-yyy",
  "answer": "80%",
  "additional_context": "关键路径必须100%覆盖"
}
```

**AI后续行动**:
- 更新Goal的`success_criteria`
- 恢复执行（从暂停点继续）
- 记录到Decisions表

### 超时处理

**如果人类24小时未响应**:
- `urgency=low`: 使用default值继续
- `urgency=medium`: 再次提醒，48小时后使用default
- `urgency=high`: 标记Goal为`blocked`

---

## 接触点3: Approval Request（批准请求）

### 需要批准的操作

**默认白名单**（需批准）:

| 操作类型 | 示例 | 风险级别 | 批准要求 |
|:--------|:-----|:--------|:--------|
| **数据库Schema变更** | `ALTER TABLE users ADD COLUMN` | High | 人类review migration文件 |
| **生产部署** | `git push origin production` | High | 人类确认部署窗口 |
| **删除资源** | `DROP TABLE`, `rm -rf` | Critical | 人类double-check |
| **引入新依赖** | `npm install new-lib` | Medium | 人类审查license和安全 |
| **修改安全配置** | 更改CORS、Auth规则 | High | 人类审查影响范围 |

**配置化**:
```json
{
  "require_approval_for": [
    "database_migration",
    "production_deploy",
    "delete_resources",
    "add_dependency",
    "security_config_change"
  ]
}
```

### 交互格式

**AI请求**:
```json
{
  "type": "approval_request",
  "work_item_id": "wi-123",
  "action": "create_database_migration",
  "rationale": "需要添加users表以支持登录功能",
  "impact_analysis": {
    "risk_level": "medium",
    "affected_systems": ["database", "auth_service"],
    "reversibility": "可通过rollback migration撤销",
    "estimated_downtime": "0秒（兼容变更）"
  },
  "proposed_changes": {
    "file": "db/migrations/001_create_users.sql",
    "preview": "CREATE TABLE users (\n  id UUID PRIMARY KEY,\n  email VARCHAR(255) UNIQUE NOT NULL,\n  ...\n);"
  },
  "options": [
    {
      "option": "approve",
      "description": "批准并立即执行migration",
      "next_steps": "Agent将运行migration并继续后续步骤"
    },
    {
      "option": "modify",
      "description": "人类修改后再执行",
      "next_steps": "Agent等待人类编辑migration文件"
    },
    {
      "option": "reject",
      "description": "拒绝此方案",
      "next_steps": "Agent寻找替代方案或escalate"
    }
  ],
  "urgency": "medium"
}
```

**人类响应**:
```json
{
  "approval_id": "uuid-zzz",
  "decision": "approve",
  "conditions": "仅在dev环境执行，prod需等待周末维护窗口",
  "approved_by": "user-123",
  "approved_at": "2026-01-31T10:30:00Z"
}
```

**AI后续行动**:
- `decision=approve`: 执行操作，记录批准信息到Decisions表
- `decision=modify`: 暂停，等待人类编辑完成
- `decision=reject`: 尝试Plan B或escalate

---

## 接触点4: Escalation（升级）

### 升级场景分类

#### 场景A: 缺失信息（Missing Information）

**触发**: Agent需要外部信息才能继续

**示例**:
```
Work Item: "部署到AWS"
Error: 缺少AWS_ACCESS_KEY_ID环境变量
```

**Escalation Packet**:
```json
{
  "type": "missing_information",
  "what_needed": "AWS access credentials",
  "why_needed": "部署需要访问S3和EC2",
  "how_to_provide": "设置环境变量 AWS_ACCESS_KEY_ID 和 AWS_SECRET_ACCESS_KEY",
  "urgency": "medium"
}
```

**期望人类响应**:
```json
{
  "credentials": {
    "AWS_ACCESS_KEY_ID": "AKIA...",
    "AWS_SECRET_ACCESS_KEY": "..."
  },
  "resume": true
}
```

#### 场景B: 重复失败（Stuck）

**触发**: 连续3次相同错误

**示例**:
```
Work Item: "实现JWT中间件"
Error Signature: "TypeError: Cannot read property 'sign' of undefined" (连续3次)
```

**Escalation Packet**:
```json
{
  "type": "stuck",
  "error_signature": "sha256:abc123...",
  "attempts": [
    {
      "run_number": 1,
      "strategy": "使用jsonwebtoken库",
      "error": "Cannot read property 'sign' of undefined",
      "what_tried": ["npm install jsonwebtoken", "const jwt = require('jsonwebtoken')"]
    },
    {
      "run_number": 2,
      "strategy": "检查依赖安装",
      "error": "Same error",
      "what_tried": ["npm list jsonwebtoken (确认已安装)"]
    },
    {
      "run_number": 3,
      "strategy": "使用ES6 import",
      "error": "Same error",
      "what_tried": ["import * as jwt from 'jsonwebtoken'"]
    }
  ],
  "root_cause_analysis": "可能是jsonwebtoken版本不兼容，或缺少TypeScript类型定义",
  "suggested_options": [
    {
      "option": "A",
      "description": "降级jsonwebtoken到8.5.1（已知稳定版本）",
      "pros": ["兼容性好", "社区验证"],
      "cons": ["版本较旧，缺少新特性"]
    },
    {
      "option": "B",
      "description": "切换到jose库（现代JWT库）",
      "pros": ["原生TS支持", "更好的错误提示"],
      "cons": ["API不同，需调整代码"]
    },
    {
      "option": "C",
      "description": "人类手动调试",
      "pros": ["精准定位问题"],
      "cons": ["需要人类时间投入"]
    }
  ],
  "minimal_question": "应该降级jsonwebtoken版本还是切换到jose库？",
  "urgency": "high"
}
```

**期望人类响应**:
```json
{
  "decision": "option_B",
  "rationale": "jose库更现代，值得切换",
  "resume": true
}
```

#### 场景C: Budget耗尽（Budget Exhausted）

**触发**: Token/时间/成本达到上限

**Escalation Packet**:
```json
{
  "type": "budget_exhausted",
  "budget_status": {
    "max_tokens": 50000,
    "used_tokens": 49500,
    "remaining_tokens": 500
  },
  "current_progress": {
    "completed_work_items": 3,
    "total_work_items": 5,
    "percentage": 60
  },
  "options": [
    {
      "option": "increase_budget",
      "description": "增加Token预算到80000",
      "estimated_cost": "$0.50额外成本"
    },
    {
      "option": "complete_partial",
      "description": "仅完成当前3个work items，剩余2个手动处理",
      "impact": "部分功能需人类补充"
    },
    {
      "option": "pause",
      "description": "暂停，等待下个计费周期",
      "impact": "延迟交付"
    }
  ],
  "urgency": "medium"
}
```

#### 场景D: 风险边界（Risk Boundary）

**触发**: 操作接近安全/合规红线

**示例**:
```
Work Item: "清理旧数据"
Risk: 即将执行 DELETE FROM users WHERE last_login < '2024-01-01'
```

**Escalation Packet**:
```json
{
  "type": "risk_boundary",
  "risky_operation": {
    "command": "DELETE FROM users WHERE last_login < '2024-01-01'",
    "affected_rows": 12500,
    "data_classification": "PII (个人身份信息)"
  },
  "risk_assessment": {
    "risk_level": "critical",
    "reversibility": "不可逆",
    "compliance_impact": "可能违反GDPR数据保留要求"
  },
  "required_approvals": [
    "DPO (数据保护官)",
    "Engineering Manager"
  ],
  "urgency": "critical"
}
```

**人类必须提供**:
- 明确批准（双因素确认）
- 批准人身份验证
- 审计记录

---

## 接触点5: Progress Check（进度检查）

### 人类主动查询

**查询接口**:
```typescript
interface ProgressQuery {
  goal_id?: string;          // 查询特定goal
  include_details?: boolean;  // 是否包含详细信息
}

interface ProgressResponse {
  goal: {
    id: string;
    title: string;
    status: string;
    progress: number;  // 0-100
  };
  
  work_items: {
    total: number;
    done: number;
    in_progress: number;
    blocked: number;
  };
  
  budget: {
    max_tokens: number;
    used_tokens: number;
    remaining_tokens: number;
    percentage_used: number;
  };
  
  estimated_completion: string; // ISO timestamp
  
  recent_activity: Array<{
    timestamp: string;
    event: string;  // "work_item_completed", "escalation_created", etc.
  }>;
  
  blocking_issues?: Array<{
    type: string;
    description: string;
    waiting_for: string;  // "human_approval", "clarification", etc.
  }>;
}
```

**查询方式**:
- CLI: `ponybunny status goal-xxx`
- WebUI: Dashboard页面
- API: `GET /goals/{goal_id}/status`
- 消息平台: "当前进度如何？"

**AI响应时机**:
- 立即响应（不打断当前工作）
- 提供快照数据（不重新计算）

---

## 接触点6: Hand-off Review（交接审查）

### Goal完成时

**AI通知**:
```json
{
  "type": "goal_completed",
  "goal_id": "uuid-xxx",
  "title": "实现用户登录功能",
  "completion_summary": {
    "duration_hours": 2.5,
    "work_items_completed": 5,
    "total_cost_usd": 1.20,
    "budget_remaining": {
      "tokens": 8500,
      "cost_usd": 0.80
    }
  },
  
  "deliverables": [
    {
      "type": "pr",
      "url": "https://github.com/user/repo/pull/123",
      "title": "feat: implement user login with JWT",
      "status": "open",
      "checks": "passing"
    },
    {
      "type": "documentation",
      "path": "docs/api/auth.md",
      "summary": "API文档已更新"
    },
    {
      "type": "test_report",
      "coverage": 85,
      "tests_added": 12,
      "tests_passing": 12
    }
  ],
  
  "quality_report": {
    "deterministic_gates": {
      "tests": "✓ passed",
      "build": "✓ passed",
      "lint": "✓ passed"
    },
    "llm_review": {
      "code_smell": "⚠️ 1 warning (JWT secret硬编码)",
      "security": "✓ no critical issues",
      "performance": "✓ no issues"
    }
  },
  
  "next_steps": [
    "Review PR #123",
    "Approve DB migration (if applicable)",
    "Merge to main branch",
    "Deploy to staging for QA"
  ],
  
  "lessons_learned": [
    "初次尝试使用jsonwebtoken库失败，切换到jose库成功",
    "Migration文件需要人类审查（安全策略）"
  ]
}
```

**期望人类行动**:
1. Review PR（代码审查）
2. 测试staging环境
3. 批准merge或请求修改
4. 关闭Goal（或要求Agent修复问题）

---

## 接触点7: Mid-Run Check-in（中途检查点）

### 长期Goal的定期同步

**适用场景**: Goal预计执行时间 > 8小时

**AI主动通知** (每24小时):
```json
{
  "type": "daily_progress_update",
  "goal_id": "uuid-xxx",
  "day_number": 3,
  "progress_since_yesterday": {
    "work_items_completed": 2,
    "new_issues": 0,
    "budget_used": 8500
  },
  "current_status": "正在实现第4个work item: 集成测试",
  "estimated_days_remaining": 2,
  "next_milestone": "完成所有测试（预计明天）"
}
```

**人类可选响应**:
- 确认继续（默认）
- 调整优先级
- 增加budget
- 暂停Goal

---

## 响应时间SLA

### 期望响应时间

| 交互类型 | 紧急程度 | 期望响应时间 | 超时行为 |
|:--------|:--------|:-----------|:--------|
| **Goal Intake** | N/A | 立即 | N/A（人类主动） |
| **Clarification** | Low | 24小时 | 使用default继续 |
| **Clarification** | Medium | 4小时 | 提醒后48小时使用default |
| **Clarification** | High | 1小时 | 标记blocked |
| **Approval** | Medium | 4小时 | 标记blocked |
| **Approval** | High | 1小时 | 标记blocked + 告警 |
| **Approval** | Critical | 15分钟 | 立即停止操作 + 多渠道告警 |
| **Escalation** | Medium | 8小时 | 尝试Plan B |
| **Escalation** | High | 2小时 | 标记blocked |
| **Progress Check** | N/A | 立即 | N/A（查询类） |
| **Hand-off** | Low | 3天 | 自动关闭Goal |

---

## 通知渠道配置

### 多渠道通知策略

**配置示例**:
```json
{
  "notification_channels": {
    "email": {
      "enabled": true,
      "address": "user@example.com",
      "for_urgency": ["low", "medium"]
    },
    "push": {
      "enabled": true,
      "device_tokens": ["token1", "token2"],
      "for_urgency": ["medium", "high", "critical"]
    },
    "sms": {
      "enabled": true,
      "phone": "+1234567890",
      "for_urgency": ["high", "critical"]
    },
    "webhook": {
      "enabled": true,
      "url": "https://example.com/ponybunny-webhook",
      "for_urgency": ["all"]
    }
  },
  
  "quiet_hours": {
    "enabled": true,
    "timezone": "America/Los_Angeles",
    "start": "22:00",
    "end": "08:00",
    "downgrade_urgency": {
      "medium": "low",
      "high": "medium"
      // critical不降级
    }
  }
}
```

---

## 人类响应的验证

### 输入验证

**AI必须验证人类响应**:

```typescript
function validateHumanResponse(request: ApprovalRequest, response: HumanResponse): ValidationResult {
  // 验证1: 响应格式正确
  if (!response.decision || !['approve', 'modify', 'reject'].includes(response.decision)) {
    return { valid: false, error: "Invalid decision value" };
  }
  
  // 验证2: 必要字段完整
  if (response.decision === 'approve' && !response.approved_by) {
    return { valid: false, error: "Missing approver identity" };
  }
  
  // 验证3: 权限检查（如果需要）
  if (request.required_approvals.includes('DPO')) {
    if (!hasRole(response.approved_by, 'DPO')) {
      return { valid: false, error: "Approver does not have DPO role" };
    }
  }
  
  return { valid: true };
}
```

---

## 文档导航

**前置阅读**:
- [01-ai-employee-paradigm.md](./01-ai-employee-paradigm.md) — 责任边界
- [10-autonomous-execution-model.md](./10-autonomous-execution-model.md) — 执行生命周期

**下一步阅读**:
- [13-system-boundaries-and-operating-context.md](./13-system-boundaries-and-operating-context.md) — 系统边界
- [21-scenarios-and-user-stories.md](./21-scenarios-and-user-stories.md) — 用户旅程（Phase 3）

**相关参考**:
- [user-stories.md](./user-stories.md) — 原始用户故事（待整合）

---

**版本历史**:
- v2.0 (2026-01-31): 从user-stories.md和system-boundaries.md提取人类交互接触点，建立契约规范
- v1.0 (2026-01-15): 初始版本（分散在user-stories.md中）
