# Session → Goal → Work Item → Run → Result 闭环 Gap 分析

> 日期: 2026-03-02  
> 目的: 对比“期望闭环模型”与当前系统实现，形成下一阶段需求打磨输入  
> 范围: TUI / Gateway / Scheduler / Persistence（聚焦真实代码路径）

---

## 1) 目标模型（To-Be）

你提出的目标闭环是：

1. 用户输入 `/new` 时，**创建新的 session**。
2. 系统对该 session 第一条用户输入做 summary，作为 **session title**。
3. 每轮用户输入进行 **意图分析**，生成 **goal**。
4. goal 进一步分解为 **work items**。
5. 系统执行 work items 产生 **run**。
6. 收集执行结果并向终端返回 **result**。
7. 整体形成 `session -> goals -> work items -> run -> result` 的层层递进闭环。

---

## 2) 现状实现（As-Is，基于代码证据）

### 2.1 TUI 输入主路径

- `src/cli/tui/app.tsx` 中 `handleInputSubmit()`：
  - 命令输入走 `executeCommand()`。
  - 非命令输入走 `handleNaturalInput()`。
- `/new` 的行为在 `src/cli/tui/commands/handlers.ts`：
  - `new: (_cmd, ctx) => ctx.app.openModal('goal-create')`
  - 即：**打开创建 Goal 的 modal**，并非创建 session。

### 2.2 Goal 创建路径

- 自然语言输入：`src/cli/tui/commands/handlers.ts` `handleNaturalInput()` 直接 `client.submitGoal(...)`。
- `/new` modal：`src/cli/tui/components/modals/goal-create-modal.tsx` 最终也调用 `submitGoal(...)`。
- Gateway 落库：`src/gateway/rpc/handlers/goal-handlers.ts` `goal.submit`：
  - `repository.createGoal(...)`
  - 紧接着 `repository.createWorkItem(...)`（初始 analysis work item）

### 2.3 Work Item / Run / Result 路径

- Scheduler：`src/scheduler/core/scheduler.ts`
  - 选取 work item 后创建 run，发出 `run_started/run_completed`、`work_item_*`、`goal_*` 事件。
- 事件桥接：
  - `src/gateway/integration/scheduler-bridge.ts`
  - `src/gateway/integration/ipc-bridge.ts`
  - 将 scheduler 事件映射为 gateway 事件并广播。
- TUI 消费结果：`src/cli/tui/app.tsx`
  - 收到 `run.completed` 后调用 `getWorkItemRuns()` 拉取 run。
  - 从 `run.execution_log` 提取 summary，写入 `SimpleMessage.resultSummary` 展示。

### 2.4 “Tasks 与 Goals 相似”的直接原因

- `src/cli/tui/components/views/tasks-view.tsx`：tasks 来自 `state.simpleMessages`。
- `src/cli/tui/app.tsx` 初始加载 goals 时，会把每个历史 goal 映射为 `addSimpleMessage(...)`。
- 结果：Tasks 视图本质是“消息/任务叙事流”，而不是纯 Work Item 列表。

### 2.5 Session 子系统现状

- 系统存在 conversation session 能力：
  - `src/gateway/rpc/handlers/conversation-handlers.ts`（`conversation.new/message/history/...`）
  - `src/app/conversation/session-manager.ts`
  - `src/infra/persistence/sqlite-session-repository.ts`
- 但当前 TUI 默认输入路径并**未接入** `conversation.*`。

---

## 3) 分层 Gap 对比（To-Be vs As-Is）

| 层级 | 目标模型 | 当前实现 | Gap 结论 |
|---|---|---|---|
| Session 启动 | `/new` 创建新 session | `/new` 仅打开 goal-create modal | **高**：入口语义不一致 |
| Session 标题 | 第一条输入 summary 生成 session title | TUI 无 session title 机制 | **高**：缺失 session 叙事主轴 |
| 每轮输入归属 | 每轮输入归属某 session，再生成 goal | 每轮输入多为直接 `goal.submit` | **高**：session 与 goal 未强关联 |
| 意图分析位置 | 每轮输入有显式意图分析阶段 | TUI 快路径直接 submitGoal；conversation 路径才有分析 | **中高**：存在两套链路并行 |
| Goal->Work Item 分解 | goal 分解为 work items | 已实现（goal.submit 后初始 work item + scheduler 执行） | **低**：核心能力已具备 |
| Run 执行闭环 | work item 运行产生 run | 已实现并有事件回传 | **低** |
| Result 交付 | result 作为终端用户结果层 | 主要由 run.execution_log 派生到 SimpleMessage | **中**：result 非独立领域对象 |
| UI 层级一致性 | session/goals/work-items/run/result 层层递进 | Tasks 基于 simpleMessages，与 Goals 显著重叠 | **高**：视图语义错位 |

