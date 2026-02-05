/**
 * EventItem - Event log item
 */

import * as React from 'react';
import { Box, Text } from 'ink';
import type { GatewayEvent } from '../../store/types.js';
import { getEventTypeColor } from '../../utils/colors.js';
import { formatTimestamp, getEventIcon, truncate } from '../../utils/formatters.js';

export interface EventItemProps {
  event: GatewayEvent;
  compact?: boolean;
}

export const EventItem: React.FC<EventItemProps> = ({
  event,
  compact = false,
}) => {
  const color = getEventTypeColor(event.event);
  const icon = getEventIcon(event.event);
  const time = formatTimestamp(event.timestamp);

  const dataStr = typeof event.data === 'string'
    ? event.data
    : JSON.stringify(event.data);

  if (compact) {
    return (
      <Box>
        <Text dimColor>{time}</Text>
        <Text>  </Text>
        <Text color={color}>{icon}</Text>
        <Text>  </Text>
        <Text dimColor>{truncate(event.event, 20)}</Text>
        <Text>  </Text>
        <Text>{truncate(dataStr, 40)}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text dimColor>{time}</Text>
        <Text>  </Text>
        <Text color={color} bold>{icon} {event.event}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text dimColor>{truncate(dataStr, 70)}</Text>
      </Box>
    </Box>
  );
};
