# PonyBunny Debug WebUI

Modern Next.js-based web interface for the PonyBunny Debug Server.

## Features

- **Real-time Event Stream**: WebSocket-powered live updates
- **Goal Tracking**: View and monitor all goals and their work items
- **Metrics Dashboard**: System performance and usage statistics
- **Event Filtering**: Advanced filtering and search capabilities
- **Dark Mode**: Full dark mode support with OKLCH color system

## Development

```bash
# Install dependencies
npm install

# Start development server (requires debug server running on port 18790)
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Architecture

- **Next.js 16**: React framework with App Router
- **TypeScript**: Full type safety
- **Tailwind CSS v4**: Utility-first styling with OKLCH colors
- **Radix UI**: Accessible component primitives
- **WebSocket**: Real-time event streaming

## API Integration

The WebUI connects to the debug server API at `http://localhost:18790`:

- REST endpoints for data fetching
- WebSocket for real-time updates
- Automatic reconnection handling

## Pages

- `/` - Overview dashboard with key metrics and recent events
- `/goals` - List of all goals
- `/goals/[id]` - Detailed goal view with work items and events
- `/events` - Full event stream with filtering
- `/metrics` - System metrics and statistics
