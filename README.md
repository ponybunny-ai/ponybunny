# PonyBunny - Autonomous AI Employee System

**Production-ready autonomous AI agent framework with Gateway + Scheduler architecture.**

Durable like a pony. Fast like a bunny. Local-first, security-first, and trim-to-fit — know your AI agent like you know your staff.

## Key Features

✅ **Multi-Provider LLM Support** - Anthropic Claude, OpenAI GPT, Google Gemini with automatic failover
✅ **Claude-First Strategy** - Optimized for Claude Opus/Sonnet/Haiku 4.5 with GPT-5.2 fallback
✅ **8-Phase Autonomous Lifecycle** - Intake → Elaboration → Planning → Execution → Verification → Evaluation → Publish → Monitor
✅ **Gateway + Scheduler Architecture** - WebSocket-based communication with durable task orchestration
✅ **JSON Configuration System** - Separate credentials and LLM config files with schema validation
✅ **Local-First SQLite Persistence** - Durable work order tracking with DAG structure
✅ **Comprehensive Test Coverage** - 779 tests across 40 suites, all passing
✅ **CLI & TUI Interface** - Commander.js CLI with Ink-based terminal UI

## Quick Start

### Installation

```bash
git clone https://github.com/ponybunny-ai/ponybunny.git
cd ponybunny
npm install
npm run build
npm run build:cli
```

### Initialize Configuration

```bash
# Create config files in ~/.ponybunny/
pb init

# List config file status
pb init --list
```

This creates:
- `~/.ponybunny/credentials.json` - API keys (edit this to add your keys)
- `~/.ponybunny/credentials.schema.json` - JSON Schema for validation
- `~/.ponybunny/llm-config.json` - LLM endpoints, models, tiers, agents
- `~/.ponybunny/llm-config.schema.json` - JSON Schema for validation

### Configure API Keys

Edit `~/.ponybunny/credentials.json`:

```json
{
  "$schema": "./credentials.schema.json",
  "endpoints": {
    "anthropic-direct": {
      "enabled": true,
      "apiKey": "sk-ant-xxx",
      "baseUrl": ""
    },
    "openai-direct": {
      "enabled": true,
      "apiKey": "sk-xxx",
      "baseUrl": ""
    },
    "google-ai-studio": {
      "enabled": true,
      "apiKey": "xxx",
      "baseUrl": ""
    }
  }
}
```

### Verify Configuration

```bash
pb status
```

### Start the System

```bash
# Start Gateway + Scheduler daemon
PONY_DB_PATH=./pony.db node dist/main.js

# Or use CLI to connect
pb --url ws://127.0.0.1:18789
```

## Architecture

PonyBunny uses a **Gateway + Scheduler** architecture:

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Gateway                                    │
│  WebSocket server handling connections, auth, message routing        │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Scheduler                                   │
│  Task orchestration, model selection, 8-phase lifecycle execution    │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      LLM Provider Manager                            │
│  Multi-provider routing, fallback chains, agent-based model selection│
└─────────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
           Anthropic        OpenAI          Google
           (Claude)         (GPT)          (Gemini)
```

### Project Structure

```
src/
├── gateway/              # WebSocket server, connection management
├── scheduler/            # Task orchestration, model selection
│   └── agent/            # 8-phase lifecycle agents
├── domain/               # Pure business logic
│   ├── work-order/       # Goal, WorkItem, Run, Artifact types
│   ├── skill/            # Skill definitions
│   └── state-machine/    # Status transition rules
├── infra/                # Infrastructure adapters
│   ├── config/           # Configuration & onboarding
│   ├── persistence/      # SQLite repository
│   ├── llm/              # LLM providers & routing
│   │   ├── provider-manager/  # JSON config-driven provider management
│   │   ├── protocols/         # Anthropic, OpenAI, Gemini adapters
│   │   └── routing/           # Model routing & fallback
│   └── tools/            # Tool registry & allowlist
├── autonomy/             # ReAct integration & daemon
├── cli/                  # Commander.js CLI with Ink TUI
└── app/                  # Application services
    └── conversation/     # Conversation agent
