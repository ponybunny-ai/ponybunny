# 需求文档重组计划 (Requirements Reorganization Plan)

**日期**: 2026-01-31  
**目的**: 从第一性原理重新梳理需求，建立从宏观到微观、从抽象到具体的清晰层次结构

---

## 核心问题陈述 (从第一性原理出发)

### 我们要解决的本质问题

知识工作存在**委派瓶颈**：即使任务定义明确，人类仍必须持续监督执行（澄清需求、分解任务、监控进度、错误恢复、打包结果）。这种"注意力税"使复杂工作既昂贵又缓慢，并且阻止了长期任务的可靠外包。

**PonyBunny的存在意义**：将可委派的工作转变为自主、持久的执行，让人类可以移交任务，稍后返回时看到完成的结果（或明确打包的失败及后续步骤）。

### 基本能力（一句话）

**PonyBunny接受工作目标，自主规划、执行、监控并交付结果，只需最少的人类干预。**

### 不可简化的核心组件（缺一不可）

1. **工作合约 (Work Contract)**: 定义"完成"标准、约束条件、输入输出、升级规则（否则自主性无定义）
2. **分解与规划 (Decomposition + Planning)**: 将目标转为可执行步骤，选择工具/动作（否则无法连贯行动）
3. **执行运行时 (Execution Runtime)**: 随时间运行步骤、管理状态、错误恢复、跨长时段持续工作（否则无法"放手不管"）
4. **证据与交付物 (Evidence + Artifacts)**: 持久化输出、日志、中间结果、可追溯性（否则无法信任或复用结果）
5. **评估与交接 (Evaluation + Hand-off)**: 对照工作合约自检、打包交付物、浮出不确定性/升级（否则完成率无意义）

---

## 新文档结构（4层架构）

### 最小可行概念模型

**"AI员工执行工作订单：它承诺工作合约、生产交付物、并对进度、自我评估和升级负责。"**

这是解释自主性、持久性和信任的最小模型，不绑定实现细节。

---

## 文档分层

### Tier 1: 基础文档 (WHY + WHAT) — 战略层

定位受众：产品、管理层、新加入成员

| 序号 | 文档名 | 目的 | 核心价值 |
|:-----|:------|:-----|:---------|
| 00 | `00-vision-and-problem.md` | 为什么存在、"自主工作"的定义 | WHY的单一真理来源、成功指标 |
| 01 | `01-ai-employee-paradigm.md` | AI助手vs AI员工的正式模型 | 锚定语言和期望，避免重复 |
| 02 | `02-glossary-and-terminology.md` | 规范定义和命名 | 消除重复和语义漂移 |
| -- | `README.md` | 导航索引（仅路由功能） | 新人入口，非需求容器 |

**核心内容**：

**00-vision-and-problem.md**:
- 问题陈述：委派瓶颈
- 为什么是现在
- "自主完成"的定义
- 成功指标：>70%自主完成率、≥8小时工作班次
- 非目标

**01-ai-employee-paradigm.md**:
- AI助手 vs AI员工的责任边界
- 升级哲学
- 基于证据的问责制模型
- 人类与AI的分工

**02-glossary-and-terminology.md**:
- Work Order / Goal / Work Item / Run / Artifact
- Autonomy rate / Shift / Escalation / "Done"
- 标准术语规范

---

### Tier 2: 能力文档 (HOW - 概念层) — 架构层

定位受众：产品经理、架构师、开发团队

| 序号 | 文档名 | 目的 | 核心价值 |
|:-----|:------|:-----|:---------|
| 10 | `10-autonomous-execution-model.md` | 自主性的核心机制（概念） | 解释"如何从根本上运作" |
| 11 | `11-work-order-system.md` | 工作订单作为操作抽象 | 自主工作的"会计系统" |
| 12 | `12-human-interaction-contracts.md` | 人类进入循环的所有接触点 | 使自主性可理解、定义何时需要人类 |
| 13 | `13-system-boundaries-and-operating-context.md` | 何时/何地适用 | 防止"自主性蔓延"和模糊责任 |

**核心内容**：

**10-autonomous-execution-model.md**:
- 工作生命周期
- 状态机
- 进度语义
- 错误恢复
- 评估循环
- 升级触发器

**11-work-order-system.md**:
- 实体：Goals → Work Items → Runs → Artifacts
- 不变量
- 可追溯性
- 幂等性期望

**12-human-interaction-contracts.md**:
- 接收（简报）
- 澄清协议
- 中途检查点
- 批准
- 交接
- 失败打包

**13-system-boundaries-and-operating-context.md**:
- 范围内 vs 范围外的工作
- 工具边界
- 数据边界
- 权限
- 部署上下文

