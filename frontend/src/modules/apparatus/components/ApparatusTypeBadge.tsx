/**
 * Apparatus Type Badge Component
 *
 * Displays apparatus type with icon and color.
 */

import React from 'react';
import type { ApparatusType, ApparatusCategory } from '../types';

interface ApparatusTypeBadgeProps {
  type: ApparatusType;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
}

const getCategoryColors = (category: ApparatusCategory) => {
  switch (category) {
    case 'fire':
      return {
        background: 'bg-red-500/10',
        text: 'text-red-400',
        border: 'border-red-500/30',
      };
    case 'ems':
      return {
        background: 'bg-blue-500/10',
        text: 'text-blue-400',
        border: 'border-blue-500/30',
      };
    case 'rescue':
      return {
        background: 'bg-orange-500/10',
        text: 'text-orange-400',
        border: 'border-orange-500/30',
      };
    case 'support':
      return {
        background: 'bg-green-500/10',
        text: 'text-green-400',
        border: 'border-green-500/30',
      };
    case 'command':
      return {
        background: 'bg-purple-500/10',
        text: 'text-purple-400',
        border: 'border-purple-500/30',
      };
    case 'marine':
      return {
        background: 'bg-cyan-500/10',
        text: 'text-cyan-400',
        border: 'border-cyan-500/30',
      };
    case 'aircraft':
      return {
        background: 'bg-indigo-500/10',
        text: 'text-indigo-400',
        border: 'border-indigo-500/30',
      };
    case 'admin':
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

export const ApparatusTypeBadge: React.FC<ApparatusTypeBadgeProps> = ({
  type,
  size = 'md',
  showIcon = true,
}) => {
  const colors = getCategoryColors(type.category);
  const sizeClasses = getSizeClasses(size);

  // Use custom color if provided
  if (type.color) {
    return (
      <span
        className={`${sizeClasses} font-semibold rounded border inline-flex items-center gap-1`}
        style={{
          backgroundColor: `${type.color}20`,
          color: type.color,
          borderColor: `${type.color}50`,
        }}
      >
        {showIcon && type.icon && <span>{type.icon}</span>}
        {type.name}
      </span>
    );
  }

  return (
    <span
      className={`${sizeClasses} ${colors.background} ${colors.text} ${colors.border} font-semibold rounded border inline-flex items-center gap-1`}
    >
      {showIcon && type.icon && <span>{type.icon}</span>}
      {type.name}
    </span>
  );
};

export default ApparatusTypeBadge;
