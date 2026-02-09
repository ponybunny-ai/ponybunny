# OpenClaw System Prompt Analysis

## Overview

This document analyzes OpenClaw's system prompt architecture to inform PonyBunny's autonomous agent improvements.

## Key Components

### 1. System Prompt Structure (`src/agents/system-prompt.ts`)

OpenClaw uses a **modular, section-based system prompt** with three modes:
- **full**: All sections (main agent)
- **minimal**: Reduced sections for subagents (Tooling, Workspace, Runtime only)
- **none**: Just basic identity line

#### Core Sections (in order):

1. **Identity**: "You are a personal assistant running inside OpenClaw."

2. **Tooling**:
   - Lists available tools with descriptions
   - Tool names are case-sensitive
   - Includes core tools: read, write, edit, apply_patch, grep, find, ls, exec, process, web_search, web_fetch, browser, canvas, nodes, cron, message, gateway, agents_list, sessions_*, image
   - Dynamic tool summaries from config

3. **Tool Call Style**:
   - Default: don't narrate routine, low-risk tool calls
   - Narrate only when helpful: multi-step work, complex problems, sensitive actions
   - Keep narration brief and value-dense

4. **Safety**:
   - No independent goals (no self-preservation, replication, resource acquisition, power-seeking)
   - Prioritize safety and human oversight
   - Comply with stop/pause/audit requests
   - Never bypass safeguards or manipulate users

5. **OpenClaw CLI Quick Reference**: Command documentation

6. **Skills** (mandatory):
   - Before replying: scan `<available_skills>` descriptions
   - If exactly one skill applies: read its SKILL.md with `read` tool, then follow it
   - If multiple apply: choose most specific, then read/follow
   - If none apply: don't read any SKILL.md
   - **Constraint**: never read more than one skill up front; only read after selecting

