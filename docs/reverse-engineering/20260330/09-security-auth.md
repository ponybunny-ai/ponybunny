# 09 - Security & Authentication

## 9.1 Authentication Architecture

PonyBunny uses Ed25519 challenge-response authentication for WebSocket connections, with automatic local bypass.

### Authentication Flows

#### Local Connections (Auto-Authenticate)

Connections from `127.0.0.1` or `::1` are automatically authenticated with full permissions `['read', 'write', 'admin']`. No challenge-response required.

Used by: TUI, local tools, debug dashboard.

#### New Client (Pairing Flow)

```
Client                                Gateway
  │                                      │
  │── auth.pair { token } ──────────────►│  Validate token against DB
  │◄── { challenge } ───────────────────│  Generate 32-byte random challenge
  │                                      │
  │── auth.verify { signature,          │
  │     publicKey, channelType } ───────►│  Verify Ed25519 signature
  │◄── { success, sessionId,           │  Create session, store public key
  │     permissions } ──────────────────│
```

#### Returning Client (Hello Flow)

```
Client                                Gateway
  │                                      │
  │── auth.hello { publicKey } ─────────►│  Check public key exists in DB
  │◄── { challenge } ───────────────────│  Generate challenge
  │                                      │
  │── auth.verify { signature } ────────►│  Verify signature
  │◄── { success, sessionId,           │  Resume session
  │     permissions } ──────────────────│
```

#### Direct Token Auth (Admin)

```
Client                                Gateway
  │                                      │
  │── auth.token { token } ─────────────►│  Validate admin token
  │◄── { success, sessionId,           │  Create session immediately
  │     permissions } ──────────────────│
```

### Security Parameters

| Parameter | Value |
|-----------|-------|
| Challenge size | 32 bytes (random hex) |
| Challenge TTL | 60 seconds |
| Key algorithm | Ed25519 |
| Signature size | 64 bytes |
| Public key size | 32 bytes |
| Token hash | SHA256 |
| Rate limit | 10 attempts per 60 seconds per connection |
| Auth timeout | 30 seconds (unauthenticated connections dropped) |

### Libraries

- `@noble/ed25519` — Ed25519 signature generation/verification
- `@noble/hashes` — SHA256 for token hashing

## 9.2 Permission Model

### Permission Levels

| Level | Capabilities |
|-------|-------------|
| `read` | Read data, subscribe to goals, view debug info |
| `write` | Create/modify/delete goals, send messages, approve permissions |
| `admin` | All of the above + manage permissions, view stats, prune data, system config |

Permission checking: method requires `ANY` of listed permissions (OR logic). `admin` satisfies any requirement.

### Session Data

```typescript
SessionData {
  id: string
  publicKey: string          // Ed25519 key, 'local:<ip>', or 'token:<id>'
  permissions: Permission[]
  connectedAt: number
  lastActivityAt: number
  metadata?: Record<string, unknown>
}
```

## 9.3 Connection Security

### Connection Limits

| Context | Limit |
|---------|-------|
| Remote connections per IP | 10 |
| Local connections | 512 |
| Auth timeout (unauthenticated) | 30 seconds |

**ADR-002 E4**: Auth config support for connection policies configurable through GatewayServer constructor.

### Heartbeat

| Parameter | Value |
|-----------|-------|
| Ping interval | 30 seconds |
| Pong timeout | 10 seconds |
| Protocol | WebSocket native ping/pong |

Connections that fail heartbeat are automatically disconnected.

### Pairing Token Storage

Tokens stored in SQLite with:
- `token_hash` (SHA256, never plaintext)
- `public_key` (linked after pairing)
- `permissions` (JSON array)
- `expires_at` (TTL)
- `revoked_at` (manual revocation)

## 9.4 Tool Permission System

### Three-Layer Responsibility Model

| Layer | Name | Behavior | Examples |
|-------|------|----------|---------|
| 1 | Autonomous | Agent executes freely | read_file, list_dir, search_code |
| 2 | Approval Required | Requires human approval before execution | execute_command, write_file, web_search |
| 3 | Forbidden | Never available to agents | Destructive system commands |

### Tool Risk Levels

