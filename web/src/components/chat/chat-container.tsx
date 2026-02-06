'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { Chat } from '@/components/ui/chat';
import { type Message } from '@/components/ui/chat-message';
import { useGateway } from '@/components/providers/gateway-provider';

const SUGGESTIONS = [
  'Analyze the codebase architecture',
  'Help me fix a bug in my code',
  'Write unit tests for a function',
  'Refactor this code for better readability',
];

export function ChatContainer() {
  const { state, submitGoal } = useGateway();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // Build goals map for quick lookup
  const goalsMap = useMemo(() => {
    const map = new Map<string, { id: string; status: string; description: string }>();
    state.goals.forEach((g) => map.set(g.id, g));
    return map;
  }, [state.goals]);

  // Handle input change
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  }, []);

  // Handle message submission
  const handleSubmit = useCallback(async (event?: { preventDefault?: () => void }) => {
    event?.preventDefault?.();

    if (!input.trim() || !state.connected) return;

    const userContent = input.trim();
    setInput('');

    // Add user message
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userContent,
      createdAt: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // Add assistant processing message
    const assistantMessageId = crypto.randomUUID();
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: 'Processing your request...',
      createdAt: new Date(),
    };
    setMessages((prev) => [...prev, assistantMessage]);
    setIsGenerating(true);

    try {
      // Submit goal to gateway
      const goal = await submitGoal(userContent);

      // Update assistant message with goal reference
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessageId
            ? {
                ...m,
                content: `Working on: ${goal.description}\n\nGoal ID: \`${goal.id}\``,
              }
            : m
        )
      );
    } catch (error) {
      // Update assistant message with error
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessageId
            ? {
                ...m,
                content: `Failed to submit goal: ${error instanceof Error ? error.message : 'Unknown error'}`,
              }
            : m
        )
      );
    } finally {
      setIsGenerating(false);
    }
  }, [input, state.connected, submitGoal]);

  // Handle suggestion click
  const handleAppend = useCallback((message: { role: 'user'; content: string }) => {
    setInput(message.content);
  }, []);

  // Update messages when goal status changes
  useEffect(() => {
    setMessages((prev) =>
      prev.map((m) => {
        // Find goal ID in message content
        const goalIdMatch = m.content.match(/Goal ID: `([^`]+)`/);
        if (!goalIdMatch) return m;

        const goalId = goalIdMatch[1];
        const goal = goalsMap.get(goalId);
        if (!goal) return m;

        if (goal.status === 'completed') {
          return {
            ...m,
            content: `✅ Completed: ${goal.description}\n\nGoal ID: \`${goal.id}\``
          };
        }
        if (goal.status === 'cancelled') {
          return {
            ...m,
            content: `❌ Cancelled: ${goal.description}\n\nGoal ID: \`${goal.id}\``
          };
        }
        return m;
      })
    );
  }, [goalsMap]);

  return (
    <div className="flex flex-col h-full p-4">
      <Chat
        messages={messages}
        input={input}
        handleInputChange={handleInputChange}
        handleSubmit={handleSubmit}
        isGenerating={isGenerating}
        setMessages={setMessages}
        append={handleAppend}
        suggestions={SUGGESTIONS}
      />
    </div>
  );
}
