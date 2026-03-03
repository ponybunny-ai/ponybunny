# Session-First 生命周期改造开发计划（Session → Goal → Work Item → Run → Result）

> 日期：2026-03-02  
> 依据文档：`docs/engineering/session-goal-workitem-run-result-gap-analysis-2026-03-02.md`  
> 目标：将当前 Goal-First 主路径升级为 Session-First 闭环，并形成可执行、可回滚、可验证的开发任务蓝图。

---

## 1. 背景与目标

当前系统执行链路在 `goal -> work item -> run` 上已具备较完整能力，但 TUI 主入口与用户心智存在偏差：

- `/new` 当前是“新 Goal”而非“新 Session”
- 非命令输入多数直接走 `goal.submit` 快路径
- Tasks 视图主要来自 `simpleMessages`，与 Goals 视图语义重叠

本计划目标是建立并落地以下闭环：

`session -> goals -> work items -> run -> result`

并确保：

1. 入口语义一致（Session-First）
2. 管道统一（输入先过会话/意图分析，再决定是否创建 Goal）
3. UI 分层清晰（Session/Goals/WorkItems/Runs/Results）
4. 全链路可观测、可灰度、可回滚

---

## 2. 范围与非范围

### 2.1 本计划范围（In Scope）

1. TUI 入口与输入主路径重构（`/new` 与自然输入）
2. Gateway 会话路径与 Goal 创建路径统一策略
3. Session 与 Goal 的关联模型与可追溯性
4. 视图层语义重构（至少完成 Session/Goals/WorkItems/Runs 的清晰边界）
5. Result 标准 DTO 定义与终端展示统一
6. 切流开关、观测指标、回滚策略

### 2.2 非范围（Out of Scope）

1. 历史业务数据重算与大规模离线修复
2. 调度器核心算法重写（Scheduler 内核不在本次主改范围）
3. 非 TUI 客户端协议大改

---

## 3. 现状基线（代码证据摘要）

1. `/new` 当前行为：
   - `src/cli/tui/commands/handlers.ts` `new` -> `openModal('goal-create')`
2. 自然输入快路径：
   - `src/cli/tui/commands/handlers.ts` `handleNaturalInput()` -> `client.submitGoal(...)`
3. Goal 提交后立即创建初始 work item：
   - `src/gateway/rpc/handlers/goal-handlers.ts` `goal.submit`
4. Tasks 视图来源：
   - `src/cli/tui/components/views/tasks-view.tsx` 使用 `state.simpleMessages`
5. 会话能力已存在但非主路径：
   - `src/gateway/rpc/handlers/conversation-handlers.ts`
   - `src/app/conversation/session-manager.ts`
   - `src/infra/persistence/sqlite-session-repository.ts`

---

## 4. 目标状态（Target State）

## 4.1 产品语义

1. `/new` 明确定义为“创建并切换到新 Session”
2. Session 首轮输入触发标题摘要生成（session title）
3. 每轮输入先进入会话管道做意图分析，再决定：
   - 仅回复
   - 创建 Goal
   - 澄清追问

## 4.2 领域链路

1. Goal 必须可追溯到 `sessionId + turnId`
2. Work items 保持 Goal 分解执行逻辑
3. Runs 与 Results 能稳定映射到上游 session/goal/work item

## 4.3 UI 投影

1. Session 视图：会话列表、当前会话状态、标题
2. Goals 视图：仅展示当前 Session（或可筛选会话）的 goals
3. Work Items / Runs：按层下钻，不再与消息流混淆
4. Results：统一结构展示，不依赖临时字符串拼接

---

## 5. 分阶段执行计划（可排期）

## P0（必须先做）— 设计冻结与配置契约（2-3 天）

### 目标
在不破坏现网行为前提下冻结迁移边界、开关与验收口径。

### 任务
1. 明确迁移开关（建议）
   - `tui.sessionFirst.enabled`（默认 false）
   - `tui.goalSubmitFastPath.enabled`（默认 false，仅限应急回退）
2. 输出接口契约草案
   - `conversation.new` 的 TUI 使用规范
   - `conversation.message` 返回“是否创建 goal”的决策结构
3. 明确数据关联规范
   - goal context 中必须包含 `sessionId/turnId`（或新增字段，二选一并冻结）
