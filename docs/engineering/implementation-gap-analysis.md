# PonyBunny 设计 vs 实现差距分析报告

> 生成日期: 2026-02-07
> 对比文档: `docs/techspec/architecture-overview.md`, `gateway-design.md`, `scheduler-design.md`, `ai-employee-paradigm.md`

## 总体评估

**整体实现完成度: ~85%**

系统的核心架构已经实现，包括 Gateway、Scheduler、8阶段生命周期、自主执行引擎等。但在一些细节功能上存在差距。

---

## 1. Gateway 层差距

| 设计要求 | 实现状态 | 差距说明 |
|---------|---------|---------|
| uWebSockets 服务器 | ⚠️ 部分 | 使用了 WebSocket 但未确认是否为 uWebSockets |
| JSON-RPC 协议 (req/res/event) | ✅ 完成 | MessageParser, MessageRouter 已实现 |
| Challenge-Response 认证 | ✅ 完成 | AuthManager, ChallengeGenerator 已实现 |
| Ed25519 签名验证 | ✅ 完成 | SignatureVerifier 已实现 |
| Pairing Token 验证 | ✅ 完成 | PairingTokenStore 已实现 |
| 心跳机制 (30s) | ✅ 完成 | Heartbeat 组件已实现 |
| RPC 方法处理器 | ✅ 完成 | goal.*, workitem.*, escalation.* 等已实现 |
| 事件广播 | ✅ 完成 | BroadcastManager, EventBus 已实现 |
| **审计日志** | ❌ 缺失 | 设计要求所有命令需要审计日志，未见实现 |
| **Per-session 命令白名单** | ⚠️ 部分 | Tool Allowlist 存在，但不是 per-session 级别 |

---

## 2. Scheduler 层差距

| 设计要求 | 实现状态 | 差距说明 |
|---------|---------|---------|
| 8阶段生命周期 | ⚠️ 部分 | 实现了8阶段但命名/职责有差异 |
| **Clarify (澄清)** | ❌ 缺失 | 设计要求独立的澄清阶段，实现中合并到 Intake/Elaboration |
| Decompose (分解) | ✅ 完成 | Planning Service 实现了 DAG 分解 |
| Define Success (定义成功) | ✅ 完成 | Verification Plan 在 Planning 中生成 |
| Select Model (模型选择) | ✅ 完成 | ModelSelector, ComplexityScorer 已实现 |
| Select Lane (通道选择) | ✅ 完成 | LaneSelector 已实现 (main, subagent, cron, session) |
| Monitor (监控) | ✅ 完成 | MonitorService, BudgetTracker 已实现 |
| Evaluate (评估) | ✅ 完成 | EvaluationService 已实现 |
| Retry (重试) | ✅ 完成 | RetryHandler 已实现 |
| **Stuck State 检测** | ⚠️ 部分 | 有超时检测，但未见专门的 stuck state 检测逻辑 |
| 权限获取重试机制 | ⚠️ 部分 | 有重试机制，但权限获取流程不完整 |

### 8阶段命名对比

| 设计文档 | 实际实现 |
|---------|---------|
| Clarify | Intake + Elaboration (合并) |
| Decompose | Planning |
| Define Success | Planning (内含) |
| Select Model | (Scheduler Core 内部) |
| Select Lane | (Scheduler Core 内部) |
| Monitor | Monitor |
| Evaluate | Evaluation |
| Retry | (Evaluation 内含) |
| - | Execution (设计中未单独列出) |
| - | Verification (设计中未单独列出) |
| - | Publish (设计中未单独列出) |

---

## 3. AI Employee 范式差距

| 设计要求 | 实现状态 | 差距说明 |
|---------|---------|---------|
| 三层责任模型 | ⚠️ 部分 | Tool Allowlist 实现了部分，但未见完整的三层分类 |
| Layer 1 自主执行 | ✅ 完成 | ReAct 循环实现自主执行 |
| **Layer 2 审批请求** | ⚠️ 部分 | 有 Approval handlers，但工作流不完整 |
| **Layer 3 禁止操作** | ⚠️ 部分 | Tool Allowlist 可阻止，但未见完整的禁止列表 |
| 升级触发检测 | ✅ 完成 | EscalationHandler 实现了多种触发条件 |
| **升级包完整性** | ⚠️ 部分 | 有 EscalationPacket 类型，但内容完整性未强制 |
| 决策日志 | ⚠️ 部分 | 有 Decision 类型，但审计追踪不完整 |
| 预算追踪 | ✅ 完成 | BudgetTracker 实现了 token/time/cost 追踪 |
| 3次重试限制 | ✅ 完成 | RetryHandler 有 maxAttempts 配置 |

---

## 4. 持久化层差距

