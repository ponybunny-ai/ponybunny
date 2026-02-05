/**
 * StatusBadge - Status indicator badge
 */

import * as React from 'react';
import { Text } from 'ink';
import type { GoalStatus, WorkItemStatus, EscalationSeverity } from '../../../../work-order/types/index.js';
import {
  getGoalStatusColor,
  getWorkItemStatusColor,
  getEscalationSeverityColor,
} from '../../utils/colors.js';
import {
  getGoalStatusIcon,
  getWorkItemStatusIcon,
} from '../../utils/formatters.js';

export interface StatusBadgeProps {
  status: string;
  type?: 'goal' | 'workitem' | 'escalation';
  showIcon?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  type = 'goal',
  showIcon = true,
}) => {
  let color: string;
  let icon: string;

  switch (type) {
    case 'goal':
      color = getGoalStatusColor(status as GoalStatus);
      icon = getGoalStatusIcon(status as GoalStatus);
      break;
    case 'workitem':
      color = getWorkItemStatusColor(status as WorkItemStatus);
      icon = getWorkItemStatusIcon(status as WorkItemStatus);
      break;
    case 'escalation':
      color = getEscalationSeverityColor(status as EscalationSeverity);
      icon = status === 'critical' ? '⚠' : status === 'high' ? '●' : status === 'medium' ? '◐' : '○';
      break;
    default:
      color = 'gray';
      icon = '●';
  }

  return (
    <Text color={color}>
      {showIcon && <Text>{icon} </Text>}
      {status}
    </Text>
  );
};
