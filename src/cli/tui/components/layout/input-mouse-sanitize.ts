const MOUSE_EVENT_PATTERN = /(?:\u001b)?\[<\d+;\d+;\d+[mM]/g;

export function stripMouseEscapeSequences(value: string): string {
  return value.replace(MOUSE_EVENT_PATTERN, '');
}
