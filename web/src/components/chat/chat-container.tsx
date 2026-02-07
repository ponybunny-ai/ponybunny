'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { Chat } from '@/components/ui/chat';
import { type Message } from '@/components/ui/chat-message';
import { useGateway } from '@/components/providers/gateway-provider';

const SUGGESTIONS = [
  '帮我分析一下这个代码库的架构',
  '帮我修复代码中的一个 bug',
  '帮我写一个函数的单元测试',
  '帮我重构这段代码，提高可读性',
];

export function ChatContainer() {
  const { state, sendMessage } = useGateway();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // Handle input change
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  }, []);

  // Handle message submission using conversation API
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
      content: '',
      createdAt: new Date(),
    };
    setMessages((prev) => [...prev, assistantMessage]);
    setIsGenerating(true);

    try {
      // Send message via Conversation Agent
      const result = await sendMessage(userContent);

      // Update assistant message with response
      let responseContent = result.response;

      // Add task info if a goal was created
      if (result.taskInfo) {
        const statusEmoji = result.taskInfo.status === 'completed' ? '✅' :
                           result.taskInfo.status === 'failed' ? '❌' : '🔄';
        const progress = result.taskInfo.progress !== undefined
          ? ` (${Math.round(result.taskInfo.progress * 100)}%)`
          : '';
        responseContent += `\n\n${statusEmoji} 任务状态: ${result.taskInfo.status}${progress}`;
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessageId
            ? { ...m, content: responseContent }
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
                content: `抱歉，处理消息时出错了: ${error instanceof Error ? error.message : '未知错误'}`,
              }
            : m
        )
      );
    } finally {
      setIsGenerating(false);
    }
  }, [input, state.connected, sendMessage]);

  // Handle suggestion click
  const handleAppend = useCallback((message: { role: 'user'; content: string }) => {
    setInput(message.content);
  }, []);

  // Show conversation state indicator
  const conversationStateLabel = useMemo(() => {
    switch (state.conversation.state) {
      case 'chatting': return '对话中';
      case 'clarifying': return '确认需求中...';
      case 'executing': return '执行任务中...';
      case 'monitoring': return '监控进度中...';
      case 'reporting': return '生成报告中...';
      case 'retrying': return '重试中...';
      default: return null;
    }
  }, [state.conversation.state]);

  return (
    <div className="flex flex-col h-full p-4">
      {conversationStateLabel && state.conversation.state !== 'idle' && (
        <div className="mb-2 text-sm text-muted-foreground flex items-center gap-2">
          <span className="animate-pulse">●</span>
          {conversationStateLabel}
        </div>
      )}
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
