'use client';

import { useState } from 'react';
import { GatewayProvider, useGateway } from '@/components/providers/gateway-provider';
import { Header } from '@/components/layout/header';
import { ChatContainer } from '@/components/chat/chat-container';
import { ExpertPanel } from '@/components/expert/expert-panel';
import { useGoals } from '@/hooks/use-goals';
import type { ViewMode } from '@/lib/types';

function MainContent() {
  const [mode, setMode] = useState<ViewMode>('standard');
  const { activeGoal, activeWorkItems } = useGoals();

  return (
    <div className="flex flex-col h-screen">
      <Header mode={mode} onModeChange={setMode} />

      <main className="flex-1 flex overflow-hidden">
        {/* Chat area */}
        <div className={`flex-1 ${mode === 'expert' ? 'max-w-[60%]' : ''}`}>
          <ChatContainer />
        </div>

        {/* Expert panel */}
        {mode === 'expert' && (
          <div className="w-[40%] min-w-[300px]">
            <ExpertPanel
              activeGoal={activeGoal}
              activeWorkItems={activeWorkItems}
            />
          </div>
        )}
      </main>
    </div>
  );
}

function AppContent() {
  const { state } = useGateway();

  // Show main content if connected
  if (state.connected) {
    return <MainContent />;
  }

  // Show connecting state
  if (state.connecting) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <span className="text-4xl">🐴</span>
          <p className="mt-4 text-muted-foreground">Connecting to Gateway...</p>
        </div>
      </div>
    );
  }

  // Show error state
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="text-center space-y-4">
        <span className="text-4xl">🐴</span>
        <h1 className="text-2xl font-bold">PonyBunny</h1>
        {state.error ? (
          <>
            <p className="text-destructive">{state.error}</p>
            <p className="text-sm text-muted-foreground">
              Make sure the Gateway is running
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md"
            >
              Retry
            </button>
          </>
        ) : (
          <p className="text-muted-foreground">Initializing...</p>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <GatewayProvider>
      <AppContent />
    </GatewayProvider>
  );
}
