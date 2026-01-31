# 需求文档索引 (Requirements Index)

## ⚠️ 重大范式转变：从"AI助手"到"AI员工"

PonyBunny的需求文档已经**彻底重构**，反映核心定位的根本性转变：

```
旧范式：AI助手（响应式工具）
新范式：AI员工（目标驱动的自主工作者）
```

**核心差异**：
- 不是"帮人类做事"，而是**"替代人类完成整个工作流"**
- 不是"等待指令"，而是**"主动执行工作订单"**
- 不是"单次任务"，而是**"多日长期项目"**
- 不是"报错给人类"，而是**"自动重试 + Plan B + 升级"**

---

## 📚 核心文档导航

### 🎯 1. [项目概述](./overview.md) `必读 - 已完全重写`
**目标受众**：所有角色（产品、开发、管理层）

**核心内容**：
- **Work Order System生命周期**：
  ```
  Goal Intake → Planning → Execute → Verify → Publish → Monitor
  ```
- **六大自主能力**：
  1. Goal-Driven Execution（目标驱动）
  2. Autonomous Loop（自主循环）
  3. Self-Verification（自我验证）
  4. Multi-Day Persistence（多日持久化）
  5. Error Recovery（错误恢复）
  6. Continuous Operation（持续运行）

- **新成功指标**：
  - Work Item自主完成率 > 70%
  - 连续工作时长 ≥ 8小时
  - Quality Gate通过率 > 80%
  - 月API成本 < $10（保持）

**关键结论**：
> PonyBunny不是"更好的ChatGPT"，而是**"你的第一个数字员工"**

---

### 🏗️ 2. [Work Order System](./work-order-system.md) `全新核心架构`
**目标受众**：架构师、开发工程师

**核心内容**：
- **数据模型设计**：
  - Goals表（高层目标）
  - Work Items表（具体任务）
  - Runs表（执行记录）
  - Artifacts表（交付物）
  - Decisions表（决策日志）

- **Autonomy Daemon**：
  ```python
  while True:
      work_item = select_next()  # 优先级+依赖
      run = execute_react_cycle(budget)
      if success: verify_and_publish()
      elif stuck: escalate(packet)
      else: retry_with_plan_b()
  ```

- **Quality Gates架构**：
  ```
  Tests Pass ✓ → Build ✓ → Lint ✓ → LLM Review（辅助）
  核心原则：LLM判断不能override failing tests
  ```

- **实施路线**：
  - Week 1-2: MVP（数据模型 + 基础循环）
  - Week 3-4: 质量增强（Verification + Escalation）
  - Week 5-8: 多日持久化（Artifacts + Checkpoint）

**关键结论**：
> Work Order System是从"被动响应"到"主动工作"的架构核心

---

### 📋 3. [功能需求](./functional-requirements.md) `部分调整`
**目标受众**：产品经理、开发工程师

**主要调整**：
- **多租户 → 多Session隔离**（个人/小团队场景）
- **成本优化升至P0**（个人用户核心）
- **规模指标降低**（10,000用户 → 10用户）

**优先级重排**：
- P0（MVP核心）：7个需求（+Work Order System）
- P1（体验增强）：6个需求
- P2（社区生态）：4个需求

---

### 📊 4. [非功能需求](./non-functional-requirements.md) `部分调整`
**目标受众**：架构师、运维工程师、QA

**主要调整**：
- **吞吐量**：500+连接 → 10+连接
- **可用性**：99.5% → 99%（个人可接受）
- **扩展性**：水平扩展 → 单机优化
- **部署**：Kubernetes → Docker Compose

**关键指标保持**：
- P95响应延迟 < 2秒
- Docker沙箱逃逸率 0%
- 内存占用 < 2GB

---

### 📖 5. [用户故事](./user-stories.md) `已完全重写`
**目标受众**：产品经理、UX设计师

**新增个人自主场景**：
- ✅ 早晨自动唤醒与信息汇总（Cron + TTS）
- ✅ 长期学习伙伴（6个月记忆）
- ✅ 个人日记分析（隐私保护）
- ✅ 自动代码审查（GitHub Webhook）
- ✅ 完全本地运行（Ollama零成本）

**移除企业场景**：
- ❌ 100人企业部署
- ❌ SOC 2审计
- ❌ RBAC权限管理

