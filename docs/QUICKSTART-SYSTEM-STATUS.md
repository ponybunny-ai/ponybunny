# Quick Start Guide - System Status Feature

## Prerequisites

The Gateway server must be running for the System Status page to work.

## Gateway Default Configuration

- **Host:** `127.0.0.1`
- **Port:** `18789` (not 8080!)
- **WebSocket URL:** `ws://localhost:18789`

## Starting the Gateway Server

### Option 1: Using CLI (Recommended)

```bash
# From project root
pb gateway start

# Check status
pb gateway status

# View logs
pb gateway logs -f
```

### Option 2: Using npm script

```bash
# From project root
npm run gateway:start
```

### Option 3: Direct execution

```bash
# Build first
npm run build

# Run Gateway
node dist/main.js
```

## Starting the Web UI

```bash
cd web
npm run dev
```

Open browser to: `http://localhost:3000/status`

## Verifying Gateway is Running

### Check Process
```bash
ps aux | grep gateway
```

### Check PID File
```bash
cat ~/.ponybunny/gateway.pid
```

### Check Port
```bash
lsof -i :18789
# or
netstat -an | grep 18789
```

### Test WebSocket Connection
```bash
# Using websocat (install: brew install websocat)
echo '{"type":"req","id":"1","method":"system.ping","params":{}}' | websocat ws://localhost:18789
```

## Troubleshooting

### Error: "ECONNREFUSED"

**Cause:** Gateway is not running

**Solution:**
```bash
# Start Gateway
pb gateway start

# Or check if it's running on a different port
lsof -i -P | grep LISTEN | grep node
```

### Error: "Connection timeout"

**Cause:** Gateway is not responding or firewall blocking

**Solution:**
```bash
# Check Gateway logs
pb gateway logs

# Restart Gateway
pb gateway stop
pb gateway start
```

### Error: "Port already in use"

**Cause:** Another process is using port 18789

**Solution:**
```bash
# Find process using the port
lsof -i :18789

# Kill the process (replace PID)
kill -9 <PID>

# Or use a different port
export GATEWAY_PORT=18790
pb gateway start
```

## Environment Variables

### For Gateway
```bash
export GATEWAY_HOST=127.0.0.1
export GATEWAY_PORT=18789
```

### For Web UI
```bash
export GATEWAY_URL=ws://localhost:18789
cd web && npm run dev
```

## Full System Startup

```bash
# 1. Start Gateway
pb gateway start

# 2. Start Scheduler (optional, for full features)
pb scheduler start

# 3. Verify services
pb service status

# 4. Start Web UI
cd web && npm run dev

# 5. Open browser
open http://localhost:3000/status
```

## Expected Behavior

### When Gateway is Running ✅
- Status page loads successfully
- Shows real-time system metrics
- Auto-refreshes every 5 seconds
- All tabs display data

### When Gateway is NOT Running ❌
- Error: "Failed to get system status"
- Details: "ECONNREFUSED" or "Connection timeout"
- Hint: "Make sure the Gateway server is running on ws://localhost:18789"

## Quick Test

```bash
# Terminal 1: Start Gateway
pb gateway start

# Terminal 2: Start Web UI
cd web && npm run dev

# Terminal 3: Test API directly
curl http://localhost:3000/api/system/status

# Browser: Open status page
open http://localhost:3000/status
```

## Success Indicators

✅ Gateway logs show: "🌐 PonyBunny Gateway Server Started"
✅ Gateway logs show: "Address: ws://127.0.0.1:18789"
✅ Web UI shows system metrics without errors
✅ Status page auto-refreshes every 5 seconds
✅ All 4 tabs (Overview, Processes, Network, Scheduler) load

## Common Issues

### Issue: Web UI shows old port (8080)
**Solution:** Clear browser cache or hard refresh (Cmd+Shift+R / Ctrl+Shift+R)

### Issue: Gateway starts but Web UI can't connect
**Solution:** Check if Gateway is listening on correct interface
```bash
# Gateway should show:
# Address: ws://127.0.0.1:18789

# If it shows 0.0.0.0:18789, update GATEWAY_URL:
export GATEWAY_URL=ws://127.0.0.1:18789
```

### Issue: "Permission denied" when starting Gateway
**Solution:** Check if port 18789 requires sudo or use a different port
```bash
# Use port > 1024 (no sudo required)
export GATEWAY_PORT=18789
pb gateway start
```

## Next Steps

After Gateway is running and status page works:

1. ✅ Verify all metrics are displaying correctly
2. ✅ Test auto-refresh functionality
3. ✅ Test manual refresh button
4. ✅ Check responsive layout on mobile/tablet
5. ✅ Start Scheduler to see full metrics
6. ✅ Monitor for any errors in browser console

## Support

If issues persist:
1. Check Gateway logs: `pb gateway logs -f`
2. Check Web UI console: Browser DevTools → Console
3. Verify Gateway port: `lsof -i :18789`
4. Test WebSocket connection: `websocat ws://localhost:18789`
