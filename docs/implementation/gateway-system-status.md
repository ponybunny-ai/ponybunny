# Gateway System Status Implementation

## Overview

This document describes the implementation of the Gateway system status interface as specified in `docs/requirement/60-gateway-related.md`.

## Requirements Implemented

### 1. System Status Interface (✅ Completed)

Gateway exposes a comprehensive system status interface via RPC method `system.status` that returns:

- Operating system information (platform, type, release, version, architecture, hostname, uptime)
- Hardware information (CPU model, cores, speed, usage; memory total, free, used, usage percentage)
- Network interfaces (name, address, family, internal/external, MAC address)
- Process information (current Gateway process, Gateway daemon, Scheduler daemon)

### 2. Gateway Connection Information (✅ Completed)

The `system.status` endpoint includes detailed connection information:

- Total connections (authenticated + pending)
- Authenticated sessions count
- Pending connections count
- Connections grouped by IP address
- Daemon connection status
- Scheduler connection status

### 3. Backend Process Status (✅ Completed)

Gateway exposes status of backend processes:

- **Scheduler**: Connection status, state (status, active goals, last tick time, error count), metrics (goals processed, work items completed, average completion time)
- **Gateway Process**: PID, uptime, memory usage, CPU usage, socket path
- **Scheduler Process**: PID, uptime, memory usage, CPU usage, database path, socket path, mode (foreground/background)

### 4. Configuration File Monitoring (✅ Completed)

Gateway includes automatic configuration file monitoring with auto-restart capability:

- Monitors `credentials.json`, `llm-config.json`, `mcp-config.json` in `~/.ponybunny/`
- Debounced change detection (default 1000ms)
- Emits `config.changed` event on file modification
- Optional auto-restart on configuration change (controlled by `autoRestart` config flag)

## Architecture

### New Modules

#### 1. `src/gateway/system/system-info.ts`

System information collection module with functions:

- `getOSInfo()`: Operating system details
- `getCPUInfo()`: CPU model, cores, speed, usage
- `getMemoryInfo()`: Memory total, free, used, usage percentage
- `getHardwareInfo()`: Combined CPU and memory info
- `getNetworkInfo()`: Network interfaces
- `getProcessInfo()`: Current process stats
- `getSystemInfo()`: Complete system snapshot
- `getGatewayProcessInfo()`: Gateway daemon status from PID file
- `getSchedulerProcessInfo()`: Scheduler daemon status from PID file
- `getAllProcessInfo()`: All process information

#### 2. `src/gateway/config/config-watcher.ts`

Configuration file monitoring with features:

- File system watcher using Node.js `fs.watch()`
- Debounced change detection to avoid rapid-fire events
- Event emitter for `change` events
- Start/stop lifecycle management
- Helper function `createConfigWatcher()` for standard config directory

#### 3. `src/gateway/rpc/handlers/system-handlers.ts`

RPC handler registration for `system.status` endpoint:

- Collects system information
- Collects process information
- Collects Gateway connection stats
- Collects Scheduler state and metrics (if connected)
- Returns comprehensive `SystemStatusResponse`

### Modified Modules

#### 1. `src/gateway/gateway-server.ts`

- Added `enableConfigWatch` option to `GatewayServerDependencies`
- Added `configWatcher` instance and initialization
- Added `restartServer()` method for graceful restart
- Modified `stop()` to stop config watcher
- Integrated `registerSystemHandlers()` in handler registration

#### 2. `src/gateway/types.ts`

- Added `autoRestart?: boolean` to `GatewayConfig`

#### 3. `src/gateway/connection/connection-manager.ts`

- Extended `getStats()` to include `connectionsByIp: Record<string, number>`

## API Reference

### RPC Method: `system.status`

**Permissions**: `admin`

**Request**:
```json
{
  "type": "req",
  "id": "req_123",
  "method": "system.status",
  "params": {}
}
```

