# 07 - Infrastructure

## 7.1 LLM Provider Architecture

### Overview

PonyBunny supports multiple LLM providers through a layered abstraction:

```
Application Code
      │
      ▼
┌─ LLMProviderManager ──────────────────────────────────┐
│  Workload-based selection (execution, planning, etc.)  │
│  Tier-based routing (simple, medium, complex)          │
└────────────┬───────────────────────────────────────────┘
             │
┌─ UnifiedLLMProvider ───────────────────────────────────┐
│  Model → Protocol → Endpoint routing                    │
│  Automatic fallback to secondary endpoints              │
│  Streaming support                                      │
└────────────┬───────────────────────────────────────────┘
             │
┌─ Protocol Adapters ────────────────────────────────────┐
│  AnthropicProtocol │ OpenAIProtocol │ GeminiProtocol   │
│  CodexProtocol                                          │
└────────────┬───────────────────────────────────────────┘
             │
┌─ Endpoints ────────────────────────────────────────────┐
│  anthropic │ aws-bedrock │ openai │ azure-openai       │
│  openai-compatible │ google-ai-studio │ google-vertex   │
│  openai-codex (OAuth)                                   │
└────────────────────────────────────────────────────────┘
```

### Supported Providers & Models

| Provider | Key Models | Cost (input/output per 1k tokens) |
|----------|-----------|----------------------------------|
| **Anthropic** | claude-opus-4-5, claude-sonnet-4-5, claude-haiku-4-5 | $0.015/$0.075, $0.003/$0.015, $0.001/$0.005 |
| **OpenAI** | gpt-5.2, gpt-5.2-codex, gpt-4-turbo, o1, o1-mini | Varies |
| **Google** | gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash | Varies |

### Protocol Adapters

Each adapter implements request formatting, response parsing, tool call handling, and streaming:

**AnthropicProtocolAdapter**:
- Messages API with system message extraction
- Tool format: `{type: 'tool_use', id, name, input}`
- Extended thinking support (budget_tokens: 10000)
- SSE streaming

**OpenAIProtocolAdapter**:
- Standard format + experimental "responses" API
- Handles max_completion_tokens vs max_tokens (o1/o3 models)
- Tool format: `{type: 'function', function: {name, arguments}}`
- Streaming tool call accumulation by index

**GeminiProtocolAdapter**:
- Vertex AI and Google AI Studio support
- Function declaration format with mode: AUTO/ANY/NONE
- Newline-delimited JSON streaming

**CodexProtocolAdapter**:
- OAuth-based ChatGPT Backend API
- JWT token parsing for account routing

### Model Routing

Default routing rules:
- `claude-*` → anthropic protocol → [anthropic, aws-bedrock]
- `gpt-*-codex` → codex protocol → [openai-codex]
- `gpt-*` → openai protocol → [openai, azure-openai, openai-compatible]
- `o1*`, `o3*` → openai protocol → [openai, azure-openai]
- `gemini-*` → gemini protocol → [google-ai-studio, google-vertex-ai]

Override via environment: `PONY_ENDPOINT_PRIORITY_CLAUDE=aws-bedrock,anthropic`

### Two Selection Modes

**Agent-based** (via LLMProviderManager):
```typescript
const manager = getLLMProviderManager();
const response = await manager.complete('execution', messages);
// Maps workload (execution, planning, etc.) → tier → model
```

**Tier-based** (via LLMService):
```typescript
const service = new LLMService();
const model = service.getModelForTier('complex');
// Direct tier → primary + fallback chain
```

### Common Types

```typescript
LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

LLMResponse {
  content: string | null
  tokensUsed: number
  tokenUsage?: { inputTokens, outputTokens, totalTokens }
  model: string
  endpointId?: string
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error'
  toolCalls?: ToolCall[]
  thinking?: string
}

ToolCall {
  id: string
  type: 'function'
  function: { name: string, arguments: string }
}
```

### Error Handling

```typescript
LLMProviderError {
  provider: string
  recoverable: boolean  // Determines fallback behavior
}
```

Non-recoverable: validation, auth failures. Recoverable: timeouts, rate limits, server errors.

## 7.2 Tool System

### Tool Definition

