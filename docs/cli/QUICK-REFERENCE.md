# PonyBunny CLI Quick Reference

## Service Management (Unified Interface)

```bash
# Status and Monitoring
pb service status              # Show all services status
pb service ps                  # Detailed process information
pb service logs <service> -f   # Follow service logs

# Start Services
pb service start gateway       # Start Gateway
pb service start scheduler     # Start Scheduler
pb service start debug         # Start Debug Server
pb service start web           # Start Web UI
pb service start all           # Start all services

# Stop Services
pb service stop gateway        # Stop Gateway
pb service stop all            # Stop all services
pb service stop gateway --force # Force kill

# Restart Services
pb service restart gateway     # Restart Gateway
pb service restart all         # Restart all services
```

## Gateway (WebSocket Server)

```bash
# Start/Stop
pb gateway start               # Start in background
pb gateway start --foreground  # Start in foreground
pb gateway start --daemon      # Start with auto-restart
pb gateway stop                # Stop
pb gateway stop --force        # Force kill

# Status and Info
pb gateway status              # Check status and connectivity
pb gateway ps                  # Process information
pb gateway logs -f             # Follow logs

# Authentication
pb gateway pair                # Generate pairing token
pb gateway tokens              # List active tokens
pb gateway revoke <tokenId>    # Revoke token

# TUI
pb gateway tui                 # Start Gateway TUI
```

## Scheduler (Autonomous Execution)

```bash
# Start/Stop
pb scheduler start             # Start scheduler
pb scheduler start --foreground # Start in foreground
pb scheduler start --debug     # Start with debug mode

# Logs
pb service logs scheduler -f   # Follow scheduler logs
```

## Debug Server (Observability)

```bash
# Start Debug Server
pb debug web                   # Start with web UI
pb debug web --no-open         # Don't open browser
pb debug web --web-port 3002   # Custom port

# Start Debug TUI
pb debug tui                   # Terminal UI
pb debug tui -h 127.0.0.1 -p 18789 # Custom gateway

# Logs
pb service logs debug -f       # Follow debug server logs
```

## Configuration

```bash
# Initialize
pb init                        # Initialize config files

# Configuration
pb config show                 # Show current config
pb config edit                 # Edit config file
pb config validate             # Validate config

# Authentication
pb auth login                  # Login to OpenAI
pb auth antigravity login      # Login to Antigravity (Google)
pb auth status                 # Check auth status

# Models
pb models list                 # List available models
pb models test                 # Test model connectivity
```

## System Status

```bash
pb status                      # System and auth status
pb service status              # All services status
pb service ps                  # Detailed process info
```

## Work Management

```bash
# Create work
pb work create "task description"
pb work create -f task.json

# List work
pb work list
pb work list --status pending

# Work details
pb work show <workId>
```

## Common Workflows

### Development Setup

```bash
# 1. Initialize
pb init

# 2. Configure authentication
pb auth login

# 3. Start services
pb service start gateway
pb service start scheduler

# 4. Check status
pb service status

# 5. Start debug server (optional)
pb service start debug
```

### Production Deployment

```bash
# Start all services
pb service start all

# Check status
pb service ps

# Monitor logs
pb service logs gateway -f
```

### Debugging

```bash
# Check what's running
pb service status

# View logs
pb service logs gateway -f
pb service logs scheduler -f

# Restart problematic service
pb service restart gateway

# Check debug UI
open http://localhost:18790
```

### Shutdown

```bash
# Stop all services
pb service stop all
```

## Environment Variables

```bash
# Gateway
export PONY_GATEWAY_HOST=127.0.0.1
export PONY_GATEWAY_PORT=18789
export PONY_DB_PATH=./pony.db

# Debug Server
export DEBUG_SERVER_PORT=18790
export DEBUG_DB_PATH=./debug.db

# Credentials
export ANTHROPIC_API_KEY=sk-ant-xxx
export OPENAI_API_KEY=sk-xxx
```

## File Locations

```bash
# Configuration
~/.ponybunny/credentials.json      # API keys
~/.ponybunny/llm-config.json       # LLM configuration
~/.ponybunny/debug-config.json     # Debug config

# State
~/.ponybunny/services.json         # Service state
~/.ponybunny/gateway.pid           # Gateway PID
~/.ponybunny/gateway-daemon.pid    # Daemon PID

# Logs
~/.ponybunny/gateway.log           # Gateway logs
~/.ponybunny/scheduler.log         # Scheduler logs
~/.ponybunny/debug-server.log      # Debug server logs

# Database
~/.ponybunny/pony.db               # Main database
~/.ponybunny/debug.db              # Debug database
```

## Service Ports

```
Gateway:       ws://127.0.0.1:18789
Debug Server:  http://localhost:18790
Web UI:        http://localhost:3000
```

## Help Commands

```bash
pb --help                      # Main help
pb service --help              # Service management help
pb gateway --help              # Gateway help
pb scheduler --help            # Scheduler help
pb debug --help                # Debug help
pb auth --help                 # Auth help
pb config --help               # Config help
```

## Troubleshooting

```bash
# Check if port is in use
lsof -i :18789                 # Gateway
lsof -i :18790                 # Debug Server

# View all logs
tail -f ~/.ponybunny/*.log

# Clean up stale state
rm ~/.ponybunny/services.json
rm ~/.ponybunny/*.pid

# Force stop all
pb service stop all --force

# Rebuild
npm run build
```

## Quick Tips

- Use `pb service status` to see everything at a glance
- Use `pb service logs <service> -f` to follow logs in real-time
- Use `pb service start all` to start everything at once
- Use `pb gateway start --daemon` for auto-restart on crash
- Use `pb debug web` to access the observability dashboard
- Check `~/.ponybunny/*.log` files for detailed logs
- Use `pb service ps` for detailed process information

## See Also

- Full documentation: `docs/cli/service-management.md`
- Implementation details: `docs/cli/SERVICE-MANAGEMENT-IMPLEMENTATION.md`
- Architecture: `docs/techspec/architecture-overview.md`
