# 模型能力与性能权衡 (Model Capability & Performance Trade-offs)

## 概述

OpenClaw支持多种LLM模型，从顶级的推理模型（GPT-4o, Claude Opus）到经济型模型（GPT-3.5, Haiku, Flash）。本文档分析不同模型能力对系统整体性能的影响，以及使用弱模型时的补偿策略。

**核心架构组件**:
- **Model Catalog** (`model-catalog.ts`, 144 行) - 模型元数据注册表
- **Model Selection** (`model-selection.ts`, 200+ 行) - 模型解析与别名系统
- **Model Fallback** (`model-fallback.ts`, 400+ 行) - 多级降级链
- **Auth Profile Rotation** (`auth-profiles/`, 10+ 文件) - 认证配置文件轮换
- **Embedded Runner** (`pi-embedded-runner/run.ts`, 693 行) - 统一的执行与自适应层

**版本**: 基于 OpenClaw commit `75093ebe1` (2026-01-30)

## 1. 模型能力矩阵

**实现位置**: `src/agents/model-catalog.ts`

### 关键能力维度

| 能力维度 | 强模型示例 | 弱模型示例 | 系统影响 |
| :--- | :--- | :--- | :--- |
| **推理 (Reasoning)** | GPT-4o, Claude Opus 4.5 | GPT-3.5, Flash | 高级推理功能（`thinkingLevel: high/xhigh`）是否可用 |
| **上下文窗口** | 128K - 200K tokens | 8K - 32K tokens | Compaction触发频率、长文档分析能力 |
| **工具调用** | 高成功率，支持并行调用 | 低成功率，易出现参数错误 | 复杂任务的自动化能力 |
| **多模态 (Vision)** | 原生支持 | 部分支持或不支持 | 截图分析、UI理解能力 |

### 模型分类

**XHigh 级别**（最高智商）:
- GPT-5.2 系列
- Claude Opus 4.5
- Gemini Pro 2.0

**High 级别**（高性能）:
- GPT-4o
- Claude Sonnet 3.5
- Gemini Flash 2.0

**Medium/Low 级别**（经济型）:
- GPT-3.5-turbo
- Claude Haiku
- Qwen 7B-8B 系列

## 2. 功能-模型依赖分析

### 核心功能（所有模型）

- ✅ **文件操作** (`read`, `write`, `edit`)
- ✅ **命令执行** (`exec`)
- ✅ **基础对话**

**弱模型风险**:
- ❌ 路径理解偏差（相对路径 vs 绝对路径混淆）
- ❌ 多步骤任务中途丢失目标
- ❌ JSON Schema理解不精确

### 高级推理（仅强模型）

- **Thinking Mode** (`thinkingLevel: high/xhigh`):
  ```
  启用条件: model.reasoning === true
  Prompt注入: <think>...</think> 标签
  ```
- **任务自动拆解**: 强模型能自主识别何时需要创建 `subagent`
- **上下文长期规划**: 跨多轮对话维护一致的目标

### 工具调用稳定性

**强模型**:
- 并行工具调用成功率: ~95%
- 多层嵌套工具调用: 支持
- Schema复杂度容忍: 高

**弱模型**:
- 并行工具调用成功率: ~60%
- 常见错误类型:
  - 参数缺失
  - 类型不匹配
  - JSON格式错误

## 3. 模型发现与注册 (Model Discovery)

**实现位置**: `src/agents/model-catalog.ts` (144 行)

### 3.1 Model Registry 架构

OpenClaw 使用动态模型发现机制，从 `models.json` 加载可用模型列表。

**核心数据结构**:
```typescript
type ModelCatalogEntry = {
  id: string;              // 模型ID (e.g., "claude-opus-4-5")
  name: string;            // 显示名称
  provider: string;        // 提供商 (anthropic, openai, google, etc.)
  contextWindow?: number;  // 上下文窗口大小 (tokens)
  reasoning?: boolean;     // 是否支持推理模式
  input?: Array<"text" | "image">;  // 支持的输入类型
};
```

### 3.2 Model Catalog 加载流程

**实现**: `loadModelCatalog()` (51 行)

```typescript
// 伪代码
async function loadModelCatalog() {
  // 1. 从 Pi AI SDK 导入 ModelRegistry
  const piSdk = await import("./pi-model-discovery.js");
  
  // 2. 加载认证存储和模型注册表
  const agentDir = resolveOpenClawAgentDir();
  const authStorage = new piSdk.AuthStorage(join(agentDir, "auth.json"));
  const registry = new piSdk.ModelRegistry(authStorage, join(agentDir, "models.json"));
  
  // 3. 获取所有模型并规范化
  const entries = registry.getAll();
  for (const entry of entries) {
    models.push({
      id: entry.id.trim(),
      name: entry.name || entry.id,
      provider: entry.provider.trim(),
      contextWindow: entry.contextWindow > 0 ? entry.contextWindow : undefined,
      reasoning: entry.reasoning === true ? true : undefined,
      input: Array.isArray(entry.input) ? entry.input : undefined,
    });
  }
  
  // 4. 按 provider + name 排序
  return models.sort((a, b) => 
    a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name)
  );
}
```

**缓存策略**:
- 首次加载后缓存在 `modelCatalogPromise`
- 动态导入失败时不污染缓存（`modelCatalogPromise = null`）
- 支持 `useCache: false` 强制刷新

### 3.3 Vision 能力检测

**实现**: `modelSupportsVision()` (3 行)

```typescript
function modelSupportsVision(entry: ModelCatalogEntry | undefined): boolean {
  return entry?.input?.includes("image") ?? false;
}
```

**用途**: 在构建请求前验证模型是否支持图像输入，避免无效 API 调用。

### 3.4 内联模型支持 (Inline Models)

**实现**: `buildInlineProviderModels()` (`pi-embedded-runner/model.ts`, 38 行)

对于 `models.json` 中没有的模型，支持通过配置文件直接定义：

```json
{
  "models": {
    "providers": {
      "my-custom-provider": {
        "baseUrl": "https://api.example.com/v1",
        "api": "openai-responses",
        "models": [
          {
            "id": "my-custom-model",
            "contextWindow": 32000,
            "reasoning": false,
            "input": ["text"]
          }
        ]
      }
    }
  }
}
```

