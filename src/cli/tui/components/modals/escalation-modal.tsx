/**
 * EscalationModal - Handle escalation resolution
 */

import * as React from 'react';
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { useAppContext } from '../../context/app-context.js';
import { useGateway } from '../../hooks/use-gateway.js';
import type { ResolutionAction } from '../../../../work-order/types/index.js';
import { formatEscalationSeverity, formatDateTime, truncate } from '../../utils/formatters.js';
import { getEscalationSeverityColor } from '../../utils/colors.js';

interface EscalationModalProps {
  escalationId: string;
}

const RESOLUTION_OPTIONS: { label: string; value: ResolutionAction }[] = [
  { label: 'Provide Input', value: 'user_input' },
  { label: 'Skip', value: 'skip' },
  { label: 'Retry', value: 'retry' },
  { label: 'Alternative Approach', value: 'alternative_approach' },
];

export const EscalationModal: React.FC<EscalationModalProps> = ({ escalationId }) => {
  const { state, closeModal, addEvent } = useAppContext();
  const { resolveEscalation } = useGateway();

  const [step, setStep] = useState<'view' | 'action' | 'input'>('view');
  const [selectedAction, setSelectedAction] = useState<ResolutionAction | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const escalation = state.escalations.find(e => e.id === escalationId);

  useInput((_input, key) => {
    if (key.escape) {
      if (step === 'input') {
        setStep('action');
      } else if (step === 'action') {
        setStep('view');
      } else {
        closeModal();
      }
    }
  });

  if (!escalation) {
    return (
      <Box
        flexDirection="column"
        padding={0}
      >
        <Box flexDirection="column" backgroundColor="gray" padding={1}>
          <Box justifyContent="space-between">
            <Text color="yellow">Escalation not found</Text>
            <Text bold color="cyan">Esc</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  const handleActionSelect = (item: { value: ResolutionAction }) => {
    setSelectedAction(item.value);
    if (item.value === 'user_input' || item.value === 'alternative_approach') {
      setStep('input');
    } else {
      handleResolve(item.value);
    }
  };

  const handleResolve = async (action: ResolutionAction, data?: string) => {
    try {
      const resolution = {
        action,
        data: data ? { input: data } : undefined,
      };
      await resolveEscalation(escalationId, resolution);
      addEvent('escalation.resolved', { escalationId, action });
      closeModal();
    } catch (err) {
      setError(`Failed to resolve: ${(err as Error).message}`);
    }
  };

  const handleInputSubmit = () => {
    if (!input.trim()) {
      setError('Input is required');
      return;
    }
    handleResolve(selectedAction!, input.trim());
  };

  const severityColor = getEscalationSeverityColor(escalation.severity);

  return (
    <Box
      flexDirection="column"
      padding={0}
    >
      <Box flexDirection="column" backgroundColor="gray" padding={1}>
        <Box justifyContent="space-between">
          <Text bold color="yellow">⚠ Escalation</Text>
          <Text bold color="cyan">Esc</Text>
        </Box>
        <Box justifyContent="space-between">
          <Text dimColor>Resolve escalation flow</Text>
          <Text color={severityColor}>{formatEscalationSeverity(escalation.severity)}</Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>{escalation.title}</Text>
          <Text dimColor>Type: {escalation.escalation_type}</Text>
          <Text dimColor>Created: {formatDateTime(escalation.created_at)}</Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>Description:</Text>
          <Text>{truncate(escalation.description, 220)}</Text>
        </Box>

        {escalation.context_data && (
          <Box marginTop={1} flexDirection="column">
            <Text bold>Context:</Text>
            {escalation.context_data.last_error && (
              <Text dimColor>  Last Error: {truncate(escalation.context_data.last_error, 180)}</Text>
            )}
            {escalation.context_data.retry_count !== undefined && (
              <Text dimColor>  Retry Count: {escalation.context_data.retry_count}</Text>
            )}
            {escalation.context_data.attempted_solutions && (
              <Text dimColor>  Attempted: {truncate(escalation.context_data.attempted_solutions.join(', '), 180)}</Text>
            )}
          </Box>
        )}

        {step === 'view' && (
          <Box marginTop={1}>
            <Text color="cyan">Press <Text bold color="green">Enter</Text> to resolve this escalation</Text>
            <Box marginTop={1}>
              <SelectInput
                items={[{ label: 'Resolve...', value: 'resolve' }]}
                onSelect={() => setStep('action')}
              />
            </Box>
          </Box>
        )}

        {step === 'action' && (
          <Box marginTop={1} flexDirection="column">
            <Text bold>Select resolution action:</Text>
            <SelectInput
              items={RESOLUTION_OPTIONS}
              onSelect={handleActionSelect}
            />
          </Box>
        )}

        {step === 'input' && (
          <Box marginTop={1} flexDirection="column">
            <Text bold>
              {selectedAction === 'user_input' ? 'Enter your input:' : 'Describe the alternative approach:'}
            </Text>
            <Box marginTop={1}>
              <Text color="green">➤ </Text>
              <TextInput value={input} onChange={setInput} onSubmit={handleInputSubmit} />
            </Box>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>
            Keys: <Text bold color="green">Enter</Text> continue · <Text bold color="cyan">Esc</Text> back/close
          </Text>
        </Box>

        {error && (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
