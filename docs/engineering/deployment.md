# Deployment & Operations

## Docker Deployment

OpenClaw provides a production-ready `Dockerfile` based on `node:22-bookworm`.

### Build Process
1.  **Base Image**: `node:22-bookworm`.
2.  **Dependencies**: Installs `bun` (for build scripts) and `pnpm`.
3.  **Packages**: Supports custom APT packages via `OPENCLAW_DOCKER_APT_PACKAGES`.
4.  **Install**: `pnpm install --frozen-lockfile`.
5.  **Build**:
    - `pnpm build`: Compiles TypeScript backend to `dist/`.
    - `pnpm ui:build`: Bundles the React/Lit frontend.
6.  **Hardening**: Runs as non-root user `node` (uid 1000).

### Running the Container

```bash
docker run -d \
  -p 18789:18789 \
  -v openclaw-data:/home/node/.openclaw \
  -e DISCORD_BOT_TOKEN="your-token" \
  ghcr.io/openclaw/openclaw:latest
```

## Configuration Reference

OpenClaw is configured via `~/.openclaw/openclaw.json` or Environment Variables.

### Core Environment Variables

| Variable | Description |
| :--- | :--- |
| `OPENCLAW_GATEWAY_PORT` | Port to bind the Gateway (default: 18789). |
| `DISCORD_BOT_TOKEN` | Discord Bot Token. |
| `SLACK_BOT_TOKEN` | Slack Bot Token. |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token. |
| `OPENAI_API_KEY` | Key for OpenAI models. |
| `ANTHROPIC_API_KEY` | Key for Anthropic models. |

### Config File (`openclaw.json`)

```json
{
  "gateway": {
    "bind": "loopback", // or "lan", "tailnet"
    "auth": {
      "mode": "token",
      "token": "secret-access-token"
    }
  },
  "agents": {
    "model": "claude-3-opus",
    "thinking": "high"
  }
}
```

## Security Model

### Authentication
- **Token Auth**: Default for remote access. Clients must send `Authorization: Bearer <token>` (HTTP) or `auth: <token>` (WebSocket Handshake).
- **Tailscale**: Supports auto-auth via Tailscale identity headers when running in `tailnet` mode.

### Sandboxing
- **Docker Sandbox**: When `agents.defaults.sandbox.mode` is set to `non-main` (default for groups), agent code execution happens inside ephemeral Docker containers.
- **Permissions**: Agents have restricted access to filesystem and network based on `allowlist` policies in `openclaw.json`.
