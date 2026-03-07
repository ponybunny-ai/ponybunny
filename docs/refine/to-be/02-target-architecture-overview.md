# 02. To-Be 总体架构

## 1) 组件视图

1. **Channel Adapters（Gateway 内）**
   - TUI adapter
   - WebUI adapter
   - Email adapter
   - Telegram adapter
   - WhatsApp adapter
   - Discord adapter

2. **Gateway Router Core**
   - Channel session registry（channelSessionId <-> gatewaySessionId <-> schedulerSessionId）
   - AuthN/AuthZ
   - Ingress normalizer（统一 message envelope）
   - Egress dispatcher（按 scope 投递）

3. **Scheduler Control API（Scheduler-daemon 内）**
   - Session lifecycle API
   - Message intake API（sync + stream）
   - Goal/workitem orchestration API
   - Event stream emitter

4. **Scheduler Execution Core**
   - 维持既有调度与执行能力（lane/model/budget/retry/escalation/quality gate）

## 2) 数据与控制分层

- 控制面（Gateway <-> Scheduler）：命令与事件协议（RPC/stream）
- 数据面（Scheduler 内）：会话分析、决策、持久化、执行
- 渠道面（Gateway <-> Channels）：多协议输入输出适配

## 3) 从 As-Is 到 To-Be 的关键变化

1. `conversation.message` 的业务执行主体从 Gateway 内 `SessionManager` 移到 Scheduler intake。
2. `goal.submit` 从“用户侧主入口”降为“内部/运维/兼容入口”，默认用户流只走 session-first。
3. `TaskBridge.createGoalFromConversation` 逻辑迁移至 Scheduler intake orchestrator。
4. Gateway 的广播模型从“goalId 有则定向，否则 broadcast”升级为“必须显式 scope”。

## 4) 目标状态判定

当满足以下条件，可认为总体架构达标：

1. Gateway 不再创建 goal/workitem。
2. 用户渠道输入统一调用 scheduler.session.message。
3. session-first 可实时看到执行进度，无需依赖 fast-path。
4. 任何执行结果都可按 channel 策略扇出到多个 enabled 渠道。
