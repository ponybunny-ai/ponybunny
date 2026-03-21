/**
 * WebSocket metadata storage using WeakMap to avoid monkey-patching ws objects.
 */

const connectionIds = new WeakMap<object, string>();

export function setWsConnectionId(ws: object, id: string): void {
  connectionIds.set(ws, id);
}

export function getWsConnectionId(ws: object): string | undefined {
  return connectionIds.get(ws);
}
