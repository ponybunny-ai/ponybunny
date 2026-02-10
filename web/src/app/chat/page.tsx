'use client';

import { ChatContainer } from '@/components/chat/chat-container';

export default function ChatPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-hidden">
        <ChatContainer />
      </div>
    </div>
  );
}
