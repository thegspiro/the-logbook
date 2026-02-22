/**
 * Applicant Detail Drawer
 *
 * Side panel showing full applicant details, stage history,
 * and stage-specific actions.
 */

import React, { useState, useEffect, useCallback } from 'react';
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
  EyeOff,
  Eye,
  Archive,
  Activity,
  Pencil,
  Save,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type {
  Applicant,
  StageType,
  StageHistoryEntry,
} from '../types';
import { isSafeUrl, getInitials } from '../types';
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';
import { applicantService } from '../services/api';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, formatDateTime } from '../../../utils/dateFormatting';
import { ApplicantStatus, StageType as StageTypeEnum, ElectionStatus } from '../../../constants/enums';

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
  const tz = useTimezone();

  const {
    advanceApplicant,
    rejectApplicant,
    holdApplicant,
    resumeApplicant,
    withdrawApplicant,
    reactivateApplicant,
    fetchElectionPackage,
    updateElectionPackage,
    submitElectionPackage,
    currentElectionPackage,
    isLoadingElectionPackage,
    isAdvancing,
    isRejecting,
    isHolding,
    isResuming,
    isWithdrawing,
    isReactivating,
    isLoadingApplicant,
  } = useProspectiveMembersStore();

  const [actionNotes, setActionNotes] = useState('');
  const [showNotesInput, setShowNotesInput] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);
  const [showPii, setShowPii] = useState(true);
  const [pkgNotes, setPkgNotes] = useState('');
  const [pkgStatement, setPkgStatement] = useState('');
  const [isSubmittingPackage, setIsSubmittingPackage] = useState(false);
  const [activityLog, setActivityLog] = useState<Array<{ id: string; action: string; details: Record<string, unknown>; performer_name: string; created_at: string }>>([]);
  const [isLoadingActivity, setIsLoadingActivity] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);

  // Editable contact info state
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [isSavingContact, setIsSavingContact] = useState(false);
  const [editFields, setEditFields] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    date_of_birth: '',
    address_street: '',
    address_city: '',
    address_state: '',
    address_zip: '',
  });

  const isOnElectionStage = applicant?.current_stage_type === StageTypeEnum.ELECTION_VOTE && applicant?.status === ApplicantStatus.ACTIVE;

  // Reset action notes and confirm state when applicant changes
  useEffect(() => {
    setActionNotes('');
    setShowNotesInput(false);
    setShowRejectConfirm(false);
    setShowWithdrawConfirm(false);
    setIsEditingContact(false);
  }, [applicant?.id]);

  const startEditingContact = () => {
    if (!applicant) return;
    setEditFields({
      first_name: applicant.first_name,
      last_name: applicant.last_name,
      email: applicant.email,
      phone: applicant.phone ?? '',
      date_of_birth: applicant.date_of_birth ?? '',
      address_street: applicant.address?.street ?? '',
      address_city: applicant.address?.city ?? '',
      address_state: applicant.address?.state ?? '',
      address_zip: applicant.address?.zip_code ?? '',
    });
    setIsEditingContact(true);
  };

  const saveContactEdits = async () => {
    if (!applicant) return;
    setIsSavingContact(true);
    try {
      await applicantService.updateApplicant(applicant.id, {
        first_name: editFields.first_name,
        last_name: editFields.last_name,
        email: editFields.email,
        phone: editFields.phone || undefined,
        date_of_birth: editFields.date_of_birth || undefined,
        address: {
          street: editFields.address_street || undefined,
          city: editFields.address_city || undefined,
          state: editFields.address_state || undefined,
          zip_code: editFields.address_zip || undefined,
        },
      });
      toast.success('Contact info updated');
      setIsEditingContact(false);
      // Refresh the applicant data
      const { refreshApplicant } = useProspectiveMembersStore.getState();
      if (refreshApplicant) {
        refreshApplicant(applicant.id);
      }
    } catch {
      toast.error('Failed to update contact info');
    } finally {
      setIsSavingContact(false);
    }
  };

  // Load election package when applicant is on an election stage
  useEffect(() => {
    if (isOnElectionStage && applicant) {
      fetchElectionPackage(applicant.id);
    }
  }, [applicant?.id, isOnElectionStage, fetchElectionPackage]);

  // Sync package fields to local state when package loads
  useEffect(() => {
    if (currentElectionPackage) {
      setPkgNotes(currentElectionPackage.coordinator_notes ?? '');
      setPkgStatement(currentElectionPackage.supporting_statement ?? '');
    } else {
      setPkgNotes('');
      setPkgStatement('');
    }
  }, [currentElectionPackage?.id]);

  const fetchActivityLog = useCallback(async () => {
    if (!applicant) return;
    setIsLoadingActivity(true);
    try {
      const data = await applicantService.getActivity(applicant.id, 50);
      setActivityLog(data);
    } catch {
      // Silently fail - activity log is non-critical
      setActivityLog([]);
    } finally {
      setIsLoadingActivity(false);
    }
  }, [applicant?.id]);

  // Load activity log when toggled open
  useEffect(() => {
    if (showActivityLog && applicant && activityLog.length === 0) {
      fetchActivityLog();
    }
  }, [showActivityLog, applicant?.id, fetchActivityLog]);

  // Reset activity log when applicant changes
  useEffect(() => {
    setActivityLog([]);
    setShowActivityLog(false);
  }, [applicant?.id]);

  if (!isOpen) return null;

  const isActionInProgress = isAdvancing || isRejecting || isHolding || isResuming || isWithdrawing;

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
      setShowRejectConfirm(false);
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

  const handleWithdraw = async () => {
    if (!applicant) return;
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

  const handleSavePackage = async () => {
    if (!applicant || !currentElectionPackage) return;
    try {
      await updateElectionPackage(applicant.id, {
        coordinator_notes: pkgNotes || undefined,
        supporting_statement: pkgStatement || undefined,
      });
      toast.success('Election package saved');
    } catch {
      toast.error('Failed to save election package');
    }
  };

  const handleSubmitPackage = async () => {
    if (!applicant) return;
    setIsSubmittingPackage(true);
    try {
      // Save any pending edits first
      if (currentElectionPackage) {
        await updateElectionPackage(applicant.id, {
          coordinator_notes: pkgNotes || undefined,
          supporting_statement: pkgStatement || undefined,
        });
      }
      await submitElectionPackage(applicant.id);
      toast.success('Election package marked as ready for ballot');
    } catch {
      toast.error('Failed to submit election package');
    } finally {
      setIsSubmittingPackage(false);
    }
  };

  const maskValue = (value: string) => showPii ? value : '••••••••';

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-full max-w-lg bg-theme-bg border-l border-theme-surface-border z-50 flex flex-col shadow-2xl">
        {/* Loading */}
        {isLoadingApplicant && (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-red-500" />
          </div>
        )}

        {applicant && !isLoadingApplicant && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-theme-surface-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center text-sm font-bold text-white">
                  {getInitials(applicant.first_name, applicant.last_name)}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-theme-text-primary">
                    {applicant.first_name} {applicant.last_name}
                  </h2>
                  <p className="text-sm text-theme-text-muted capitalize">
                    {applicant.status.replace('_', ' ')} &middot;{' '}
                    {applicant.target_membership_type} member
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowPii(!showPii)}
                  className="text-theme-text-muted hover:text-theme-text-primary transition-colors"
                  title={showPii ? 'Hide personal info' : 'Show personal info'}
                >
                  {showPii ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button
                  onClick={onClose}
                  className="text-theme-text-muted hover:text-theme-text-primary transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Inactive Notice */}
            {applicant.status === ApplicantStatus.INACTIVE && (
              <div className="mx-4 mt-4 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-medium text-amber-600 dark:text-amber-300">Application Inactive</span>
                </div>
                <p className="text-xs text-theme-text-muted">
                  This application was marked inactive due to no activity
                  {applicant.deactivated_at && (
                    <> since {formatDate(applicant.deactivated_at, tz)}</>
                  )}.
                  A coordinator can reactivate it, or the individual may resubmit an interest form.
                </p>
                {applicant.reactivated_at && (
                  <p className="text-xs text-theme-text-muted mt-1">
                    Previously reactivated on {formatDate(applicant.reactivated_at, tz)}
                  </p>
                )}
              </div>
            )}

            {/* Withdrawn Notice */}
            {applicant.status === ApplicantStatus.WITHDRAWN && (
              <div className="mx-4 mt-4 p-3 bg-slate-500/5 border border-slate-500/20 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <Archive className="w-4 h-4 text-theme-text-muted" />
                  <span className="text-sm font-medium text-theme-text-secondary">Application Withdrawn</span>
                </div>
                <p className="text-xs text-theme-text-muted">
                  This applicant voluntarily withdrew from the pipeline
                  {applicant.withdrawn_at && (
                    <> on {formatDate(applicant.withdrawn_at, tz)}</>
                  )}.
                </p>
                {applicant.withdrawal_reason && (
                  <p className="text-xs text-theme-text-muted mt-1">
                    Reason: {applicant.withdrawal_reason}
                  </p>
                )}
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {/* Contact Info */}
              <div className="p-4 border-b border-theme-surface-border">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                    Contact Information
                  </h3>
                  {!isEditingContact ? (
                    <button
                      onClick={startEditingContact}
                      className="flex items-center gap-1 text-xs text-theme-text-muted hover:text-theme-text-primary transition-colors"
                    >
                      <Pencil className="w-3 h-3" />
                      Edit
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setIsEditingContact(false)}
                        className="text-xs text-theme-text-muted hover:text-theme-text-primary transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={saveContactEdits}
                        disabled={isSavingContact}
                        className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-500 disabled:opacity-50 transition-colors"
                      >
                        {isSavingContact ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        Save
                      </button>
                    </div>
                  )}
                </div>

                {isEditingContact ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={editFields.first_name}
                        onChange={(e) => setEditFields((f) => ({ ...f, first_name: e.target.value }))}
                        placeholder="First name"
                        className="w-full px-2 py-1.5 text-sm bg-theme-input-bg border border-theme-surface-border rounded text-theme-text-primary"
                      />
                      <input
                        type="text"
                        value={editFields.last_name}
                        onChange={(e) => setEditFields((f) => ({ ...f, last_name: e.target.value }))}
                        placeholder="Last name"
                        className="w-full px-2 py-1.5 text-sm bg-theme-input-bg border border-theme-surface-border rounded text-theme-text-primary"
                      />
                    </div>
                    <input
                      type="email"
                      value={editFields.email}
                      onChange={(e) => setEditFields((f) => ({ ...f, email: e.target.value }))}
                      placeholder="Email"
                      className="w-full px-2 py-1.5 text-sm bg-theme-input-bg border border-theme-surface-border rounded text-theme-text-primary"
                    />
                    <input
                      type="text"
                      value={editFields.phone}
                      onChange={(e) => setEditFields((f) => ({ ...f, phone: e.target.value }))}
                      placeholder="Phone"
                      className="w-full px-2 py-1.5 text-sm bg-theme-input-bg border border-theme-surface-border rounded text-theme-text-primary"
                    />
                    <input
                      type="date"
                      value={editFields.date_of_birth}
                      onChange={(e) => setEditFields((f) => ({ ...f, date_of_birth: e.target.value }))}
                      className="w-full px-2 py-1.5 text-sm bg-theme-input-bg border border-theme-surface-border rounded text-theme-text-primary"
                    />
                    <input
                      type="text"
                      value={editFields.address_street}
                      onChange={(e) => setEditFields((f) => ({ ...f, address_street: e.target.value }))}
                      placeholder="Street address"
                      className="w-full px-2 py-1.5 text-sm bg-theme-input-bg border border-theme-surface-border rounded text-theme-text-primary"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={editFields.address_city}
                        onChange={(e) => setEditFields((f) => ({ ...f, address_city: e.target.value }))}
                        placeholder="City"
                        className="w-full px-2 py-1.5 text-sm bg-theme-input-bg border border-theme-surface-border rounded text-theme-text-primary"
                      />
                      <input
                        type="text"
                        value={editFields.address_state}
                        onChange={(e) => setEditFields((f) => ({ ...f, address_state: e.target.value }))}
                        placeholder="State"
                        className="w-full px-2 py-1.5 text-sm bg-theme-input-bg border border-theme-surface-border rounded text-theme-text-primary"
                      />
                      <input
                        type="text"
                        value={editFields.address_zip}
                        onChange={(e) => setEditFields((f) => ({ ...f, address_zip: e.target.value }))}
                        placeholder="ZIP"
                        className="w-full px-2 py-1.5 text-sm bg-theme-input-bg border border-theme-surface-border rounded text-theme-text-primary"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="w-4 h-4 text-theme-text-muted" />
                      <span className="text-theme-text-secondary">{maskValue(applicant.email)}</span>
                    </div>
                    {applicant.phone && (
                      <div className="flex items-center gap-2 text-sm">
                        <Phone className="w-4 h-4 text-theme-text-muted" />
                        <span className="text-theme-text-secondary">{maskValue(applicant.phone)}</span>
                      </div>
                    )}
                    {applicant.date_of_birth && (
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="w-4 h-4 text-theme-text-muted" />
                        <span className="text-theme-text-secondary">
                          DOB: {showPii ? formatDate(applicant.date_of_birth, tz) : '••/••/••••'}
                        </span>
                      </div>
                    )}
                    {applicant.address?.city && (
                      <div className="flex items-center gap-2 text-sm">
                        <MapPin className="w-4 h-4 text-theme-text-muted" />
                        <span className="text-theme-text-secondary">
                          {showPii
                            ? [applicant.address.street, applicant.address.city, applicant.address.state, applicant.address.zip_code]
                                .filter(Boolean)
                                .join(', ')
                            : '••••••••'}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Current Stage */}
              <div className="p-4 border-b border-theme-surface-border">
                <h3 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-3">
                  Current Stage
                </h3>
                <div className="bg-theme-surface rounded-lg p-3 border border-theme-surface-border">
                  <div className="flex items-center gap-2 mb-1">
                    {applicant.current_stage_type && (
                      (() => {
                        const Icon = STAGE_TYPE_ICONS[applicant.current_stage_type];
                        return <Icon className="w-4 h-4 text-red-400" />;
                      })()
                    )}
                    <span className="text-sm font-medium text-theme-text-primary">
                      {applicant.current_stage_name ?? 'Unknown stage'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-theme-text-muted mt-1">
                    <Clock className="w-3 h-3" />
                    Entered {formatDateTime(applicant.stage_entered_at, tz)}
                  </div>
                </div>

                {/* Target Role */}
                {applicant.target_role_name && (
                  <div className="mt-3 flex items-center gap-2 text-sm text-theme-text-muted">
                    <User className="w-4 h-4" />
                    Target role: <span className="text-theme-text-secondary">{applicant.target_role_name}</span>
                  </div>
                )}
              </div>

              {/* Election Package Section */}
              {isOnElectionStage && (
                <div className="p-4 border-b border-theme-surface-border">
                  <h3 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-3">
                    Election Package
                  </h3>
                  {isLoadingElectionPackage ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" />
                    </div>
                  ) : currentElectionPackage ? (
                    <div className="space-y-3">
                      {/* Package status badge */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-theme-text-muted">Status</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          currentElectionPackage.status === 'draft'
                            ? 'bg-slate-500/20 text-theme-text-muted'
                            : currentElectionPackage.status === 'ready'
                              ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300'
                              : currentElectionPackage.status === 'added_to_ballot'
                                ? 'bg-purple-500/20 text-purple-600 dark:text-purple-300'
                                : currentElectionPackage.status === 'elected'
                                  ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300'
                                  : 'bg-red-500/20 text-red-600 dark:text-red-300'
                        }`}>
                          {currentElectionPackage.status.replace(/_/g, ' ')}
                        </span>
                      </div>

                      {/* Applicant snapshot info */}
                      <div className="bg-theme-surface rounded-lg p-3 text-xs space-y-1">
                        <div className="flex justify-between">
                          <span className="text-theme-text-muted">Name</span>
                          <span className="text-theme-text-secondary">{currentElectionPackage.applicant_name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-theme-text-muted">Membership Type</span>
                          <span className="text-theme-text-secondary capitalize">{currentElectionPackage.target_membership_type}</span>
                        </div>
                        {currentElectionPackage.target_role_name && (
                          <div className="flex justify-between">
                            <span className="text-theme-text-muted">Target Role</span>
                            <span className="text-theme-text-secondary">{currentElectionPackage.target_role_name}</span>
                          </div>
                        )}
                        {currentElectionPackage.documents && currentElectionPackage.documents.length > 0 && (
                          <div className="pt-1">
                            <span className="text-theme-text-muted">Documents:</span>
                            <div className="mt-1 space-y-0.5">
                              {currentElectionPackage.documents.map((doc, i) => (
                                <div key={i} className="flex items-center gap-1 text-blue-400">
                                  <FileText className="w-3 h-3" />
                                  {isSafeUrl(doc.url) ? (
                                    <a href={doc.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                                      {doc.name}
                                    </a>
                                  ) : (
                                    <span>{doc.name}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Editable fields — only for draft packages */}
                      {currentElectionPackage.status === 'draft' && (
                        <>
                          <div>
                            <label className="block text-xs text-theme-text-muted mb-1">
                              Coordinator Notes
                            </label>
                            <textarea
                              value={pkgNotes}
                              onChange={(e) => setPkgNotes(e.target.value)}
                              placeholder="Internal notes about this applicant..."
                              rows={2}
                              className="w-full bg-theme-surface border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-theme-text-muted mb-1">
                              Supporting Statement
                            </label>
                            <textarea
                              value={pkgStatement}
                              onChange={(e) => setPkgStatement(e.target.value)}
                              placeholder="Statement shown to voters on the ballot..."
                              rows={2}
                              className="w-full bg-theme-surface border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                            />
                          </div>
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              onClick={handleSavePackage}
                              className="px-3 py-1.5 text-xs text-theme-text-secondary border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors"
                            >
                              Save Draft
                            </button>
                            <button
                              onClick={handleSubmitPackage}
                              disabled={isSubmittingPackage}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors disabled:opacity-50"
                            >
                              {isSubmittingPackage && <Loader2 className="w-3 h-3 animate-spin" />}
                              <Vote className="w-3 h-3" />
                              Mark Ready for Ballot
                            </button>
                          </div>
                        </>
                      )}

                      {/* Ready state info */}
                      {currentElectionPackage.status === 'ready' && (
                        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                          <p className="text-xs text-emerald-600 dark:text-emerald-300">
                            This package is ready for the secretary to add to a ballot.
                            {currentElectionPackage.submitted_at && (
                              <> Submitted {formatDateTime(currentElectionPackage.submitted_at, tz)}.</>
                            )}
                          </p>
                          {currentElectionPackage.coordinator_notes && (
                            <p className="text-xs text-theme-text-muted mt-1">
                              Notes: {currentElectionPackage.coordinator_notes}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Added to ballot info */}
                      {(currentElectionPackage.status === 'added_to_ballot' ||
                        currentElectionPackage.status === 'elected' ||
                        currentElectionPackage.status === 'not_elected') && (
                        <div className={`border rounded-lg p-3 ${
                          currentElectionPackage.status === 'elected'
                            ? 'bg-emerald-500/5 border-emerald-500/20'
                            : currentElectionPackage.status === 'not_elected'
                              ? 'bg-red-500/5 border-red-500/20'
                              : 'bg-purple-500/5 border-purple-500/20'
                        }`}>
                          <p className={`text-xs ${
                            currentElectionPackage.status === 'elected'
                              ? 'text-emerald-600 dark:text-emerald-300'
                              : currentElectionPackage.status === 'not_elected'
                                ? 'text-red-600 dark:text-red-300'
                                : 'text-purple-600 dark:text-purple-300'
                          }`}>
                            {currentElectionPackage.status === 'added_to_ballot' &&
                              'This applicant has been added to a ballot and is awaiting election results.'}
                            {currentElectionPackage.status === 'elected' &&
                              'This applicant was elected. They can now be converted to a member.'}
                            {currentElectionPackage.status === 'not_elected' &&
                              'This applicant was not elected by the membership vote.'}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-theme-text-muted">
                      No election package has been created yet. It will be auto-generated when the applicant reaches this stage.
                    </p>
                  )}
                </div>
              )}

              {/* Stage History Timeline */}
              <div className="p-4 border-b border-theme-surface-border">
                <h3 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-3">
                  Stage History
                </h3>
                {applicant.stage_history.length === 0 ? (
                  <p className="text-sm text-theme-text-muted">No history yet.</p>
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
                                <Circle className="w-5 h-5 text-slate-400 dark:text-slate-600 flex-shrink-0" />
                              )}
                              {idx < applicant.stage_history.length - 1 && (
                                <div className="w-px h-full min-h-[24px] bg-theme-surface-border my-1" />
                              )}
                            </div>

                            {/* Content */}
                            <div className="pb-4 min-w-0">
                              <p className={`text-sm font-medium ${isComplete ? 'text-theme-text-secondary' : isCurrent ? 'text-theme-text-primary' : 'text-theme-text-muted'}`}>
                                {entry.stage_name}
                              </p>
                              <p className="text-xs text-theme-text-muted mt-0.5">
                                Entered {formatDateTime(entry.entered_at, tz)}
                                {entry.completed_at && (
                                  <> &middot; Completed {formatDateTime(entry.completed_at, tz)}</>
                                )}
                              </p>
                              {entry.completed_by_name && (
                                <p className="text-xs text-theme-text-muted mt-0.5">
                                  By {entry.completed_by_name}
                                </p>
                              )}
                              {entry.notes && (
                                <p className="text-xs text-theme-text-muted mt-1 bg-theme-surface-secondary rounded px-2 py-1">
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
                                      {artifact.url && isSafeUrl(artifact.url) ? (
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
                <div className="p-4 border-b border-theme-surface-border">
                  <h3 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-2">
                    Notes
                  </h3>
                  <p className="text-sm text-theme-text-secondary">{applicant.notes}</p>
                </div>
              )}

              {/* Activity Log */}
              <div className="p-4 border-b border-theme-surface-border">
                <button
                  onClick={() => setShowActivityLog(!showActivityLog)}
                  className="flex items-center gap-2 w-full text-left"
                >
                  <Activity className="w-3.5 h-3.5 text-theme-text-muted" />
                  <h3 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                    Activity Log
                  </h3>
                  <span className="text-xs text-theme-text-muted ml-auto">
                    {showActivityLog ? '▾' : '▸'}
                  </span>
                </button>
                {showActivityLog && (
                  <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
                    {isLoadingActivity ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="w-4 h-4 animate-spin text-theme-text-muted" />
                      </div>
                    ) : activityLog.length === 0 ? (
                      <p className="text-xs text-theme-text-muted py-2">No activity recorded yet.</p>
                    ) : (
                      activityLog.map((entry) => (
                        <div key={entry.id} className="flex items-start gap-2 text-xs">
                          <div className="w-1.5 h-1.5 rounded-full bg-theme-text-muted mt-1.5 shrink-0" />
                          <div className="min-w-0">
                            <span className="text-theme-text-secondary font-medium">{entry.action}</span>
                            {entry.performer_name && (
                              <span className="text-theme-text-muted"> by {entry.performer_name}</span>
                            )}
                            <div className="text-theme-text-muted">
                              {formatDateTime(entry.created_at, tz)}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Metadata */}
              <div className="p-4">
                <h3 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-2">
                  Details
                </h3>
                <div className="text-xs text-theme-text-muted space-y-1">
                  <p>Applied: {formatDate(applicant.created_at, tz)}</p>
                  <p>Last updated: {formatDate(applicant.updated_at, tz)}</p>
                  <p>Last activity: {formatDate(applicant.last_activity_at, tz)}</p>
                  {applicant.pipeline_name && (
                    <p>Pipeline: {applicant.pipeline_name}</p>
                  )}
                  {applicant.deactivated_at && (
                    <p>Deactivated: {formatDate(applicant.deactivated_at, tz)}</p>
                  )}
                  {applicant.reactivated_at && (
                    <p>Last reactivated: {formatDate(applicant.reactivated_at, tz)}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Footer Actions */}
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
                      className="flex-1 bg-theme-surface border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                    />
                  </div>
                )}

                {/* Withdraw confirmation */}
                {showWithdrawConfirm && (
                  <div className="bg-slate-500/10 border border-slate-500/20 rounded-lg p-3">
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
                        onClick={handleWithdraw}
                        disabled={isWithdrawing}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors disabled:opacity-50"
                      >
                        {isWithdrawing && <Loader2 className="w-3 h-3 animate-spin" />}
                        Confirm Withdraw
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
                        onClick={handleReject}
                        disabled={isRejecting}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
                      >
                        {isRejecting && <Loader2 className="w-3 h-3 animate-spin" />}
                        Confirm Reject
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2">
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
                    Withdraw
                  </button>
                  <button
                    onClick={handleHold}
                    disabled={isActionInProgress}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-amber-400 border border-amber-500/30 rounded-lg hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                  >
                    {isHolding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pause className="w-3.5 h-3.5" />}
                    Hold
                  </button>
                  <button
                    onClick={() => setShowRejectConfirm(true)}
                    disabled={isActionInProgress}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Reject
                  </button>
                  <button
                    onClick={handleAdvance}
                    disabled={isActionInProgress}
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
              <div className="border-t border-theme-surface-border p-4 space-y-3">
                {showNotesInput && (
                  <div className="flex items-start gap-2">
                    <MessageSquare className="w-4 h-4 text-theme-text-muted mt-2.5" />
                    <textarea
                      value={actionNotes}
                      onChange={(e) => setActionNotes(e.target.value)}
                      placeholder="Add notes for this action..."
                      rows={2}
                      className="flex-1 bg-theme-surface border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                    />
                  </div>
                )}
                {showWithdrawConfirm && (
                  <div className="bg-slate-500/10 border border-slate-500/20 rounded-lg p-3">
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
                        onClick={handleWithdraw}
                        disabled={isWithdrawing}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors disabled:opacity-50"
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
                        onClick={handleReject}
                        disabled={isRejecting}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
                      >
                        {isRejecting && <Loader2 className="w-3 h-3 animate-spin" />}
                        Confirm Reject
                      </button>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2">
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
                    Withdraw
                  </button>
                  <button
                    onClick={() => setShowRejectConfirm(true)}
                    disabled={isActionInProgress}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Reject
                  </button>
                  <button
                    onClick={handleResume}
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
                      className="flex-1 bg-theme-surface border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                    />
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowNotesInput(!showNotesInput)}
                    className="p-2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
                    title="Add notes"
                  >
                    <MessageSquare className="w-4 h-4" />
                  </button>
                  <div className="flex-1" />
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
                      className="flex-1 bg-theme-surface border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
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
                        onClick={handleReject}
                        disabled={isRejecting}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
                      >
                        {isRejecting && <Loader2 className="w-3 h-3 animate-spin" />}
                        Confirm Reject
                      </button>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2">
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
