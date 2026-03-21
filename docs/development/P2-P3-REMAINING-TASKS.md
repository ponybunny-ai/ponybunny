# P2/P3 遗留问题修复任务

**背景**: 2026-03-20 基线审计中 P0/P1 已全部修复，P2 快速修复项已完成。以下是剩余待处理项。
**前置条件**: 214/214 suites, 1713/1713 tests 全绿，构建零错误。
**审计报告**: `docs/development/BASELINE-AUDIT-2026-03-20.md`

---

## 任务 1: infra/gateway/scheduler 层 console 输出加 debug 门控

**优先级**: P2 | **影响范围**: ~200 处 / ~30 个文件 | **风险**: 低

**问题**: CLI 层的 console 输出是用户界面（合理），但 `src/infra/`、`src/gateway/`、`src/scheduler/` 层约 200 处 `console.log/warn` 未通过 debug 标志控制，在生产运行时产生大量噪音。

**实施方案**:
1. 定位所有非 CLI 层的 `console.log` 和 `console.warn`（排除 `console.error`，错误日志不应被 gate）
2. 对每处调用判断：是运维日志（保留）还是调试输出（需 gate）
3. 调试输出改用 `isPonyBunnyDebugEnabled()` 守卫：
   ```typescript
   import { isPonyBunnyDebugEnabled } from '../infra/config/debug-flags.js';
   if (isPonyBunnyDebugEnabled()) { console.log('[Module] ...'); }
   ```
4. 重点文件（按 console 调用数排序）:
   - `src/infra/llm/routing/model-router.ts` (18 处) — ModelRouter 解析日志全部带 emoji，应 gate
   - `src/infra/llm/unified-provider.ts` (14 处)
   - `src/gateway/bootstrap/gateway-server-runtime-lifecycle.ts` (17 处)
   - `src/gateway/gateway-server.ts` (13 处)
   - `src/infra/mcp/client/mcp-client.ts` (7 处)
   - `src/infra/llm/provider-manager/provider-manager.ts` (6 处)
   - `src/infra/mcp/adapters/registry-integration.ts` (6 处)

**验证**: `npm test` 全部通过，`npm run build` 零错误。

---

## 任务 2: 消除高风险 `as any` 类型转换

**优先级**: P2 | **影响范围**: 40 处 / 18 个文件 | **风险**: 中

**问题**: `as any` 绕过类型检查，隐藏潜在的运行时错误。

**实施方案** (按风险排序):

### 2a. `src/gateway/gateway-server.ts` (3 处)
- `(ws as any)._connectionId` — 在 WebSocket 上挂载私有字段
- **修复**: 用 `WeakMap<WebSocket, string>` 替代在 ws 对象上挂载属性

### 2b. `src/gateway/protocol/message-router.ts` (2 处)
- `(this.authManager as any).tokenStore` — 访问 AuthManager 私有属性
- **修复**: 在 `AuthManager` 上暴露 public getter

### 2c. `src/app/escalation/escalation-validator.ts` (8 处)
- `(p.context as any)?.field` — 访问 escalation packet 的嵌套字段
- **修复**: 为 `IEscalationPacket.context` 定义具体类型（而非 `Record<string, unknown>`），或使用类型守卫函数

### 2d. `src/infra/llm/providers.ts` (3 处)
- **修复**: 根据具体用途添加适当类型

### 2e. 其余文件
- `src/cli/debug-tui/views/tasks-view.tsx` (4 处)
- `src/infra/mcp/adapters/tool-adapter.ts` (2 处)
- `src/infra/llm/gemini-provider.ts` (2 处)
- `src/cli/ui/chat-ui.tsx` (2 处) 等

**验证**: `npm test` 全部通过，`npm run build` 零错误。

---

## 任务 3: LLM 协议层添加请求/响应类型

**优先级**: P2 | **影响范围**: 4 个文件 | **风险**: 中

**问题**: 核心 LLM 交互层的请求和响应 body 均为 `any`，缺乏类型安全。

**实施方案**:
1. `src/infra/llm/protocols/openai-protocol.ts`
   - 定义 `OpenAIRequestBody` 和 `OpenAIResponseBody` 接口
   - 替换 `requestBody: any` → `requestBody: OpenAIRequestBody`
2. `src/infra/llm/protocols/anthropic-protocol.ts`
   - 定义 `AnthropicRequestBody` 和 `AnthropicResponseBody`
   - 替换 `content: any[]` → 具体 content block 联合类型
3. `src/infra/llm/protocols/gemini-protocol.ts`
   - 定义 `GeminiRequestBody` 和 `GeminiResponseBody`
   - 约 4 处 `any` 需替换
4. `src/infra/llm/protocols/codex-protocol.ts`
   - 同上模式

**注意**: 每个 LLM 提供商的 API 格式不同，类型定义需参考各自 API 文档。不需要 100% 覆盖所有字段，先覆盖核心请求/响应结构。

**验证**: `npm test` 全部通过，`npm run build` 零错误。

---

## 任务 4: 实现 `collectArtifacts()`

**优先级**: P2 | **影响范围**: 1 个文件 | **风险**: 中

**问题**: `src/autonomy/react-integration.ts:1248-1250` 的 `collectArtifacts()` 始终返回空数组，Artifact 收集功能未实现。

**实施方案**:
1. 阅读 `src/domain/work-order/types.ts` 中 `Artifact` 类型定义
2. 阅读 `src/infra/persistence/work-order-repository.ts` 中的 artifact 相关方法
3. 在 `collectArtifacts()` 中收集执行过程中产生的 artifacts（文件路径、代码片段、命令输出等）
4. 通过 repository 的 `createArtifact()` 持久化

