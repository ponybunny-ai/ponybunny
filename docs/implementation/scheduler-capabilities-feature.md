# Scheduler Capabilities Feature Implementation

## Overview

Successfully implemented comprehensive capabilities information display in the System Status page, showing all loaded models, providers, tools, MCP servers, and skills that the Scheduler has access to.

## Requirements

From user request: "scheduler里的状态信息需要包括models，providers，tools，mcps，skills等这些当前scheduler加载的和注册的各种能力。"

## Implementation Summary

### Backend Implementation

#### 1. New Module: Scheduler Capabilities (`src/infra/scheduler/capabilities.ts`)

Created a comprehensive capabilities collection module with the following functions:

**Data Structures:**
- `ModelInfo` - Model name, display name, endpoints, capabilities, cost, context size
- `ProviderInfo` - Provider name, protocol, enabled status, priority, base URL
- `ToolInfo` - Tool name, category, risk level, approval requirement, description
- `MCPServerInfo` - Server name, enabled status, transport, command/URL, allowed tools
- `SkillInfo` - Skill name, source, version, description, phases, tags
- `SchedulerCapabilities` - Aggregates all above with summary counts

**Functions:**
- `getModelsInfo()` - Loads from `llm-config.json`, returns all configured models
- `getProvidersInfo()` - Loads from `llm-config.json`, returns all endpoints/providers
- `getToolsInfo(toolRegistry)` - Gets all registered tools from ToolRegistry
- `getMCPServersInfo()` - Loads from `mcp-config.json`, returns all MCP servers
- `getSkillsInfo()` - Gets all loaded skills from SkillRegistry
- `getSchedulerCapabilities(toolRegistry)` - Aggregates all capabilities with summary

#### 2. Updated System Handlers (`src/gateway/rpc/handlers/system-handlers.ts`)

**Changes:**
- Added `SchedulerCapabilities` to `SystemStatusResponse.scheduler`
- Added optional `getToolRegistry` parameter to `registerSystemHandlers()`
- Calls `getSchedulerCapabilities()` when scheduler is connected
- Returns capabilities in `system.status` RPC response

#### 3. Updated Gateway Server (`src/gateway/gateway-server.ts`)

**Changes:**
- Passes `toolRegistry` to `registerSystemHandlers()`
- Enables capabilities collection when system status is requested

### Frontend Implementation

#### 1. Updated Types (`web/src/types/system-status.ts`)

Added complete TypeScript interfaces:
- `SchedulerCapabilities`
- `ModelInfo`
- `ProviderInfo`
- `ToolInfo`
- `MCPServerInfo`
- `SkillInfo`

#### 2. Updated Status Page (`web/src/app/status/page.tsx`)

**New UI Components in Scheduler Tab:**

**Capabilities Summary Card:**
- 5-column grid showing total counts
- Models, Providers, Tools, MCP Servers, Skills

**Models Card:**
- Lists all configured models
- Shows display name, model ID, context size, cost per 1K tokens
- Scrollable list (max-height: 256px)

**Providers Card:**
- Lists all LLM providers/endpoints
- Shows enabled/disabled status, protocol, priority
- Color-coded badges (enabled=outline, disabled=secondary)

**Tools Card:**
- Lists all registered tools
- Shows risk level with color-coded badges (safe=outline, moderate=secondary, dangerous=destructive)
- Displays category and approval requirement

**MCP Servers Card:**
- Lists all configured MCP servers
- Shows enabled/disabled status, transport type, allowed tools count
- Scrollable list

**Skills Card:**
- Lists all loaded skills
- Shows skill name, version, source
- Displays tags as badges
- 2-column grid layout

## Data Flow

```
User opens /status page
  ↓
Frontend calls /api/system/status
  ↓
API route connects to Gateway (ws://localhost:18789)
  ↓
Gateway calls system.status RPC handler
  ↓
Handler checks if Scheduler is connected
  ↓
If connected, calls getSchedulerCapabilities(toolRegistry)
  ↓
Capabilities module loads from:
  - llm-config.json (models, providers)
  - ToolRegistry (tools)
  - mcp-config.json (MCP servers)
  - SkillRegistry (skills)
  ↓
Returns aggregated capabilities
  ↓
Frontend displays in Scheduler tab
```

## Files Created/Modified

### Backend (3 files)
1. **Created:** `src/infra/scheduler/capabilities.ts` (217 lines)
   - Complete capabilities collection module

2. **Modified:** `src/gateway/rpc/handlers/system-handlers.ts`
   - Added capabilities to response
   - Added toolRegistry parameter

3. **Modified:** `src/gateway/gateway-server.ts`
   - Passes toolRegistry to system handlers

### Frontend (2 files)
1. **Modified:** `web/src/types/system-status.ts`
   - Added capabilities type definitions

2. **Modified:** `web/src/app/status/page.tsx`
   - Added capabilities display UI (150+ lines)

