# Component Design (OpenClaw Architecture Reference)

本文档详细拆解 OpenClaw 项目的组件架构，作为 PonyBunny 实现的工程参考指南。

---

## 1. Gateway Server — 核心控制平面

### 1.1 职责与定位

Gateway (`src/gateway/server.impl.ts`, ~590 lines) 是 OpenClaw 的中央神经系统，负责：

- **WebSocket 服务器**：提供 RPC 接口，接收来自 CLI、Web UI、移动端的连接
- **会话管理**：维护 `sessionId` 到 Session History 的映射
- **消息路由**：将 Channel 事件路由到对应的 Agent 处理流程
- **生命周期管理**：统筹所有子系统（Channels、Cron、Discovery、Plugins）的启动和关闭

### 1.2 启动序列（Startup Sequence）

```typescript
async function startGatewayServer(port, opts) {
  // 1. Bootstrap
  loadConfig()
  migrateLegacyConfig()
  createSubsystemLogger("gateway")
  
  // 2. State Creation
  createGatewayRuntimeState() // HTTP/WS servers, Client managers
  
  // 3. Load Plugins
  loadGatewayPlugins()         // Internal + External plugins
  
  // 4. Initialize Subsystems
  createChannelManager()       // Messaging adapters (WhatsApp, Slack, etc.)
  buildGatewayCronService()    // Scheduled tasks
  NodeRegistry.init()          // Mobile/macOS node tracking
  
  // 5. Start Network Services
  startGatewayDiscovery()      // mDNS/Bonjour
  startGatewayTailscaleExposure() // Optional Tailscale binding
  
  // 6. Background Services
  startHeartbeatRunner()       // Health checks
  startGatewayMaintenanceTimers() // Cleanup tasks
  applyGatewayLaneConcurrency() // Configure lane limits
  
  // 7. Attach WebSocket Handlers
  attachGatewayWsHandlers()    // Map RPC methods to handlers
}
```

**关键设计决策**：
- **渐进式初始化**：插件失败不阻塞核心功能
- **配置热重载**：`startGatewayConfigReloader()` 监听 `config.json5` 变化
- **优雅关闭**：`close()` 方法支持 `restartExpectedMs` 参数，通知客户端预期重启时间

### 1.3 Runtime State 结构

```typescript
type GatewayRuntimeState = {
  wss: WebSocket.Server,           // WebSocket 服务器实例
  clients: Map<clientId, WsClient>, // 已连接客户端
  pluginRegistry: PluginRegistry,   // 插件访问接口
  deps: CliDeps,                    // 依赖注入容器（CLI 工具等）
  nodeRegistry: NodeRegistry,       // 已配对的移动/桌面节点
  execApprovalManager: ExecApprovalManager, // 命令审批管理器
  channelManager: ChannelManager,   // Channel 实例管理
  cronService: CronService,         // Cron 任务调度器
}
```

**共享状态传递**：所有 RPC handler 接收 `state: GatewayRuntimeState` 参数，实现依赖注入模式。

---

## 2. Agent Runtime — ReAct 执行引擎

### 2.1 双模式架构

OpenClaw 支持两种 Agent 运行模式：

| 模式 | 实现 | 适用场景 |
|:---|:---|:---|
| **Embedded Pi Agent** | `src/agents/pi-embedded-runner/run.ts` (~693 lines) | 主要模式，高性能，进程内执行 |
| **CLI Agent** | `src/agents/claude-cli-runner.ts` | 遗留模式，独立进程，调试用 |

### 2.2 Embedded Pi Agent 执行流程

