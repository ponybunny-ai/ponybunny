# Debug Server WebUI - Quick Start Guide

## Overview

The Debug Server now has a complete Next.js WebUI for real-time monitoring of PonyBunny system events, goals, and metrics.

## Quick Start

### Option 1: Use the CLI (Recommended)

```bash
# Build the WebUI first (one-time setup)
cd debug-server/webui
npm install
npm run build

# Start the debug server with WebUI
pb debug web
```

The browser will automatically open to http://localhost:18790

### Option 2: Development Mode

```bash
# Terminal 1: Start the debug server backend
cd debug-server/server
npx tsx src/index.ts

# Terminal 2: Start Next.js dev server
cd debug-server/webui
npm install
npm run dev
```

Access at http://localhost:3001 (dev server with hot reload)

### Option 3: Build Script

```bash
# From project root
./debug-server/build-webui.sh
pb debug web
```

## Features

### Pages

- **Overview** (`/`) - Dashboard with key metrics, recent events, and active goals
- **Goals** (`/goals`) - List all goals with status badges
- **Goal Detail** (`/goals/[id]`) - Detailed view with work items and related events
- **Events** (`/events`) - Real-time event stream
- **Metrics** (`/metrics`) - System performance statistics

### Real-time Updates

- WebSocket connection with auto-reconnect
- Live event streaming
- Connection status indicators (Gateway + WebSocket)
- Automatic metrics refresh every 10 seconds

### UI Features

- Dark mode support
- Responsive design
- Status badges with semantic colors
- Event categorization
- Collapsible event data

## Architecture

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Browser   │ ◄─────► │ Debug Server │ ◄─────► │   Gateway   │
│  (Next.js)  │  HTTP   │  (Node.js)   │   WS    │  (Main App) │
│             │   WS    │              │         │             │
└─────────────┘         └──────────────┘         └─────────────┘
                              │
                              ▼
                        ┌──────────┐
                        │ SQLite   │
                        │ (Events) │
                        └──────────┘
```

## API Endpoints

### REST
- `GET /api/health` - Server status
- `GET /api/events` - Query events with filters
- `GET /api/goals` - List goals
- `GET /api/goals/:id` - Goal details
- `GET /api/metrics` - Aggregated metrics

### WebSocket
- `ws://localhost:18790/ws` - Real-time event stream

## Configuration

### Environment Variables

```bash
GATEWAY_URL=ws://localhost:18789    # Gateway WebSocket URL
DEBUG_SERVER_PORT=18790             # HTTP/WebSocket port
DEBUG_DB_PATH=~/.ponybunny/debug.db # SQLite database path
```

### CLI Options

```bash
pb debug web \
  --host 127.0.0.1 \
  --port 18789 \
  --web-port 18790 \
  --debug-db ./debug.db
```

## Troubleshooting

### WebUI not found

If you see "⚠ Next.js WebUI not built", run:

```bash
cd debug-server/webui
npm install
npm run build
```

### Port already in use

Change the port:

```bash
pb debug web --web-port 3002
```

### Gateway not connecting

Ensure the Gateway is running:

```bash
node dist/main.js --debug
```

Check the Gateway URL matches:

```bash
pb debug web --host 127.0.0.1 --port 18789
```

## Development

### Project Structure

```
debug-server/webui/
├── src/
│   ├── app/              # Next.js pages
│   ├── components/       # React components
│   ├── lib/              # Utilities and API client
│   └── hooks/            # Custom React hooks
├── package.json
├── tsconfig.json
└── next.config.ts
```

### Adding New Features

1. **New Page**: Create file in `src/app/[name]/page.tsx`
2. **New Component**: Add to `src/components/[category]/`
3. **New API Call**: Extend `src/lib/api-client.ts`
4. **New Hook**: Add to `src/hooks/`

### Styling

Uses Tailwind CSS v4 with OKLCH color system matching the main web project.

Custom colors defined in `src/app/globals.css`.

## Testing

1. Start Gateway in debug mode:
   ```bash
   node dist/main.js --debug
   ```

2. Start Debug Server:
   ```bash
   pb debug web
   ```

3. Create test goals via main web UI

4. Verify:
   - Events appear in real-time
   - Goals are listed
   - Metrics update
   - Navigation works
   - Dark mode toggles

## Next Steps

Optional enhancements:
- Add event filtering UI
- Add metrics charts (recharts)
- Implement virtual scrolling for large lists
- Add export functionality (JSON/CSV)
- Add full-text search
- Add toast notifications

## Support

For issues or questions:
- Check `debug-server/webui/README.md`
- Review `debug-server/WEBUI-IMPLEMENTATION.md`
- Check debug server logs
- Verify Gateway is running with `--debug` flag
