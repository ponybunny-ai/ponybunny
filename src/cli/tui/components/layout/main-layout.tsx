/**
 * MainLayout - Main layout container
 */

import * as React from 'react';
import { Box } from 'ink';
import { StatusBar } from './status-bar.js';
import { TabBar } from './tab-bar.js';
import { InputBar } from './input-bar.js';

export interface MainLayoutProps {
  children: React.ReactNode;
  onInputSubmit: (input: string) => void;
  inputFocus?: boolean;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
  children,
  onInputSubmit,
  inputFocus = true,
}) => {
  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <StatusBar />

      {/* Tab Bar */}
      <TabBar />

      {/* Main Content */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {children}
      </Box>

      {/* Input Bar */}
      <InputBar onSubmit={onInputSubmit} focus={inputFocus} />
    </Box>
  );
};
