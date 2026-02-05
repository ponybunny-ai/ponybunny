/**
 * Debug TUI - Entry point for the debug/observability terminal UI
 */

import * as React from 'react';
import { render } from 'ink';
import { DebugApp } from './app.js';

export interface DebugTuiOptions {
  url?: string;
  token?: string;
}

export async function startDebugTui(options: DebugTuiOptions = {}): Promise<void> {
  const { waitUntilExit } = render(
    React.createElement(DebugApp, { url: options.url, token: options.token })
  );

  await waitUntilExit();
}
