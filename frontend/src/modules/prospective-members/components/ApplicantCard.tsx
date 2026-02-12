/**
 * Applicant Card
 *
 * Card component for kanban board display of an applicant.
 */

import React from 'react';
import { Clock, Mail, Phone, ArrowRight } from 'lucide-react';
import type { ApplicantListItem, ApplicantStatus } from '../types';

interface ApplicantCardProps {
  applicant: ApplicantListItem;
  onClick: (applicant: ApplicantListItem) => void;
  onDragStart?: (e: React.DragEvent, applicant: ApplicantListItem) => void;
  isDragging?: boolean;
}

const STATUS_COLORS: Record<ApplicantStatus, string> = {
  active: 'bg-emerald-500/20 text-emerald-400',
  on_hold: 'bg-amber-500/20 text-amber-400',
  withdrawn: 'bg-slate-500/20 text-slate-400',
  converted: 'bg-blue-500/20 text-blue-400',
  rejected: 'bg-red-500/20 text-red-400',
};

export const ApplicantCard: React.FC<ApplicantCardProps> = ({
  applicant,
  onClick,
  onDragStart,
  isDragging,
}) => {
  const initials = `${applicant.first_name[0]}${applicant.last_name[0]}`.toUpperCase();

  return (
    <div
      draggable={!!onDragStart}
      onDragStart={(e) => onDragStart?.(e, applicant)}
      onClick={() => onClick(applicant)}
      className={`bg-slate-700/80 border border-white/10 rounded-lg p-3.5 cursor-pointer hover:border-white/20 hover:bg-slate-700 transition-all ${
        isDragging ? 'opacity-50 ring-2 ring-red-500' : ''
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">
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
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Mail className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{applicant.email}</span>
          </div>
        )}
        {applicant.phone && (
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Phone className="w-3 h-3 flex-shrink-0" />
            <span>{applicant.phone}</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-white/5">
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <Clock className="w-3 h-3" />
          <span>
            {applicant.days_in_stage}d in stage
          </span>
        </div>
        {applicant.target_role_name && (
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <ArrowRight className="w-3 h-3" />
            <span className="truncate max-w-[80px]">{applicant.target_role_name}</span>
          </div>
        )}
      </div>
    </div>
  );
};
