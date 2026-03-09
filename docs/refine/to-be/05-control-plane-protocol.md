# 05. Gateway ↔ Scheduler 控制面协议（To-Be）

## 1) 目标

扩展当前 IPC/RPC 协议，使其支持：

1. session-first 统一消息入口
2. 实时双向流式通信
3. 显式事件作用域（session/goal/broadcast）

## 2) 命令面（Gateway -> Scheduler）

建议命令：

1. `session_open`
2. `session_resume`
3. `session_end`
4. `session_message`
5. `session_cancel_message`（可选）
6. `goal_cancel`
7. `runtime_update`（保留）

### `session_message` 请求体建议

- `requestId`
- `schedulerSessionId?`
- `gatewaySessionId`
- `channelContext`:
  - `channelType`
  - `channelUserId`
  - `channelSessionId`
- `message`:
  - `messageId`（幂等 key）
  - `text`
  - `attachments?`
  - `stream` (bool)

## 3) 事件面（Scheduler -> Gateway）

建议事件 envelope：

- `eventType`
- `scope` (`session` | `goal` | `broadcast`)
- `scopeId`
- `requestId?`
- `timestamp`
- `payload`

关键事件：

1. `session.message.accepted`
2. `session.stream.start`
3. `session.stream.chunk`
4. `session.stream.end`
5. `session.decision`（goal_created / clarification_requested / response_only）
6. `goal.created`
7. `workitem.started/in_progress/ended`
8. `run.started/completed`
9. `verification.started/completed`

## 4) 响应语义

`session_message` 命令应采用“两阶段语义”：

1. 快速 ACK（命令接收成功）
2. 结果与进度通过事件流异步返回

避免单次命令阻塞等待完整 LLM/执行结果。

## 5) 幂等与重放

1. 以 `messageId` 做幂等，防止重连重复提交。
2. 允许通过 `requestId` 拉取事件回放窗口（cursor/page）。
3. Gateway 可在断连后按 session 补拉未读事件。

## 6) 安全与隔离

1. session-scoped 事件必须只投递给绑定会话。
2. goal-scoped 事件必须绑定 owner/session relationship。
3. 跨渠道广播必须经过 policy 检查（是否允许镜像）。
