/**
 * Election Detail Page
 *
 * Shows detailed information about an election including results.
 */

import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { electionService } from '../services/api';
import type { Election, ForensicsReport, VoteIntegrityResult, Candidate, BallotItem } from '../types/election';
import { ElectionResults } from '../components/ElectionResults';
import { ElectionBallot } from '../components/ElectionBallot';
import { CandidateManagement } from '../components/CandidateManagement';
import { BallotBuilder } from '../components/BallotBuilder';
import { MeetingAttendance } from '../components/MeetingAttendance';
import { useAuthStore } from '../stores/authStore';
import { getErrorMessage } from '../utils/errorHandling';

export const ElectionDetailPage: React.FC = () => {
  const { electionId } = useParams<{ electionId: string }>();
  const navigate = useNavigate();
  const [election, setElection] = useState<Election | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [updatingVisibility, setUpdatingVisibility] = useState(false);
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [newEndDate, setNewEndDate] = useState('');
  const [extendError, setExtendError] = useState<string | null>(null);
  const [showRollbackModal, setShowRollbackModal] = useState(false);
  const [rollbackReason, setRollbackReason] = useState('');
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [isRollingBack, setIsRollingBack] = useState(false);

  // Send Ballot Emails state
  const [showSendEmailModal, setShowSendEmailModal] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [isSendingEmails, setIsSendingEmails] = useState(false);
  const [sendEmailError, setSendEmailError] = useState<string | null>(null);

  // Delete Election state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Forensics & Integrity state
  const [showForensics, setShowForensics] = useState(false);
  const [forensicsReport, setForensicsReport] = useState<ForensicsReport | null>(null);
  const [loadingForensics, setLoadingForensics] = useState(false);
  const [integrityResult, setIntegrityResult] = useState<VoteIntegrityResult | null>(null);
  const [loadingIntegrity, setLoadingIntegrity] = useState(false);

  // Soft-delete vote state
  const [voidVoteId, setVoidVoteId] = useState('');
  const [voidVoteReason, setVoidVoteReason] = useState('');
  const [isVoidingVote, setIsVoidingVote] = useState(false);

  // Ballot Preview state
  const [showPreview, setShowPreview] = useState(false);
  const [previewCandidates, setPreviewCandidates] = useState<Candidate[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('elections.manage');

  useEffect(() => {
    if (electionId) {
      fetchElection();
    }
  }, [electionId]);

  const fetchElection = async () => {
    if (!electionId) return;

    try {
      setLoading(true);
      setError(null);
      const data = await electionService.getElection(electionId);
      setElection(data);

      // Automatically show results if they're available
      if (data.status === 'closed' || data.results_visible_immediately) {
        setShowResults(true);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load election'));
    } finally {
      setLoading(false);
    }
  };

  const handleToggleResultsVisibility = async () => {
    if (!electionId || !election) return;

    try {
      setUpdatingVisibility(true);
      const updated = await electionService.updateElection(electionId, {
        results_visible_immediately: !election.results_visible_immediately,
      });
      setElection(updated);
      toast.success('Visibility setting updated successfully');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update visibility'));
    } finally {
      setUpdatingVisibility(false);
    }
  };

  const handleOpenElection = async () => {
    if (!electionId) return;

    try {
      const updated = await electionService.openElection(electionId);
      setElection(updated);
      toast.success('Election opened successfully');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to open election'));
    }
  };

  const handleCloseElection = async () => {
    if (!electionId) return;

    if (!confirm('Are you sure you want to close this election? This action cannot be undone.')) {
      return;
    }

    try {
      const updated = await electionService.closeElection(electionId);
      setElection(updated);
      setShowResults(true);
      toast.success('Election closed successfully');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to close election'));
    }
  };

  const handleExtendElection = async () => {
    if (!electionId || !newEndDate) return;

    try {
      setExtendError(null);
      const updated = await electionService.updateElection(electionId, {
        end_date: newEndDate,
      });
      setElection(updated);
      setShowExtendModal(false);
      setNewEndDate('');
    } catch (err: unknown) {
      setExtendError(getErrorMessage(err, 'Failed to extend election'));
    }
  };

  // Format a Date as a local datetime-local string (YYYY-MM-DDTHH:MM)
  const formatLocalDateTime = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  const extendByHours = (hours: number) => {
    if (!election) return;
    const currentEnd = new Date(election.end_date);
    const newEnd = new Date(currentEnd.getTime() + hours * 60 * 60 * 1000);
    setNewEndDate(formatLocalDateTime(newEnd));
  };

  const extendToEndOfDay = () => {
    if (!election) return;
    const currentEnd = new Date(election.end_date);
    currentEnd.setHours(23, 59, 0, 0);
    setNewEndDate(formatLocalDateTime(currentEnd));
  };

  const handleRollbackElection = async () => {
    if (!electionId || !rollbackReason.trim()) {
      setRollbackError('Please provide a reason for the rollback');
      return;
    }

    if (rollbackReason.trim().length < 10) {
      setRollbackError('Reason must be at least 10 characters');
      return;
    }

    try {
      setIsRollingBack(true);
      setRollbackError(null);

      const response = await electionService.rollbackElection(electionId, rollbackReason.trim());

      setElection(response.election);
      setShowRollbackModal(false);
      setRollbackReason('');

      toast.success(`Election rolled back successfully. ${response.notifications_sent} leadership members were notified.`);
    } catch (err: unknown) {
      setRollbackError(getErrorMessage(err, 'Failed to rollback election'));
    } finally {
      setIsRollingBack(false);
    }
  };

  // --- Send Ballot Emails ---
  const handleSendBallotEmails = async () => {
    if (!electionId) return;

    try {
      setIsSendingEmails(true);
      setSendEmailError(null);

      const response = await electionService.sendBallotEmail(electionId, {
        subject: emailSubject || undefined,
        message: emailMessage || undefined,
        include_ballot_link: true,
      });

      setShowSendEmailModal(false);
      setEmailSubject('');
      setEmailMessage('');
      fetchElection(); // Refresh to update email_sent status

      if (response.failed_count > 0) {
        toast.success(`Ballots sent to ${response.recipients_count} voters (${response.failed_count} failed)`);
      } else {
        toast.success(`Ballots sent successfully to ${response.recipients_count} voters`);
      }
    } catch (err: unknown) {
      setSendEmailError(getErrorMessage(err, 'Failed to send ballot emails'));
    } finally {
      setIsSendingEmails(false);
    }
  };

  // --- Delete Election ---
  const handleDeleteElection = async () => {
    if (!electionId || !election) return;

    const isDraft = election.status === 'draft';

    if (!isDraft && deleteReason.trim().length < 10) {
      setDeleteError('A reason of at least 10 characters is required');
      return;
    }

    try {
      setIsDeleting(true);
      setDeleteError(null);

      const response = await electionService.deleteElection(
        electionId,
        isDraft ? undefined : deleteReason.trim(),
      );

      setShowDeleteModal(false);
      toast.success(response.message);
      navigate('/elections');
    } catch (err: unknown) {
      setDeleteError(getErrorMessage(err, 'Failed to delete election'));
    } finally {
      setIsDeleting(false);
    }
  };

  // --- Integrity Check ---
  const handleRunIntegrityCheck = async () => {
    if (!electionId) return;

    try {
      setLoadingIntegrity(true);
      const result = await electionService.verifyIntegrity(electionId);
      setIntegrityResult(result);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to verify integrity'));
    } finally {
      setLoadingIntegrity(false);
    }
  };

  // --- Forensics Report ---
  const handleLoadForensics = async () => {
    if (!electionId) return;

    try {
      setLoadingForensics(true);
      const report = await electionService.getForensics(electionId);
      setForensicsReport(report);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load forensics report'));
    } finally {
      setLoadingForensics(false);
    }
  };

  // --- Soft-delete Vote ---
  const handleVoidVote = async () => {
    if (!electionId || !voidVoteId.trim() || !voidVoteReason.trim()) return;

    try {
      setIsVoidingVote(true);
      await electionService.softDeleteVote(electionId, voidVoteId.trim(), voidVoteReason.trim());
      toast.success('Vote voided successfully');
      setVoidVoteId('');
      setVoidVoteReason('');
      // Refresh forensics if open
      if (forensicsReport) {
        handleLoadForensics();
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to void vote'));
    } finally {
      setIsVoidingVote(false);
    }
  };

  const handleOpenPreview = async () => {
    if (!electionId) return;
    try {
      setLoadingPreview(true);
      const candidatesData = await electionService.getCandidates(electionId);
      setPreviewCandidates(candidatesData.filter((c: Candidate) => c.accepted));
      setShowPreview(true);
    } catch {
      toast.error('Failed to load ballot preview');
    } finally {
      setLoadingPreview(false);
    }
  };

  const getPreviewCandidatesForItem = (item: BallotItem): Candidate[] => {
    const position = item.position || item.id;
    return previewCandidates.filter((c) => c.position === position && !c.is_write_in);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'open':
        return 'bg-green-100 text-green-800';
      case 'closed':
        return 'bg-gray-100 text-gray-800';
      case 'draft':
        return 'bg-yellow-100 text-yellow-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-center items-center h-64" role="status" aria-live="polite">
            <div className="text-theme-text-muted">Loading election...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !election) {
    return (
      <div className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
            <p className="text-sm text-red-700 dark:text-red-300">{error || 'Election not found'}</p>
          </div>
        </div>
      </div>
    );
  }

  const resultsAvailable = election.status === 'closed' || election.results_visible_immediately;
  const isDraft = election.status === 'draft';
  const isActiveOrCompleted = election.status === 'open' || election.status === 'closed';

  return (
    <div className="min-h-screen">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center mb-2">
          <Link to="/elections" className="text-blue-600 hover:text-blue-700 mr-2">
            &larr; Back to Elections
          </Link>
        </div>
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-2xl font-bold text-theme-text-primary">{election.title}</h2>
              {election.is_runoff && (
                <span className="px-2 py-1 text-xs font-semibold bg-purple-100 text-purple-800 rounded">
                  Runoff Round {election.runoff_round}
                </span>
              )}
            </div>
            {election.is_runoff && election.parent_election_id && (
              <Link
                to={`/elections/${election.parent_election_id}`}
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                &larr; View original election
              </Link>
            )}
            {election.description && (
              <p className="mt-2 text-theme-text-secondary">{election.description}</p>
            )}
          </div>
          <span
            className={`px-3 py-1 inline-flex text-sm leading-5 font-semibold rounded-full ${getStatusBadgeClass(
              election.status
            )}`}
          >
            {election.status}
          </span>
        </div>
      </div>

      {/* Election Info */}
      <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-theme-text-muted">Start Date</div>
            <div className="mt-1 text-sm font-medium text-theme-text-primary">
              {formatDate(election.start_date)}
            </div>
          </div>
          <div>
            <div className="text-sm text-theme-text-muted">End Date</div>
            <div className="mt-1 text-sm font-medium text-theme-text-primary">
              {formatDate(election.end_date)}
            </div>
          </div>
          {election.positions && election.positions.length > 0 && (
            <div className="col-span-2">
              <div className="text-sm text-theme-text-muted">Positions</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {election.positions.map((position) => (
                  <span
                    key={position}
                    className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-blue-100 text-blue-800"
                  >
                    {position}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="text-sm text-theme-text-muted">Voting Method</div>
            <div className="mt-1 text-sm font-medium text-theme-text-primary">
              {election.voting_method.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </div>
          </div>
          <div>
            <div className="text-sm text-theme-text-muted">Anonymous Voting</div>
            <div className="mt-1 text-sm font-medium text-theme-text-primary">
              {election.anonymous_voting ? 'Yes' : 'No'}
            </div>
          </div>
        </div>

        {/* Secretary Controls */}
        {canManage && (
          <div className="mt-6 pt-6 border-t border-theme-surface-border">
            <div className="flex flex-wrap gap-3">
              {/* Preview Ballot */}
              {election.ballot_items && election.ballot_items.length > 0 && (
                <button
                  onClick={handleOpenPreview}
                  disabled={loadingPreview}
                  className="px-4 py-2 bg-cyan-600 text-white rounded-md hover:bg-cyan-700 disabled:opacity-50"
                >
                  {loadingPreview ? 'Loading Preview...' : 'Preview Ballot'}
                </button>
              )}

              {election.status === 'draft' && (
                <button
                  onClick={handleOpenElection}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                >
                  Open Election
                </button>
              )}

              {election.status === 'open' && (
                <>
                  <button
                    onClick={() => setShowSendEmailModal(true)}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                  >
                    {election.email_sent ? 'Resend Ballot Emails' : 'Send Ballot Emails'}
                  </button>
                  <button
                    onClick={() => {
                      setNewEndDate(election.end_date);
                      setShowExtendModal(true);
                    }}
                    className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
                  >
                    Extend Time
                  </button>
                  <button
                    onClick={handleCloseElection}
                    className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                  >
                    Close Election
                  </button>
                </>
              )}

              {(election.status === 'open' || election.status === 'closed') && (
                <button
                  onClick={() => setShowRollbackModal(true)}
                  className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700"
                >
                  Rollback Election
                </button>
              )}

              {/* Results visibility toggle — blocked for open elections to prevent strategic voting */}
              {election.status !== 'open' && (
                <button
                  onClick={handleToggleResultsVisibility}
                  disabled={updatingVisibility}
                  className={`px-4 py-2 rounded-md ${
                    election.results_visible_immediately
                      ? 'bg-yellow-600 text-white hover:bg-yellow-700'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  } disabled:opacity-50`}
                >
                  {updatingVisibility
                    ? 'Updating...'
                    : election.results_visible_immediately
                    ? 'Hide Results from Voters'
                    : 'Show Results to Voters'}
                </button>
              )}

              {/* Delete Election */}
              {election.status !== 'cancelled' && (
                <button
                  onClick={() => setShowDeleteModal(true)}
                  className={`px-4 py-2 rounded-md ${
                    isDraft
                      ? 'bg-gray-600 text-theme-text-primary hover:bg-gray-700'
                      : 'bg-red-800 text-white hover:bg-red-900'
                  }`}
                >
                  Delete Election
                </button>
              )}

              {election.email_sent && (
                <div className="flex items-center text-sm text-theme-text-secondary">
                  <svg className="h-5 w-5 mr-1 text-green-600" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                    <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                  </svg>
                  Emails sent on {election.email_sent_at ? formatDate(election.email_sent_at) : 'N/A'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Candidate Management (Admin) */}
      {canManage && electionId && (
        <div className="mb-6">
          <CandidateManagement electionId={electionId} election={election} />
        </div>
      )}

      {/* Ballot Builder (Admin - draft/open elections) */}
      {canManage && electionId && election.status !== 'cancelled' && (
        <div className="mb-6">
          <BallotBuilder
            electionId={electionId}
            election={election}
            onUpdate={setElection}
          />
        </div>
      )}

      {/* Meeting Attendance (Admin) */}
      {canManage && electionId && election.status !== 'cancelled' && (
        <div className="mb-6">
          <MeetingAttendance
            electionId={electionId}
            election={election}
            onUpdate={setElection}
          />
        </div>
      )}

      {/* Voter Ballot (when election is open) */}
      {election.status === 'open' && electionId && (
        <div className="mb-6">
          <ElectionBallot
            electionId={electionId}
            election={election}
            onVoteCast={fetchElection}
          />
        </div>
      )}

      {/* Results Toggle for All Users */}
      {resultsAvailable && (
        <div className="mb-6">
          <button
            onClick={() => setShowResults(!showResults)}
            className="w-full bg-theme-surface backdrop-blur-sm shadow rounded-lg p-4 flex items-center justify-between hover:bg-theme-surface-secondary"
          >
            <span className="text-lg font-medium text-theme-text-primary">
              {showResults ? 'Hide Results' : 'View Results'}
            </span>
            <svg
              className={`h-6 w-6 text-theme-text-muted transform transition-transform ${
                showResults ? 'rotate-180' : ''
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      )}

      {/* Results Display */}
      {showResults && resultsAvailable && electionId && (
        <ElectionResults electionId={electionId} election={election} />
      )}

      {/* Message if results not available */}
      {!resultsAvailable && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            Results will be available when the election is closed
            {canManage && ' or when you enable "Show Results to Voters"'}.
          </p>
        </div>
      )}

      {/* ==================== */}
      {/* Forensics & Integrity (Admin) */}
      {/* ==================== */}
      {canManage && electionId && isActiveOrCompleted && (
        <div className="mt-6">
          <button
            onClick={() => {
              setShowForensics(!showForensics);
              if (!showForensics && !forensicsReport) {
                handleLoadForensics();
              }
            }}
            className="w-full bg-theme-surface backdrop-blur-sm shadow rounded-lg p-4 flex items-center justify-between hover:bg-theme-surface-secondary"
          >
            <span className="text-lg font-medium text-theme-text-primary">
              Forensics &amp; Integrity
            </span>
            <svg
              className={`h-6 w-6 text-theme-text-muted transform transition-transform ${
                showForensics ? 'rotate-180' : ''
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showForensics && (
            <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg mt-2 p-6 space-y-6">
              {/* Integrity Check */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-md font-semibold text-theme-text-primary">Vote Integrity Check</h3>
                  <button
                    onClick={handleRunIntegrityCheck}
                    disabled={loadingIntegrity}
                    className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {loadingIntegrity ? 'Checking...' : integrityResult ? 'Re-run Check' : 'Run Check'}
                  </button>
                </div>

                {integrityResult && (
                  <div className={`border rounded-lg p-4 ${
                    integrityResult.integrity_status === 'PASS'
                      ? 'bg-green-500/10 border-green-500/30'
                      : 'bg-red-500/10 border-red-500/30'
                  }`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-lg font-bold ${
                        integrityResult.integrity_status === 'PASS' ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'
                      }`}>
                        {integrityResult.integrity_status === 'PASS' ? 'PASS' : 'FAIL'}
                      </span>
                      <span className="text-sm text-theme-text-secondary">
                        ({integrityResult.valid_signatures}/{integrityResult.total_votes} valid signatures)
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div>
                        <span className="text-theme-text-muted">Total Votes:</span>{' '}
                        <span className="font-medium text-theme-text-primary">{integrityResult.total_votes}</span>
                      </div>
                      <div>
                        <span className="text-theme-text-muted">Valid:</span>{' '}
                        <span className="font-medium text-green-700 dark:text-green-300">{integrityResult.valid_signatures}</span>
                      </div>
                      <div>
                        <span className="text-theme-text-muted">Unsigned:</span>{' '}
                        <span className="font-medium text-yellow-700 dark:text-yellow-300">{integrityResult.unsigned_votes}</span>
                      </div>
                      <div>
                        <span className="text-theme-text-muted">Tampered:</span>{' '}
                        <span className={`font-medium ${integrityResult.tampered_votes > 0 ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300'}`}>
                          {integrityResult.tampered_votes}
                        </span>
                      </div>
                    </div>
                    {integrityResult.tampered_vote_ids.length > 0 && (
                      <div className="mt-3 p-3 bg-red-500/20 rounded">
                        <p className="text-sm font-semibold text-red-700 dark:text-red-300 mb-1">Tampered Vote IDs:</p>
                        <div className="space-y-1">
                          {integrityResult.tampered_vote_ids.map(id => (
                            <div key={id} className="flex items-center gap-2">
                              <code className="text-xs text-red-700 dark:text-red-300 bg-red-500/10 px-2 py-0.5 rounded">{id}</code>
                              <button
                                onClick={() => setVoidVoteId(id)}
                                className="text-xs text-red-600 underline hover:text-red-800"
                              >
                                Void this vote
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Void Vote Form */}
              <div className="border-t border-theme-surface-border pt-4">
                <h3 className="text-md font-semibold text-theme-text-primary mb-3">Void a Vote</h3>
                <p className="text-sm text-theme-text-muted mb-3">
                  Soft-deletes a vote with full audit trail. The vote is preserved but excluded from results.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    value={voidVoteId}
                    onChange={(e) => setVoidVoteId(e.target.value)}
                    placeholder="Vote ID (UUID)"
                    aria-label="Vote ID (UUID)"
                    className="flex-1 bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-red-500 focus:border-red-500"
                  />
                  <input
                    type="text"
                    value={voidVoteReason}
                    onChange={(e) => setVoidVoteReason(e.target.value)}
                    placeholder="Reason for voiding"
                    aria-label="Reason for voiding"
                    className="flex-1 bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-red-500 focus:border-red-500"
                  />
                  <button
                    onClick={handleVoidVote}
                    disabled={isVoidingVote || !voidVoteId.trim() || !voidVoteReason.trim()}
                    className="px-4 py-2 bg-red-600 text-white text-sm rounded-md hover:bg-red-700 disabled:opacity-50 whitespace-nowrap"
                  >
                    {isVoidingVote ? 'Voiding...' : 'Void Vote'}
                  </button>
                </div>
              </div>

              {/* Forensics Report Detail */}
              {loadingForensics && (
                <div className="text-center text-theme-text-muted py-4" role="status" aria-live="polite">Loading forensics report...</div>
              )}

              {forensicsReport && (
                <>
                  {/* Deleted Votes */}
                  <div className="border-t border-theme-surface-border pt-4">
                    <h3 className="text-md font-semibold text-theme-text-primary mb-2">
                      Voided Votes ({forensicsReport.deleted_votes.count})
                    </h3>
                    {forensicsReport.deleted_votes.count === 0 ? (
                      <p className="text-sm text-theme-text-muted">No votes have been voided.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm" aria-label="Voided votes">
                          <thead className="bg-theme-input-bg">
                            <tr>
                              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-theme-text-muted">Vote ID</th>
                              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-theme-text-muted">Position</th>
                              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-theme-text-muted">Reason</th>
                              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-theme-text-muted">Deleted At</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/10">
                            {forensicsReport.deleted_votes.records.map(v => (
                              <tr key={v.vote_id}>
                                <td className="px-3 py-2 font-mono text-xs">{v.vote_id.slice(0, 8)}...</td>
                                <td className="px-3 py-2">{v.position || '—'}</td>
                                <td className="px-3 py-2">{v.deletion_reason || '—'}</td>
                                <td className="px-3 py-2">{v.deleted_at ? formatDate(v.deleted_at) : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Anomaly Detection */}
                  {Object.keys(forensicsReport.anomaly_detection.suspicious_ips).length > 0 && (
                    <div className="border-t border-theme-surface-border pt-4">
                      <h3 className="text-md font-semibold text-red-700 dark:text-red-300 mb-2">
                        Suspicious IP Addresses
                      </h3>
                      <div className="bg-red-500/10 border border-red-500/30 rounded p-3">
                        {Object.entries(forensicsReport.anomaly_detection.suspicious_ips).map(([ip, count]) => (
                          <div key={ip} className="flex justify-between text-sm py-1">
                            <code className="text-red-700 dark:text-red-300">{ip}</code>
                            <span className="font-semibold text-red-700 dark:text-red-300">{count} votes</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Voting Timeline */}
                  {Object.keys(forensicsReport.voting_timeline).length > 0 && (
                    <div className="border-t border-theme-surface-border pt-4">
                      <h3 className="text-md font-semibold text-theme-text-primary mb-2">Voting Timeline</h3>
                      <div className="space-y-1">
                        {Object.entries(forensicsReport.voting_timeline)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([hour, count]) => (
                            <div key={hour} className="flex items-center gap-3 text-sm">
                              <span className="text-theme-text-muted w-40 font-mono">{hour}</span>
                              <div className="flex-1 bg-theme-surface rounded-full h-4">
                                <div
                                  className="bg-blue-600 rounded-full h-4"
                                  style={{
                                    width: `${Math.min(
                                      100,
                                      (count / Math.max(...Object.values(forensicsReport.voting_timeline))) * 100
                                    )}%`,
                                  }}
                                />
                              </div>
                              <span className="text-slate-200 font-medium w-8 text-right">{count}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Token Summary */}
                  <div className="border-t border-theme-surface-border pt-4">
                    <h3 className="text-md font-semibold text-theme-text-primary mb-2">Ballot Tokens</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                      <div className="bg-theme-surface-secondary rounded p-3">
                        <div className="text-theme-text-muted">Issued</div>
                        <div className="text-xl font-semibold text-theme-text-primary">{forensicsReport.voting_tokens.total_issued}</div>
                      </div>
                      <div className="bg-theme-surface-secondary rounded p-3">
                        <div className="text-theme-text-muted">Used</div>
                        <div className="text-xl font-semibold text-theme-text-primary">{forensicsReport.voting_tokens.total_used}</div>
                      </div>
                      <div className="bg-theme-surface-secondary rounded p-3">
                        <div className="text-theme-text-muted">Unused</div>
                        <div className="text-xl font-semibold text-theme-text-primary">
                          {forensicsReport.voting_tokens.total_issued - forensicsReport.voting_tokens.total_used}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Audit Log Summary */}
                  <div className="border-t border-theme-surface-border pt-4">
                    <h3 className="text-md font-semibold text-theme-text-primary mb-2">
                      Audit Log ({forensicsReport.audit_log.total_entries} entries)
                    </h3>
                    {forensicsReport.audit_log.entries.length === 0 ? (
                      <p className="text-sm text-theme-text-muted">No audit entries.</p>
                    ) : (
                      <div className="max-h-64 overflow-y-auto">
                        <table className="min-w-full text-sm" aria-label="Audit log entries">
                          <thead className="bg-theme-input-bg sticky top-0">
                            <tr>
                              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-theme-text-muted">Time</th>
                              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-theme-text-muted">Event</th>
                              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-theme-text-muted">Severity</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/10">
                            {forensicsReport.audit_log.entries.slice(0, 50).map((entry, i) => (
                              <tr key={entry.id || i}>
                                <td className="px-3 py-2 text-xs text-theme-text-muted whitespace-nowrap">
                                  {entry.timestamp ? formatDate(entry.timestamp) : '—'}
                                </td>
                                <td className="px-3 py-2 text-xs">{entry.event_type}</td>
                                <td className="px-3 py-2">
                                  <span className={`text-xs px-2 py-0.5 rounded ${
                                    entry.severity === 'critical' ? 'bg-red-100 text-red-800' :
                                    entry.severity === 'warning' ? 'bg-yellow-100 text-yellow-800' :
                                    'bg-gray-100 text-gray-800'
                                  }`}>
                                    {entry.severity || 'info'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-theme-surface-border pt-3">
                    <button
                      onClick={handleLoadForensics}
                      disabled={loadingForensics}
                      className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
                    >
                      {loadingForensics ? 'Refreshing...' : 'Refresh Forensics Report'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ==================== */}
      {/* Modals */}
      {/* ==================== */}

      {/* Send Ballot Emails Modal */}
      {showSendEmailModal && election && (
        <div
          className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="send-email-modal-title"
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowSendEmailModal(false); setSendEmailError(null); } }}
        >
          <div className="bg-slate-800 rounded-lg shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-theme-surface-border">
              <h3 id="send-email-modal-title" className="text-lg font-medium text-theme-text-primary">
                {election.email_sent ? 'Resend Ballot Emails' : 'Send Ballot Emails'}
              </h3>
            </div>

            <div className="px-6 py-4">
              {election.email_sent && (
                <div className="mb-4 bg-yellow-500/10 border border-yellow-500/30 rounded p-3">
                  <p className="text-sm text-yellow-700 dark:text-yellow-300">
                    Ballot emails were previously sent{election.email_sent_at ? ` on ${formatDate(election.email_sent_at)}` : ''}.
                    Sending again will generate new voting tokens for all eligible voters.
                  </p>
                </div>
              )}

              {sendEmailError && (
                <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded p-3" role="alert">
                  <p className="text-sm text-red-700 dark:text-red-300">{sendEmailError}</p>
                </div>
              )}

              <div className="space-y-4">
                <p className="text-sm text-theme-text-secondary">
                  This will send ballot emails with unique voting links to all eligible voters.
                </p>

                <div>
                  <label htmlFor="ballot-email-subject" className="block text-sm font-medium text-slate-200">
                    Custom Subject Line <span className="text-xs text-slate-500">(optional)</span>
                  </label>
                  <input
                    type="text"
                    id="ballot-email-subject"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder={`Vote Now: ${election.title}`}
                    aria-label="Custom subject line"
                    className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label htmlFor="ballot-email-message" className="block text-sm font-medium text-slate-200">
                    Additional Message <span className="text-xs text-slate-500">(optional)</span>
                  </label>
                  <textarea
                    id="ballot-email-message"
                    value={emailMessage}
                    onChange={(e) => setEmailMessage(e.target.value)}
                    rows={3}
                    placeholder="Include any additional instructions or context for voters..."
                    aria-label="Additional message"
                    className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowSendEmailModal(false);
                    setEmailSubject('');
                    setEmailMessage('');
                    setSendEmailError(null);
                  }}
                  disabled={isSendingEmails}
                  className="px-4 py-2 border border-white/30 rounded-md text-theme-text-secondary hover:bg-theme-surface-secondary disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSendBallotEmails}
                  disabled={isSendingEmails}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isSendingEmails ? 'Sending...' : 'Send Ballots'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Election Modal */}
      {showDeleteModal && election && (
        <div
          className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-election-modal-title"
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowDeleteModal(false); setDeleteReason(''); setDeleteError(null); } }}
        >
          <div className="bg-slate-800 rounded-lg shadow-xl max-w-lg w-full">
            <div className={`px-6 py-4 border-b ${isDraft ? 'border-theme-surface-border' : 'border-red-500/30 bg-red-500/10'}`}>
              <h3 id="delete-election-modal-title" className={`text-lg font-medium ${isDraft ? 'text-theme-text-primary' : 'text-red-700 dark:text-red-300'}`}>
                {isDraft ? 'Delete Draft Election' : 'DELETE ACTIVE ELECTION'}
              </h3>
            </div>

            <div className="px-6 py-4">
              {/* Critical warning for non-draft elections */}
              {!isDraft && (
                <div className="bg-red-500/10 border-l-4 border-red-600 p-4 mb-4" role="alert">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-red-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-bold text-red-700 dark:text-red-300">
                        CRITICAL: This is a destructive, irreversible action
                      </h3>
                      <div className="mt-2 text-sm text-red-700 dark:text-red-300">
                        <p>Deleting this {election.status.toUpperCase()} election will:</p>
                        <ul className="list-disc list-inside mt-1 space-y-1">
                          <li><strong>Permanently destroy</strong> the election and all associated data</li>
                          <li>Send <strong>CRITICAL alert emails</strong> to all leadership members (Chief, President, Vice President, Secretary)</li>
                          <li>Create a <strong>CRITICAL severity</strong> audit trail entry</li>
                          {election.total_votes && election.total_votes > 0 && (
                            <li>Destroy <strong>{election.total_votes} votes</strong> that have already been cast</li>
                          )}
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {isDraft && (
                <p className="text-sm text-theme-text-secondary mb-4">
                  Are you sure you want to delete this draft election? This action cannot be undone.
                </p>
              )}

              {deleteError && (
                <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded p-3" role="alert">
                  <p className="text-sm text-red-700 dark:text-red-300">{deleteError}</p>
                </div>
              )}

              {/* Reason input for non-draft elections */}
              {!isDraft && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-200">
                      Current Status
                    </label>
                    <div className="mt-1 text-sm font-semibold text-red-700 dark:text-red-400">
                      {election.status.toUpperCase()}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="delete-election-reason" className="block text-sm font-medium text-slate-200">
                      Reason for Deletion <span aria-hidden="true">*</span> <span className="text-xs text-theme-text-muted">(minimum 10 characters)</span>
                    </label>
                    <textarea
                      id="delete-election-reason"
                      value={deleteReason}
                      onChange={(e) => setDeleteReason(e.target.value)}
                      rows={4}
                      placeholder="Provide a detailed reason why this active election must be deleted..."
                      className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:outline-none focus:ring-red-500 focus:border-red-500"
                      required
                      aria-required="true"
                    />
                    <p className="mt-1 text-xs text-red-700 dark:text-red-400">
                      This reason will be emailed to ALL leadership members and permanently logged in the audit trail.
                    </p>
                  </div>
                </div>
              )}

              <div className="mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteModal(false);
                    setDeleteReason('');
                    setDeleteError(null);
                  }}
                  disabled={isDeleting}
                  className="px-4 py-2 border border-white/30 rounded-md text-theme-text-secondary hover:bg-theme-surface-secondary disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteElection}
                  disabled={isDeleting || (!isDraft && deleteReason.trim().length < 10)}
                  className={`px-4 py-2 text-theme-text-primary rounded-md disabled:opacity-50 ${
                    isDraft
                      ? 'bg-gray-600 hover:bg-gray-700'
                      : 'bg-red-800 hover:bg-red-900'
                  }`}
                >
                  {isDeleting
                    ? 'Deleting...'
                    : isDraft
                    ? 'Delete Draft'
                    : 'Permanently Delete Election'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Extend Time Modal */}
      {showExtendModal && election && (
        <div
          className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="extend-election-modal-title"
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowExtendModal(false); setNewEndDate(''); setExtendError(null); } }}
        >
          <div className="bg-slate-800 rounded-lg shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-theme-surface-border">
              <h3 id="extend-election-modal-title" className="text-lg font-medium text-theme-text-primary">Extend Election Time</h3>
            </div>

            <div className="px-6 py-4">
              {extendError && (
                <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded p-3" role="alert">
                  <p className="text-sm text-red-700 dark:text-red-300">{extendError}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-200">
                    Current End Time
                  </label>
                  <div className="mt-1 text-sm text-theme-text-primary">
                    {formatDate(election.end_date)}
                  </div>
                </div>

                <div>
                  <label htmlFor="extend-new-end-time" className="block text-sm font-medium text-slate-200">
                    New End Time
                  </label>
                  <input
                    type="datetime-local"
                    id="extend-new-end-time"
                    value={newEndDate}
                    onChange={(e) => setNewEndDate(e.target.value)}
                    className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />

                  <div className="mt-2">
                    <p className="text-xs text-theme-text-muted mb-2">Quick extend:</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => extendByHours(1)}
                        className="px-3 py-1 text-xs bg-theme-surface text-theme-text-secondary rounded hover:bg-theme-surface-hover"
                      >
                        +1 Hour
                      </button>
                      <button
                        type="button"
                        onClick={() => extendByHours(2)}
                        className="px-3 py-1 text-xs bg-theme-surface text-theme-text-secondary rounded hover:bg-theme-surface-hover"
                      >
                        +2 Hours
                      </button>
                      <button
                        type="button"
                        onClick={() => extendByHours(4)}
                        className="px-3 py-1 text-xs bg-theme-surface text-theme-text-secondary rounded hover:bg-theme-surface-hover"
                      >
                        +4 Hours
                      </button>
                      <button
                        type="button"
                        onClick={() => extendToEndOfDay()}
                        className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                      >
                        End of Day
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowExtendModal(false);
                    setNewEndDate('');
                    setExtendError(null);
                  }}
                  className="px-4 py-2 border border-white/30 rounded-md text-theme-text-secondary hover:bg-theme-surface-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExtendElection}
                  className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
                >
                  Extend Election
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ballot Preview Modal */}
      {showPreview && election && (
        <div
          className="fixed inset-0 bg-gray-900 bg-opacity-80 flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ballot-preview-title"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowPreview(false); }}
        >
          <div className="bg-gray-50 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {/* Preview Banner */}
            <div className="sticky top-0 z-10 bg-amber-500 text-amber-900 px-4 py-2 text-center text-sm font-bold">
              BALLOT PREVIEW — This is how voters will see the ballot
            </div>

            {/* Ballot Header (matches BallotVotingPage) */}
            <div className="bg-red-700 text-white">
              <div className="px-6 py-6 text-center">
                <h3 id="ballot-preview-title" className="text-xl font-bold">{election.title}</h3>
                {election.description && (
                  <p className="mt-2 text-red-100">{election.description}</p>
                )}
              </div>
            </div>

            {/* Ballot Instructions */}
            <div className="px-6 pt-6">
              <p className="text-gray-600 text-sm">
                Please review each item below and make your selection. You may vote for the
                presented option, write in an alternative, or abstain from voting on any item.
              </p>
            </div>

            {/* Ballot Items */}
            <div className="px-6 py-6 space-y-6">
              {(election.ballot_items || []).length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  No ballot items have been added yet.
                </div>
              ) : (
                (election.ballot_items || []).map((item, index) => {
                  const itemCandidates = getPreviewCandidatesForItem(item);
                  const isApprovalType = item.vote_type === 'approval';

                  return (
                    <div
                      key={item.id}
                      className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden"
                    >
                      {/* Item Header */}
                      <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
                        <div className="flex items-start gap-3">
                          <span className="flex-shrink-0 w-8 h-8 bg-red-100 text-red-700 rounded-full flex items-center justify-center text-sm font-bold">
                            {index + 1}
                          </span>
                          <div>
                            <h4 className="font-semibold text-gray-900">{item.title}</h4>
                            {item.description && (
                              <p className="mt-1 text-sm text-gray-500">{item.description}</p>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Voting Options (disabled/preview) */}
                      <div className="px-6 py-4 space-y-3">
                        {isApprovalType ? (
                          <>
                            <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-200">
                              <input type="radio" disabled className="w-4 h-4 text-green-600" />
                              <span className="font-medium text-gray-900">Approve</span>
                            </div>
                            <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-200">
                              <input type="radio" disabled className="w-4 h-4 text-red-600" />
                              <span className="font-medium text-gray-900">Deny</span>
                            </div>
                          </>
                        ) : (
                          <>
                            {itemCandidates.length > 0 ? (
                              itemCandidates.map((candidate) => (
                                <div key={candidate.id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-200">
                                  <input type="radio" disabled className="w-4 h-4 text-blue-600" />
                                  <div>
                                    <span className="font-medium text-gray-900">{candidate.name}</span>
                                    {candidate.statement && (
                                      <p className="text-sm text-gray-500 mt-0.5">{candidate.statement}</p>
                                    )}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-sm">
                                No candidates added for this position yet.
                              </div>
                            )}
                          </>
                        )}

                        {election.allow_write_ins && (
                          <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-200">
                            <input type="radio" disabled className="w-4 h-4 text-purple-600" />
                            <span className="font-medium text-gray-900">Write-in</span>
                          </div>
                        )}

                        <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-200">
                          <input type="radio" disabled className="w-4 h-4 text-gray-400" />
                          <span className="text-gray-500">Abstain (Do not vote on this item)</span>
                        </div>
                      </div>

                      {/* Item metadata for admin */}
                      <div className="px-6 py-2 bg-gray-50 border-t border-gray-100 flex flex-wrap gap-2">
                        <span className="text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-600">
                          {item.type?.replace('_', ' ')}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-600">
                          {isApprovalType ? 'Yes/No vote' : 'Candidate selection'}
                        </span>
                        {item.require_attendance && (
                          <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-700">
                            Requires attendance
                          </span>
                        )}
                        {item.eligible_voter_types && !item.eligible_voter_types.includes('all') && (
                          <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                            Restricted: {item.eligible_voter_types.join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}

              {/* Preview-only Submit Button (disabled) */}
              {(election.ballot_items || []).length > 0 && (
                <div className="text-center pt-4">
                  <button
                    type="button"
                    disabled
                    className="px-8 py-3 bg-red-700 text-white text-lg font-semibold rounded-lg opacity-50 cursor-not-allowed"
                  >
                    Submit Ballot
                  </button>
                  <p className="mt-2 text-sm text-gray-400">
                    You will have a chance to review your choices before they are submitted.
                  </p>
                </div>
              )}
            </div>

            {/* Close button */}
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end">
              <button
                type="button"
                onClick={() => setShowPreview(false)}
                className="px-6 py-2 bg-slate-700 text-white rounded-md hover:bg-slate-800"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rollback Modal */}
      {showRollbackModal && election && (
        <div
          className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rollback-election-modal-title"
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowRollbackModal(false); setRollbackReason(''); setRollbackError(null); } }}
        >
          <div className="bg-slate-800 rounded-lg shadow-xl max-w-lg w-full">
            <div className="px-6 py-4 border-b border-theme-surface-border">
              <h3 id="rollback-election-modal-title" className="text-lg font-medium text-theme-text-primary">Rollback Election</h3>
            </div>

            <div className="px-6 py-4">
              {/* Warning Message */}
              <div className="bg-orange-500/10 border-l-4 border-orange-500 p-4 mb-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-orange-700 dark:text-orange-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-orange-700 dark:text-orange-300">
                      This action requires careful consideration
                    </h3>
                    <div className="mt-2 text-sm text-orange-700 dark:text-orange-300">
                      <p>Rolling back this election will:</p>
                      <ul className="list-disc list-inside mt-1 space-y-1">
                        <li>Change the election status from <strong>{election.status.toUpperCase()}</strong> to <strong>{election.status === 'closed' ? 'OPEN' : 'DRAFT'}</strong></li>
                        <li>Send email notifications to all leadership members</li>
                        <li>Create an audit trail entry with your reason</li>
                        {election.status === 'closed' && <li>Allow voting to resume (for closed&rarr;open)</li>}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              {rollbackError && (
                <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded p-3" role="alert">
                  <p className="text-sm text-red-700 dark:text-red-300">{rollbackError}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-200">
                    Current Status
                  </label>
                  <div className="mt-1 text-sm font-semibold text-theme-text-primary">
                    {election.status.toUpperCase()}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-200">
                    New Status After Rollback
                  </label>
                  <div className="mt-1 text-sm font-semibold text-green-600">
                    {election.status === 'closed' ? 'OPEN' : 'DRAFT'}
                  </div>
                </div>

                <div>
                  <label htmlFor="rollback-reason" className="block text-sm font-medium text-slate-200">
                    Reason for Rollback <span aria-hidden="true">*</span> <span className="text-xs text-theme-text-muted">(minimum 10 characters)</span>
                  </label>
                  <textarea
                    id="rollback-reason"
                    value={rollbackReason}
                    onChange={(e) => setRollbackReason(e.target.value)}
                    rows={4}
                    placeholder="Example: Vote counting error discovered, need to recount all ballots..."
                    className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:outline-none focus:ring-orange-500 focus:border-orange-500"
                    required
                    aria-required="true"
                  />
                  <p className="mt-1 text-xs text-theme-text-muted">
                    This reason will be sent to all leadership members and logged in the audit trail.
                  </p>
                </div>
              </div>

              <div className="mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowRollbackModal(false);
                    setRollbackReason('');
                    setRollbackError(null);
                  }}
                  disabled={isRollingBack}
                  className="px-4 py-2 border border-white/30 rounded-md text-theme-text-secondary hover:bg-theme-surface-secondary disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleRollbackElection}
                  disabled={isRollingBack || rollbackReason.trim().length < 10}
                  className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50"
                >
                  {isRollingBack ? 'Rolling Back...' : 'Confirm Rollback'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
};

export default ElectionDetailPage;
