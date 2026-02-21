/**
 * MainLayout - Main layout container
 */

import * as React from 'react';
import { Box, Text } from 'ink';
import { InputBar } from './input-bar.js';
import { useGatewayContext } from '../../context/gateway-context.js';

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
  const { connectionStatus } = useGatewayContext();

  const renderConnectionStatus = () => {
    switch (connectionStatus) {
      case 'connected':
        return <Text color="green">●</Text>;
      case 'connecting':
        return <Text color="yellow">○</Text>;
      case 'disconnected':
      case 'error':
        return <Text color="red">●</Text>;
      default:
        return <Text dimColor>○</Text>;
    }
  };

  return (
    <Box flexDirection="column" height="100%">
      {/* Minimal header */}
      <Box paddingX={1} justifyContent="space-between">
        <Text bold color="cyan">PonyBunny</Text>
        <Box>
          {renderConnectionStatus()}
          <Text dimColor> {connectionStatus}</Text>
        </Box>
      </Box>

      {/* Main Content */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {children}
      </Box>

      {/* Input Bar */}
      <InputBar onSubmit={onInputSubmit} focus={inputFocus} />
    </Box>
  );
};