**处理逻辑** (`resolveModel()`, 113 行):
```typescript
// 1. 先从 ModelRegistry 查找
const model = modelRegistry.find(provider, modelId);

// 2. 未找到 → 查找内联配置
if (!model) {
  const inlineModels = buildInlineProviderModels(cfg.models.providers);
  const match = inlineModels.find(m => 
    m.provider === normalizeProviderId(provider) && m.id === modelId
  );
  if (match) {
    return { model: normalizeModelCompat(match), ... };
  }
}

// 3. 仍未找到 → 构造 fallback 模型对象（用于 mock-* 测试）
if (providerCfg || modelId.startsWith("mock-")) {
  return {
    model: {
      id: modelId,
      name: modelId,
      api: providerCfg?.api ?? "openai-responses",
      provider,
      baseUrl: providerCfg?.baseUrl,
      reasoning: false,
      input: ["text"],
      contextWindow: providerCfg?.models[0]?.contextWindow ?? 128000,
    },
    ...
  };
}
```

## 4. 模型选择与别名系统 (Model Selection)

**实现位置**: `src/agents/model-selection.ts` (200+ 行)

### 4.1 Provider Normalization

**实现**: `normalizeProviderId()` (42 行)

OpenClaw 统一不同的 provider 名称变体：

```typescript
function normalizeProviderId(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  
  // 标准化别名映射
  switch (normalized) {
    case "z.ai":
    case "z-ai":
      return "zai";
    case "opencode-zen":
      return "opencode";
    case "qwen":
      return "qwen-portal";
    case "kimi-code":
      return "kimi-coding";
    default:
      return normalized;
  }
}
```

### 4.2 Model Reference Parsing

**实现**: `parseModelRef()` (100 行)

支持三种格式：

| 输入格式 | 解析结果 |
|:---|:---|
| `"claude-opus-4-5"` | `{ provider: "anthropic", model: "claude-opus-4-5" }` (使用 defaultProvider) |
| `"anthropic/claude-opus-4-5"` | `{ provider: "anthropic", model: "claude-opus-4-5" }` |
| `"google/gemini-2.0-flash-exp"` | `{ provider: "google", model: "gemini-2.0-flash-exp"` |

**Provider-specific Normalization**:
```typescript
function normalizeProviderModelId(provider: string, model: string): string {
  if (provider === "anthropic") {
    // "opus-4.5" → "claude-opus-4-5"
    if (model.toLowerCase() === "opus-4.5") return "claude-opus-4-5";
    if (model.toLowerCase() === "sonnet-4.5") return "claude-sonnet-4-5";
  }
  if (provider === "google") {
    return normalizeGoogleModelId(model);  // 见 models-config.providers.ts
  }
  return model;
}
```

### 4.3 Model Alias Index

**实现**: `buildModelAliasIndex()` (128 行)

支持在配置文件中为模型定义别名：

```json
{
  "agents": {
    "defaults": {
      "models": {
        "anthropic/claude-opus-4-5": {
          "alias": "opus"
        },
        "anthropic/claude-sonnet-4-5": {
          "alias": "sonnet"
        },
        "google/gemini-2.0-flash-exp": {
          "alias": "flash"
        }
      }
    }
  }
}
```

**数据结构**:
```typescript
type ModelAliasIndex = {
  byAlias: Map<string, { alias: string; ref: ModelRef }>;  // "opus" → { provider: "anthropic", model: "claude-opus-4-5" }
  byKey: Map<string, string[]>;  // "anthropic/claude-opus-4-5" → ["opus", "best"]
};
```

**查找优先级** (`resolveModelRefFromString()`, 151 行):
```typescript
// 1. 如果不包含 '/'，先尝试别名匹配
if (!raw.includes("/")) {
  const aliasKey = raw.trim().toLowerCase();
  const match = aliasIndex.byAlias.get(aliasKey);
  if (match) return { ref: match.ref, alias: match.alias };
}

// 2. 否则解析为 provider/model 格式
return { ref: parseModelRef(raw, defaultProvider) };
```

### 4.4 Model Key Generation

**实现**: `modelKey()` (25 行)

```typescript
function modelKey(provider: string, model: string): string {
  return `${provider}/${model}`;
}
```

**用途**: 
- 去重 (fallback 链)
- 作为 Map 的键
- 日志标识

## 5. 模型特定的兼容性适配 (Model Compatibility)

**实现位置**: `src/agents/model-compat.ts` (25 行)

### 5.1 Z.AI Developer Role 禁用

**问题**: Z.AI 的 OpenAI Completions API 不支持 `developer` role

**解决方案**: `normalizeModelCompat()`

```typescript
function normalizeModelCompat(model: Model<Api>): Model<Api> {
  const baseUrl = model.baseUrl ?? "";
  const isZai = model.provider === "zai" || baseUrl.includes("api.z.ai");
  
  if (!isZai || model.api !== "openai-completions") {
    return model;  // 无需修改
  }
  
  // Z.AI + OpenAI Completions → 禁用 developer role
  const compat = model.compat ?? {};
  model.compat = {
    ...compat,
    supportsDeveloperRole: false,  // 强制禁用
  };
  
  return model;
}
```

**影响**: 后续构建 messages 数组时，会跳过 `developer` role 消息或将其转换为 `system`。

### 5.2 Gemini Turn Ordering

**实现位置**: `src/agents/pi-embedded-helpers/turns.ts`

**问题**: Gemini 严格要求 User → Model → User → Model 交替模式，Tool 消息必须紧跟 Assistant

**解决方案**: `validateGeminiTurns()`

```typescript
// 伪代码
function validateGeminiTurns(messages: Message[]): Message[] {
  const fixed: Message[] = [];
  
  for (let i = 0; i < messages.length; i++) {
    const curr = messages[i];
    const prev = messages[i - 1];
    
    // 规则1: 连续的 user 消息 → 合并
    if (curr.role === "user" && prev?.role === "user") {
      fixed[fixed.length - 1].content += "\n\n" + curr.content;
      continue;
    }
    
    // 规则2: tool 后必须是 assistant
    if (prev?.role === "tool" && curr.role !== "assistant") {
      fixed.push({ role: "assistant", content: "" });  // 插入空 assistant
    }
    
    // 规则3: assistant 后必须是 user
    if (prev?.role === "assistant" && curr.role === "assistant") {
      fixed.push({ role: "user", content: "Continue." });  // 插入虚拟 user
    }
    
    fixed.push(curr);
  }
  
  return fixed;
}
```

### 5.3 Claude Schema Patching

**实现位置**: `src/agents/pi-tools.ts` (未在此文档详述)

**问题**: Claude 不支持嵌套的 `anyOf` / `oneOf`

**解决方案**: `patchToolSchemaForClaudeCompatibility()`
- 扁平化 Union 类型
- 移除不支持的 `format` 字段（如 `format: "uri"`）

### 5.4 OpenAI Schema 限制

**问题**: OpenAI 不支持根级别的 Union 类型

**解决方案**: 将 Union 类型展开为多个独立工具定义（每个变体一个工具）

## 6. 模型降级链 (Model Fallback Chain)

**实现位置**: `src/agents/model-fallback.ts` (400+ 行)

### 6.1 Fallback 架构