```

## Configuration

### LLM Configuration (`~/.ponybunny/llm-config.json`)

Controls which endpoints, models, and agents are available:

```json
{
  "$schema": "./llm-config.schema.json",

  "endpoints": {
    "anthropic-direct": {
      "enabled": true,
      "protocol": "anthropic",
      "baseUrl": "https://api.anthropic.com/v1/messages",
      "priority": 1
    },
    "openai-direct": {
      "enabled": true,
      "protocol": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "priority": 1
    }
  },

  "models": {
    "claude-opus-4-5": {
      "displayName": "Claude Opus 4.5",
      "endpoints": ["anthropic-direct", "aws-bedrock"],
      "costPer1kTokens": { "input": 0.015, "output": 0.075 },
      "maxContextTokens": 200000,
      "capabilities": ["text", "vision", "function-calling"]
    },
    "claude-sonnet-4-5": {
      "displayName": "Claude Sonnet 4.5",
      "endpoints": ["anthropic-direct", "aws-bedrock"],
      "costPer1kTokens": { "input": 0.003, "output": 0.015 },
      "maxContextTokens": 200000,
      "capabilities": ["text", "vision", "function-calling"]
    },
    "claude-haiku-4-5": {
      "displayName": "Claude Haiku 4.5",
      "endpoints": ["anthropic-direct", "aws-bedrock"],
      "costPer1kTokens": { "input": 0.001, "output": 0.005 },
      "maxContextTokens": 200000,
      "capabilities": ["text", "vision", "function-calling"]
    },
    "gpt-5.2": {
      "displayName": "GPT-5.2",
      "endpoints": ["openai-direct", "azure-openai"],
      "costPer1kTokens": { "input": 0.01, "output": 0.03 },
      "maxContextTokens": 128000,
      "capabilities": ["text", "vision", "function-calling"]
    }
  },

  "tiers": {
    "simple": {
      "primary": "claude-haiku-4-5",
      "fallback": "gpt-5.2"
    },
    "medium": {
      "primary": "claude-sonnet-4-5",
      "fallback": "gpt-5.2"
    },
    "complex": {
      "primary": "claude-opus-4-5",
      "fallback": "gpt-5.2"
    }
  },

  "agents": {
    "input-analysis": { "tier": "simple" },
    "planning": { "tier": "complex" },
    "execution": { "tier": "medium", "primary": "claude-sonnet-4-5" },
    "verification": { "tier": "medium" },
    "response-generation": { "tier": "simple" },
    "conversation": { "tier": "medium" }
  },

  "defaults": {
    "timeout": 120000,
    "maxTokens": 4096,
    "temperature": 0.7
  }
}
```

### Credentials (`~/.ponybunny/credentials.json`)

Stores API keys separately from configuration:

```json
{
  "$schema": "./credentials.schema.json",
  "endpoints": {
    "anthropic-direct": {
      "enabled": true,
      "apiKey": "sk-ant-xxx"
    },
    "aws-bedrock": {
      "enabled": false,
      "accessKeyId": "",
      "secretAccessKey": "",
      "region": "us-east-1"
    },
    "openai-direct": {
      "enabled": true,
      "apiKey": "sk-xxx"
    },
    "azure-openai": {
      "enabled": false,
      "apiKey": "",
      "endpoint": ""
    },
    "google-ai-studio": {
      "enabled": true,
      "apiKey": "xxx"
    },
    "google-vertex-ai": {
      "enabled": false,
      "projectId": "",
      "region": ""
    }
  }
}
```

### Environment Variables

Environment variables override config file settings:

```bash
# Direct API keys (override credentials.json)
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx
GOOGLE_API_KEY=xxx

# AWS Bedrock
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
AWS_REGION=us-east-1

# Azure OpenAI
AZURE_OPENAI_API_KEY=xxx
AZURE_OPENAI_ENDPOINT=https://xxx.openai.azure.com

# Google Vertex AI
GOOGLE_PROJECT_ID=xxx
GOOGLE_LOCATION=us-central1

# Database
PONY_DB_PATH=./pony.db
```

## CLI Commands

```bash
# Initialize configuration
pb init                    # Create config files
pb init --list             # Show config file status
pb init --force            # Overwrite existing files
pb init --dry-run          # Preview without creating

# Authentication
pb auth login              # Login to OpenAI Codex
pb auth list               # List authenticated accounts
pb auth antigravity login  # Login to Antigravity (Google)

# System status
pb status                  # Check system and auth status

# Work assignment
pb work "task description" # Assign a task to the autonomous agent

# Gateway management
pb gateway start           # Start the gateway server
pb gateway stop            # Stop the gateway server
pb gateway status          # Check gateway status

# Model management
pb models list             # List available models
pb models update           # Update model configurations

# Configuration
pb config                  # Manage CLI configuration

