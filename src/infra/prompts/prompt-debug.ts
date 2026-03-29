import { isPonyBunnyDebugEnabled } from '../config/debug-flags.js';
import type { ILogger } from '../observability/logger.js';
import { NoopLogger } from '../observability/logger.js';

export function isPromptDebugEnabled(): boolean {
  return isPonyBunnyDebugEnabled();
}

export function promptDebugLog(step: string, details: string, logger?: ILogger): void {
  const log = (logger ?? new NoopLogger()).child({ component: 'PromptDebug' });
  log.debug({ step }, details);
}

export function promptDebugDump(title: string, prompt: string, logger?: ILogger): void {
  const log = (logger ?? new NoopLogger()).child({ component: 'PromptDebug' });
  log.debug({ title, section: 'START' }, prompt);
}
