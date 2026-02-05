# OpenClaw 更新记录 (2026-02)

本文档记录 OpenClaw 项目的最新更新，以及对 PonyBunny 项目的参考价值。

**基准版本**: `392bbddf2` (2026-02-05)
**上一版本**: `75093ebe1` (2026-01-30)

---

## 重要更新摘要

### 1. 安全增强

#### 1.1 Owner-Only Tools + Command Auth Hardening (#9202)

**变更**: 引入 Owner-Only 工具策略，敏感工具仅限 owner 用户调用。

**实现** (`src/agents/tool-policy.ts`):

```typescript
const OWNER_ONLY_TOOL_NAMES = new Set<string>(["whatsapp_login"]);

export function isOwnerOnlyToolName(name: string) {
  return OWNER_ONLY_TOOL_NAMES.has(normalizeToolName(name));
}

export function applyOwnerOnlyToolPolicy(tools: AnyAgentTool[], senderIsOwner: boolean) {
  // 非 owner 用户：过滤掉 owner-only 工具
  // owner 用户：保留所有工具
  if (senderIsOwner) {
    return tools;
  }
  return tools.filter((tool) => !isOwnerOnlyToolName(tool.name));
}
```

**Command Auth 增强** (`src/auto-reply/command-auth.ts`):

- 新增 `CommandAuthorization` 类型，包含 `senderIsOwner` 和 `isAuthorizedSender` 字段
- 支持 `commands.ownerAllowFrom` 配置，显式指定 owner 用户列表
- 支持 channel-specific owner 配置 (如 `whatsapp:+15551234567`)

**PonyBunny 参考价值**:
- **Responsibility Layer 实现**: 可参考此模式实现 "approval-required" 和 "forbidden" 层级的工具访问控制
- **Escalation 权限**: 敏感操作（如 OS 级别访问）可采用类似的 owner-only 策略

#### 1.2 Gateway Credential Exfiltration Prevention (#9179)

**变更**: 防止通过 URL override 泄露 Gateway 凭证。

**关键规则**:
- 当使用 `--url` 参数时，CLI 不再自动继承配置或环境变量中的凭证
- 必须显式提供 `--token` 或 `--password`
- 缺少显式凭证时直接报错

**文档更新** (`docs/gateway/remote.md`):
```
Note: when you pass `--url`, the CLI does not fall back to config or environment credentials.
Include `--token` or `--password` explicitly. Missing explicit credentials is an error.
```

**PonyBunny 参考价值**:
- **Gateway 安全设计**: 避免凭证在 URL override 场景下被意外传递到非预期目标
- **CLI 设计原则**: 显式优于隐式，安全敏感参数不应自动继承

#### 1.3 Sandboxed Media Handling Hardening (#9182)

**变更**: 加强沙箱环境中的媒体文件处理安全。

**实现** (`src/agents/sandbox-paths.ts`):

```typescript
// 禁止 data: URL（防止内存注入）
export function assertMediaNotDataUrl(media: string): void {
  if (DATA_URL_RE.test(raw)) {
    throw new Error("data: URLs are not supported for media. Use buffer instead.");
  }
}

// 沙箱路径解析 + symlink 检查
export async function resolveSandboxedMediaSource(params: {
  media: string;
  sandboxRoot: string;
}): Promise<string> {
  // 1. HTTP URL 直接放行
  // 2. file:// URL 转换为本地路径
  // 3. 本地路径必须在 sandbox root 内
  // 4. 检查路径中是否存在 symlink（防止逃逸）
}

async function assertNoSymlink(relative: string, root: string) {
  // 遍历路径每一级，检查是否为 symlink
  // symlink 可能指向 sandbox 外部，必须拒绝
}
```

**PonyBunny 参考价值**:
- **Tool 执行安全**: 文件路径参数必须验证是否在允许范围内
- **Symlink 攻击防护**: 任何涉及文件系统的工具都应检查 symlink

---

### 2. Tool Policy 系统

#### 2.1 Tool Profiles (Base Allowlist)