```typescript
async function runEmbeddedPiAgent(params: RunEmbeddedPiAgentParams): Promise<EmbeddedPiRunResult> {
  // Phase 1: 解析模型与认证
  const { model, authStorage, modelRegistry } = resolveModel(provider, modelId, agentDir, config)
  const authStore = ensureAuthProfileStore(agentDir)
  const profileOrder = resolveAuthProfileOrder({ cfg, store, provider, preferredProfile })
  
  // Phase 2: 上下文窗口校验
  const ctxInfo = resolveContextWindowInfo({ cfg, provider, modelId, modelContextWindow })
  const ctxGuard = evaluateContextWindowGuard({ info, warnBelowTokens, hardMinTokens })
  
  // Phase 3: 构建运行 Payload
  const { systemPrompt, messages, tools } = await buildEmbeddedRunPayloads({
    history,
    workspaceSkills,
    globalTools,
    extraParams,
  })
  
  // Phase 4: Failover 循环
  for (const profileId of profileCandidates) {
    apiKeyInfo = getApiKeyForModel(profileId, provider, model, authStore)
    
    try {
      // Phase 5: 执行单次 LLM 调用
      const result = await runEmbeddedAttempt({
        model,
        apiKey: apiKeyInfo.apiKey,
        messages,
        tools,
        thinkLevel,
        onDelta: streamingCallback,
      })
      
      // Phase 6: 处理响应
      if (result.success) {
        markAuthProfileGood(profileId)
        return { status: "success", usage, messages }
      }
      
    } catch (error) {
      // Phase 7: 错误分类与 Failover
      if (isContextOverflowError(error)) {
        await compactEmbeddedPiSessionDirect({ sessionId, messages })
        // Retry with compacted history
      } else if (isAuthAssistantError(error)) {
        markAuthProfileFailure(profileId, "auth", cooldownMs)
        // Try next profile
      } else if (isRateLimitAssistantError(error)) {
        markAuthProfileFailure(profileId, "rate_limit", cooldownMs)
        // Try next profile
      } else {
        throw new FailoverError(error.message, { reason: "unknown", provider, model })
      }
    }
  }
  
  // Phase 8: 所有 Profile 失败，抛出 Failover 异常
  throw new FailoverError("All auth profiles exhausted", { reason: "auth", provider, model })
}
```

**核心设计模式**：

1. **认证轮转**：按优先级遍历 auth profiles，失败时进入冷却期（避免重复 429 错误）
2. **智能 Failover**：根据错误类型（auth、rate_limit、context_overflow）选择不同的恢复策略
3. **上下文压缩**：遇到 `context_length_exceeded` 时自动触发 Compaction，压缩后重试
4. **Thinking Level 降级**：如果模型不支持 `thinkLevel: high`，自动降级到 `medium`、`low`、`off`

### 2.3 Lane-based 并发控制

**实现位置**：`src/process/command-queue.ts` (161 lines)

```typescript
type LaneState = {
  lane: string,              // Lane 标识符
  queue: QueueEntry[],       // FIFO 队列
  active: number,            // 当前正在执行的任务数
  maxConcurrent: number,     // 并发限制
  draining: boolean,         // 是否正在排空队列
}

function drainLane(lane: string) {
  const state = getLaneState(lane)
  
  const pump = () => {
    while (state.active < state.maxConcurrent && state.queue.length > 0) {
      const entry = state.queue.shift()
      state.active += 1
      
      entry.task().then(result => {
        state.active -= 1
        pump()  // 继续排空
        entry.resolve(result)
      }).catch(err => {
        state.active -= 1
        pump()
        entry.reject(err)
      })
    }
  }
  
  pump()
}
```

**Lane 类型与配置**：

| Lane | 用途 | 默认并发数 | 配置路径 |
|:---|:---|:---|:---|
| `main` | 主 Agent 执行（用户直接对话） | Config 可调 | `agents.defaults.maxConcurrent` |
| `subagent` | 子 Agent 执行（Agent 生成的子任务） | Config 可调 | `agents.defaults.subagent.maxConcurrent` |
| `cron` | 定时任务 | 1（串行化） | `cron.maxConcurrentRuns` |
| `nested` | 嵌套执行（特殊情况） | 1（硬编码） | N/A |
| `session:{id}` | 按 Session 隔离的 Lane | 1（串行化） | 动态创建 |

**设计目标**：
- **资源隔离**：Cron 任务不会阻塞用户交互
- **顺序保证**：同一 Session 的消息严格串行处理
- **可配置性**：根据硬件资源调整并发数

---

## 3. Session Compaction — 上下文压缩引擎

### 3.1 触发条件

**实现位置**：`src/agents/compaction.ts` (357 lines)

Compaction 在以下情况自动触发：

