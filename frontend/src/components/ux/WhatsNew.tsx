/**
 * What's New Component (#46)
 *
 * In-app changelog dialog that shows user-visible changes
 * after application updates.
 */

import React, { useState, useEffect } from 'react';
import { Sparkles } from 'lucide-react';
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
    if (currentVersion) localStorage.setItem(STORAGE_KEY, currentVersion);
    setHasNew(false);
  };

  return (
    <>
      <button
        onClick={handleOpen}
        className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover relative rounded-lg p-2 transition-colors"
        aria-label="What's new"
        title="What's new"
      >
        <Sparkles className="h-5 w-5" />
        {hasNew && <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500" />}
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="What's New" size="md">
        <div className="max-h-96 space-y-6 overflow-y-auto">
          {CHANGELOG.map((entry) => (
            <div key={entry.version}>
              <div className="mb-3 flex items-center gap-2">
                <span className="text-theme-text-primary text-sm font-semibold">v{entry.version}</span>
                <span className="text-theme-text-muted text-xs">{entry.date}</span>
              </div>
              <ul className="space-y-2">
                {entry.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium ${typeStyles[item.type]}`}
                    >
                      {typeLabels[item.type]}
                    </span>
                    <span className="text-theme-text-secondary text-sm">{item.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-theme-surface-border mt-4 flex justify-end border-t pt-3">
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

  return <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-red-500" />;
};
