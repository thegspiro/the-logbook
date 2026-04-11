/**
 * Applicant Action Panels
 *
 * Status-conditional footer action sections for the ApplicantDetailDrawer.
 * Renders different action buttons based on applicant status:
 * Active, On Hold, Withdrawn, or Inactive.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Pause,
  XCircle,
  Play,
  Loader2,
  MessageSquare,
  RotateCcw,
  Archive,
  ClipboardList,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { Applicant } from '../types';
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';
import { applicantService } from '../services/api';
import { ApplicantStatus } from '../../../constants/enums';

interface ApplicantActionPanelsProps {
  applicant: Applicant;
  isLastStage: boolean;
  isFirstStage: boolean;
  onClose: () => void;
  onConvert: (applicant: Applicant) => void;
}

export const ApplicantActionPanels: React.FC<ApplicantActionPanelsProps> = ({
  applicant,
  isLastStage,
  isFirstStage,
  onClose,
  onConvert,
}) => {
  const navigate = useNavigate();

  const {
    advanceApplicant,
    regressApplicant,
    rejectApplicant,
    holdApplicant,
    resumeApplicant,
    withdrawApplicant,
    reactivateApplicant,
    isAdvancing,
    isRegressing,
    isRejecting,
    isHolding,
    isResuming,
    isWithdrawing,
    isReactivating,
  } = useProspectiveMembersStore();

  const [actionNotes, setActionNotes] = useState('');
  const [showNotesInput, setShowNotesInput] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);

  const isActionInProgress = isAdvancing || isRegressing || isRejecting || isHolding || isResuming || isWithdrawing || isSkipping;

  const handleAdvance = async () => {
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

  const handleRegress = async () => {
    try {
      await regressApplicant(applicant.id, actionNotes || undefined);
      toast.success('Applicant moved back to previous stage');
      setActionNotes('');
      setShowNotesInput(false);
    } catch {
      toast.error('Failed to move applicant back');
    }
  };

  const handleSkipStage = async () => {
    setIsSkipping(true);
    try {
      if (applicant.current_stage_id) {
        await applicantService.completeStep(
          applicant.id,
          applicant.current_stage_id,
          `Stage skipped by coordinator${actionNotes ? `: ${actionNotes}` : ''}`
        );
      }
      await advanceApplicant(applicant.id, 'Stage skipped');
      toast.success('Stage skipped');
      setShowSkipConfirm(false);
      setActionNotes('');
    } catch {
      toast.error('Failed to skip stage');
    } finally {
      setIsSkipping(false);
    }
  };

  const handleReject = async () => {
    try {
      await rejectApplicant(applicant.id, actionNotes || undefined);
      toast.success('Applicant rejected');
      setActionNotes('');
      setShowNotesInput(false);
      setShowRejectConfirm(false);
    } catch {
      toast.error('Failed to reject applicant');
    }
  };

  const handleHold = async () => {
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
    try {
      await resumeApplicant(applicant.id);
      toast.success('Applicant resumed');
    } catch {
      toast.error('Failed to resume applicant');
    }
  };

  const handleReactivate = async () => {
    try {
      await reactivateApplicant(applicant.id, actionNotes || undefined);
      toast.success('Application reactivated');
      setActionNotes('');
      setShowNotesInput(false);
    } catch {
      toast.error('Failed to reactivate application');
    }
  };

  const handleWithdraw = async () => {
    try {
      await withdrawApplicant(applicant.id, actionNotes || undefined);
      toast.success(`${applicant.first_name}'s application withdrawn`);
      setActionNotes('');
      setShowNotesInput(false);
      setShowWithdrawConfirm(false);
    } catch {
      toast.error('Failed to withdraw application');
    }
  };

  return (
    <>
      {/* Active Status Actions */}
      {applicant.status === ApplicantStatus.ACTIVE && (
        <div className="border-t border-theme-surface-border p-4 space-y-3">
          {/* Notes input */}
          {showNotesInput && (
            <div className="flex items-start gap-2">
              <MessageSquare className="w-4 h-4 text-theme-text-muted mt-2.5" />
              <textarea
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                placeholder="Add notes for this action..."
                rows={2}
                className="flex-1 bg-theme-surface border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring resize-none"
              />
            </div>
          )}

          {/* Withdraw confirmation */}
          {showWithdrawConfirm && (
            <div className="bg-theme-surface-secondary border border-theme-surface-border rounded-lg p-3">
              <p className="text-sm text-theme-text-secondary mb-2">
                Withdraw this application? The applicant will be archived and removed from the active pipeline.
              </p>
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setShowWithdrawConfirm(false)}
                  className="px-3 py-1.5 text-xs text-theme-text-secondary hover:text-theme-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { void handleWithdraw(); }}
                  disabled={isWithdrawing}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-theme-surface-hover hover:bg-theme-surface text-theme-text-primary border border-theme-surface-border rounded-lg transition-colors disabled:opacity-50"
                >
                  {isWithdrawing && <Loader2 className="w-3 h-3 animate-spin" />}
                  Confirm Withdraw
                </button>
              </div>
            </div>
          )}

          {/* Skip stage confirmation */}
          {showSkipConfirm && (
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3">
              <p className="text-sm text-purple-600 dark:text-purple-300 mb-2">
                Skip the current stage? This will mark it as completed and advance the applicant.
              </p>
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setShowSkipConfirm(false)}
                  className="px-3 py-1.5 text-xs text-theme-text-secondary hover:text-theme-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { void handleSkipStage(); }}
                  disabled={isSkipping}
                  className="px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors disabled:opacity-50 flex gap-1 items-center"
                >
                  {isSkipping && <Loader2 className="w-3 h-3 animate-spin" />}
                  Confirm Skip
                </button>
              </div>
            </div>
          )}

          {/* Reject confirmation */}
          {showRejectConfirm && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <p className="text-sm text-red-600 dark:text-red-300 mb-2">
                Are you sure you want to reject this applicant? This action cannot be easily undone.
              </p>
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setShowRejectConfirm(false)}
                  className="px-3 py-1.5 text-xs text-theme-text-secondary hover:text-theme-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { void handleReject(); }}
                  disabled={isRejecting}
                  className="btn-primary flex gap-1 items-center px-3 py-1.5 text-xs"
                >
                  {isRejecting && <Loader2 className="w-3 h-3 animate-spin" />}
                  Confirm Reject
                </button>
              </div>
            </div>
          )}

          <div className="action-bar">
            <button
              onClick={() => setShowNotesInput(!showNotesInput)}
              className="p-2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
              title="Add notes"
            >
              <MessageSquare className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                onClose();
                navigate(`/prospective-members/${applicant.id}/interview`);
              }}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-blue-500 border border-blue-500/30 rounded-lg hover:bg-blue-500/10 transition-colors"
              title="Open interview view"
            >
              <ClipboardList className="w-3.5 h-3.5" />
              <span className="action-label">Interview</span>
            </button>

            {!isFirstStage && (
              <button
                onClick={() => { void handleRegress(); }}
                disabled={isActionInProgress}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-theme-text-muted border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors disabled:opacity-50"
                title="Move back to previous stage"
              >
                {isRegressing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowLeft className="w-3.5 h-3.5" />}
                <span className="action-label">Back</span>
              </button>
            )}

            <div className="flex-1" />

            <button
              onClick={() => setShowWithdrawConfirm(true)}
              disabled={isActionInProgress}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-theme-text-muted border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors disabled:opacity-50"
              title="Withdraw application"
            >
              <Archive className="w-3.5 h-3.5" />
              <span className="action-label">Withdraw</span>
            </button>
            <button
              onClick={() => { void handleHold(); }}
              disabled={isActionInProgress}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400 border border-amber-500/30 rounded-lg hover:bg-amber-500/10 transition-colors disabled:opacity-50"
            >
              {isHolding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pause className="w-3.5 h-3.5" />}
              <span className="action-label">Hold</span>
            </button>
            <button
              onClick={() => setShowSkipConfirm(true)}
              disabled={isActionInProgress}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-purple-700 dark:text-purple-400 border border-purple-500/30 rounded-lg hover:bg-purple-500/10 transition-colors disabled:opacity-50"
              title="Skip this stage and advance"
            >
              {isSkipping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
              <span className="action-label">Skip</span>
            </button>
            <button
              onClick={() => setShowRejectConfirm(true)}
              disabled={isActionInProgress}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-700 dark:text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span className="action-label">Reject</span>
            </button>
            <button
              onClick={() => { void handleAdvance(); }}
              disabled={isActionInProgress}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {isAdvancing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ArrowRight className="w-3.5 h-3.5" />
              )}
              {isLastStage ? 'Convert' : 'Advance'}
            </button>
          </div>
        </div>
      )}

      {/* On Hold Actions */}
      {applicant.status === ApplicantStatus.ON_HOLD && (
        <div className="border-t border-theme-surface-border p-4 space-y-3">
          {showNotesInput && (
            <div className="flex items-start gap-2">
              <MessageSquare className="w-4 h-4 text-theme-text-muted mt-2.5" />
              <textarea
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                placeholder="Add notes for this action..."
                rows={2}
                className="flex-1 bg-theme-surface border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring resize-none"
              />
            </div>
          )}
          {showWithdrawConfirm && (
            <div className="bg-theme-surface-secondary border border-theme-surface-border rounded-lg p-3">
              <p className="text-sm text-theme-text-secondary mb-2">
                Withdraw this application? The applicant will be archived and removed from the active pipeline.
              </p>
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setShowWithdrawConfirm(false)}
                  className="px-3 py-1.5 text-xs text-theme-text-secondary hover:text-theme-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { void handleWithdraw(); }}
                  disabled={isWithdrawing}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-theme-surface-hover hover:bg-theme-surface text-theme-text-primary border border-theme-surface-border rounded-lg transition-colors disabled:opacity-50"
                >
                  {isWithdrawing && <Loader2 className="w-3 h-3 animate-spin" />}
                  Confirm Withdraw
                </button>
              </div>
            </div>
          )}
          {showRejectConfirm && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <p className="text-sm text-red-600 dark:text-red-300 mb-2">
                Are you sure you want to reject this applicant? This action cannot be easily undone.
              </p>
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setShowRejectConfirm(false)}
                  className="px-3 py-1.5 text-xs text-theme-text-secondary hover:text-theme-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { void handleReject(); }}
                  disabled={isRejecting}
                  className="btn-primary flex gap-1 items-center px-3 py-1.5 text-xs"
                >
                  {isRejecting && <Loader2 className="w-3 h-3 animate-spin" />}
                  Confirm Reject
                </button>
              </div>
            </div>
          )}
          <div className="action-bar">
            <button
              onClick={() => setShowNotesInput(!showNotesInput)}
              className="p-2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
              title="Add notes"
            >
              <MessageSquare className="w-4 h-4" />
            </button>
            <div className="flex-1" />
            <button
              onClick={() => setShowWithdrawConfirm(true)}
              disabled={isActionInProgress}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-theme-text-muted border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors disabled:opacity-50"
              title="Withdraw application"
            >
              <Archive className="w-3.5 h-3.5" />
              <span className="action-label">Withdraw</span>
            </button>
            <button
              onClick={() => setShowRejectConfirm(true)}
              disabled={isActionInProgress}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-700 dark:text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span className="action-label">Reject</span>
            </button>
            <button
              onClick={() => { void handleResume(); }}
              disabled={isActionInProgress}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {isResuming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Resume
            </button>
          </div>
        </div>
      )}

      {/* Withdrawn Actions */}
      {applicant.status === ApplicantStatus.WITHDRAWN && (
        <div className="border-t border-theme-surface-border p-4 space-y-3">
          {showNotesInput && (
            <div className="flex items-start gap-2">
              <MessageSquare className="w-4 h-4 text-theme-text-muted mt-2.5" />
              <textarea
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                placeholder="Add notes for reactivation..."
                rows={2}
                className="flex-1 bg-theme-surface border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring resize-none"
              />
            </div>
          )}
          <div className="action-bar">
            <button
              onClick={() => setShowNotesInput(!showNotesInput)}
              className="p-2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
              title="Add notes"
            >
              <MessageSquare className="w-4 h-4" />
            </button>
            <div className="flex-1" />
            <button
              onClick={() => { void handleReactivate(); }}
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

      {/* Inactive Actions */}
      {applicant.status === ApplicantStatus.INACTIVE && (
        <div className="border-t border-theme-surface-border p-4 space-y-3">
          {showNotesInput && (
            <div className="flex items-start gap-2">
              <MessageSquare className="w-4 h-4 text-theme-text-muted mt-2.5" />
              <textarea
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                placeholder="Add notes for reactivation..."
                rows={2}
                className="flex-1 bg-theme-surface border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring resize-none"
              />
            </div>
          )}
          {showRejectConfirm && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <p className="text-sm text-red-600 dark:text-red-300 mb-2">
                Are you sure you want to reject this applicant?
              </p>
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setShowRejectConfirm(false)}
                  className="px-3 py-1.5 text-xs text-theme-text-secondary hover:text-theme-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { void handleReject(); }}
                  disabled={isRejecting}
                  className="btn-primary flex gap-1 items-center px-3 py-1.5 text-xs"
                >
                  {isRejecting && <Loader2 className="w-3 h-3 animate-spin" />}
                  Confirm Reject
                </button>
              </div>
            </div>
          )}
          <div className="action-bar">
            <button
              onClick={() => setShowNotesInput(!showNotesInput)}
              className="p-2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
              title="Add notes"
            >
              <MessageSquare className="w-4 h-4" />
            </button>
            <div className="flex-1" />
            <button
              onClick={() => setShowRejectConfirm(true)}
              disabled={isRejecting || isReactivating}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-700 dark:text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span className="action-label">Reject</span>
            </button>
            <button
              onClick={() => { void handleReactivate(); }}
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
  );
};
