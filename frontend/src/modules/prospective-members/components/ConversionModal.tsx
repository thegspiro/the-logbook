/**
 * Conversion Modal (Two-Step Wizard)
 *
 * Step 1: Review applicant data — confirmation screen.
 * Step 2: Set up member account — rank, station, hire date, etc.
 */

import React, { useState, useEffect } from 'react';
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
import type { Applicant, TargetMembershipType, EmergencyContact } from '../types';
import { applicantService } from '../services/api';
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, getTodayLocalDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';

interface ConversionModalProps {
  isOpen: boolean;
  onClose: () => void;
  applicant: Applicant | null;
}

export const ConversionModal: React.FC<ConversionModalProps> = ({ isOpen, onClose, applicant }) => {
  const tz = useTimezone();
  const { fetchApplicants } = useProspectiveMembersStore();

  // Wizard state
  const [step, setStep] = useState<1 | 2>(1);

  // Step 2 fields
  const [membershipType, setMembershipType] = useState<TargetMembershipType>('regular');
  const [rank, setRank] = useState('');
  const [station, setStation] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [hireDate, setHireDate] = useState('');
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(true);
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
    membership_number?: string;
  } | null>(null);

  // Reset state when applicant changes or modal opens
  useEffect(() => {
    if (applicant && isOpen) {
      setStep(1);
      setMembershipType(applicant.target_membership_type || 'regular');
      setRank('');
      setStation('');
      setMiddleName('');
      setHireDate(getTodayLocalDate(tz));
      setSendWelcomeEmail(true);
      setNotes('');
      setEmergencyContact({ name: '', relationship: '', phone: '' });
      setIsConverting(false);
      setConversionResult(null);
    }
  }, [applicant, isOpen, tz]);

  if (!isOpen || !applicant) return null;

  const completedStages = applicant.stage_history.filter((s) => s.completed_at).length;
  const totalStages = applicant.total_stages;

  const handleConvert = async () => {
    setIsConverting(true);
    try {
      const emergencyContacts: EmergencyContact[] = [];
      if (emergencyContact.name && emergencyContact.phone) {
        emergencyContacts.push({ ...emergencyContact, is_primary: true });
      }

      const result = await applicantService.convertToMember(applicant.id, {
        target_membership_type: membershipType,
        target_role_id: applicant.target_role_id,
        send_welcome_email: sendWelcomeEmail,
        notes: notes || undefined,
        middle_name: middleName || undefined,
        hire_date: hireDate || undefined,
        rank: rank || undefined,
        station: station || undefined,
        emergency_contacts: emergencyContacts.length > 0 ? emergencyContacts : undefined,
      });
      setConversionResult(result);
      await fetchApplicants();
      toast.success(`${applicant.first_name} ${applicant.last_name} converted to ${membershipType} member`);
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to convert applicant');
      toast.error(message);
    } finally {
      setIsConverting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conversion-modal-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !isConverting) onClose();
      }}
    >
      <div className="bg-theme-surface-modal border-theme-surface-border modal-body w-full max-w-lg rounded-xl border">
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
                Step {conversionResult ? '3' : step} of 2 — {step === 1 ? 'Review Applicant' : 'Set Up Account'}
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
                <p className="text-theme-text-muted mb-2 text-xs font-medium tracking-wider uppercase">Stage History</p>
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

              {/* Membership Type */}
              <div>
                <label className="text-theme-text-secondary mb-2 block text-sm font-medium">Membership Type</label>
                <div className="form-grid-2">
                  <button
                    onClick={() => setMembershipType('regular')}
                    className={`rounded-lg border p-3 text-left transition-all ${
                      membershipType === 'regular'
                        ? 'border-red-500 bg-red-500/10'
                        : 'border-theme-surface-border bg-theme-surface-hover hover:border-theme-surface-border'
                    }`}
                  >
                    <p className="text-theme-text-primary text-sm font-medium">Regular Member</p>
                    <p className="text-theme-text-muted mt-0.5 text-xs">Starts as probationary</p>
                  </button>
                  <button
                    onClick={() => setMembershipType('administrative')}
                    className={`rounded-lg border p-3 text-left transition-all ${
                      membershipType === 'administrative'
                        ? 'border-red-500 bg-red-500/10'
                        : 'border-theme-surface-border bg-theme-surface-hover hover:border-theme-surface-border'
                    }`}
                  >
                    <p className="text-theme-text-primary text-sm font-medium">Administrative</p>
                    <p className="text-theme-text-muted mt-0.5 text-xs">Non-operational support role</p>
                  </button>
                </div>
              </div>

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
                    className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                  />
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

              {/* Welcome Email */}
              <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={sendWelcomeEmail}
                  onChange={(e) => setSendWelcomeEmail(e.target.checked)}
                  className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                />
                Send welcome email with login credentials
              </label>

              {/* Notes */}
              <div>
                <label htmlFor="conversion-notes" className="text-theme-text-secondary mb-1 block text-sm font-medium">
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
                disabled={isConverting}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2 text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
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
  );
};