## UI Features

### Capabilities Summary
- **Visual:** 5-column grid with large numbers
- **Data:** Total counts for each capability type
- **Purpose:** Quick overview of scheduler capabilities

### Detailed Lists
- **Models:** Name, cost, context size
- **Providers:** Protocol, enabled status, priority
- **Tools:** Category, risk level, approval requirement
- **MCP Servers:** Transport, enabled status, tool count
- **Skills:** Source, version, tags

### Design Elements
- Scrollable lists (max 256px height) for long lists
- Color-coded badges for status/risk levels
- Consistent card-based layout
- Responsive grid (1 column mobile, 2 columns desktop)

## Example Output

### Capabilities Summary
```
Models: 8
Providers: 4
Tools: 12
MCP Servers: 3
Skills: 5
```

### Models Example
```
Claude Opus 4.5
- claude-opus-4-5
- 200,000 tokens
- $0.015/$0.075 per 1K

Claude Sonnet 4.5
- claude-sonnet-4-5
- 200,000 tokens
- $0.003/$0.015 per 1K
```

### Providers Example
```
anthropic-direct
- anthropic protocol
- Priority: 1
- Status: Enabled

openai-direct
- openai protocol
- Priority: 1
- Status: Enabled
```

### Tools Example
```
read_file
- filesystem
- Risk: safe
- No approval required

execute_command
- shell
- Risk: dangerous
- Requires approval
```

### MCP Servers Example
```
filesystem
- stdio transport
- Status: Enabled
- 5 tool(s)

github
- http transport
- Status: Enabled
- 10 tool(s)
```

### Skills Example
```
backend-developer
- v1.0.0
- Source: user
- Tags: backend, api, database
```

## Testing

### Build Status
- ✅ Backend build successful
- ✅ Frontend build successful
- ✅ No TypeScript errors
- ✅ No LSP errors

### Test Scenarios

**Scenario 1: Scheduler Connected**
```bash
# Start Gateway and Scheduler
pb gateway start --foreground
pb scheduler start --foreground

# Open status page
open http://localhost:3000/status
```

**Expected:**
- ✅ Scheduler tab shows "Connected"
- ✅ Capabilities summary displays counts
- ✅ All capability cards show data
- ✅ Models list shows configured models
- ✅ Providers list shows enabled endpoints
- ✅ Tools list shows registered tools
- ✅ MCP servers list shows configured servers
- ✅ Skills list shows loaded skills

**Scenario 2: Scheduler Not Connected**
```bash
# Start only Gateway
pb gateway start --foreground

# Open status page
open http://localhost:3000/status
```

**Expected:**
- ✅ Scheduler tab shows "Not Connected"
- ✅ No capabilities information displayed
- ✅ Shows message to start scheduler

## Configuration Files Used

The capabilities module reads from:

1. **`~/.ponybunny/llm-config.json`**
   - Models configuration
   - Providers/endpoints configuration

2. **`~/.ponybunny/mcp-config.json`**
   - MCP server configurations

3. **ToolRegistry (in-memory)**
   - Registered tools from Gateway

4. **SkillRegistry (in-memory)**
   - Loaded skills from Scheduler

## Benefits

### For Users
- **Visibility:** See exactly what capabilities are available
- **Debugging:** Quickly identify missing models/tools/skills
- **Configuration:** Verify config files are loaded correctly
- **Monitoring:** Track which providers are enabled

### For Developers
- **Diagnostics:** Debug capability loading issues
- **Validation:** Verify all components are registered
- **Documentation:** Self-documenting system capabilities

## Future Enhancements

1. **Search/Filter:** Add search box to filter capabilities
2. **Details Modal:** Click to see full details of each capability
3. **Health Status:** Show connection status for each provider
4. **Usage Stats:** Track which models/tools are most used
5. **Cost Tracking:** Show actual costs per model
6. **Refresh Button:** Reload capabilities without page refresh
7. **Export:** Export capabilities as JSON/CSV

## Related Issues Fixed

- ✅ Scheduler connection detection (separate process mode)
- ✅ Gateway port corrected to 18789
- ✅ System status RPC handler complete

## Documentation

- Implementation: `docs/implementation/scheduler-capabilities-feature.md` (this file)
- Bugfix: `docs/bugfix/scheduler-connection-detection.md`
- Quick Start: `docs/QUICKSTART-SYSTEM-STATUS.md`

## Status

✅ **Complete** - All capabilities information now displayed in System Status page
✅ **Tested** - Builds successful, no errors
✅ **Ready** - Ready for use

---

**To see the new capabilities display:**
1. Start Gateway: `pb gateway start --foreground`
2. Start Scheduler: `pb scheduler start --foreground`
3. Start Web UI: `cd web && npm run dev`
4. Open browser: `http://localhost:3000/status`
5. Click "Scheduler" tab
6. Scroll down to see "Capabilities Summary" and detailed lists