OpenClaw 实现了三层降级机制：

1. **Auth Profile Rotation** - 同一模型的不同认证配置文件轮换
2. **Thinking Level Downgrade** - 推理级别降级 (`xhigh` → `high` → `medium` → `low` → `off`)
3. **Model Fallback** - 切换到备用模型

**执行顺序** (在 `runWithModelFallback()` 中):
```
尝试 Model A + Profile 1 + ThinkLevel=high
   ↓ 失败 (401 Auth)
尝试 Model A + Profile 2 + ThinkLevel=high
   ↓ 失败 (400 Unsupported thinking)
尝试 Model A + Profile 2 + ThinkLevel=medium
   ↓ 失败 (429 Rate Limit，所有 Profiles 耗尽)
尝试 Model B + Profile 1 + ThinkLevel=high
   ↓ 成功
```

### 6.2 Fallback Candidate 解析

**实现**: `resolveFallbackCandidates()` (221 行)

**输入配置**:
```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-opus-4-5",
        "fallbacks": [
          "anthropic/claude-sonnet-4-5",
          "google/gemini-2.0-flash-exp",
          "openai/gpt-4o"
        ]
      }
    }
  }
}
```

**解析逻辑**:
```typescript
function resolveFallbackCandidates(params: {
  cfg: OpenClawConfig | undefined;
  provider: string;
  model: string;
  fallbacksOverride?: string[];
}): ModelCandidate[] {
  const seen = new Set<string>();  // 去重
  const candidates: ModelCandidate[] = [];
  
  // 1. 添加当前请求的模型 (优先级最高)
  addCandidate({ provider, model }, enforceAllowlist: false);
  
  // 2. 添加配置的 fallbacks
  const fallbacks = params.fallbacksOverride ?? 
                    cfg?.agents?.defaults?.model?.fallbacks ?? [];
  for (const raw of fallbacks) {
    const resolved = resolveModelRefFromString({
      raw,
      defaultProvider: "anthropic",
      aliasIndex,
    });
    if (resolved) {
      addCandidate(resolved.ref, enforceAllowlist: true);
    }
  }
  
  // 3. 添加全局 primary 模型 (作为最后的 fallback)
  if (params.fallbacksOverride === undefined) {
    const primary = resolveConfiguredModelRef({ cfg, ... });
    addCandidate({ provider: primary.provider, model: primary.model }, false);
  }
  
  return candidates;
}
```

**Allowlist 机制**:
- `buildAllowedModelKeys()` 从 `cfg.agents.defaults.models` 提取白名单
- Fallback 模型必须在白名单中（除非是当前请求的主模型）
- 防止降级到未配置认证的模型

### 6.3 Fallback 执行循环

**实现**: `runWithModelFallback()` (223 行起)

```typescript
async function runWithModelFallback<T>(params: {
  cfg: OpenClawConfig | undefined;
  provider: string;
  model: string;
  fallbacksOverride?: string[];
  run: (provider: string, model: string) => Promise<T>;
  onError?: (attempt: {...}) => void;
}): Promise<{
  result: T;
  provider: string;
  model: string;
  attempts: FallbackAttempt[];
}> {
  const candidates = resolveFallbackCandidates({ ... });
  const authStore = ensureAuthProfileStore(params.agentDir);
  const attempts: FallbackAttempt[] = [];
  let lastError: unknown;
  
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    
    // 检查该 provider 是否所有 profiles 都在 cooldown
    const profileIds = resolveAuthProfileOrder({ cfg, store: authStore, provider: candidate.provider });
    const isAnyProfileAvailable = profileIds.some(id => !isProfileInCooldown(authStore, id));
    
    if (profileIds.length > 0 && !isAnyProfileAvailable) {
      // 跳过该候选模型（所有认证都不可用）
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        error: `Provider ${candidate.provider} is in cooldown (all profiles unavailable)`,
        reason: "rate_limit",
      });
      continue;
    }
    
    try {
      const result = await params.run(candidate.provider, candidate.model);
      return { result, provider: candidate.provider, model: candidate.model, attempts };
    } catch (err) {
      // 检查是否是 AbortError (用户取消)
      if (shouldRethrowAbort(err)) {
        throw err;  // 不继续 fallback
      }
      
      // 规范化为 FailoverError
      const normalized = coerceToFailoverError(err, { provider: candidate.provider, model: candidate.model });
      if (!isFailoverError(normalized)) {
        throw err;  // 非 failover 错误，直接抛出
      }
      
      lastError = normalized;
      const described = describeFailoverError(normalized);
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        error: described.message,
        reason: described.reason,
        status: described.status,
        code: described.code,
      });
      
      await params.onError?.({
        provider: candidate.provider,
        model: candidate.model,
        error: normalized,
        attempt: i + 1,
        total: candidates.length,
      });
    }
  }
  
  // 所有候选模型都失败
  if (attempts.length <= 1 && lastError) {
    throw lastError;  // 只有一个候选 → 直接抛出原始错误
  }
  
  const summary = attempts
    .map(a => `${a.provider}/${a.model}: ${a.error} (${a.reason || "unknown"})`)
    .join(" | ");
  throw new Error(`All models failed (${attempts.length}): ${summary}`, { cause: lastError });
}
```

### 6.4 Image Model Fallback

**实现**: `runWithImageModelFallback()` (337 行起)

专门用于图像分析任务的降级链：

**配置示例**:
```json
{
  "agents": {
    "defaults": {
      "imageModel": {
        "primary": "anthropic/claude-opus-4-5",
        "fallbacks": [
          "google/gemini-2.0-flash-exp",
          "openai/gpt-4o"
        ]
      }
    }
  }
}
```

**与普通 Fallback 的区别**:
- 仅在 vision 任务时触发
- 不进行 Auth Profile Rotation（简化逻辑）
- 不检查 allowlist（图像模型通常较少）

### 6.5 Error Classification

**实现**: `coerceToFailoverError()` + `describeFailoverError()` (`failover-error.ts`)

**FailoverReason 分类**:

| Reason | HTTP Status | 触发条件 | 是否轮换 Profile | 是否尝试下一个模型 |
|:---|:---|:---|:---|:---|
| `auth` | 401 | `"unauthorized"`, `"invalid_api_key"` | ✅ | ✅ |
| `billing` | 402/403 | `"insufficient_quota"`, `"payment_required"` | ✅ (长时间禁用) | ✅ |
| `rate_limit` | 429 | `"rate_limit_exceeded"`, `"quota_exceeded"` | ✅ | ✅ |
| `timeout` | 408/504 | `"timeout"`, `"timed_out"` | ✅ (可能是 rate limit) | ✅ |
| `context_overflow` | 400 | `"context_length_exceeded"` | ❌ | ❌ (触发 compaction) |
| `unsupported` | 400 | `"unsupported_parameter"` (thinking level) | ❌ | ❌ (降级 thinking) |
| `unknown` | * | 其他错误 | ❌ | ✅ (如果配置了 fallbacks) |

