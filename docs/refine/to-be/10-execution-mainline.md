# 10. Refine 执行主线（严格按此推进）

> 目标：先完成“关键差异与未闭环”，再按优先级完成全部待开发任务。  
> 约束：后续执行以本文件为唯一主线，不新增平行主线。

## A. 执行规则（必须遵守）

1. 先做 **Phase-0（关键差异闭环）**，未完成不得进入下一阶段。  
2. 每个任务完成后必须做验证（`lsp_diagnostics` + 相关测试 + `npm run -s build`）。  
3. 每个任务都要更新本文件中的状态（`todo` -> `doing` -> `done`）。  
4. 如发现新问题，只能追加到本文件“Backlog-Appendix”，不得临时分叉。

---

## Phase-0: 关键差异与未闭环（先完成）

### P0-1 角色边界闭环：Gateway 不再创建 Goal/WorkItem
- 状态：`done`
- 目标：满足验收 A1（Gateway 代码路径不再出现业务创建）。
- 范围：
  - 收敛/替换 `goal.submit` 等仍在 Gateway 侧 `createGoal/createWorkItem` 的路径。
  - Gateway 仅保留协议入口与兼容壳，物化与提交统一走 Scheduler 侧。
- 主要文件（预期）：
  - `src/gateway/rpc/handlers/goal-handlers.ts`
  - `src/scheduler-daemon/daemon.ts`
  - `src/scheduler-daemon/session-intake.ts`
  - `src/ipc/types.ts`
  - 对应测试文件
- 验证：
  - grep 级别确认 Gateway 不再直接物化 Goal/WorkItem（兼容壳除外并标注 deprecation）。
  - 相关 RPC 测试通过。

### P0-2 会话可见性闭环：session-first 执行事件仅当前会话可见
- 状态：`done`
- 目标：满足验收 D1/F3。
- 范围：
  - 修复 `gatewaySessionId/sessionId/goalId` 绑定与订阅链路。
  - 确保 goal/workitem/run/verification/escalation/budget 事件不会泄露到无关 session。
- 主要文件（预期）：
  - `src/gateway/events/broadcast-manager.ts`
  - `src/gateway/integration/ipc-bridge.ts`
  - `src/gateway/gateway-server.ts`
  - `src/scheduler-daemon/scheduler-event-envelope.ts`
  - 对应测试文件
- 验证：
  - 新增/更新 session-scoped 与 goal-scoped 路由断言测试。

### P0-3 实时通信验收闭环：ACK/stream 延迟可度量并可验证
- 状态：`done`
- 目标：满足验收 C1/C2。
- 范围：
  - 补 ACK latency 与 stream chunk latency 的指标采集。
  - 增加 P95 输出接口/测试（或可验证 telemetry）用于验收。
- 验证：
  - 有明确的指标读取路径与测试断言。

### P0-4 回放闭环：中断后 cursor 补拉关键状态不丢失
- 状态：`done`
- 目标：满足验收 C3。
- 范围：
  - 完善 session/channel 维度回放 cursor 语义（不只 sinceTimestamp）。
  - 关键状态事件可补拉且顺序正确。
- 验证：
  - 回放分页/断点续拉测试覆盖。

### P0-5 TUI 一致性闭环：彻底移除 fast-path 暴露
- 状态：`done`
- 目标：满足验收 A3 并消除认知偏差。
- 范围：
  - 修正文案与展示：不再出现 `fast-path|toggle`。
- 主要文件（预期）：
  - `src/cli/tui/components/views/help-view.tsx`
  - `src/cli/tui/components/layout/main-layout.tsx`
  - `src/cli/tui/commands/registry.ts`
  - 对应测试文件

---

## Phase-1: 按优先级完成全部待开发任务

### P1-1 多渠道适配器从 skeleton 到至少 1 个真实可用通道
- 状态：`done`
- 优先级：高
- 目标：满足 to-be 第 5 点与验收 F4 的可验证性。
- 方案：优先 `webui` 或 `discord` 之一打通真实 I/O。

### P1-2 Adapter 事件影响摘要（impactSummary）
- 状态：`done`
- 优先级：高
- 目标：让上层消费方无需解析 keys 即可决策告警。
- 范围：
  - 在 `channel.adapter.config.updated` 中加入：
    - `credentialsChanged`
    - `policyChanged`
    - `routingChanged`
    - `otherChanged`

### P1-3 兼容与回滚验收闭环
- 状态：`done`
- 优先级：高
- 目标：满足验收 E1/E2。
- 范围：
  - 明确旧接口兼容窗口与 deprecation 计划。
  - 回滚开关、回滚路径和 15 分钟恢复演练脚本。

### P1-4 基线与质量指标闭环
- 状态：`done`
- 优先级：中
- 目标：满足验收 E3。
- 范围：
  - success rate / run success 的迁移前后对比输出。

### P1-5 场景验收自动化（London 雨天脚本场景）
- 状态：`done`
- 优先级：中
- 目标：满足验收 F 全项。
- 范围：
  - 基于 session-first 的端到端场景测试：
    - decision + goal/workitem 物化
    - 执行事件会话可见性
    - 最终结果按 policy 跨渠道同步

---

## Phase-2: 文档与验收收口

### P2-1 A-F 验收矩阵（pass/partial/fail + 证据）
- 状态：`done`
- 输出文件：`docs/refine/to-be/11-acceptance-review-matrix.md`

### P2-2 最终阶段总结与发布建议
- 状态：`done`
- 输出文件：`docs/refine/to-be/12-stage-summary-and-release-readiness.md`

## Closure Sign-off

- 状态：`closed`
- 结论：主线任务（Phase-0/1/2）全部完成并已收口。
- 验收证据：
  - `docs/refine/to-be/11-acceptance-review-matrix.md`（A-F 全量证据矩阵）
  - `docs/refine/to-be/12-stage-summary-and-release-readiness.md`（阶段总结与发布建议）
  - `docs/refine/to-be/13-compatibility-and-rollback-playbook.md`（E1/E2）
  - `docs/refine/to-be/14-migration-baseline-comparison.md`（E3）
  - `docs/refine/to-be/15-production-rollout-runbook.md`（上线执行手册）
  - `docs/refine/to-be/16-production-threshold-matrix.md`（阈值与回滚触发）

---

## Backlog-Appendix（执行中新增问题只允许追加到这里）

- `2026-03-07`：新增发布运营收口文档（不改变 A-F 验收结果，仅补充上线执行细则）
  - `docs/refine/to-be/15-production-rollout-runbook.md`
  - `docs/refine/to-be/16-production-threshold-matrix.md`