7. **Memory Recall**:
   - Before answering about prior work/decisions/dates/people/preferences/todos: run memory_search on MEMORY.md + memory/*.md
   - Use memory_get to pull needed lines
   - Citations: include Source: <path#line> when helpful (unless disabled)

8. **OpenClaw Self-Update**: Only when user explicitly asks

9. **Model Aliases**: Prefer aliases for model overrides

10. **Workspace**: Working directory, treat as single global workspace

11. **Documentation**: OpenClaw docs path, mirror, source, community links

12. **Sandbox**: Sandbox runtime info (if enabled)

13. **User Identity**: Owner numbers (if configured)

14. **Current Date & Time**: Timezone info

15. **Workspace Files (injected)**: Project context files loaded by OpenClaw

16. **Reply Tags**: [[reply_to_current]], [[reply_to:<id>]] for native replies

17. **Messaging**:
    - Reply in current session → auto-routes to source channel
    - Cross-session → use sessions_send(sessionKey, message)
    - Never use exec/curl for messaging
    - message tool for proactive sends + channel actions

18. **Voice (TTS)**: TTS hints if configured

19. **Group Chat Context / Subagent Context**: Extra system prompt (if provided)

20. **Reactions**: Guidance for minimal/extensive reaction modes

21. **Reasoning Format**: <think>...</think> then <final>...</final> format (if enabled)

22. **Project Context**: Embedded context files (SOUL.md, etc.)

23. **Silent Replies**: Respond with ONLY: `{{SILENT_REPLY_TOKEN}}` when nothing to say

24. **Heartbeats**: Reply "HEARTBEAT_OK" to heartbeat polls if nothing needs attention

25. **Runtime**: Runtime info (agent, host, repo, os, node, model, channel, capabilities, thinking)

### 2. Skills System (`src/agents/skills/`)

**Skill Loading Precedence** (lowest to highest):
1. Extra dirs (from config)
2. Bundled skills (openclaw-bundled)
3. Managed skills (~/.openclaw/skills)
4. Workspace skills (./skills)

**Skill Metadata** (frontmatter):
- `command-dispatch`: "tool" for direct tool invocation
- `command-tool`: Tool name to invoke
- `command-arg-mode`: "raw" for argument passing
- `primaryEnv`: Primary environment (host/sandbox)
- `userInvocable`: Whether skill can be invoked by user commands
- `disableModelInvocation`: Exclude from model prompt

**Skill Prompt Format**:
```
<available_skills>
  <skill>
    <name>skill-name</name>
    <description>Brief description</description>
    <location>path/to/SKILL.md</location>
  </skill>
  ...
</available_skills>
```

**Skill Command Specs**:
- Sanitized command names (lowercase, alphanumeric + underscore)
- Max 32 characters
- De-duplicated with numeric suffixes
- Description max 100 characters

### 3. Tool System (`src/agents/pi-tools.ts`, `src/agents/openclaw-tools.ts`)

**Core Coding Tools** (from @mariozechner/pi-coding-agent):
- read, write, edit, grep, find, ls
- exec (with PTY support for TTY-required CLIs)
- process (background exec session management)
- apply_patch (multi-file patches, OpenAI models only)

**OpenClaw-Specific Tools**:
- browser: Control web browser
- canvas: Present/eval/snapshot Canvas
- nodes: List/describe/notify/camera/screen on paired nodes
- cron: Manage cron jobs and wake events (use for reminders)
- message: Send messages and channel actions
- gateway: Restart, apply config, run updates
- agents_list: List agent IDs allowed for sessions_spawn
- sessions_list: List other sessions (incl. sub-agents)
- sessions_history: Fetch history for another session
- sessions_send: Send message to another session
- sessions_spawn: Spawn sub-agent session
- session_status: Show status card (usage + time + Reasoning/Verbose/Elevated)
- image: Analyze image with configured image model
- web_search: Search web (Brave API)
- web_fetch: Fetch and extract readable content from URL

**Tool Policy System**:
- Global policy (tools.allow)
- Provider-specific policy (tools.byProvider)
- Agent-specific policy (agents.{agentId}.tools)
- Group/channel policy (groups.{groupId}.tools)
- Subagent policy (tools.subagents)
- Sandbox policy (sandbox.tools)
- Profile-based policy (tools.profile)
- Owner-only tools (require senderIsOwner=true)

**Tool Allowlist Resolution**:
1. Profile policy + alsoAllow
2. Provider profile policy + alsoAllow
3. Global policy
4. Global provider policy
5. Agent policy
6. Agent provider policy
7. Group policy
8. Sandbox policy
9. Subagent policy

**Tool Wrapping**:
- Abort signal support
- Before tool call hooks
- Parameter normalization (Claude Code compatibility)
- Schema patching for Claude/Gemini compatibility

### 4. MCP Integration (`src/acp/client.ts`)

OpenClaw uses **Agent Client Protocol (ACP)** for MCP integration:

```typescript
await client.initialize({
  protocolVersion: PROTOCOL_VERSION,
  clientCapabilities: {
    fs: { readTextFile: true, writeTextFile: true },
    terminal: true,
  },
  clientInfo: { name: "openclaw-acp-client", version: "1.0.0" },
});

const session = await client.newSession({
  cwd,
  mcpServers: [],
});
```

**Session Updates**:
- agent_message_chunk: Streaming text output
- tool_call: Tool invocation with title and status
- tool_call_update: Tool status updates
- available_commands_update: Dynamic command list

**Permission Handling**:
- requestPermission callback for tool approvals
- Options: allow_once, allow_always, deny
- Auto-approval for allow_once in client

### 5. Multi-Agent Coordination

**Session Management**:
- sessions_list: List all sessions with filters
- sessions_history: Fetch conversation history
- sessions_send: Send messages between sessions
- sessions_spawn: Create sub-agent sessions

**Sub-Agent Features**:
- Inherit parent session context
- Reduced system prompt (minimal mode)
- Sandboxed by default (no elevated/host access)
- Tool policy inheritance from parent
- Automatic ping on completion

**Agent Scope**:
- Agent ID resolution from session key
- Agent-specific tool policies
- Agent-specific configuration

## Key Insights for PonyBunny

### 1. Modular System Prompt Architecture
- Use section-based prompts that can be composed dynamically
- Support different prompt modes (full/minimal/none) for different agent phases
- Include runtime context (model, capabilities, environment)

### 2. Skills as First-Class Citizens
- Skills should be mandatory check before any action
- Read skill documentation dynamically (don't pre-load all)
- Support skill precedence (workspace > managed > bundled)
- Enable user-invocable skills via CLI commands

### 3. Comprehensive Tool System
- Separate core tools from domain-specific tools
- Support tool policies at multiple levels (global, agent, phase)
- Enable tool wrapping for cross-compatibility
- Include tool summaries in system prompt

### 4. Memory and Context Management
- Explicit memory recall instructions
- Citation support for traceability
- Project context file injection (SOUL.md equivalent)

### 5. Safety and Autonomy Balance
- Clear safety guidelines (no self-preservation, no goal drift)
- Explicit escalation paths
- Human oversight prioritization
- Audit compliance

### 6. Multi-Agent Coordination
- Session-based communication (not just message passing)
- Sub-agent spawning with context inheritance
- Tool policy inheritance
- Automatic completion notifications

### 7. Reasoning and Narration
- Default: don't narrate routine operations
- Narrate only when helpful (complex work, sensitive actions)
- Support structured reasoning format (<think>/<final>)
- Silent replies for no-op responses

## Recommended Adaptations for PonyBunny

### Phase 1: System Prompt Builder
1. Create `src/infra/prompts/system-prompt-builder.ts`
2. Implement section-based prompt composition
3. Support phase-specific prompts (intake, elaboration, planning, execution, etc.)
4. Include tool and skill listings

### Phase 2: Skills System
1. Create `src/infra/skills/` directory structure
2. Implement skill loader with precedence
3. Add skill registry to scheduler
4. Integrate skill invocation in ReAct loop

### Phase 3: Enhanced Tool System
1. Expand tool registry with OpenClaw-style tools
2. Add tool policy system (phase-based, budget-based)
3. Implement tool summaries for system prompt
4. Add MCP tool integration

### Phase 4: Multi-Agent Improvements
1. Add session-based communication between agents
2. Implement sub-agent spawning for complex tasks
3. Add context inheritance for sub-agents
4. Improve escalation with session history

### Phase 5: Memory and Context
1. Add memory search/recall capabilities
2. Implement project context file injection
3. Add citation support for traceability
4. Create SOUL.md equivalent for agent personality

## Next Steps

1. ✅ Complete this analysis document
2. Design PonyBunny system prompt structure
3. Implement system prompt builder module
4. Add skill and MCP support
5. Update agent execution with new prompts
6. Test and validate improvements