**实现逻辑** (`classifyFailoverReason()`, `pi-embedded-helpers/errors.ts`):
```typescript
function classifyFailoverReason(message: string): FailoverReason | null {
  const lower = message.toLowerCase();
  
  // 1. Auth 错误
  if (/unauthorized|invalid.*api.*key|authentication.*failed/i.test(lower)) {
    return "auth";
  }
  
  // 2. Billing 错误
  if (/insufficient.*quota|payment.*required|exceeded.*credit/i.test(lower)) {
    return "billing";
  }
  
  // 3. Rate Limit
  if (/rate.*limit|quota.*exceeded|too many requests/i.test(lower)) {
    return "rate_limit";
  }
  
  // 4. Timeout
  if (/timeout|timed.*out|deadline exceeded/i.test(lower)) {
    return "timeout";
  }
  
  // 5. Context Overflow
  if (/context.*length|prompt.*too.*large|maximum context/i.test(lower)) {
    return "context_overflow";
  }
  
  // 6. Unsupported (thinking level)
  if (/unsupported.*thinking|invalid.*thinking.*level/i.test(lower)) {
    return "unsupported";
  }
  
  return null;  // 未知错误
}
```

## 7. 认证配置文件轮换 (Auth Profile Rotation)

**实现位置**: `src/agents/auth-profiles/` (10+ 文件, 1000+ 行总计)

### 7.1 Auth Profile Store 架构

**数据结构** (`auth-profiles/types.ts`):
```typescript
type AuthProfileStore = {
  version: number;
  profiles: Record<string, AuthProfileCredential>;  // profileId → credential
  usageStats?: Record<string, ProfileUsageStats>;   // profileId → 使用统计
  order?: Record<string, string[]>;                 // provider → profileId[]
};

type AuthProfileCredential = {
  id: string;
  provider: string;
  type: "api-key" | "oauth" | "token";
  apiKey?: string;         // 仅 api-key 类型
  oauthProfileId?: string; // 仅 oauth 类型
  tokenCommand?: string;   // 仅 token 类型
};

type ProfileUsageStats = {
  lastUsed?: number;         // Unix timestamp (ms)
  lastFailureAt?: number;    // 上次失败时间
  errorCount?: number;       // 连续错误次数
  cooldownUntil?: number;    // Cooldown 结束时间 (ms)
  disabledUntil?: number;    // 禁用结束时间 (billing 错误专用)
  disabledReason?: "billing" | "auth";
  failureCounts?: Record<AuthProfileFailureReason, number>;  // 各类错误计数
};

type AuthProfileFailureReason = 
  | "auth" 
  | "billing" 
  | "rate_limit" 
  | "timeout" 
  | "unknown";
```

**存储位置**: `~/.openclaw/agent/auth-store.json` (JSON5 格式)

### 7.2 Profile Order Resolution

**实现**: `resolveAuthProfileOrder()` (`auth-profiles/order.ts`, 200+ 行)

**顺序规则** (按优先级):
1. **用户指定 Profile** (`preferredProfile` 参数) → 置顶
2. **上次成功 Profile** (`lastGoodProfile` 从配置读取) → 次优先
3. **Round-Robin** - 所有可用 profiles 按字母序排列
4. **Cooldown Filtering** - 移除 `cooldownUntil > Date.now()` 的 profiles

**伪代码**:
```typescript
function resolveAuthProfileOrder(params: {
  cfg: OpenClawConfig | undefined;
  store: AuthProfileStore;
  provider: string;
  preferredProfile?: string;
}): string[] {
  // 1. 找到该 provider 的所有 profiles
  const allProfiles = Object.values(store.profiles)
    .filter(p => normalizeProviderId(p.provider) === normalizeProviderId(params.provider))
    .map(p => p.id);
  
  if (allProfiles.length === 0) return [];
  
  // 2. 按优先级排序
  const priority: string[] = [];
  const seen = new Set<string>();
  
  // 优先级1: preferredProfile
  if (params.preferredProfile && allProfiles.includes(params.preferredProfile)) {
    priority.push(params.preferredProfile);
    seen.add(params.preferredProfile);
  }
  
  // 优先级2: lastGoodProfile (从配置读取)
  const lastGood = cfg?.agents?.defaults?.lastGoodProfile?.[params.provider];
  if (lastGood && allProfiles.includes(lastGood) && !seen.has(lastGood)) {
    priority.push(lastGood);
    seen.add(lastGood);
  }
  
  // 优先级3: 剩余 profiles (按字母序)
  const remaining = allProfiles
    .filter(id => !seen.has(id))
    .sort((a, b) => a.localeCompare(b));
  priority.push(...remaining);
  
  return priority;
}
```

### 7.3 Cooldown 机制

**实现**: `calculateAuthProfileCooldownMs()` (`auth-profiles/usage.ts`, 78 行)

**Cooldown 公式** (针对一般错误):
```typescript
function calculateAuthProfileCooldownMs(errorCount: number): number {
  const normalized = Math.max(1, errorCount);
  
  // 指数退避: 5^(n-1) 分钟，最大 1 小时
  return Math.min(
    60 * 60 * 1000,  // 1 hour max
    60 * 1000 * 5 ** Math.min(normalized - 1, 3)
  );
}
```

**Cooldown 时长表**:

| 连续错误次数 | Cooldown 时长 |
|:---|:---|
| 1 | 5^0 = 1 分钟 |
| 2 | 5^1 = 5 分钟 |
| 3 | 5^2 = 25 分钟 |
| 4+ | 1 小时 (max) |

**Billing Error 特殊处理** (`calculateAuthProfileBillingDisableMsWithConfig()`):
```typescript
function calculateBillingDisableMs(params: {
  errorCount: number;
  baseMs: number;  // 默认 5 小时
  maxMs: number;   // 默认 24 小时
}): number {
  const normalized = Math.max(1, params.errorCount);
  
  // 指数退避: base * 2^(n-1)
  const raw = params.baseMs * 2 ** Math.min(normalized - 1, 10);
  return Math.min(params.maxMs, raw);
}
```

**Billing Cooldown 时长表** (baseMs=5h, maxMs=24h):

| 连续 Billing 错误 | Disable 时长 |
|:---|:---|
| 1 | 5 * 2^0 = 5 小时 |
| 2 | 5 * 2^1 = 10 小时 |
| 3 | 5 * 2^2 = 20 小时 |
| 4+ | 24 小时 (max) |

### 7.4 Profile Failure Tracking

