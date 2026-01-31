# PonyBunny - 自主AI员工系统

## 核心范式转变

**从"AI助手"到"AI员工"**

PonyBunny不是帮助人类的工具，而是**能够独立完成整个工作流程的数字劳动力**。

```
传统AI助手：人类发指令 → AI执行 → 人类验收
PonyBunny员工：人类设目标 → AI自主计划+执行+验证 → 交付成果
```

## Work Order System（工作订单系统）

这是PonyBunny的核心架构创新，将AI从"响应式"转变为"目标驱动"。

### 完整生命周期

```
1. Goal Intake（接收目标）
   ↓ "实现用户登录功能"
   
2. Goal Elaboration（目标细化）
   ↓ 分析需求、技术栈、现有代码
   
3. Planning（生成计划）
   ↓ 分解为Work Items：
      - 数据库schema
      - 会话中间件  
      - 登录路由
      - 单元测试
      - 集成测试
   
4. Execute Loop（执行循环）
   ├─ ReAct: Observation → Thought → Action
   ├─ Tool Chaining（工具串联）
   └─ Subagent Delegation（委派子任务）
   
5. Verify（质量验证）
   ├─ Deterministic Gates
   │   ├─ Tests Pass ✓
   │   ├─ Build Succeeds ✓
   │   └─ Lint Clean ✓
   └─ LLM Review（次要）
   
6. Review（自我评审）
   ├─ 达标 → Publish Artifacts
   └─ 未达标 → Iterate or Escalate
   
7. Monitor（持续监控）
   └─ 长期维护和改进
```

## 六大自主能力

### 1. Goal-Driven Execution（目标驱动执行）

**技术实现**：
- Work Item Queue（持久化任务队列）
- Goal Backlog（长期目标存储）
- Planner（目标分解器）

**真实场景**：
```
输入：提升代码质量
自主分解：
  1. 全量lint扫描
  2. 修复Top 10错误
  3. 添加pre-commit hook
  4. 生成质量报告
  5. 设置每周监控任务
```

### 2. Autonomous Loop（自主循环）

**Autonomy Daemon**（基于Cron Lane）：
```python
while True:
    work_item = queue.select_next()  # 按优先级+依赖
    run = execute_react_cycle(work_item, budget)
    
    if run.success:
        verify_and_publish()
    elif budget.exhausted:
        escalate_to_human(escalation_packet)
    else:
        retry_with_plan_b()
```

### 3. Self-Verification（自我验证）

**质量门禁架构**：
```
Definition of Done（自动生成）
  ↓
Verification Plan
  ├─ Tests（优先）
  ├─ Build
  ├─ Lint
  ├─ Security Scan
  └─ LLM Review（辅助）
```

**核心原则**：LLM判断不能override failing tests

### 4. Multi-Day Persistence（多日持久化）

**存储架构**：
- Work Graph（任务关系）
- Artifacts（工作成果）
- Decisions Log（决策记录）
- Context Packs（结构化快照）

**操作节奏**：
- Heartbeat：每15分钟执行一次work cycle
- Daily Rollup：每天总结进度
- Weekly Review：重新规划长期目标

### 5. Error Recovery（错误恢复）

**四层恢复机制**：
```
Error → Tier 1: Auto-Retry (3次)
       → Tier 2: Model Failover
       → Tier 3: Plan B（切换策略）
       → Tier 4: Escalation Packet
```

**升级策略**（明确规则）：
- 连续3次相同错误 → 升级
- 触及风险边界（安全/生产） → 请求批准
- 缺少凭证/歧义 → 询问

### 6. Continuous Operation（持续运行）

**持续工作模式**：
```
永久Goal: "监控并改善代码库"
  ↓
Recurring Subgoals:
  - Daily: Triage PRs/Issues
  - Daily: 依赖安全检查
  - Weekly: 代码覆盖率分析
  - Event: PR opened → Auto-review
```

## 核心隐喻重新诠释

### 🐴 Durable — "像老员工一样可靠"
完整的工作档案系统：Work Orders + Artifacts + Decisions Log

### 🐰 Fast — "高效执行不拖延"
Lane-based调度 + Parallel Subagents + Smart Caching

### 🏠 Local-first — "你的员工你控制"
本地运行 + 离线可用 + 完全可审计

### 🔒 Security-first — "可信赖的员工"
明确的权限边界：自主/需批准/禁止

### ✂️ Trim-to-fit — "按需雇佣成本可控"
简单任务用便宜模型（实习生）+ 复杂任务用强模型（高级工程师）

### 👥 Know Your AI — "像了解员工一样"
工作计划可见 + 执行可追溯 + 质量标准明确 + 升级原因清晰

## 目标用户

### 需要"数字劳动力"的个人/小团队

1. **独立开发者**：希望Agent像全职DevOps工程师
2. **自雇者**：需要Agent像项目经理+执行助理
3. **小微团队**：Agent作为额外团队成员
4. **研究人员**：Agent像研究助理处理文献和实验

## 非目标

- ❌ 不是对话式AI助手（核心是自主工作）
- ❌ 不是No-Code平台（核心是AI推理）
- ❌ 不是企业协作系统（核心是个人劳动力）

## 技术架构

```
Autonomy Daemon (Cron Lane)
  ↓
Work Order System (NEW)
  ↓
ReAct Loop (EXISTING)
  ↓
Quality Gates (Deterministic)
  ↓
Persistence (Artifacts + State)
```

## 演进路线

### Phase 1: Work Order MVP（3-4周）
- Work Order数据模型
- Autonomy Daemon
- Quality Gates
- Escalation策略

**验证**：Agent自主完成"实现登录功能"（分解→执行→测试→PR）

### Phase 2: 多日持久化（4-6周）
- Context Packs
- Artifacts管理
- Daily Rollup
- Checkpoint/Resume

**验证**：5天重构项目，每天自主工作并checkpoint

### Phase 3: 高级能力（8-12周）
- Multi-Agent Org
- 学习机制
- 主动提案
- 跨仓库协作

## 成功指标

### 自主性（核心KPI）
- Work Item自主完成率 > 70%
- 平均升级次数 < 2次/goal
- Quality Gate通过率 > 80%
- 多日任务成功率 > 60%

### 效率
- 连续工作时长 ≥ 8小时
- 日均完成work items：5-10个

### 质量
- 测试覆盖率 > 80%
- Build成功率 > 95%
- Lint违规率 < 5%

### 成本
- 月API成本 < $10
- 支持本地运行（零成本）

## 范式总结

| 维度 | AI工具 | AI员工（PonyBunny） |
|:-----|:------|:------------------|
| 定位 | 增强人类 | **替代工作流** |
| 触发 | 被动响应 | **主动执行** |
| 范围 | 单次任务 | **长期项目** |
| 责任 | 人类验收 | **自我验证** |
| 失败 | 报错 | **自主恢复** |

**第一性原理**：
> 接收问题 → 完全自主地解决 → 交付验证过的结果

**人类角色**：目标设定 + 质量审批 + 异常处理  
**Agent角色**：计划 + 执行 + 验证 + 持续改进

这不是"更好的ChatGPT"，而是**你的第一个数字员工**。
