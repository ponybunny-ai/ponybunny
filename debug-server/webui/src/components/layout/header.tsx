'use client';

import { ConnectionStatus } from './connection-status';

export function Header() {
  return (
    <header className="flex h-16 items-center justify-between border-b bg-card px-6">
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold">Debug Dashboard</h2>
      </div>
      <ConnectionStatus />
    </header>
  );
}