**实现**: `markAuthProfileFailure()` (`auth-profiles/usage.ts`, 200+ 行)

**触发条件** (在 `pi-embedded-runner/run.ts` 中):
```typescript
// 场景1: Prompt 提交失败
if (promptFailoverReason && promptFailoverReason !== "timeout" && lastProfileId) {
  await markAuthProfileFailure({
    store: authStore,
    profileId: lastProfileId,
    reason: promptFailoverReason,
    cfg: params.config,
    agentDir: params.agentDir,
  });
}

// 场景2: Assistant 响应失败
if (assistantFailoverReason && lastProfileId) {
  await markAuthProfileFailure({
    store: authStore,
    profileId: lastProfileId,
    reason: timedOut ? "timeout" : assistantFailoverReason,
    cfg: params.config,
    agentDir: params.agentDir,
  });
}
```

**处理逻辑**:
```typescript
async function markAuthProfileFailure(params: {
  store: AuthProfileStore;
  profileId: string;
  reason: AuthProfileFailureReason;
  cfg?: OpenClawConfig;
  agentDir?: string;
}): Promise<void> {
  const cfgResolved = resolveAuthCooldownConfig({ cfg, providerId: profile.provider });
  const now = Date.now();
  const existing = store.usageStats?.[profileId] ?? {};
  
  // 1. 检查 failure window (默认 24 小时)
  const windowExpired = 
    existing.lastFailureAt &&
    (now - existing.lastFailureAt) > cfgResolved.failureWindowMs;
  
  // 2. 计算新的 errorCount
  const baseCount = windowExpired ? 0 : (existing.errorCount ?? 0);
  const nextErrorCount = baseCount + 1;
  
  // 3. 更新 failureCounts
  const failureCounts = windowExpired ? {} : { ...existing.failureCounts };
  failureCounts[params.reason] = (failureCounts[params.reason] ?? 0) + 1;
  
  // 4. 计算 cooldown / disable
  let updatedStats: ProfileUsageStats = {
    ...existing,
    errorCount: nextErrorCount,
    failureCounts,
    lastFailureAt: now,
  };
  
  if (params.reason === "billing") {
    const billingCount = failureCounts.billing ?? 1;
    const backoffMs = calculateBillingDisableMs({
      errorCount: billingCount,
      baseMs: cfgResolved.billingBackoffMs,
      maxMs: cfgResolved.billingMaxMs,
    });
    updatedStats.disabledUntil = now + backoffMs;
    updatedStats.disabledReason = "billing";
  } else {
    const backoffMs = calculateAuthProfileCooldownMs(nextErrorCount);
    updatedStats.cooldownUntil = now + backoffMs;
  }
  
  // 5. 保存到磁盘
  store.usageStats = store.usageStats ?? {};
  store.usageStats[profileId] = updatedStats;
  await saveAuthProfileStore(store, agentDir);
}
```

### 7.5 Profile Success Tracking

**实现**: `markAuthProfileUsed()` (`auth-profiles/usage.ts`, 32 行)

**触发时机** (在 `pi-embedded-runner/run.ts` 中):
```typescript
// 成功获取 Assistant 响应后
if (lastProfileId) {
  await markAuthProfileUsed({
    store: authStore,
    profileId: lastProfileId,
    agentDir: params.agentDir,
  });
}
```

**效果**:
- 重置 `errorCount` 为 0
- 清除 `cooldownUntil` 和 `disabledUntil`
- 更新 `lastUsed` 时间戳

### 7.6 Profile Rotation in Embedded Runner

**实现**: `advanceAuthProfile()` (`pi-embedded-runner/run.ts`, 250 行)

```typescript
const advanceAuthProfile = async (): Promise<boolean> => {
  if (lockedProfileId) {
    return false;  // 用户锁定了特定 profile，禁止轮换
  }
  
  let nextIndex = profileIndex + 1;
  while (nextIndex < profileCandidates.length) {
    const candidate = profileCandidates[nextIndex];
    
    // 跳过 cooldown 中的 profile
    if (candidate && isProfileInCooldown(authStore, candidate)) {
      nextIndex += 1;
      continue;
    }
    
    try {
      // 尝试获取该 profile 的 API key
      await applyApiKeyInfo(candidate);
      profileIndex = nextIndex;
      
      // 重置 thinkLevel (新 profile 可能支持不同的 thinking levels)
      thinkLevel = initialThinkLevel;
      attemptedThinking.clear();
      
      return true;  // 轮换成功
    } catch (err) {
      // 无法获取 API key (OAuth 失败等)
      if (candidate && candidate === lockedProfileId) {
        throw err;  // 锁定的 profile 失败 → 直接抛出
      }
      nextIndex += 1;
    }
  }
  
  return false;  // 无可用 profile
}
```

**调用时机**:
```typescript
// 1. Prompt 提交失败 + 是 failover 错误
if (isFailoverErrorMessage(errorText) && await advanceAuthProfile()) {
  continue;  // 用新 profile 重试
}

// 2. Assistant 响应失败 + 是 failover 错误
if (shouldRotate && await advanceAuthProfile()) {
  continue;  // 用新 profile 重试
}
```

## 8. Thinking Level 自适应降级 (Thinking Level Adaptation)

**实现位置**: `src/agents/pi-embedded-helpers/thinking.ts` (46 行)

### 8.1 Thinking Level 枚举

```typescript
type ThinkLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
```

**语义**:
- `off` - 无推理，直接回答
- `minimal` - 极简推理（几句话）
- `low` - 基础推理（用于简单任务）
- `medium` - 中等推理（适合大多数编程任务）
- `high` - 深度推理（复杂架构设计）
- `xhigh` - 最高级别推理（仅限顶级模型，如 GPT-4.5, Opus 4.5）

### 8.2 Fallback 触发机制

**错误检测** (`pickFallbackThinkingLevel()`, 46 行):

当模型返回类似以下错误时触发：
```
Error: unsupported_parameter: 'thinking_level'. Supported values are: 'off', 'low', 'medium'
Error: invalid thinking level 'high'. Supported values: "off", "minimal", "low"
```

