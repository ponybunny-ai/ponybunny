/**
 * MainLayout - Main layout container
 */

import * as React from 'react';
import { Box, Text } from 'ink';
import { InputBar } from './input-bar.js';
import { TabBar } from './tab-bar.js';
import { useGatewayContext } from '../../context/gateway-context.js';
import { useAppContext } from '../../context/app-context.js';

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
  const { state } = useAppContext();
  const summary = state.schedulerCapabilities?.capabilities.summary;
  const latestEventTs = state.events.length > 0 ? state.events[state.events.length - 1].timestamp : 0;
  const [trafficFrame, setTrafficFrame] = React.useState(0);
  const [isCommunicating, setIsCommunicating] = React.useState(false);

  React.useEffect(() => {
    if (!isCommunicating) {
      return;
    }

    const interval = setInterval(() => {
      setTrafficFrame((value) => (value + 1) % 4);
    }, 320);
    return () => clearInterval(interval);
  }, [isCommunicating]);

  React.useEffect(() => {
    if (connectionStatus !== 'connected') {
      setIsCommunicating(false);
      return;
    }

    if (state.activityStatus !== 'idle') {
      setIsCommunicating(true);
      return;
    }

    if (latestEventTs === 0) {
      setIsCommunicating(false);
      return;
    }

    setIsCommunicating(true);
    const timeout = setTimeout(() => {
      setIsCommunicating(false);
    }, 2000);

    return () => clearTimeout(timeout);
  }, [connectionStatus, state.activityStatus, latestEventTs]);

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
    <Box flexDirection="column" flexGrow={1}>
      {/* Minimal header */}
      <Box paddingX={1} alignItems="center">
        <Text bold color="cyan">PonyBunny</Text>
        <Text dimColor> | </Text>
        <Box flexGrow={1}>
          <Text dimColor wrap="truncate-end">
            Models: {summary?.totalModels ?? 0} | Providers: {summary?.totalProviders ?? 0} | Tools: {summary?.totalTools ?? 0} | MCP: {summary?.totalMCPServers ?? 0} | Skills: {summary?.totalSkills ?? 0} | Agents: {summary?.totalAgents ?? 0}
          </Text>
        </Box>
        <Text dimColor> | </Text>
        <Box>
          {renderConnectionStatus()}
          <Text dimColor> {connectionStatus}</Text>
        </Box>
        <Text dimColor> | </Text>
        <Text color={isCommunicating ? 'green' : 'gray'}>
          {isCommunicating ? ['◐', '◓', '◑', '◒'][trafficFrame] : '○'}
        </Text>
      </Box>

      {/* Main Content */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <TabBar />
        {children}
      </Box>

      {/* Input Bar */}
      <InputBar onSubmit={onInputSubmit} focus={inputFocus} />
    </Box>
  );
};
