# PonyBunny 代码基线审计报告

**日期**: 2026-03-20
**审计方**: Claude Opus 4.6 接手梳理
**背景**: 项目由 OpenAI Codex 开发，存在多处缺口和不一致，现交接并建立 baseline
**P0 修复状态**: 全部完成 — 214/214 suites, 1713/1713 tests 通过

---

## 一、整体健康度

| 指标 | 状态 |
|------|------|
| TypeScript 编译 | **通过** (零错误) |
| 测试套件 | 214 suites, **1713 通过 / 0 失败** (100%) — P0 修复后 |
| ESM `.js` 扩展名 | **全部合规** (未发现缺失) |
| 架构层级隔离 (domain→infra) | **合规** (domain 未导入 infra/gateway/scheduler) |
| `export default` 违规 | **1 处** (cli/tui/app.tsx — React 组件，可接受) |

### 两个失败测试 — 已修复

| 测试文件 | 失败原因 | 修复方案 |
|----------|----------|----------|
| `test/infra/persistence/schema-resolution.test.ts` | `getPersistenceAssetCandidates` 仅搜索 `cwd` 和 `argv[1]` 附近路径，在 Jest worker 中 cwd 变更后无法定位 `schema.sql` | `runtime-asset-paths.ts` 增加 `getProjectRootCandidates()` — 从入口点向上遍历查找 `package.json` (跳过 `node_modules`) |
| `test/gateway/integration/scheduler-factory.test.ts` | (1) mock repository 缺少 `mergeRunContext` 等方法，`publishTaskReady` 内部调用抛 TypeError 被静默吞掉；(2) evented 模式下 `dispatchExecution` 未 await | (1) 补全 test mock 方法；(2) evented 模式下 await `dispatchExecution` |

---

## 二、遗留问题清单

### P0 — 必须立即修复 (影响正确性/安全性) — ✅ 全部已修复

#### 2.1 ✅ 域类型冲突：`OSService` 重复定义且值不同
- `src/domain/permission/types.ts:144-153` 包含 `'camera'`, `'microphone'`
- `src/domain/permission/os-service.ts:12-21` 包含 `'process'`, `'environment'`
- 两处定义不兼容，使用方可能引用到错误的类型集合

#### 2.2 ✅ 环依赖检测算法缺陷
- `src/domain/work-order/invariants.ts:96` — `new Set(visited)` 为每个分支创建独立副本
- 在菱形依赖 (A→B, A→C, B→D, C→D) 场景下不会误报，但真正的环可能因分支隔离而漏检
- 应传递同一个 `visited` 集合或使用 DFS 着色法

#### 2.3 ✅ `ModelSelector.selectModel()` 签名不匹配 — 经审查非 bug
- `IModelSelectorAdapter` (types.ts:188) 定义 2 参数签名 `selectModel(workItem, goal)`
- `SchedulerCore` 通过 adapter 接口调用，签名匹配
- `default-scheduler.ts:116` 的 adapter 正确桥接：`(workItem, _goal) => modelSelector.selectModel(workItem)`
- 目前 goal 上下文不参与复杂度评分是设计选择，非缺陷

#### 2.4 ✅ 两个失败测试 — 已修复
- schema-resolution: `runtime-asset-paths.ts` 增加 package.json 向上查找
- scheduler-factory: 补全 mock + evented 模式 await dispatch

---

### P1 — 高优先级 (内存泄漏/资源管理/安全) — 经复核 3 项已修复，4 项降级

#### 2.5 ~~WebSocket 连接限制竞态条件~~ → 降级：非实际问题
- Node.js 单线程模型中 `handleConnection` 回调同步执行，不存在并发竞态

#### 2.6 ~~BudgetTracker 回调永不清理~~ → 降级：死代码
- `usageCallbacks` 通过 adapter 暴露的接口中无人调用 `registerUsageCallback`，Map 始终为空

#### 2.7 ✅ IPC 客户端自动重连时 resolve 成功
- 修复：`autoReconnect` 模式下初始连接失败改为 `reject()`，调用方可感知失败
- 后台重连仍会继续，但 `await connect()` 的语义正确了

#### 2.8 ✅ IPC socketBuffer 无上限
- 修复：client 和 server 均添加 1 MB 上限，超限则丢弃缓冲区并记录错误日志

#### 2.9 ✅ 认证速率限制
- 修复：`AuthManager` 新增滑动窗口速率限制（默认 10 次/分钟）
- `handleHello` 和 `handlePair` 入口检查，`cleanup()` 清理过期记录

#### 2.10 ~~SchedulerBridge 事件处理器泄漏~~ → 降级：非实际问题
- `connect()` 有 `if (this.scheduler)` 防重入守卫
- `disconnect()` 正确清理 handler 后置空

#### 2.11 ~~Scheduler 多 Map 状态非原子更新~~ → 降级：低风险
- Node.js 单线程中同步 Map 操作之间不会被中断
- async 边界上的不一致理论上存在，但实际影响极小（错误会被上层 catch 处理）

---

### P2 — 中优先级 (代码质量/可维护性)