1. **预防性压缩**：Token 估算值达到模型窗口的 **80%**
2. **API 错误响应**：收到 `context_length_exceeded` 异常
3. **手动触发**：用户发送 `/compact` 命令

### 3.2 Multi-Part Summarization 算法

```typescript
export async function compactSession(
  messages: AgentMessage[],
  targetTokens: number,
  ext: ExtensionContext,
): Promise<CompactResult> {
  const currentTokens = estimateMessagesTokens(messages)
  
  if (currentTokens <= targetTokens) {
    return { compacted: false, messages }
  }
  
  // Step 1: 计算分块数
  const chunkRatio = BASE_CHUNK_RATIO // 0.4
  const parts = Math.max(2, Math.ceil(1 / chunkRatio))
  
  // Step 2: 按 Token 均分消息
  const chunks = splitMessagesByTokenShare(messages, parts)
  
  // Step 3: 并发生成每部分的摘要
  const summaries = await Promise.all(
    chunks.map(chunk => generateSummary(chunk, ext))
  )
  
  // Step 4: 合并摘要（如果仍然过长，递归压缩）
  const merged = summaries.join("\n\n")
  if (estimateTokens(merged) > targetTokens) {
    return compactSession(
      [{ role: "system", content: merged }],
      targetTokens,
      ext
    )
  }
  
  return {
    compacted: true,
    messages: [{ role: "system", content: merged }],
    originalCount: messages.length,
    compactedCount: 1,
  }
}
```

**关键参数**：
- `BASE_CHUNK_RATIO = 0.4`：目标压缩率（压缩到 40% 的大小）
- `MIN_CHUNK_RATIO = 0.15`：最小压缩率（极限情况）
- `SAFETY_MARGIN = 1.2`：Token 估算误差缓冲（20%）

### 3.3 信息保留策略

**高优先级保留**（Prompt 指令）：
- ✅ 明确的决策和结论
- ✅ 待办事项（TODOs）
- ✅ 开放性问题
- ✅ 约束条件和限制

**可丢弃信息**：
- ❌ 中间探索过程
- ❌ 重复的澄清
- ❌ 临时性的状态

**Fallback 机制**：
如果摘要生成失败，系统尝试：
1. 只压缩"小消息"（低于阈值的消息）
2. 对超大消息添加 `[omitted due to size]` 标记
3. 最终兜底：强制截断到最近 N 条消息

---

## 4. Skills Platform — 动态能力注入系统

### 4.1 Skill 发现与加载

**实现位置**：`src/agents/skills/workspace.ts`

```typescript
export async function loadWorkspaceSkillEntries(
  workspaceDir: string,
  preferences: SkillsInstallPreferences,
): Promise<SkillEntry[]> {
  const skillsDir = path.join(workspaceDir, ".openclaw/skills")
  
  // Step 1: 扫描 skills 目录
  const entries = await fs.readdir(skillsDir, { withFileTypes: true })
  
  // Step 2: 加载每个 Skill 的 metadata
  const skills: SkillEntry[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    
    const metadataPath = path.join(skillsDir, entry.name, "skill.json")
    const metadata: OpenClawSkillMetadata = JSON.parse(
      await fs.readFile(metadataPath, "utf-8")
    )
    
    // Step 3: 解析命令规范
    const commands = metadata.commands.map(cmd => ({
      name: cmd.name,
      description: cmd.description,
      executable: path.join(skillsDir, entry.name, cmd.path),
      eligibility: cmd.when, // 条件表达式
    }))
    
    skills.push({ metadata, commands, installed: true })
  }
  
  return skills
}
```

### 4.2 Skill Snapshot — 会话启动时状态快照

```typescript
export function buildWorkspaceSkillSnapshot(
  skillEntries: SkillEntry[],
  context: SkillEligibilityContext,
): SkillSnapshot {
  // 过滤符合条件的 Skills
  const eligibleSkills = skillEntries.filter(skill => 
    evaluateEligibility(skill.commands, context)
  )
  
  // 构建 Prompt 片段
  const prompt = buildWorkspaceSkillsPrompt(eligibleSkills)
  
  // 构建 Tool Specs（LLM 调用时的工具定义）
  const tools = buildWorkspaceSkillCommandSpecs(eligibleSkills)
  
  return {
    prompt,        // 注入到 System Prompt 的 Skill 描述
    tools,         // LLM 可用的 Tool 列表
    skillIds: eligibleSkills.map(s => s.metadata.id),
    timestamp: Date.now(),
  }
}
```