**解析逻辑**:
```typescript
function extractSupportedValues(raw: string): string[] {
  // 1. 提取 "supported values are: ..." 片段
  const match = raw.match(/supported values are:\s*([^\n.]+)/i) ||
                raw.match(/supported values:\s*([^\n.]+)/i);
  if (!match?.[1]) return [];
  
  const fragment = match[1];
  
  // 2. 提取带引号的值 (e.g., 'off', 'low', 'medium')
  const quoted = Array.from(fragment.matchAll(/['"]([^'"]+)['"]/g))
    .map(entry => entry[1]?.trim());
  if (quoted.length > 0) {
    return quoted.filter(Boolean);
  }
  
  // 3. Fallback: 按逗号/and 分割
  return fragment
    .split(/,|\band\b/gi)
    .map(entry => entry.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, "").trim())
    .filter(Boolean);
}

export function pickFallbackThinkingLevel(params: {
  message?: string;
  attempted: Set<ThinkLevel>;
}): ThinkLevel | undefined {
  const raw = params.message?.trim();
  if (!raw) return undefined;
  
  const supported = extractSupportedValues(raw);
  if (supported.length === 0) return undefined;
  
  // 从 supported 列表中找第一个未尝试过的 level
  for (const entry of supported) {
    const normalized = normalizeThinkLevel(entry);
    if (!normalized) continue;
    if (params.attempted.has(normalized)) continue;
    return normalized;  // 返回降级后的 level
  }
  
  return undefined;  // 所有 supported levels 都尝试过了
}
```

### 8.3 Retry 流程

**实现**: `runEmbeddedPiAgent()` (`pi-embedded-runner/run.ts`, 169 行起)

```typescript
const initialThinkLevel = params.thinkLevel ?? "off";
let thinkLevel = initialThinkLevel;
const attemptedThinking = new Set<ThinkLevel>();

while (true) {  // 无限重试循环 (直到成功或所有策略耗尽)
  attemptedThinking.add(thinkLevel);
  
  try {
    const result = await runEmbeddedAttempt({
      ...params,
      thinkLevel,  // 使用当前 thinkLevel
    });
    
    // 成功 → 返回
    return result;
    
  } catch (promptError) {
    const errorText = formatAssistantErrorText(promptError);
    
    // 尝试降级 thinkLevel
    const fallbackThinking = pickFallbackThinkingLevel({
      message: errorText,
      attempted: attemptedThinking,
    });
    
    if (fallbackThinking) {
      log.warn(`unsupported thinking level; retrying with ${fallbackThinking}`);
      thinkLevel = fallbackThinking;
      continue;  // 用新 thinkLevel 重试
    }
    
    // 无法降级 → 尝试其他策略 (profile rotation, model fallback)
    ...
  }
}
```

**降级序列示例**:
```
尝试1: thinkLevel = "xhigh"
   ↓ 错误: "Supported values are: 'high', 'medium', 'low', 'off'"
尝试2: thinkLevel = "high"
   ↓ 错误: "Supported values are: 'medium', 'low', 'off'"
尝试3: thinkLevel = "medium"
   ↓ 成功
```

### 8.4 Profile 切换时重置

**逻辑**: 当切换到新的 Auth Profile 时，重置 `thinkLevel` 和 `attemptedThinking`:

```typescript
const advanceAuthProfile = async (): Promise<boolean> => {
  ...
  if (rotated) {
    thinkLevel = initialThinkLevel;      // 重置为用户请求的 level
    attemptedThinking.clear();           // 清除尝试记录
    return true;
  }
  ...
};
```

**原因**: 不同 profile 可能连接到不同的 API endpoint 或模型变体，支持的 thinking levels 可能不同。

## 9. 上下文溢出处理 (Context Overflow Handling)

**实现位置**: `src/agents/pi-embedded-runner/compact.ts` (18KB, 详见 `memory-management.md`)

### 9.1 检测与触发

**错误检测** (`isContextOverflowError()`, `pi-embedded-helpers/errors.ts`):
```typescript
function isContextOverflowError(message: string): boolean {
  return /context.*length|prompt.*too.*large|maximum context|exceeds.*token.*limit/i.test(message);
}
```

**触发条件** (在 `runEmbeddedPiAgent()` 中):
```typescript
if (isContextOverflowError(errorText)) {
  const isCompactionFailure = isCompactionFailureError(errorText);
  
  if (!isCompactionFailure && params.autoCompact) {
    // 尝试自动压缩
    const compactResult = await compactEmbeddedPiSessionDirect({
      sessionId,
      config: params.config,
      workspaceDir: params.workspaceDir,
      ownerNumbers: params.ownerNumbers,
    });
    
    if (compactResult.compacted) {
      log.info(`auto-compaction succeeded; retrying prompt`);
      continue;  // 用压缩后的 session 重试
    }
    
    log.warn(`auto-compaction failed: ${compactResult.reason ?? "nothing to compact"}`);
  }
  
  // Compaction 失败或禁用 → 返回用户友好错误
  return {
    payloads: [{
      text: "Context overflow: prompt too large for the model. " +
            "Try again with less input or a larger-context model.",
      isError: true,
    }],
    meta: { error: { kind: "context_overflow", message: errorText } },
  };
}
```

### 9.2 Auto-Compaction 逻辑

**Multi-Part Summarization** (详见 `memory-management.md` 第 3 节):
1. 将历史消息分为 N 个 chunk (每个 ~10 条消息)
2. 并行调用 LLM 对每个 chunk 生成摘要
3. 合并所有摘要 + 保留最后 M 条原始消息
4. 替换 session history

**保留规则**:
- TODO 列表 (最后一次)
- 用户约束 (constraints)
- 关键决策点 (decisions with high priority)

### 9.3 Compaction 失败处理

**Compaction Failure Error** (`isCompactionFailureError()`):
```typescript
function isCompactionFailureError(message: string): boolean {
  return /compaction.*failed|summarization.*error/i.test(message);
}
```

**场景**: Compaction 过程中调用 LLM 也失败了（通常是 LLM 本身的问题）

**处理**: 不再重试，直接返回 context overflow 错误

## 10. 统一重试循环 (Unified Retry Loop)

**实现位置**: `src/agents/pi-embedded-runner/run.ts` (300-600 行)

### 10.1 完整重试策略层级

```
┌─────────────────────────────────────────────────────────┐
│  runEmbeddedPiAgent() - 主循环                          │
│                                                         │
│  while (true) {                                         │
│    ┌──────────────────────────────────────────────┐    │
│    │ 尝试: runEmbeddedAttempt()                   │    │
│    └──────────────────────────────────────────────┘    │
│                   │                                     │
│                   ↓                                     │
│    ┌─────────────────────────────────────────────┐     │
│    │ 失败? → 应用降级策略                        │     │
│    │                                             │     │
│    │ 1. Context Overflow?                        │     │
│    │    ├─ Yes → Auto-Compaction → retry        │     │
│    │    └─ No → 继续                            │     │
│    │                                             │     │
│    │ 2. Thinking Level Unsupported?              │     │
│    │    ├─ Yes → Downgrade ThinkLevel → retry  │     │
│    │    └─ No → 继续                            │     │
│    │                                             │     │
│    │ 3. Failover Error (Auth/Rate/Billing)?      │     │
│    │    ├─ Yes → Rotate Profile → retry         │     │
│    │    └─ No → 继续                            │     │
│    │                                             │     │
│    │ 4. All Profiles Exhausted?                  │     │
│    │    ├─ Yes → Throw FailoverError            │     │
│    │    │         (触发 Model Fallback)          │     │
│    │    └─ No → 返回错误                        │     │
│    └─────────────────────────────────────────────┘     │
│                                                         │
│  } // end while                                         │
└─────────────────────────────────────────────────────────┘
```