| Risk | Description |
|------|-------------|
| `safe` | No side effects (reads, searches) |
| `moderate` | Reversible side effects (file writes, git ops) |
| `dangerous` | Irreversible side effects (shell exec, network) |
| `critical` | System-level impact |

### Per-Goal Tool Configuration

Each goal can have its own tool allowlist/blocklist:

```typescript
// RPC methods for managing goal tools:
goal.tools.init       // Initialize tool config
goal.tools.allow      // Add tool to allowlist
goal.tools.block      // Add tool to blocklist
goal.tools.setLayer   // Set responsibility layer per tool
goal.tools.filter     // Check which tools are allowed
```

### Permission Grants

Layer 2 tools require explicit approval. Grants are:
- Scoped per tool + goal combination
- Time-limited (TTL-based expiry)
- Cached in `permission_grants` table
- Automatically cleaned up on expiry

### Permission Request Flow

```
Agent needs Layer 2 tool
  → Create PermissionRequest (pending)
  → Emit event to Gateway
  → Human reviews request
    → permission.approve → grant created with TTL
    → permission.deny → request denied
  → Agent retries tool call (if approved)
```

## 9.5 Credential Management

### Storage

Credentials stored in `~/.config/ponybunny/credentials.json` (ILogger injected into credential loader — ADR-002):

```json
{
  "providers": {
    "anthropic-direct": { "enabled": true, "apiKey": "sk-ant-..." },
    "openai-direct": { "enabled": true, "apiKey": "sk-..." },
    "openai-compatible": { "enabled": false, "apiKey": "...", "baseUrl": "..." }
  }
}
```

### Resolution Priority

1. **Environment variables** (e.g., `ANTHROPIC_API_KEY`) — highest priority
2. **credentials.json** file
3. **Provider defaults**

### Test Isolation

Tests mock credential loading to prevent using real API keys:

```typescript
jest.mock('../../../src/infra/config/credentials-loader.js', () => ({
  getCachedEndpointCredential: jest.fn(() => null),
  clearCredentialsCache: jest.fn(),
}));
```

## 9.6 Audit Trail

### Comprehensive Logging

Every state mutation is recorded in `audit_logs`. ADR-002 introduces prefixed action naming convention (`{source}.{entity}.{verb}`):

```typescript
AuditLog {
  id: string              // UUID
  timestamp: number
  actor: string           // publicKey, 'system', 'daemon', 'agent'
  actor_type: string      // user, system, daemon, agent, scheduler, gateway
  action: string          // Prefixed: user.goal.submit, system.workitem.retry (ADR-002)
  entity_type: string     // goal, workitem, run, escalation, etc.
  entity_id: string
  old_value?: string      // JSON (previous state)
  new_value?: string      // JSON (new state)
  metadata?: string       // JSON (additional context)
  ip_address?: string
  user_agent?: string
}
```

### Audit Queries

Available via RPC:
- By entity, goal, actor, action, time range
- By action prefix (supports prefixed format queries)
- Statistics (counts by action, entity type, actor type)
- Pruning (delete logs older than N days, admin only)

## 9.7 OAuth Integration

### OpenAI OAuth

```bash
pb auth login    # Initiates OAuth flow
pb auth logout   # Revokes token
pb auth list     # Lists authenticated accounts
```

Token stored in `~/.config/ponybunny/auth.json`.

### Google Antigravity OAuth

```bash
pb auth antigravity login
pb auth antigravity list
pb auth antigravity remove <identifier>
```

Separate OAuth flow for Google Vertex AI / Antigravity services.

## 9.8 Environment Variable Security

### MCP Server Config

MCP configurations support environment variable expansion for secrets:

```json
{
  "headers": { "Authorization": "Bearer ${API_KEY}" }
}
```

Variables are resolved at runtime from the process environment.

### Debug Flag Isolation

Debug output gated behind `PONY_BUNNY_DEBUG=1` via helper functions — never direct `process.env` reads in feature modules:

```typescript
import { isPonyBunnyDebugEnabled } from '../infra/config/debug-flags.js';
if (isPonyBunnyDebugEnabled()) { logger.debug({}, '...'); }
```

**ADR-002**: All debug output now uses structured `ILogger` instead of `console.log`. Operational errors use `logger.error()` instead of `console.error()`.
