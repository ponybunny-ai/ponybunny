# PonyBunny Service Management

## Overview

The `pb service` command provides unified management for all PonyBunny services:
- **Gateway** - WebSocket server for client connections
- **Scheduler** - Autonomous execution daemon
- **Debug Server** - Observability web UI
- **Web UI** - Main application interface

## Quick Start

```bash
# Start all services
pb service start all

# Check status
pb service status

# Stop all services
pb service stop all
```

## Commands

### `pb service status`

Show status of all services.

```bash
pb service status
```

Output:
```
╔═══════════════════════════════════════════════════════════════╗
║           PonyBunny Services Status                           ║
╚═══════════════════════════════════════════════════════════════╝

  Gateway:
    ✓ Running
    PID: 12345
    Address: ws://127.0.0.1:18789
    Uptime: 2h 15m
    Mode: background

  Scheduler:
    ✓ Running
    PID: 12346
    Uptime: 2h 15m

  Debug Server:
    ✓ Running
    PID: 12347
    Address: http://localhost:18790
    Uptime: 1h 30m

  Web UI:
    ✗ Not running
    Start: pb service start web
```

### `pb service start <service>`

Start a specific service or all services.

```bash
# Start individual services
pb service start gateway
pb service start scheduler
pb service start debug
pb service start web

# Start all services
pb service start all

# Start in foreground (for debugging)
pb service start gateway --foreground
```

Services:
- `gateway` - WebSocket server
- `scheduler` - Autonomous execution daemon
- `debug` - Debug server with web UI
- `web` - Main web UI dev server
- `all` - All services

### `pb service stop <service>`

Stop a specific service or all services.

```bash
# Stop individual services
pb service stop gateway
pb service stop scheduler
pb service stop debug
pb service stop web

# Stop all services
pb service stop all

# Force kill (SIGKILL)
pb service stop gateway --force
```

### `pb service restart <service>`

Restart a service.

```bash
pb service restart gateway
pb service restart scheduler
pb service restart all
```

### `pb service logs <service>`

View service logs.

```bash
# Show last 50 lines
pb service logs gateway

# Show last 100 lines
pb service logs gateway -n 100

# Follow logs (like tail -f)
pb service logs gateway -f

# Available services
pb service logs gateway
pb service logs scheduler
pb service logs debug
```

### `pb service ps`

Show detailed process information for all services.

```bash
pb service ps
```

Output:
```
╔═══════════════════════════════════════════════════════════════╗
║           PonyBunny Process Information                       ║
╚═══════════════════════════════════════════════════════════════╝

  Gateway:
    Status: Running
    PID: 12345
    Mode: background
    Started: 2026-02-08T10:30:00.000Z
    Uptime: 2h 15m 30s
    Address: ws://127.0.0.1:18789
    Database: /Users/user/.ponybunny/pony.db
    Log: /Users/user/.ponybunny/gateway.log

  Scheduler:
    Status: Running
    PID: 12346
    Mode: background
    Started: 2026-02-08T10:30:05.000Z
    Uptime: 2h 15m 25s
    Database: /Users/user/.ponybunny/pony.db
    Log: /Users/user/.ponybunny/scheduler.log

  Debug Server:
    Status: Running
    PID: 12347
    Mode: background
    Started: 2026-02-08T11:00:00.000Z
    Uptime: 1h 45m
    Address: http://localhost:18790
    Log: /Users/user/.ponybunny/debug-server.log

  Web UI:
    Status: Not running
```

## Service Details

### Gateway

The Gateway is the WebSocket server that handles client connections and message routing.

**Start:**
```bash
pb service start gateway
```

**Configuration:**
- Host: `127.0.0.1` (default)
- Port: `18789` (default)
- Database: `~/.ponybunny/pony.db`
- Log: `~/.ponybunny/gateway.log`

**Direct commands:**
```bash
pb gateway start              # Start in background
pb gateway start --foreground # Start in foreground
pb gateway start --daemon     # Start with auto-restart
pb gateway status             # Check status
pb gateway stop               # Stop
pb gateway logs -f            # Follow logs
```

