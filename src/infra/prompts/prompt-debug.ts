import { isPonyBunnyDebugEnabled } from '../config/debug-flags.js';

export function isPromptDebugEnabled(): boolean {
  return isPonyBunnyDebugEnabled();
}

export function promptDebugLog(step: string, details: string): void {
  if (!isPromptDebugEnabled()) {
    return;
  }

  console.log(`[PromptDebug] ${step}: ${details}`);
}

export function promptDebugDump(title: string, prompt: string): void {
  if (!isPromptDebugEnabled()) {
    return;
  }

  console.log(`[PromptDebug] ${title} START`);
  console.log(prompt);
  console.log(`[PromptDebug] ${title} END`);
}
