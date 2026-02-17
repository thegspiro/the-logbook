/**
 * AutoSaveNotification Component
 *
 * Displays a subtle notification that settings are automatically saved
 * Provides user confidence that progress is preserved
 */

import React from 'react';
import { CheckCircle, Cloud } from 'lucide-react';

interface AutoSaveNotificationProps {
  /**
   * Optional custom className
   */
  className?: string;

  /**
   * Show last saved timestamp
   */
  showTimestamp?: boolean;

  /**
   * Last saved timestamp ISO string
   */
  lastSaved?: string | null;
}

export const AutoSaveNotification: React.FC<AutoSaveNotificationProps> = ({
  className = '',
  showTimestamp = false,
  lastSaved
}) => {
  const formatTimestamp = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  return (
    <div className={`flex items-center gap-2 text-sm text-theme-text-muted ${className}`}>
      <div className="flex items-center gap-1.5">
        <Cloud className="w-4 h-4 text-green-400" />
        <span className="text-theme-text-secondary">
          <CheckCircle className="w-3 h-3 inline mr-1 text-green-400" />
          Settings saved after each step
        </span>
      </div>

      {showTimestamp && lastSaved && (
        <span className="text-xs text-slate-500">
          Last saved: {formatTimestamp(lastSaved)}
        </span>
      )}
    </div>
  );
};
