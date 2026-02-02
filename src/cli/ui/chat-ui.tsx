import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { openaiClient } from '../lib/openai-client.js';
import type { ChatMessage } from '../lib/openai-client.js';
import { accountManager } from '../lib/auth-manager.js';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  streaming?: boolean;
}

interface ChatUIProps {
  model?: string;
  system?: string;
}

const ChatUI: React.FC<ChatUIProps> = ({ model = 'gpt-5.2', system }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountInfo, setAccountInfo] = useState<string>('');
  const { exit } = useApp();

  useEffect(() => {
    const loadAccountInfo = async () => {
      const account = accountManager.getCurrentAccount();
      if (account) {
        const strategy = accountManager.getStrategy();
        setAccountInfo(`${account.email || account.userId} [${strategy}]`);
      }
    };
    loadAccountInfo();

    if (system) {
      setMessages([{ role: 'system', content: system }]);
    }
  }, [system]);

  useInput((input: string, key: any) => {
    if (key.escape || (key.ctrl && input === 'c')) {
      exit();
    }
  });

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: text.trim() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    const assistantMessage: Message = { role: 'assistant', content: '', streaming: true };
    setMessages(prev => [...prev, assistantMessage]);

    try {
      const chatMessages: ChatMessage[] = messages
        .concat([userMessage])
        .map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content }));

      let fullResponse = '';
      
      await openaiClient.streamChatCompletion(
        { model, messages: chatMessages },
        (chunk: string) => {
          fullResponse += chunk;
          setMessages(prev => {
            const newMessages = [...prev];
            const lastMsg = newMessages[newMessages.length - 1];
            if (lastMsg && lastMsg.streaming) {
              lastMsg.content = fullResponse;
            }
            return newMessages;
          });
        }
      );

      setMessages(prev => {
        const newMessages = [...prev];
        const lastMsg = newMessages[newMessages.length - 1];
        if (lastMsg && lastMsg.streaming) {
          delete lastMsg.streaming;
        }
        return newMessages;
      });
    } catch (err) {
      setError((err as Error).message);
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, model]);

  const handleSubmit = useCallback(() => {
    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      exit();
      return;
    }
    sendMessage(input);
  }, [input, sendMessage, exit]);

  const visibleMessages = messages.filter(m => m.role !== 'system');

  return (
    <Box flexDirection="column" height="100%">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Text bold color="cyan">PonyBunny Chat</Text>
        <Text dimColor> - </Text>
        <Text color="yellow">{model}</Text>
        <Text dimColor> - </Text>
        <Text color="green">{accountInfo}</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} marginBottom={1} overflow="hidden">
        {visibleMessages.length === 0 && (
          <Box paddingX={2}>
            <Text dimColor>Type your message and press Enter. Type 'exit' to quit.</Text>
          </Box>
        )}
        
        {visibleMessages.map((msg, idx) => (
          <Box key={idx} flexDirection="column" marginBottom={1} paddingX={2}>
            <Text bold color={msg.role === 'user' ? 'green' : 'blue'}>
              {msg.role === 'user' ? '➤ You' : '🤖 Assistant'}
            </Text>
            <Text>
              {msg.content}
              {msg.streaming && <Text color="gray"> ▊</Text>}
            </Text>
          </Box>
        ))}
      </Box>

      {error && (
        <Box paddingX={2} marginBottom={1}>
          <Text color="red">✗ Error: {error}</Text>
        </Box>
      )}

      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Box marginRight={1}>
          {isLoading ? (
            <>
              <Text color="yellow">
                <Spinner type="dots" />
              </Text>
              <Text color="yellow"> Thinking...</Text>
            </>
          ) : (
            <Text color="green">➤</Text>
          )}
        </Box>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder="Type your message..."
          showCursor={!isLoading}
        />
      </Box>

      <Box paddingX={2} paddingY={0}>
        <Text dimColor>Press ESC or Ctrl+C to exit</Text>
      </Box>
    </Box>
  );
};

export async function startChatUI(options: { model?: string; system?: string } = {}) {
  const { waitUntilExit } = render(
    <ChatUI model={options.model} system={options.system} />
  );
  
  await waitUntilExit();
}
