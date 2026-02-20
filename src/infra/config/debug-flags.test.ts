import { describe, expect, it } from '@jest/globals';
import {
  isAntigravityDebugEnabled,
  isDebugLoggingEnabled,
  isLegacyDebugEnabled,
  isPonyBunnyDebugEnabled,
} from './debug-flags.js';

describe('debug-flags', () => {
  it('enables primary debug switch only for PONY_BUNNY_DEBUG=1', () => {
    expect(isPonyBunnyDebugEnabled({ PONY_BUNNY_DEBUG: '1' })).toBe(true);
    expect(isPonyBunnyDebugEnabled({ PONY_BUNNY_DEBUG: 'true' })).toBe(false);
    expect(isPonyBunnyDebugEnabled({})).toBe(false);
  });

  it('keeps legacy switches for compatibility', () => {
    expect(isLegacyDebugEnabled({ DEBUG_MODE: 'true' })).toBe(true);
    expect(isLegacyDebugEnabled({ DEBUG_MODE: 'on' })).toBe(true);
    expect(isLegacyDebugEnabled({ PB_DEBUG: '1' })).toBe(true);
    expect(isLegacyDebugEnabled({ DEBUG_MODE: 'false' })).toBe(false);
  });

  it('treats global debug as primary plus legacy switches', () => {
    expect(isDebugLoggingEnabled({ PONY_BUNNY_DEBUG: '1' })).toBe(true);
    expect(isDebugLoggingEnabled({ PB_DEBUG: '1' })).toBe(true);
    expect(isDebugLoggingEnabled({})).toBe(false);
  });

  it('enables antigravity debug for dedicated or global switch', () => {
    expect(isAntigravityDebugEnabled({ PB_ANTIGRAVITY_DEBUG: '1' })).toBe(true);
    expect(isAntigravityDebugEnabled({ PONY_BUNNY_DEBUG: '1' })).toBe(true);
    expect(isAntigravityDebugEnabled({ PB_DEBUG: '1' })).toBe(true);
    expect(isAntigravityDebugEnabled({})).toBe(false);
  });
});