---

## 4) 关键设计问题（根因）

### G1. 入口语义漂移：`/new` 从“新会话”变成“新 Goal”

- 直接导致 session 层在 TUI 主流程中缺席。
- 用户心智模型（会话）与系统主流程（goal quick submit）冲突。

### G2. 双主路径并存且未统一

- 路径 A：TUI 自然输入 -> `goal.submit`（快路径）。
- 路径 B：conversation session -> 意图分析 -> task bridge -> goal。
- 结果：系统有 session 能力，但默认交互不走该能力。

### G3. UI 投影模型未与领域模型对齐

- Tasks 视图使用 `simpleMessages` 投影，而非直接以 work item/run 为第一视角。
- Goals 视图又展示 related tasks/work items，信息重叠。

### G4. Result 缺少明确领域边界

- 当前 result 更接近“run log 摘要”，而非独立的 result 实体或稳定 DTO。
- 不利于后续做“结果回放、结果质量标注、结果归档检索”。

---

## 5) 下一阶段需求打磨建议（建议作为需求条目）

## R1. 统一入口为 Session-First

- `/new` = `conversation.new`。
- 返回 `sessionId` 并切换当前活跃 session。
- 首条用户消息通过 `conversation.message` 进入。

**验收标准**
- `/new` 后可见新 session 上下文（ID/标题占位）。
- 不创建 goal，直到首条消息被分析并确认为可执行目标。

## R2. 建立 Session 标题生成规范

- 首条用户消息进入后，生成 session title（summary）。
- 标题可在后续 N 轮后进行一次轻量重写（可选）。

**验收标准**
- 每个 active session 都有 title。
- title 生成可追溯（包含来源 turn id / timestamp）。

## R3. 统一“每轮输入 -> 意图分析 -> goal”管道

- 非命令输入默认走 `conversation.message`。
- 在 conversation 管道内决定：
  - 仅回复（不创建 goal）
  - 创建 goal
  - 追问澄清

**验收标准**
- TUI 主路径不再直接调用 `goal.submit`（仅保留后台兼容开关）。
- 每次创建 goal 都能回溯到 sessionId + user turn。

## R4. 明确 UI 分层投影

- Session 视图：会话列表、当前会话、会话级状态。
- Goals 视图：当前 session 下 goals。
- Work Items 视图：按 goal 展示 work item DAG/状态。
- Runs 视图：按 work item 展示 run 列表与详情。
- Results 视图：最终结果聚合（可由 run/work item 聚合而来）。

**验收标准**
- Tasks 视图不再等价于 simpleMessages 列表。
- 每一层都可 drill-down 到下一层。

## R5. 定义 Result 领域对象（或标准 DTO）

- 明确 result 的来源和结构：
  - summary
  - artifacts
  - verification outcome
  - cost/time/token
- 可先做逻辑对象（由 run/work item 聚合），后续再评估持久化。

**验收标准**
- 终端输出 result 使用统一结构，不依赖临时字符串拼装。

---

## 6) 建议实施顺序（里程碑）

### M1（先对齐语义）
- `/new` 改为创建 session。
- 输入主路径切到 conversation.message。

### M2（打通层级）
- 建立 session->goal 关联字段/索引（若已有 context 可先复用）。
- Goals/WorkItems/Runs 视图分层重构。

### M3（结果规范化）
- 定义统一 Result DTO。
- 终端与 TUI 统一 result 展示。

---

## 7) 风险与注意事项

- 兼容性风险：现有依赖 `goal.submit` 快路径的命令与脚本需保留迁移期。
- 用户心智迁移：需明确 `/new` 行为改变（从“新目标”改为“新会话”）。
- 数据迁移：历史 simpleMessages 与新层级模型映射策略要提前定义。

---

## 8) 结论

当前系统在 `goal -> work item -> run` 执行链路上能力较完整，但未满足你要求的 **Session-First 闭环**。核心差距不在执行引擎，而在：

1. 入口语义（`/new`）
2. 主路径路由（直接 goal.submit vs conversation.message）
3. UI 投影视图与领域层级不一致

下一阶段需求设计应优先收敛这三点，再做 result 标准化与可观测性增强。
