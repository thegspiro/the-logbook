/**
 * Applicant Card
 *
 * Card component for kanban board display of an applicant.
 */

import React from 'react';
import { Clock, Mail, Phone, ArrowRight, AlertTriangle } from 'lucide-react';
import type { ApplicantListItem, InactivityAlertLevel } from '../types';
import { APPLICANT_STATUS_COLORS } from '../constants';
import { getInitials } from '../utils';

interface ApplicantCardProps {
  applicant: ApplicantListItem;
  onClick: (applicant: ApplicantListItem) => void;
  onDragStart?: (e: React.DragEvent, applicant: ApplicantListItem) => void;
  isDragging?: boolean;
}

const ALERT_LEVEL_STYLES: Record<InactivityAlertLevel, { border: string; icon: string } | null> = {
  normal: null,
  warning: { border: 'border-amber-500/40', icon: 'text-amber-700 dark:text-amber-400' },
  critical: { border: 'border-red-500/40', icon: 'text-red-700 dark:text-red-400' },
};

export const ApplicantCard: React.FC<ApplicantCardProps> = ({ applicant, onClick, onDragStart, isDragging }) => {
  const initials = getInitials(applicant.first_name, applicant.last_name);
  const alertLevel = applicant.inactivity_alert_level ?? 'normal';
  const alertStyle = ALERT_LEVEL_STYLES[alertLevel];

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${applicant.first_name} ${applicant.last_name}, ${applicant.status}`}
      draggable={!!onDragStart}
      onDragStart={(e) => onDragStart?.(e, applicant)}
      onClick={() => onClick(applicant)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(applicant);
        }
      }}
      className={`bg-theme-surface-hover hover:border-theme-surface-border hover:bg-theme-surface-hover cursor-pointer rounded-lg border p-3.5 transition-all ${
        isDragging ? 'opacity-50 ring-2 ring-red-500' : ''
      } ${alertStyle ? alertStyle.border : 'border-theme-surface-border'}`}
    >
      {/* Inactivity Warning Banner */}
      {alertLevel !== 'normal' && (
        <div
          className={`mb-2 flex items-center gap-1.5 rounded px-2 py-1 text-xs ${
            alertLevel === 'critical'
              ? 'bg-red-500/10 text-red-700 dark:text-red-400'
              : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
          }`}
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span>
            {alertLevel === 'critical' ? 'Approaching timeout' : 'Activity slowing'}
            {applicant.days_since_activity != null && ` — ${applicant.days_since_activity}d idle`}
          </span>
        </div>
      )}

      {/* Header */}
      <div className="mb-2 flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-red-500 to-red-700 text-xs font-bold text-white">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-theme-text-primary truncate text-sm font-medium">
              {applicant.first_name} {applicant.last_name}
            </p>
            <span
              className={`inline-block rounded-sm px-1.5 py-0.5 text-xs ${APPLICANT_STATUS_COLORS[applicant.status]}`}
            >
              {applicant.status.replace('_', ' ')}
            </span>
          </div>
        </div>
      </div>

      {/* Contact Info */}
      <div className="mb-2.5 space-y-1">
        {applicant.email && (
          <div className="text-theme-text-muted flex items-center gap-1.5 text-xs">
            <Mail className="h-3 w-3 shrink-0" />
            <span className="truncate">{applicant.email}</span>
          </div>
        )}
        {applicant.phone && (
          <div className="text-theme-text-muted flex items-center gap-1.5 text-xs">
            <Phone className="h-3 w-3 shrink-0" />
            <span>{applicant.phone}</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-theme-surface-border flex items-center justify-between border-t pt-2">
        <div className="text-theme-text-muted flex items-center gap-1 text-xs">
          <Clock className="h-3 w-3" />
          <span>{applicant.days_in_stage}d in stage</span>
        </div>
        {applicant.target_role_name && (
          <div className="text-theme-text-muted flex items-center gap-1 text-xs">
            <ArrowRight className="h-3 w-3" />
            <span className="max-w-[80px] truncate">{applicant.target_role_name}</span>
          </div>
        )}
      </div>
    </div>
  );
};