**Eligibility 条件表达式示例**：
```json
{
  "name": "git-commit",
  "when": "git.installed && !workspace.readonly"
}
```

**Skill Snapshot 的作用**：
- **一致性保证**：会话期间 Skill 列表不会因文件系统变化而改变
- **性能优化**：避免每次 LLM 调用时重新扫描文件系统
- **审计追踪**：记录每次 Agent Run 可用的能力清单

---

## 5. Channel Manager — 消息平台适配层

### 5.1 Channel 生命周期

**实现位置**：`src/gateway/server-channels.ts`

```typescript
export function createChannelManager(state: GatewayRuntimeState): ChannelManager {
  const channels = new Map<ChannelId, ChannelInstance>()
  
  return {
    start: async () => {
      const plugins = listChannelPlugins()
      
      for (const plugin of plugins) {
        if (!isChannelEnabled(plugin.id, state.config)) {
          continue
        }
        
        const instance = await plugin.create({
          config: state.config,
          onMessage: (event) => handleInboundMessage(event, state),
          onEvent: (event) => handleChannelEvent(event, state),
        })
        
        await instance.start()
        channels.set(plugin.id, instance)
      }
    },
    
    stop: async () => {
      for (const instance of channels.values()) {
        await instance.stop()
      }
      channels.clear()
    },
    
    send: async (channelId, message) => {
      const channel = channels.get(channelId)
      if (!channel) {
        throw new Error(`Channel ${channelId} not found`)
      }
      return await channel.send(message)
    },
  }
}
```

### 5.2 Channel Plugin 接口

每个 Channel 必须实现以下接口：

```typescript
interface ChannelPlugin {
  id: ChannelId,           // e.g., "whatsapp", "telegram"
  displayName: string,
  
  create(opts: {
    config: OpenClawConfig,
    onMessage: (event: ChatEvent) => Promise<void>,
    onEvent: (event: ChannelEvent) => void,
  }): Promise<ChannelInstance>
}

interface ChannelInstance {
  start(): Promise<void>,
  stop(): Promise<void>,
  send(message: OutboundMessage): Promise<SendResult>,
}
```

**规范化流程**（Channel → Gateway）：
1. **Webhook 接收**：Channel 收到 Provider 推送的事件
2. **消息规范化**：转换为标准 `ChatEvent` 格式
3. **路由决策**：`onMessage` 回调通知 Gateway
4. **Auto-Reply 判断**：检查是否需要触发 Agent（mentions、DM 等）

### 5.3 Extension 目录结构

```
extensions/
├── whatsapp/
│   ├── package.json
│   ├── openclaw.plugin.json     # 插件清单
│   ├── src/
│   │   ├── index.ts             # 入口点，导出 Plugin 对象
│   │   ├── webhook.ts           # Twilio Webhook 处理
│   │   └── send.ts              # 发送消息到 WhatsApp
│   └── tsconfig.json
├── telegram/
│   ├── ...
└── slack/
    ├── ...
```

**插件清单示例**（`openclaw.plugin.json`）：
```json
{
  "id": "whatsapp",
  "channels": ["whatsapp"],
  "requiredConfig": ["twilio.accountSid", "twilio.authToken"]
}
```

---

## 6. Tool Invocation — 安全工具执行框架

### 6.1 工具分类与隔离

OpenClaw 的工具按安全级别分为三层：

| 层级 | 工具类型 | 沙箱策略 | 示例 |
|:---|:---|:---|:---|
| **L1: Read-only** | 文件读取、代码搜索 | 无需沙箱 | `read`, `glob`, `grep` |
| **L2: Workspace-scoped** | 文件写入、Git 操作 | 限制在 `workspaceDir` | `write`, `edit`, `bash` |
| **L3: System-level** | 命令执行、网络请求 | Docker 沙箱 | `bash --unsafe`, `web_browser` |

### 6.2 Bash Tool 执行流程

