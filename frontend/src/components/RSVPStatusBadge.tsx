/**
 * RSVP Status Badge Component
 *
 * Displays RSVP status with appropriate styling
 */

import React from 'react';
import type { RSVPStatus } from '../types/event';
import { getRSVPStatusLabel, getRSVPStatusColor } from '../utils/eventHelpers';

interface RSVPStatusBadgeProps {
  status: RSVPStatus;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-0.5 text-sm',
  lg: 'px-3 py-1 text-base',
};

export const RSVPStatusBadge: React.FC<RSVPStatusBadgeProps> = ({ status, size = 'md' }) => {
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${getRSVPStatusColor(status)} ${sizeClasses[size]}`}
    >
      {getRSVPStatusLabel(status)}
    </span>
  );
};
