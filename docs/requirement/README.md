# 需求文档导航 (Requirements Navigation)

**文档版本**: 3.0 (从第一性原理重组)  
**最后更新**: 2026-01-31  
**状态**: Phase 2 完成，Tier 2 能力文档已建立

---

## ⚡ 快速开始

### 新成员入口（30分钟理解核心）

**第一步** → 阅读 [00-vision-and-problem.md](./00-vision-and-problem.md)  
理解：为什么PonyBunny存在？什么是"自主完成"？

**第二步** → 阅读 [01-ai-employee-paradigm.md](./01-ai-employee-paradigm.md)  
理解：AI与人类的责任边界，何时自主、何时升级

**第三步** → 浏览 [02-glossary-and-terminology.md](./02-glossary-and-terminology.md)  
熟悉：Work Order、Goal、Escalation等核心术语

**完成标志**: 你能用一句话解释PonyBunny，并判断特定情况下AI应自主还是升级

---

## 📚 按角色导航

### 产品经理 / 战略决策者

**阅读路径**: 00 → 01 → 10 → 20 → 21

| 顺序 | 文档 | 核心问题 |
|:-----|:-----|:---------|
| 1 | [00-vision-and-problem.md](./00-vision-and-problem.md) | 为什么做？目标用户是谁？成功指标是什么？ |
| 2 | [01-ai-employee-paradigm.md](./01-ai-employee-paradigm.md) | AI员工vs助手的本质区别？ |
| 3 | [10-autonomous-execution-model.md](./10-autonomous-execution-model.md) | 自主性如何运作？ |
| 4 | `20-capability-requirements.md` ⏳ | 必须实现哪些能力？（Phase 3） |
| 5 | `21-scenarios-and-user-stories.md` ⏳ | 真实用户旅程如何？（Phase 3） |

**关键交付物**:
- 成功指标定义（Autonomy Rate >70%, Shift ≥8h）
- 目标用户画像（独立开发者、自雇者、小团队）
- 非目标边界（不做企业协作、No-Code、通用框架）

---

### 架构师 / 技术Leader

**阅读路径**: 01 → 02 → 10 → 11 → 20 → 22

| 顺序 | 文档 | 核心问题 |
|:-----|:-----|:---------|
| 1 | [01-ai-employee-paradigm.md](./01-ai-employee-paradigm.md) | 责任边界和升级规则是什么？ |
| 2 | [02-glossary-and-terminology.md](./02-glossary-and-terminology.md) | 术语规范（建立共同语言） |
| 3 | [10-autonomous-execution-model.md](./10-autonomous-execution-model.md) | 执行生命周期机制？ |
| 4 | [11-work-order-system.md](./11-work-order-system.md) | Work Order实体模型和不变量？ |
| 5 | `20-capability-requirements.md` ⏳ | 能力需求详细规范？（Phase 3） |
| 6 | `22-quality-risk-and-compliance.md` ⏳ | 安全、性能、成本约束？（Phase 3） |

**关键交付物**:
- Work Order System架构设计
- Autonomy Daemon调度机制
- Quality Gates验证流程
- Escalation升级策略

**现有参考**（待重组）:
- [work-order-system.md](./work-order-system.md) — 已拆分为10+11（Phase 2完成）
- [system-boundaries.md](./system-boundaries.md) — 已拆分为12+13（Phase 2完成）

---

### 开发工程师

**阅读路径**: 01 → 02 → 10 → 11 → 20 → 22

| 顺序 | 文档 | 核心问题 |
|:-----|:-----|:---------|
| 1 | [01-ai-employee-paradigm.md](./01-ai-employee-paradigm.md) | 我需要实现哪些责任边界？ |
| 2 | [02-glossary-and-terminology.md](./02-glossary-and-terminology.md) | 代码中使用哪些标准术语？ |
| 3 | [10-autonomous-execution-model.md](./10-autonomous-execution-model.md) | 状态机和生命周期如何实现？ |
| 4 | [11-work-order-system.md](./11-work-order-system.md) | 数据模型schema和API？ |
| 5 | `20-capability-requirements.md` ⏳ | 每个能力的验收标准？（Phase 3） |
| 6 | `22-quality-risk-and-compliance.md` ⏳ | 安全和质量约束？（Phase 3） |

**现有参考**（待重组）:
- [functional-requirements.md](./functional-requirements.md) — Phase 3将重组为20
- [non-functional-requirements.md](./non-functional-requirements.md) — Phase 3将整合到22

**工程文档**（技术实现）:
- [../engineering/architecture.md](../engineering/architecture.md) — 系统架构
- [../engineering/work-order-system.md](../engineering/work-order-system.md) — Work Order实现