### 10.2 重试决策表

| 错误类型 | Context Overflow | Thinking Unsupported | Auth/Rate/Billing | Timeout | Unknown |
|:---|:---|:---|:---|:---|:---|
| **自动处理** | ✅ Auto-Compact | ✅ Downgrade Think | ✅ Rotate Profile | ✅ Rotate Profile | ❌ |
| **重试循环** | ✅ (compaction 后) | ✅ (downgrade 后) | ✅ (rotation 后) | ✅ (rotation 后) | ❌ |
| **Model Fallback** | ❌ | ❌ | ✅ (profiles 耗尽后) | ✅ (profiles 耗尽后) | ✅ (如果配置) |
| **返回用户错误** | ✅ (compaction 失败) | ❌ | ❌ | ❌ | ✅ |

### 10.3 重试终止条件

**成功条件**:
```typescript
if (attempt.assistant && !attempt.assistant.error) {
  // 获取到有效的 assistant 响应 → 成功
  return { payloads, meta: { ... } };
}
```

**失败终止条件**:
1. 所有 Auth Profiles 耗尽 + 配置了 fallbacks → 抛出 `FailoverError` (外层 `runWithModelFallback()` 捕获并切换模型)
2. 所有 Auth Profiles 耗尽 + 未配置 fallbacks → 返回错误给用户
3. Context Overflow + Auto-Compaction 失败 → 返回 context overflow 错误
4. 用户取消 (AbortError) → 直接抛出，不重试

### 10.4 重试计数限制

**无硬编码限制**: OpenClaw 不设置最大重试次数，而是通过以下机制自然终止：

1. **Profile 数量有限** - 每个 provider 通常只有 2-5 个 profiles
2. **Thinking Levels 有限** - 最多 6 个 levels (`xhigh` → `off`)
3. **Compaction 只尝试一次** - 失败后不再重试
4. **Model Fallback 链有限** - 通常 2-4 个候选模型

**实际最大重试次数估算**:
```
Max retries = (Profiles × ThinkLevels) × Models
            = (5 × 6) × 3
            = 90 次 (理论极限，实际很少超过 10 次)
```

## 11. 性能指标与监控 (Performance Metrics)

### 11.1 关键指标

| 指标 | 定义 | 目标值 | 数据来源 |
|:---|:---|:---|:---|
| **Model Fallback Rate** | 触发模型降级的比例 | \< 5% | `FallbackAttempt[]` |
| **Profile Rotation Rate** | 单次请求内轮换 profile 的比例 | \< 10% | `profileIndex` 变化 |
| **Thinking Downgrade Rate** | 降级 thinking level 的比例 | \< 15% | `attemptedThinking.size > 1` |
| **Context Overflow Rate** | 触发 compaction 的比例 | \< 8% | `compacted` flag |
| **Average Retries per Request** | 每次请求的平均重试次数 | \< 1.5 | 循环计数 |
| **P95 Latency (with retries)** | 包含重试的第 95 百分位延迟 | \< 30s | `meta.durationMs` |

### 11.2 日志埋点

**Profile Rotation**:
```typescript
log.warn(`Profile ${lastProfileId} timed out (possible rate limit). Trying next account...`);
log.warn(`Profile ${lastProfileId} hit Cloud Code Assist format error. Tool calls will be sanitized on retry.`);
```

**Thinking Downgrade**:
```typescript
log.warn(`unsupported thinking level for ${provider}/${modelId}; retrying with ${fallbackThinking}`);
```

**Compaction**:
```typescript
log.info(`auto-compaction succeeded for ${provider}/${modelId}; retrying prompt`);
log.warn(`auto-compaction failed for ${provider}/${modelId}: ${compactResult.reason}`);
```

**Model Fallback**:
```typescript
log.error(`All models failed (${attempts.length}): ${summary}`);
```

### 11.3 成本优化分析

**重试成本公式**:
```
Total Cost = Σ (Attempts × TokenCost × FailureRate)

Example:
  Primary Model: GPT-4o ($5/1M tokens, 90% success)
  Fallback 1: Sonnet 3.5 ($3/1M tokens, 95% success)
  Fallback 2: Flash ($0.1/1M tokens, 99% success)
  
  Avg tokens per request: 10,000
  Avg retries: 1.2
  
  Expected cost per request:
    = 0.9 × (10K × $5/1M) + 0.1 × 0.95 × (10K × $3/1M) + 0.1 × 0.05 × (10K × $0.1/1M)
    = $0.045 + $0.00285 + $0.000005
    = $0.048
  
  vs. 单一模型 (no fallback):
    = 0.9 × $0.05 + 0.1 × 0 (失败)
    = $0.045 (but 10% failure rate)
```

**结论**: Fallback 链增加约 6% 成本，但将失败率从 10% 降至 \<0.1%。

## 12. 关键文件索引 (Key Files)

| 文件路径 | 行数 | 功能职责 |
|:---|:---|:---|
| `src/agents/model-catalog.ts` | 144 | 模型注册表加载与查询 |
| `src/agents/model-selection.ts` | 200+ | 模型解析、别名系统、provider 规范化 |
| `src/agents/model-fallback.ts` | 400+ | 多级降级链执行 (主函数) |
| `src/agents/model-compat.ts` | 25 | Provider-specific 兼容性修复 |
| `src/agents/failover-error.ts` | 150+ | Failover 错误分类与规范化 |
| `src/agents/auth-profiles/store.ts` | 200+ | Auth Profile 持久化存储 |
| `src/agents/auth-profiles/order.ts` | 200+ | Profile 排序逻辑 |
| `src/agents/auth-profiles/usage.ts` | 300+ | Cooldown 计算与 failure tracking |
| `src/agents/pi-embedded-runner/run.ts` | 693 | 统一重试循环 (核心) |
| `src/agents/pi-embedded-runner/model.ts` | 113 | 模型解析 (含内联模型支持) |
| `src/agents/pi-embedded-helpers/thinking.ts` | 46 | Thinking level fallback 解析 |
| `src/agents/pi-embedded-helpers/errors.ts` | 500+ | 错误检测工具函数集合 |

## 13. 配置最佳实践 (Configuration Best Practices)

