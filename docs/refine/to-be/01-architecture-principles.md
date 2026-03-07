# 01. 架构原则与角色边界

## 1) 不可违反的角色划分

### Scheduler（核心业务中枢）

- 负责：意图识别后的任务决策、Goal/WorkItem 物化、调度执行、重试与升级。
- 负责：会话输入到执行计划的业务闭环。
- 负责：将执行事件实时回推给 Gateway。

### Gateway（渠道路由层）

- 负责：渠道接入、身份与权限、协议适配、消息路由、会话绑定、事件分发。
- 负责：统一把来自不同 channel 的输入投递给 Scheduler。
- 负责：把 Scheduler 输出按策略分发回 channel。
- 不负责：业务决策、任务规划、执行引擎、goal/workitem 业务创建。

## 2) 设计原则

1. **Single Business Owner**
   - 任何会影响执行语义的逻辑只允许在 Scheduler 进程里存在一份实现。

2. **Session-First by Contract**
   - 用户渠道请求必须先进入 session message 管线，再由 Scheduler 决定是否创建 goal。

3. **Executable Goal Invariant**
   - “可执行 goal”必须满足：`Goal + >=1 WorkItem`。
   - 禁止“创建 goal 但无 workitem”的可见成功状态。

4. **Routing Not Business**
   - Gateway 只允许做路由、认证、限流、格式转换，不做业务语义判断。

5. **Targeted Event Delivery**
   - 事件必须具备明确 scope：`session-scoped` / `goal-scoped` / `broadcast-scoped`。
   - 禁止未标定 scope 的默认全量广播。

6. **Protocol First**
   - 先固定 Gateway↔Scheduler 控制面协议，再迁移实现。

## 3) 当前反模式（必须消除）

1. Gateway 内部同时承载 conversation + input analysis + task bridge 业务逻辑。
2. session-first 与 fast-path 各走一套 goal 物化路径，业务语义不一致。
3. 事件可见性依赖调用路径副作用（是否调用 subscribeToGoal）。
4. “queued”语义混用（未提交/待执行/无工作项）导致状态含义不清。

## 4) 目标边界判定规则（代码评审准则）

- 若代码读取/修改 Goal、WorkItem、Run 的业务字段并影响状态迁移 => **Scheduler 域**。
- 若代码仅做 transport、鉴权、会话连接映射、channel I/O => **Gateway 域**。
- 若存在边界不清，默认往 Scheduler 收拢业务语义。
