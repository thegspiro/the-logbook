/**
 * Applicant Detail Drawer
 *
 * Side panel showing full applicant details, stage history,
 * and stage-specific actions.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  Mail,
  Phone,
  Calendar,
  MapPin,
  CheckCircle2,
  Circle,
  ArrowLeft,
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
  CalendarCheck,
  Globe,
  ClipboardList,
  Link2,
  Trash2,
  CalendarPlus,
  Search,
  UserCheck,
  Users,
  Stethoscope,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type {
  Applicant,
  ProspectEventLink,
  StageType,
  StageHistoryEntry,
} from '../types';
import { isSafeUrl, getInitials } from '../utils';
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';
import { applicantService, eventLinkService } from '../services/api';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, formatDateTime } from '../../../utils/dateFormatting';
import { ApplicantStatus, StageType as StageTypeEnum, ElectionStatus } from '../../../constants/enums';
import { eventService } from '../../../services/eventServices';
import { electionService } from '../../../services/electionService';
import type { ElectionListItem } from '../../../types/election';
import type { EventListItem } from '../../../types/event';

/** Maps snake_case backend field keys to human-readable labels. */
const FORM_FIELD_LABELS: Record<string, string> = {
  first_name: 'First Name',
  last_name: 'Last Name',
  email: 'Email Address',
  phone: 'Phone Number',
  mobile: 'Mobile Number',
  date_of_birth: 'Date of Birth',
  address_street: 'Address',
  address_city: 'City',
  address_state: 'State',
  address_zip: 'Zip Code',
  interest_reason: 'Interest Reason',
  referral_source: 'Referral Source',
  referred_by: 'Referred By',
  desired_membership_type: 'Desired Membership Type',
};

/** Title-case fallback for keys not in FORM_FIELD_LABELS. */
function fieldLabel(key: string): string {
  return (
    FORM_FIELD_LABELS[key] ??
    key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/** Render a field value as a human-readable string. */
function formatFieldValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value || '—';
  if (Array.isArray(value)) return value.map(String).join(', ') || '—';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '—';
    }
  }
  return String(value as string | number);
}

interface ApplicantDetailDrawerProps {
  applicant: Applicant | null;
  isOpen: boolean;
  onClose: () => void;
  onConvert: (applicant: Applicant) => void;
  isLastStage: boolean;
  isFirstStage: boolean;
}

const STAGE_TYPE_ICONS: Record<StageType, React.ElementType> = {
  form_submission: FileText,
  document_upload: Upload,
  election_vote: Vote,
  manual_approval: CheckCircle,
  meeting: CalendarCheck,
  status_page_toggle: Globe,
  automated_email: Mail,
  reference_check: UserCheck,
  checklist: ClipboardList,
  interview_requirement: MessageSquare,
  multi_approval: Users,
  medical_screening: Stethoscope,
};

