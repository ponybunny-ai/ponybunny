# Protocol Specification

The OpenClaw Gateway communicates via a JSON-based WebSocket protocol.

**Endpoint**: `ws://<host>:<port>/` (Default port: 18789)

## Frame Structure

Every message is a JSON object with a `type` field.

### 1. Request (`req`)
Sent by Client to invoke a method on the Server.

```json
{
  "type": "req",
  "id": "unique-req-id",
  "method": "method.name",
  "params": { ... }
}
```

### 2. Response (`res`)
Sent by Server in response to a `req`.

```json
{
  "type": "res",
  "id": "unique-req-id",  // Matches the request ID
  "ok": true,             // or false
  "result": { ... },      // if ok=true
  "error": { ... }        // if ok=false
}
```

### 3. Event (`event`)
Unsolicited push from Server to Client.

```json
{
  "type": "event",
  "event": "event.name",
  "payload": { ... }
}
```

## Handshake Flow

1.  **Connection**: Client opens WebSocket connection.
2.  **Auth Request**: Client MUST send a `connect` request immediately.
    ```json
    {
      "type": "req",
      "id": "1",
      "method": "connect",
      "params": {
        "auth": "token",
        "clientName": "my-client"
      }
    }
    ```
3.  **Auth Response**: Server validates and responds.
    ```json
    {
      "type": "res",
      "id": "1",
      "ok": true,
      "result": { "hello": "ok", "version": "..." }
    }
    ```

## RPC Method Reference

| Method | Description |
| :--- | :--- |
| `agent` | Main entry point to run the AI loop. |
| `chat.send` | Send a message to a channel. |
| `chat.history` | Retrieve message history. |
| `nodes.invoke` | Execute a command on a connected node (e.g., `camera.snap`). |
| `config.get` | Retrieve Gateway configuration. |
| `config.apply` | Apply dynamic configuration changes. |
| `sessions.list` | List active sessions. |
| `health` | Get system health status. |

## Event Reference

| Event | Description |
| :--- | :--- |
| `chat` | New incoming chat message. |
| `agent` | Stream of agent activity (thoughts, partial text, tool calls). |
| `presence` | Updates to the list of connected nodes/clients. |
| `heartbeat` | Periodic aliveness check. |
| `shutdown` | Notification that the Gateway is stopping. |
