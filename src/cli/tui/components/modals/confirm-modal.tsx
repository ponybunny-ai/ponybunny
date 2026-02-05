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
      borderStyle="round"
      borderColor="yellow"
      padding={1}
    >
      <Text bold color="yellow">{data.title}</Text>
      <Box marginTop={1}>
        <Text>{data.message}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Press <Text color="green">Y</Text> to {data.confirmLabel || 'confirm'} or{' '}
          <Text color="red">N</Text> to {data.cancelLabel || 'cancel'}
        </Text>
      </Box>
    </Box>
  );
};
