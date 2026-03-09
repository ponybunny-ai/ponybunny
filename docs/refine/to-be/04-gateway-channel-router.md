# 04. Gateway 多渠道路由设计

## 1) 目标

Gateway 作为统一“眼耳口”层，支持多渠道 fan-in/fan-out，同时不承载业务决策。

## 2) Channel 模型

统一 channel 抽象：

- ingress: 接收用户输入（text/attachments/metadata）
- egress: 发送系统输出（message/chunk/status）
- capabilities: 支持 stream / rich text / thread / reaction 等

建议 channelType：
- `tui`
- `webui`
- `email`
- `telegram`
- `whatsapp`
- `discord`

## 3) Gateway 核心职责

1. 将 channel 原生输入规范化为统一 envelope：
   - `channelType`, `channelUserId`, `channelSessionId`, `messageId`, `payload`

2. 调用 Scheduler 控制面：
   - `scheduler.session.message`（用户消息）
   - `scheduler.session.open/resume/end`

3. 维护会话映射：
   - `gatewaySessionId <-> schedulerSessionId`
   - `channelSessionId <-> gatewaySessionId`

4. 事件分发：
   - session scoped -> 发送给发起会话
   - goal scoped -> 发送给目标相关订阅者
   - broadcast scoped -> 发送给所有 enabled channel

## 4) 广播策略（多渠道）

支持 per-channel policy：

- `enabledChannels`
- `mirrorToAllEnabledChannels`（true 时跨渠道广播摘要）
- `sensitivePayloadMasking`（敏感字段遮蔽）
- `streamingPolicy`（实时/聚合后发送）

## 5) 关键约束

1. Gateway 不得创建 Goal/WorkItem。
2. Gateway 不得决定是否执行，只转发决策结果。
3. Gateway 必须保证事件 scope 明确，禁止无 scope 默认全量广播。

## 6) 与现有实现对照

当前 `BroadcastManager` 主要按 goalId 或 permission 广播。To-Be 需扩展为强制 scope 分发模型，
并补齐 session-scoped 流式事件定向投递能力。
