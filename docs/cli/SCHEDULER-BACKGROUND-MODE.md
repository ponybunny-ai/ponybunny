# Scheduler Background Mode Implementation

## Overview

Implemented background mode for the Scheduler Daemon to fix the issue where `pb service start all` would get stuck waiting for the scheduler to complete.

## Problem

Previously, the scheduler only supported foreground mode, which caused:
- `pb service start all` to hang at the scheduler step
- Users had to manually run scheduler in a separate terminal
- No way to manage scheduler as a background service

## Solution

Implemented full background mode with process management, similar to the Gateway implementation:

### Features Implemented

1. **Background Mode (Default)**
   - Spawns scheduler as detached background process
   - Returns immediately after starting
   - Logs output to `~/.ponybunny/scheduler.log`

2. **PID File Management**
   - Tracks running scheduler process in `~/.ponybunny/scheduler.pid`
   - Prevents multiple instances from running
   - Stores process metadata (PID, start time, paths)

3. **Process Control**
   - Start/stop/status commands
   - Graceful shutdown with SIGTERM
   - Force kill option with SIGKILL
   - Automatic cleanup on exit

4. **Log Management**
   - Persistent logging to file
   - View logs with `pb scheduler logs`
   - Follow logs in real-time with `-f` flag
   - Configurable line count with `-n` option

## Commands

### Start Scheduler

```bash
# Start in background (default)
pb scheduler start

# Start in foreground (for debugging)
pb scheduler start --foreground

# Force start even if already running
pb scheduler start --force

# Start with debug mode
pb scheduler start --debug

# Custom database and socket paths
pb scheduler start --db ./my-db.db --socket ./my-socket.sock
```

### Stop Scheduler

```bash
# Graceful shutdown
pb scheduler stop

# Force kill
pb scheduler stop --force
```

### Check Status

```bash
pb scheduler status
```

**Output:**
```
Scheduler Daemon Status:

  Status: Running
  PID: 12346
  Mode: background
  Database: /Users/user/.ponybunny/pony.db
  Socket: /Users/user/.ponybunny/gateway.sock
  Started: 2026-02-08T10:00:00.000Z
  Uptime: 2h 15m 30s
  Log file: /Users/user/.ponybunny/scheduler.log
```

### View Logs

```bash
# Show last 50 lines (default)
pb scheduler logs

# Show last 100 lines
pb scheduler logs -n 100

# Follow logs in real-time
pb scheduler logs -f
```

## Integration with Service Management

The scheduler now integrates seamlessly with `pb service` commands:

```bash
# Start all services (no longer hangs!)
pb service start all

# Check all service status
pb service status

# Stop all services
pb service stop all

# View scheduler logs through service command
pb service logs scheduler -f
```

## File Locations

All scheduler files are stored in `~/.ponybunny/`:

| File | Purpose |
|------|---------|
| `scheduler.pid` | Process ID and metadata |
| `scheduler.log` | Scheduler output logs |
| `pony.db` | Main database (default) |
| `gateway.sock` | IPC socket for Gateway communication |

## Implementation Details

### Process Spawning

The background mode works by:

1. Spawning a detached child process with `pb scheduler start --foreground`
2. Setting `PONY_SCHEDULER_BACKGROUND=1` environment variable
3. Redirecting stdout/stderr to log file
4. Unreferencing the child process so parent can exit
5. Writing PID file for tracking

### PID File Format

```json
{
  "pid": 12346,
  "startedAt": 1707390000000,
  "dbPath": "/Users/user/.ponybunny/pony.db",
  "socketPath": "/Users/user/.ponybunny/gateway.sock",
  "mode": "background"
}
```

### Graceful Shutdown

The scheduler handles shutdown signals properly:

1. Receives SIGTERM or SIGINT
2. Stops accepting new work
3. Waits for current work to complete
4. Closes database connections
5. Removes PID file
6. Exits cleanly

## Testing

### Test Background Mode

```bash
# Start scheduler in background
pb scheduler start

# Verify it's running
pb scheduler status

# Check logs
pb scheduler logs

# Stop it
pb scheduler stop
```

### Test Service Integration

```bash
# Start all services
pb service start all

# Verify all are running
pb service status

# Should show:
# ✓ Gateway: Running
# ✓ Scheduler: Running
# ✓ Debug Server: Running
```

### Test Force Start

```bash
# Start scheduler
pb scheduler start

# Try to start again (should fail)
pb scheduler start

# Force start (stops old, starts new)
pb scheduler start --force
```

## Troubleshooting

### Scheduler Won't Start

```bash
# Check if already running
pb scheduler status

# View logs for errors
pb scheduler logs -n 100

# Force stop and restart
pb scheduler stop --force
pb scheduler start
```

### Stale PID File

If the scheduler crashes, the PID file may remain:

```bash
# Check status (will detect stale PID)
pb scheduler status

# Clean start
pb scheduler start --force
```

### View Real-Time Logs

```bash
# Follow logs to see what's happening
pb scheduler logs -f
```

## Code Changes

### Modified Files

1. **src/cli/commands/scheduler-daemon.ts**
   - Added PID file management functions
   - Implemented `runScheduler()` for foreground execution
   - Implemented `startBackground()` for background spawning
   - Enhanced `start` command with background mode
   - Implemented `stop` command with graceful shutdown
   - Implemented `status` command with uptime display
   - Implemented `logs` command with follow support

2. **src/cli/commands/service.ts**
   - Updated `stopService()` to use `pb scheduler stop` command
   - Ensures proper integration with unified service management

## Benefits

1. **Non-Blocking**: `pb service start all` returns immediately
2. **Manageable**: Full start/stop/status/logs control
3. **Reliable**: PID tracking prevents duplicate instances
4. **Observable**: Persistent logs for debugging
5. **Consistent**: Same UX as Gateway management

## Future Enhancements

Potential improvements:

- [ ] Daemon supervisor mode (auto-restart on crash)
- [ ] Health checks and monitoring
- [ ] Metrics collection
- [ ] Log rotation
- [ ] Multiple scheduler instances with load balancing

## Related Documentation

- [CLI Usage Guide](./CLI-USAGE.md)
- [Service Management](./SERVICE-MANAGEMENT-IMPLEMENTATION.md)
- [Scheduler Design](../techspec/scheduler-design.md)