**Response**:
```json
{
  "type": "res",
  "id": "req_123",
  "result": {
    "timestamp": 1707654321000,
    "system": {
      "os": {
        "platform": "darwin",
        "type": "Darwin",
        "release": "23.2.0",
        "version": "Darwin Kernel Version 23.2.0",
        "arch": "arm64",
        "hostname": "macbook.local",
        "uptime": 123456
      },
      "hardware": {
        "cpu": {
          "model": "Apple M1",
          "cores": 8,
          "speed": 2400,
          "usage": 15.5
        },
        "memory": {
          "total": 17179869184,
          "free": 8589934592,
          "used": 8589934592,
          "usagePercent": 50.0
        }
      },
      "network": {
        "interfaces": [
          {
            "name": "en0",
            "address": "192.168.1.100",
            "family": "IPv4",
            "internal": false,
            "mac": "00:11:22:33:44:55"
          }
        ]
      },
      "process": {
        "pid": 12345,
        "uptime": 3600,
        "memory": {
          "rss": 104857600,
          "heapTotal": 52428800,
          "heapUsed": 41943040,
          "external": 1048576
        },
        "cpu": {
          "user": 1000000,
          "system": 500000
        }
      }
    },
    "processes": {
      "current": { /* same as system.process */ },
      "gateway": {
        "type": "gateway",
        "status": "running",
        "pid": 12345,
        "startedAt": 1707650721000,
        "socketPath": "/Users/user/.ponybunny/gateway.sock",
        "uptime": 3600,
        "memory": { /* ... */ },
        "cpu": { /* ... */ }
      },
      "scheduler": {
        "type": "scheduler",
        "status": "running",
        "pid": 12346,
        "startedAt": 1707650722000,
        "dbPath": "./pony.db",
        "socketPath": "/Users/user/.ponybunny/scheduler.sock",
        "mode": "background",
        "uptime": 3599,
        "memory": { /* ... */ },
        "cpu": { /* ... */ }
      }
    },
    "gateway": {
      "isRunning": true,
      "connections": {
        "total": 5,
        "authenticated": 4,
        "pending": 1,
        "byIp": {
          "127.0.0.1": 3,
          "192.168.1.50": 2
        }
      },
      "daemonConnected": false,
      "schedulerConnected": true
    },
    "scheduler": {
      "isConnected": true,
      "state": {
        "status": "running",
        "activeGoals": ["goal_123", "goal_456"],
        "lastTickAt": 1707654320000,
        "errorCount": 0
      },
      "metrics": {
        "goalsProcessed": 42,
        "workItemsCompleted": 156,
        "totalTokensUsed": 0,
        "averageCompletionTime": 45000
      }
    }
  }
}
```

## Configuration

### Enable Config Watching

```typescript
const gateway = new GatewayServer(
  {
    db,
    repository,
    enableConfigWatch: true,  // Enable config file monitoring
  },
  {
    autoRestart: true,  // Auto-restart on config change
  }
);
```

### Monitored Files

- `~/.ponybunny/credentials.json`
- `~/.ponybunny/llm-config.json`
- `~/.ponybunny/mcp-config.json`

### Events

```typescript
gateway.getEventBus().on('config.changed', (event) => {
  console.log(`Config changed: ${event.path} at ${event.timestamp}`);
});
```

## Testing

### Unit Tests

- `test/gateway/config-watcher.test.ts`: Config watcher functionality (6 tests, all passing)
- `test/gateway/system-info.test.ts`: System information collection (7 tests, all passing)

### Test Coverage

```bash
npm test -- test/gateway/config-watcher.test.ts
npm test -- test/gateway/system-info.test.ts
```

All tests passing ✅

## Usage Example

### Client-side (WebSocket)

```typescript
const ws = new WebSocket('ws://localhost:8080');

ws.onopen = () => {
  // Request system status
  ws.send(JSON.stringify({
    type: 'req',
    id: 'status_req_1',
    method: 'system.status',
    params: {}
  }));
};

ws.onmessage = (event) => {
  const frame = JSON.parse(event.data);
  if (frame.type === 'res' && frame.id === 'status_req_1') {
    const status = frame.result;
    console.log('System Status:', status);
    
    // Display OS info
    console.log(`OS: ${status.system.os.type} ${status.system.os.release}`);
    
    // Display CPU usage
    console.log(`CPU Usage: ${status.system.hardware.cpu.usage}%`);
    
    // Display memory usage
    console.log(`Memory Usage: ${status.system.hardware.memory.usagePercent}%`);
    
    // Display connections
    console.log(`Connections: ${status.gateway.connections.total}`);
  }
};
```

## Future Enhancements

1. **Historical Metrics**: Store system metrics over time for trend analysis
2. **Alerting**: Trigger alerts when metrics exceed thresholds
3. **Process Management**: Add ability to restart/stop processes via RPC
4. **Health Checks**: Add health check endpoint with pass/fail status
5. **Performance Profiling**: Add CPU profiling and memory heap snapshots

## Related Files

- `src/gateway/system/system-info.ts` - System information collection
- `src/gateway/config/config-watcher.ts` - Configuration file monitoring
- `src/gateway/rpc/handlers/system-handlers.ts` - RPC handler
- `src/gateway/gateway-server.ts` - Gateway server integration
- `test/gateway/config-watcher.test.ts` - Config watcher tests
- `test/gateway/system-info.test.ts` - System info tests
- `docs/requirement/60-gateway-related.md` - Original requirements
