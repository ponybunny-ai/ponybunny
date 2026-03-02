/**
 * GoalCreateModal - Multi-step goal creation wizard
 */

import * as React from 'react';
import { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useAppContext } from '../../context/app-context.js';
import { useGateway } from '../../hooks/use-gateway.js';
import type { GoalSubmitParams } from '../../../gateway/tui-gateway-client.js';

type Step = 'title' | 'description' | 'criteria' | 'priority' | 'confirm';

interface GoalFormState {
  title: string;
  description: string;
  criteria: string[];
  priority: number;
}

export const GoalCreateModal: React.FC = () => {
  const { closeModal, addEvent, state } = useAppContext();
  const { submitGoal } = useGateway();

  const [step, setStep] = useState<Step>('title');
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<GoalFormState>({
    title: '',
    description: '',
    criteria: [],
    priority: 50,
  });

  // Handle escape to cancel
  useInput((_input, key) => {
    if (key.escape) {
      closeModal();
    }
  });

  const handleSubmit = useCallback(async () => {
    setError(null);

    switch (step) {
      case 'title':
        if (!input.trim()) {
          setError('Title is required');
          return;
        }
        setForm(f => ({ ...f, title: input.trim() }));
        setInput('');
        setStep('description');
        break;

      case 'description':
        if (!input.trim()) {
          setError('Description is required');
          return;
        }
        setForm(f => ({ ...f, description: input.trim() }));
        setInput('');
        setStep('criteria');
        break;

      case 'criteria':
        if (input.toLowerCase() === 'done') {
          if (form.criteria.length === 0) {
            setError('At least one criterion is required');
            return;
          }
          setInput('');
          setStep('priority');
        } else if (input.trim()) {
          setForm(f => ({ ...f, criteria: [...f.criteria, input.trim()] }));
          setInput('');
        }
        break;

      case 'priority':
        if (input.trim() === '') {
          // Use default priority
          setStep('confirm');
          setInput('');
        } else {
          const priority = parseInt(input, 10);
          if (isNaN(priority) || priority < 1 || priority > 100) {
            setError('Priority must be a number between 1 and 100');
            return;
          }
          setForm(f => ({ ...f, priority }));
          setInput('');
          setStep('confirm');
        }
        break;

      case 'confirm':
        if (input.toLowerCase() === 'y' || input.toLowerCase() === 'yes') {
          try {
            const params: GoalSubmitParams = {
              title: form.title,
              description: form.description,
              success_criteria: form.criteria.map(c => ({
                description: c,
                type: 'heuristic' as const,
                verification_method: 'human review',
                required: true,
              })),
              priority: form.priority,
              context: state.selectedModel
                ? {
                    selected_model: state.selectedModel,
                    model_source: 'tui_selected',
                  }
                : undefined,
            };
            await submitGoal(params);
            addEvent('goal.created', { title: form.title });
            closeModal();
          } catch (err) {
            setError(`Failed to create goal: ${(err as Error).message}`);
          }
        } else if (input.toLowerCase() === 'n' || input.toLowerCase() === 'no') {
          closeModal();
        }
        setInput('');
        break;
    }
  }, [step, input, form, submitGoal, closeModal, addEvent]);

  const renderStep = () => {
    switch (step) {
      case 'title':
        return (
          <>
            <Text>Enter goal title:</Text>
            <Box marginTop={1}>
              <Text color="green">➤ </Text>
              <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
            </Box>
          </>
        );

      case 'description':
        return (
          <>
            <Text dimColor>Title: {form.title}</Text>
            <Box marginTop={1} />
            <Text>Enter goal description:</Text>
            <Box marginTop={1}>
              <Text color="green">➤ </Text>
              <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
            </Box>
          </>
        );

      case 'criteria':
        return (
          <>
            <Text dimColor>Title: {form.title}</Text>
            <Text dimColor>Description: {form.description}</Text>
            <Box marginTop={1} />
            <Text>Enter success criteria (type "done" when finished):</Text>
            {form.criteria.slice(-6).map((c, i) => (
              <Text key={i} dimColor>  {form.criteria.length - Math.min(6, form.criteria.length) + i + 1}. {c}</Text>
            ))}
            {form.criteria.length > 6 && <Text dimColor>  ... {form.criteria.length - 6} more</Text>}
            <Box marginTop={1}>
              <Text color="green">➤ </Text>
              <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
            </Box>
          </>
        );

      case 'priority':
        return (
          <>
            <Text dimColor>Title: {form.title}</Text>
            <Text dimColor>Criteria: {form.criteria.length} items</Text>
            <Box marginTop={1} />
            <Text>Enter priority (1-100, default 50):</Text>
            <Box marginTop={1}>
              <Text color="green">➤ </Text>
              <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
            </Box>
          </>
        );

      case 'confirm':
        return (
          <>
            <Text bold>Review Goal:</Text>
            <Box marginTop={1} flexDirection="column">
              <Text>  Title: {form.title}</Text>
              <Text>  Description: {form.description}</Text>
              <Text>  Priority: {form.priority}</Text>
              <Text>  Success Criteria:</Text>
              {form.criteria.slice(0, 6).map((c, i) => (
                <Text key={i}>    {i + 1}. {c}</Text>
              ))}
              {form.criteria.length > 6 && <Text>    ... {form.criteria.length - 6} more</Text>}
            </Box>
            <Box marginTop={1} />
            <Text>Submit this goal? (y/n)</Text>
            <Box marginTop={1}>
              <Text color="green">➤ </Text>
              <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
            </Box>
          </>
        );
    }
  };

  return (
    <Box
      flexDirection="column"
      padding={0}
    >
      <Box flexDirection="column" backgroundColor="gray" padding={1}>
        <Box justifyContent="space-between">
          <Text bold color="cyan">Create New Goal</Text>
          <Text bold color="cyan">Esc</Text>
        </Box>

        <Box marginTop={1} />

        {renderStep()}

        <Box marginTop={1}>
          <Text dimColor>
            Keys: <Text bold color="green">Enter</Text> submit · <Text bold color="cyan">Esc</Text> cancel
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
