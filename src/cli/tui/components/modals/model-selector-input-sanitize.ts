import { stripMouseEscapeSequences } from '../layout/input-mouse-sanitize.js';

export function sanitizeModelSelectorQuery(value: string): string {
  return stripMouseEscapeSequences(value);
}
