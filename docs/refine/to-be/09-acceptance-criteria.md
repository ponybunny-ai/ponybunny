# 09. 验收标准

## A. 角色边界验收

1. Gateway 代码路径中不再出现 Goal/WorkItem 业务创建。
2. Scheduler 侧成为唯一 intake decision owner。
3. TUI 不再暴露用户可触发的 fast-path 分流入口。

## B. 功能一致性验收

1. 用户输入同一句自然语言，在 session-first 下可稳定产生：
   - response-only 或
   - clarification 或
   - goal-created + execution
2. 若返回 `goal_created`，必须验证 Goal 与 >=1 WorkItem 已创建并提交。

## C. 实时通信验收

1. Gateway 与 Scheduler 间命令 ACK < 300ms（P95）。
2. stream chunk 端到端延迟 < 1s（P95）。
3. 中断后可按 cursor 补拉事件，不丢关键状态。

## D. 路由与权限验收

1. session-scoped 事件仅到对应 session。
2. goal-scoped 事件仅到相关订阅者。
3. broadcast-scoped 事件仅到 enabled channels，且满足 policy。

## E. 回归与兼容验收

1. 旧接口在迁移窗口内可兼容（明确 deprecation 日程）。
2. 任何 phase 回滚后核心链路可在 15 分钟内恢复。
3. 关键指标（success rate, run success）不低于迁移前基线。

## F. 场景验收（针对本轮问题）

场景输入：

> 我想知道后天London是否下雨。写一个shell脚本来实现这个功能，并且将脚本保存到当前用户的home目录下，运行后给我最终的结果。

通过条件：

1. 仅通过 session-first 流程完成（无客户端显式分流）。
2. Scheduler 负责 decision + goal/workitem 物化 + submit。
3. 执行事件实时回传，且只对当前会话可见。
4. 最终结果可按 policy 同步到其它 enabled channels。
