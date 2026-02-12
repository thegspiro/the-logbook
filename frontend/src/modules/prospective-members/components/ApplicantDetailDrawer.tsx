/**
 * Applicant Detail Drawer
 *
 * Side panel showing full applicant details, stage history,
 * and stage-specific actions.
 */

import React, { useState } from 'react';
import {
  X,
  Mail,
  Phone,
  Calendar,
  MapPin,
  CheckCircle2,
  Circle,
  ArrowRight,
  Pause,
  XCircle,
  Play,
  FileText,
  Upload,
  Vote,
  CheckCircle,
  Clock,
  User,
  Loader2,
  MessageSquare,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type {
  Applicant,
  StageType,
  StageHistoryEntry,
} from '../types';
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';

interface ApplicantDetailDrawerProps {
  applicant: Applicant | null;
  isOpen: boolean;
  onClose: () => void;
  onConvert: (applicant: Applicant) => void;
  isLastStage: boolean;
}

const STAGE_TYPE_ICONS: Record<StageType, React.ElementType> = {
  form_submission: FileText,
  document_upload: Upload,
  election_vote: Vote,
  manual_approval: CheckCircle,
};

export const ApplicantDetailDrawer: React.FC<ApplicantDetailDrawerProps> = ({
  applicant,
  isOpen,
  onClose,
  onConvert,
  isLastStage,
}) => {
  const {
    advanceApplicant,
    rejectApplicant,
    holdApplicant,
    resumeApplicant,
    reactivateApplicant,
    isAdvancing,
    isReactivating,
    isLoadingApplicant,
  } = useProspectiveMembersStore();

  const [actionNotes, setActionNotes] = useState('');
  const [showNotesInput, setShowNotesInput] = useState(false);

  if (!isOpen) return null;

  const handleAdvance = async () => {
    if (!applicant) return;

    if (isLastStage) {
      onConvert(applicant);
      return;
    }

    try {
      await advanceApplicant(applicant.id, actionNotes || undefined);
      toast.success('Applicant advanced to next stage');
      setActionNotes('');
      setShowNotesInput(false);
    } catch {
      toast.error('Failed to advance applicant');
    }
  };

  const handleReject = async () => {
    if (!applicant) return;
    try {
      await rejectApplicant(applicant.id, actionNotes || undefined);
      toast.success('Applicant rejected');
      setActionNotes('');
      setShowNotesInput(false);
    } catch {
      toast.error('Failed to reject applicant');
    }
  };

  const handleHold = async () => {
    if (!applicant) return;
    try {
      await holdApplicant(applicant.id, actionNotes || undefined);
      toast.success('Applicant put on hold');
      setActionNotes('');
      setShowNotesInput(false);
    } catch {
      toast.error('Failed to put applicant on hold');
    }
  };

  const handleResume = async () => {
    if (!applicant) return;
    try {
      await resumeApplicant(applicant.id);
      toast.success('Applicant resumed');
    } catch {
      toast.error('Failed to resume applicant');
    }
  };

  const handleReactivate = async () => {
    if (!applicant) return;
    try {
      await reactivateApplicant(applicant.id, actionNotes || undefined);
      toast.success('Application reactivated');
      setActionNotes('');
      setShowNotesInput(false);
    } catch {
      toast.error('Failed to reactivate application');
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-full max-w-lg bg-slate-900 border-l border-white/10 z-50 flex flex-col shadow-2xl">
        {/* Loading */}
        {isLoadingApplicant && (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-red-500" />
          </div>
        )}

        {applicant && !isLoadingApplicant && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center text-sm font-bold text-white">
                  {applicant.first_name[0]}{applicant.last_name[0]}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">
                    {applicant.first_name} {applicant.last_name}
                  </h2>
                  <p className="text-sm text-slate-400 capitalize">
                    {applicant.status.replace('_', ' ')} &middot;{' '}
                    {applicant.target_membership_type} member
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Inactive Notice */}
            {applicant.status === 'inactive' && (
              <div className="mx-4 mt-4 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-medium text-amber-300">Application Inactive</span>
                </div>
                <p className="text-xs text-slate-400">
                  This application was marked inactive due to no activity
                  {applicant.deactivated_at && (
                    <> since {formatDate(applicant.deactivated_at)}</>
                  )}.
                  A coordinator can reactivate it, or the individual may resubmit an interest form.
                </p>
                {applicant.reactivated_at && (
                  <p className="text-xs text-slate-500 mt-1">
                    Previously reactivated on {formatDate(applicant.reactivated_at)}
                  </p>
                )}
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {/* Contact Info */}
              <div className="p-4 border-b border-white/10">
                <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">
                  Contact Information
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="w-4 h-4 text-slate-500" />
                    <span className="text-slate-300">{applicant.email}</span>
                  </div>
                  {applicant.phone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="w-4 h-4 text-slate-500" />
                      <span className="text-slate-300">{applicant.phone}</span>
                    </div>
                  )}
                  {applicant.date_of_birth && (
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="w-4 h-4 text-slate-500" />
                      <span className="text-slate-300">
                        DOB: {formatDate(applicant.date_of_birth)}
                      </span>
                    </div>
                  )}
                  {applicant.address?.city && (
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="w-4 h-4 text-slate-500" />
                      <span className="text-slate-300">
                        {[applicant.address.street, applicant.address.city, applicant.address.state, applicant.address.zip_code]
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Current Stage */}
              <div className="p-4 border-b border-white/10">
                <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">
                  Current Stage
                </h3>
                <div className="bg-slate-800 rounded-lg p-3 border border-white/10">
                  <div className="flex items-center gap-2 mb-1">
                    {applicant.current_stage_type && (
                      (() => {
                        const Icon = STAGE_TYPE_ICONS[applicant.current_stage_type];
                        return <Icon className="w-4 h-4 text-red-400" />;
                      })()
                    )}
                    <span className="text-sm font-medium text-white">
                      {applicant.current_stage_name ?? 'Unknown stage'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-slate-400 mt-1">
                    <Clock className="w-3 h-3" />
                    Entered {formatDateTime(applicant.stage_entered_at)}
                  </div>
                </div>

                {/* Target Role */}
                {applicant.target_role_name && (
                  <div className="mt-3 flex items-center gap-2 text-sm text-slate-400">
                    <User className="w-4 h-4" />
                    Target role: <span className="text-slate-300">{applicant.target_role_name}</span>
                  </div>
                )}
              </div>

              {/* Stage History Timeline */}
              <div className="p-4 border-b border-white/10">
                <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">
                  Stage History
                </h3>
                {applicant.stage_history.length === 0 ? (
                  <p className="text-sm text-slate-500">No history yet.</p>
                ) : (
                  <div className="space-y-0">
                    {applicant.stage_history.map(
                      (entry: StageHistoryEntry, idx: number) => {
                        const isComplete = !!entry.completed_at;
                        const isCurrent = idx === applicant.stage_history.length - 1 && !isComplete;

                        return (
                          <div key={entry.id} className="flex gap-3">
                            {/* Timeline line */}
                            <div className="flex flex-col items-center">
                              {isComplete ? (
                                <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                              ) : isCurrent ? (
                                <div className="w-5 h-5 rounded-full border-2 border-red-500 bg-red-500/20 flex-shrink-0" />
                              ) : (
                                <Circle className="w-5 h-5 text-slate-600 flex-shrink-0" />
                              )}
                              {idx < applicant.stage_history.length - 1 && (
                                <div className="w-px h-full min-h-[24px] bg-white/10 my-1" />
                              )}
                            </div>

                            {/* Content */}
                            <div className="pb-4 min-w-0">
                              <p className={`text-sm font-medium ${isComplete ? 'text-slate-300' : isCurrent ? 'text-white' : 'text-slate-500'}`}>
                                {entry.stage_name}
                              </p>
                              <p className="text-xs text-slate-500 mt-0.5">
                                Entered {formatDateTime(entry.entered_at)}
                                {entry.completed_at && (
                                  <> &middot; Completed {formatDateTime(entry.completed_at)}</>
                                )}
                              </p>
                              {entry.completed_by_name && (
                                <p className="text-xs text-slate-500 mt-0.5">
                                  By {entry.completed_by_name}
                                </p>
                              )}
                              {entry.notes && (
                                <p className="text-xs text-slate-400 mt-1 bg-slate-800/50 rounded px-2 py-1">
                                  {entry.notes}
                                </p>
                              )}
                              {entry.artifacts.length > 0 && (
                                <div className="mt-1 space-y-1">
                                  {entry.artifacts.map((artifact) => (
                                    <div
                                      key={artifact.id}
                                      className="flex items-center gap-1 text-xs text-blue-400"
                                    >
                                      <FileText className="w-3 h-3" />
                                      {artifact.url ? (
                                        <a
                                          href={artifact.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="hover:underline"
                                        >
                                          {artifact.name}
                                        </a>
                                      ) : (
                                        <span>{artifact.name}</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      }
                    )}
                  </div>
                )}
              </div>

              {/* Notes */}
              {applicant.notes && (
                <div className="p-4 border-b border-white/10">
                  <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
                    Notes
                  </h3>
                  <p className="text-sm text-slate-300">{applicant.notes}</p>
                </div>
              )}

              {/* Metadata */}
              <div className="p-4">
                <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
                  Details
                </h3>
                <div className="text-xs text-slate-500 space-y-1">
                  <p>Applied: {formatDate(applicant.created_at)}</p>
                  <p>Last updated: {formatDate(applicant.updated_at)}</p>
                  <p>Last activity: {formatDate(applicant.last_activity_at)}</p>
                  <p>Pipeline: {applicant.pipeline_name ?? applicant.pipeline_id}</p>
                  {applicant.deactivated_at && (
                    <p>Deactivated: {formatDate(applicant.deactivated_at)}</p>
                  )}
                  {applicant.reactivated_at && (
                    <p>Last reactivated: {formatDate(applicant.reactivated_at)}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            {applicant.status === 'active' && (
              <div className="border-t border-white/10 p-4 space-y-3">
                {/* Notes input */}
                {showNotesInput && (
                  <div className="flex items-start gap-2">
                    <MessageSquare className="w-4 h-4 text-slate-400 mt-2.5" />
                    <textarea
                      value={actionNotes}
                      onChange={(e) => setActionNotes(e.target.value)}
                      placeholder="Add notes for this action..."
                      rows={2}
                      className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                    />
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowNotesInput(!showNotesInput)}
                    className="p-2 text-slate-400 hover:text-white transition-colors"
                    title="Add notes"
                  >
                    <MessageSquare className="w-4 h-4" />
                  </button>

                  <div className="flex-1" />

                  <button
                    onClick={handleHold}
                    disabled={isAdvancing}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-amber-400 border border-amber-500/30 rounded-lg hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    Hold
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={isAdvancing}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Reject
                  </button>
                  <button
                    onClick={handleAdvance}
                    disabled={isAdvancing}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isAdvancing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5" />
                    )}
                    {isLastStage ? 'Convert to Member' : 'Advance'}
                  </button>
                </div>
              </div>
            )}

            {/* On Hold Actions */}
            {applicant.status === 'on_hold' && (
              <div className="border-t border-white/10 p-4">
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={handleReject}
                    disabled={isAdvancing}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Reject
                  </button>
                  <button
                    onClick={handleResume}
                    disabled={isAdvancing}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Resume
                  </button>
                </div>
              </div>
            )}

            {/* Inactive Actions */}
            {applicant.status === 'inactive' && (
              <div className="border-t border-white/10 p-4 space-y-3">
                {showNotesInput && (
                  <div className="flex items-start gap-2">
                    <MessageSquare className="w-4 h-4 text-slate-400 mt-2.5" />
                    <textarea
                      value={actionNotes}
                      onChange={(e) => setActionNotes(e.target.value)}
                      placeholder="Add notes for reactivation..."
                      rows={2}
                      className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                    />
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowNotesInput(!showNotesInput)}
                    className="p-2 text-slate-400 hover:text-white transition-colors"
                    title="Add notes"
                  >
                    <MessageSquare className="w-4 h-4" />
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={handleReject}
                    disabled={isAdvancing}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Reject
                  </button>
                  <button
                    onClick={handleReactivate}
                    disabled={isReactivating}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isReactivating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3.5 h-3.5" />
                    )}
                    Reactivate
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
};