### Scheduler

The Scheduler daemon executes goals autonomously.

**Start:**
```bash
pb service start scheduler
```

**Configuration:**
- Database: `~/.ponybunny/pony.db`
- IPC Socket: `~/.ponybunny/gateway.sock`
- Log: `~/.ponybunny/scheduler.log`

**Direct commands:**
```bash
pb scheduler start              # Start
pb scheduler start --foreground # Start in foreground
```

### Debug Server

The Debug Server provides real-time observability with a web UI.

**Start:**
```bash
pb service start debug
```

**Configuration:**
- Port: `18790` (default)
- Database: `~/.ponybunny/debug.db`
- Log: `~/.ponybunny/debug-server.log`

**Access:**
- Web UI: http://localhost:18790

**Direct commands:**
```bash
pb debug web                  # Start debug server with web UI
pb debug tui                  # Start debug TUI
```

### Web UI

The main application web interface (development server).

**Start:**
```bash
pb service start web
```

**Configuration:**
- Port: `3000` (default)

**Note:** Currently requires manual start:
```bash
cd web && npm run dev
```

## Typical Workflows

### Development

Start all services for development:

```bash
# Start backend services
pb service start gateway
pb service start scheduler

# Start debug server (optional)
pb service start debug

# Start web UI manually
cd web && npm run dev
```

### Production

Start all services in background:

```bash
# Start all services
pb service start all

# Check status
pb service status

# View logs
pb service logs gateway -f
```

### Debugging

View logs and status:

```bash
# Check what's running
pb service ps

# View gateway logs
pb service logs gateway -f

# View scheduler logs
pb service logs scheduler -f

# Check debug server
open http://localhost:18790
```

### Shutdown

Stop all services:

```bash
pb service stop all
```

## State Management

Service state is stored in `~/.ponybunny/services.json`:

```json
{
  "gateway": {
    "name": "gateway",
    "pid": 12345,
    "port": 18789,
    "host": "127.0.0.1",
    "startedAt": 1707389400000,
    "mode": "background",
    "dbPath": "/Users/user/.ponybunny/pony.db",
    "logFile": "/Users/user/.ponybunny/gateway.log"
  },
  "scheduler": {
    "name": "scheduler",
    "pid": 12346,
    "startedAt": 1707389405000,
    "mode": "background"
  }
}
```

## Troubleshooting

### Service won't start

Check if port is already in use:
```bash
lsof -i :18789  # Gateway
lsof -i :18790  # Debug Server
```

Check logs:
```bash
pb service logs gateway
```

### Service shows as running but isn't responding

Force stop and restart:
```bash
pb service stop gateway --force
pb service start gateway
```

### Stale PID files

Clean up manually:
```bash
rm ~/.ponybunny/services.json
rm ~/.ponybunny/gateway.pid
rm ~/.ponybunny/gateway-daemon.pid
```

### View all logs

```bash
tail -f ~/.ponybunny/*.log
```

## Integration with Existing Commands

The `pb service` command integrates with existing commands:

- `pb gateway start` → `pb service start gateway`
- `pb gateway stop` → `pb service stop gateway`
- `pb gateway status` → `pb service status` (shows all)
- `pb scheduler start` → `pb service start scheduler`
- `pb debug web` → `pb service start debug`

You can use either interface - they work together.

## Environment Variables

- `PONY_GATEWAY_HOST` - Gateway host (default: 127.0.0.1)
- `PONY_GATEWAY_PORT` - Gateway port (default: 18789)
- `PONY_DB_PATH` - Database path (default: ~/.ponybunny/pony.db)
- `DEBUG_SERVER_PORT` - Debug server port (default: 18790)

## See Also

- `pb gateway --help` - Gateway-specific commands
- `pb scheduler --help` - Scheduler-specific commands
- `pb debug --help` - Debug server commands
- `pb status` - System status
