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

export const FloatingActionButton: React.FC<FloatingActionButtonProps> = ({ actions, color = 'bg-emerald-600' }) => {
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
      className="fixed right-[calc(1.5rem+env(safe-area-inset-right))] bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-40 md:hidden"
    >
      {/* Backdrop */}
      {open && (
        <div className="animate-fade-in fixed inset-0 -z-10 bg-black/30 backdrop-blur-[2px]" aria-hidden="true" />
      )}

      {/* Action items */}
      {open && (
        <div className="absolute right-0 bottom-16 mb-2 flex flex-col-reverse items-end gap-3">
          {actions.map((action, index) => (
            <button
              key={action.id}
              onClick={() => {
                action.onClick();
                setOpen(false);
              }}
              className="group animate-stagger-fade flex items-center gap-3"
              style={{ animationDelay: `${index * 50}ms` }}
              aria-label={action.label}
            >
              <span
                className="text-theme-text-primary bg-theme-surface-modal border-theme-surface-border rounded-lg border px-3 py-1.5 text-sm font-medium whitespace-nowrap shadow-lg"
                aria-hidden="true"
              >
                {action.label}
              </span>
              <span
                className={`flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg transition-all duration-150 hover:scale-105 hover:shadow-xl active:scale-95 ${action.color ?? 'bg-theme-surface-hover text-theme-text-primary'}`}
              >
                {action.icon}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Main FAB button */}
      <button
        onClick={() => setOpen(!open)}
        className={`flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-all duration-200 hover:shadow-xl active:scale-90 ${color} ${
          open ? 'rotate-45 shadow-xl' : ''
        }`}
        aria-label={open ? 'Close quick actions' : 'Open quick actions'}
        aria-expanded={open}
      >
        {open ? <X className="h-6 w-6" /> : <Plus className="h-6 w-6" />}
      </button>
    </div>
  );
};