**新增配置**: `tools.profile` 设置基础工具白名单。

**预定义 Profiles**:

| Profile | 允许的工具 |
|:--------|:----------|
| `minimal` | `session_status` only |
| `coding` | `group:fs`, `group:runtime`, `group:sessions`, `group:memory`, `image` |
| `messaging` | `group:messaging`, `sessions_list`, `sessions_history`, `sessions_send`, `session_status` |
| `full` | 无限制 |

**Tool Groups**:

```typescript
export const TOOL_GROUPS: Record<string, string[]> = {
  "group:memory": ["memory_search", "memory_get"],
  "group:web": ["web_search", "web_fetch"],
  "group:fs": ["read", "write", "edit", "apply_patch"],
  "group:runtime": ["exec", "process"],
  "group:sessions": ["sessions_list", "sessions_history", "sessions_send", "sessions_spawn", "session_status"],
  "group:ui": ["browser", "canvas"],
  "group:automation": ["cron", "gateway"],
  "group:messaging": ["message"],
  "group:nodes": ["nodes"],
};
```

**配置示例**:

```json5
{
  tools: {
    profile: "coding",
    deny: ["group:runtime"],  // 禁用 exec/process
  },
  agents: {
    list: [
      {
        id: "support",
        tools: { profile: "messaging", allow: ["slack"] },
      },
    ],
  },
}
```

**PonyBunny 参考价值**:
- **Skill 权限模型**: 可参考 Tool Profile 设计 Skill 的权限分级
- **Work Item 工具限制**: 不同类型的 Work Item 可配置不同的 Tool Profile

#### 2.2 Provider-Specific Tool Policy

**新增配置**: `tools.byProvider` 按 LLM Provider 限制工具。

```json5
{
  tools: {
    profile: "coding",
    byProvider: {
      "google-antigravity": { profile: "minimal" },
      "openai/gpt-5.2": { allow: ["group:fs", "sessions_list"] },
    },
  },
}
```

**应用顺序**: Base Profile → byProvider → allow/deny

**PonyBunny 参考价值**:
- **Model-Aware Tool Selection**: 弱模型可限制复杂工具，避免错误调用

---

### 3. Heartbeat 增强

#### 3.1 Multi-Agent Routing via accountId (#8702)

**变更**: Heartbeat 支持 `accountId` 配置，用于多账户 channel 路由。

**配置示例**:

```json5
{
  agents: {
    list: [
      {
        id: "ops",
        heartbeat: {
          every: "1h",
          target: "telegram",
          to: "12345678",
          accountId: "ops-bot",  // 新增：指定账户
        },
      },
    ],
  },
  channels: {
    telegram: {
      accounts: {
        "ops-bot": { botToken: "YOUR_TELEGRAM_BOT_TOKEN" },
      },
    },
  },
}
```

**PonyBunny 参考价值**:
- **Daemon Heartbeat**: 可参考此模式实现 Scheduler 的定期检查机制
- **Multi-Channel Escalation**: 不同 Agent 可配置不同的 escalation channel

#### 3.2 Per-Channel Response Prefix Override (#9001)

**变更**: 支持按 channel 配置不同的 `responsePrefix`。

**配置示例**:

```json5
{
  channels: {
    telegram: {
      responsePrefix: "[Bot] ",
    },
    whatsapp: {
      responsePrefix: "",  // 无前缀
    },
  },
}
```

---

### 4. TUI/Gateway 修复 (#8432)

**修复内容**:
- Pi streaming 修复
- Tool routing 修复
- Model display 修复
- Message updating 修复

**关键变更** (`src/gateway/server-broadcast.ts`):
- 改进 agent event 广播逻辑
- 修复 session 状态同步问题

**PonyBunny 参考价值**:
- **Gateway 事件广播**: 参考 `broadcastToSession` 实现 Work Item 状态变更通知

---

### 5. Telegram 代码质量改进

#### 5.1 移除 @ts-nocheck (#9180, #9077)

**变更**: `bot-message.ts` 和 `bot.ts` 移除 `@ts-nocheck`，完成类型安全重构。

