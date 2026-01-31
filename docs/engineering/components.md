# Component Design

## 1. Gateway Server Internals

The Gateway Server (`src/gateway/server.impl.ts`) orchestrates the entire application.

### Startup Sequence
1.  **Bootstrap**: Load config, initialize logging (`createSubsystemLogger`).
2.  **State Creation**: Initialize `GatewayRuntimeState` (HTTP/WS servers, Client managers).
3.  **Plugin System**: Load internal and external plugins (`loadGatewayPlugins`).
4.  **Channel Manager**: Start the `ChannelManager` to handle messaging adapters.
5.  **Discovery**: Start mDNS/Bonjour services (`startGatewayDiscovery`).
6.  **Background Services**: Start Cron, Health Checks, and Maintenance timers.

### Runtime State
The `GatewayRuntimeState` object is passed around to handlers. It holds:
- `wss`: The WebSocket Server instance.
- `clients`: Map of connected WebSocket clients.
- `pluginRegistry`: Access to loaded plugins.
- `deps`: Dependency injection container (CLI tools, etc.).

## 2. Extension Architecture

Extensions allow adding new Channels (messaging platforms) or capabilities. They reside in `extensions/`.

### Anatomy of an Extension
A standard Node.js package with specific metadata.

- **`openclaw.plugin.json`**: Manifest file.
  ```json
  {
    "id": "whatsapp",
    "channels": ["whatsapp"]
  }
  ```
- **Entry Point (`index.ts`)**:
  Exports a default object implementing the `Plugin` interface.

### Registration Process
1.  Gateway scans `extensions/` for `openclaw.plugin.json`.
2.  Gateway imports the entry point specified in `package.json`.
3.  Gateway calls `plugin.register(api)`.
4.  Plugin calls `api.registerChannel(...)` to hook into the routing system.

## 3. Agent Runtime

The "Pi Agent" logic resides in `src/agents/`.

- **Loop**: The core loop (`pi-embedded-runner.ts`) handles the ReAct cycle.
- **Tools**: Tools are registered globally or per-session.
- **Sandboxing**: Code execution (if enabled) runs in Docker containers for safety.