export const ApplicantDetailDrawer: React.FC<ApplicantDetailDrawerProps> = ({
  applicant,
  isOpen,
  onClose,
  onConvert,
  isLastStage,
  isFirstStage,
}) => {
  const tz = useTimezone();
  const navigate = useNavigate();

  const {
    advanceApplicant,
    regressApplicant,
    rejectApplicant,
    holdApplicant,
    resumeApplicant,
    withdrawApplicant,
    reactivateApplicant,
    fetchElectionPackage,
    updateElectionPackage,
    submitElectionPackage,
    assignPackageToElection,
    currentElectionPackage,
    isLoadingElectionPackage,
    isAdvancing,
    isRegressing,
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
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);
  const [showPii, setShowPii] = useState(true);
  const [pkgNotes, setPkgNotes] = useState('');
  const [pkgStatement, setPkgStatement] = useState('');
  const [isSubmittingPackage, setIsSubmittingPackage] = useState(false);
  const [activityLog, setActivityLog] = useState<Array<{ id: string; action: string; details: Record<string, unknown>; performer_name: string; created_at: string }>>([]);
  const [isLoadingActivity, setIsLoadingActivity] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);

  // Linked events state
  const [linkedEvents, setLinkedEvents] = useState<ProspectEventLink[]>([]);
  const [isLoadingLinkedEvents, setIsLoadingLinkedEvents] = useState(false);
  const [showEventPicker, setShowEventPicker] = useState(false);
  const [upcomingEvents, setUpcomingEvents] = useState<EventListItem[]>([]);
  const [isLoadingUpcoming, setIsLoadingUpcoming] = useState(false);
  const [eventSearchQuery, setEventSearchQuery] = useState('');

  // Election assignment state
  const [showElectionPicker, setShowElectionPicker] = useState(false);
  const [draftElections, setDraftElections] = useState<ElectionListItem[]>([]);
  const [isLoadingDraftElections, setIsLoadingDraftElections] = useState(false);
  const [selectedElectionId, setSelectedElectionId] = useState('');
  const [isAssigningToElection, setIsAssigningToElection] = useState(false);

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
      const { fetchApplicant } = useProspectiveMembersStore.getState();
      if (fetchApplicant) {
        void fetchApplicant(applicant.id);
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
      void fetchElectionPackage(applicant.id);
    }
  }, [applicant, isOnElectionStage, fetchElectionPackage]);

  // Sync package fields to local state when package loads
  useEffect(() => {
    if (currentElectionPackage) {
      setPkgNotes(currentElectionPackage.coordinator_notes ?? '');
      setPkgStatement(currentElectionPackage.supporting_statement ?? '');
    } else {
      setPkgNotes('');
      setPkgStatement('');
    }
  }, [currentElectionPackage]);

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
  }, [applicant]);

  // Load activity log when toggled open
  useEffect(() => {
    if (showActivityLog && applicant && activityLog.length === 0) {
      void fetchActivityLog();
    }
  }, [showActivityLog, applicant, activityLog.length, fetchActivityLog]);

  // Reset activity log when applicant changes
  useEffect(() => {
    setActivityLog([]);
    setShowActivityLog(false);
  }, [applicant?.id]);

  // Load linked events when applicant changes
  useEffect(() => {
    if (!applicant?.id) {
      setLinkedEvents([]);
      return;
    }
    setIsLoadingLinkedEvents(true);
    eventLinkService
      .getLinkedEvents(applicant.id)
      .then(setLinkedEvents)
      .catch(() => setLinkedEvents([]))
      .finally(() => setIsLoadingLinkedEvents(false));
  }, [applicant?.id]);

  const handleOpenEventPicker = async () => {
    setShowEventPicker(true);
    setEventSearchQuery('');
    setIsLoadingUpcoming(true);
    try {
      const now = new Date().toISOString();
      const events = await eventService.getEvents({
        end_after: now,
        include_cancelled: false,
        limit: 50,
      });
      setUpcomingEvents(events);
    } catch {
      setUpcomingEvents([]);
    } finally {
      setIsLoadingUpcoming(false);
    }
  };

  const handleLinkEvent = async (eventId: string) => {
    if (!applicant) return;
    try {
      const link = await eventLinkService.linkEvent(applicant.id, eventId);
      setLinkedEvents((prev) => [link, ...prev]);
      setShowEventPicker(false);
      toast.success('Event linked');
    } catch {
      toast.error('Failed to link event');
    }
  };

  const handleUnlinkEvent = async (linkId: string) => {
    if (!applicant) return;
    try {
      await eventLinkService.unlinkEvent(applicant.id, linkId);
      setLinkedEvents((prev) => prev.filter((l) => l.id !== linkId));
      toast.success('Event unlinked');
    } catch {
      toast.error('Failed to unlink event');
    }
  };

  // Refresh applicant data when the drawer becomes visible (catches
  // pipeline changes made by other coordinators or from settings page).
  useEffect(() => {
    if (isOpen && applicant?.id) {
      const { fetchApplicant } = useProspectiveMembersStore.getState();
      if (fetchApplicant) {
        void fetchApplicant(applicant.id);
      }
    }
    // Only re-run when drawer visibility changes, not on every applicant update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const isActionInProgress = isAdvancing || isRegressing || isRejecting || isHolding || isResuming || isWithdrawing || isSkipping;

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

  const handleRegress = async () => {
    if (!applicant) return;
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
    if (!applicant) return;
    setIsSkipping(true);
    try {
      // Complete current step then advance
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
      await holdApplicant(applicant.id, actionNotes ?? undefined);
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
          coordinator_notes: pkgNotes ?? undefined,
          supporting_statement: pkgStatement ?? undefined,
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

  const handleOpenElectionPicker = async () => {
    setShowElectionPicker(true);
    setIsLoadingDraftElections(true);
    try {
      const elections = await electionService.getElections('draft');
      setDraftElections(elections);
    } catch {
      toast.error('Failed to load draft elections');
    } finally {
      setIsLoadingDraftElections(false);
    }
  };

  const handleAssignToElection = async () => {
    if (!applicant || !selectedElectionId) return;
    setIsAssigningToElection(true);
    try {
      await assignPackageToElection(applicant.id, selectedElectionId);
      const electionTitle = draftElections.find(
        (e) => e.id === selectedElectionId
      )?.title ?? 'election';
      toast.success(`Application added to "${electionTitle}" ballot`);
      setShowElectionPicker(false);
      setSelectedElectionId('');
    } catch {
      toast.error('Failed to assign package to election');
    } finally {
      setIsAssigningToElection(false);
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
      <div className="drawer-panel">
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
                <div className="w-10 h-10 rounded-full bg-linear-to-br from-red-500 to-red-700 flex items-center justify-center text-sm font-bold text-white">
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
                  aria-label={showPii ? 'Hide personal info' : 'Show personal info'}
                >
                  {showPii ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                </button>
                <button
                  onClick={onClose}
                  className="text-theme-text-muted hover:text-theme-text-primary transition-colors"
                  aria-label="Close detail panel"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
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
              <div className="mx-4 mt-4 p-3 bg-theme-surface-secondary border border-theme-surface-border rounded-lg">
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
                        onClick={() => { void saveContactEdits(); }}
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
                    <div className="form-grid-2">
                      <input
                        type="text"
                        value={editFields.first_name}
                        onChange={(e) => setEditFields((f) => ({ ...f, first_name: e.target.value }))}
                        placeholder="First name"
                        aria-label="First name"
                        className="w-full px-2 py-1.5 text-sm bg-theme-input-bg border border-theme-surface-border rounded-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                      />
                      <input
                        type="text"
                        value={editFields.last_name}
                        onChange={(e) => setEditFields((f) => ({ ...f, last_name: e.target.value }))}
                        placeholder="Last name"
                        aria-label="Last name"
                        className="w-full px-2 py-1.5 text-sm bg-theme-input-bg border border-theme-surface-border rounded-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                      />
                    </div>
                    <input
                      type="email"
                      value={editFields.email}
                      onChange={(e) => setEditFields((f) => ({ ...f, email: e.target.value }))}
                      placeholder="Email"
                      aria-label="Email address"
                      className="w-full px-2 py-1.5 text-sm bg-theme-input-bg border border-theme-surface-border rounded-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                    />
                    <input
                      type="text"
                      value={editFields.phone}
                      onChange={(e) => setEditFields((f) => ({ ...f, phone: e.target.value }))}
                      placeholder="Phone"
                      aria-label="Phone number"
                      className="w-full px-2 py-1.5 text-sm bg-theme-input-bg border border-theme-surface-border rounded-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                    />
                    <input
                      type="date"
                      value={editFields.date_of_birth}
                      onChange={(e) => setEditFields((f) => ({ ...f, date_of_birth: e.target.value }))}
                      aria-label="Date of birth"
                      className="w-full px-2 py-1.5 text-sm bg-theme-input-bg border border-theme-surface-border rounded-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                    />
                    <input
                      type="text"
                      value={editFields.address_street}
                      onChange={(e) => setEditFields((f) => ({ ...f, address_street: e.target.value }))}
                      placeholder="Street address"
                      aria-label="Street address"
                      className="w-full px-2 py-1.5 text-sm bg-theme-input-bg border border-theme-surface-border rounded-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                    />
                    <div className="form-grid-3">
                      <input
                        type="text"
                        value={editFields.address_city}
                        onChange={(e) => setEditFields((f) => ({ ...f, address_city: e.target.value }))}
                        placeholder="City"
                        aria-label="City"
                        className="w-full px-2 py-1.5 text-sm bg-theme-input-bg border border-theme-surface-border rounded-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                      />
                      <input
                        type="text"
                        value={editFields.address_state}
                        onChange={(e) => setEditFields((f) => ({ ...f, address_state: e.target.value }))}
                        placeholder="State"
                        aria-label="State"
                        className="w-full px-2 py-1.5 text-sm bg-theme-input-bg border border-theme-surface-border rounded-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                      />
                      <input
                        type="text"
                        value={editFields.address_zip}
                        onChange={(e) => setEditFields((f) => ({ ...f, address_zip: e.target.value }))}
                        placeholder="ZIP"
                        aria-label="ZIP code"
                        className="w-full px-2 py-1.5 text-sm bg-theme-input-bg border border-theme-surface-border rounded-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
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

              {/* Desired Membership Type */}
              <div className="p-4 border-b border-theme-surface-border">
                <h3 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-3">
                  Desired Membership Type
                </h3>
                <div className="flex items-center gap-2">
                  {(['regular', 'administrative'] as const).map((type) => {
                    const isSelected = applicant.target_membership_type === type;
                    const label = type === 'regular' ? 'Regular Member' : 'Administrative';
                    const desc = type === 'regular' ? 'Starts as probationary' : 'Non-operational role';
                    return (
                      <button
                        key={type}
                        disabled={isSelected}
                        onClick={() => {
                          void applicantService.updateApplicant(applicant.id, { target_membership_type: type }).then(() => {
                            toast.success(`Membership type changed to ${label.toLowerCase()}`);
                            const { fetchApplicant } = useProspectiveMembersStore.getState();
                            if (fetchApplicant) {
                              void fetchApplicant(applicant.id);
                            }
                          }).catch(() => {
                            toast.error('Failed to update membership type');
                          });
                        }}
                        className={`flex-1 p-2.5 rounded-lg border text-left transition-all ${
                          isSelected
                            ? 'border-red-500 bg-red-500/10'
                            : 'border-theme-surface-border bg-theme-surface-hover hover:border-theme-surface-border cursor-pointer'
                        }`}
                      >
                        <p className="text-sm font-medium text-theme-text-primary">{label}</p>
                        <p className="text-xs text-theme-text-muted">{desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Application Data — always visible regardless of current step */}
              {(() => {
                const formArtifact = applicant.stage_history
                  .flatMap((e) => e.artifacts)
                  .find((a) => a.type === StageTypeEnum.FORM_SUBMISSION && a.data);
                if (!formArtifact?.data) return null;
                const fields = formArtifact.data;
                return (
                  <div className="p-4 border-b border-theme-surface-border">
                    <h3 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" />
                      Application Data
                    </h3>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                      {Object.entries(fields).map(([key, value]) => (
                        <div key={key} className="contents">
                          <dt className="text-xs text-theme-text-muted">{fieldLabel(key)}</dt>
                          <dd className="text-xs text-theme-text-primary">{formatFieldValue(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                );
              })()}

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
                          currentElectionPackage.status === ElectionStatus.DRAFT
                            ? 'bg-theme-surface-secondary text-theme-text-muted'
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
                      {currentElectionPackage.status === ElectionStatus.DRAFT && (
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
                              className="w-full bg-theme-surface border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring resize-none"
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
                              className="w-full bg-theme-surface border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring resize-none"
                            />
                          </div>
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              onClick={() => { void handleSavePackage(); }}
                              className="px-3 py-1.5 text-xs text-theme-text-secondary border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors"
                            >
                              Save Draft
                            </button>
                            <button
                              onClick={() => { void handleSubmitPackage(); }}
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

                      {/* Ready state — assign to election */}
                      {currentElectionPackage.status === 'ready' && (
                        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 space-y-2">
                          <p className="text-xs text-emerald-600 dark:text-emerald-300">
                            This package is ready for the secretary to add to a ballot.
                            {currentElectionPackage.submitted_at && (
                              <> Submitted {formatDateTime(currentElectionPackage.submitted_at, tz)}.</>
                            )}
                          </p>
                          {currentElectionPackage.coordinator_notes && (
                            <p className="text-xs text-theme-text-muted">
                              Notes: {currentElectionPackage.coordinator_notes}
                            </p>
                          )}
                          {!showElectionPicker ? (
                            <button
                              onClick={() => { void handleOpenElectionPicker(); }}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                            >
                              <Vote className="w-3 h-3" />
                              Assign to Election
                            </button>
                          ) : (
                            <div className="space-y-2">
                              {isLoadingDraftElections ? (
                                <div className="flex items-center gap-2 text-xs text-theme-text-muted">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  Loading draft elections...
                                </div>
                              ) : draftElections.length === 0 ? (
                                <p className="text-xs text-theme-text-muted">
                                  No draft elections available. Create one in the Elections module first.
                                </p>
                              ) : (
                                <>
                                  <select
                                    value={selectedElectionId}
                                    onChange={(e) => setSelectedElectionId(e.target.value)}
                                    className="w-full px-2 py-1.5 text-xs rounded-lg border border-theme-surface-border bg-theme-surface text-theme-text-primary"
                                  >
                                    <option value="">Select a draft election...</option>
                                    {draftElections.map((el) => (
                                      <option key={el.id} value={el.id}>{el.title}</option>
                                    ))}
                                  </select>
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => { void handleAssignToElection(); }}
                                      disabled={!selectedElectionId || isAssigningToElection}
                                      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors disabled:opacity-50"
                                    >
                                      {isAssigningToElection && <Loader2 className="w-3 h-3 animate-spin" />}
                                      Add to Ballot
                                    </button>
                                    <button
                                      onClick={() => { setShowElectionPicker(false); setSelectedElectionId(''); }}
                                      className="px-3 py-1.5 text-xs text-theme-text-muted hover:text-theme-text-primary transition-colors"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Added to ballot / election outcome info */}
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
                          {currentElectionPackage.election_id && currentElectionPackage.election_title && (
                            <button
                              type="button"
                              onClick={() => navigate(`/elections/${currentElectionPackage.election_id}`)}
                              className="mt-1.5 text-xs text-theme-primary hover:underline"
                            >
                              {currentElectionPackage.election_title}
                              {currentElectionPackage.election_status === 'open' && ' — Voting in progress'}
                              {currentElectionPackage.election_status === 'closed' && ' — Closed'}
                            </button>
                          )}
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

              {/* Linked Events */}
              <div className="p-4 border-b border-theme-surface-border">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5" />
                    Linked Events
                  </h3>
                  {applicant.status === ApplicantStatus.ACTIVE && (
                    <button
                      onClick={() => { void handleOpenEventPicker(); }}
                      className="flex items-center gap-1 text-xs text-red-500 hover:text-red-400 transition-colors"
                    >
                      <CalendarPlus className="w-3 h-3" />
                      Link Event
                    </button>
                  )}
                </div>

                {/* Event picker dropdown */}
                {showEventPicker && (
                  <div className="mb-3 bg-theme-surface border border-theme-surface-border rounded-lg shadow-lg overflow-hidden">
                    <div className="p-2 border-b border-theme-surface-border">
                      <div className="flex items-center gap-2 px-2 py-1.5 bg-theme-input-bg border border-theme-surface-border rounded-sm">
                        <Search className="w-3.5 h-3.5 text-theme-text-muted" />
                        <input
                          type="text"
                          value={eventSearchQuery}
                          onChange={(e) => setEventSearchQuery(e.target.value)}
                          placeholder="Search upcoming events..."
                          className="flex-1 bg-transparent text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden"
                          autoFocus
                        />
                        <button
                          onClick={() => setShowEventPicker(false)}
                          className="text-theme-text-muted hover:text-theme-text-primary"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {isLoadingUpcoming ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="w-4 h-4 animate-spin text-theme-text-muted" />
                        </div>
                      ) : (() => {
                        const alreadyLinkedIds = new Set(linkedEvents.map((l) => l.event_id));
                        const query = eventSearchQuery.toLowerCase();
                        const filtered = upcomingEvents.filter(
                          (ev) =>
                            !alreadyLinkedIds.has(ev.id) &&
                            (ev.title.toLowerCase().includes(query) ||
                              ev.event_type.toLowerCase().includes(query) ||
                              (ev.custom_category ?? '').toLowerCase().includes(query))
                        );
                        if (filtered.length === 0) {
                          return (
                            <p className="text-xs text-theme-text-muted text-center py-4">
                              No matching upcoming events
                            </p>
                          );
                        }
                        return filtered.map((ev) => (
                          <button
                            key={ev.id}
                            onClick={() => { void handleLinkEvent(ev.id); }}
                            className="w-full flex items-center gap-3 px-3 py-2 hover:bg-theme-surface-hover text-left transition-colors"
                          >
                            <Calendar className="w-4 h-4 text-theme-text-muted shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-theme-text-primary truncate">{ev.title}</p>
                              <p className="text-xs text-theme-text-muted">
                                {formatDateTime(ev.start_datetime, tz)}
                                {ev.custom_category && (
                                  <span className="ml-1.5 px-1.5 py-0.5 bg-theme-surface-secondary rounded text-[10px]">
                                    {ev.custom_category}
                                  </span>
                                )}
                                {!ev.custom_category && (
                                  <span className="ml-1.5 px-1.5 py-0.5 bg-theme-surface-secondary rounded text-[10px] capitalize">
                                    {ev.event_type.replace(/_/g, ' ')}
                                  </span>
                                )}
                              </p>
                            </div>
                          </button>
                        ));
                      })()}
                    </div>
                  </div>
                )}

                {/* Linked events list */}
                {isLoadingLinkedEvents ? (
                  <div className="flex items-center justify-center py-3">
                    <Loader2 className="w-4 h-4 animate-spin text-theme-text-muted" />
                  </div>
                ) : linkedEvents.length === 0 ? (
                  <p className="text-xs text-theme-text-muted">No events linked yet.</p>
                ) : (
                  <div className="space-y-2">
                    {linkedEvents.map((link) => (
                      <div
                        key={link.id}
                        className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                          link.is_cancelled
                            ? 'border-red-500/20 bg-red-500/5 opacity-60'
                            : 'border-theme-surface-border bg-theme-surface'
                        }`}
                      >
                        <Calendar className="w-4 h-4 text-theme-text-muted shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-theme-text-primary truncate">
                            {link.event_title ?? 'Deleted event'}
                            {link.is_cancelled && (
                              <span className="ml-1.5 text-[10px] text-red-500 font-medium">CANCELLED</span>
                            )}
                          </p>
                          <p className="text-xs text-theme-text-muted">
                            {link.event_start ? formatDateTime(link.event_start, tz) : 'No date'}
                            {(link.custom_category || link.event_type) && (
                              <span className="ml-1.5 px-1.5 py-0.5 bg-theme-surface-secondary rounded text-[10px] capitalize">
                                {link.custom_category ?? (link.event_type ?? '').replace(/_/g, ' ')}
                              </span>
                            )}
                          </p>
                        </div>
                        {applicant.status === ApplicantStatus.ACTIVE && (
                          <button
                            onClick={() => { void handleUnlinkEvent(link.id); }}
                            className="text-theme-text-muted hover:text-red-500 transition-colors shrink-0"
                            title="Unlink event"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Checklist Stage Section */}
              {applicant.current_stage_type === StageTypeEnum.CHECKLIST && applicant.status === ApplicantStatus.ACTIVE && (() => {
                const currentEntry = applicant.stage_history[applicant.stage_history.length - 1];
                const actionResult = currentEntry?.action_result ?? {};
                const completedItems = (actionResult.completed_items as string[] | undefined) ?? [];
                const totalItems = (actionResult.total_items as number | undefined) ?? 0;
                return (
                  <div className="p-4 border-b border-theme-surface-border">
                    <h3 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-3">
                      Checklist Progress
                    </h3>
                    {totalItems > 0 ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs text-theme-text-secondary">
                          <span>{completedItems.length} of {totalItems} items completed</span>
                          <span className={completedItems.length === totalItems ? 'text-emerald-500' : 'text-amber-500'}>
                            {Math.round((completedItems.length / totalItems) * 100)}%
                          </span>
                        </div>
                        <div className="w-full bg-theme-surface-hover rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full transition-all ${completedItems.length === totalItems ? 'bg-emerald-500' : 'bg-amber-500'}`}
                            style={{ width: `${(completedItems.length / totalItems) * 100}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-theme-text-muted">No checklist data recorded yet.</p>
                    )}
                  </div>
                );
              })()}

              {/* Multi-Approval Stage Section */}
              {applicant.current_stage_type === StageTypeEnum.MULTI_APPROVAL && applicant.status === ApplicantStatus.ACTIVE && (() => {
                const currentEntry = applicant.stage_history[applicant.stage_history.length - 1];
                const actionResult = currentEntry?.action_result ?? {};
                const approvals = (actionResult.approvals as Array<{ role: string; approved_by?: string; approved_at?: string }> | undefined) ?? [];
                const requiredApprovers = (actionResult.required_approvers as string[] | undefined) ?? [];
                return (
                  <div className="p-4 border-b border-theme-surface-border">
                    <h3 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-3">
                      Approval Status
                    </h3>
                    {requiredApprovers.length > 0 ? (
                      <div className="space-y-2">
                        {requiredApprovers.map((role) => {
                          const approval = approvals.find((a) => a.role === role);
                          return (
                            <div key={role} className="flex items-center justify-between text-xs">
                              <span className="text-theme-text-secondary capitalize">{role.replace(/_/g, ' ')}</span>
                              {approval ? (
                                <span className="flex items-center gap-1 text-emerald-500">
                                  <CheckCircle className="w-3 h-3" />
                                  Approved
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-theme-text-muted">
                                  <Clock className="w-3 h-3" />
                                  Pending
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-theme-text-muted">No approval data recorded yet.</p>
                    )}
                  </div>
                );
              })()}

              {/* Reference Check Stage Section */}
              {applicant.current_stage_type === StageTypeEnum.REFERENCE_CHECK && applicant.status === ApplicantStatus.ACTIVE && (() => {
                const currentEntry = applicant.stage_history[applicant.stage_history.length - 1];
                const actionResult = currentEntry?.action_result ?? {};
                const references = (actionResult.references as Array<{ name?: string; status?: string; submitted_at?: string }> | undefined) ?? [];
                const requiredCount = (actionResult.required_count as number | undefined) ?? 0;
                return (
                  <div className="p-4 border-b border-theme-surface-border">
                    <h3 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-3">
                      Reference Checks
                    </h3>
                    <div className="space-y-2">
                      <p className="text-xs text-theme-text-secondary">
                        {references.length} of {requiredCount || '?'} references received
                      </p>
                      {references.map((ref, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs bg-theme-surface rounded-lg p-2 border border-theme-surface-border">
                          <span className="text-theme-text-primary">{ref.name ?? `Reference ${idx + 1}`}</span>
                          <span className={ref.status === 'completed' ? 'text-emerald-500' : 'text-amber-500'}>
                            {ref.status ?? 'pending'}
                          </span>
                        </div>
                      ))}
                      {references.length === 0 && (
                        <p className="text-xs text-theme-text-muted">No references submitted yet.</p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Interview Requirement Stage Section */}
              {applicant.current_stage_type === StageTypeEnum.INTERVIEW_REQUIREMENT && applicant.status === ApplicantStatus.ACTIVE && (() => {
                const currentEntry = applicant.stage_history[applicant.stage_history.length - 1];
                const actionResult = currentEntry?.action_result ?? {};
                const interviewCount = (actionResult.interview_count as number | undefined) ?? 0;
                const requiredCount = (actionResult.required_count as number | undefined) ?? 1;
                return (
                  <div className="p-4 border-b border-theme-surface-border">
                    <h3 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-3">
                      Interview Requirement
                    </h3>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-theme-text-secondary">
                        {interviewCount} of {requiredCount} interview{requiredCount !== 1 ? 's' : ''} completed
                      </span>
                      {interviewCount >= requiredCount ? (
                        <span className="flex items-center gap-1 text-emerald-500">
                          <CheckCircle className="w-3 h-3" />
                          Requirement met
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-amber-500">
                          <Clock className="w-3 h-3" />
                          In progress
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Medical Screening Stage Section */}
              {applicant.current_stage_type === StageTypeEnum.MEDICAL_SCREENING && applicant.status === ApplicantStatus.ACTIVE && (() => {
                const currentEntry = applicant.stage_history[applicant.stage_history.length - 1];
                const actionResult = currentEntry?.action_result ?? {};
                const screenings = (actionResult.screenings as Array<{ type: string; status: string; date?: string }> | undefined) ?? [];
                const requiredScreenings = (actionResult.required_screenings as string[] | undefined) ?? [];
                return (
                  <div className="p-4 border-b border-theme-surface-border">
                    <h3 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-3">
                      Medical Screenings
                    </h3>
                    {requiredScreenings.length > 0 || screenings.length > 0 ? (
                      <div className="space-y-2">
                        {(requiredScreenings.length > 0 ? requiredScreenings : screenings.map((s) => s.type)).map((type) => {
                          const screening = screenings.find((s) => s.type === type);
                          const isPassed = screening?.status === 'passed' || screening?.status === 'completed';
                          return (
                            <div key={type} className="flex items-center justify-between text-xs bg-theme-surface rounded-lg p-2 border border-theme-surface-border">
                              <span className="text-theme-text-primary capitalize">{type.replace(/_/g, ' ')}</span>
                              {screening ? (
                                <span className={`flex items-center gap-1 ${isPassed ? 'text-emerald-500' : 'text-amber-500'}`}>
                                  {isPassed ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                                  {screening.status.replace(/_/g, ' ')}
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-theme-text-muted">
                                  <Clock className="w-3 h-3" />
                                  Not started
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-theme-text-muted">No screening data recorded yet.</p>
                    )}
                  </div>
                );
              })()}

              {/* Visual Stage Progress */}
              {applicant.total_stages > 0 && (
                <div className="p-4 border-b border-theme-surface-border">
                  <h3 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-3">
                    Progress
                  </h3>
                  <div className="flex items-center gap-1 overflow-x-auto pb-1">
                    {applicant.stage_history.map((entry, idx) => {
                      const isComplete = !!entry.completed_at;
                      const isCurrent = idx === applicant.stage_history.length - 1 && !isComplete;
                      const StageIcon = STAGE_TYPE_ICONS[entry.stage_type] ?? Circle;
                      return (
                        <React.Fragment key={entry.id}>
                          {idx > 0 && (
                            <div className={`shrink-0 w-4 h-0.5 ${isComplete || isCurrent ? 'bg-emerald-400' : 'bg-theme-surface-border'}`} />
                          )}
                          <div
                            className={`flex items-center gap-1 px-2 py-1 rounded text-xs shrink-0 ${
                              isComplete
                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                                : isCurrent
                                ? 'bg-red-500/10 text-red-700 dark:text-red-400 ring-1 ring-red-500/30'
                                : 'bg-theme-surface-hover text-theme-text-muted'
                            }`}
                            title={`${entry.stage_name}${isComplete ? ' (Complete)' : isCurrent ? ' (Current)' : ''}`}
                          >
                            {isComplete ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : (
                              <StageIcon className="w-3 h-3" />
                            )}
                            <span className="max-w-[80px] truncate">{entry.stage_name}</span>
                          </div>
                        </React.Fragment>
                      );
                    })}
                    {/* Placeholder bubbles for unreached pipeline stages */}
                    {Array.from({ length: applicant.total_stages - applicant.stage_history.length }).map((_, idx) => (
                      <React.Fragment key={`pending-${idx}`}>
                        <div className="shrink-0 w-4 h-0.5 bg-theme-surface-border" />
                        <div
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs shrink-0 bg-theme-surface-hover text-theme-text-muted opacity-50"
                          title="Upcoming"
                        >
                          <Circle className="w-3 h-3" />
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                  {/* Time in pipeline summary */}
                  <p className="text-xs text-theme-text-muted mt-2">
                    {applicant.stage_history.filter((e) => e.completed_at).length} of {applicant.total_stages} stages completed
                    &middot; In pipeline since {formatDate(applicant.created_at, tz)}
                  </p>
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
                                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                              ) : isCurrent ? (
                                <div className="w-5 h-5 rounded-full border-2 border-red-500 bg-red-500/20 shrink-0" />
                              ) : (
                                <Circle className="w-5 h-5 text-theme-text-muted shrink-0" />
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
                                <p className="text-xs text-theme-text-muted mt-1 bg-theme-surface-secondary rounded-sm px-2 py-1">
                                  {entry.notes}
                                </p>
                              )}
                              {entry.artifacts.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  {entry.artifacts.map((artifact) => {
                                    if (artifact.type === StageTypeEnum.FORM_SUBMISSION && artifact.data) {
                                      const fields = artifact.data;
                                      return (
                                        <div key={artifact.id} className="bg-theme-surface-secondary rounded px-3 py-2">
                                          <p className="text-xs font-medium text-theme-text-secondary mb-1.5 flex items-center gap-1">
                                            <FileText className="w-3 h-3" />
                                            {artifact.name}
                                          </p>
                                          <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                                            {Object.entries(fields).map(([key, value]) => (
                                              <div key={key} className="contents">
                                                <dt className="text-xs text-theme-text-muted">
                                                  {fieldLabel(key)}
                                                </dt>
                                                <dd className="text-xs text-theme-text-primary">
                                                  {formatFieldValue(value)}
                                                </dd>
                                              </div>
                                            ))}
                                          </dl>
                                        </div>
                                      );
                                    }
                                    return (
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
                                    );
                                  })}
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
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-amber-400 border border-amber-500/30 rounded-lg hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                  >
                    {isHolding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pause className="w-3.5 h-3.5" />}
                    <span className="action-label">Hold</span>
                  </button>
                  <button
                    onClick={() => setShowSkipConfirm(true)}
                    disabled={isActionInProgress}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-purple-400 border border-purple-500/30 rounded-lg hover:bg-purple-500/10 transition-colors disabled:opacity-50"
                    title="Skip this stage and advance"
                  >
                    {isSkipping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                    <span className="action-label">Skip</span>
                  </button>
                  <button
                    onClick={() => setShowRejectConfirm(true)}
                    disabled={isActionInProgress}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50"
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
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50"
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
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50"
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
        )}
      </div>
    </>
  );
};
