'use client';

import * as React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Send, Loader2, User, Bot } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  streaming?: boolean;
}

interface ConversationState {
  sessionId: string | null;
  messages: Message[];
  isConnected: boolean;
  isStreaming: boolean;
  currentStreamId: string | null;
}

export default function ChatPage() {
  const [state, setState] = React.useState<ConversationState>({
    sessionId: null,
    messages: [],
    isConnected: false,
    isStreaming: false,
    currentStreamId: null,
  });
  const [input, setInput] = React.useState('');
  const [ws, setWs] = React.useState<WebSocket | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.messages]);

  // WebSocket connection
  React.useEffect(() => {
    const gatewayUrl = 'ws://localhost:18789';
    const socket = new WebSocket(gatewayUrl);

    socket.onopen = () => {
      console.log('Connected to Gateway');
      setState((prev) => ({ ...prev, isConnected: true }));

      // Authenticate with token (for debug/admin access)
      // In production, this would use proper auth flow
      socket.send(
        JSON.stringify({
          type: 'req',
          id: `auth-${Date.now()}`,
          method: 'auth.token',
          params: { token: 'debug-token' },
        })
      );
    };

    socket.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data);
        handleFrame(frame);
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    socket.onclose = () => {
      console.log('Disconnected from Gateway');
      setState((prev) => ({ ...prev, isConnected: false }));
    };

    setWs(socket);

    return () => {
      socket.close();
    };
  }, []);

  const handleFrame = (frame: any) => {
    if (frame.type === 'res') {
      // Response to RPC call
      if (frame.result?.sessionId) {
        setState((prev) => ({ ...prev, sessionId: frame.result.sessionId }));
      }
      if (frame.result?.response) {
        // Non-streaming response
        const message: Message = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: frame.result.response,
          timestamp: Date.now(),
        };
        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, message],
          isStreaming: false,
          currentStreamId: null,
        }));
      }
    } else if (frame.type === 'event') {
      // Handle streaming events
      handleStreamEvent(frame);
    }
  };

  const handleStreamEvent = (frame: any) => {
    const { event, data } = frame;

    switch (event) {
      case 'conversation.stream.start':
        // Start a new streaming message
        const streamMessage: Message = {
          id: data.streamId || `stream-${Date.now()}`,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          streaming: true,
        };
        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, streamMessage],
          isStreaming: true,
          currentStreamId: streamMessage.id,
        }));
        break;

      case 'conversation.stream.chunk':
        // Append chunk to current streaming message
        setState((prev) => {
          const messages = [...prev.messages];
          const streamingMsg = messages.find((m) => m.id === prev.currentStreamId);
          if (streamingMsg) {
            streamingMsg.content += data.chunk || data.content || '';
          }
          return { ...prev, messages };
        });
        break;

      case 'conversation.stream.end':
        // Mark streaming as complete
        setState((prev) => {
          const messages = [...prev.messages];
          const streamingMsg = messages.find((m) => m.id === prev.currentStreamId);
          if (streamingMsg) {
            streamingMsg.streaming = false;
          }
          return {
            ...prev,
            messages,
            isStreaming: false,
            currentStreamId: null,
          };
        });
        break;

      case 'conversation.stream.error':
        // Handle streaming error
        setState((prev) => {
          const messages = [...prev.messages];
          const streamingMsg = messages.find((m) => m.id === prev.currentStreamId);
          if (streamingMsg) {
            streamingMsg.content += '\n\n[Error: Stream interrupted]';
            streamingMsg.streaming = false;
          }
          return {
            ...prev,
            messages,
            isStreaming: false,
            currentStreamId: null,
          };
        });
        break;
    }
  };

  const sendMessage = () => {
    if (!input.trim() || !ws || ws.readyState !== WebSocket.OPEN) return;

    // Add user message to UI
    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };
    setState((prev) => ({ ...prev, messages: [...prev.messages, userMessage] }));

    // Send to Gateway
    ws.send(
      JSON.stringify({
        type: 'req',
        id: `msg-${Date.now()}`,
        method: 'conversation.message',
        params: {
          sessionId: state.sessionId,
          message: input,
          stream: true, // Request streaming response
        },
      })
    );

    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="border-b p-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Conversation</h1>
          <p className="text-sm text-muted-foreground">
            Chat with PonyBunny AI Assistant
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={state.isConnected ? 'default' : 'destructive'}>
            {state.isConnected ? 'Connected' : 'Disconnected'}
          </Badge>
          {state.sessionId && (
            <Badge variant="outline">Session: {state.sessionId.slice(0, 8)}</Badge>
          )}
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4 max-w-4xl mx-auto">
          {state.messages.length === 0 && (
            <div className="text-center text-muted-foreground py-12">
              <Bot className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Start a conversation with PonyBunny</p>
              <p className="text-sm mt-2">
                Ask questions, request tasks, or get help with your work
              </p>
            </div>
          )}
          {state.messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${
                message.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {message.role === 'assistant' && (
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                  <Bot className="w-5 h-5 text-primary-foreground" />
                </div>
              )}
              <Card
                className={`p-4 max-w-[80%] ${
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                }`}
              >
                <div className="whitespace-pre-wrap break-words">
                  {message.content}
                  {message.streaming && (
                    <span className="inline-block w-2 h-4 ml-1 bg-current animate-pulse" />
                  )}
                </div>
                <div className="text-xs opacity-70 mt-2">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </div>
              </Card>
              {message.role === 'user' && (
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                  <User className="w-5 h-5 text-secondary-foreground" />
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t p-4">
        <div className="max-w-4xl mx-auto flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            disabled={!state.isConnected || state.isStreaming}
            className="flex-1"
          />
          <Button
            onClick={sendMessage}
            disabled={!state.isConnected || !input.trim() || state.isStreaming}
            size="icon"
          >
            {state.isStreaming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
