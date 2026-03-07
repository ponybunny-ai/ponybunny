# 07. 迁移计划（分阶段）

## Phase 0: 合同冻结（不改行为）

1. 定义并冻结控制面 schema（命令/事件/scope/idempotency）。
2. 增加兼容层：Gateway 可同时调用旧路径与新路径（开关控制）。
3. 增加关键指标：
   - session message success
   - decision distribution
   - goal materialization completeness
   - event routing correctness

## Phase 1: Scheduler Intake 引入（旁路）

1. 在 scheduler-daemon 增加 session intake 服务（仅 shadow）。
2. Gateway 的 `conversation.message` 同时写审计，不改最终响应来源。
3. 对比新旧 decision 输出一致率。

## Phase 2: 主路径切换到 Scheduler Intake

1. Gateway `conversation.message` 改为 thin proxy -> `session_message`。
2. TUI 关闭 fast-path 开关入口（默认不可触发 direct `goal.submit`）。
3. `goal.submit` 仅保留给内部/管理员兼容接口。

## Phase 3: 事件路由重构

1. 引入显式 event scope。
2. 移除“无 goalId 则 broadcast read”默认策略。
3. 所有 conversation/session stream 事件改为 session-scoped。

## Phase 4: 业务逻辑清理

1. 从 Gateway 移除：
   - InputAnalysisService 业务决策参与
   - TaskBridge goal 物化链
2. 保留 Gateway：
   - auth
   - channel adapters
   - router
   - protocol gateway

## Phase 5: 多渠道上线

1. 逐个启用 channel adapter（webui/email/telegram/...）。
2. 上线 broadcast policy（可控镜像）。
3. 完成跨渠道会话一致性验证。

## 回滚策略

1. 每个 phase 可通过 feature flag 回退。
2. 保持旧 RPC 可用直至 Phase 4 完成并稳定两个版本周期。
3. 若新 intake SLA 下滑，回退到 Gateway 旧处理链并保留审计样本。
