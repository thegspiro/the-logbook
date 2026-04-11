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
  FileText,
  CheckCircle,
  Clock,
  User,
  Loader2,
  AlertTriangle,
  EyeOff,
  Eye,
  Activity,
  Pencil,
  Save,
  Archive,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type {
  Applicant,
  StageHistoryEntry,
} from '../types';
import { isSafeUrl, getInitials } from '../utils';
import { STAGE_TYPE_ICONS } from '../constants';
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';
import { applicantService } from '../services/api';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, formatDateTime } from '../../../utils/dateFormatting';
import { ApplicantStatus, StageType as StageTypeEnum } from '../../../constants/enums';
import ElectionPackageSection from './ElectionPackageSection';
import LinkedEventsSection from './LinkedEventsSection';
import { ApplicantActionPanels } from './ApplicantActionPanels';

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

export const ApplicantDetailDrawer: React.FC<ApplicantDetailDrawerProps> = ({
  applicant,
  isOpen,
  onClose,
  onConvert,
  isLastStage,
  isFirstStage,
}) => {
  const tz = useTimezone();

  const {
    isLoadingApplicant,
  } = useProspectiveMembersStore();

  const [showPii, setShowPii] = useState(true);
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

  // Reset editing state when applicant changes
  useEffect(() => {
    setIsEditingContact(false);
  }, [applicant?.id]);

  const startEditingContact = () => {
    if (!applicant) return;
    setEditFields({
      first_name: applicant.first_name,
      last_name: applicant.last_name,
      email: applicant.email,
      phone: applicant.phone || '',
      date_of_birth: applicant.date_of_birth || '',
      address_street: applicant.address?.street || '',
      address_city: applicant.address?.city || '',
      address_state: applicant.address?.state || '',
      address_zip: applicant.address?.zip_code || '',
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
          <div className="flex-1 flex items-center justify-center" role="status" aria-live="polite">
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
                  <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400" />
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
                        return <Icon className="w-4 h-4 text-red-700 dark:text-red-400" />;
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
                <ElectionPackageSection applicant={applicant} tz={tz} />
              )}

              {/* Linked Events */}
              <LinkedEventsSection applicant={applicant} tz={tz} />

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
                                <CheckCircle2 className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0" />
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
                                        className="flex items-center gap-1 text-xs text-blue-700 dark:text-blue-400"
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
                      <div className="flex items-center justify-center py-4" role="status" aria-live="polite">
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
            <ApplicantActionPanels
              applicant={applicant}
              isLastStage={isLastStage}
              isFirstStage={isFirstStage}
              onClose={onClose}
              onConvert={onConvert}
            />
          </>
        )}
      </div>
    </>
  );
};
