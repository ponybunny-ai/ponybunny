# Antigravity Authentication System

## Overview

PonyBunny now supports **dual-provider authentication** for both OpenAI Codex and Google Antigravity (DeepMind AI). The implementation includes advanced features like health-based account rotation, rate limit recovery, and dual quota pool management.

## Architecture

### Core Components

1. **Account Types** (`src/cli/lib/account-types.ts`)
   - Provider-agnostic account interface with discriminated union
   - Supports both `CodexAccount` and `AntigravityAccount`
   - Health scores, rate limit tracking, device fingerprinting

2. **Account Trackers** (`src/cli/lib/account-trackers.ts`)
   - **HealthScoreTracker**: Monitors account health (success +1, rate limit -10, failure -20)
   - **TokenBucketTracker**: Client-side rate limiting (50 tokens max, refills 6/min)
   - Exponential backoff calculation for different error types

3. **Antigravity OAuth** (`src/cli/lib/antigravity-oauth.ts`)
   - OAuth 2.0 PKCE flow with Google endpoints
   - Project ID discovery via `/v1internal:loadCodeAssist`
   - State encoding/decoding for secure callback handling

4. **Rate Limit Handler** (`src/cli/lib/rate-limit.ts`)
   - Parses 429/503 responses
   - Detects: QUOTA_EXHAUSTED, RATE_LIMIT_EXCEEDED, MODEL_CAPACITY_EXHAUSTED
   - Dual quota pool tracking (Antigravity vs Gemini-CLI)

5. **Enhanced Account Manager** (`src/cli/lib/auth-manager-v2.ts`)
   - Hybrid rotation strategy (Health Score + Token Bucket + LRU)
   - Provider-specific token refresh
   - Automatic account switching on rate limits
   - Maintains backward compatibility

6. **Antigravity API Client** (`src/cli/lib/antigravity-client.ts`)
   - Supports production and sandbox endpoints
   - Automatic token refresh
   - User-Agent rotation for rate limit mitigation
   - Retry logic with exponential backoff

7. **Device Fingerprinting** (`src/cli/lib/device-fingerprint.ts`)
   - Generates unique device identifiers
   - Included in requests for rate limit mitigation

## Authentication Flow

### Antigravity OAuth (PKCE)

```bash
pb auth antigravity login [--project-id <id>]
```

**Flow:**
1. Generate PKCE code verifier and challenge
2. Open browser to Google OAuth consent page
3. User authenticates and grants permissions
4. Callback server captures authorization code
5. Exchange code for access and refresh tokens
6. Discover project ID (if not provided)
7. Store credentials in `~/.ponybunny/accounts.json`

**Scopes:**
- `https://www.googleapis.com/auth/cloud-platform`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`
- `https://www.googleapis.com/auth/cclog`
- `https://www.googleapis.com/auth/experimentsandconfigs`

## Multi-Account Management

### Account Rotation Strategies

1. **Stick** (Default for Codex)
   - Uses a single selected account
   - Good for prompt caching and context preservation

2. **Round-Robin**
   - Cycles through accounts sequentially
   - Simple load distribution

3. **Hybrid** (Default for Antigravity)
   - Combines health scores, token buckets, and LRU
   - Automatically switches on rate limits
   - Prefers healthy accounts with available tokens
   - Stickiness: Only switches if new account is 100+ points better

### Commands

```bash
# List all accounts (both Codex and Antigravity)
pb auth list

# List only Antigravity accounts
pb auth antigravity list

# Switch to specific account
pb auth switch user@example.com

# Remove account
pb auth antigravity remove user@example.com

# Set strategy
pb auth set-strategy hybrid
```

## Rate Limit Handling

### Detection

- **HTTP 429**: Too Many Requests
- **HTTP 503**: Service Unavailable
- **Error bodies**: "quota exhausted", "rate limit exceeded", "capacity"

### Backoff Strategy

| Error Type | Backoff Schedule |
|------------|------------------|
| QUOTA_EXHAUSTED | 1m → 5m → 30m → 2h |
| RATE_LIMIT_EXCEEDED | 30s |
| MODEL_CAPACITY_EXHAUSTED | 45s ± 15s jitter |
| SERVICE_UNAVAILABLE | 60s ± 30s jitter |