4. 冻结配置联动规则（强制）
   - 凡涉及配置文件结构变更，必须同时更新：
     - 配置 schema（含运行时校验与 schema template）
     - example 模板（含 `docs/config-templates/*` 与 onboarding 默认模板）
     - `pb init` 初始化与 dry-run 行为

### 验收
1. 迁移开关定义完成并评审通过
2. 接口与数据关联 ADR（或 design note）完成
3. 配置联动规则通过评审并写入执行门禁

---

## P1（高优先）— 入口改造：`/new` = 新 Session（3-5 天）

### 目标
将 `/new` 从“新 Goal”切换为“新 Session”。

### 任务
1. TUI 命令层改造
   - `src/cli/tui/commands/handlers.ts`
   - `/new` 调 `conversation.new`，设置 active session
2. Gateway 客户端能力补齐
   - `src/cli/gateway/tui-gateway-client.ts` 增加/规范 `conversation.new/message/history`
3. TUI 状态模型增加 activeSession 语义
   - `src/cli/tui/context/app-context.tsx`
   - `src/cli/tui/store/types.ts`
   - `src/cli/tui/store/reducer.ts`

### 验收
1. `/new` 后返回并展示新 `sessionId`
2. 不再弹出 goal-create modal 作为默认行为
3. `/new` 语义不再回退到“新 Goal”

---

## P2（高优先）— 输入主路径统一到会话管道（5-8 天）

### 目标
非命令输入默认走 `conversation.message`，由会话层决策是否创建 Goal。

### 任务
1. 输入提交重构
   - `src/cli/tui/app.tsx` `handleInputSubmit()` 主路径改造
2. 去除/降级直接 `goal.submit` 快路径
   - `src/cli/tui/commands/handlers.ts` `handleNaturalInput()` 迁移
3. 明确会话响应结构
   - 包含 intent 判定、goal 创建决策、追问信息
4. 移除自然输入对 `goal.submit` 的直连路径
   - 统一改为 `conversation.message` 决策后再创建 goal

### 验收
1. 非命令输入默认不直接调用 `goal.submit`
2. 每个新建 goal 均能关联 `sessionId + turnId`
3. 自然输入路径不再出现 `goal.submit` 直连调用

---

## P3（高优先）— Session/Goal 关联与追溯（4-6 天）

### 目标
实现“goal 来源于哪一轮会话输入”的稳定追踪能力。

### 任务
1. 数据模型选择与实现
   - 方案 A：goal context 扩展 `sessionId/turnId`
   - 方案 B：新增显式关联字段/表
2. Gateway 创建 goal 时写入关联信息
   - `src/gateway/rpc/handlers/goal-handlers.ts`
3. 查询接口支持按 session 过滤 goals/work items/runs（至少 goals）

### 验收
1. 任一 goal 可追溯到会话轮次
2. 会话维度 goal 查询准确
3. 不破坏现有 goal/work item/run 的核心执行链路

---

## P4（中高优先）— UI 分层重构（6-10 天）

### 目标
消除 Tasks/Goals 语义重叠，建立分层浏览。

### 任务
1. 视图重构
   - Session 视图（新增）
   - Goals 视图（会话维度）
   - WorkItems 视图（goal 维度）
   - Runs 视图（work item 维度）
2. Tasks 视图定位调整
   - 将现有 `simpleMessages` 视图重命名为 Timeline/Narration（或并入 Session）
3. 导航与快捷键更新
   - `src/cli/tui/commands/registry.ts`
   - 相关 view 组件

### 验收
1. Tasks 不再等价于 simpleMessages 的“业务任务视图”
2. 四层可 drill-down
3. 用户可从 session 定位到具体 run

---

## P5（中优先）— Result DTO 标准化与统一展示（4-6 天）

### 目标
定义并使用统一 Result 结构，减少 UI 侧字符串拼装。

### 任务
1. 定义 Result DTO（建议字段）
   - `summary`
   - `artifacts`
   - `verification`
   - `cost/time/tokens`
   - `runId/workItemId/goalId/sessionId`
2. Gateway/TUI 统一消费
   - TUI 不再只依赖 `execution_log` 首行摘要
3. CLI 与 TUI 结果展示对齐
   - 参考 `src/cli/commands/results.ts`

