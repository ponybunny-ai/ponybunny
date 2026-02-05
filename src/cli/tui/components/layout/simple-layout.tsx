/**
 * SimpleLayout - Layout container for simple mode
 */

import * as React from 'react';
import { Box, Text } from 'ink';
import { SimpleInputBar } from './simple-input-bar.js';
import { useGatewayContext } from '../../context/gateway-context.js';

export interface SimpleLayoutProps {
  children: React.ReactNode;
  onInputSubmit: (input: string) => void;
  inputFocus?: boolean;
}

export const SimpleLayout: React.FC<SimpleLayoutProps> = ({
  children,
  onInputSubmit,
  inputFocus = true,
}) => {
  const { connectionStatus } = useGatewayContext();

  // Connection status indicator
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

      {/* Simple Input Bar */}
      <SimpleInputBar onSubmit={onInputSubmit} focus={inputFocus} />
    </Box>
  );
};