| 设计要求 | 实现状态 | 差距说明 |
|---------|---------|---------|
| SQLite 存储 | ✅ 完成 | WorkOrderDatabase 已实现 |
| Goals 持久化 | ✅ 完成 | 完整 CRUD |
| WorkItems 持久化 | ✅ 完成 | 完整 CRUD |
| Runs 持久化 | ✅ 完成 | 完整 CRUD |
| Artifacts 持久化 | ✅ 完成 | 完整 CRUD |
| Decisions 持久化 | ✅ 完成 | 完整 CRUD |
| **Session 持久化** | ❌ 缺失 | 会话仅在内存中，重启丢失 |
| **审计日志持久化** | ❌ 缺失 | 未见审计日志表 |

---

## 5. 技能/工具系统差距

| 设计要求 | 实现状态 | 差距说明 |
|---------|---------|---------|
| Skill Registry | ✅ 完成 | 有 Skill 类型定义和注册 |
| Tool Registry | ✅ 完成 | ToolRegistry 已实现 |
| Tool Allowlist | ✅ 完成 | ToolAllowlist, ToolEnforcer 已实现 |
| **OS Service 权限管理** | ❌ 缺失 | 设计要求 Keychain/Browser/Docker 权限管理，未见实现 |
| **权限缓存** | ❌ 缺失 | 设计要求权限缓存机制，未见实现 |
| 内置工具 | ✅ 完成 | read_file, write_file, shell, search_code, web_search |

---

## 6. 对话系统差距

| 设计要求 | 实现状态 | 差距说明 |
|---------|---------|---------|
| Conversation Agent | ✅ 完成 | SessionManager, PersonaEngine 等已实现 |
| 自然语言理解 | ✅ 完成 | InputAnalysisService 已实现 |
| 个性化响应 | ✅ 完成 | PersonaEngine 已实现 |
| 对话状态管理 | ✅ 完成 | ConversationStateMachine 已实现 |
| **进度叙述** | ⚠️ 部分 | 有事件推送，但未见专门的进度叙述生成 |

---

## 7. 关键缺失功能汇总

### 高优先级 (影响核心功能)

1. **审计日志系统** - 设计明确要求所有命令需要审计日志，当前完全缺失
2. **OS Service 权限管理** - 设计要求 Keychain/Browser/Docker 等系统服务的权限获取流程
3. **Session 持久化** - 会话数据仅在内存中，服务重启会丢失
4. **完整的三层责任模型** - Layer 2/3 的操作分类和强制执行不完整

### 中优先级 (影响用户体验)

5. **独立的 Clarify 阶段** - 设计要求独立的目标澄清阶段，当前合并到其他阶段
6. **Stuck State 检测** - 需要专门的卡住状态检测逻辑
7. **Per-session 命令白名单** - 当前是全局白名单，非会话级别
8. **升级包完整性验证** - 需要强制验证升级包包含所有必需字段

### 低优先级 (可后续完善)

9. **权限缓存机制** - 避免重复请求权限
10. **进度叙述生成** - 更友好的进度描述
11. **AbortSignal 传播** - 执行管道中的信号传递不完整

---

## 8. 架构一致性问题

1. **8阶段命名不一致** - 实现中的阶段命名与设计文档不完全匹配
2. **Escalation Repository 方法存根** - `scheduler-factory.ts` 中有 TODO 注释，部分方法未完全实现
3. **Runtime 层过于简单** - 设计中 Runtime 应该更完整，当前仅是简单包装

---

## 9. 建议的修复优先级

### Phase 1 - 核心安全与合规

1. 实现审计日志系统 (所有命令记录)
2. 完善三层责任模型的强制执行
3. 添加 Session 持久化

### Phase 2 - 功能完整性

4. 实现 OS Service 权限管理
5. 添加独立的 Clarify 阶段
6. 实现 Stuck State 检测

### Phase 3 - 优化与增强

7. Per-session 命令白名单
8. 权限缓存机制
9. 升级包完整性验证
10. AbortSignal 完整传播

---

## 10. 完成度总结

| 类别 | 完成度 |
|-----|-------|
| Gateway 层 | 90% |
| Scheduler 层 | 85% |
| AI Employee 范式 | 75% |
| 持久化层 | 85% |
| 技能/工具系统 | 80% |
| 对话系统 | 95% |
| **整体** | **~85%** |

### 主要差距集中在

- **安全审计** - 审计日志缺失
- **权限管理** - OS Service 权限、三层模型
- **状态持久化** - Session 持久化
- **生命周期细节** - Clarify 阶段、Stuck 检测

核心架构和主要功能已经实现，但在安全合规和细节功能上需要补充完善。

---

## 附录: 代码位置参考

| 组件 | 文件位置 |
|-----|---------|
| Gateway Server | `src/gateway/gateway-server.ts` |
| Scheduler Core | `src/scheduler/core/scheduler.ts` |
| 8阶段生命周期 | `src/app/lifecycle/` |
| ReAct 执行引擎 | `src/autonomy/react-integration.ts` |
| 工具注册 | `src/infra/tools/tool-registry.ts` |
| 持久化层 | `src/infra/persistence/work-order-repository.ts` |
| 对话系统 | `src/app/conversation/` |
| CLI/TUI | `src/cli/` |