---

### Tier 3: 规范文档 (HOW - 详细层) — 实现层

定位受众：开发工程师、QA、安全团队

| 序号 | 文档名 | 目的 | 核心价值 |
|:-----|:------|:-----|:---------|
| 20 | `20-capability-requirements.md` | 按自主能力组织的需求 | 与概念模型同构的需求 |
| 21 | `21-scenarios-and-user-stories.md` | 验证能力模型的具体旅程 | 现实检查 |
| 22 | `22-quality-risk-and-compliance.md` | 跨领域关注点整合 | 安全/性能/成本不在平行宇宙 |

**核心内容**：

**20-capability-requirements.md** (按能力区域组织):
- 工作接收与合约形成
- 规划与分解
- 执行与工具使用
- 长期运行持久性（班次、恢复）
- 可观测性与证据（交付物、日志）
- 自我评估与质量门禁
- 升级与人类协作
- 输出打包与交付

**21-scenarios-and-user-stories.md**:
- 主要用户旅程
- 失败旅程
- 边缘案例旅程
- 每个场景的验收标准

**22-quality-risk-and-compliance.md**:
- 质量属性（可靠性、安全性、延迟、成本、隐私）映射到能力区域
- 威胁模型（嵌入或链接附录）
- 控制/不变量（最小权限、可审计性、安全默认）

---

### Tier 4: 变更与治理

| 文档名 | 目的 |
|:------|:-----|
| `CHANGELOG.md` | 版本化的需求变更历史 |

---

## 迁移策略

### 需要合并的文档

| 源文档 | 目标文档 | 理由 |
|:------|:---------|:-----|
| `overview.md` + `value-propositions.md` | → `01-ai-employee-paradigm.md` | 都定义概念框架和价值；价值主张作为章节而非独立支柱 |
| `functional-requirements.md` + `non-functional-requirements.md` | → `20-capability-requirements.md` + `22-quality-risk-and-compliance.md` | 对于自主系统，功能/非功能的划分是人为的；质量属性应附加到能力上 |
| `security-threat-model.md` + NFR中的安全部分 | → `22-quality-risk-and-compliance.md` | 威胁/控制必须与它们保护的表面一起阅读 |

### 需要拆分的文档

| 源文档 | 目标文档 | 理由 |
|:------|:---------|:-----|
| `work-order-system.md` | → `10-autonomous-execution-model.md` + `11-work-order-system.md` | 生命周期语义（"自主性如何运作"）和实体模型（"工作如何表示"）是不同的；拆分降低概念负载 |
| `user-stories.md` | → `21-scenarios-and-user-stories.md` (两部分) | 明确区分"成功路径"和"失败/升级路径"，因为自主性由失败处理定义，如同成功一样 |

### 需要重构的文档

**README.md**:
- 移除需求内容
- 成为基于角色的入口，提供3条阅读路径：
  - 产品/战略路径：00 → 01 → 10 → 20 → 21
  - 工程路径：01 → 02 → 10 → 11 → 20 → 22
  - 安全/运维路径：02 → 13 → 22 → 11

**system-boundaries.md**:
- 将实际上是"人类交互规则"的边界声明移至 `12-human-interaction-contracts.md`
- 将范围/范围内/范围外保留在 `13-system-boundaries-and-operating-context.md`

---

## 关键洞察

### 当前分散的内容

**"自主性"定义**: 完成率、班次长度、"完成"的定义倾向于泄漏到多个文档
- **解决方案**: 集中在 `00-vision-and-problem.md` + `02-glossary-and-terminology.md`

**升级哲学**: 隐式出现在故事、边界、安全中
- **解决方案**: 在 `01-ai-employee-paradigm.md` 中明确一次，在 `12-human-interaction-contracts.md` 中操作化

**信任/证据模型**: 当前在架构和需求之间分裂
- **解决方案**: 在 `11-work-order-system.md` 中作为一等公民概念，其他地方引用

### 当前缺失的内容

1. **单一生命周期叙述**: 新团队成员可以阅读以理解"从目标到交付物发生了什么"（→ `10-autonomous-execution-model.md`）

2. **人类接触点的规范合约**: AI何时必须询问、何时不能、如何打包不确定性/失败（→ `12-human-interaction-contracts.md`）

3. **质量属性映射到能力**: 不浮在单独的NFR宇宙（→ `22-quality-risk-and-compliance.md`）

### 当前冗余的内容

- Work Order实体的重复定义
- "AI员工"隐喻的重复陈述

**解决方案**:
- 一个正式的隐喻文档 (`01-ai-employee-paradigm.md`)
- 一个术语表 (`02-glossary-and-terminology.md`)
- 其他所有内容链接到这些，而不是重新解释