**新格式强调自主性**：
```
作为 个人开发者
我想 Agent自主完成"实现登录功能"
以便 我专注于架构设计，而非重复编码

验收标准：
- [ ] Agent自主分解为5个work items
- [ ] 自主执行（写代码+测试+修复）
- [ ] 通过Quality Gates才标记完成
- [ ] 生成PR并等待人类review
```

---

### 🔗 6. [系统边界与集成点](./system-boundaries.md) `保持不变`
**目标受众**：架构师、集成工程师

**内容**：技术架构边界，无需调整

---

### 🔒 7. [安全威胁模型与防护](./security-threat-model.md) `保持不变`
**目标受众**：安全工程师、合规团队

**内容**：安全标准不降低，无需调整

---

### 💰 8. [关键价值主张](./value-propositions.md) `已完全重写`
**目标受众**：管理层、投资人

**新价值主张**：
- **Durable** — "像老员工一样可靠"（Work Orders + Artifacts + Decisions Log）
- **Fast** — "高效执行不拖延"（Lane调度 + Parallel Subagents）
- **Local-first** — "你的员工你控制"（本地运行 + 完全可审计）
- **Security-first** — "可信赖的员工"（明确权限边界）
- **Trim-to-fit** — "按需雇佣成本可控"（实习生模型 vs 高级工程师模型）
- **Know Your AI** — "像了解员工一样"（工作计划可见 + 执行可追溯）

**新ROI分析**（个人用户）：
- 成本节约：月$20 → $5-10（节省70%）
- 生产力提升：每天节省2小时（年价值$39K）
- 隐私价值：数据泄露风险为0（无价）

---

### 📝 9. [CHANGELOG](./CHANGELOG.md) `变更说明`
详细记录从"企业级AI Gateway"到"个人AI员工"的所有调整

---

## 🎯 新版快速查找指南

### 按角色查找

| 角色 | 核心文档 | 重点关注 |
|:-----|:--------|:--------|
| **产品经理** | Overview, Work Order System, User Stories | 自主能力、工作流设计 |
| **架构师** | Work Order System, Non-Functional | Autonomy Daemon、Quality Gates |
| **开发工程师** | Work Order System, Functional | 数据模型、执行循环实现 |
| **个人用户** | Overview, Value Propositions | 成本、隐私、自主性 |

---

### 按核心能力查找

| 能力 | 相关文档 |
|:-----|:--------|
| **Goal-Driven（目标驱动）** | Work Order System 1, Overview |
| **Autonomous Loop（自主循环）** | Work Order System 2, Overview |
| **Self-Verification（自我验证）** | Work Order System 3, Functional 需求 |
| **Multi-Day Persistence（多日持久化）** | Work Order System 5, Non-Functional |
| **Error Recovery（错误恢复）** | Work Order System 2, Functional 1.1 |
| **Continuous Operation（持续运行）** | Overview, User Stories |

---

### 按开发阶段查找

| 阶段 | 关键文档 | 核心交付 |
|:-----|:--------|:--------|
| **Phase 1 (Week 1-2)** | Work Order System | Goals/Work Items表, Autonomy Daemon基础 |
| **Phase 2 (Week 3-4)** | Work Order System | Quality Gates, Escalation Packet |
| **Phase 3 (Week 5-8)** | Work Order System | Artifacts管理, Checkpoint/Resume |

---

## 📊 新版需求统计

### 自主性指标（新增）

| 指标类型 | 核心KPI |
|:--------|:--------|
| **自主性** | Work Item自主完成率 > 70% |
| **效率** | 连续工作时长 ≥ 8小时 |
| **质量** | Quality Gate通过率 > 80% |
| **成本** | 月API开支 < $10 |

### 功能需求优先级（更新）

| 优先级 | 需求数量 | 主要变化 |
|:------|:--------|:--------|
| P0（MVP） | 7 | **+Work Order System** |
| P1（增强） | 6 | -RBAC, -水平扩展 |
| P2（社区） | 4 | +Tool Market, +模板 |

### 用户故事分布（更新）

| Epic类别 | 故事数量 | 主要变化 |
|:--------|:--------|:--------|
| **24x7自主化** | 3 | **新增：早晨播报、智能家居** |
| **个人知识管理** | 3 | **新增：日记分析、文献管理** |
| **生产力倍增** | 3 | **新增：自动代码审查、本地零成本** |
| 设备协同 | 3 | 保持 |
| 安全隐私 | 3 | 保持 |
| 用户体验 | 3 | 保持 |

---

## 🔄 核心特性追溯矩阵（更新）

### 新核心特性："Work Order System"

