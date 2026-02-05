/**
 * ProgressBar - Visual progress indicator
 */

import * as React from 'react';
import { Text } from 'ink';

export interface ProgressBarProps {
  current: number;
  total: number;
  width?: number;
  showPercent?: boolean;
  filledChar?: string;
  emptyChar?: string;
  color?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  current,
  total,
  width = 10,
  showPercent = true,
  filledChar = '█',
  emptyChar = '░',
  color = 'green',
}) => {
  const percent = total === 0 ? 0 : Math.round((current / total) * 100);
  const filled = total === 0 ? 0 : Math.round((current / total) * width);
  const empty = width - filled;

  const bar = filledChar.repeat(filled) + emptyChar.repeat(empty);

  return (
    <Text>
      <Text color={color}>{bar}</Text>
      {showPercent && <Text dimColor> {percent}%</Text>}
    </Text>
  );
};
