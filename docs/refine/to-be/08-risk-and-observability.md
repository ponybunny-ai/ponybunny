# 08. 风险与可观测性

## 1) 高风险项

1. **会话流式内容泄露风险**
   - 若未正确 session-scope 路由，stream chunk 可能被错误广播。

2. **重复提交风险**
   - 断连重试可能导致同一 message 被多次执行。

3. **状态分裂风险**
   - Gateway 与 Scheduler 对 session mapping 不一致。

4. **迁移期间语义漂移**
   - 新旧路径并存导致 decision 行为不一致。

## 2) 指标体系

### Intake 指标
- `session_message_total`
- `session_message_success_rate`
- `decision_goal_created_rate`
- `decision_clarification_rate`

### Execution 指标
- `goal_submit_latency_ms`
- `workitem_start_latency_ms`
- `run_success_rate`
- `verification_pass_rate`

### Routing 指标
- `event_routed_session_scoped_total`
- `event_routed_goal_scoped_total`
- `event_misroute_detected_total`
- `channel_broadcast_fanout_count`

### Reliability 指标
- `ipc_command_timeout_rate`
- `stream_interruption_rate`
- `idempotency_dedup_hit_rate`

## 3) 告警阈值建议

1. `session_message_success_rate < 99%`（5分钟窗口）
2. `ipc_command_timeout_rate > 1%`
3. `event_misroute_detected_total > 0`（立即告警）
4. `run_success_rate` 低于基线超过 10%

## 4) 审计与追踪

1. 所有 `session_message` 必须带：`requestId`, `messageId`, `gatewaySessionId`, `schedulerSessionId`。
2. 事件日志必须带：`scope`, `scopeId`, `correlationId`。
3. 支持按 `messageId` 一键追踪完整链路。