### 验收
1. TUI 与 CLI 结果关键字段一致
2. 结果展示可稳定回放与检索
3. Result DTO 字段在 TUI/CLI 输出保持一致

---

## P6（收口）— 灰度切换、观测与回滚（3-5 天）

### 目标
将 Session-First 方案可控上线。

### 任务
1. 灰度方案
   - dev -> canary -> default
2. 观测指标（至少）
   - session 创建成功率
   - conversation.message 处理成功率
   - goal 关联 session 覆盖率
   - 回退触发次数
3. 回滚 runbook
   - 一键切回 Goal-First 快路径

### 验收
1. 灰度期间关键指标稳定
2. 发现异常可在 5 分钟内回滚
3. 回滚后核心功能不受影响

---

## 6. 任务拆分（可直接建 Issue）

## I-01：Session-First 开关与接口契约
- 目标：冻结迁移开关与会话接口结构
- 建议文件：
  - `src/cli/gateway/tui-gateway-client.ts`
  - `src/gateway/rpc/handlers/conversation-handlers.ts`
  - `docs/engineering/*`（设计记录）
- 验收：开关可控、契约评审通过

## I-01A：配置结构联动治理（强制门禁）
- 目标：配置结构变更时保持 schema/example/init 一致
- 建议文件：
  - `src/infra/config/onboarding.ts`
  - `src/infra/config/runtime-config.ts`
  - `src/cli/commands/init.ts`
  - `docs/config-templates/*`
- 验收：
  - 配置结构变更 PR 必须包含 schema/example/pb init 三项同步更新
  - `pb init --dry-run` 与实际生成结果符合最新 schema

## I-02：`/new` 语义重构
- 目标：`/new` 创建 session，不再默认创建 goal
- 建议文件：
  - `src/cli/tui/commands/handlers.ts`
  - `src/cli/tui/commands/registry.ts`
  - `src/cli/tui/components/modals/goal-create-modal.tsx`
- 验收：/new 返回 session 并切换上下文

## I-03：输入主路径迁移到 conversation.message
- 目标：自然输入不再直连 `goal.submit`
- 建议文件：
  - `src/cli/tui/app.tsx`
  - `src/cli/tui/commands/handlers.ts`
  - `src/app/conversation/session-manager.ts`
- 验收：goal 创建均可关联会话轮次

## I-04：Session-Goal 关联模型
- 目标：建立并查询 session 与 goal 关联
- 建议文件：
  - `src/gateway/rpc/handlers/goal-handlers.ts`
  - `src/infra/persistence/schema.sql`（若采用字段/表方案）
  - `src/infra/persistence/work-order-repository.ts`
- 验收：按 session 查询 goal 正确

## I-05：视图分层重构
- 目标：Session/Goals/WorkItems/Runs 分层呈现
- 建议文件：
  - `src/cli/tui/components/views/*.tsx`
  - `src/cli/tui/context/app-context.tsx`
  - `src/cli/tui/store/*`
- 验收：不再出现 Tasks=Goals 的语义混淆

## I-06：Result DTO 与展示统一
- 目标：形成统一 result 结构并跨 TUI/CLI 使用
- 建议文件：
  - `src/gateway/types.ts`
  - `src/cli/tui/app.tsx`
  - `src/cli/commands/results.ts`
- 验收：字段统一、展示一致

## I-07：灰度、观测、回滚
- 目标：可控上线与快速回退
- 建议文件：
  - `src/gateway/rpc/handlers/system-handlers.ts`
  - `src/infra/config/runtime-config.ts`
  - TUI/Gateway 状态展示相关模块
- 验收：灰度指标可视、回滚演练通过

---

## 7. 依赖关系与并行策略

1. 串行依赖：`P0 -> P1 -> P2 -> P3 -> P4 -> P5 -> P6`
2. 可并行：
   - P3（关联模型）与 P4（UI 重构）可部分并行
   - P5（Result DTO）可在 P2 后并行推进
3. 强约束：
   - P2 未完成前，不应默认关闭 `goal.submit` 快路径
   - P6 前必须完成回滚开关与观测指标

---

## 7.1 迁移不变量（Migration Invariants）

以下不变量用于约束开发与上线，任何阶段都不得破坏：

