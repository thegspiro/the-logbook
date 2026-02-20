/**
 * Training Approval Page
 *
 * Public page for token-based training session approval.
 * Accessed via URL like /training/approve/:token
 * Does NOT require authentication - the token itself serves as auth.
 */

import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ClipboardCheck,
  Clock,
  Users,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { trainingSessionService } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';

interface AttendeeData {
  user_id: string;
  user_name: string;
  user_email: string;
  checked_in_at: string;
  checked_out_at: string | null;
  calculated_duration_minutes: number | null;
  override_check_in_at: string | null;
  override_check_out_at: string | null;
  override_duration_minutes: number | null;
  approved: boolean;
  notes: string | null;
}

interface ApprovalData {
  id: string;
  training_session_id: string;
  event_id: string;
  status: string;
  approval_deadline: string;
  event_title: string;
  event_start_datetime: string;
  event_end_datetime: string;
  course_name: string;
  credit_hours: number;
  attendees: AttendeeData[];
  approved_by: string | null;
  approved_at: string | null;
  approval_notes: string | null;
  created_at: string;
}

export const TrainingApprovalPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [approvalData, setApprovalData] = useState<ApprovalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Editable attendee data
  const [attendees, setAttendees] = useState<AttendeeData[]>([]);
  const [approvalNotes, setApprovalNotes] = useState('');

  useEffect(() => {
    if (token) {
      fetchApprovalData();
    }
  }, [token]);

  const fetchApprovalData = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await trainingSessionService.getApprovalData(token) as unknown as ApprovalData;
      setApprovalData(data);
      setAttendees(
        (data.attendees || []).map((a) => ({
          ...a,
          approved: true, // Default all to approved
        }))
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load approval data. The link may be expired or invalid.'));
    } finally {
      setLoading(false);
    }
  };

  const handleToggleApproved = (userId: string) => {
    setAttendees((prev) =>
      prev.map((a) =>
        a.user_id === userId ? { ...a, approved: !a.approved } : a
      )
    );
  };

  const handleOverrideTime = (userId: string, field: 'override_check_in_at' | 'override_check_out_at', value: string) => {
    setAttendees((prev) =>
      prev.map((a) =>
        a.user_id === userId ? { ...a, [field]: value || null } : a
      )
    );
  };

  const handleOverrideDuration = (userId: string, value: string) => {
    setAttendees((prev) =>
      prev.map((a) =>
        a.user_id === userId
          ? { ...a, override_duration_minutes: value ? parseInt(value) : null }
          : a
      )
    );
  };

  const handleSubmit = async () => {
    if (!token) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await trainingSessionService.submitApproval(token, {
        attendees,
        approval_notes: approvalNotes || null,
      });
      setSubmitted(true);
      toast.success('Training approval submitted successfully');
    } catch (err: unknown) {
      setSubmitError(getErrorMessage(err, 'Failed to submit approval'));
      toast.error(getErrorMessage(err, 'Failed to submit approval'));
    } finally {
      setSubmitting(false);
    }
  };

  const formatDateTime = (dateString: string) =>
    new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  const formatDateTimeForInput = (dateString: string | null) => {
    if (!dateString) return '';
    const d = new Date(dateString);
    return d.toISOString().slice(0, 16);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-theme-surface flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4" role="status">
          <RefreshCw className="w-10 h-10 text-theme-text-muted animate-spin" aria-hidden="true" />
          <p className="text-theme-text-secondary text-sm">Loading approval data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-theme-surface flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-theme-surface-secondary rounded-lg border border-theme-surface-border p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" aria-hidden="true" />
          <h1 className="text-xl font-bold text-theme-text-primary mb-2">Unable to Load Approval</h1>
          <p className="text-theme-text-muted">{error}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-theme-surface flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-theme-surface-secondary rounded-lg border border-theme-surface-border p-8 text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" aria-hidden="true" />
          <h1 className="text-xl font-bold text-theme-text-primary mb-2">Approval Submitted</h1>
          <p className="text-theme-text-muted">
            The training session attendance has been approved. Training records will be created for approved attendees.
          </p>
        </div>
      </div>
    );
  }

  if (!approvalData) return null;

  const isExpired = new Date(approvalData.approval_deadline) < new Date();
  const isAlreadyApproved = approvalData.status === 'approved';

  return (
    <div className="min-h-screen bg-theme-surface">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center space-x-3 mb-4">
            <div className="bg-purple-600 rounded-lg p-2">
              <ClipboardCheck className="w-6 h-6 text-white" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-theme-text-primary">Training Session Approval</h1>
              <p className="text-theme-text-secondary text-sm">
                Review and approve attendance for this training session
              </p>
            </div>
          </div>

          {isExpired && !isAlreadyApproved && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4" role="alert">
              <p className="text-sm text-red-700 dark:text-red-300 font-medium">
                This approval deadline has passed ({formatDateTime(approvalData.approval_deadline)}).
              </p>
            </div>
          )}

          {isAlreadyApproved && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-4">
              <p className="text-sm text-green-700 dark:text-green-300 font-medium">
                This training session has already been approved
                {approvalData.approved_at && ` on ${formatDateTime(approvalData.approved_at)}`}.
              </p>
            </div>
          )}
        </div>

        {/* Session Info */}
        <div className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border p-6 mb-6">
          <h2 className="text-lg font-semibold text-theme-text-primary mb-4">{approvalData.event_title}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
              <div>
                <span className="text-theme-text-muted">Date: </span>
                <span className="text-theme-text-primary">{formatDateTime(approvalData.event_start_datetime)}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
              <div>
                <span className="text-theme-text-muted">End: </span>
                <span className="text-theme-text-primary">{formatDateTime(approvalData.event_end_datetime)}</span>
              </div>
            </div>
            <div>
              <span className="text-theme-text-muted">Course: </span>
              <span className="text-theme-text-primary">{approvalData.course_name}</span>
            </div>
            <div>
              <span className="text-theme-text-muted">Credit Hours: </span>
              <span className="text-theme-text-primary">{approvalData.credit_hours}</span>
            </div>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
              <div>
                <span className="text-theme-text-muted">Attendees: </span>
                <span className="text-theme-text-primary">{attendees.length}</span>
              </div>
            </div>
            <div>
              <span className="text-theme-text-muted">Deadline: </span>
              <span className={`${isExpired ? 'text-red-700 dark:text-red-400' : 'text-theme-text-primary'}`}>
                {formatDateTime(approvalData.approval_deadline)}
              </span>
            </div>
          </div>
        </div>

        {/* Attendees */}
        <div className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border overflow-hidden mb-6">
          <div className="p-4 border-b border-theme-surface-border">
            <h3 className="text-md font-semibold text-theme-text-primary">
              Attendees ({attendees.length})
            </h3>
            <p className="text-xs text-theme-text-muted mt-1">
              Review and adjust check-in/out times if needed. Toggle approval for each attendee.
            </p>
          </div>

          <div className="divide-y divide-theme-surface-border">
            {attendees.map((attendee) => (
              <div key={attendee.user_id} className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-theme-text-primary font-medium">{attendee.user_name}</p>
                    <p className="text-xs text-theme-text-muted">{attendee.user_email}</p>
                  </div>
                  <button
                    onClick={() => handleToggleApproved(attendee.user_id)}
                    disabled={isAlreadyApproved || isExpired}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      attendee.approved
                        ? 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400 hover:bg-green-500/20'
                        : 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400 hover:bg-red-500/20'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {attendee.approved ? (
                      <>
                        <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" />
                        Approved
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                        Denied
                      </>
                    )}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="text-theme-text-muted">Original Check-in: </span>
                    <span className="text-theme-text-secondary">
                      {formatDateTime(attendee.checked_in_at)}
                    </span>
                  </div>
                  <div>
                    <span className="text-theme-text-muted">Original Check-out: </span>
                    <span className="text-theme-text-secondary">
                      {attendee.checked_out_at ? formatDateTime(attendee.checked_out_at) : '--'}
                    </span>
                  </div>
                  <div>
                    <span className="text-theme-text-muted">Duration: </span>
                    <span className="text-theme-text-secondary">
                      {attendee.calculated_duration_minutes != null
                        ? `${attendee.calculated_duration_minutes} min`
                        : '--'}
                    </span>
                  </div>
                </div>

                {!isAlreadyApproved && !isExpired && (
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label htmlFor={`override-in-${attendee.user_id}`} className="block text-xs text-theme-text-muted mb-1">
                        Override Check-in
                      </label>
                      <input
                        id={`override-in-${attendee.user_id}`}
                        type="datetime-local"
                        value={formatDateTimeForInput(attendee.override_check_in_at)}
                        onChange={(e) => handleOverrideTime(attendee.user_id, 'override_check_in_at', e.target.value ? new Date(e.target.value).toISOString() : '')}
                        className="w-full px-2 py-1.5 bg-theme-input-bg border border-theme-input-border rounded text-xs text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label htmlFor={`override-out-${attendee.user_id}`} className="block text-xs text-theme-text-muted mb-1">
                        Override Check-out
                      </label>
                      <input
                        id={`override-out-${attendee.user_id}`}
                        type="datetime-local"
                        value={formatDateTimeForInput(attendee.override_check_out_at)}
                        onChange={(e) => handleOverrideTime(attendee.user_id, 'override_check_out_at', e.target.value ? new Date(e.target.value).toISOString() : '')}
                        className="w-full px-2 py-1.5 bg-theme-input-bg border border-theme-input-border rounded text-xs text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label htmlFor={`override-dur-${attendee.user_id}`} className="block text-xs text-theme-text-muted mb-1">
                        Override Duration (min)
                      </label>
                      <input
                        id={`override-dur-${attendee.user_id}`}
                        type="number"
                        min={0}
                        value={attendee.override_duration_minutes ?? ''}
                        onChange={(e) => handleOverrideDuration(attendee.user_id, e.target.value)}
                        placeholder="--"
                        className="w-full px-2 py-1.5 bg-theme-input-bg border border-theme-input-border rounded text-xs text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-purple-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Approval Notes & Submit */}
        {!isAlreadyApproved && !isExpired && (
          <div className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border p-6">
            <div className="mb-4">
              <label htmlFor="approval-notes" className="block text-sm font-medium text-theme-text-primary mb-1">
                Approval Notes (optional)
              </label>
              <textarea
                id="approval-notes"
                rows={3}
                value={approvalNotes}
                onChange={(e) => setApprovalNotes(e.target.value)}
                placeholder="Any notes about this approval..."
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {submitError && (
              <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3" role="alert">
                <p className="text-sm text-red-700 dark:text-red-300">{submitError}</p>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex items-center gap-2 px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {submitting && <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />}
                <CheckCircle className="w-4 h-4" aria-hidden="true" />
                {submitting ? 'Submitting...' : 'Submit Approval'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TrainingApprovalPage;
