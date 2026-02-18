/**
 * Conversion Modal
 *
 * Modal for converting an applicant who has completed the pipeline
 * into an administrative or probationary member.
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
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { Applicant, TargetMembershipType } from '../types';
import { applicantService } from '../services/api';
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';

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
  const [membershipType, setMembershipType] = useState<TargetMembershipType>(
    applicant?.target_membership_type ?? 'probationary'
  );
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(true);
  const [notes, setNotes] = useState('');
  const [isConverting, setIsConverting] = useState(false);
  const [conversionResult, setConversionResult] = useState<{
    user_id: string;
    message: string;
  } | null>(null);

  // Reset state when applicant changes or modal opens
  useEffect(() => {
    if (applicant && isOpen) {
      setMembershipType(applicant.target_membership_type ?? 'probationary');
      setSendWelcomeEmail(true);
      setNotes('');
      setIsConverting(false);
      setConversionResult(null);
    }
  }, [applicant?.id, isOpen]);

  if (!isOpen || !applicant) return null;

  const handleConvert = async () => {
    setIsConverting(true);
    try {
      const result = await applicantService.convertToMember(applicant.id, {
        target_membership_type: membershipType,
        target_role_id: applicant.target_role_id,
        send_welcome_email: sendWelcomeEmail,
        notes: notes || undefined,
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
      <div className="bg-theme-surface border border-theme-surface-border rounded-xl max-w-lg w-full">
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
                {applicant.first_name} {applicant.last_name}
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
              <p className="text-sm text-theme-text-muted">
                Member ID: {conversionResult.user_id}
              </p>
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
        ) : (
          <>
            {/* Body */}
            <div className="p-6 space-y-5">
              {/* Applicant Summary */}
              <div className="bg-theme-surface-secondary rounded-lg p-4 space-y-2">
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
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
                  <span className="text-theme-text-secondary">
                    Applied {formatDate(applicant.created_at, tz)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Shield className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
                  <span className="text-theme-text-secondary">
                    Completed {applicant.stage_history.filter(s => s.completed_at).length} stages
                  </span>
                </div>
              </div>

              {/* Membership Type */}
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">
                  Membership Type
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setMembershipType('probationary')}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      membershipType === 'probationary'
                        ? 'border-red-500 bg-red-500/10'
                        : 'border-theme-surface-border bg-theme-surface-secondary hover:border-theme-surface-border'
                    }`}
                  >
                    <p className="text-sm font-medium text-theme-text-primary">
                      Probationary
                    </p>
                    <p className="text-xs text-theme-text-muted mt-0.5">
                      New member in trial period
                    </p>
                  </button>
                  <button
                    onClick={() => setMembershipType('administrative')}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      membershipType === 'administrative'
                        ? 'border-red-500 bg-red-500/10'
                        : 'border-theme-surface-border bg-theme-surface-secondary hover:border-theme-surface-border'
                    }`}
                  >
                    <p className="text-sm font-medium text-white">
                      Administrative
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Non-operational support role
                    </p>
                  </button>
                </div>
              </div>

              {/* Target Role */}
              {applicant.target_role_name && (
                <div className="flex items-center gap-2 text-sm bg-slate-700/30 rounded-lg p-3">
                  <Shield className="w-4 h-4 text-slate-500" aria-hidden="true" />
                  <span className="text-slate-400">Assigned role:</span>
                  <span className="text-white font-medium">
                    {applicant.target_role_name}
                  </span>
                </div>
              )}

              {/* Welcome Email */}
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={sendWelcomeEmail}
                  onChange={(e) => setSendWelcomeEmail(e.target.checked)}
                  className="rounded border-white/20 bg-slate-700 text-red-500 focus:ring-red-500"
                />
                Send welcome email with login credentials
              </label>

              {/* Notes */}
              <div>
                <label htmlFor="conversion-notes" className="block text-sm font-medium text-slate-300 mb-2">
                  Conversion Notes (optional)
                </label>
                <textarea
                  id="conversion-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any notes about this conversion..."
                  rows={2}
                  className="w-full bg-slate-700 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                />
              </div>

              {/* Warning */}
              <div className="flex items-start gap-2 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <p>
                  This will create a new member account and mark this applicant
                  as converted. This action cannot be undone.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 p-6 border-t border-white/10">
              <button
                onClick={onClose}
                className="px-4 py-2 text-slate-300 hover:text-white transition-colors"
              >
                Cancel
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
