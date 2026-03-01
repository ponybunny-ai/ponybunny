/**
 * ConfirmModal - Generic confirmation dialog
 */

import * as React from 'react';
import { Box, Text, useInput } from 'ink';
import { useAppContext } from '../../context/app-context.js';

export interface ConfirmModalData {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}

export const ConfirmModal: React.FC = () => {
  const { state, closeModal } = useAppContext();
  const data = state.modalData as ConfirmModalData | undefined;

  useInput((input, key) => {
    if (key.escape || input === 'n' || input === 'N') {
      data?.onCancel?.();
      closeModal();
    }
    if (input === 'y' || input === 'Y' || key.return) {
      data?.onConfirm();
      closeModal();
    }
  });

  if (!data) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      padding={0}
    >
      <Box flexDirection="column" backgroundColor="#2d2d2d" paddingX={2} paddingY={1}>
        <Box justifyContent="space-between">
          <Text bold color="yellow">{data.title}</Text>
          <Text bold color="cyan">Esc</Text>
        </Box>
        <Box marginTop={1}>
          <Text>{data.message}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            Press <Text bold color="green">Y</Text> to {data.confirmLabel || 'confirm'} or{' '}
            <Text bold color="red">N</Text> to {data.cancelLabel || 'cancel'}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
