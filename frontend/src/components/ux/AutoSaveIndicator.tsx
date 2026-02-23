/**
 * Auto-Save Indicator Component (#51)
 *
 * Shows visible "Saved" / "Saving..." / "Unsaved changes" indicator
 * so users know their work is persisted.
 */

import React from 'react';
import { Check, Cloud, CloudOff, Loader2 } from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'unsaved' | 'error';

interface AutoSaveIndicatorProps {
  status: SaveStatus;
  className?: string;
  lastSaved?: Date | null;
}

export const AutoSaveIndicator: React.FC<AutoSaveIndicatorProps> = ({
  status,
  className = '',
  lastSaved,
}) => {
  const configs = {
    idle: { icon: Cloud, text: '', color: 'text-theme-text-muted' },
    saving: { icon: Loader2, text: 'Saving...', color: 'text-theme-text-muted' },
    saved: { icon: Check, text: 'Saved', color: 'text-green-600 dark:text-green-400' },
    unsaved: { icon: Cloud, text: 'Unsaved changes', color: 'text-yellow-600 dark:text-yellow-400' },
    error: { icon: CloudOff, text: 'Save failed', color: 'text-red-600 dark:text-red-400' },
  };

  const config = configs[status];
  const Icon = config.icon;

  if (status === 'idle') return null;

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div
      className={`inline-flex items-center gap-1.5 text-xs ${config.color} ${className}`}
      role="status"
      aria-live="polite"
    >
      <Icon className={`w-3.5 h-3.5 ${status === 'saving' ? 'animate-spin' : ''}`} />
      <span>{config.text}</span>
      {status === 'saved' && lastSaved && (
        <span className="text-theme-text-muted">at {formatTime(lastSaved)}</span>
      )}
    </div>
  );
};
