# Testing the System Status Implementation

## Prerequisites

1. **Gateway Server Running**
   ```bash
   # Start Gateway (from project root)
   pb gateway start
   # or
   pb service start gateway
   ```

2. **Scheduler Running (Optional but recommended)**
   ```bash
   # Start Scheduler
   pb scheduler start
   # or
   pb service start scheduler
   ```

3. **Verify Services**
   ```bash
   pb service status
   ```

## Testing Backend (Gateway RPC)

### Option 1: Using CLI (if available)
```bash
# Test system.status RPC method
pb debug # or use WebSocket client
```

### Option 2: Using WebSocket Client (Node.js)
```javascript
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:18789');

ws.on('open', () => {
  const request = {
    type: 'req',
    id: 'test-1',
    method: 'system.status',
    params: {}
  };
  ws.send(JSON.stringify(request));
});

ws.on('message', (data) => {
  console.log('Response:', JSON.parse(data.toString()));
});
```

### Option 3: Using curl + websocat
```bash
# Install websocat if not available
# brew install websocat (macOS)
# cargo install websocat (Rust)

echo '{"type":"req","id":"1","method":"system.status","params":{}}' | websocat ws://localhost:18789
```

## Testing Frontend (Web UI)

### 1. Start Web Development Server
```bash
cd web
npm run dev
```

### 2. Open Browser
Navigate to: `http://localhost:3000/status`

### 3. Expected Behavior

**If Gateway is Running:**
- ✅ Page loads successfully
- ✅ 4 summary cards show real data (CPU, Memory, Connections, Uptime)
- ✅ Overview tab shows OS, CPU, Memory, Gateway info
- ✅ Processes tab shows Gateway/Scheduler/Web UI process details
- ✅ Network tab shows network interfaces and connections by IP
- ✅ Scheduler tab shows scheduler state and metrics (if scheduler is running)
- ✅ Auto-refresh every 5 seconds
- ✅ Manual refresh button works

**If Gateway is NOT Running:**
- ❌ Error message: "Failed to get system status"
- ❌ Details: "Request timeout" or "Connection closed"
- ❌ Hint: "Make sure the Gateway server is running on ws://localhost:8080"

### 4. Test Scenarios

#### Scenario 1: Full System Running
```bash
# Start all services
pb service start all

# Open browser to http://localhost:3000/status
# Expected: All tabs show data, scheduler tab shows metrics
```

#### Scenario 2: Gateway Only
```bash
# Start only gateway
pb gateway start

# Open browser to http://localhost:3000/status
# Expected: System/Process/Network tabs work, Scheduler tab shows "Not Connected"
```

#### Scenario 3: No Services
```bash
# Stop all services
pb service stop all

# Open browser to http://localhost:3000/status
# Expected: Error message with hint to start Gateway
```

#### Scenario 4: Auto-Refresh
```bash
# Start gateway
pb gateway start

# Open browser to http://localhost:3000/status
# Wait 5 seconds
# Expected: "Last updated" timestamp changes automatically
```

#### Scenario 5: Manual Refresh
```bash
# Click the "Refresh" button
# Expected: Button shows spinning icon, data updates immediately
```

## Troubleshooting

### Issue: "Connection timeout"
**Cause:** Gateway server is not running or not accessible
**Solution:**
```bash
# Check if Gateway is running
pb gateway status

# Start Gateway if stopped
pb gateway start

# Check Gateway logs
pb gateway logs -f

# Verify Gateway is listening on correct port (18789)
lsof -i :18789
```

### Issue: "Scheduler Not Connected" in Scheduler tab
**Cause:** Scheduler is not running or not connected to Gateway
**Solution:**
```bash
# Check scheduler status
pb scheduler status

# Start scheduler
pb scheduler start

# Verify connection
pb service status
```

### Issue: "Failed to get system status" with "ECONNREFUSED"
**Cause:** Gateway is not listening on the expected port (default: 18789)
**Solution:**
```bash
# Check Gateway configuration
cat ~/.ponybunny/gateway.pid

# Verify Gateway is listening on port 18789
lsof -i :18789

# Set custom Gateway URL if needed
export GATEWAY_URL=ws://localhost:YOUR_PORT
cd web && npm run dev
```

### Issue: Page shows old data
**Cause:** Auto-refresh might be paused or browser tab is inactive
**Solution:**
- Click the "Refresh" button manually
- Check browser console for errors
- Verify Gateway is still running

### Issue: Network tab shows no connections
**Cause:** No active WebSocket connections to Gateway
**Solution:**
- This is normal if only the web UI is connected
- Try connecting another client (CLI, another browser tab)
- Check "Connections by IP" section for current connections

## Verifying Data Accuracy

### CPU Usage
```bash
# Compare with system monitor
top -l 1 | grep "CPU usage"
```

### Memory Usage
```bash
# Compare with system info
vm_stat | perl -ne '/page size of (\d+)/ and $size=$1; /Pages\s+([^:]+)[^\d]+(\d+)/ and printf("%-16s % 16.2f Mi\n", "$1:", $2 * $size / 1048576);'
```

### Process Info
```bash
# Check Gateway PID
cat ~/.ponybunny/gateway.pid

# Check process details
ps aux | grep <PID>
```

### Network Interfaces
```bash
# Compare with system network info
ifconfig
# or
ip addr show
```

## Performance Testing

### Load Test
```bash
# Open multiple browser tabs to http://localhost:3000/status
# Expected: All tabs update independently every 5 seconds
# Gateway should handle multiple concurrent connections
```

### Memory Leak Test
```bash
# Leave status page open for 1 hour
# Check browser memory usage in Task Manager/Activity Monitor
# Expected: Memory usage should remain stable (no continuous growth)
```

## Production Deployment

### Environment Variables
```bash
# Set Gateway URL for production
export GATEWAY_URL=ws://your-gateway-server:18789

# Build web app
cd web
npm run build

# Start production server
npm start
```

### Nginx Reverse Proxy (Optional)
```nginx
location /api/system/status {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
}
```

## Success Criteria

✅ All 4 tabs load without errors
✅ Real-time data updates every 5 seconds
✅ Manual refresh works instantly
✅ Responsive layout on mobile/tablet/desktop
✅ Status badges show correct colors (green=running, red=stopped)
✅ Process memory values are reasonable (< 500MB for each process)
✅ CPU usage percentage is between 0-100%
✅ Network interfaces show valid IP addresses
✅ Connections by IP shows at least 1 connection (the web UI itself)
✅ Scheduler metrics show when scheduler is running
✅ Error handling works when Gateway is stopped

## Next Steps

After successful testing:
1. ✅ Verify all requirements from `docs/requirement/60-gateway-related.md`
2. ✅ Update documentation with screenshots
3. ✅ Create user guide for system monitoring
4. ✅ Set up alerts for critical metrics (optional)
5. ✅ Deploy to production environment
