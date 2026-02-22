/**
 * Applicant Card
 *
 * Card component for kanban board display of an applicant.
 */

import React from 'react';
import { Clock, Mail, Phone, ArrowRight, AlertTriangle } from 'lucide-react';
import type { ApplicantListItem, ApplicantStatus, InactivityAlertLevel } from '../types';
import { getInitials } from '../types';

interface ApplicantCardProps {
  applicant: ApplicantListItem;
  onClick: (applicant: ApplicantListItem) => void;
  onDragStart?: (e: React.DragEvent, applicant: ApplicantListItem) => void;
  isDragging?: boolean;
}

const STATUS_COLORS: Record<ApplicantStatus, string> = {
  active: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400',
  on_hold: 'bg-amber-500/20 text-amber-700 dark:text-amber-400',
  withdrawn: 'bg-theme-surface-hover text-theme-text-muted',
  converted: 'bg-blue-500/20 text-blue-700 dark:text-blue-400',
  rejected: 'bg-red-500/20 text-red-700 dark:text-red-400',
  inactive: 'bg-theme-surface-hover text-theme-text-muted',
};

const ALERT_LEVEL_STYLES: Record<InactivityAlertLevel, { border: string; icon: string } | null> = {
  normal: null,
  warning: { border: 'border-amber-500/40', icon: 'text-amber-700 dark:text-amber-400' },
  critical: { border: 'border-red-500/40', icon: 'text-red-700 dark:text-red-400' },
};

export const ApplicantCard: React.FC<ApplicantCardProps> = ({
  applicant,
  onClick,
  onDragStart,
  isDragging,
}) => {
  const initials = getInitials(applicant.first_name, applicant.last_name);
  const alertLevel = applicant.inactivity_alert_level ?? 'normal';
  const alertStyle = ALERT_LEVEL_STYLES[alertLevel];

  return (
    <div
      draggable={!!onDragStart}
      onDragStart={(e) => onDragStart?.(e, applicant)}
      onClick={() => onClick(applicant)}
      className={`bg-theme-surface-hover border rounded-lg p-3.5 cursor-pointer hover:border-theme-surface-border hover:bg-theme-surface-hover transition-all ${
        isDragging ? 'opacity-50 ring-2 ring-red-500' : ''
      } ${alertStyle ? alertStyle.border : 'border-theme-surface-border'}`}
    >
      {/* Inactivity Warning Banner */}
      {alertLevel !== 'normal' && (
        <div className={`flex items-center gap-1.5 mb-2 px-2 py-1 rounded text-xs ${
          alertLevel === 'critical'
            ? 'bg-red-500/10 text-red-700 dark:text-red-400'
            : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
        }`}>
          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
          <span>
            {alertLevel === 'critical' ? 'Approaching timeout' : 'Activity slowing'}
            {applicant.days_since_activity != null && ` — ${applicant.days_since_activity}d idle`}
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-theme-text-primary truncate">
              {applicant.first_name} {applicant.last_name}
            </p>
            <span className={`inline-block text-xs px-1.5 py-0.5 rounded ${STATUS_COLORS[applicant.status]}`}>
              {applicant.status.replace('_', ' ')}
            </span>
          </div>
        </div>
      </div>

      {/* Contact Info */}
      <div className="space-y-1 mb-2.5">
        {applicant.email && (
          <div className="flex items-center gap-1.5 text-xs text-theme-text-muted">
            <Mail className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{applicant.email}</span>
          </div>
        )}
        {applicant.phone && (
          <div className="flex items-center gap-1.5 text-xs text-theme-text-muted">
            <Phone className="w-3 h-3 flex-shrink-0" />
            <span>{applicant.phone}</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-theme-surface-border">
        <div className="flex items-center gap-1 text-xs text-theme-text-muted">
          <Clock className="w-3 h-3" />
          <span>
            {applicant.days_in_stage}d in stage
          </span>
        </div>
        {applicant.target_role_name && (
          <div className="flex items-center gap-1 text-xs text-theme-text-muted">
            <ArrowRight className="w-3 h-3" />
            <span className="truncate max-w-[80px]">{applicant.target_role_name}</span>
          </div>
        )}
      </div>
    </div>
  );
};
