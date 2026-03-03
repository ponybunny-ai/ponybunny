/**
 * MainLayout - Main layout container
 */

import * as React from 'react';
import { Box, Text } from 'ink';
import { InputBar } from './input-bar.js';
import { TabBar } from './tab-bar.js';
import { useGatewayContext } from '../../context/gateway-context.js';
import { useAppContext } from '../../context/app-context.js';
import { loadRuntimeConfig } from '../../../../infra/config/runtime-config.js';

export interface MainLayoutProps {
  children: React.ReactNode;
  onInputSubmit: (input: string) => void;
  inputFocus?: boolean;
  showInputBar?: boolean;
  footerStatus: string;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
  children,
  onInputSubmit,
  inputFocus = true,
  showInputBar = true,
  footerStatus,
}) => {
  const { connectionStatus } = useGatewayContext();
  const { state } = useAppContext();
  const runtimeConfig = loadRuntimeConfig();
  const summary = state.schedulerCapabilities?.capabilities.summary;
  const preferredModel = state.schedulerCapabilities?.capabilities.models?.[0]?.name;
  const selectedModel = state.selectedModel || preferredModel || null;
  const activeSessionLabel = state.activeSessionId
    ? `${state.activeSessionTitle || 'untitled'} (${state.activeSessionId.slice(0, 8)})`
    : 'none';
  const latestEventTs = state.events.length > 0 ? state.events[state.events.length - 1].timestamp : 0;
  const [trafficFrame, setTrafficFrame] = React.useState(0);
  const [isCommunicating, setIsCommunicating] = React.useState(false);
  const inputModeLabel = runtimeConfig.tui.goalSubmitFastPathEnabled ? 'fast-path' : 'session-first';

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
        <Text dimColor>S {activeSessionLabel}</Text>
        <Text dimColor> | </Text>
        <Text dimColor>M {selectedModel || 'auto'}</Text>
        <Text dimColor> | </Text>
        <Text dimColor>I {inputModeLabel}</Text>
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
        {children}
      </Box>

      {/* Input Bar */}
      {showInputBar && (
        <InputBar onSubmit={onInputSubmit} focus={inputFocus} footerStatus={footerStatus} showTabBar={true} />
      )}

      {!showInputBar && (
        <Box paddingX={1}>
          <Box flexDirection="column" backgroundColor="#2a2a2a" width="100%" paddingX={1} paddingY={1}>
            <Text dimColor>{footerStatus}</Text>
            <Box paddingX={1}>
              <TabBar />
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};