#### 2.12 大量 console 输出未受 debug 标志控制
- **总计 ~1,297 处** `console.log/warn/debug` 分布在 71 个文件中
- 重灾区:
  - `src/cli/commands/scheduler-daemon.ts`: 161 处
  - `src/cli/commands/auth.ts`: 119 处
  - `src/cli/commands/gateway.ts`: 108 处
  - `src/cli/commands/service.ts`: 67 处
  - `src/cli/commands/results.ts`: 49 处
  - `src/cli/commands/skills.ts`: 49 处
  - `src/cli/commands/debug.ts`: 43 处
- CLI 命令层的 console 输出是用户界面的一部分（合理），但 infra/gateway/scheduler 层的 ~200 处需要 gating

#### 2.13 `as any` 类型转换 (40 处/18 个文件)
- 重灾区:
  - `src/app/escalation/escalation-validator.ts`: 8 处 — 用 `(p.context as any)?.field` 访问嵌套属性
  - `src/cli/debug-tui/views/tasks-view.tsx`: 4 处
  - `src/gateway/gateway-server.ts`: 3 处 — `(ws as any)._connectionId` 挂载私有字段
  - `src/infra/llm/providers.ts`: 3 处
  - `src/gateway/protocol/message-router.ts`: 2 处 — `(this.authManager as any).tokenStore` 访问私有属性

#### 2.14 ✅ 遗留死文件 — 已删除
- ~~`src/autonomy/daemon-old.ts`~~ (304 行) — 已删除
- ~~`src/infra/persistence/work-order-repository.ts.bak`~~ (21KB) — 已删除

#### 2.15 测试文件混入源码目录 — 延迟处理
- `src/infra/skills/skill-loader.test.ts`, `src/infra/config/debug-flags.test.ts` 等
- 使用相对路径导入同目录模块，移动需改写所有导入路径，收益低
- Jest 已配置匹配 `**/src/**/*.test.ts`，功能不受影响

#### 2.16 LLM 协议层类型全部是 `any`
- `src/infra/llm/protocols/openai-protocol.ts:146` — `requestBody: any`
- `src/infra/llm/protocols/anthropic-protocol.ts:49,82` — `content: any[]`, `requestBody: any`
- `src/infra/llm/protocols/gemini-protocol.ts:40,74,135,268` — 多处 `any`
- 核心 LLM 交互层缺乏类型安全

#### 2.17 会话仓储仍为内存实现
- `src/infra/conversation/session-repository.ts:22` 注释明确说 "For production, this should be replaced with SQLite persistence"
- InMemorySessionRepository 未被替换

#### 2.18 `collectArtifacts()` 空实现
- `src/autonomy/react-integration.ts:1248-1250` 始终返回 `[]`
- Artifact 收集功能未实现

#### 2.19 环境变量分散无集中管理
| 变量 | 位置 |
|------|------|
| `PONY_MEMORY_EMBEDDING_MODEL` | app/conversation/local-embedding-service.ts |
| `PONY_SKILL_SUGGESTIONS` | autonomy/react-integration.ts |
| `PONY_GATEWAY_BACKGROUND` | cli/commands/gateway.ts |
| `PONY_GATEWAY_DAEMON_CHILD` | cli/commands/gateway.ts |
| `PONY_SCHEDULER_BACKGROUND` | cli/commands/scheduler-daemon.ts |
| `PERPLEXITY_API_KEY` | infra/tools/implementations/web-search-tool.ts |
| `OPENROUTER_API_KEY` | infra/tools/implementations/web-search-tool.ts |

无集中注册/校验机制。

#### 2.20 ✅ Gemini 协议 tool call ID — 已修复
- 改用 `randomUUID()` from `node:crypto` 替代 `Date.now()_${Math.random()}`

#### 2.21 空 catch 块 — 经复核大部分合理
- `subagent-process-manager.ts:117` — `child.kill('SIGKILL')` catch 合理（进程可能已退出）
- `codex-protocol.ts:138` — JSON 解析失败返回 null 是防御性编程
- `config-loader.ts` — 配置加载失败使用默认值是预期行为
- 其余 catch 多为 JSON.parse / 文件读取失败的合理降级

#### 2.22 硬编码配置值
| 文件 | 值 | 说明 |
|------|------|------|
| `infra/llm/protocols/openai-protocol.ts:23` | `gpt-5` | 版本特定的模型检查 |
| `infra/tools/implementations/web-search-tool.ts:59` | 1 hour, 100 entries | 缓存 TTL 和大小 |
| `infra/audit/audit-service.ts:24-25` | batch=50, flush=1000ms | 审计服务配置 |
| `infra/permission/os-service-checker.ts:311` | 30 minutes | 权限请求过期时间 |
| `infra/mcp/client/mcp-client.ts:41-42` | 5 retries, 5000ms delay | MCP 重连配置 |
| `cli/commands/status.ts:58` | `https://api.openai.com/v1` | 默认 baseUrl |

---

### P3 — 低优先级 (命名一致性/代码风格)