**验证**: `npm test` 全部通过。

---

## 任务 5: 会话仓储迁移至 SQLite

**优先级**: P2 | **影响范围**: 2-3 个文件 | **风险**: 中

**问题**: `src/infra/conversation/session-repository.ts` 使用 `InMemorySessionRepository`，进程重启后会话丢失。代码注释明确说需要 SQLite 替换。

**实施方案**:
1. 在 `schema.sql` 中添加 `conversation_sessions` 表
2. 实现 `SqliteSessionRepository implements ISessionRepository`
3. 在组合根中替换 `InMemorySessionRepository` → `SqliteSessionRepository`
4. 数据迁移：新表可以为空启动，无需迁移旧数据

**验证**: `npm test` 全部通过，手动验证 `pb` TUI 中会话恢复。

---

## 任务 6: 环境变量集中管理

**优先级**: P2 | **影响范围**: ~10 个文件 | **风险**: 低

**问题**: 环境变量分散在各模块中直接读取 `process.env`，无集中注册/校验/文档机制。

**已知环境变量**:
| 变量 | 位置 |
|------|------|
| `PONY_BUNNY_DEBUG` | infra/config/debug-flags.ts (已有统一入口) |
| `PONY_MEMORY_EMBEDDING_MODEL` | app/conversation/local-embedding-service.ts |
| `PONY_SKILL_SUGGESTIONS` | autonomy/react-integration.ts |
| `PONY_GATEWAY_BACKGROUND` | cli/commands/gateway.ts |
| `PONY_GATEWAY_DAEMON_CHILD` | cli/commands/gateway.ts |
| `PONY_SCHEDULER_BACKGROUND` | cli/commands/scheduler-daemon.ts |
| `PERPLEXITY_API_KEY` | infra/tools/implementations/web-search-tool.ts |
| `OPENROUTER_API_KEY` | infra/tools/implementations/web-search-tool.ts |
| `PONY_MODEL_SIMPLE/MEDIUM/COMPLEX` | scheduler/model-selector/model-tier-config.ts |

**实施方案**:
1. 在 `src/infra/config/` 下创建 `env-vars.ts`，集中注册所有环境变量及其默认值、描述
2. 各模块从 `env-vars.ts` 导入，而非直接读取 `process.env`
3. 提供 `validateEnvVars()` 启动时校验必要变量

**验证**: `npm test` 全部通过。

---

## 任务 7: 硬编码配置值提取

**优先级**: P2 | **影响范围**: 6+ 个文件 | **风险**: 低

**问题**: 多处硬编码的配置值应提取为命名常量或配置项。

**待提取项**:
| 文件 | 当前值 | 建议 |
|------|--------|------|
| `infra/llm/protocols/openai-protocol.ts:23` | `'gpt-5'` | 提取为 `OPENAI_REASONING_MODEL_PREFIX` 常量 |
| `infra/tools/implementations/web-search-tool.ts:59` | 1h TTL, 100 entries | 提取为构造函数参数 |
| `infra/audit/audit-service.ts:24-25` | batch=50, flush=1000ms | 提取为 `AuditServiceConfig` |
| `infra/permission/os-service-checker.ts:311` | 30 min | 提取为 `PERMISSION_REQUEST_EXPIRY_MS` |
| `infra/mcp/client/mcp-client.ts:41-42` | 5 retries, 5000ms | 已有 config，但值硬编码在默认值中 |
| `cli/commands/status.ts:58` | `https://api.openai.com/v1` | 提取为常量 |

**验证**: `npm test` 全部通过。

---

## 任务 8: P3 命名一致性修复

**优先级**: P3 | **影响范围**: ~10 个文件 | **风险**: 低

### 8a. 接口命名 `I` 前缀
Domain 层 13+ 个接口缺少约定的 `I` 前缀。注意区分：
- **需要加前缀的**: `AuditLogFilter` → `IAuditLogFilter`, `AuditStatistics` → `IAuditStatistics`
- **不需要的**: DB Row 类型 (`PermissionRequestRow` 等) 和 DTO (`WorkItemRunResultDTO`) 按约定不加

### 8b. 会话接口字段可选性
- `IConversationSession.lifecycleState?` 可选 vs `ISessionSummary.lifecycleState` 必填
- 统一为 `ISessionSummary.lifecycleState?` 可选，或确保 Session 构建 Summary 时提供默认值

### 8c. 本地地址检测逻辑重复
- `src/gateway/gateway-server.ts:596-606` 和 `src/gateway/connection/connection-manager.ts:83-90`
- 提取为 `src/gateway/utils/network.ts` 中的 `isLocalAddress(addr: string): boolean`

**验证**: `npm test` 全部通过。

---

## 执行顺序建议

1. **任务 1** (console gating) — 最大噪音源，影响运行时日志可读性
2. **任务 2** (as any) — 类型安全提升
3. **任务 3** (LLM 类型) — 核心交互层类型安全
4. **任务 7** (硬编码) — 快速，低风险
5. **任务 6** (环境变量) — 低风险基础设施
6. **任务 8** (P3 命名) — 低风险规范化
7. **任务 4** (collectArtifacts) — 需要理解执行流程
8. **任务 5** (SQLite 会话) — 需要 schema 变更

每个任务完成后运行 `npm test` 和 `npm run build` 确认不引入回归。