| 需求文档 | 章节 | 关键内容 |
|:--------|:-----|:--------|
| **Overview** | Work Order生命周期 | 8步流程、自主能力架构 |
| **Work Order System** | 完整设计 | 数据模型、Autonomy Daemon、Quality Gates |
| **Functional需求** | 新增P0需求 | 目标管理、自主执行、质量验证 |
| **User Stories** | 自主工作场景 | Agent独立完成"实现登录功能" |
| **Value Propositions** | 范式转变 | 从"工具"到"员工" |

### 保留核心特性："Docker沙箱隔离"

| 需求文档 | 章节 | 关键内容 |
|:--------|:-----|:--------|
| **Functional需求** | 1.3 沙箱执行 | 三层权限验证（不变） |
| **Non-Functional** | 4.3 沙箱安全 | 只读根文件系统（不变） |
| **Security Model** | 威胁3 沙箱逃逸 | 防护措施（不变） |

---

## 🚀 新版实施路线

### Week 1-2: Work Order MVP
**目标**：验证自主工作循环

**关键交付**：
- ✅ Goals/Work Items/Runs表
- ✅ Autonomy Daemon基础循环
- ✅ 简单Quality Gates（test/build/lint）

**验证场景**：
```
Goal: "添加health check端点"
→ Agent自主分解为3个work items
→ 自主执行（写代码+测试）
→ 通过gates后标记完成
```

---

### Week 3-4: 质量与升级
**目标**：支持错误恢复和人类升级

**关键交付**：
- ✅ Verification Plan自动生成
- ✅ Escalation Packet完整实现
- ✅ 多层retry机制

**验证场景**：
```
Goal: "实现JWT认证"
→ 遇到错误（缺少secret）
→ 自动重试2次
→ 生成Escalation Packet升级
→ 人类提供secret后恢复
```

---

### Week 5-8: 多日持久化
**目标**：支持跨天/跨周长期项目

**关键交付**：
- ✅ Context Packs（结构化快照）
- ✅ Artifacts管理
- ✅ Daily Rollup
- ✅ Checkpoint/Resume

**验证场景**：
```
Goal: "重构认证模块"（5天）
→ Day 1: 分析生成plan
→ Day 2-4: 逐步重构（每天checkpoint）
→ Day 5: 完成并生成PR
```

---

## 📝 文档维护策略（更新）

### 优先级更新频率
- **Work Order System**：每Sprint审查（核心架构）
- **功能需求**：每Sprint更新
- **用户故事**：基于用户反馈迭代
- **价值主张**：每季度审查（市场定位）

### 版本管理
- 所有变更遵循Git Flow
- 重大范式调整需要团队review
- 变更记录在CHANGELOG.md

---

## ✅ 新版验收检查清单

在开始开发前，确保理解以下核心转变：

- [ ] **范式理解**：从"AI助手"到"AI员工"的本质差异
- [ ] **Work Order System**：完整生命周期和数据模型
- [ ] **自主能力**：6大支柱的技术实现
- [ ] **质量保证**：确定性验证优先于LLM判断
- [ ] **升级策略**：何时自主处理 vs 何时升级人类
- [ ] **成本目标**：月API开支 < $10（个人用户）
- [ ] **成功指标**：70%自主完成率、8小时连续工作

---

## 🔗 相关资源

### 工程文档（技术实现）
- [系统架构](../engineering/architecture.md) — ReAct循环、Lane调度
- [调度机制](../engineering/scheduling.md) — Cron Lane实现
- [内存管理](../engineering/memory-management.md) — Compaction算法
- [模型性能](../engineering/model-performance.md) — Failover策略

### 新增文档
- [CHANGELOG](./CHANGELOG.md) — 完整变更记录
- [Work Order System](./work-order-system.md) — 核心架构设计

---

## 🎯 核心要点总结

### 第一性原理
> **接收问题 → 完全自主地解决 → 交付验证过的结果**

### 人类角色
- 目标设定者（定义high-level goals）
- 质量审批者（review最终PR）
- 异常处理者（处理Agent升级的复杂决策）

### Agent角色
- 计划制定者（将goal分解为work items）
- 执行者（coding/testing/debugging）
- 质量保证者（运行确定性验证）
- 持续改进者（从失败中学习）

---

**文档版本**：2.0（自主员工范式）  
**最后更新**：2026-01-31  
**维护者**：PonyBunny Product Team  
**核心变更**：从"AI Gateway"到"Autonomous AI Employee System"