```typescript
ToolDefinition {
  name: string
  category: 'filesystem' | 'shell' | 'network' | 'database' | 'git' | 'code'
  riskLevel: 'safe' | 'moderate' | 'dangerous'
  requiresApproval: boolean
  description: string
  manifest?: ToolManifestV1
  execute(args, context): Promise<string>
}
```

### Tool Manifest Schema

```typescript
ToolManifestV1 {
  tool_ref: string      // 'skills://' | 'mcp://' | 'local://' | 'script://'
  display_name: string
  input_schema: { properties, required }
  output_schema: {}
  side_effect: 'none' | 'idempotent' | 'non_idempotent' | 'ui_automation'
  permissions: { network?, filesystem?, apps? }
}
```

### Built-in Tool Schemas

- `read_file` — Read file contents
- `write_file` — Write/create file
- `edit_file` — Edit existing file
- `execute_command` — Run shell command
- `list_dir` — List directory contents
- `search_code` — Search codebase
- `web_search` — Search the web

### Tool Registry

In-memory `Map<toolName, ToolDefinition>` with methods:
- `register(tool)` / `getTool(name)`
- `getToolsByCategory(category)` / `getToolsByRiskLevel(level)`

### Tool Enforcement

The `ToolEnforcer` checks:
1. Tool exists in registry
2. Tool is in goal's allowlist
3. Tool is not in goal's blocklist
4. Responsibility layer permits execution (Layer 1: auto, Layer 2: needs approval, Layer 3: forbidden)
5. Permission grant exists (for Layer 2 tools)

## 7.3 MCP Integration

**Source**: `src/infra/mcp/`

### Architecture

```
┌─ MCP Config Loader ──────────────────┐
│  ~/.config/ponybunny/mcp-config.json │
└────────────┬─────────────────────────┘
             │
┌─ MCP Client ─────────────────────────┐
│  Connection lifecycle                 │
│  Auto-reconnect (max 5, 5s delay)    │
│  States: disconnected → connecting   │
│         → connected → reconnecting   │
│         → failed                     │
└────────────┬─────────────────────────┘
             │
┌─ Transport ──────────────────────────┐
│  stdio: ChildProcess spawn           │
│  http: HTTP/SSE connection           │
└────────────┬─────────────────────────┘
             │
┌─ Adapters ───────────────────────────┐
│  Tool Adapter: MCP tools → PB tools  │
│  Namespacing: mcp__<server>__<tool>  │
│  Schema caching for LLM exposure     │
└──────────────────────────────────────┘
```

### MCP Server Config

```json
{
  "mcpServers": {
    "filesystem": {
      "enabled": true,
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "allowedTools": ["*"],
      "autoReconnect": true,
      "timeout": 30000
    },
    "remote-api": {
      "enabled": true,
      "transport": "http",
      "url": "https://mcp.example.com",
      "headers": { "Authorization": "Bearer ${API_KEY}" }
    }
  }
}
```

### MCP Types

```typescript
MCPToolDefinition { name, description, inputSchema }
MCPResourceDefinition { uri, name, description, mimeType }
MCPPromptDefinition { name, description, arguments[] }
MCPServerInfo { name, version, protocolVersion, capabilities }
```

## 7.4 System Prompt Architecture

**Source**: `src/infra/prompts/`

### SystemPromptBuilder

Modular prompt generation with sections:

| Section | Content |
|---------|---------|
| Identity | Brand, phase description |
| Tooling | Available tool definitions |
| Provider tool envelope | Provider-specific tool format |
| Tool call style | How to invoke tools |
| Safety | Budget limits, escalation rules |
| Skills | Available skills |
| Memory | Conversation memory context |
| Workspace | Working directory info |
| Project context | Goal/work item context |
| Runtime | Execution mode info |
| Extra context | Additional context from plugins |

### Phase Awareness

Prompts are customized per lifecycle phase:
- `intake`, `elaboration`, `planning`, `execution`, `verification`
- `evaluation`, `publish`, `monitor`, `conversation`

### Prompt Templates

Located in `src/infra/prompts/defaults/`:
- 25+ markdown template files
- Organized: `system/`, `persona/`, `phases/`, `safety/`
- Variable substitution for dynamic content

## 7.5 Agent Configuration

### Agent Config Structure

