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
    <div className={`text-center py-12 px-4 animate-fade-in ${className}`}>
      {Icon && (
        <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-br from-theme-surface-secondary to-theme-surface-hover flex items-center justify-center mb-5 shadow-sm animate-bounce-subtle">
          <Icon className="w-8 h-8 text-theme-text-muted" aria-hidden="true" />
        </div>
      )}
      <h3 className="text-lg font-semibold text-theme-text-primary mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-theme-text-muted max-w-sm mx-auto mb-6 leading-relaxed">{description}</p>
      )}
      {actions && actions.length > 0 && (
        <div className="flex items-center justify-center flex-wrap gap-3">
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
                {ActionIcon && <ActionIcon className="w-4 h-4" />}
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
