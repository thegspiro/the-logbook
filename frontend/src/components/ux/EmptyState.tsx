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
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  actions,
  children,
  className = '',
}) => {
  return (
    <div className={`animate-fade-in px-4 py-12 text-center ${className}`}>
      {Icon && (
        <div className="from-theme-surface-secondary to-theme-surface-hover animate-bounce-subtle mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br shadow-sm">
          <Icon className="text-theme-text-muted h-8 w-8" aria-hidden="true" />
        </div>
      )}
      <h3 className="text-theme-text-primary mb-2 text-lg font-semibold">{title}</h3>
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
