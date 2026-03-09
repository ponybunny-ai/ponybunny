# Step 07 - 执行层（ReAct + Tool）

## 目标

解释系统如何在执行阶段完成“查天气 -> 写 shell 脚本 -> 执行脚本 -> 汇总结果”。

## 控制流

1. Scheduler 选中 work item 后执行
   - `SchedulerCore.startWorkItemExecution` -> 异步 `executeWorkItem(context)`
   - 文件：`src/scheduler/core/scheduler.ts`

2. 进入执行引擎
   - `ExecutionEngineAdapter.execute(workItem, context)`
   - 常规路径转调 `ExecutionService.executeWorkItem(executionWorkItem)`
   - 文件：`src/gateway/integration/execution-engine-adapter.ts`

3. ExecutionService 创建 run 并调用 ReAct
   - 文件：`src/app/lifecycle/execution/execution-service.ts`
   - `reactIntegration.executeWorkCycle({ workItem, run, goal, model, toolEnforcer })`

4. ReAct 主循环
   - 文件：`src/autonomy/react-integration.ts`
   - `while (!completed && maxIterations > 0)`
   - 每轮：
     1) LLM 产出 thought/content/toolCalls
     2) 若有 `toolCalls`，逐个 `executeToolCall`
     3) 若无工具动作，触发强制动作提示（`buildImmediateActionDirective`）
     4) 检查 `isTaskComplete` / `isQuestionForUser`

## 数据流（场景映射）

目标场景通常映射为以下工具序列（由模型决策，系统执行）：

1. 天气查询
   - 优先 MCP/domain 搜索工具（若可用）
   - 其次可落到 `web_search`

2. 生成脚本并写入文件
   - `write_file` 工具（`WriteFileTool`）
   - 参数：`path` + `content`
   - 注意：该工具直接 `writeFileSync(args.path, args.content)`

3. 执行脚本
   - `execute_command` 工具（`ExecuteCommandTool`）
   - 参数：`command`
   - 基于 `execAsync(command, { cwd, timeout })` 执行并返回 stdout/stderr

4. 完成信号
   - 模型可能调用 `complete_task`（特殊工具名，逻辑在 ReAct 内部短路处理）

## 关键实现事实

1. 工具注册
   - `ExecutionService.registerTools()` 注册：
     - `read_file`
     - `write_file`
     - `execute_command`
     - `search_code`
     - `web_search`
     - `find_skills`

2. 工具执行强制由 ToolEnforcer 过滤
   - `toolEnforcer.checkToolInvocation(toolName, args)`
   - 不允许则返回 `Action denied: ...`

3. 执行日志
   - `ReActIntegration` 生成 observation/thought/action 序列
   - `ExecutionService` 将 execution log 持久化到 run（并追加 policy/route 上下文信息）

## 与下一步关系

- 工具执行后，Scheduler 侧会发 `run_completed`、`verification_*`、`goal_completed/failed` 事件。
- 进入 [Step 08](./step-08-event-return-path.md) 查看这些结果如何回到 TUI。
