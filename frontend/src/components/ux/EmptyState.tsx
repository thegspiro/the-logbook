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
   * only right for the common case: an empty state that is the page's own body.
   *
   * It is wrong wherever the empty state is a *section's* body — "Nobody yet"
   * inside "Who's going", "No transactions yet" inside "Transaction History" —
   * because a default `h2` there makes the empty state a peer of the section it
   * belongs to, and a screen-reader user navigating by heading reads it as
   * another section of the page rather than as that section's content. There is
   * no default that gets both cases right, so a nested call site states its
   * level:
   *
   *   `1` — the empty state *is* the page: a closed storefront, a record that
   *         does not exist. Those branches return early, before the page header
   *         renders, so this is the only heading the page has.
   *   `2` — (default) the page's body, under the page `h1`.
   *   `3` — inside a section titled `h2`.
   *   `4` — inside a section titled `h3`.
   */
  headingLevel?: 1 | 2 | 3 | 4;
  /**
   * Tighter spacing for an empty state nested inside a padded card section.
   *
   * The default `py-12` and 64px icon are sized for an empty state that is the
   * page's whole body. Inside a `card p-6` section they stack on the card's own
   * padding and leave the section mostly blank space. `className` cannot undo
   * this: Tailwind v4 orders utilities by its own rules, not by their position
   * in the class string, so a passed `py-6` does not reliably beat `py-12`.
   */
  compact?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  actions,
  children,
  className = '',
  headingLevel = 2,
  compact = false,
}) => {
  const Heading = `h${headingLevel}` as const;
  const hasActions = !!actions && actions.length > 0;
  // A compact description drops its bottom margin when nothing follows it, so
  // the card's own padding is the only space under the text.
  const descriptionMargin = compact ? (hasActions || children ? 'mb-4' : '') : 'mb-6';
  return (
    <div
      data-testid="empty-state"
      className={`animate-fade-in px-4 text-center ${compact ? 'py-4' : 'py-12'} ${className}`}
    >
      {Icon && (
        <div
          data-testid="empty-state-icon"
          className={`from-theme-surface-secondary to-theme-surface-hover animate-bounce-subtle mx-auto flex items-center justify-center rounded-full bg-gradient-to-br shadow-sm ${
            compact ? 'mb-3 h-12 w-12' : 'mb-5 h-16 w-16'
          }`}
        >
          <Icon className={`text-theme-text-muted ${compact ? 'h-6 w-6' : 'h-8 w-8'}`} aria-hidden="true" />
        </div>
      )}
      <Heading className={`text-theme-text-primary font-semibold ${compact ? 'mb-1 text-base' : 'mb-2 text-lg'}`}>
        {title}
      </Heading>
      {description && (
        <p className={`text-theme-text-muted mx-auto max-w-sm text-sm leading-relaxed ${descriptionMargin}`}>
          {description}
        </p>
      )}
      {hasActions && (
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