### Dual Quota Pools

For Gemini models, the system tracks TWO separate quota pools per account:
- **Antigravity Pool**: Uses antigravity headers
- **Gemini-CLI Pool**: Uses gemini-cli headers

This effectively doubles capacity by rotating header styles.

## API Endpoints

### Antigravity

**Base URLs:**
- Production: `https://cloudcode-pa.googleapis.com`
- Daily Sandbox (Default): `https://daily-cloudcode-pa.sandbox.googleapis.com`
- Autopush Sandbox: `https://autopush-cloudcode-pa.sandbox.googleapis.com`

**Endpoints:**
- Generate: `/v1internal:generateContent`
- Stream: `/v1internal:streamGenerateContent?alt=sse`
- Project Discovery: `/v1internal:loadCodeAssist`

### Environment Variables

```bash
# Use production endpoint
PB_ANTIGRAVITY_ENV=prod pb auth antigravity login

# Custom endpoint
PB_ANTIGRAVITY_ENDPOINT=https://custom-endpoint.com pb chat
```

## Available Models

### Gemini Models

**Available via Antigravity (tested and working):**

- **`gemini-2.5-flash`** ✅ Recommended
  - Fast, efficient model for most tasks
  - Lower latency and cost
  - Best for: Quick queries, simple tasks, high-volume usage

- **`gemini-2.5-pro`** ✅ Tested working  
  - More capable, higher quality responses
  - Better for: Complex reasoning, detailed explanations, creative tasks

### Claude Models (Antigravity Quota Pool)

⚠️ **Note:** Claude models may have quota limits. Check your account status if you receive quota errors.

- **`claude-sonnet-4-5`**
  - Balanced performance and speed
  - Good for general-purpose tasks

- **`claude-sonnet-4-5-thinking`**
  - Extended reasoning capabilities
  - Supports thinking budget variants: `low`, `high`, `max`

- **`claude-opus-4-5-thinking`**
  - Most capable Claude model
  - Best for complex problem-solving

**Note:** Model availability and quotas depend on your Google Cloud project configuration.

### Testing Model Availability

```bash
# Test a specific model via CLI
pb -m gemini-2.5-flash

# In TUI, press /model to select from available models
pb
/model
```

## Usage Examples

### Adding Multiple Accounts

```bash
# Add first Antigravity account
pb auth antigravity login

# Add second Antigravity account
pb auth antigravity login --project-id my-project-id

# Add OpenAI Codex account
pb auth login
```

### Account Selection

```typescript
// Hybrid strategy automatically selects best account
import { accountManagerV2 } from './lib/auth-manager-v2.js';

const account = await accountManagerV2.getCurrentAccount('antigravity');
// Returns: Account with highest health score and available tokens
```

### Making Requests

```typescript
import { antigravityClient } from './lib/antigravity-client.js';

const response = await antigravityClient.generateContent({
  model: 'gemini-2.5-flash',
  request: {
    contents: [
      {
        role: 'user',
        parts: [{ text: 'Explain quantum computing' }],
      },
    ],
    systemInstruction: {
      parts: [{ text: 'You are a helpful physics tutor.' }],
    },
  },
});

// Extract text from response
const text = response.response?.candidates?.[0]?.content?.parts
  ?.map(p => p.text)
  ?.join('');

// Automatic features:
// - Token refresh if expired
// - Rate limit detection
// - Account rotation on 429
// - Exponential backoff
// - User-Agent rotation
```

## Storage Structure

### accounts.json

