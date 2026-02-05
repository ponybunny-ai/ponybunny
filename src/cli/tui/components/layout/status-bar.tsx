/**
 * StatusBar - Top status bar showing connection status, stats, and time
 */

import * as React from 'react';
import { Box, Text } from 'ink';
import { useAppContext } from '../../context/app-context.js';
import { useGatewayContext } from '../../context/gateway-context.js';
import { useGoals } from '../../hooks/use-goals.js';
import { getConnectionStatusColor } from '../../utils/colors.js';
import { formatTimestamp } from '../../utils/formatters.js';

export const StatusBar: React.FC = () => {
  const { state } = useAppContext();
  const { connectionStatus } = useGatewayContext();
  const { goalCount, activeCount } = useGoals();
  const { pendingEscalationCount } = state;

  const statusColor = getConnectionStatusColor(connectionStatus);
  const statusIcon = connectionStatus === 'connected' ? '●' : connectionStatus === 'connecting' ? '◐' : '○';

  const [time, setTime] = React.useState(formatTimestamp(Date.now()));

  React.useEffect(() => {
    const interval = setInterval(() => {
      setTime(formatTimestamp(Date.now()));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      justifyContent="space-between"
    >
      <Box>
        <Text bold color="cyan">PonyBunny</Text>
        <Text dimColor> │ </Text>
        <Text color={statusColor}>{statusIcon} {connectionStatus}</Text>
      </Box>

      <Box>
        <Text dimColor>{goalCount} Goals</Text>
        {activeCount > 0 && (
          <>
            <Text dimColor> │ </Text>
            <Text color="green">{activeCount} Active</Text>
          </>
        )}
        {pendingEscalationCount > 0 && (
          <>
            <Text dimColor> │ </Text>
            <Text color="yellow">⚠ {pendingEscalationCount} Escalation{pendingEscalationCount !== 1 ? 's' : ''}</Text>
          </>
        )}
        <Text dimColor> │ </Text>
        <Text dimColor>{time}</Text>
      </Box>
    </Box>
  );
};
