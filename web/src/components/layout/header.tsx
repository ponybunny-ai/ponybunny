'use client';

import { ConnectionStatus } from './connection-status';
import { ModeToggle } from './mode-toggle';
import type { ViewMode } from '@/lib/types';

interface HeaderProps {
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
}

export function Header({ mode, onModeChange }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="text-xl">🐴</span>
          <span className="font-semibold">PonyBunny</span>
        </div>
        <div className="flex items-center gap-3">
          <ModeToggle mode={mode} onModeChange={onModeChange} />
          <ConnectionStatus />
        </div>
      </div>
    </header>
  );
}
