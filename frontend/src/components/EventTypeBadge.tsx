/**
 * Event Type Badge Component
 *
 * Displays event type with appropriate styling
 */

import React from 'react';
import { getEventTypeLabel, getEventTypeBadgeColor } from '../utils/eventHelpers';

interface EventTypeBadgeProps {
  type: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-0.5 text-sm',
  lg: 'px-3 py-1 text-base',
};

export const EventTypeBadge: React.FC<EventTypeBadgeProps> = ({ type, size = 'md' }) => {
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${getEventTypeBadgeColor(type)} ${sizeClasses[size]}`}
    >
      {getEventTypeLabel(type)}
    </span>
  );
};