---

### 安全工程师 / 运维

**阅读路径**: 02 → 13 → 22 → 11

| 顺序 | 文档 | 核心问题 |
|:-----|:-----|:---------|
| 1 | [02-glossary-and-terminology.md](./02-glossary-and-terminology.md) | 术语规范 |
| 2 | [13-system-boundaries-and-operating-context.md](./13-system-boundaries-and-operating-context.md) | 系统边界和权限范围？ |
| 3 | `22-quality-risk-and-compliance.md` ⏳ | 威胁模型和控制措施？（Phase 3） |
| 4 | [11-work-order-system.md](./11-work-order-system.md) | 审计日志和可追溯性？ |

**现有参考**（待重组）:
- [security-threat-model.md](./security-threat-model.md) — Phase 3将整合到22
- [system-boundaries.md](./system-boundaries.md) — 已拆分为12+13（Phase 2完成）

---

## 🗂️ 文档结构（4层金字塔）

### ✅ Tier 1: 基础文档 (WHY + WHAT) — 已完成

战略层，定义愿景和范式

| 文档 | 状态 | 目标受众 |
|:-----|:-----|:---------|
| [00-vision-and-problem.md](./00-vision-and-problem.md) | ✅ v2.0 | 所有角色 |
| [01-ai-employee-paradigm.md](./01-ai-employee-paradigm.md) | ✅ v2.0 | 所有角色 |
| [02-glossary-and-terminology.md](./02-glossary-and-terminology.md) | ✅ v2.0 | 所有角色 |
| README.md (本文档) | ✅ v3.0 | 所有角色 |

### ✅ Tier 2: 能力文档 (HOW - 概念) — 已完成

架构层，定义核心机制

| 文档 | 状态 | 来源 |
|:-----|:-----|:-----|
| [10-autonomous-execution-model.md](./10-autonomous-execution-model.md) | ✅ v2.0 | 从 work-order-system.md 拆分生命周期部分 |
| [11-work-order-system.md](./11-work-order-system.md) | ✅ v2.0 | 从 work-order-system.md 保留实体模型 |
| [12-human-interaction-contracts.md](./12-human-interaction-contracts.md) | ✅ v2.0 | 从 user-stories.md + system-boundaries.md 提取 |
| [13-system-boundaries-and-operating-context.md](./13-system-boundaries-and-operating-context.md) | ✅ v2.0 | 从 system-boundaries.md 重构 |

### ⏳ Tier 3: 规范文档 (HOW - 详细) — Phase 3

实现层，定义详细需求

| 文档 | 状态 | 来源 |
|:-----|:-----|:-----|
| `20-capability-requirements.md` | ⏳ Phase 3 | 重组 functional-requirements.md + non-functional-requirements.md |
| `21-scenarios-and-user-stories.md` | ⏳ Phase 3 | 重构 user-stories.md（成功+失败路径） |
| `22-quality-risk-and-compliance.md` | ⏳ Phase 3 | 合并 security-threat-model.md + NFR安全部分 |

### Tier 4: 治理

| 文档 | 状态 |
|:-----|:-----|
| [CHANGELOG.md](./CHANGELOG.md) | ✅ 持续更新 |
| [REORGANIZATION_PLAN.md](./REORGANIZATION_PLAN.md) | ✅ 重组计划 |

---

## 🔄 重组进度

### ✅ Phase 1: 基础文档（已完成 2026-01-31）

**交付物**:
- ✅ `00-vision-and-problem.md` (1067行)
- ✅ `01-ai-employee-paradigm.md` (573行)
- ✅ `02-glossary-and-terminology.md` (680行)
- ✅ `README.md` 更新（角色导航）

**总计**: 2320行新文档，建立从第一性原理的需求基础

### ⏳ Phase 2: 能力文档（已完成 2026-01-31）

**交付物**:
- ✅ `10-autonomous-execution-model.md` (810行) — 8阶段执行生命周期
- ✅ `11-work-order-system.md` (1117行) — 实体模型、SQL schema、ERD
- ✅ `12-human-interaction-contracts.md` (920行) — 7个人类交互接触点
- ✅ `13-system-boundaries-and-operating-context.md` (600行) — 系统边界、依赖、集成接口

**总计**: 3447行新文档，建立自主执行的概念架构

### ⏳ Phase 3: 规范文档（计划 Week 3）

**待创建**:
- `20-capability-requirements.md` — 按能力组织的需求
- `21-scenarios-and-user-stories.md` — 用户旅程
- `22-quality-risk-and-compliance.md` — 质量和安全

---

## 📋 旧文档状态

