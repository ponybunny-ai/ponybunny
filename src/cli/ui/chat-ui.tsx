import * as React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';
import { openaiClient } from '../lib/openai-client.js';
import { antigravityClient } from '../lib/antigravity-client.js';
import { modelsManager } from '../lib/models-manager.js';
import type { ChatMessage } from '../lib/openai-client.js';
import type { AccountProvider } from '../lib/account-types.js';
import { accountManagerV2 } from '../lib/auth-manager-v2.js';
import { WorkOrderDatabase } from '../../work-order/database/manager.js';
import { ExecutionService } from '../../app/lifecycle/execution/execution-service.js';
import { LLMRouter, MockLLMProvider } from '../../infra/llm/llm-provider.js';
import { OpenAIProvider, AnthropicProvider } from '../../infra/llm/providers.js';
import { CodexAccountProvider, AntigravityAccountProvider } from '../../infra/llm/account-providers.js';
import type { ReActCycleParams } from '../../autonomy/react-integration.js';

// Initialize core services lazily
let executionService: ExecutionService | null = null;
let repository: WorkOrderDatabase | null = null;

async function initServices() {
  if (executionService) return;

  console.log('[ChatUI] Initializing services...');
  
  const dbPath = process.env.PONY_DB_PATH || './pony-work-orders.db';
  repository = new WorkOrderDatabase(dbPath);
  await repository.initialize();

  const providers = [];
  
  const codexAccount = accountManagerV2.getCurrentAccount('codex');
  console.log('[ChatUI] Codex account:', codexAccount?.email || 'none');
  if (codexAccount) {
    console.log('[ChatUI] Adding CodexAccountProvider');
    providers.push(new CodexAccountProvider(accountManagerV2, { model: 'gpt-5.2-codex', maxTokens: 4000 }));
  }
  
  const antigravityAccount = accountManagerV2.getCurrentAccount('antigravity');
  console.log('[ChatUI] Antigravity account:', antigravityAccount?.email || 'none');
  if (antigravityAccount) {
    console.log('[ChatUI] Adding AntigravityAccountProvider');
    providers.push(new AntigravityAccountProvider(accountManagerV2, { model: 'gemini-2.5-flash', maxTokens: 4000 }));
  }
  
  if (process.env.OPENAI_API_KEY) {
    console.log('[ChatUI] Adding OpenAIProvider from env');
    providers.push(new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4o-mini',
      maxTokens: 4000,
    }));
  }
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('[ChatUI] Adding AnthropicProvider from env');
    providers.push(new AnthropicProvider({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-3-5-sonnet-20241022',
      maxTokens: 4000,
    }));
  }
  
  if (providers.length === 0) {
    console.log('[ChatUI] No providers available, using MockLLMProvider');
    providers.push(new MockLLMProvider('chat-mock'));
  }

  console.log('[ChatUI] Total providers:', providers.length);
  const llmRouter = new LLMRouter(providers);

  executionService = new ExecutionService(
    repository,
    { maxConsecutiveErrors: 3 },
    llmRouter
  );
  
  console.log('[ChatUI] Services initialized');
}

