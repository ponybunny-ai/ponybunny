# PonyBunny System Architecture

## Overview

PonyBunny is an **Autonomous AI Employee System** built on a **Gateway + Scheduler** architecture. Humans set goals, AI delivers complete results autonomously.

## Core Success Metrics

| Metric | Target | Why It Matters |
|:-------|:-------|:---------------|
| Work Item Autonomy Rate | >70% | Core autonomy indicator |
| Continuous Work Shift | ≥8 hours | Validates "hands-off" capability |
| Quality Gate Pass Rate | >80% | Self-quality assurance |
| Monthly API Cost | <$10 | Affordable for individuals |

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         External World                               │
│  Web UI  │  Mobile App  │  Voice Assistant  │  CLI  │  Other Agents │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ 对人类: conversation.message (文字/语音/图片)
                              │ 对其他系统: goal.*, workitem.*, etc.
                              │
                              │ WS / WSS (长连接)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Gateway (统一调度层)                        │
│  - WS/WSS connection management (heartbeat, reconnect)              │
│  - Authentication & authorization                                    │
│  - Message routing to appropriate Agent                              │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                     Agent Layer                                 │ │
│  │                                                                 │ │
│  │  ┌─────────────────────┐      ┌─────────────────────┐         │ │
│  │  │ Conversation Agent  │      │     Scheduler       │         │ │
│  │  │                     │      │                     │         │ │
│  │  │ - 理解人类自然语言  │─────▶│ - 8-Phase Lifecycle │         │ │
│  │  │ - 人格化回复        │      │ - Task Decomposition│         │ │
│  │  │ - 对话状态管理      │◀─────│ - Model Selection   │         │ │
│  │  │ - 进度叙述          │      │ - Execution Monitor │         │ │
│  │  └─────────────────────┘      └──────────┬──────────┘         │ │
│  │                                          │                     │ │
│  └──────────────────────────────────────────┼─────────────────────┘ │
│                                             │                       │
│  Internal Methods (Agents 之间调用):        │                       │
│  goal.*, workitem.*, escalation.*, etc.     │                       │
└─────────────────────────────────────────────┼───────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Scheduler (Core Brain)                            │
│  Acts as the Agent, responsible for:                                │
│                                                                      │
│  1. Task Clarification  - Parse Goal, resolve ambiguity             │
│  2. Task Decomposition  - Break into Work Items (DAG)               │
│  3. Success Definition  - Generate Verification Plan                │
│  4. Model Selection     - Choose LLM based on task complexity       │
│  5. Lane Selection      - Assign to Main/Subagent/Cron/Session      │
│  6. Execution Monitor   - Track progress, detect anomalies          │
│  7. Result Evaluation   - Judge done/retry/escalate                 │
│  8. Retry Adjustment    - Switch strategy/model on failure          │
│                                                                      │
│                              │                                       │
│                              ▼                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                        Skills                                  │  │
│  │  High-level capabilities combining multiple tools              │  │
│  │  Examples: implement_feature, write_tests, create_pr, deploy   │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                              ▼                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                        Tools                                   │  │
│  │  Atomic operations with allowlist control                      │  │
│  │  Examples: read_file, write_file, shell, git, http_request     │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                              ▼                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                     OS Services                                │  │
│  │  System-level apps and services requiring permissions          │  │
│  │  Examples: Keychain, Browser, Docker, Network services         │  │
│  │                                                                │  │
│  │  Permission flow: Check → Request (sudo/OAuth/confirm) →      │  │
│  │                   Retry on failure → Escalate if exhausted     │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Persistence                                   │
│  SQLite: Goals, Work Items, Runs, Artifacts, Decisions              │
└─────────────────────────────────────────────────────────────────────┘
```

## Code Organization

```
src/
├── gateway/          # WS/WSS server, connection management, message routing
├── scheduler/        # Core brain - task orchestration, model/lane selection
│   └── agent/        # Agent logic for the 8-phase lifecycle
├── domain/           # Pure business logic, NO external dependencies
│   ├── work-order/   # Goal, WorkItem, Run, Artifact types
│   ├── conversation/ # Persona, Session, Analysis types
│   ├── skill/        # Skill definitions and registry
│   └── state-machine # Status transition rules
├── app/              # Application services
│   └── conversation/ # Conversation Agent services
│       ├── persona-engine.ts
│       ├── input-analysis-service.ts
│       ├── conversation-state-machine.ts
│       ├── response-generator.ts
│       ├── task-bridge.ts
│       └── session-manager.ts
├── infra/            # Infrastructure adapters
│   ├── persistence/  # SQLite repository
│   ├── llm/          # LLM providers with router failover
│   ├── tools/        # Tool registry & allowlist
│   ├── skills/       # Skill implementations
│   └── conversation/ # Conversation repositories & prompts
├── autonomy/         # ReAct integration & daemon
└── cli/              # Commander.js CLI with Ink terminal UI
```

## Layer Rules

- **Domain** never imports from `app/`, `infra/`, or `gateway/`
- **Scheduler** orchestrates domain + infra, defines interfaces (ports)
- **Gateway** handles all external communication (WS/WSS)
- **Infra** implements interfaces, handles external I/O

## Related Documents

- [Gateway Design](./gateway-design.md) - WebSocket protocol, authentication, message routing
- [Scheduler Design](./scheduler-design.md) - Task orchestration, model selection, execution lanes
- [AI Employee Paradigm](./ai-employee-paradigm.md) - Responsibility layers, escalation philosophy
