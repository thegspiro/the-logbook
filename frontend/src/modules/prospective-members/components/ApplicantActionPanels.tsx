/**
 * Applicant Action Panels
 *
 * Status-conditional footer action sections for the ApplicantDetailDrawer.
 * Renders different action buttons based on applicant status:
 * Active, On Hold, Withdrawn, or Inactive.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router';
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
import { ApplicantStatus, StageType } from '../../../constants/enums';
import { getErrorMessage } from '../../../utils/errorHandling';

interface ApplicantActionPanelsProps {
  applicant: Applicant;
  isLastStage: boolean;
  isFirstStage: boolean;
  onClose: () => void;
  onConvert: (applicant: Applicant) => void;
}

const getStageRequirementHint = (applicant: Applicant): string | null => {
  const config = applicant.current_stage_config;
  if (!config || !applicant.current_stage_type) return null;

  switch (applicant.current_stage_type) {
    case StageType.CHECKLIST: {
      const count = 'items' in config ? config.items.length : 0;
      return count > 0 ? `Complete all ${count} checklist item${count === 1 ? '' : 's'} before advancing.` : null;
    }
    case StageType.INTERVIEW_REQUIREMENT: {
      const count = 'required_count' in config ? config.required_count : 1;
      return `Record ${count} required interview${count === 1 ? '' : 's'} before advancing.`;
    }
    case StageType.MULTI_APPROVAL: {
      const roles = 'required_approvers' in config ? config.required_approvers : [];
      return roles.length > 0
        ? `Waiting for approval from: ${roles.map((role) => role.replace(/_/g, ' ')).join(', ')}.`
        : null;
    }
    case StageType.REFERENCE_CHECK: {
      const count = 'required_count' in config ? config.required_count : 1;
      return `Complete ${count} reference check${count === 1 ? '' : 's'} before advancing.`;
    }
    case StageType.MEDICAL_SCREENING: {
      const screenings = 'required_screenings' in config ? config.required_screenings : [];
      return screenings.length > 0
        ? `Required screenings: ${screenings.map((screening) => screening.replace(/_/g, ' ')).join(', ')}.`
        : null;
    }
    default:
      return null;
  }
};

export const ApplicantActionPanels: React.FC<ApplicantActionPanelsProps> = ({
  applicant,
  isLastStage,
  isFirstStage,
  onClose,
  onConvert,
}) => {
  const navigate = useNavigate();
  const stageRequirementHint = getStageRequirementHint(applicant);

  const {
    advanceApplicant,
    regressApplicant,
    rejectApplicant,
    holdApplicant,
    resumeApplicant,
    withdrawApplicant,
    reactivateApplicant,
    fetchApplicants,
    fetchApplicant,
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

  const isActionInProgress =
    isAdvancing || isRegressing || isRejecting || isHolding || isResuming || isWithdrawing || isSkipping;

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
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to advance applicant'));
    }
  };

  const handleRegress = async () => {
    try {
      await regressApplicant(applicant.id, actionNotes || undefined);
      toast.success('Applicant moved back to previous stage');
      setActionNotes('');
      setShowNotesInput(false);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to move applicant back'));
    }
  };

  const handleSkipStage = async () => {
    setIsSkipping(true);
    try {
      await applicantService.skipStep(applicant.id, actionNotes || undefined);
      await Promise.all([fetchApplicants(), fetchApplicant(applicant.id)]);
      toast.success('Stage skipped');
      setShowSkipConfirm(false);
      setActionNotes('');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to skip stage'));
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
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to reject applicant'));
    }
  };

  const handleHold = async () => {
    try {
      await holdApplicant(applicant.id, actionNotes || undefined);
      toast.success('Applicant put on hold');
      setActionNotes('');
      setShowNotesInput(false);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to put applicant on hold'));
    }
  };

  const handleResume = async () => {
    try {
      await resumeApplicant(applicant.id);
      toast.success('Applicant resumed');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to resume applicant'));
    }
  };

  const handleReactivate = async () => {
    try {
      await reactivateApplicant(applicant.id, actionNotes || undefined);
      toast.success('Application reactivated');
      setActionNotes('');
      setShowNotesInput(false);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to reactivate application'));
    }
  };

  const handleWithdraw = async () => {
    try {
      await withdrawApplicant(applicant.id, actionNotes || undefined);
      toast.success(`${applicant.first_name}'s application withdrawn`);
      setActionNotes('');
      setShowNotesInput(false);
      setShowWithdrawConfirm(false);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to withdraw application'));
    }
  };

  return (
    <>
      {/* Active Status Actions */}
      {applicant.status === ApplicantStatus.ACTIVE && (
        <div className="border-theme-surface-border space-y-3 border-t p-4">
          {stageRequirementHint && !isLastStage && (
            <div className="border-theme-surface-border bg-theme-surface-hover rounded-lg border p-3">
              <p className="text-theme-text-secondary text-xs font-medium">Before advancing</p>
              <p className="text-theme-text-muted mt-1 text-xs">{stageRequirementHint}</p>
            </div>
          )}
          {/* Notes input */}
          {showNotesInput && (
            <div className="flex items-start gap-2">
              <MessageSquare className="text-theme-text-muted mt-2.5 h-4 w-4" />
              <textarea
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                placeholder="Add notes for this action..."
                rows={2}
                className="bg-theme-surface border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring flex-1 resize-none rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
              />
            </div>
          )}

          {/* Withdraw confirmation */}
          {showWithdrawConfirm && (
            <div className="bg-theme-surface-secondary border-theme-surface-border rounded-lg border p-3">
              <p className="text-theme-text-secondary mb-2 text-sm">
                Withdraw this application? The applicant will be archived and removed from the active pipeline.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowWithdrawConfirm(false)}
                  className="text-theme-text-secondary hover:text-theme-text-primary px-3 py-1.5 text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    void handleWithdraw();
                  }}
                  disabled={isWithdrawing}
                  className="bg-theme-surface-hover hover:bg-theme-surface text-theme-text-primary border-theme-surface-border flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-50"
                >
                  {isWithdrawing && <Loader2 className="h-3 w-3 animate-spin" />}
                  Confirm Withdraw
                </button>
              </div>
            </div>
          )}

          {/* Skip stage confirmation */}
          {showSkipConfirm && (
            <div className="rounded-lg border border-purple-500/20 bg-purple-500/10 p-3">
              <p className="mb-2 text-sm text-purple-600 dark:text-purple-300">
                Skip the current stage? This will mark it as completed and advance the applicant.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowSkipConfirm(false)}
                  className="text-theme-text-secondary hover:text-theme-text-primary px-3 py-1.5 text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    void handleSkipStage();
                  }}
                  disabled={isSkipping}
                  className="flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
                >
                  {isSkipping && <Loader2 className="h-3 w-3 animate-spin" />}
                  Confirm Skip
                </button>
              </div>
            </div>
          )}

          {/* Reject confirmation */}
          {showRejectConfirm && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3">
              <p className="mb-2 text-sm text-red-600 dark:text-red-300">
                Are you sure you want to reject this applicant? This action cannot be easily undone.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowRejectConfirm(false)}
                  className="text-theme-text-secondary hover:text-theme-text-primary px-3 py-1.5 text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    void handleReject();
                  }}
                  disabled={isRejecting}
                  className="btn-primary flex items-center gap-1 px-3 py-1.5 text-xs"
                >
                  {isRejecting && <Loader2 className="h-3 w-3 animate-spin" />}
                  Confirm Reject
                </button>
              </div>
            </div>
          )}

          <div className="action-bar">
            <button
              onClick={() => setShowNotesInput(!showNotesInput)}
              className="text-theme-text-muted hover:text-theme-text-primary p-2 transition-colors"
              title="Add notes"
            >
              <MessageSquare className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                onClose();
                void navigate(`/prospective-members/${applicant.id}/interview`);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-blue-500/30 px-3 py-2 text-sm text-blue-500 transition-colors hover:bg-blue-500/10"
              title="Open interview view"
            >
              <ClipboardList className="h-3.5 w-3.5" />
              <span className="action-label">Interview</span>
            </button>

            {!isFirstStage && (
              <button
                onClick={() => {
                  void handleRegress();
                }}
                disabled={isActionInProgress}
                className="text-theme-text-muted border-theme-surface-border hover:bg-theme-surface-hover flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50"
                title="Move back to previous stage"
              >
                {isRegressing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowLeft className="h-3.5 w-3.5" />
                )}
                <span className="action-label">Back</span>
              </button>
            )}

            <div className="flex-1" />

            <button
              onClick={() => setShowWithdrawConfirm(true)}
              disabled={isActionInProgress}
              className="text-theme-text-muted border-theme-surface-border hover:bg-theme-surface-hover flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50"
              title="Withdraw application"
            >
              <Archive className="h-3.5 w-3.5" />
              <span className="action-label">Withdraw</span>
            </button>
            <button
              onClick={() => {
                void handleHold();
              }}
              disabled={isActionInProgress}
              className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 px-3 py-2 text-sm text-amber-700 transition-colors hover:bg-amber-500/10 disabled:opacity-50 dark:text-amber-400"
            >
              {isHolding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
              <span className="action-label">Hold</span>
            </button>
            {!isLastStage && (
              <button
                onClick={() => setShowSkipConfirm(true)}
                disabled={isActionInProgress}
                className="flex items-center gap-1.5 rounded-lg border border-purple-500/30 px-3 py-2 text-sm text-purple-700 transition-colors hover:bg-purple-500/10 disabled:opacity-50 dark:text-purple-400"
                title="Skip this stage and advance"
              >
                {isSkipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                <span className="action-label">Skip</span>
              </button>
            )}
            <button
              onClick={() => setShowRejectConfirm(true)}
              disabled={isActionInProgress}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-700 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
            >
              <XCircle className="h-3.5 w-3.5" />
              <span className="action-label">Reject</span>
            </button>
            <button
              onClick={() => {
                void handleAdvance();
              }}
              disabled={isActionInProgress}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {isAdvancing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
              {isLastStage ? 'Convert' : 'Advance'}
            </button>
          </div>
        </div>
      )}

      {/* On Hold Actions */}
      {applicant.status === ApplicantStatus.ON_HOLD && (
        <div className="border-theme-surface-border space-y-3 border-t p-4">
          {showNotesInput && (
            <div className="flex items-start gap-2">
              <MessageSquare className="text-theme-text-muted mt-2.5 h-4 w-4" />
              <textarea
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                placeholder="Add notes for this action..."
                rows={2}
                className="bg-theme-surface border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring flex-1 resize-none rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
              />
            </div>
          )}
          {showWithdrawConfirm && (
            <div className="bg-theme-surface-secondary border-theme-surface-border rounded-lg border p-3">
              <p className="text-theme-text-secondary mb-2 text-sm">
                Withdraw this application? The applicant will be archived and removed from the active pipeline.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowWithdrawConfirm(false)}
                  className="text-theme-text-secondary hover:text-theme-text-primary px-3 py-1.5 text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    void handleWithdraw();
                  }}
                  disabled={isWithdrawing}
                  className="bg-theme-surface-hover hover:bg-theme-surface text-theme-text-primary border-theme-surface-border flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-50"
                >
                  {isWithdrawing && <Loader2 className="h-3 w-3 animate-spin" />}
                  Confirm Withdraw
                </button>
              </div>
            </div>
          )}
          {showRejectConfirm && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3">
              <p className="mb-2 text-sm text-red-600 dark:text-red-300">
                Are you sure you want to reject this applicant? This action cannot be easily undone.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowRejectConfirm(false)}
                  className="text-theme-text-secondary hover:text-theme-text-primary px-3 py-1.5 text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    void handleReject();
                  }}
                  disabled={isRejecting}
                  className="btn-primary flex items-center gap-1 px-3 py-1.5 text-xs"
                >
                  {isRejecting && <Loader2 className="h-3 w-3 animate-spin" />}
                  Confirm Reject
                </button>
              </div>
            </div>
          )}
          <div className="action-bar">
            <button
              onClick={() => setShowNotesInput(!showNotesInput)}
              className="text-theme-text-muted hover:text-theme-text-primary p-2 transition-colors"
              title="Add notes"
            >
              <MessageSquare className="h-4 w-4" />
            </button>
            <div className="flex-1" />
            <button
              onClick={() => setShowWithdrawConfirm(true)}
              disabled={isActionInProgress}
              className="text-theme-text-muted border-theme-surface-border hover:bg-theme-surface-hover flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50"
              title="Withdraw application"
            >
              <Archive className="h-3.5 w-3.5" />
              <span className="action-label">Withdraw</span>
            </button>
            <button
              onClick={() => setShowRejectConfirm(true)}
              disabled={isActionInProgress}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-700 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
            >
              <XCircle className="h-3.5 w-3.5" />
              <span className="action-label">Reject</span>
            </button>
            <button
              onClick={() => {
                void handleResume();
              }}
              disabled={isActionInProgress}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {isResuming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Resume
            </button>
          </div>
        </div>
      )}

      {/* Withdrawn Actions */}
      {applicant.status === ApplicantStatus.WITHDRAWN && (
        <div className="border-theme-surface-border space-y-3 border-t p-4">
          {showNotesInput && (
            <div className="flex items-start gap-2">
              <MessageSquare className="text-theme-text-muted mt-2.5 h-4 w-4" />
              <textarea
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                placeholder="Add notes for reactivation..."
                rows={2}
                className="bg-theme-surface border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring flex-1 resize-none rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
              />
            </div>
          )}
          <div className="action-bar">
            <button
              onClick={() => setShowNotesInput(!showNotesInput)}
              className="text-theme-text-muted hover:text-theme-text-primary p-2 transition-colors"
              title="Add notes"
            >
              <MessageSquare className="h-4 w-4" />
            </button>
            <div className="flex-1" />
            <button
              onClick={() => {
                void handleReactivate();
              }}
              disabled={isReactivating}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {isReactivating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              Reactivate
            </button>
          </div>
        </div>
      )}

      {/* Inactive Actions */}
      {applicant.status === ApplicantStatus.INACTIVE && (
        <div className="border-theme-surface-border space-y-3 border-t p-4">
          {showNotesInput && (
            <div className="flex items-start gap-2">
              <MessageSquare className="text-theme-text-muted mt-2.5 h-4 w-4" />
              <textarea
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                placeholder="Add notes for reactivation..."
                rows={2}
                className="bg-theme-surface border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring flex-1 resize-none rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
              />
            </div>
          )}
          {showRejectConfirm && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3">
              <p className="mb-2 text-sm text-red-600 dark:text-red-300">
                Are you sure you want to reject this applicant?
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowRejectConfirm(false)}
                  className="text-theme-text-secondary hover:text-theme-text-primary px-3 py-1.5 text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    void handleReject();
                  }}
                  disabled={isRejecting}
                  className="btn-primary flex items-center gap-1 px-3 py-1.5 text-xs"
                >
                  {isRejecting && <Loader2 className="h-3 w-3 animate-spin" />}
                  Confirm Reject
                </button>
              </div>
            </div>
          )}
          <div className="action-bar">
            <button
              onClick={() => setShowNotesInput(!showNotesInput)}
              className="text-theme-text-muted hover:text-theme-text-primary p-2 transition-colors"
              title="Add notes"
            >
              <MessageSquare className="h-4 w-4" />
            </button>
            <div className="flex-1" />
            <button
              onClick={() => setShowRejectConfirm(true)}
              disabled={isRejecting || isReactivating}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-700 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
            >
              <XCircle className="h-3.5 w-3.5" />
              <span className="action-label">Reject</span>
            </button>
            <button
              onClick={() => {
                void handleReactivate();
              }}
              disabled={isReactivating}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {isReactivating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              Reactivate
            </button>
          </div>
        </div>
      )}
    </>
  );
};