```typescript
AgentConfig {
  schedule: {
    cron?: string
    interval_ms?: number
    timezone?: string
    jitter_ms?: number
    catch_up_policy?: 'skip' | 'run_once' | 'run_all'
  }
  policy: {
    toolAllowlist?: string[]
    toolDenylist?: string[]
    skills?: string[]
    mcp?: { servers: string[] }
    limits?: { maxTokens?, maxCost?, maxTime? }
    approval?: {
      required?: boolean
      actions?: string[]
      thresholds?: Record<string, number>
    }
    privacy?: {
      redactPiiByDefault?: boolean
      allowedDataClasses?: string[]
    }
  }
}
```

### Runner System

- **AgentRunner interface**: `runTick(input) → Promise<void>`
- **RunnerRegistry**: Dynamic resolution by engine/type
- **AgentTickContext**: Budget (tokens, time, cost) + route context

## 7.6 Skills System

### Skill Metadata

```typescript
SkillMetadata {
  name: string
  description: string
  phases: string[]              // Which lifecycle phases can use this skill
  requiresApproval?: boolean
  primaryEnv: 'host' | 'sandbox'
  userInvocable?: boolean       // Available via CLI
  disableModelInvocation?: boolean
  commandDispatch: 'tool' | 'skill'
  commandTool?: string          // For direct dispatch routing
}
```

### Skill Sources

| Source | Location | Description |
|--------|----------|-------------|
| workspace | User workspace | User-defined skills |
| managed | Managed service | Service-provided skills |
| bundled | Built-in | System skills |
| extra | Additional dirs | Extension skills |

### Skill Registry

- `loadSkills(options)` — Async load from directories
- `getSkills()` / `getSkillsForPhase(phase)`
- `generateSkillsPrompt(format, phase)` — Generate LLM prompt section
- `loadSkillContent(skillName)` — Lazy load skill implementation

## 7.7 Configuration System

### Config Files

| File | Path | Schema Validation |
|------|------|------------------|
| `ponybunny.json` | `~/.config/ponybunny/` | AJV 2020, `docs/schemas/ponybunny.schema.json` |
| `credentials.json` | `~/.config/ponybunny/` | Provider-keyed API keys |
| `llm-config.json` | `~/.config/ponybunny/` | AJV 2020, embedded schema |
| `mcp-config.json` | `~/.config/ponybunny/` | AJV 2020, embedded schema |
| `auth.json` | `~/.config/ponybunny/` | OAuth tokens |

### Credential Resolution Priority

1. Environment variables (e.g., `ANTHROPIC_API_KEY`)
2. `credentials.json` file
3. Provider defaults

### LLM Config Structure

```json
{
  "providers": {
    "<provider-id>": { "protocol": "...", "baseUrl": "...", "priority": 1 }
  },
  "models": {
    "<model-id>": { "provider": "...", "cost": { "inputPer1k": 0.003, "outputPer1k": 0.015 } }
  },
  "tiers": {
    "simple": { "primary": "...", "fallbacks": ["..."] },
    "medium": { "primary": "...", "fallbacks": ["..."] },
    "complex": { "primary": "...", "fallbacks": ["..."] }
  },
  "workloads": {
    "execution": { "tier": "complex" },
    "planning": { "tier": "medium" },
    "conversation": { "tier": "medium" }
  },
  "defaults": {
    "timeout": 30000,
    "maxTokens": 4096,
    "maxRetries": 2,
    "retryDelayMs": 1000,
    "temperature": 0.7
  }
}
```

### Configuration Change Coupling

When changing runtime config structure, **all three must update in the same PR**:
1. Schema: `docs/schemas/ponybunny.schema.json` + onboarding schema template
2. Example: `docs/config-templates/ponybunny.example.json`
3. Init logic: `src/infra/config/onboarding.ts` + tests

## 7.8 Debug Infrastructure

### Debug Server

Located in `debug-server/` (separate package):

```
debug-server/
├── server/src/
│   ├── api-server.ts       # HTTP API + WebSocket
│   └── websocket.ts        # Real-time event streaming
└── webui/                  # Next.js debug dashboard
```

Access: `http://localhost:3001`

### Debug Modes

```bash
pb debug web               # Web dashboard
pb debug tui               # Terminal UI
pb debug start             # Start in background
pb debug status            # Check status
pb debug logs -f           # Follow logs
```

### Debug Events

Real-time streaming of:
- Goal lifecycle events
- Work item state transitions
- LLM calls and responses
- Tool invocations and results
- Error patterns and escalations
- Budget consumption
