/**
 * What's New Component (#46)
 *
 * In-app changelog dialog that shows user-visible changes
 * after application updates.
 */

import React, { useState, useEffect } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Modal } from '../Modal';

interface ChangelogEntry {
  version: string;
  date: string;
  items: {
    type: 'feature' | 'improvement' | 'fix';
    text: string;
  }[];
}

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.5.0',
    date: '2026-02-23',
    items: [
      { type: 'feature', text: 'Global search — press Ctrl+K to quickly navigate anywhere' },
      { type: 'feature', text: 'Breadcrumb navigation for easier orientation on nested pages' },
      { type: 'feature', text: 'Drag-and-drop file uploads with preview' },
      { type: 'improvement', text: 'Skeleton loading screens replace spinners for smoother perceived load times' },
      { type: 'improvement', text: 'Confirmation dialogs for all destructive actions' },
      { type: 'improvement', text: 'Inline editing for quick field updates' },
      { type: 'improvement', text: 'Column sorting on table views' },
      { type: 'improvement', text: 'Date range filtering on list pages' },
      { type: 'improvement', text: 'Auto-save indicator shows when your work is saved' },
      { type: 'fix', text: 'Improved page transition animations' },
      { type: 'fix', text: 'Better mobile responsiveness on table views' },
    ],
  },
];

const STORAGE_KEY = 'logbook_last_seen_version';

const typeStyles = {
  feature: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30',
  improvement: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30',
  fix: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30',
};

const typeLabels = {
  feature: 'New',
  improvement: 'Improved',
  fix: 'Fixed',
};

export const WhatsNew: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [hasNew, setHasNew] = useState(false);

  const currentVersion = CHANGELOG[0]?.version;

  useEffect(() => {
    const lastSeen = localStorage.getItem(STORAGE_KEY);
    if (lastSeen !== currentVersion) {
      setHasNew(true);
    }
  }, [currentVersion]);

  const handleOpen = () => {
    setIsOpen(true);
    localStorage.setItem(STORAGE_KEY, currentVersion);
    setHasNew(false);
  };

  return (
    <>
      <button
        onClick={handleOpen}
        className="relative p-2 text-theme-text-muted hover:text-theme-text-primary transition-colors rounded-lg hover:bg-theme-surface-hover"
        aria-label="What's new"
        title="What's new"
      >
        <Sparkles className="w-5 h-5" />
        {hasNew && (
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
        )}
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="What's New" size="md">
        <div className="space-y-6 max-h-96 overflow-y-auto">
          {CHANGELOG.map((entry) => (
            <div key={entry.version}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-semibold text-theme-text-primary">
                  v{entry.version}
                </span>
                <span className="text-xs text-theme-text-muted">{entry.date}</span>
              </div>
              <ul className="space-y-2">
                {entry.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className={`px-1.5 py-0.5 text-[10px] font-medium rounded border flex-shrink-0 mt-0.5 ${typeStyles[item.type]}`}
                    >
                      {typeLabels[item.type]}
                    </span>
                    <span className="text-sm text-theme-text-secondary">{item.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-3 border-t border-theme-surface-border flex justify-end">
          <button onClick={() => setIsOpen(false)} className="btn-primary text-sm">
            Got it
          </button>
        </div>
      </Modal>
    </>
  );
};

/** Trigger button for use in navigation */
export const WhatsNewButton: React.FC = () => {
  const [hasNew, setHasNew] = useState(false);
  const currentVersion = CHANGELOG[0]?.version;

  useEffect(() => {
    const lastSeen = localStorage.getItem(STORAGE_KEY);
    if (lastSeen !== currentVersion) {
      setHasNew(true);
    }
  }, [currentVersion]);

  if (!hasNew) return null;

  return (
    <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full" />
  );
};