```json
{
  "accounts": [
    {
      "id": "acc_1234_xyz",
      "provider": "codex",
      "email": "user@example.com",
      "accessToken": "eyJhbGc...",
      "refreshToken": "rt__...",
      "expiresAt": 1234567890,
      "addedAt": 1234567890,
      "lastUsed": 1234567890,
      "enabled": true,
      "healthScore": 0
    },
    {
      "id": "acc_5678_abc",
      "provider": "antigravity",
      "email": "user@gmail.com",
      "refreshToken": "1//...",
      "projectId": "my-project-id",
      "rateLimitResetTimes": {
        "claude": 1234567890,
        "gemini-antigravity": 1234567890,
        "gemini-cli": 1234567890
      },
      "fingerprint": {
        "userAgent": "antigravity/1.15.8 darwin/arm64",
        "platform": "darwin",
        "arch": "arm64",
        "nodeVersion": "v20.0.0"
      },
      "addedAt": 1234567890,
      "lastUsed": 1234567890,
      "enabled": true,
      "healthScore": 0
    }
  ],
  "strategy": "hybrid",
  "currentAccountId": "acc_1234_xyz",
  "roundRobinIndex": 0
}
```

## Health Score System

### Score Changes

| Event | Score Change |
|-------|--------------|
| Successful request | +1 |
| Rate limit (429) | -10 |
| Failed request | -20 |

### Score Decay

- Scores decay toward 0 over time
- +10 points per 5 minutes after last failure
- Min score: -1000, Max score: +1000

### Selection Logic

```typescript
1. Filter accounts: enabled && not rate limited && has tokens
2. Calculate effective score: healthScore + decayBonus
3. Sort by: token availability → health score → least recently used
4. Select best account (with stickiness threshold of 100 points)
```

## Token Bucket System

### Configuration

- **Capacity**: 50 tokens
- **Refill Rate**: 6 tokens per minute
- **Consumption**: 1 token per request

### Behavior

```typescript
if (tokenBucket.hasTokens(accountId, 1)) {
  tokenBucket.consumeTokens(accountId, 1);
  // Make request
} else {
  // Wait for refill or switch account
}
```

## Security Considerations

### Credential Storage

- Stored in `~/.ponybunny/accounts.json`
- File permissions: 0600 (user read/write only)
- Tokens encrypted at rest (TODO: implement encryption)

### Token Refresh

- Automatic refresh 60s before expiration
- Invalid grants remove account automatically
- Refresh failures trigger health score penalty

### Device Fingerprinting

- Rotated User-Agent strings for rate limit mitigation
- Platform-specific headers
- Randomized API client versions

## Troubleshooting

### "No healthy accounts available"

```bash
# Check account health
pb auth list

# Reset health scores
pb auth antigravity login  # Re-login to reset

# Check rate limit status
# Accounts show "Rate limited until: <timestamp>"
```

### "Token refresh failed"

```bash
# Remove and re-add account
pb auth antigravity remove user@gmail.com
pb auth antigravity login
```

### "Project ID not found"

```bash
# Manually specify project ID
pb auth antigravity login --project-id your-project-id
```

## Development

### Adding New Providers

1. Extend `AccountProvider` type in `account-types.ts`
2. Create provider-specific account interface
3. Implement OAuth flow in `src/cli/lib/<provider>-oauth.ts`
4. Update `AccountManagerV2` to handle new provider
5. Add CLI commands in `src/cli/commands/auth-<provider>.ts`

### Testing

```bash
# Build CLI
npm run build:cli

# Test OAuth flow
./dist/cli/index.js auth antigravity login

# List accounts
./dist/cli/index.js auth list

# Check health scores
./dist/cli/index.js auth status
```

## Backward Compatibility

- Existing Codex accounts automatically migrated
- Old `auth.json` format converted to new `accounts.json`
- Legacy commands still work: `pb auth login`, `pb auth logout`
- New multi-provider commands: `pb auth antigravity login`

## Future Enhancements

- [ ] Token encryption at rest
- [ ] Account health dashboard
- [ ] Automatic quota monitoring
- [ ] Multi-region endpoint support
- [ ] Account sync across devices
- [ ] Rate limit prediction
- [ ] Advanced retry policies
- [ ] Account grouping/tags

## References

- OpenCode Antigravity Auth: https://github.com/NoeFabris/opencode-antigravity-auth
- Google OAuth 2.0: https://developers.google.com/identity/protocols/oauth2
- PKCE RFC: https://tools.ietf.org/html/rfc7636
