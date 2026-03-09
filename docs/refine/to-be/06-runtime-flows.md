# 06. To-Be 关键运行流（文本时序）

## Flow A: 用户自然语言消息（唯一主路径）

1. User -> Channel Adapter（TUI/WebUI/Email/...）
2. Channel Adapter -> Gateway Router（normalize envelope）
3. Gateway -> Scheduler `session_message`
4. Scheduler Intake:
   - load/create session
   - analyze input (`IInputAnalysisService`)
   - decisioning
5. Scheduler emits:
   - `session.stream.*`（可选）
   - `session.decision`
6. 若 `goal_created`：
   - materialize Goal + WorkItems
   - submit to SchedulerCore
7. SchedulerCore emits execution lifecycle events
8. Gateway routes events to relevant channel sessions
9. User receives response + progress + final result

## Flow B: 澄清回环

1. Scheduler decision = `clarification_requested`
2. Gateway 将澄清问题投递回发起 session
3. 用户补充输入
4. 回到 Flow A Step 3

## Flow C: 重试/升级回环

1. SchedulerCore 执行失败
2. retry policy:
   - retry -> 回到 SchedulerCore 执行队列
   - escalate -> 产出 escalation event
3. Gateway 将升级请求定向到 owner session/channel
4. 用户响应升级决策
5. Scheduler 继续执行/终止

## Flow D: 多渠道广播

1. Scheduler 产出 `session.decision` 或 `goal/run` 事件
2. Gateway 根据 broadcast policy 判断：
   - 仅原渠道
   - 或镜像到所有 enabled channels
3. 各 channel adapter 将内容转换成平台可读格式并输出

## Flow E: 断连恢复

1. Channel reconnect -> Gateway 重新建立 session mapping
2. Gateway 用 cursor 向 Scheduler 请求回放
3. Scheduler 返回缺失事件
4. Gateway 增量补发到 channel
