/**
 * Empty State Component (#41)
 *
 * Contextual empty states with descriptive icons, messaging,
 * and action buttons to guide users on what to do next.
 */

import React, { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

interface EmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
  icon?: LucideIcon;
}

export interface EmptyStateProps {
  icon?: LucideIcon | undefined;
  title: string;
  description?: string | undefined;
  actions?: EmptyStateAction[] | undefined;
  children?: ReactNode | undefined;
  className?: string | undefined;
  /**
   * Heading level for the title. Defaults to 2.
   *
   * It was 3, and that skipped a level on twenty-odd routes: an empty state is
   * usually the only thing under the page's `h1`, so `h1 -> h3` left a hole in
   * the outline, which is the list a screen reader user navigates by. `h2` is
   * the safe default in both directions — axe only objects to *skipping* a
   * level on the way down, so an `h2` under a section's own `h3` is fine.
   *
   * Pass `1` when the empty state *is* the page — a closed storefront, a module
   * with nothing set up yet. Those screens return early, before the page header
   * renders, so their only heading is this one and the page needs it to be the
   * `h1`. Pass `3` where the empty state genuinely sits under an `h2`.
   */
  headingLevel?: 1 | 2 | 3;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  actions,
  children,
  className = '',
  headingLevel = 2,
}) => {
  const Heading = `h${headingLevel}` as const;
  return (
    <div className={`animate-fade-in px-4 py-12 text-center ${className}`}>
      {Icon && (
        <div className="from-theme-surface-secondary to-theme-surface-hover animate-bounce-subtle mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br shadow-sm">
          <Icon className="text-theme-text-muted h-8 w-8" aria-hidden="true" />
        </div>
      )}
      <Heading className="text-theme-text-primary mb-2 text-lg font-semibold">{title}</Heading>
      {description && (
        <p className="text-theme-text-muted mx-auto mb-6 max-w-sm text-sm leading-relaxed">{description}</p>
      )}
      {actions && actions.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {actions.map((action, index) => {
            const ActionIcon = action.icon;
            return (
              <button
                key={index}
                onClick={action.onClick}
                className={
                  action.variant === 'secondary'
                    ? 'btn-secondary inline-flex items-center gap-2'
                    : 'btn-primary inline-flex items-center gap-2'
                }
              >
                {ActionIcon && <ActionIcon className="h-4 w-4" />}
                {action.label}
              </button>
            );
          })}
        </div>
      )}
      {children}
    </div>
  );
};
