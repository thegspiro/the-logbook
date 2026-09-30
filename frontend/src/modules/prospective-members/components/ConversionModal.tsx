/**
 * Conversion Modal (Two-Step Wizard)
 *
 * Step 1: Review applicant data — confirmation screen.
 * Step 2: Set up member account — rank, station, hire date, etc.
 */

import React, { useState, useEffect } from 'react';
import { useDialog } from '../../../hooks/useDialog';
import { DialogPortal } from '../../../components/DialogPortal';
import {
  X,
  UserCheck,
  Mail,
  Phone,
  Calendar,
  Shield,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  MapPin,
  Briefcase,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { Applicant, ConversionStatus, EmergencyContact, PipelineConversionConfig } from '../types';
import { StepProgressStatus } from '../types';
import { applicantService, pipelineService } from '../services/api';
import { userService } from '../../../services/api';
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';
import TargetRolePicker from './TargetRolePicker';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, getTodayLocalDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { ADMINISTRATIVE_RANK_HINT } from '../../../utils/membership';
import { MemberClass } from '../../../constants/enums';

type PasswordDelivery = 'email' | 'set' | 'later';

/**
 * What the coordinator needs to do next about the new member's password.
 *
 * The conversion always succeeds as a conversion, so a success screen alone
 * hid the one case that still needs action: a welcome email that was asked
 * for and did not go out leaves a password nobody knows.
 */
const PasswordOutcome: React.FC<{ delivery: PasswordDelivery; welcomeEmailSent: boolean; name: string }> = ({
  delivery,
  welcomeEmailSent,
  name,
}) => {
  if (delivery === 'email' && welcomeEmailSent) {
    return (
      <p className="text-theme-text-muted mb-4 text-center text-sm">
        A welcome email with a temporary password was sent to {name}.
      </p>
    );
  }
  if (delivery === 'set') {
    return (
      <p className="text-theme-text-muted mb-4 text-center text-sm">
        Give {name} the password you set. They must change it at first sign-in.
      </p>
    );
  }
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        {delivery === 'email' ? 'The welcome email could not be sent, so ' : ''}
        {name} has no password they know yet. Set one with Reset Password in Member Management before they can sign in.
      </p>
    </div>
  );
};

interface ConversionModalProps {
  isOpen: boolean;
  onClose: () => void;
  applicant: Applicant | null;
}

