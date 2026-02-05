/**
 * Start TUI - Entry point for the TUI application
 */

import * as React from 'react';
import { render } from 'ink';
import { App } from './app.js';

export interface StartTuiOptions {
  url?: string;
  token?: string;
}

/**
 * Start the TUI application
 */
export async function startTui(options: StartTuiOptions = {}): Promise<void> {
  const { url = 'ws://127.0.0.1:18789', token } = options;

  const { waitUntilExit } = render(
    React.createElement(App, { url, token })
  );

  await waitUntilExit();
}