### 13.1 生产环境推荐配置

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-sonnet-4-5",
        "fallbacks": [
          "anthropic/claude-opus-4-5",
          "google/gemini-2.0-flash-exp",
          "openai/gpt-4o-mini"
        ]
      },
      "models": {
        "anthropic/claude-sonnet-4-5": {
          "alias": "sonnet",
          "authProfiles": ["work-account", "personal-account"]
        },
        "anthropic/claude-opus-4-5": {
          "alias": "opus"
        },
        "google/gemini-2.0-flash-exp": {
          "alias": "flash"
        }
      },
      "imageModel": {
        "primary": "anthropic/claude-opus-4-5",
        "fallbacks": [
          "google/gemini-2.0-flash-exp"
        ]
      },
      "subagent": {
        "model": "google/gemini-2.0-flash-exp"
      }
    }
  },
  "auth": {
    "cooldowns": {
      "billingBackoffHours": 5,
      "billingMaxHours": 24,
      "failureWindowHours": 24,
      "billingBackoffHoursByProvider": {
        "anthropic": 3,
        "openai": 6
      }
    }
  }
}
```

**设计理念**:
- **Primary**: 高性能模型 (Sonnet 4.5) - 性价比最优
- **Fallback 1**: 顶级模型 (Opus 4.5) - 处理复杂任务
- **Fallback 2**: 高速模型 (Flash) - 简单任务快速响应
- **Fallback 3**: 经济模型 (GPT-4o mini) - 降级兜底
- **Subagent**: 廉价模型 (Flash) - 批量子任务
- **Image**: 视觉能力强的模型 (Opus → Flash)

### 13.2 测试环境简化配置

```json
{
  "agents": {
    "defaults": {
      "model": "google/gemini-2.0-flash-exp",
      "imageModel": "google/gemini-2.0-flash-exp",
      "subagent": {
        "model": "google/gemini-2.0-flash-exp"
      }
    }
  }
}
```

**原因**: 测试环境通常不需要高级推理，使用免费/廉价模型即可。

### 13.3 多账号配置 (Profile Setup)

**Auth Store 配置示例** (`~/.openclaw/agent/auth-store.json5`):
```json5
{
  version: 1,
  profiles: {
    "anthropic-work": {
      id: "anthropic-work",
      provider: "anthropic",
      type: "api-key",
      apiKey: "sk-ant-api03-...",
    },
    "anthropic-personal": {
      id: "anthropic-personal",
      provider: "anthropic",
      type: "api-key",
      apiKey: "sk-ant-api03-...",
    },
    "openai-main": {
      id: "openai-main",
      provider: "openai",
      type: "api-key",
      apiKey: "sk-proj-...",
    },
  },
  order: {
    anthropic: ["anthropic-work", "anthropic-personal"],
    openai: ["openai-main"],
  },
}
```

**注意事项**:
- 每个 provider 至少配置 2 个 profiles (实现冗余)
- 使用 `order` 字段控制优先级
- 定期检查 `usageStats` 以监控 cooldown 状态

## 14. 故障排查指南 (Troubleshooting)

### 14.1 常见问题诊断

| 症状 | 可能原因 | 排查步骤 |
|:---|:---|:---|
| 频繁 Model Fallback | Primary model 配额耗尽 | 检查 `auth-store.json` 的 `usageStats`，查看 `disabledUntil` |
| 请求超时 (无 fallback) | 未配置 fallbacks | 添加 `agents.defaults.model.fallbacks` |
| Thinking level 总是 `off` | 模型不支持 thinking | 切换到支持 reasoning 的模型 (见 model catalog) |
| Context overflow (循环) | Session history 过大 + compaction 禁用 | 启用 `autoCompact: true` |
| "All profiles in cooldown" | 所有 profiles 短时间内大量失败 | 检查 API key 有效性，或增加 profiles 数量 |

### 14.2 日志分析

**启用详细日志**:
```bash
export DEBUG=openclaw:*
export OPENCLAW_LOG_LEVEL=debug
```

**关键日志模式**:
```
# Profile Rotation
[openclaw:run] Profile anthropic-work timed out (possible rate limit). Trying next account...

# Thinking Downgrade
[openclaw:run] unsupported thinking level for anthropic/claude-haiku-3-5; retrying with medium

# Compaction
[openclaw:compact] auto-compaction succeeded for anthropic/claude-sonnet-4-5; retrying prompt

# Model Fallback
[openclaw:fallback] All models failed (3): anthropic/claude-opus-4-5: rate_limit | google/gemini-2.0-flash-exp: auth | openai/gpt-4o: unknown
```

### 14.3 性能优化建议

1. **减少 Fallback 链长度** - 超过 3 个 fallback 模型收益递减
2. **优化 Primary 模型选择** - 根据实际成功率调整（非最强≠最优）
3. **增加 Profile 数量** - 3-5 个 profiles 可显著降低 rate limit 影响
4. **启用 Auto-Compaction** - 避免 context overflow 导致的失败
5. **监控 Cooldown Metrics** - 频繁 cooldown 说明配额不足或配置不当

## 15. 总结与架构模式 (Summary & Design Patterns)

### 15.1 核心设计模式

| 模式 | 实现位置 | 优势 |
|:---|:---|:---|
| **Chain of Responsibility** | `runWithModelFallback()` | 灵活的降级链，易于扩展 |
| **Strategy Pattern** | Profile rotation, Thinking downgrade | 运行时动态选择策略 |
| **Circuit Breaker** | Cooldown mechanism | 防止无效重试浪费配额 |
| **Retry with Exponential Backoff** | Cooldown 计算 | 自动恢复 + 防止雪崩 |
| **Adapter Pattern** | Model compat layer | 屏蔽 provider 差异 |

### 15.2 弹性工程最佳实践

1. **多层防御 (Defense in Depth)**
   - Layer 1: Profile rotation
   - Layer 2: Thinking level adaptation
   - Layer 3: Model fallback
   - Layer 4: Compaction (context overflow)

2. **优雅降级 (Graceful Degradation)**
   - 优先使用高级功能 (reasoning)
   - 失败后自动降级到基础功能 (no reasoning)
   - 保证核心功能可用性

3. **快速失败 (Fail Fast)**
   - Cooldown 机制避免重复调用失败的 profiles
   - AbortError 直接抛出，不浪费重试

4. **可观测性 (Observability)**
   - 详细的 retry attempts 记录
   - 结构化的 error reasons
   - 性能指标埋点

### 15.3 适用场景 (Use Cases)

**PonyBunny 项目中的模型性能参考指南**:
- 设计 Autonomy Daemon 时的模型选择策略
- Work Order 执行失败的重试机制
- Quality Gate LLM Review 的模型配置
- Multi-day Context 的压缩触发阈值

---

**版本**: 基于 OpenClaw commit `75093ebe1` (2026-01-30)  
**文档更新**: 2026-01-31  
**总行数**: ~1100 行