export const ConversionModal: React.FC<ConversionModalProps> = ({ isOpen, onClose, applicant }) => {
  const dialogRef = useDialog<HTMLDivElement>({ isOpen: isOpen, onClose });

  const tz = useTimezone();
  const { refreshPipelineView, currentPipeline } = useProspectiveMembersStore();

  // Wizard state
  const [step, setStep] = useState<1 | 2>(1);

  // Step 2 fields
  // What the new member becomes. Pre-filled from the pipeline's conversion rule
  // for the applicant's track -- the same rule automatic conversion applies --
  // and changeable here for this one applicant. Empty until the rule is known:
  // guessing a default here would be a second copy of the server's.
  const [memberClass, setMemberClass] = useState<MemberClass | ''>('');
  const [memberStatus, setMemberStatus] = useState<ConversionStatus | ''>('');
  const [rank, setRank] = useState('');
  const [station, setStation] = useState('');
  // Seeded from the application's own target role. The conversion is the last
  // moment anyone can correct it, so this is a control rather than the
  // read-only summary line it used to be.
  const [targetRoleId, setTargetRoleId] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [hireDate, setHireDate] = useState('');
  // How the new member learns their password. 'email' sends a generated one;
  // 'set' takes one the coordinator chooses; 'later' converts now and leaves
  // it to Reset Password — the same three states POST /transfer accepts.
  const [passwordDelivery, setPasswordDelivery] = useState<PasswordDelivery>('email');
  const [initialPassword, setInitialPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  // false: email cannot send, so the server refuses 'email'. null: not known
  // yet, or the check failed — the server still refuses if it has to.
  const [welcomeEmailAvailable, setWelcomeEmailAvailable] = useState<boolean | null>(null);
  const [notes, setNotes] = useState('');
  const [emergencyContact, setEmergencyContact] = useState<EmergencyContact>({
    name: '',
    relationship: '',
    phone: '',
  });

  const [isConverting, setIsConverting] = useState(false);
  const [conversionResult, setConversionResult] = useState<{
    user_id: string;
    message: string;
    membership_number?: string | undefined;
    delivery: PasswordDelivery;
    welcome_email_sent: boolean;
  } | null>(null);

  // Reset state when applicant changes or modal opens
  useEffect(() => {
    if (applicant && isOpen) {
      setStep(1);
      setMemberClass('');
      setMemberStatus('');
      setRank('');
      setStation('');
      setTargetRoleId(applicant.target_role_id || '');
      setMiddleName('');
      setHireDate(getTodayLocalDate(tz));
      setPasswordDelivery('email');
      setInitialPassword('');
      setConfirmPassword('');
      setPasswordError(null);
      setNotes('');
      setEmergencyContact({ name: '', relationship: '', phone: '' });
      setIsConverting(false);
      setConversionResult(null);
    }
  }, [applicant, isOpen, tz]);

  useEffect(() => {
    if (!applicant || !isOpen) return undefined;
    let cancelled = false;
    const track = applicant.target_membership_type === 'administrative' ? 'administrative' : 'operational';
    const apply = (config: PipelineConversionConfig) => {
      if (cancelled) return;
      setMemberClass(config[track].member_class);
      setMemberStatus(config[track].member_status);
      // An administrative member holds no rank; see the class select below.
      if (config[track].member_class === MemberClass.ADMINISTRATIVE) setRank('');
    };
    if (currentPipeline && currentPipeline.id === applicant.pipeline_id) {
      apply(currentPipeline.conversion_config);
    } else if (applicant.pipeline_id) {
      pipelineService
        .getPipeline(applicant.pipeline_id)
        .then((pipeline) => apply(pipeline.conversion_config))
        .catch(() => {
          // Left unselected: the coordinator chooses, and Convert waits for it.
        });
    }
    return () => {
      cancelled = true;
    };
  }, [applicant, isOpen, currentPipeline]);

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    setWelcomeEmailAvailable(null);
    userService
      .getWelcomeEmailAvailability()
      .then(({ available }) => {
        if (cancelled) return;
        setWelcomeEmailAvailable(available);
        if (!available) setPasswordDelivery((current) => (current === 'email' ? 'set' : current));
      })
      .catch(() => {
        // Non-critical: the conversion itself is refused if it has to be.
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen || !applicant) return null;

  // Counted from the record's status rather than a `completed_at` stamp,
  // which can outlive the completion it recorded — see the drawer's
  // progress track for the same fix.
  const completedStages = applicant.stage_history.filter((s) => s.status === StepProgressStatus.COMPLETED).length;
  const totalStages = applicant.total_stages;

  const isAdministrative = memberClass === MemberClass.ADMINISTRATIVE;

  const handleConvert = async () => {
    if (!memberClass || !memberStatus) return;
    if (passwordDelivery === 'set') {
      if (initialPassword.length < 12) {
        setPasswordError('The password must be at least 12 characters.');
        return;
      }
      if (initialPassword !== confirmPassword) {
        setPasswordError('The passwords do not match.');
        return;
      }
    }
    setPasswordError(null);
    setIsConverting(true);
    try {
      const emergencyContacts: EmergencyContact[] = [];
      if (emergencyContact.name && emergencyContact.phone) {
        emergencyContacts.push({ ...emergencyContact, is_primary: true });
      }

      const result = await applicantService.convertToMember(applicant.id, {
        target_membership_type: applicant.target_membership_type || 'regular',
        member_class: memberClass,
        member_status: memberStatus,
        target_role_id: targetRoleId || undefined,
        send_welcome_email: passwordDelivery === 'email',
        password: passwordDelivery === 'set' ? initialPassword : undefined,
        notes: notes || undefined,
        middle_name: middleName || undefined,
        hire_date: hireDate || undefined,
        rank: rank || undefined,
        station: station || undefined,
        emergency_contacts: emergencyContacts.length > 0 ? emergencyContacts : undefined,
      });
      setConversionResult({ ...result, delivery: passwordDelivery });
      // Both halves: a conversion empties the applicant out of the open list
      // and moves two header counts (active down, converted up). Refreshing
      // the list alone left the stat cards claiming the applicant was still
      // active, over a table that no longer showed them.
      await refreshPipelineView();
      toast.success(
        `${applicant.first_name} ${applicant.last_name} converted to ${memberStatus} ${memberClass} member`
      );
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to convert applicant');
      toast.error(message);
    } finally {
      setIsConverting(false);
    }
  };

  return (
    <DialogPortal>
      <div
        className="modal-overlay z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conversion-modal-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !isConverting) onClose();
        }}
      >
        <div ref={dialogRef} className="modal-panel modal-body w-full max-w-lg">
          {/* Header */}
          <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20">
                <UserCheck className="h-5 w-5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              </div>
              <div>
                <h2 id="conversion-modal-title" className="text-theme-text-primary text-lg font-bold">
                  Convert to Member
                </h2>
                <p className="text-theme-text-muted text-sm">
                  {conversionResult
                    ? 'Done'
                    : `Step ${step} of 2 — ${step === 1 ? 'Review Applicant' : 'Set Up Account'}`}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-theme-text-muted hover:text-theme-text-primary transition-colors"
              aria-label="Close dialog"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {/* Success State */}
          {conversionResult ? (
            <div className="p-6">
              <div className="py-6 text-center">
                <CheckCircle2
                  className="mx-auto mb-4 h-16 w-16 text-emerald-700 dark:text-emerald-400"
                  aria-hidden="true"
                />
                <h3 className="text-theme-text-primary mb-2 text-xl font-bold">Conversion Complete</h3>
                <p className="text-theme-text-muted mb-4">{conversionResult.message}</p>
                {conversionResult.membership_number && (
                  <p className="text-theme-text-muted text-sm">Membership #: {conversionResult.membership_number}</p>
                )}
              </div>
              <PasswordOutcome
                delivery={conversionResult.delivery}
                welcomeEmailSent={conversionResult.welcome_email_sent}
                name={`${applicant.first_name} ${applicant.last_name}`}
              />
              <div className="flex justify-end">
                <button
                  onClick={onClose}
                  className="bg-theme-surface-secondary hover:bg-theme-surface-hover text-theme-text-primary rounded-lg px-6 py-2 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          ) : step === 1 ? (
            /* ===== STEP 1: Review Applicant ===== */
            <>
              <div className="space-y-4 p-6">
                <h3 className="text-theme-text-primary text-sm font-semibold">Applicant Review</h3>

                {/* Contact Info */}
                <div className="bg-theme-surface-secondary space-y-2 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Users className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
                    <span className="text-theme-text-primary font-medium">
                      {applicant.first_name} {applicant.last_name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
                    <span className="text-theme-text-secondary">{applicant.email}</span>
                  </div>
                  {applicant.phone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
                      <span className="text-theme-text-secondary">{applicant.phone}</span>
                    </div>
                  )}
                  {applicant.date_of_birth && (
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
                      <span className="text-theme-text-secondary">DOB: {formatDate(applicant.date_of_birth, tz)}</span>
                    </div>
                  )}
                  {applicant.address?.city && (
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
                      <span className="text-theme-text-secondary">
                        {[
                          applicant.address.street,
                          applicant.address.city,
                          applicant.address.state,
                          applicant.address.zip_code,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    </div>
                  )}
                </div>

                {/* Pipeline Progress */}
                <div className="bg-theme-surface-secondary space-y-2 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Shield className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
                    <span className="text-theme-text-secondary">
                      Completed {completedStages} of {totalStages} stages
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
                    <span className="text-theme-text-secondary">Applied {formatDate(applicant.created_at, tz)}</span>
                  </div>
                  {applicant.target_role_name && (
                    <div className="flex items-center gap-2 text-sm">
                      <Briefcase className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
                      <span className="text-theme-text-secondary">
                        Target role:{' '}
                        <span className="text-theme-text-primary font-medium">{applicant.target_role_name}</span>
                      </span>
                    </div>
                  )}
                </div>

                {/* Stage Summary */}
                <div className="bg-theme-surface-secondary rounded-lg p-4">
                  <p className="text-theme-text-muted mb-2 text-xs font-medium tracking-wider uppercase">
                    Stage History
                  </p>
                  <div className="space-y-1">
                    {applicant.stage_history.map((sh) => (
                      <div key={sh.id} className="flex items-center gap-2 text-xs">
                        {sh.completed_at ? (
                          <CheckCircle2 className="h-3 w-3 text-emerald-700 dark:text-emerald-400" />
                        ) : (
                          <div className="border-theme-surface-border h-3 w-3 rounded-full border" />
                        )}
                        <span className={sh.completed_at ? 'text-theme-text-secondary' : 'text-theme-text-muted'}>
                          {sh.stage_name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Step 1 Footer */}
              <div className="border-theme-surface-border flex items-center justify-end gap-3 border-t p-6">
                <button
                  onClick={onClose}
                  className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 transition-colors"
                >
                  Cancel
                </button>
                <button onClick={() => setStep(2)} className="btn-primary flex items-center gap-2 px-6">
                  Continue
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </>
          ) : (
            /* ===== STEP 2: Set Up Member Account ===== */
            <>
              <div className="space-y-4 p-6">
                <h3 className="text-theme-text-primary text-sm font-semibold">Member Account Setup</h3>

                {/* Member class and starting status */}
                <div className="form-grid-2">
                  <div>
                    <label htmlFor="conv-class" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                      Member class
                    </label>
                    <select
                      id="conv-class"
                      value={memberClass}
                      onChange={(e) => {
                        const next = e.target.value as MemberClass | '';
                        setMemberClass(next);
                        // An administrative member holds no operational rank,
                        // and the transfer refuses the pair. Both are chosen in
                        // this one step, so drop the rank as the class is
                        // picked rather than failing the conversion at the end.
                        if (next === MemberClass.ADMINISTRATIVE) setRank('');
                      }}
                      className="form-input"
                    >
                      <option value="" disabled>
                        Choose…
                      </option>
                      <option value={MemberClass.OPERATIONAL}>Operational</option>
                      <option value={MemberClass.ADMINISTRATIVE}>Administrative</option>
                      <option value={MemberClass.SOCIAL}>Social</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="conv-status" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                      Starting status
                    </label>
                    <select
                      id="conv-status"
                      value={memberStatus}
                      onChange={(e) => setMemberStatus(e.target.value as ConversionStatus | '')}
                      className="form-input"
                    >
                      <option value="" disabled>
                        Choose…
                      </option>
                      <option value="probationary">Probationary</option>
                      <option value="regular">Regular</option>
                    </select>
                  </div>
                </div>
                <p className="text-theme-text-muted -mt-2 text-xs">
                  Pre-filled from this pipeline&apos;s conversion settings. Changing it here affects this applicant
                  only.
                </p>

                {/* Rank & Station */}
                <div className="form-grid-2">
                  <div>
                    <label htmlFor="conv-rank" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                      Rank
                    </label>
                    <input
                      id="conv-rank"
                      type="text"
                      value={rank}
                      onChange={(e) => setRank(e.target.value)}
                      placeholder="e.g., Firefighter"
                      disabled={isAdministrative}
                      className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden disabled:opacity-60"
                    />
                    {isAdministrative && (
                      <p className="text-theme-text-muted mt-1 text-xs">{ADMINISTRATIVE_RANK_HINT}</p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="conv-station" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                      Station
                    </label>
                    <input
                      id="conv-station"
                      type="text"
                      value={station}
                      onChange={(e) => setStation(e.target.value)}
                      placeholder="e.g., Station 1"
                      className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                    />
                  </div>
                  <TargetRolePicker
                    id="conv-target-role"
                    value={targetRoleId}
                    onChange={setTargetRoleId}
                    hint="Granted to the new member in addition to the default member position."
                  />
                </div>

                {/* Middle Name & Hire Date */}
                <div className="form-grid-2">
                  <div>
                    <label htmlFor="conv-middle" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                      Middle Name
                    </label>
                    <input
                      id="conv-middle"
                      type="text"
                      value={middleName}
                      onChange={(e) => setMiddleName(e.target.value)}
                      placeholder="Optional"
                      className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                    />
                  </div>
                  <div>
                    <label htmlFor="conv-hire" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                      Hire Date
                    </label>
                    <input
                      id="conv-hire"
                      type="date"
                      value={hireDate}
                      onChange={(e) => setHireDate(e.target.value)}
                      className="card-secondary focus:ring-theme-focus-ring text-theme-text-primary w-full px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                    />
                  </div>
                </div>

                {/* Emergency Contact */}
                <div>
                  <label className="text-theme-text-secondary mb-2 block text-sm font-medium">
                    Emergency Contact (optional)
                  </label>
                  <div className="form-grid-3">
                    <input
                      type="text"
                      value={emergencyContact.name}
                      onChange={(e) => setEmergencyContact((c) => ({ ...c, name: e.target.value }))}
                      placeholder="Name"
                      aria-label="Emergency contact name"
                      className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                    />
                    <input
                      type="text"
                      value={emergencyContact.relationship}
                      onChange={(e) => setEmergencyContact((c) => ({ ...c, relationship: e.target.value }))}
                      placeholder="Relationship"
                      aria-label="Emergency contact relationship"
                      className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                    />
                    <input
                      type="text"
                      value={emergencyContact.phone}
                      onChange={(e) => setEmergencyContact((c) => ({ ...c, phone: e.target.value }))}
                      placeholder="Phone"
                      aria-label="Emergency contact phone"
                      className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                    />
                  </div>
                </div>

                {/* How the member gets their password */}
                <fieldset className="space-y-2">
                  <legend className="text-theme-text-secondary mb-1 text-sm font-medium">
                    How will they get their password?
                  </legend>
                  <label className="text-theme-text-secondary flex items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="password-delivery"
                      value="email"
                      checked={passwordDelivery === 'email'}
                      onChange={() => setPasswordDelivery('email')}
                      disabled={welcomeEmailAvailable === false}
                      className="mt-0.5"
                    />
                    <span>
                      Email them a temporary password
                      {welcomeEmailAvailable === false && (
                        <span className="text-theme-text-muted block text-xs">
                          Unavailable: email isn&apos;t set up for this department.
                        </span>
                      )}
                    </span>
                  </label>
                  <label className="text-theme-text-secondary flex items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="password-delivery"
                      value="set"
                      checked={passwordDelivery === 'set'}
                      onChange={() => setPasswordDelivery('set')}
                      className="mt-0.5"
                    />
                    <span>Set an initial password now</span>
                  </label>
                  {passwordDelivery === 'set' && (
                    <div className="grid grid-cols-1 gap-2 pl-6 sm:grid-cols-2">
                      <div>
                        <label htmlFor="conversion-password" className="text-theme-text-muted mb-1 block text-xs">
                          Password
                        </label>
                        <input
                          id="conversion-password"
                          type="password"
                          value={initialPassword}
                          onChange={(e) => {
                            setInitialPassword(e.target.value);
                            setPasswordError(null);
                          }}
                          placeholder="Minimum 12 characters"
                          autoComplete="new-password"
                          className="form-input"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="conversion-password-confirm"
                          className="text-theme-text-muted mb-1 block text-xs"
                        >
                          Confirm password
                        </label>
                        <input
                          id="conversion-password-confirm"
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => {
                            setConfirmPassword(e.target.value);
                            setPasswordError(null);
                          }}
                          autoComplete="new-password"
                          className="form-input"
                        />
                      </div>
                      <p className="text-theme-text-muted text-xs sm:col-span-2">
                        Give it to them yourself; they must change it at first sign-in.
                      </p>
                      {passwordError && (
                        <p role="alert" className="text-sm text-red-700 sm:col-span-2 dark:text-red-400">
                          {passwordError}
                        </p>
                      )}
                    </div>
                  )}
                  <label className="text-theme-text-secondary flex items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="password-delivery"
                      value="later"
                      checked={passwordDelivery === 'later'}
                      onChange={() => setPasswordDelivery('later')}
                      className="mt-0.5"
                    />
                    <span>
                      Set it later
                      <span className="text-theme-text-muted block text-xs">
                        They can&apos;t sign in until you set one with Reset Password in Member Management.
                      </span>
                    </span>
                  </label>
                </fieldset>

                {/* Notes */}
                <div>
                  <label
                    htmlFor="conversion-notes"
                    className="text-theme-text-secondary mb-1 block text-sm font-medium"
                  >
                    Notes (optional)
                  </label>
                  <textarea
                    id="conversion-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Any notes about this conversion..."
                    rows={2}
                    className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full resize-none rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                  />
                </div>

                {/* Warning */}
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p>
                    This will create a new member account and mark this applicant as converted. This action cannot be
                    undone.
                  </p>
                </div>
              </div>

              {/* Step 2 Footer */}
              <div className="border-theme-surface-border flex items-center justify-between border-t p-6">
                <button
                  onClick={() => setStep(1)}
                  disabled={isConverting}
                  className="text-theme-text-secondary hover:text-theme-text-primary flex items-center gap-2 px-4 py-2 transition-colors disabled:opacity-50"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Back
                </button>
                <button
                  onClick={() => {
                    void handleConvert();
                  }}
                  disabled={isConverting || !memberClass || !memberStatus}
                  className="flex items-center gap-2 rounded-lg bg-emerald-700 px-6 py-2 text-white transition-colors hover:bg-emerald-800 disabled:opacity-50"
                >
                  {isConverting ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <UserCheck className="h-4 w-4" aria-hidden="true" />
                  )}
                  Convert to Member
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </DialogPortal>
  );
};
