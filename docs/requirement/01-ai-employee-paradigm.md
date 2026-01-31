# AI员工范式 (AI Employee Paradigm)

**文档状态**: Tier 1 - 基础文档  
**目标受众**: 所有角色（建立共同语言和期望）  
**最后更新**: 2026-01-31  
**版本**: 2.0

---

## 导读

本文档将"AI员工"从营销隐喻转变为**正式的操作模型**。它定义了AI与人类的责任边界、问责制机制、升级哲学，以及"良好员工行为"的具体标准。

阅读本文档后，你应该能够判断：**在特定情况下，AI应该自主处理还是升级给人类？**

---

## 核心隐喻：从助手到员工

### 范式转变的本质

```
AI助手范式：
  人类：指令发出者  
  AI：工具执行者
  交互：同步对话
  责任：人类对结果负责

AI员工范式：
  人类：目标设定者
  AI：自主工作者
  交互：异步委派
  责任：AI对过程负责，人类对目标负责
```

### 为什么用"员工"而不是"助手"？

| 特征 | 助手 | 员工 |
|:-----|:-----|:-----|
| **主动性** | 被动等待指令 | 主动发现和执行任务 |
| **记忆** | 短期记忆（单次对话） | 长期记忆（工作档案） |
| **问责** | 无问责（工具不负责） | 基于证据的问责 |
| **成长** | 无学习（每次从零开始） | 从失败中学习改进 |
| **沟通** | 同步（必须在场） | 异步（可离线工作） |

---

## AI员工的责任边界

### 三层责任模型

#### 第一层：完全自主（AI全权负责）

**定义**：AI可以且应该自主决策和执行，无需人类批准。

**适用场景**：
- ✅ 读取和分析代码
- ✅ 运行测试和构建
- ✅ 编写代码（在沙箱内）
- ✅ 生成文档和报告
- ✅ 错误重试（<3次）
- ✅ 选择工具和策略
- ✅ 运行Quality Gates验证

**边界条件**：
- 所有操作在沙箱内
- 不修改生产系统
- Budget未耗尽
- 未触及风险边界

#### 第二层：请求批准（AI提案，人类批准）

**定义**：AI识别出需要人类决策的情况，生成建议并等待批准。

**适用场景**：
- ⚠️ 数据库Schema变更（Migration）
- ⚠️ 删除资源（文件、数据库记录）
- ⚠️ 生产环境部署
- ⚠️ 引入新的依赖库
- ⚠️ 修改安全配置（Auth、CORS等）
- ⚠️ 超出Budget限制

**交互格式**：
```json
{
  "type": "approval_request",
  "action": "create_database_migration",
  "rationale": "需要添加users表以支持登录功能",
  "impact_analysis": {
    "risk_level": "medium",
    "reversibility": "可通过rollback migration撤销",
    "affected_systems": ["database", "auth_service"]
  },
  "options": [
    {
      "option": "A",
      "description": "创建migration并立即应用到dev环境",
      "pros": ["快速验证", "遵循标准流程"],
      "cons": ["需要数据库访问权限"]
    },
    {
      "option": "B", 
      "description": "仅生成migration文件，由人类手动应用",
      "pros": ["更安全", "人类完全控制"],
      "cons": ["增加人工步骤"]
    }
  ],
  "recommendation": "A",
  "urgency": "medium"
}
```

#### 第三层：禁止操作（AI不应尝试）

**定义**：明确禁止AI执行的操作，即使Budget允许。

**硬性禁止**：
- ❌ 直接修改宿主机文件系统（沙箱外）
- ❌ 执行`rm -rf /`等危险命令
- ❌ 泄露API Key或密码
- ❌ 绕过Security Policy
- ❌ 修改生产数据库（无人类批准）

**配置禁止**：
- ❌ 超过Budget限额的操作
- ❌ 不在工具白名单的命令
- ❌ 访问未授权的外部API

---

## 升级哲学（Escalation Philosophy）

### 升级的本质

**升级不是失败，而是明智的决策**。

一个好的AI员工应该知道：
1. 什么时候可以自己解决（自主）
2. 什么时候需要请示（请求批准）
3. 什么时候已经超出能力范围（升级）

### 明确的升级触发器

| 触发器 | 说明 | 示例 |
|:------|:-----|:-----|
| **重复失败** | 连续3次相同错误 | 3次测试失败，错误相同 |
| **Budget耗尽** | Token/时间/成本达到上限 | API调用已用完分配的10K tokens |
| **歧义消除** | 目标定义模糊，需要澄清 | "提升性能"没有具体指标 |
| **缺少凭证** | 需要外部资源但无访问权限 | 部署需要AWS Key但未配置 |
| **风险边界** | 接近安全/合规红线 | 即将删除生产数据 |
| **能力边界** | 任务超出AI当前能力 | 需要物理设备操作 |

