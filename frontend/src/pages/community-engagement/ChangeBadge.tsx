/**
 * A figure's change against the comparison period: arrow, text, and for a
 * screen reader the period it is compared with. Shared by Outreach Impact's
 * event figures and its CRR breakdowns.
 */

import React from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import type { Change } from './communityEngagement';

export const ChangeBadge: React.FC<{ change: Change | null; against: string | null }> = ({ change, against }) => {
  if (!change) return null;
  const tone =
    change.direction === 'up'
      ? 'text-green-900 dark:text-green-300'
      : change.direction === 'down'
        ? 'text-red-900 dark:text-red-300'
        : 'text-theme-text-muted';
  const Icon = change.direction === 'up' ? ArrowUpRight : change.direction === 'down' ? ArrowDownRight : null;
  return (
    <span className={`inline-flex items-center text-xs font-medium ${tone}`}>
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {/* Its own element, so axe measures the text without the icon beside it. */}
      <span>{change.text}</span>
      {against && <span className="sr-only"> compared with {against}</span>}
    </span>
  );
};