**修复内容**:
- 修复重复 error handler
- 加强 sticker caching

---

## 架构参考更新

### Tool Policy 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                     Tool Policy Pipeline                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Base Profile (tools.profile)                            │
│     ↓                                                        │
│  2. Provider Override (tools.byProvider)                    │
│     ↓                                                        │
│  3. Allow List (tools.allow)                                │
│     ↓                                                        │
│  4. Deny List (tools.deny)                                  │
│     ↓                                                        │
│  5. Owner-Only Filter (applyOwnerOnlyToolPolicy)            │
│     ↓                                                        │
│  Final Tool Set → Agent                                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Command Authorization Flow

```
┌─────────────────────────────────────────────────────────────┐
│                 Command Authorization Flow                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Inbound Message                                            │
│     ↓                                                        │
│  resolveProviderFromContext()                               │
│     ↓                                                        │
│  resolveOwnerAllowFromList()                                │
│     ↓                                                        │
│  resolveSenderCandidates()                                  │
│     ↓                                                        │
│  ┌─────────────────────────────────────┐                    │
│  │ CommandAuthorization {              │                    │
│  │   providerId: "whatsapp",           │                    │
│  │   ownerList: ["+15551234567"],      │                    │
│  │   senderId: "+15559876543",         │                    │
│  │   senderIsOwner: false,             │                    │
│  │   isAuthorizedSender: true,         │                    │
│  │ }                                   │                    │
│  └─────────────────────────────────────┘                    │
│     ↓                                                        │
│  applyOwnerOnlyToolPolicy(tools, senderIsOwner)             │
│     ↓                                                        │
│  Filtered Tools → Agent                                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## PonyBunny 实施建议

### 1. Tool Registry 增强

参考 OpenClaw 的 Tool Policy 系统，为 PonyBunny 的 Tool Registry 添加：

```typescript
// src/infra/tools/tool-policy.ts

export type ToolProfile = 'minimal' | 'standard' | 'full';

export const TOOL_PROFILES: Record<ToolProfile, string[]> = {
  minimal: ['read', 'write'],
  standard: ['read', 'write', 'exec', 'web_search'],
  full: ['*'],
};

export function filterToolsByProfile(
  tools: Tool[],
  profile: ToolProfile,
  workItem: WorkItem
): Tool[] {
  const allowed = TOOL_PROFILES[profile];
  if (allowed.includes('*')) return tools;

  return tools.filter(t => allowed.includes(t.name));
}
```

### 2. Escalation 权限控制

参考 Owner-Only 模式，实现 Escalation 权限：

```typescript
// src/scheduler/escalation-handler.ts

const ESCALATION_REQUIRED_TOOLS = new Set([
  'os_access',
  'external_api',
  'payment',
]);

export function requiresEscalation(toolName: string): boolean {
  return ESCALATION_REQUIRED_TOOLS.has(toolName);
}
```

### 3. Sandbox Path Validation

参考 OpenClaw 的 sandbox-paths.ts，为 PonyBunny 添加路径验证：

```typescript
// src/infra/tools/sandbox-paths.ts

export function validateWorkspacePath(
  filePath: string,
  workspaceRoot: string
): { valid: boolean; resolved: string; error?: string } {
  const resolved = path.resolve(workspaceRoot, filePath);
  const relative = path.relative(workspaceRoot, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return {
      valid: false,
      resolved,
      error: `Path escapes workspace: ${filePath}`,
    };
  }

  return { valid: true, resolved };
}
```

---

## 文档更新清单

以下现有文档需要更新以反映 OpenClaw 的变化：

| 文档 | 更新内容 |
|:-----|:--------|
| `architecture.md` | 更新版本号至 `392bbddf2`，添加 Tool Policy 架构图 |
| `protocol.md` | 添加 credential exfiltration prevention 说明 |
| `components.md` | 添加 Owner-Only Tools 组件说明 |

---

**文档版本**: 2026-02-05
**OpenClaw 版本**: `392bbddf2`