### 升级包（Escalation Packet）的标准

一个完整的升级包必须包含：

```typescript
interface EscalationPacket {
  // 1. 问题上下文
  work_item: {
    id: string;
    title: string;
    goal: string;
  };
  
  // 2. 尝试历史
  attempts: Array<{
    strategy: string;
    what_tried: string[];
    why_failed: string;
    error_signature: string;
  }>;
  
  // 3. 当前状态
  current_state: {
    artifacts: Artifact[];
    passing_gates: string[];  // 已通过的验证
    failing_gates: string[];  // 失败的验证
    budget_remaining: Budget;
  };
  
  // 4. AI的分析和建议
  analysis: {
    root_cause: string;        // 根因分析
    suggested_options: Array<{
      option: string;
      description: string;
      pros: string[];
      cons: string[];
      estimated_effort: string;
    }>;
    minimal_question: string;  // 最小化问题（只问必要信息）
  };
  
  // 5. 紧急程度
  urgency: 'low' | 'medium' | 'high' | 'critical';
}
```

**反例（糟糕的升级）**：
```
❌ "出错了，不知道怎么办" （无上下文）
❌ "测试失败" （无尝试历史）
❌ "需要帮助" （无具体问题）
```

**正例（优秀的升级）**：
```
✅ "JWT认证实现中，已尝试3种方案均失败（详见attempts）。
    根因分析：缺少SECRET_KEY环境变量。
    建议：提供SECRET_KEY或使用测试用硬编码密钥（仅dev环境）。
    紧急程度：中（阻塞登录功能，但可暂时绕过）"
```

---

## 问责制模型（Accountability Model）

### 基于证据的问责

传统软件无问责（工具不负责），AI员工必须对工作过程负责。

#### 问责的三个维度

1. **过程可追溯**
   - 所有决策记录在`decisions`表
   - 每个action附带rationale
   - 完整的工具调用日志

2. **结果可验证**
   - 自动运行Quality Gates
   - 生成Artifacts作为交付证据
   - 提供测试覆盖率报告

3. **失败可解释**
   - Escalation Packet包含失败原因
   - Error signature用于检测重复模式
   - 提供建议的替代方案

### 证据类型（Artifacts）

| 证据类型 | 说明 | 示例 |
|:--------|:-----|:-----|
| **Code** | 生成的代码文件 | `src/auth/login.ts` |
| **Patch** | 代码变更补丁 | `feature-login.patch` |
| **Test Results** | 测试运行报告 | `test-output.json` |
| **Build Logs** | 构建日志 | `build.log` |
| **Decisions** | 决策记录 | "选择JWT而非Session的理由" |
| **Branch** | Git分支 | `feature/user-login` |
| **PR** | Pull Request | GitHub PR #123 |

### 问责标准（"好员工"的定义）

**优秀AI员工的特征**：
- ✅ 主动生成Verification Plan
- ✅ 自检通过才标记完成
- ✅ 失败时提供根因分析
- ✅ 升级时打包完整上下文
- ✅ 决策有清晰的rationale

**不合格AI员工的表现**：
- ❌ 跳过测试直接标记完成
- ❌ 遇到错误立即升级（无重试）
- ❌ 决策无理由说明
- ❌ 升级信息不完整
- ❌ 重复犯相同错误

---

## 人类与AI的分工

### 人类的三个角色

#### 1. 目标设定者（Goal Setter）

**职责**：
- 定义高层目标（What）
- 设定成功标准
- 配置Budget和约束
- 批准风险操作

**不负责**：
- ❌ 分解为详细步骤（AI负责）
- ❌ 选择具体工具（AI负责）
- ❌ 编写代码（AI负责）

#### 2. 质量审批者（Quality Approver）

**职责**：
- Review AI生成的Pull Request
- 审查安全和架构决策
- 批准部署到生产环境

**不负责**：
- ❌ 修复AI代码的小bug（AI应自检）
- ❌ 重新编写不满意的代码（应让AI重做）

#### 3. 异常处理者（Exception Handler）

**职责**：
- 处理AI升级的复杂决策
- 提供缺失的信息（API Key、业务规则）
- 解决超出AI能力的问题

**不负责**：
- ❌ 频繁救火（应改进AI的自主能力）
- ❌ 做AI本该做的重试

### AI的四个角色

#### 1. 计划制定者（Planner）

**职责**：
- 将goal分解为work items
- 识别依赖关系
- 生成Verification Plan

#### 2. 执行者（Executor）

**职责**：
- 编写代码、运行测试
- 调用工具、处理错误
- 记录决策和证据

#### 3. 质量保证者（QA）

