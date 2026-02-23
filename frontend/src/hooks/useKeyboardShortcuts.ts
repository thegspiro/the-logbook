/**
 * Keyboard Shortcuts Hook (#39)
 *
 * Provides keyboard shortcuts for power users.
 * Registers global key handlers that respect focus context.
 */

import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

interface ShortcutConfig {
  /** Key (e.g., 'n', 's', '?') */
  key: string;
  /** Handler function */
  handler: () => void;
  /** Require ctrl/cmd modifier */
  ctrlKey?: boolean;
  /** Require shift modifier */
  shiftKey?: boolean;
  /** Description for help display */
  description?: string;
}

export function useKeyboardShortcuts(shortcuts: ShortcutConfig[]): void {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't fire shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      for (const shortcut of shortcuts) {
        const ctrlMatch = shortcut.ctrlKey ? (e.metaKey || e.ctrlKey) : !(e.metaKey || e.ctrlKey);
        const shiftMatch = shortcut.shiftKey ? e.shiftKey : !e.shiftKey;

        if (e.key.toLowerCase() === shortcut.key.toLowerCase() && ctrlMatch && shiftMatch) {
          e.preventDefault();
          shortcut.handler();
          return;
        }
      }
    },
    [shortcuts]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

/** Pre-built navigation shortcuts */
export function useNavigationShortcuts(): void {
  const navigate = useNavigate();

  useKeyboardShortcuts([
    { key: 'g', handler: () => navigate('/dashboard'), description: 'Go to Dashboard' },
    { key: 'e', handler: () => navigate('/events'), description: 'Go to Events' },
    { key: 'm', handler: () => navigate('/members'), description: 'Go to Members' },
    { key: 't', handler: () => navigate('/training/my-training'), description: 'Go to Training' },
    { key: 'i', handler: () => navigate('/inventory'), description: 'Go to Inventory' },
    { key: 'n', handler: () => navigate('/notifications'), description: 'Go to Notifications' },
    { key: '?', shiftKey: true, handler: () => {
      // Could open a shortcuts help modal in the future
    }, description: 'Show keyboard shortcuts' },
  ]);
}
