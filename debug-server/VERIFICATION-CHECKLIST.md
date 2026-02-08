# Debug Server WebUI - Verification Checklist

## Pre-Deployment Verification

Use this checklist to verify the WebUI implementation before deploying to production.

### ✅ Build Verification

- [x] Next.js project builds without errors
  ```bash
  cd debug-server/webui && npm run build
  # Expected: ✓ Compiled successfully
  ```

- [x] TypeScript compilation passes
  ```bash
  cd debug-server/webui && npx tsc --noEmit
  # Expected: No errors
  ```

- [x] All routes generated correctly
  ```
  ✓ / (Overview)
  ✓ /goals (Goals List)
  ✓ /goals/[id] (Goal Detail)
  ✓ /events (Events Stream)
  ✓ /metrics (Metrics Dashboard)
  ```

### ✅ Development Testing

- [ ] Development server starts successfully
  ```bash
  cd debug-server/webui && npm run dev
  # Expected: Ready on http://localhost:3001
  ```

- [ ] Hot reload works
  - Make a change to any component
  - Verify page updates without full refresh

- [ ] All pages load without errors
  - Navigate to each page
  - Check browser console for errors

### ✅ API Integration Testing

- [ ] Debug server starts with WebUI
  ```bash
  pb debug web
  # Expected: Server running at http://localhost:18790
  ```

- [ ] Health endpoint responds
  ```bash
  curl http://localhost:18790/api/health
  # Expected: {"status":"ok","gatewayConnected":false,"eventCount":0}
  ```

- [ ] WebSocket connects
  - Open browser to http://localhost:18790
  - Check connection status indicator
  - Expected: "WebSocket: Connected"

### ✅ Real-time Features Testing

- [ ] Start Gateway in debug mode
  ```bash
  node dist/main.js --debug
  ```

- [ ] Gateway connection indicator updates
  - Expected: "Gateway: Connected" turns green

- [ ] Create test goal via main web UI
  - Expected: Event appears in debug WebUI immediately

- [ ] Events stream updates in real-time
  - Expected: New events appear without refresh

- [ ] Metrics update automatically
  - Wait 10 seconds
  - Expected: Metrics refresh

### ✅ UI/UX Testing

- [ ] Sidebar navigation works
  - Click each navigation item
  - Verify correct page loads

- [ ] Goal list displays correctly
  - Navigate to /goals
  - Verify goals appear with status badges

- [ ] Goal detail page works
  - Click on a goal
  - Verify work items and events load

- [ ] Events page displays stream
  - Navigate to /events
  - Verify events appear in chronological order

- [ ] Metrics page shows statistics
  - Navigate to /metrics
  - Verify metrics cards display data

### ✅ Responsive Design Testing

- [ ] Desktop view (1920x1080)
  - Sidebar visible
  - Content properly spaced

- [ ] Tablet view (768x1024)
  - Layout adjusts appropriately
  - Navigation accessible

- [ ] Mobile view (375x667)
  - Sidebar collapses or adapts
  - Content readable

### ✅ Dark Mode Testing

- [ ] Toggle dark mode (if theme switcher added)
  - All components render correctly
  - Colors are readable
  - No white flashes

### ✅ Error Handling Testing

- [ ] Gateway disconnects gracefully
  - Stop Gateway
  - Verify "Gateway: Disconnected" indicator
  - Verify WebSocket attempts reconnect

- [ ] Invalid goal ID
  - Navigate to /goals/invalid-id
  - Verify error handling or loading state

- [ ] Network error handling
  - Disconnect network
  - Verify appropriate error messages

### ✅ Performance Testing

- [ ] Large event list (1000+ events)
  - Generate many events
  - Verify UI remains responsive
  - Check memory usage

- [ ] Multiple goals (50+)
  - Create many goals
  - Verify list renders efficiently

- [ ] Long-running session
  - Leave WebUI open for 1+ hour
  - Verify no memory leaks
  - Verify WebSocket stays connected

### ✅ Browser Compatibility

- [ ] Chrome/Edge (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)

### ✅ CLI Integration Testing

- [ ] CLI detects built WebUI
  ```bash
  pb debug web
  # Expected: "✓ Using Next.js WebUI"
  ```

- [ ] CLI falls back to static HTML
  ```bash
  rm -rf debug-server/webui/.next
  pb debug web
  # Expected: "⚠ Next.js WebUI not built, using basic HTML interface"
  ```

- [ ] Custom port works
  ```bash
  pb debug web --web-port 3002
  # Expected: Server on port 3002
  ```

### ✅ Documentation Verification

- [ ] README.md is accurate
- [ ] QUICKSTART.md instructions work
- [ ] WEBUI-IMPLEMENTATION.md is complete
- [ ] Build script works
  ```bash
  ./debug-server/build-webui.sh
  ```

### ✅ Code Quality

- [x] TypeScript types are correct
- [x] No console errors in production build
- [x] Follows project conventions
- [x] Components are properly organized
- [x] Code is well-commented where needed

## Production Deployment Checklist

Before deploying to production:

- [ ] Run full test suite
- [ ] Verify all environment variables are set
- [ ] Test with production Gateway
- [ ] Monitor initial deployment for errors
- [ ] Verify WebSocket connections are stable
- [ ] Check performance metrics
- [ ] Ensure proper error logging

## Known Limitations

Document any known issues or limitations:

1. **Dynamic routes require Next.js server** - The `/goals/[id]` route requires Next.js to be running (not static export)
2. **WebSocket reconnection** - May take up to 30 seconds with exponential backoff
3. **Event buffering** - Only keeps last 1000 events in memory

## Support

If issues are found:

1. Check browser console for errors
2. Check debug server logs
3. Verify Gateway is running with `--debug` flag
4. Review documentation in `debug-server/` directory
5. Check network tab for failed API calls

## Sign-off

- [ ] All critical tests pass
- [ ] Documentation is complete
- [ ] Code is committed to repository
- [ ] Team has been notified
- [ ] Ready for production deployment

---

**Verified by:** _________________
**Date:** _________________
**Version:** 1.0.0