#### 2.23 接口命名不一致 (缺少 `I` 前缀)
Domain 层有 13+ 个接口/类型缺少项目约定的 `I` 前缀:
- `WorkItemRunResultDTO`, `BuildWorkItemRunResultDTOInput` (result-dto.ts)
- `Skill`, `SkillMetadata` (skill/types.ts)
- `AuditLogRow`, `AuditLogFilter`, `AuditStatistics` (audit/types.ts)
- `KeychainScope`, `BrowserScope`, `DockerScope`, `NetworkScope`, `FilesystemScope`, `ProcessScope` (permission/os-service.ts)
- `OSPermissionRequestRow`, `OSPermissionGrantRow` (permission/os-service.ts)
- `PermissionRequestRow`, `PermissionGrantRow` (permission/types.ts)

注：部分是 DB Row 类型和 DTO，是否需要 `I` 前缀可讨论。

#### 2.24 会话接口字段可选性不一致
- `IConversationSession.lifecycleState?` 可选 (session.ts:28)
- `ISessionSummary.lifecycleState` 必填 (session.ts:52)
- Summary 不总能从 Session 构建

#### 2.25 本地地址检测逻辑重复
- `src/gateway/gateway-server.ts:596-606`
- `src/gateway/connection/connection-manager.ts:83-90`
- 相同逻辑两处实现，应提取为共享工具函数

---

## 三、统计总览

| 类别 | 数量 | 严重度 |
|------|------|--------|
| ~~失败测试~~ | ~~2~~ | ~~P0~~ ✅ 已修复 |
| ~~类型冲突/签名不匹配~~ | ~~2~~ | ~~P0~~ ✅ 已修复 |
| ~~算法缺陷~~ | ~~1~~ | ~~P0~~ ✅ 已修复 |
| ~~IPC 连接语义~~ | ~~1~~ | ~~P1~~ ✅ 已修复 |
| ~~IPC 缓冲区上限~~ | ~~2~~ | ~~P1~~ ✅ 已修复 (client+server) |
| ~~认证速率限制~~ | ~~1~~ | ~~P1~~ ✅ 已修复 |
| ~~WebSocket 竞态/BudgetTracker/Bridge/Scheduler~~ | ~~4~~ | ~~P1~~ 降级 (非实际问题) |
| 未 gate 的 console 输出 | ~200 处 (非 CLI 层) | P2 待处理 |
| `as any` 类型转换 | 40 处 | P2 待处理 |
| ~~死文件/备份文件~~ | ~~2~~ | ~~P2~~ ✅ 已删除 |
| 空实现/桩代码 | 3 | P2 待处理 |
| ~~空 catch 块~~ | ~~3~~ | ~~P2~~ 降级 (合理的防御性编程) |
| 硬编码配置 | 6+ 处 | P2 待处理 |
| LLM 协议层缺类型 | 4 个文件 | P2 待处理 |
| ~~Gemini tool call ID~~ | ~~1~~ | ~~P2~~ ✅ 改用 randomUUID() |
| 命名不一致 | 13+ 处 | P3 |

---

## 四、建议修复路线

### ~~第一批 (P0 — 正确性)~~ ✅ 已完成
1. ✅ `OSService` — 合并为 `os-service.ts` 单一权威定义，`types.ts` 改为 re-export
2. ✅ `hasCyclicDependency()` — 改用 DFS 回溯法（共享 ancestors + delete）
3. ✅ `ModelSelector` 签名 — 经审查非 bug，adapter 模式正确桥接
4. ✅ 两个测试 — schema 路径解析 + evented 模式 dispatch + mock 补全

### ~~第二批 (P1 — 稳定性)~~ ✅ 已完成
5. ~~BudgetTracker 回调清理~~ — 降级：adapter 中为死代码
6. ~~WebSocket 连接限制原子化~~ — 降级：Node.js 单线程无竞态
7. ✅ IPC 客户端重连语义修正 — `connect()` 初始失败改为 reject
8. ✅ IPC socketBuffer 上限 — client + server 均添加 1 MB 限制
9. ✅ Auth 速率限制 — 滑动窗口 10 次/分钟
10. ~~SchedulerBridge 事件处理器~~ — 降级：已有防重入守卫
11. ~~Scheduler 多 Map 事务性~~ — 降级：单线程低风险

### 第三批 (P2 — 代码质量) — 部分完成
12. ✅ 删除 `daemon-old.ts` 和 `.bak` 文件
13. 待处理：infra/gateway/scheduler 层 console 输出加 debug 门控
14. 待处理：LLM 协议层添加请求/响应类型
15. 待处理：消除高风险 `as any` (尤其是 gateway-server 和 escalation-validator)
16. 待处理：实现 `collectArtifacts()`
17. 待处理：会话仓储迁移至 SQLite
18. 待处理：环境变量集中管理
19. ✅ Gemini tool call ID 改用 `randomUUID()`
20. ~~空 catch 块~~ — 经复核为合理的防御性编程

### 第四批 (P3 — 规范化)
19. 统一接口命名约定
20. 提取重复的本地地址检测逻辑
21. 测试文件从 src/ 移至 test/
