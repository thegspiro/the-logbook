/**
 * Status Badge Component
 *
 * Displays apparatus status with appropriate styling.
 */

import React from 'react';
import type { ApparatusStatus, DefaultApparatusStatus } from '../types';

interface StatusBadgeProps {
  status: ApparatusStatus;
  size?: 'sm' | 'md' | 'lg';
}

const getStatusColors = (defaultStatus: DefaultApparatusStatus | null, color: string | null) => {
  // Use custom color if provided
  if (color) {
    return {
      background: `${color}20`,
      text: color,
      border: `${color}50`,
    };
  }

  // Default colors based on status
  switch (defaultStatus) {
    case 'in_service':
      return {
        background: 'bg-green-500/10',
        text: 'text-green-400',
        border: 'border-green-500/30',
      };
    case 'out_of_service':
      return {
        background: 'bg-red-500/10',
        text: 'text-red-400',
        border: 'border-red-500/30',
      };
    case 'in_maintenance':
      return {
        background: 'bg-yellow-500/10',
        text: 'text-yellow-400',
        border: 'border-yellow-500/30',
      };
    case 'reserve':
      return {
        background: 'bg-blue-500/10',
        text: 'text-blue-400',
        border: 'border-blue-500/30',
      };
    case 'on_order':
      return {
        background: 'bg-purple-500/10',
        text: 'text-purple-400',
        border: 'border-purple-500/30',
      };
    case 'sold':
    case 'disposed':
      return {
        background: 'bg-slate-500/10',
        text: 'text-slate-400',
        border: 'border-slate-500/30',
      };
    default:
      return {
        background: 'bg-slate-500/10',
        text: 'text-slate-400',
        border: 'border-slate-500/30',
      };
  }
};

const getSizeClasses = (size: 'sm' | 'md' | 'lg') => {
  switch (size) {
    case 'sm':
      return 'px-2 py-0.5 text-xs';
    case 'lg':
      return 'px-4 py-2 text-sm';
    default:
      return 'px-2 py-1 text-xs';
  }
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const colors = getStatusColors(status.defaultStatus, status.color);
  const sizeClasses = getSizeClasses(size);

  // Check if using custom color (hex value)
  if (status.color) {
    return (
      <span
        className={`${sizeClasses} font-semibold rounded border inline-flex items-center gap-1`}
        style={{
          backgroundColor: `${status.color}20`,
          color: status.color,
          borderColor: `${status.color}50`,
        }}
      >
        {status.icon && <span>{status.icon}</span>}
        {status.name.toUpperCase()}
      </span>
    );
  }

  return (
    <span
      className={`${sizeClasses} ${colors.background} ${colors.text} ${colors.border} font-semibold rounded border inline-flex items-center gap-1`}
    >
      {status.icon && <span>{status.icon}</span>}
      {status.name.toUpperCase()}
    </span>
  );
};

export default StatusBadge;
