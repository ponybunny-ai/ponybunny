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
  searchQuery?: string;
}

function highlightText(text: string, query?: string): React.ReactNode {
  const q = (query || '').trim();
  if (!q) return <Text>{text}</Text>;
  const lowerText = text.toLowerCase();
  const lowerQ = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let start = 0;
  let idx = lowerText.indexOf(lowerQ, start);
  let key = 0;
  while (idx !== -1) {
    if (idx > start) {
      parts.push(<Text key={`n-${key++}`}>{text.slice(start, idx)}</Text>);
    }
    parts.push(
      <Text key={`h-${key++}`} color="yellow">
        {text.slice(idx, idx + q.length)}
      </Text>
    );
    start = idx + q.length;
    idx = lowerText.indexOf(lowerQ, start);
  }
  if (start < text.length) {
    parts.push(<Text key={`n-${key++}`}>{text.slice(start)}</Text>);
  }
  return <>{parts}</>;
}

export const EventItem: React.FC<EventItemProps> = ({
  event,
  compact = false,
  searchQuery,
}) => {
  const color = getEventTypeColor(event.event);
  const icon = getEventIcon(event.event);
  const time = formatTimestamp(event.timestamp);

  const dataStr = (() => {
    if (typeof event.data === 'string') return event.data;
    if (event.event === 'conversation.history.loaded' && event.data && typeof event.data === 'object') {
      const d = event.data as {
        sessionId?: string;
        total?: number;
        returned?: number;
        limit?: number;
        roleFilter?: string;
        source?: string;
      };
      return `session=${d.sessionId ?? '-'} total=${d.total ?? '-'} returned=${d.returned ?? '-'} limit=${d.limit ?? '-'} role=${d.roleFilter ?? 'all'} source=${d.source ?? 'unknown'}`;
    }
    return JSON.stringify(event.data);
  })();

  if (compact) {
    return (
      <Box>
        <Text dimColor>{time}</Text>
        <Text>  </Text>
        <Text color={color}>{icon}</Text>
        <Text>  </Text>
        <Text dimColor>{truncate(event.event, 20)}</Text>
        <Text>  </Text>
        <Text>{highlightText(truncate(dataStr, 40), searchQuery)}</Text>
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
        <Text dimColor>{highlightText(truncate(dataStr, 70), searchQuery)}</Text>
      </Box>
    </Box>
  );
};
