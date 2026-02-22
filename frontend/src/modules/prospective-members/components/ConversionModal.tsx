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
  FileText,
  Briefcase,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { Applicant, TargetMembershipType, EmergencyContact } from '../types';
import { applicantService } from '../services/api';
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';
import { MembershipType } from '../../../constants/enums';

interface ConversionModalProps {
  isOpen: boolean;
  onClose: () => void;
  applicant: Applicant | null;
}

export const ConversionModal: React.FC<ConversionModalProps> = ({
  isOpen,
  onClose,
  applicant,
}) => {
  const tz = useTimezone();
  const { fetchApplicants } = useProspectiveMembersStore();

  // Wizard state
  const [step, setStep] = useState<1 | 2>(1);

  // Step 2 fields
  const [membershipType, setMembershipType] = useState<TargetMembershipType>('probationary');
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
      setMembershipType(applicant.target_membership_type ?? 'probationary');
      setRank('');
      setStation('');
      setMiddleName('');
      setHireDate(new Date().toISOString().split('T')[0]);
      setSendWelcomeEmail(true);
      setNotes('');
      setEmergencyContact({ name: '', relationship: '', phone: '' });
      setIsConverting(false);
      setConversionResult(null);
    }
  }, [applicant?.id, isOpen]);

  if (!isOpen || !applicant) return null;

  const completedStages = applicant.stage_history.filter(s => s.completed_at).length;
  const totalStages = applicant.stage_history.length;

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
      toast.success(
        `${applicant.first_name} ${applicant.last_name} converted to ${membershipType} member`
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to convert applicant';
      toast.error(message);
    } finally {
      setIsConverting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conversion-modal-title"
      onKeyDown={(e) => { if (e.key === 'Escape' && !isConverting) onClose(); }}
    >
      <div className="bg-theme-surface-modal border border-theme-surface-border rounded-xl max-w-lg w-full modal-body">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-theme-surface-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <UserCheck className="w-5 h-5 text-emerald-400" aria-hidden="true" />
            </div>
            <div>
              <h2 id="conversion-modal-title" className="text-lg font-bold text-theme-text-primary">
                Convert to Member
              </h2>
              <p className="text-sm text-theme-text-muted">
                Step {conversionResult ? '3' : step} of 2 — {step === 1 ? 'Review Applicant' : 'Set Up Account'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-theme-text-muted hover:text-theme-text-primary transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Success State */}
        {conversionResult ? (
          <div className="p-6">
            <div className="text-center py-6">
              <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto mb-4" aria-hidden="true" />
              <h3 className="text-xl font-bold text-theme-text-primary mb-2">
                Conversion Complete
              </h3>
              <p className="text-theme-text-muted mb-4">{conversionResult.message}</p>
              {conversionResult.membership_number && (
                <p className="text-sm text-theme-text-muted">
                  Membership #: {conversionResult.membership_number}
                </p>
              )}
            </div>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="px-6 py-2 bg-theme-surface-secondary hover:bg-theme-surface-hover text-theme-text-primary rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        ) : step === 1 ? (
          /* ===== STEP 1: Review Applicant ===== */
          <>
            <div className="p-6 space-y-4">
              <h3 className="text-sm font-semibold text-theme-text-primary">Applicant Review</h3>

              {/* Contact Info */}
              <div className="bg-theme-surface-secondary rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Users className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
                  <span className="text-theme-text-primary font-medium">
                    {applicant.first_name} {applicant.last_name}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
                  <span className="text-theme-text-secondary">{applicant.email}</span>
                </div>
                {applicant.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
                    <span className="text-theme-text-secondary">{applicant.phone}</span>
                  </div>
                )}
                {applicant.date_of_birth && (
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
                    <span className="text-theme-text-secondary">
                      DOB: {formatDate(applicant.date_of_birth, tz)}
                    </span>
                  </div>
                )}
                {applicant.address?.city && (
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
                    <span className="text-theme-text-secondary">
                      {[applicant.address.street, applicant.address.city, applicant.address.state, applicant.address.zip_code]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  </div>
                )}
              </div>

              {/* Pipeline Progress */}
              <div className="bg-theme-surface-secondary rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Shield className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
                  <span className="text-theme-text-secondary">
                    Completed {completedStages} of {totalStages} stages
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
                  <span className="text-theme-text-secondary">
                    Applied {formatDate(applicant.created_at, tz)}
                  </span>
                </div>
                {applicant.target_role_name && (
                  <div className="flex items-center gap-2 text-sm">
                    <Briefcase className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
                    <span className="text-theme-text-secondary">
                      Target role: <span className="text-theme-text-primary font-medium">{applicant.target_role_name}</span>
                    </span>
                  </div>
                )}
              </div>

              {/* Stage Summary */}
              <div className="bg-theme-surface-secondary rounded-lg p-4">
                <p className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-2">Stage History</p>
                <div className="space-y-1">
                  {applicant.stage_history.map((sh) => (
                    <div key={sh.id} className="flex items-center gap-2 text-xs">
                      {sh.completed_at ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <div className="w-3 h-3 rounded-full border border-theme-surface-border" />
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
            <div className="flex items-center justify-end gap-3 p-6 border-t border-theme-surface-border">
              <button
                onClick={onClose}
                className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => setStep(2)}
                className="flex items-center gap-2 px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                Continue
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </>
        ) : (
          /* ===== STEP 2: Set Up Member Account ===== */
          <>
            <div className="p-6 space-y-4">
              <h3 className="text-sm font-semibold text-theme-text-primary">Member Account Setup</h3>

              {/* Membership Type */}
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                  Membership Type
                </label>
                <div className="form-grid-2">
                  <button
                    onClick={() => setMembershipType('probationary')}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      membershipType === MembershipType.PROBATIONARY
                        ? 'border-red-500 bg-red-500/10'
                        : 'border-theme-surface-border bg-theme-surface-hover hover:border-theme-surface-border'
                    }`}
                  >
                    <p className="text-sm font-medium text-theme-text-primary">Probationary</p>
                    <p className="text-xs text-theme-text-muted mt-0.5">New member in trial period</p>
                  </button>
                  <button
                    onClick={() => setMembershipType('administrative')}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      membershipType === 'administrative'
                        ? 'border-red-500 bg-red-500/10'
                        : 'border-theme-surface-border bg-theme-surface-hover hover:border-theme-surface-border'
                    }`}
                  >
                    <p className="text-sm font-medium text-theme-text-primary">Administrative</p>
                    <p className="text-xs text-theme-text-muted mt-0.5">Non-operational support role</p>
                  </button>
                </div>
              </div>

              {/* Rank & Station */}
              <div className="form-grid-2">
                <div>
                  <label htmlFor="conv-rank" className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Rank
                  </label>
                  <input
                    id="conv-rank"
                    type="text"
                    value={rank}
                    onChange={(e) => setRank(e.target.value)}
                    placeholder="e.g., Firefighter"
                    className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div>
                  <label htmlFor="conv-station" className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Station
                  </label>
                  <input
                    id="conv-station"
                    type="text"
                    value={station}
                    onChange={(e) => setStation(e.target.value)}
                    placeholder="e.g., Station 1"
                    className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              </div>

              {/* Middle Name & Hire Date */}
              <div className="form-grid-2">
                <div>
                  <label htmlFor="conv-middle" className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Middle Name
                  </label>
                  <input
                    id="conv-middle"
                    type="text"
                    value={middleName}
                    onChange={(e) => setMiddleName(e.target.value)}
                    placeholder="Optional"
                    className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div>
                  <label htmlFor="conv-hire" className="block text-sm font-medium text-theme-text-secondary mb-1">
                    Hire Date
                  </label>
                  <input
                    id="conv-hire"
                    type="date"
                    value={hireDate}
                    onChange={(e) => setHireDate(e.target.value)}
                    className="w-full bg-theme-surface-secondary border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              </div>

              {/* Emergency Contact */}
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                  Emergency Contact (optional)
                </label>
                <div className="form-grid-3">
                  <input
                    type="text"
                    value={emergencyContact.name}
                    onChange={(e) => setEmergencyContact((c) => ({ ...c, name: e.target.value }))}
                    placeholder="Name"
                    aria-label="Emergency contact name"
                    className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                  <input
                    type="text"
                    value={emergencyContact.relationship}
                    onChange={(e) => setEmergencyContact((c) => ({ ...c, relationship: e.target.value }))}
                    placeholder="Relationship"
                    aria-label="Emergency contact relationship"
                    className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                  <input
                    type="text"
                    value={emergencyContact.phone}
                    onChange={(e) => setEmergencyContact((c) => ({ ...c, phone: e.target.value }))}
                    placeholder="Phone"
                    aria-label="Emergency contact phone"
                    className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              </div>

              {/* Welcome Email */}
              <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                <input
                  type="checkbox"
                  checked={sendWelcomeEmail}
                  onChange={(e) => setSendWelcomeEmail(e.target.checked)}
                  className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-red-500"
                />
                Send welcome email with login credentials
              </label>

              {/* Notes */}
              <div>
                <label htmlFor="conversion-notes" className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Notes (optional)
                </label>
                <textarea
                  id="conversion-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any notes about this conversion..."
                  rows={2}
                  className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                />
              </div>

              {/* Warning */}
              <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <p>
                  This will create a new member account and mark this applicant
                  as converted. This action cannot be undone.
                </p>
              </div>
            </div>

            {/* Step 2 Footer */}
            <div className="flex items-center justify-between p-6 border-t border-theme-surface-border">
              <button
                onClick={() => setStep(1)}
                disabled={isConverting}
                className="flex items-center gap-2 px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary transition-colors disabled:opacity-50"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                Back
              </button>
              <button
                onClick={handleConvert}
                disabled={isConverting}
                className="flex items-center gap-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {isConverting ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <UserCheck className="w-4 h-4" aria-hidden="true" />
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