---

## 特定问题的回答

### Q1: "Work Order System"是顶级概念还是实现细节？

**回答**: 视为**顶级概念抽象**（Tier 2），非仅实现。

**理由**: "可以放手不管"的自主性需要持久状态、可追溯性、可恢复性和问责制——这些从根本上由Work Order系统提供（即使实现变化）。*确切*的模式是实现细节；*工作会计模型的存在*是第一性原理。

### Q2: 功能性vs非功能性还合适吗？

**回答**: 对于PonyBunny，这种划分掩盖了重要内容。主要组织应该是：
- **能力区域**（必须能够自主做什么）
- **人类交互点**（自主性有意限定的地方）
- **边界**（适用的地方）
- **质量属性**映射到每个能力（可靠性、安全性、成本、性能、隐私）

因此：用 `20-capability-requirements.md` + `22-quality-risk-and-compliance.md` 替换"FR/NFR"。

### Q3: 如何整合"AI员工"隐喻而不重复？

**回答**: 作为**规范模型**定义一次：
- 在 `01-ai-employee-paradigm.md` 中：责任、升级规则、问责制，以及"良好员工行为"在操作上的含义
- 通过 `02-glossary-and-terminology.md` + 简短的"写作规则"强制执行：其他文档必须链接回去而不是重新陈述
- 仅在决策点使用隐喻：责任边界、评估、升级和交接——而不是作为每个章节的装饰

---

## 实施计划

### Phase 1: 创建基础文档（Week 1）

**优先级**: P0

**交付物**:
- [ ] `00-vision-and-problem.md` — 从现有 `overview.md` 提取WHY部分
- [ ] `01-ai-employee-paradigm.md` — 合并 `overview.md` + `value-propositions.md` 的核心隐喻
- [ ] `02-glossary-and-terminology.md` — 从所有文档提取术语定义
- [ ] 更新 `README.md` — 创建角色导航路径

### Phase 2: 创建能力文档（Week 2）

**优先级**: P0

**交付物**:
- [ ] `10-autonomous-execution-model.md` — 从 `work-order-system.md` 拆分生命周期部分
- [ ] `11-work-order-system.md` — 保留实体模型和不变量
- [ ] `12-human-interaction-contracts.md` — 从 `user-stories.md` + `system-boundaries.md` 提取交互点
- [ ] `13-system-boundaries-and-operating-context.md` — 从 `system-boundaries.md` 重构

### Phase 3: 创建规范文档（Week 3）

**优先级**: P1

**交付物**:
- [ ] `20-capability-requirements.md` — 重组 `functional-requirements.md` + `non-functional-requirements.md`
- [ ] `21-scenarios-and-user-stories.md` — 重构 `user-stories.md`，分为成功/失败路径
- [ ] `22-quality-risk-and-compliance.md` — 合并 `security-threat-model.md` + NFR安全部分

### Phase 4: 清理和验证（Week 4）

**优先级**: P1

**活动**:
- [ ] 删除旧文档（移至 `archive/` 目录）
- [ ] 验证所有交叉引用正确
- [ ] 团队审查新结构
- [ ] 更新 `CHANGELOG.md`

---

## 成功标准

### 可用性指标

- [ ] 新团队成员能在30分钟内理解核心概念（通过Tier 1文档）
- [ ] 每个角色有清晰的阅读路径（产品/工程/安全）
- [ ] 没有概念在多个文档重复定义

### 技术指标

- [ ] 所有原始需求内容保留（无遗失）
- [ ] 所有文档内部交叉引用有效
- [ ] 术语使用一致（通过 `02-glossary` 验证）

### 维护指标

- [ ] 新需求有明确的归属文档（不模糊）
- [ ] 跨领域关注点（安全/性能）有单一入口

---

## 风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|:-----|:-----|:-----|:---------|
| 迁移期间内容丢失 | 高 | 中 | 使用Git分支，每个阶段独立PR，团队审查 |
| 新结构不适应未来需求 | 中 | 中 | 保留升级触发器（见下文） |
| 团队抵制变化 | 中 | 低 | 早期征求反馈，渐进式迁移 |

### 升级触发器（何时重新审视结构）

- 如果引入多个执行运行时或显著分歧的部署模式（可能需要单独的"平台规范"层）
- 如果正式化外部合规制度（SOC2/ISO等）（`22-quality-risk-and-compliance.md` 可能拆分为"控制" vs "威胁模型" vs "保证证据"）

---

**编制者**: Oracle + Sisyphus  
**审批**: [待填写]  
**最后更新**: 2026-01-31  
**版本**: 1.0 (草案)
