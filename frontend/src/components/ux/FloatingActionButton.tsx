/**
 * FloatingActionButton (FAB)
 *
 * A mobile-friendly floating action button that expands to show quick actions.
 * Only visible on small screens (below md breakpoint) for touch-first workflows.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Plus, X } from 'lucide-react';

interface FABAction {
  /** Unique key */
  id: string;
  /** Button label */
  label: string;
  /** Lucide icon component */
  icon: React.ReactNode;
  /** Click handler */
  onClick: () => void;
  /** Optional Tailwind color class for the mini-FAB background */
  color?: string | undefined;
}

interface FloatingActionButtonProps {
  /** List of actions to show when expanded */
  actions: FABAction[];
  /** Main FAB color (Tailwind bg class) */
  color?: string | undefined;
}

export const FloatingActionButton: React.FC<FloatingActionButtonProps> = ({
  actions,
  color = 'bg-emerald-600',
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="fixed bottom-6 right-6 z-40 md:hidden"
    >
      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 bg-black/30 -z-10" aria-hidden="true" />
      )}

      {/* Action items */}
      {open && (
        <div className="absolute bottom-16 right-0 flex flex-col-reverse items-end gap-3 mb-2">
          {actions.map((action) => (
            <button
              key={action.id}
              onClick={() => {
                action.onClick();
                setOpen(false);
              }}
              className="flex items-center gap-3 group animate-in fade-in slide-in-from-bottom-2 duration-200"
            >
              <span className="px-3 py-1.5 text-sm font-medium text-theme-text-primary bg-theme-surface-modal rounded-lg shadow-lg border border-theme-surface-border whitespace-nowrap">
                {action.label}
              </span>
              <span className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-white ${action.color ?? 'bg-theme-surface-hover text-theme-text-primary'}`}>
                {action.icon}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Main FAB button */}
      <button
        onClick={() => setOpen(!open)}
        className={`w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white transition-transform ${color} ${
          open ? 'rotate-45' : ''
        }`}
        aria-label={open ? 'Close quick actions' : 'Open quick actions'}
        aria-expanded={open}
      >
        {open ? <X className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
      </button>
    </div>
  );
};
