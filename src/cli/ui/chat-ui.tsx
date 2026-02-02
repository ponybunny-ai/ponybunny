import * as React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';
import { openaiClient } from '../lib/openai-client.js';
import type { ChatMessage } from '../lib/openai-client.js';
import type { CodexAccount } from '../lib/account-types.js';
import { accountManager } from '../lib/auth-manager.js';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  streaming?: boolean;
  isCommand?: boolean;
}

interface ChatUIProps {
  model?: string;
  system?: string;
}


const ChatUI = ({ model: initialModel = 'gpt-5.2', system }: ChatUIProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountInfo, setAccountInfo] = useState<string>('');
  const [currentModel, setCurrentModel] = useState(initialModel);
  const [showModelSelector, setShowModelSelector] = useState(false);
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

  const updateAccountInfo = useCallback(async () => {
    const account = accountManager.getCurrentAccount();
    if (account) {
      const strategy = accountManager.getStrategy();
      setAccountInfo(`${account.email || account.userId} [${strategy}]`);
    }
  }, []);

  const handleCommand = useCallback(async (command: string): Promise<boolean> => {
    const parts = command.slice(1).trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    let response = '';

    switch (cmd) {
      case 'exit':
      case 'quit':
        exit();
        return true;

      case 'help':
        response = `Available Commands:
  /help              - Show this help message
  /exit, /quit       - Exit the chat
  /clear             - Clear chat history
  /status            - Show current status
  /model [name]      - View or switch model
  /accounts          - List all accounts
  /switch <email>    - Switch to account
  /strategy <mode>   - Set strategy (stick/round-robin)`;
        break;

      case 'clear':
        setMessages([]);
        response = 'Chat history cleared.';
        break;

      case 'status':
        const account = accountManager.getCurrentAccount('codex') as CodexAccount | undefined;
        const strategy = accountManager.getStrategy();
        const accounts = accountManager.listAccounts();
        response = `Status:
  Model: ${currentModel}
  Account: ${account?.email || account?.userId || 'None'}
  Strategy: ${strategy}
  Total Accounts: ${accounts.length}
  Token Expires: ${account?.expiresAt ? new Date(account.expiresAt).toLocaleString() : 'N/A'}`;
        break;

      case 'model':
        if (args.length === 0) {
          setShowModelSelector(true);
          return true;
        } else {
          const newModel = args[0];
          setCurrentModel(newModel);
          response = `Model switched to: ${newModel}`;
        }
        break;

      case 'accounts':
        const allAccounts = accountManager.listAccounts();
        const config = accountManager.getConfig();
        if (allAccounts.length === 0) {
          response = 'No accounts found.';
        } else {
          response = `Accounts (${allAccounts.length}):\n` +
            allAccounts.map((acc, idx) => {
              const isCurrent = config.currentAccountId === acc.id;
              const marker = isCurrent ? '➤ ' : '  ';
              return `${marker}${idx + 1}. ${acc.email || acc.userId}`;
            }).join('\n');
        }
        break;

      case 'switch':
        if (args.length === 0) {
          response = 'Usage: /switch <email>';
        } else {
          const identifier = args.join(' ');
          const success = accountManager.setCurrentAccount(identifier);
          if (success) {
            await updateAccountInfo();
            response = `Switched to account: ${identifier}`;
          } else {
            response = `Account not found: ${identifier}`;
          }
        }
        break;

      case 'strategy':
        if (args.length === 0) {
          const currentStrategy = accountManager.getStrategy();
          response = `Current strategy: ${currentStrategy}
Available: stick, round-robin
Usage: /strategy <mode>`;
        } else {
          const newStrategy = args[0].toLowerCase();
          if (newStrategy === 'stick' || newStrategy === 'round-robin') {
            accountManager.setStrategy(newStrategy as 'stick' | 'round-robin');
            await updateAccountInfo();
            response = `Strategy set to: ${newStrategy}`;
          } else {
            response = `Invalid strategy: ${newStrategy}. Use 'stick' or 'round-robin'.`;
          }
        }
        break;

      default:
        response = `Unknown command: /${cmd}
Type /help for available commands.`;
    }

    setMessages(prev => [...prev, {
      role: 'system',
      content: response,
      isCommand: true
    }]);

    return true;
  }, [currentModel, exit, updateAccountInfo]);

  useInput((input: string, key: any) => {
    if (key.escape || (key.ctrl && input === 'c')) {
      if (showModelSelector) {
        setShowModelSelector(false);
      } else {
        exit();
      }
    }
  });

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    if (text.startsWith('/')) {
      await handleCommand(text);
      return;
    }

    const userMessage: Message = { role: 'user', content: text.trim() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    const assistantMessage: Message = { role: 'assistant', content: '', streaming: true };
    setMessages(prev => [...prev, assistantMessage]);

    try {
      const chatMessages: ChatMessage[] = messages
        .filter(m => !m.isCommand && m.role !== 'system')
        .concat([userMessage])
        .map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content }));

      if (system) {
        chatMessages.unshift({ role: 'system', content: system });
      }

      let fullResponse = '';
      
      await openaiClient.streamChatCompletion(
        { model: currentModel, messages: chatMessages },
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
  }, [messages, isLoading, currentModel, handleCommand, system]);

  const handleSubmit = useCallback(() => {
    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      exit();
      return;
    }
    sendMessage(input);
    setInput('');
  }, [input, sendMessage, exit]);

  const availableModels = [
    { label: 'GPT-5.2 (Latest)', value: 'gpt-5.2' },
    { label: 'GPT-5.2 Codex (Code optimized)', value: 'gpt-5.2-codex' },
    { label: 'GPT-4o (Fast)', value: 'gpt-4o' },
    { label: 'GPT-4 (Stable)', value: 'gpt-4' },
  ];

  const handleModelSelect = useCallback((item: { label: string; value: string }) => {
    setCurrentModel(item.value);
    setShowModelSelector(false);
    setMessages(prev => [...prev, {
      role: 'system',
      content: `Model switched to: ${item.value}`,
      isCommand: true
    }]);
  }, []);

  const visibleMessages = messages.filter(m => m.role !== 'system' || m.isCommand);

  return (
    <Box flexDirection="column" height="100%">
      {showModelSelector ? (
        <>
          <Box borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
            <Text bold color="cyan">Select Model</Text>
          </Box>
          
          <Box flexDirection="column" paddingX={2}>
            <Box marginBottom={1}>
              <Text color="yellow">
                Current: {currentModel}
              </Text>
            </Box>
            <SelectInput
              items={availableModels}
              onSelect={handleModelSelect}
            />
          </Box>
          
          <Box paddingX={2} marginTop={1}>
            <Text dimColor>Use ↑↓ arrow keys to navigate, Enter to select, ESC to cancel</Text>
          </Box>
        </>
      ) : (
        <>
          <Box borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
            <Text bold color="cyan">PonyBunny Chat</Text>
            <Text dimColor> - </Text>
            <Text color="yellow">{currentModel}</Text>
            <Text dimColor> - </Text>
            <Text color="green">{accountInfo}</Text>
          </Box>

          <Box flexDirection="column" flexGrow={1} marginBottom={1} overflow="hidden">
            {visibleMessages.length === 0 && (
              <Box paddingX={2}>
                <Text dimColor>Type your message or /help for commands.</Text>
              </Box>
            )}
            
            {visibleMessages.map((msg, idx) => (
              <Box key={idx} flexDirection="column" marginBottom={1} paddingX={2}>
                {msg.isCommand ? (
                  <>
                    <Text bold color="cyan">ℹ System</Text>
                    <Text color="gray">{msg.content}</Text>
                  </>
                ) : (
                  <>
                    <Text bold color={msg.role === 'user' ? 'green' : 'blue'}>
                      {msg.role === 'user' ? '➤ You' : '🤖 Assistant'}
                    </Text>
                    <Text>
                      {msg.content}
                      {msg.streaming && <Text color="gray"> ▊</Text>}
                    </Text>
                  </>
                )}
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
            <Text dimColor>Press ESC or Ctrl+C to exit | Type /help for commands</Text>
          </Box>
        </>
      )}
    </Box>
  );
};

export async function startChatUI(options: { model?: string; system?: string } = {}) {
  const { waitUntilExit } = render(
    <ChatUI model={options.model} system={options.system} />
  );
  
  await waitUntilExit();
}
