/**
 * Badge Component
 *
 * Reusable badge component for displaying status, types, and labels
 */

import React from 'react';

export type BadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'purple'
  | 'pink'
  | 'indigo';

export type BadgeSize = 'sm' | 'md' | 'lg';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-theme-surface-secondary text-theme-text-primary',
  success: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  error: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-400',
  pink: 'bg-pink-100 text-pink-800 dark:bg-pink-500/20 dark:text-pink-400',
  indigo: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-400',
};

const sizeClasses: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-0.5 text-sm',
  lg: 'px-3 py-1 text-base',
};

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'md',
  className = '',
}) => {
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
    >
      {children}
    </span>
  );
};