**职责**：
- 运行确定性验证（tests/build/lint）
- 自检代码质量
- 生成测试覆盖率报告

#### 4. 持续改进者（Continuous Improver）

**职责**：
- 从失败中学习
- 优化重复性工作
- 识别可自动化的模式

---

## 核心隐喻的具体化

### 🐴 Durable — "像老员工一样可靠"

**操作定义**：
- 完整的工作档案系统（Work Orders + Artifacts + Decisions Log）
- 任何时候都可以回答"为什么做了X？"
- 长期记忆（Vector Memory + Context Packs）

**反面**：健忘的临时工（每次从零开始）

### 🐰 Fast — "高效执行不拖延"

**操作定义**：
- P95响应延迟 < 2秒
- Lane-based并发（多任务并行）
- Embedding缓存减少重复计算

**反面**：拖沓的官僚（层层审批，缓慢响应）

### 🏠 Local-first — "你的员工你控制"

**操作定义**：
- 所有数据本地存储（`~/.openclaw/`）
- 支持完全离线运行（Ollama）
- 审计日志完全可访问

**反面**：外包工（数据在第三方，无控制权）

### 🔒 Security-first — "可信赖的员工"

**操作定义**：
- 明确的权限边界（自主/批准/禁止）
- Docker沙箱隔离
- 工具白名单机制

**反面**：鲁莽的实习生（乱删文件）

### ✂️ Trim-to-fit — "按需雇佣成本可控"

**操作定义**：
- 简单任务用便宜模型（GPT-3.5 = 实习生）
- 复杂任务用强模型（Claude Sonnet = 高级工程师）
- 月API成本 < $10

**反面**：固定薪资（无论任务难度都用最贵模型）

### 👥 Know Your AI — "像了解员工一样"

**操作定义**：
- 工作计划可见（Work Items列表）
- 执行可追溯（Runs + Artifacts）
- 质量标准明确（Verification Plan）
- 升级原因清晰（Escalation Packet）

**反面**：黑箱工作者（不知道在做什么）

---

## 升级策略的具体规则

### 何时自主处理（无需升级）

```python
def should_handle_autonomously(context) -> bool:
    return (
        context.error_count < 3 and               # 重试次数未达上限
        context.budget.remaining > 0.2 and        # Budget仍充足
        context.risk_level <= 'medium' and        # 风险可控
        context.has_fallback_strategy and         # 有Plan B
        not context.requires_credentials          # 无缺失凭证
    )
```

### 何时请求批准（等待人类）

```python
def should_request_approval(action) -> bool:
    high_risk_operations = [
        'database_migration',
        'production_deploy',
        'delete_resources',
        'modify_security_config'
    ]
    
    return (
        action.type in high_risk_operations or
        action.budget_impact > threshold or
        action.affects_production
    )
```

### 何时立即升级（停止并报告）

```python
def should_escalate_immediately(context) -> bool:
    return (
        context.consecutive_same_errors >= 3 or   # 卡死
        context.budget.exhausted or               # 预算用尽
        context.goal_ambiguous or                 # 目标不明
        context.capability_exceeded               # 超出能力
    )
```

---

## 写作规则（避免重复）

为了避免在其他文档中重复陈述"AI员工"概念：

### 规则1：链接引用，不要重述

**错误**：
```markdown
PonyBunny是一个AI员工系统，它能够像真人员工一样自主工作...（重复定义）
```

**正确**：
```markdown
根据[AI员工范式](./01-ai-employee-paradigm.md#核心隐喻)，
PonyBunny将在以下情况下请求批准...
```

### 规则2：仅在决策点使用隐喻

**适合使用隐喻的场景**：
- ✅ 责任边界说明
- ✅ 升级决策逻辑
- ✅ 质量标准定义
- ✅ 问责制解释

**不适合的场景**：
- ❌ 技术实现细节
- ❌ API设计文档
- ❌ 代码注释

---

## 文档导航

**前置阅读**：
- [00-vision-and-problem.md](./00-vision-and-problem.md) — 了解PonyBunny存在的根本原因

**下一步阅读**：
- [02-glossary-and-terminology.md](./02-glossary-and-terminology.md) — 术语规范
- [12-human-interaction-contracts.md](./12-human-interaction-contracts.md) — 人类交互接触点的详细操作规范

**相关参考**：
- [10-autonomous-execution-model.md](./10-autonomous-execution-model.md) — 自主执行的生命周期机制
- [22-quality-risk-and-compliance.md](./22-quality-risk-and-compliance.md) — 安全和质量属性

---

**版本历史**：
- v2.0 (2026-01-31): 将隐喻转化为正式操作模型，明确责任边界
- v1.0 (2026-01-15): 初始版本（已归档至 `overview.md` + `value-propositions.md`）