**实现位置**：`src/agents/bash-tools.exec.ts` (~52K lines, 核心工具)

```typescript
export async function executeBashCommand(
  command: string,
  opts: {
    workspaceDir: string,
    timeout?: number,
    approval?: ApprovalConfig,
    sandbox?: SandboxConfig,
  }
): Promise<ExecResult> {
  // Phase 1: 命令审批
  if (opts.approval?.required) {
    const approved = await requestApproval({
      command,
      workspaceDir: opts.workspaceDir,
      risk: assessCommandRisk(command),
    })
    if (!approved) {
      throw new Error("Command execution denied by user")
    }
  }
  
  // Phase 2: 沙箱决策
  const shouldSandbox = opts.sandbox?.force || isUnsafeCommand(command)
  
  if (shouldSandbox) {
    // Docker 沙箱执行
    return await executeInDockerSandbox(command, opts)
  } else {
    // 直接执行（限制在 workspace）
    return await executeInWorkspace(command, opts)
  }
}
```

**风险评估规则**：
```typescript
function assessCommandRisk(command: string): Risk {
  if (/rm -rf|dd|mkfs|shutdown|reboot/.test(command)) {
    return "critical"
  }
  if (/curl|wget|git push|npm publish/.test(command)) {
    return "high"
  }
  if (/npm install|pip install/.test(command)) {
    return "medium"
  }
  return "low"
}
```

### 6.3 Docker 沙箱配置

**实现位置**：`src/agents/sandbox/docker.ts`

```typescript
export function buildDockerSandboxConfig(opts: {
  workspaceDir: string,
  sessionId: string,
}): DockerRunConfig {
  return {
    image: "openclaw/sandbox:latest",
    readOnlyRoot: true,           // 根文件系统只读
    capDrop: ["ALL"],              // 移除所有 Linux Capabilities
    securityOpt: [                // 安全配置
      "no-new-privileges",
      "seccomp=default",
    ],
    memory: "512m",                // 内存限制
    cpus: "0.5",                   // CPU 限制
    pidsLimit: 100,                // 进程数限制
    networkMode: "none",           // 无网络访问（可选放开）
    volumeMounts: [
      {
        source: opts.workspaceDir,
        target: "/workspace",
        readOnly: false,           // Workspace 可写
      },
    ],
  }
}
```

---

## 7. Node Registry — 移动端/桌面端设备管理

### 7.1 配对流程（Pairing Flow）

```typescript
// Phase 1: Node 连接并发送身份信息
node → gateway: {
  type: "device.pair.request",
  deviceId: "iPhone-12345",
  publicKey: "ed25519:abcd1234...",
  capabilities: ["camera.snap", "location.get"],
  platform: "iOS",
}

// Phase 2: Gateway 生成配对令牌并广播
gateway → all_clients: {
  type: "device.pair.requested",
  deviceId: "iPhone-12345",
  displayName: "Nick's iPhone",
  platform: "iOS",
}

// Phase 3: 用户通过 CLI/UI 批准
cli → gateway: {
  type: "device.pair.approve",
  deviceId: "iPhone-12345",
}

// Phase 4: Gateway 颁发 pairingToken
gateway → node: {
  type: "device.pair.approved",
  pairingToken: "pt_secure_random_token_xyz",
  validUntil: 1704067200000, // Unix timestamp
}

// Phase 5: Node 使用 token 进行后续认证
node → gateway: {
  type: "device.handshake",
  pairingToken: "pt_secure_random_token_xyz",
  signature: "ed25519_signature_of_challenge",
}
```

### 7.2 Node Command Policy

**实现位置**：`src/gateway/node-command-policy.ts`

```typescript
const PLATFORM_ALLOWLIST: Record<Platform, string[]> = {
  macOS: [
    "system.run",
    "system.which",
    "browser.proxy",
    "location.get",
    "camera.snap",
  ],
  iOS: [
    "canvas.draw",
    "canvas.clear",
    "camera.snap",
    "camera.record",
    "screen.record",
    "location.get",
  ],
  Android: [
    "canvas.draw",
    "camera.snap",
    "location.get",
    "sms.send",        // Android 独有
  ],
}

export function isCommandAllowed(
  platform: Platform,
  command: string,
  nodeCapabilities: string[],
): boolean {
  // Step 1: 平台白名单检查
  if (!PLATFORM_ALLOWLIST[platform]?.includes(command)) {
    return false
  }
  
  // Step 2: Node 声明能力检查
  if (!nodeCapabilities.includes(command)) {
    return false
  }
  
  return true
}
```

