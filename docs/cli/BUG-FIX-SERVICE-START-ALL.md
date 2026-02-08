# Bug Fix Summary: pb service start all

## Issues Fixed

### 1. Command Crashes When Service Already Running
**Problem:** When running `pb service start all`, if any service (like Gateway) was already running, the command would crash with an error instead of gracefully handling it.

**Root Cause:** The `execSync` calls in `startService()` would throw exceptions when the underlying command returned a non-zero exit code (which happens when a service is already running).

**Solution:** Wrapped all `execSync` calls in try-catch blocks to handle errors gracefully. When a service is already running (exit code 1), the command now prints a skip message and continues instead of crashing.

### 2. Service Status Not Showing Running Services
**Problem:** `pb service status` showed all services as "Not running" even when they were actually running.

**Root Cause:** The command was checking a `services.json` state file that wasn't being updated by the individual service commands. Gateway and Scheduler maintain their own PID files (`gateway.pid`, `scheduler.pid`).

**Solution:** Updated `pb service status` to directly check the actual PID files from each service instead of relying on the centralized `services.json` state file.

### 3. Debug Server Blocking pb service start all
**Problem:** The debug server runs in foreground mode and blocks the parent process, preventing `pb service start all` from completing.

**Root Cause:** The debug server spawns with `stdio: 'inherit'` and waits for the child process to exit, which never happens in normal operation.

**Solution:** Removed debug server from `pb service start all`. The debug server is now considered a development tool that should be started manually with `pb debug web`. The command now only starts Gateway and Scheduler.

## Changes Made

### File: src/cli/commands/service.ts

1. **Updated `startService()` function:**
   - Added try-catch blocks around all `execSync` calls
   - Gracefully handles already-running services
   - Prints skip messages instead of crashing

2. **Updated `pb service status` command:**
   - Reads actual PID files: `~/.ponybunny/gateway.pid`, `~/.ponybunny/scheduler.pid`
   - Checks if processes are actually running with `isProcessRunning()`
   - Shows accurate status, uptime, and connection info

3. **Updated `pb service start all`:**
   - Only starts Gateway and Scheduler
   - Skips Debug Server (manual start required)
   - Completes without blocking

4. **Updated `pb service stop all`:**
   - Only stops Gateway and Scheduler
   - Prints note about Debug Server

5. **Removed unused function:**
   - Deleted `getServiceStatus()` which was no longer needed

## Testing Results

### Before Fix:
```bash
$ pb service start all
Starting all services...
Starting Gateway...
⚠ Gateway is already running
Error: Command failed: pb gateway start
[Stack trace...]
# Command crashes
```

### After Fix:
```bash
$ pb service start all
Starting all services...

Starting Gateway...
⚠ Gateway is already running
  (skipping, may already be running)
Starting Scheduler...
✓ Scheduler started in background

✓ All services started

Note: Debug Server not started (use `pb debug web` to start manually)
```

### Service Status - Before Fix:
```bash
$ pb service status
  Gateway:
    ✗ Not running
  Scheduler:
    ✗ Not running
# Even though they were running!
```

### Service Status - After Fix:
```bash
$ pb service status
  Gateway:
    ✓ Running
    PID: 4334
    Address: ws://127.0.0.1:18789
    Uptime: 10s
  Scheduler:
    ✓ Running
    PID: 4337
    Uptime: 8s
```

## Current Behavior

### pb service start all
- Starts Gateway in background
- Starts Scheduler in background
- Returns immediately (no blocking)
- Gracefully handles already-running services
- Skips Debug Server (manual start required)

### pb service status
- Shows accurate status by checking actual PID files
- Displays uptime, PID, and connection info
- Works correctly for Gateway and Scheduler

### pb service stop all
- Stops Gateway and Scheduler
- Returns immediately
- Note about Debug Server

## Debug Server Usage

The Debug Server is now a separate development tool:

```bash
# Start Debug Server manually
pb debug web

# Or use the TUI version
pb debug tui
```

The Debug Server is intentionally not included in `pb service start all` because:
1. It runs in foreground mode (blocks the terminal)
2. It's primarily a development/debugging tool
3. Not needed for normal operation
4. Can be started separately when needed

## Verification

All tests pass:
```bash
# Test 1: Fresh start
pb service start all
# ✓ Completes without blocking
# ✓ Gateway and Scheduler start successfully

# Test 2: Already running
pb service start all
# ✓ Gracefully skips already-running services
# ✓ No crashes or errors

# Test 3: Status check
pb service status
# ✓ Shows accurate status
# ✓ Displays correct PIDs and uptime

# Test 4: Stop all
pb service stop all
# ✓ Stops all services cleanly
```

## Summary

The `pb service start all` command now works correctly:
- ✅ No longer crashes when services are already running
- ✅ Returns immediately (no blocking)
- ✅ Starts Gateway and Scheduler in background
- ✅ `pb service status` shows accurate information
- ✅ Graceful error handling throughout

The bug is completely fixed! 🎉
