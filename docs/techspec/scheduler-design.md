# Scheduler Design

The Scheduler is the core brain of PonyBunny, acting as the Agent responsible for task orchestration.

## Scheduler Responsibilities (8-Phase Lifecycle)

| Phase | Scheduler Behavior |
|:------|:-------------------|
| **Clarify** | Analyze Goal, identify ambiguity, request clarification via Gateway |
| **Decompose** | Break Goal into Work Items DAG, identify dependencies |
| **Define Success** | Generate Verification Plan (tests, build, lint) per Work Item |
| **Select Model** | Simple tasks → cheap model; Complex → powerful model |
| **Select Lane** | Assign to appropriate concurrency Lane |
| **Monitor** | Track tokens, time, errors; detect stuck states |
| **Evaluate** | Run Quality Gates, determine if requirements met |
| **Retry** | On failure: switch strategy → switch model → escalate |

## Startup Initialization

- Load skills into the global registry (managed dir: `PONYBUNNY_SKILLS_DIR` or `~/.ponybunny/skills`)
- Initialize MCP integration and register MCP tools
- Emit startup logs with loaded skill counts

## Invocation Chain: Scheduler → Skills → Tools → OS Services

```
Scheduler (Agent)
    │
    ├──► Skill: "implement_login"
    │        ├──► Tool: read_file("src/auth/...")
    │        ├──► Tool: write_file("src/auth/login.ts", code)
    │        ├──► Tool: shell("npm test")
    │        └──► Tool: git("commit", "feat: add login")
    │
    ├──► Skill: "deploy_production"
    │        ├──► Tool: shell("docker build")
    │        ├──► OS Service: Get AWS credentials (requires permission)
    │        │        └──► Permission retry mechanism
    │        └──► Tool: shell("kubectl apply")
    │
    └──► Direct OS Service call
             └──► Open browser, send notification, access Keychain...
```

## Permission Acquisition Flow

```
Scheduler needs privileged operation
         │
         ▼
    Check permission cache
         │
    ┌────┴────┐
    │         │
  Has perm  No perm
    │         │
    ▼         ▼
  Execute   Request auth
              │
    ┌─────────┼─────────┐
    │         │         │
  sudo     OAuth    User confirm
    │         │         │
    └─────────┼─────────┘
              │
    ┌─────────┴─────────┐
    │                   │
  Success            Failure
    │                   │
    ▼                   ▼
  Cache perm        Retry (N times)
  Execute               │
                        ▼
                  Escalate to human
```

## Model Selection Strategy

The Scheduler selects LLM models based on task complexity:

| Task Type | Model Tier | Examples |
|:----------|:-----------|:---------|
| Simple | Cheap/Fast | Code formatting, simple refactors, documentation |
| Medium | Balanced | Feature implementation, bug fixes, test writing |
| Complex | Powerful | Architecture decisions, complex debugging, security analysis |

## Lane Selection

Work Items are assigned to execution lanes based on their characteristics:

| Lane | Purpose | Concurrency |
|:-----|:--------|:------------|
| **Main** | Primary execution path | Sequential |
| **Subagent** | Delegated subtasks | Parallel (limited) |
| **Cron** | Scheduled/recurring tasks | Background |
| **Session** | Interactive/long-running | Dedicated |

## Key Invariants

- Work Items form a DAG (no cycles)
- Status transitions follow state machine rules
- Budget cannot be exceeded without escalation
- Permission requests must have retry mechanism