1. 每个 run 必须可追溯到 `workItemId -> goalId -> sessionId`
2. 任一用户输入最多触发一次“业务创建动作”（通过幂等键防止重复建 goal/run）
3. Session-First 开关开启后，输入主路径只允许会话管道
4. 任何失败都必须可审计：触发源、时间、错误码、关联实体 ID

---

## 7.2 配置变更联动不变量（Config Change Coupling Invariants）

1. 任意配置结构字段新增/删除/重命名，必须同步更新 schema。
2. 任意配置结构变更，必须同步更新 example 模板。
3. 任意配置结构变更，必须同步更新 `pb init` 初始化与 dry-run 输出。
4. 缺任一项即视为不满足合并条件。

---

## 8. 验证矩阵（每阶段必跑）

1. 单元测试：会话命令路由、输入分支、DTO 映射
2. 集成测试：
   - `/new -> conversation.message -> goal -> work item -> run -> result` E2E
   - Session-First 主路径回归
3. 构建与类型检查：
   - `npm run build`
   - 项目既有 typecheck/test 命令
4. 手工验收场景：
   - 新建 session 后首条输入自动生成标题
   - 多轮输入仅在需要时创建 goal
   - 从 session 可定位到 run/result

## 8.1 强制质量门禁（Go/No-Go Gates）

1. **主路径门禁**
   - `/new` 与自然输入均走 Session-First 流程
2. **一致性门禁**
   - Session-First 与 Goal-First 在核心成功路径上达到预设一致性阈值（成功率/关键状态转移）
3. **幂等门禁**
   - 重试/重放不产生重复 goal/run
4. **可观测门禁**
   - trace/log/metrics 能完整串联 session->result
5. **回滚门禁**
   - staging 环境完成一次完整回滚演练并通过
6. **配置门禁**
   - 若本阶段含配置结构变更，schema/example/pb init 三项一致性检查通过

---

## 9. 风险与控制

1. 风险：Session-First 改造影响输入与命令习惯
   - 控制：通过明确提示与视图引导降低学习成本
2. 风险：UI 重构期间用户迷失
   - 控制：保留清晰导航提示与命令别名
3. 风险：配置结构升级后 schema/example/init 不一致
   - 控制：强制执行配置联动门禁（schema + example + pb init）
4. 风险：结果结构切换影响下游脚本
   - 控制：Result DTO 版本化与字段兼容

---

## 10. 切流与回滚策略

## 10.1 切流阶段
1. Shadow：仅记录会话链路结果，不影响主行为
2. Canary：对小流量启用 Session-First 默认路径
3. Default：全量启用，保留回滚开关

## 10.2 回滚触发条件
1. 会话创建失败率超阈值
2. goal 关联 session 覆盖率异常下降
3. 关键命令（/new、自然输入）异常率显著上升

## 10.3 回滚动作
1. 关闭 `sessionFirst` 相关入口开关并恢复稳定版本配置
2. 保留失败阶段日志与指标用于复盘
3. 在修复后重新执行 canary 验证

## 10.4 切流判定指标（建议阈值）
1. session 创建成功率
2. conversation.message 成功率
3. goal 关联 session 覆盖率
4. run 成功率与平均完成时延
5. 关键错误码占比（异常波动触发自动回滚）

---

## 11. Definition of Done（DoD）

1. `/new` 语义已切换为新 Session，且验证通过
2. 非命令输入默认走会话管道，不直连 `goal.submit`
3. 新创建 goal 可追溯 `sessionId + turnId`
4. UI 具备分层浏览，不再出现 Tasks/Goals 语义混淆
5. Result DTO 在 TUI/CLI 侧统一可用
6. 灰度与回滚演练完成并有记录
7. 回归测试、构建、类型检查全部通过
8. 涉及配置结构变更时，schema/example/pb init 三项已同步并通过验证

---

## 12. 关联文档

1. `docs/engineering/session-goal-workitem-run-result-gap-analysis-2026-03-02.md`
2. `docs/plans/2026-02-20-tui-unified-design.md`
3. `docs/plans/2026-02-27-application-layer-coordination-plan.md`
4. `docs/plans/2026-02-26-ponybunny-scheduler-architecture-v2-upgrade-plan.md`
