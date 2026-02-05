/**
 * useKeyboard - Hook for keyboard navigation and shortcuts
 */

import { useCallback } from 'react';
import { useInput, useApp } from 'ink';
import { useAppContext } from '../context/app-context.js';
import type { ViewType } from '../store/types.js';

export interface KeyboardOptions {
  onEscape?: () => void;
  onEnter?: () => void;
  onTab?: () => void;
  onUp?: () => void;
  onDown?: () => void;
  onLeft?: () => void;
  onRight?: () => void;
  enabled?: boolean;
}

const VIEW_ORDER: ViewType[] = ['dashboard', 'goals', 'events', 'help'];

export function useKeyboard(options: KeyboardOptions = {}): void {
  const { exit } = useApp();
  const { state, setView, closeModal, clearEvents, openModal } = useAppContext();
  const { enabled = true } = options;

  const handleInput = useCallback((input: string, key: {
    escape: boolean;
    return: boolean;
    tab: boolean;
    upArrow: boolean;
    downArrow: boolean;
    leftArrow: boolean;
    rightArrow: boolean;
    ctrl: boolean;
    shift: boolean;
    meta: boolean;
  }) => {
    if (!enabled) return;

    // Handle escape
    if (key.escape) {
      if (state.activeModal) {
        closeModal();
      } else {
        options.onEscape?.();
        exit();
      }
      return;
    }

    // Handle Ctrl+C
    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    // Handle Ctrl+L (clear)
    if (key.ctrl && input === 'l') {
      clearEvents();
      return;
    }

    // Handle Ctrl+N (new goal)
    if (key.ctrl && input === 'n') {
      openModal('goal-create');
      return;
    }

    // Handle Ctrl+E (escalations)
    if (key.ctrl && input === 'e') {
      setView('events');
      return;
    }

    // Handle Tab (cycle views)
    if (key.tab) {
      if (state.activeModal) return;
      const currentIndex = VIEW_ORDER.indexOf(state.currentView);
      const nextIndex = key.shift
        ? (currentIndex - 1 + VIEW_ORDER.length) % VIEW_ORDER.length
        : (currentIndex + 1) % VIEW_ORDER.length;
      setView(VIEW_ORDER[nextIndex]);
      options.onTab?.();
      return;
    }

    // Handle number keys for direct view switching (1-4)
    if (!state.activeModal && ['1', '2', '3', '4'].includes(input)) {
      const viewIndex = parseInt(input, 10) - 1;
      if (viewIndex >= 0 && viewIndex < VIEW_ORDER.length) {
        setView(VIEW_ORDER[viewIndex]);
      }
      return;
    }

    // Handle arrow keys
    if (key.upArrow) {
      options.onUp?.();
      return;
    }
    if (key.downArrow) {
      options.onDown?.();
      return;
    }
    if (key.leftArrow) {
      options.onLeft?.();
      return;
    }
    if (key.rightArrow) {
      options.onRight?.();
      return;
    }

    // Handle Enter
    if (key.return) {
      options.onEnter?.();
      return;
    }

    // Handle j/k for vim-style navigation
    if (input === 'j') {
      options.onDown?.();
      return;
    }
    if (input === 'k') {
      options.onUp?.();
      return;
    }
  }, [enabled, state.activeModal, state.currentView, closeModal, clearEvents, openModal, setView, exit, options]);

  useInput(handleInput);
}

export function useListNavigation<T>(
  items: T[],
  selectedIndex: number,
  onSelect: (index: number) => void
): {
  onUp: () => void;
  onDown: () => void;
  selectedItem: T | undefined;
} {
  const onUp = useCallback(() => {
    if (items.length === 0) return;
    const newIndex = selectedIndex <= 0 ? items.length - 1 : selectedIndex - 1;
    onSelect(newIndex);
  }, [items.length, selectedIndex, onSelect]);

  const onDown = useCallback(() => {
    if (items.length === 0) return;
    const newIndex = selectedIndex >= items.length - 1 ? 0 : selectedIndex + 1;
    onSelect(newIndex);
  }, [items.length, selectedIndex, onSelect]);

  return {
    onUp,
    onDown,
    selectedItem: items[selectedIndex],
  };
}
