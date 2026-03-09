# Step 03 - Session-first 会话链路

## 目标

从 `handleNaturalInput` 出发，梳理 session-first 如何调用 Gateway conversation RPC，并进入 SessionManager。

## 控制流

1. TUI 侧 session-first 入口
   - `src/cli/tui/commands/handlers.ts::handleNaturalInput`
   - 行为：
     - 新建一条 `simpleMessage`（status=pending）
     - 标记 `activityStatus='Processing conversation...'`

2. Session 获取/创建
   - 若 `activeSessionId` 存在：复用该 id
   - 否则调用 `client.createConversationSession({})`
     - `TuiGatewayClient` -> RPC `conversation.new`

3. 发送消息
   - `client.sendConversationMessage({ sessionId, message, stream:false })`
   - `TuiGatewayClient` -> RPC `conversation.message`

4. Gateway 收包与路由
   - `MessageRouter.handleMessage` -> `handleRequest`
   - 鉴权后进入 `RpcHandler.handle(method, params, session)`
   - 命中 `conversation.message` handler

5. conversation handler
   - 文件：`src/gateway/rpc/handlers/conversation-handlers.ts`
   - 非流式分支调用：
     - `sessionManager.processMessage(...)`

6. SessionManager 主流程
   - 文件：`src/app/conversation/session-manager.ts`
   - `processMessage` -> `processMessageInternal`
   - 顺序：
     1) 获取或创建 session（含 archived 自动恢复）
     2) 写入 user turn
     3) `inputAnalyzer.analyze(...)`
     4) `stateMachine.determineNextState(...)`
     5) 根据状态分发：`executing | monitoring | retrying | default`

## 数据流

1. 输入文本进入 `IInputAnalysisService`
   - 文件：`src/app/conversation/input-analysis-service.ts`
   - 产物：intent/emotion/purpose（是否 actionable、缺失信息、目标摘要）

2. 会话状态机
   - 文件：`src/app/conversation/conversation-state-machine.ts`
   - `mapIntentToState` 若 actionable 且信息足够，趋向 `executing`

3. 返回给 TUI 的 RPC 结果
   - `ConversationMessageResult` 可能带 `taskInfo.goalId`
   - TUI 若看到 `taskInfo.goalId`，会把消息状态改为 `Task queued...`

## 分支说明

- 若 `purpose.missingInfo` 非空，状态可落到 `clarifying`，此时不会直接建 goal。
- 若落到 `chatting`，仅返回对话文本，不进入调度。

## 下一步

- 进入 [Step 04](./step-04-goal-materialization.md)：分析 `executing` 分支如何落库 goal/work item。