# Debug tools
pb debug                   # Launch debug/observability TUI or Web UI
```

## 8-Phase Autonomous Lifecycle

PonyBunny executes work through an 8-phase lifecycle:

1. **Intake** - Validate goal requirements and constraints
2. **Elaboration** - Detect ambiguities, request clarification if needed
3. **Planning** - Decompose into work items (DAG structure)
4. **Execution** - Autonomous ReAct cycle with LLM
5. **Verification** - Run quality gates (tests, lint, build)
6. **Evaluation** - Decide: publish, retry, or escalate
7. **Publish** - Package artifacts and generate summary
8. **Monitor** - Track metrics and budget utilization

### Entity Model

```
Goal
├── success_criteria[]      # Deterministic + heuristic
├── budget_tokens/time/cost # Resource limits
└── WorkItem[]
    ├── verification_plan   # Quality gates
    ├── dependencies[]      # DAG structure
    └── Run[]
        ├── artifacts[]     # Generated outputs
        ├── decisions[]     # Agent reasoning
        └── escalations[]   # Human intervention requests
```

## LLM Provider Manager

The Provider Manager provides unified access to multiple LLM providers with a **Claude-first strategy**:

### Model Strategy

**Default Tier Models:**
- **Simple tier**: `claude-haiku-4-5` → fallback to `gpt-5.2`
- **Medium tier**: `claude-sonnet-4-5` → fallback to `gpt-5.2`
- **Complex tier**: `claude-opus-4-5` → fallback to `gpt-5.2`

**Supported Models:**
- **Anthropic**: Claude Opus 4.5, Sonnet 4.5, Haiku 4.5 (with dated versions)
- **OpenAI**: GPT-5.2, GPT-4 Turbo, o1, o1-mini
- **Google**: Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.0 Flash

### Usage Examples

```typescript
import { getLLMProviderManager } from './src/infra/llm/provider-manager/index.js';

const manager = getLLMProviderManager();

// Complete using agent-based model selection
const response = await manager.complete('execution', [
  { role: 'system', content: 'You are a coding assistant' },
  { role: 'user', content: 'Write a function to sort an array' },
]);

// Complete using tier-based selection
const response = await manager.completeWithTier('medium', messages);

// Complete with specific model
const response = await manager.completeWithModel('claude-sonnet-4-5', messages);

// Get model for an agent
const model = manager.getModelForAgent('planning'); // 'claude-opus-4-5'

// Get fallback chain
const chain = manager.getFallbackChain('execution');
// ['claude-sonnet-4-5', 'gpt-5.2']
```

## Development

### Build & Test

```bash
# Build
npm run build              # Compile TypeScript
npm run build:cli          # Build CLI binary

# Test
npm test                   # Run all Jest tests (779 tests)
npm run test:watch         # Watch mode
npm run test:coverage      # Coverage report

# Run specific test suites
npx jest test/path/to/file.test.ts
npm run test:llm-provider-manager  # Test LLM provider manager

# E2E tests (run with tsx, not Jest)
npx tsx test/e2e-lifecycle.ts
npx tsx test/provider-manager-test.ts
npx tsx demo/autonomous-demo.ts
```

### Test Suite Status

✅ **All 779 tests passing** across 40 test suites covering:
- Gateway & Scheduler integration
- LLM provider management & routing
- 8-phase lifecycle execution
- Configuration & credentials management
- Tool registry & allowlist enforcement
- State machine transitions
- Budget tracking & escalation handling

### Code Conventions

**ESM imports require `.js` extension:**
```typescript
import { Goal } from './types.js';           // ✓ Correct
import { Goal } from './types';              // ✗ Wrong
```

**Naming:**
- Classes: `PascalCase` (e.g., `IntakeService`)
- Interfaces: `I`-prefix (e.g., `IWorkOrderRepository`)
- Files: `kebab-case` (e.g., `state-machine.ts`)
- Database fields: `snake_case` (e.g., `goal_id`)

**Layer Rules:**
- `domain/` never imports from `app/`, `infra/`, or `gateway/`
- Use `import type` for type-only imports
- Use named exports (avoid `export default`)
- Dependency injection via constructor

**Testing:**
- Mock credentials in tests to prevent loading from `~/.ponybunny/credentials.json`
- Use `jest.mock()` for the credentials-loader module in test files
- Run single test files with `npx jest test/path/to/file.test.ts`

## Success Metrics

- **Autonomous Completion Rate**: >70% of work items without human intervention
- **Continuous Operation**: ≥8 hour work shifts without human input
- **Quality**: >80% first-time Quality Gate pass rate
- **Multi-day Success**: >60% of multi-day projects completed autonomously

## Documentation

- `CLAUDE.md` - AI assistant instructions
- `AGENTS.md` - Development patterns and testing guidelines
- `docs/techspec/` - Technical specifications
  - `architecture-overview.md` - System architecture
  - `gateway-design.md` - WebSocket protocol, authentication
  - `scheduler-design.md` - Task orchestration, model selection
  - `ai-employee-paradigm.md` - Responsibility layers, escalation

## License

MIT