---

## 8. 扩展性设计模式

### 8.1 Plugin System

OpenClaw 使用动态插件系统，支持：

- **Channel Plugins**：新增消息平台（如 WeChat、Discord）
- **Tool Plugins**：新增 LLM 可用工具
- **Skill Plugins**：新增工作区能力包

### 8.2 Configuration Schema

所有配置遵循 JSON Schema 验证：

```typescript
// config/zod-schema.ts
export const OpenClawConfigSchema = z.object({
  agents: z.object({
    defaults: z.object({
      model: z.object({
        provider: z.string().default("anthropic"),
        id: z.string().default("claude-sonnet-3-5"),
        fallbacks: z.array(z.string()).optional(),
      }),
      maxConcurrent: z.number().min(1).default(4),
      subagent: z.object({
        maxConcurrent: z.number().min(1).default(8),
      }),
    }),
  }),
  gateway: z.object({
    bind: z.enum(["loopback", "lan", "tailnet", "auto"]).default("loopback"),
    port: z.number().min(1024).default(18789),
  }),
  // ...
})
```

### 8.3 Event-Driven Architecture

系统通过事件总线实现解耦：

```typescript
// 注册事件监听器
onAgentEvent("run.started", (event) => {
  log.info(`Agent run started: ${event.sessionId}`)
})

onAgentEvent("run.completed", (event) => {
  updateMetrics(event.usage)
})

// 触发事件
emitAgentEvent({
  type: "run.completed",
  sessionId: "...",
  usage: { tokens: 1500, cost: 0.02 },
})
```

---

## 9. 工程实践建议

### 9.1 代码组织原则

- **模块化**：每个子系统（gateway、agents、channels）独立目录
- **类型优先**：所有公共接口使用 TypeScript 严格类型
- **测试覆盖**：核心逻辑（compaction、auth-profiles、lane-queue）有对应 `.test.ts`

### 9.2 日志与诊断

```typescript
// 结构化日志
log.info("agent run completed", {
  sessionId: "abc123",
  model: "claude-sonnet-3-5",
  tokens: 1500,
  duration: 3.2,
})

// 诊断模式（production 默认关闭）
if (isDiagnosticsEnabled()) {
  logLaneEnqueue(lane, queueDepth)
  logLaneDequeue(lane, waitedMs, queueAhead)
}
```

### 9.3 性能优化策略

- **并发控制**：Lane 系统防止资源竞争
- **缓存机制**：Embedding Cache 减少 90%+ API 调用
- **连接池**：WebSocket 连接复用
- **渐进式加载**：Skill 按需加载，避免启动阻塞

---

## 10. 关键文件索引

| 功能模块 | 核心文件 | 代码量 | 关键职责 |
|:---|:---|:---|:---|
| **Gateway** | `src/gateway/server.impl.ts` | 590 行 | WebSocket 服务器、生命周期管理 |
| **Agent Runtime** | `src/agents/pi-embedded-runner/run.ts` | 693 行 | ReAct 循环、Failover 逻辑 |
| **Compaction** | `src/agents/compaction.ts` | 357 行 | 上下文压缩算法 |
| **Lane Scheduler** | `src/process/command-queue.ts` | 161 行 | FIFO 队列、并发限制 |
| **Bash Tool** | `src/agents/bash-tools.exec.ts` | 52K 行 | 命令执行、沙箱隔离 |
| **Skills** | `src/agents/skills/workspace.ts` | - | Skill 发现、Snapshot 生成 |
| **Channels** | `src/gateway/server-channels.ts` | - | Channel 生命周期管理 |
| **Node Registry** | `src/gateway/node-registry.ts` | - | 设备配对、命令转发 |

---

**文档版本**：基于 OpenClaw commit `75093ebe1` (2026-01-30)  
**适用场景**：PonyBunny 项目的工程参考指南