### 保留（暂时）

在Phase 2-3完成前，以下文档继续有效：

| 文档 | 状态 | 说明 |
|:-----|:-----|:-----|
| [overview.md](./overview.md) | 📦 归档参考 | 内容已拆分到00+01 |
| [value-propositions.md](./value-propositions.md) | 📦 归档参考 | 核心隐喻已迁移到01 |
| [work-order-system.md](./work-order-system.md) | 📦 归档参考 | 已拆分为10+11 |
| [functional-requirements.md](./functional-requirements.md) | ✅ 有效 | Phase 3将重组为20 |
| [non-functional-requirements.md](./non-functional-requirements.md) | ✅ 有效 | Phase 3将整合到22 |
| [user-stories.md](./user-stories.md) | 📦 归档参考 | 已拆分为12+21 |
| [system-boundaries.md](./system-boundaries.md) | 📦 归档参考 | 已拆分为12+13 |
| [security-threat-model.md](./security-threat-model.md) | ✅ 有效 | Phase 3将整合到22 |
| [CHANGELOG.md](./CHANGELOG.md) | ✅ 持续维护 | 记录所有变更 |

### 迁移计划

完成Phase 2-3后，旧文档将移至 `archive/v1.0/` 目录。

---

## 🎯 核心要点速查

### 第一性原理

> **知识工作的委派瓶颈**：即使任务明确，人类仍需持续监督（澄清、分解、监控、恢复、打包）。  
> **PonyBunny解决方案**：将可委派工作转为自主、持久的执行——人类设定目标，AI完整交付。

### 成功指标（北极星）

| 指标 | 目标值 | 为什么重要 |
|:-----|:-------|:----------|
| **Work Item自主完成率** | \u003e 70% | 核心自主性指标 |
| **连续工作时长（Shift）** | ≥ 8小时 | 验证"可放手不管" |
| **Quality Gate通过率** | \u003e 80% | 验证自我质量保证 |

### AI vs 人类责任边界

**AI负责（自主执行）**:
- 分解目标为work items
- 执行代码/测试/工具调用
- 运行Quality Gates
- 从错误恢复（<3次重试）
- 打包Artifacts和Escalation Packet

**人类负责（目标和审批）**:
- 设定高层目标
- 批准风险操作（DB migration、生产部署）
- 处理Escalation
- Review最终PR

### 何时升级？

- 连续3次相同错误
- Budget耗尽（Token/时间/成本）
- 目标定义模糊
- 缺少凭证（API Key）
- 触及风险边界（删除生产数据）

---

## 🔗 相关资源

### 工程文档（技术实现）

- [../engineering/](../engineering/) — 工程实现文档（8文档，8359行）
  - [architecture.md](../engineering/architecture.md) — 系统架构
  - [work-order-system.md](../engineering/work-order-system.md) — Work Order实现
  - [scheduling.md](../engineering/scheduling.md) — Lane调度
  - [database.md](../engineering/database.md) — 数据库设计

### 代码仓库

- [/src/work-order/](../../src/work-order/) — Work Order System实现
- [/src/autonomy/](../../src/autonomy/) — Autonomy Daemon实现

---

## ❓ 常见问题

**Q: 我应该从哪个文档开始？**  
A: 新成员从 [00-vision-and-problem.md](./00-vision-and-problem.md) 开始。按角色选择阅读路径（见上方）。

**Q: Phase 2/3什么时候完成？**  
A: Phase 2计划Week 2（能力文档），Phase 3计划Week 3（规范文档）。关注 [CHANGELOG.md](./CHANGELOG.md) 获取更新。

**Q: 旧文档（overview.md等）还能看吗？**  
A: 可以参考，但Tier 1新文档（00-02）是权威来源。旧文档在Phase 2-3完成后归档。

**Q: 术语不一致怎么办？**  
A: [02-glossary-and-terminology.md](./02-glossary-and-terminology.md) 是单一真理来源。发现冲突请提Issue。

**Q: 如何贡献/修改需求？**  
A: 提交PR，修改对应Tier文档。重大变更需团队review。更新CHANGELOG.md。

---

**文档维护**:
- 负责人：PonyBunny Product Team
- 更新频率：按Sprint审查核心文档（00-02），按需更新其他
- 反馈渠道：GitHub Issues
- 变更记录：[CHANGELOG.md](./CHANGELOG.md)

---

**版本历史**:
- v3.0 (2026-01-31): 从第一性原理重组，建立4层文档架构，完成Phase 1
- v2.0 (2026-01-15): AI员工范式转变（已归档）
- v1.0 (2025-12-01): 初始版本（已归档）