function getModelProvider(modelName: string): AccountProvider {
  if (
    modelName.startsWith('claude-') ||
    modelName.startsWith('gemini-') ||
    modelName.startsWith('antigravity-')
  ) {
    return 'antigravity';
  }
  return 'codex';
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  streaming?: boolean;
  isCommand?: boolean;
  agentType?: 'thought' | 'action' | 'observation';
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
  const [currentModel, setCurrentModel] = useState(initialModel);
  const [accountInfo, setAccountInfo] = useState('Not authenticated');
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [availableModels, setAvailableModels] = useState<Array<{ label: string; value: string }>>([]);
  const { exit } = useApp();

  useEffect(() => {
    const loadAccountInfo = async () => {
      const provider = getModelProvider(currentModel);
      const account = accountManagerV2.getCurrentAccount(provider);
      if (account) {
        const strategy = accountManagerV2.getStrategy();
        setAccountInfo(`${account.email || account.userId || 'Unknown'} [${strategy}]`);
      } else {
        setAccountInfo('No account');
      }
    };
    loadAccountInfo();

    const loadModels = async () => {
      try {
        const cache = await modelsManager.getModels();
        
        const models = [
          ...cache.models.codex.map(m => ({
            label: m.label || `${m.name} - OpenAI Codex`,
            value: m.name,
          })),
          ...cache.models.antigravity.map(m => ({
            label: m.label || `${m.name} - Antigravity`,
            value: m.name,
          })),
        ];

        setAvailableModels(models);
      } catch (error) {
        console.warn('Failed to load models, using defaults');
        setAvailableModels([
          { label: 'GPT-5.2 (Latest) - OpenAI Codex', value: 'gpt-5.2' },
          { label: 'GPT-5.2 Codex (Code optimized) - OpenAI Codex', value: 'gpt-5.2-codex' },
          { label: 'GPT-4o (Fast) - OpenAI Codex', value: 'gpt-4o' },
          { label: 'GPT-4 (Stable) - OpenAI Codex', value: 'gpt-4' },
          { label: 'Claude Sonnet 4.5 - Antigravity', value: 'claude-sonnet-4-5' },
          { label: 'Claude Sonnet 4.5 Thinking - Antigravity', value: 'claude-sonnet-4-5-thinking' },
          { label: 'Claude Opus 4.5 Thinking - Antigravity', value: 'claude-opus-4-5-thinking' },
          { label: 'Gemini 2.5 Flash (Recommended) - Antigravity', value: 'gemini-2.5-flash' },
          { label: 'Gemini 2.5 Pro - Antigravity', value: 'gemini-2.5-pro' },
        ]);
      }
    };
    loadModels();

    if (system) {
      setMessages([{ role: 'system', content: system }]);
    }
  }, [system, currentModel]);

  const [sessionParams, setSessionParams] = useState<ReActCycleParams | null>(null);

  useEffect(() => {
    initServices().then(() => {
        if (!repository) {
          console.error('[ChatUI] Repository not initialized');
          return;
        }
        
        console.log('[ChatUI] Creating session params...');
        
        const goal = repository.createGoal({
            title: 'Interactive Chat Session',
            description: 'User initiated chat session',
            priority: 50,
            success_criteria: [],
        });
        
        const workItem = repository.createWorkItem({
            goal_id: goal.id,
            title: 'Chat Interaction',
            description: 'Interactive chat',
            item_type: 'analysis',
            priority: 50,
        });
        
        const run = repository.createRun({
            work_item_id: workItem.id,
            goal_id: goal.id,
            agent_type: 'chat-agent',
            run_sequence: 1,
        });

        console.log('[ChatUI] Session params created:', { goalId: goal.id, workItemId: workItem.id, runId: run.id });
        
        setSessionParams({
            workItem,
            run,
            signal: new AbortController().signal,
            model: currentModel,
        });
    }).catch(err => {
        console.error('[ChatUI] Failed to initialize services:', err);
    });
  }, []);

  const updateAccountInfo = useCallback(async () => {
    const provider = getModelProvider(currentModel);
    const account = accountManagerV2.getCurrentAccount(provider);
    if (account) {
      const strategy = accountManagerV2.getStrategy();
      setAccountInfo(`${account.email || account.userId || 'Unknown'} [${strategy}]`);
    } else {
      setAccountInfo('No account');
    }
  }, [currentModel]);

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
        const provider = getModelProvider(currentModel);
        const account = accountManagerV2.getCurrentAccount(provider);
        const strategy = accountManagerV2.getStrategy();
        const accounts = accountManagerV2.listAccounts();
        response = `Status:
  Model: ${currentModel}
  Provider: ${provider}
  Account: ${account?.email || account?.userId || 'None'}
  Strategy: ${strategy}
  Total Accounts: ${accounts.length}`;
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
        const allAccounts = accountManagerV2.listAccounts();
        const config = accountManagerV2.getConfig();
        if (allAccounts.length === 0) {
          response = 'No accounts found.';
        } else {
          response = `Accounts (${allAccounts.length}):\n` +
            allAccounts.map((acc, idx) => {
              const isCurrentForProvider = config.currentAccountIdByProvider?.[acc.provider] === acc.id;
              const marker = isCurrentForProvider ? '➤ ' : '  ';
              const providerLabel = acc.provider === 'antigravity' ? ' (Antigravity)' : ' (Codex)';
              return `${marker}${idx + 1}. ${acc.email || acc.userId}${providerLabel}`;
            }).join('\n');
        }
        break;

      case 'switch':
        if (args.length === 0) {
          response = 'Usage: /switch <email>';
        } else {
          const identifier = args.join(' ');
          const success = accountManagerV2.setCurrentAccount(identifier);
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
          const currentStrategy = accountManagerV2.getStrategy();
          response = `Current strategy: ${currentStrategy}
Available: stick, round-robin
Usage: /strategy <mode>`;
        } else {
          const newStrategy = args[0].toLowerCase();
          if (newStrategy === 'stick' || newStrategy === 'round-robin') {
            accountManagerV2.setStrategy(newStrategy as 'stick' | 'round-robin');
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
      console.log('[ChatUI] sendMessage called');
      console.log('[ChatUI] executionService:', !!executionService);
      console.log('[ChatUI] sessionParams:', !!sessionParams);
      
      if (executionService && sessionParams) {
        console.log('[ChatUI] Using ReActIntegration path');
        const reactIntegration = (executionService as any).reactIntegration;
        
        if (!reactIntegration) {
          console.error('[ChatUI] No reactIntegration found on executionService!');
          throw new Error('ReActIntegration not available');
        }
        
        const updatedSessionParams = {
          ...sessionParams,
          model: currentModel,
        };
        
        console.log('[ChatUI] Calling chatStep with model:', currentModel);
        const result = await reactIntegration.chatStep(updatedSessionParams, text);
        console.log('[ChatUI] chatStep result:', result);
        
        // Display agent's thoughts and actions
        if (result.log) {
             const thoughts = result.log
                .split('\n\n')
                .filter((step: string) => step.includes('THOUGHT') || step.includes('ACTION') || step.includes('OBSERVATION'))
                .map((step: string) => {
                    const isThought = step.includes('THOUGHT');
                    const isAction = step.includes('ACTION');
                    const isObservation = step.includes('OBSERVATION');
                    const content = step.replace(/\[.*?\] (THOUGHT|ACTION|OBSERVATION): /, '');
                    
                    return {
                        role: 'system' as const,
                        content,
                        isCommand: true,
                        agentType: isThought ? 'thought' as const : isAction ? 'action' as const : 'observation' as const
                    };
                });
             setMessages(prev => [...prev, ...thoughts]);
        }

        const reply = result.reply;
        
        setMessages(prev => {
            const newMessages = [...prev];
            const lastMsg = newMessages[newMessages.length - 1];
            if (lastMsg && lastMsg.streaming) {
                lastMsg.content = reply;
                delete lastMsg.streaming;
            }
            return newMessages;
        });

      } else {
        console.log('[ChatUI] Falling back to direct LLM - executionService:', !!executionService, 'sessionParams:', !!sessionParams);
        const unifiedMessages: ChatMessage[] = messages
          .filter(m => !m.isCommand && m.role !== 'system')
          .concat([userMessage])
          .map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content }));

        if (system) {
          unifiedMessages.unshift({ role: 'system', content: system });
        }

        const provider = getModelProvider(currentModel);
        
        let fullResponse = '';
        
        if (provider === 'antigravity') {
          const geminiContents = unifiedMessages
            .filter(m => m.role !== 'system')
            .map(m => ({
              role: m.role === 'assistant' ? 'model' as const : 'user' as const,
              parts: [{ text: m.content }],
            }));

          const systemInstruction = system ? { parts: [{ text: system }] } : undefined;

          const response = await antigravityClient.generateContent({
            model: currentModel,
            request: {
              contents: geminiContents,
              systemInstruction,
            },
          });
          
          const textParts: string[] = [];
          const responseCandidates = (response.response as any)?.candidates;
          if (Array.isArray(responseCandidates)) {
            const firstCandidate = responseCandidates[0];
            const parts = firstCandidate?.content?.parts;
            if (Array.isArray(parts)) {
              for (const part of parts) {
                if (part?.text) {
                  textParts.push(part.text);
                }
              }
            }
          }
          
          fullResponse = textParts.join('') || 'No response from model';
          
          setMessages(prev => {
            const newMessages = [...prev];
            const lastMsg = newMessages[newMessages.length - 1];
            if (lastMsg && lastMsg.streaming) {
              lastMsg.content = fullResponse;
            }
            return newMessages;
          });
        } else {
          await openaiClient.streamChatCompletion(
            { model: currentModel, messages: unifiedMessages },
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
        }

        setMessages(prev => {
          const newMessages = [...prev];
          const lastMsg = newMessages[newMessages.length - 1];
          if (lastMsg && lastMsg.streaming) {
            delete lastMsg.streaming;
          }
          return newMessages;
        });
      }
    } catch (err) {
      setError((err as Error).message);
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, currentModel, handleCommand, system, sessionParams, executionService]);

  const handleSubmit = useCallback(() => {
    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      exit();
      return;
    }
    sendMessage(input);
    setInput('');
  }, [input, sendMessage, exit]);

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
              limit={15}
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
                    {msg.agentType === 'thought' ? (
                      <>
                        <Text bold color="magenta">💭 Agent Thought</Text>
                        <Text color="magenta" dimColor>{msg.content}</Text>
                      </>
                    ) : msg.agentType === 'action' ? (
                      <>
                        <Text bold color="yellow">⚡ Agent Action</Text>
                        <Text color="yellow">{msg.content}</Text>
                      </>
                    ) : msg.agentType === 'observation' ? (
                      <>
                        <Text bold color="cyan">👁  Agent Observation</Text>
                        <Text color="cyan" dimColor>{msg.content}</Text>
                      </>
                    ) : (
                      <>
                        <Text bold color="cyan">ℹ System</Text>
                        <Text color="gray">{msg.content}</Text>
                      </>
                    )}
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
