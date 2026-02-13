/**
 * Election Detail Page
 *
 * Shows detailed information about an election including results.
 */

import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { electionService } from '../services/api';
import type { Election, ForensicsReport, VoteIntegrityResult } from '../types/election';
import { ElectionResults } from '../components/ElectionResults';
import { ElectionBallot } from '../components/ElectionBallot';
import { CandidateManagement } from '../components/CandidateManagement';
import { BallotBuilder } from '../components/BallotBuilder';
import { MeetingAttendance } from '../components/MeetingAttendance';
import { useAuthStore } from '../stores/authStore';

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
    } catch (err: any) {
      console.error('Error fetching election:', err);
      setError(err.response?.data?.detail || 'Failed to load election');
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
    } catch (err: any) {
      console.error('Error updating visibility:', err);
      toast.error(err.response?.data?.detail || 'Failed to update visibility');
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
    } catch (err: any) {
      console.error('Error opening election:', err);
      toast.error(err.response?.data?.detail || 'Failed to open election');
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
    } catch (err: any) {
      console.error('Error closing election:', err);
      toast.error(err.response?.data?.detail || 'Failed to close election');
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
    } catch (err: any) {
      console.error('Error extending election:', err);
      setExtendError(err.response?.data?.detail || 'Failed to extend election');
    }
  };

  const extendByHours = (hours: number) => {
    if (!election) return;
    const currentEnd = new Date(election.end_date);
    const newEnd = new Date(currentEnd.getTime() + hours * 60 * 60 * 1000);
    setNewEndDate(newEnd.toISOString().slice(0, 16));
  };

  const extendToEndOfDay = () => {
    if (!election) return;
    const currentEnd = new Date(election.end_date);
    currentEnd.setHours(23, 59, 0, 0);
    setNewEndDate(currentEnd.toISOString().slice(0, 16));
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
    } catch (err: any) {
      console.error('Error rolling back election:', err);
      setRollbackError(err.response?.data?.detail || 'Failed to rollback election');
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
    } catch (err: any) {
      console.error('Error sending ballot emails:', err);
      setSendEmailError(err.response?.data?.detail || 'Failed to send ballot emails');
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
    } catch (err: any) {
      console.error('Error deleting election:', err);
      setDeleteError(err.response?.data?.detail || 'Failed to delete election');
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
    } catch (err: any) {
      console.error('Error verifying integrity:', err);
      toast.error(err.response?.data?.detail || 'Failed to verify integrity');
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
    } catch (err: any) {
      console.error('Error loading forensics:', err);
      toast.error(err.response?.data?.detail || 'Failed to load forensics report');
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
    } catch (err: any) {
      console.error('Error voiding vote:', err);
      toast.error(err.response?.data?.detail || 'Failed to void vote');
    } finally {
      setIsVoidingVote(false);
    }
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-center items-center h-64" role="status" aria-live="polite">
          <div className="text-gray-500">Loading election...</div>
        </div>
      </div>
    );
  }

  if (error || !election) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4" role="alert">
          <p className="text-sm text-red-700">{error || 'Election not found'}</p>
        </div>
      </div>
    );
  }

  const resultsAvailable = election.status === 'closed' || election.results_visible_immediately;
  const isDraft = election.status === 'draft';
  const isActiveOrCompleted = election.status === 'open' || election.status === 'closed';

  return (
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
              <h2 className="text-2xl font-bold text-gray-900">{election.title}</h2>
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
              <p className="mt-2 text-gray-600">{election.description}</p>
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
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-gray-500">Start Date</div>
            <div className="mt-1 text-sm font-medium text-gray-900">
              {formatDate(election.start_date)}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500">End Date</div>
            <div className="mt-1 text-sm font-medium text-gray-900">
              {formatDate(election.end_date)}
            </div>
          </div>
          {election.positions && election.positions.length > 0 && (
            <div className="col-span-2">
              <div className="text-sm text-gray-500">Positions</div>
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
            <div className="text-sm text-gray-500">Voting Method</div>
            <div className="mt-1 text-sm font-medium text-gray-900">
              {election.voting_method.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Anonymous Voting</div>
            <div className="mt-1 text-sm font-medium text-gray-900">
              {election.anonymous_voting ? 'Yes' : 'No'}
            </div>
          </div>
        </div>

        {/* Secretary Controls */}
        {canManage && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="flex flex-wrap gap-3">
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
                      ? 'bg-gray-600 text-white hover:bg-gray-700'
                      : 'bg-red-800 text-white hover:bg-red-900'
                  }`}
                >
                  Delete Election
                </button>
              )}

              {election.email_sent && (
                <div className="flex items-center text-sm text-gray-600">
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
            className="w-full bg-white shadow rounded-lg p-4 flex items-center justify-between hover:bg-gray-50"
          >
            <span className="text-lg font-medium text-gray-900">
              {showResults ? 'Hide Results' : 'View Results'}
            </span>
            <svg
              className={`h-6 w-6 text-gray-400 transform transition-transform ${
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
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-700">
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
            className="w-full bg-white shadow rounded-lg p-4 flex items-center justify-between hover:bg-gray-50"
          >
            <span className="text-lg font-medium text-gray-900">
              Forensics &amp; Integrity
            </span>
            <svg
              className={`h-6 w-6 text-gray-400 transform transition-transform ${
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
            <div className="bg-white shadow rounded-lg mt-2 p-6 space-y-6">
              {/* Integrity Check */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-md font-semibold text-gray-900">Vote Integrity Check</h3>
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
                      ? 'bg-green-50 border-green-200'
                      : 'bg-red-50 border-red-200'
                  }`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-lg font-bold ${
                        integrityResult.integrity_status === 'PASS' ? 'text-green-700' : 'text-red-700'
                      }`}>
                        {integrityResult.integrity_status === 'PASS' ? 'PASS' : 'FAIL'}
                      </span>
                      <span className="text-sm text-gray-600">
                        ({integrityResult.valid_signatures}/{integrityResult.total_votes} valid signatures)
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div>
                        <span className="text-gray-500">Total Votes:</span>{' '}
                        <span className="font-medium">{integrityResult.total_votes}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Valid:</span>{' '}
                        <span className="font-medium text-green-700">{integrityResult.valid_signatures}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Unsigned:</span>{' '}
                        <span className="font-medium text-yellow-700">{integrityResult.unsigned_votes}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Tampered:</span>{' '}
                        <span className={`font-medium ${integrityResult.tampered_votes > 0 ? 'text-red-700' : 'text-green-700'}`}>
                          {integrityResult.tampered_votes}
                        </span>
                      </div>
                    </div>
                    {integrityResult.tampered_vote_ids.length > 0 && (
                      <div className="mt-3 p-3 bg-red-100 rounded">
                        <p className="text-sm font-semibold text-red-800 mb-1">Tampered Vote IDs:</p>
                        <div className="space-y-1">
                          {integrityResult.tampered_vote_ids.map(id => (
                            <div key={id} className="flex items-center gap-2">
                              <code className="text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded">{id}</code>
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
              <div className="border-t pt-4">
                <h3 className="text-md font-semibold text-gray-900 mb-3">Void a Vote</h3>
                <p className="text-sm text-gray-500 mb-3">
                  Soft-deletes a vote with full audit trail. The vote is preserved but excluded from results.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    value={voidVoteId}
                    onChange={(e) => setVoidVoteId(e.target.value)}
                    placeholder="Vote ID (UUID)"
                    aria-label="Vote ID (UUID)"
                    className="flex-1 border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-red-500 focus:border-red-500"
                  />
                  <input
                    type="text"
                    value={voidVoteReason}
                    onChange={(e) => setVoidVoteReason(e.target.value)}
                    placeholder="Reason for voiding"
                    aria-label="Reason for voiding"
                    className="flex-1 border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-red-500 focus:border-red-500"
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
                <div className="text-center text-gray-500 py-4" role="status" aria-live="polite">Loading forensics report...</div>
              )}

              {forensicsReport && (
                <>
                  {/* Deleted Votes */}
                  <div className="border-t pt-4">
                    <h3 className="text-md font-semibold text-gray-900 mb-2">
                      Voided Votes ({forensicsReport.deleted_votes.count})
                    </h3>
                    {forensicsReport.deleted_votes.count === 0 ? (
                      <p className="text-sm text-gray-500">No votes have been voided.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm" aria-label="Voided votes">
                          <thead className="bg-gray-50">
                            <tr>
                              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500">Vote ID</th>
                              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500">Position</th>
                              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500">Reason</th>
                              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500">Deleted At</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
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
                    <div className="border-t pt-4">
                      <h3 className="text-md font-semibold text-red-700 mb-2">
                        Suspicious IP Addresses
                      </h3>
                      <div className="bg-red-50 border border-red-200 rounded p-3">
                        {Object.entries(forensicsReport.anomaly_detection.suspicious_ips).map(([ip, count]) => (
                          <div key={ip} className="flex justify-between text-sm py-1">
                            <code className="text-red-700">{ip}</code>
                            <span className="font-semibold text-red-800">{count} votes</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Voting Timeline */}
                  {Object.keys(forensicsReport.voting_timeline).length > 0 && (
                    <div className="border-t pt-4">
                      <h3 className="text-md font-semibold text-gray-900 mb-2">Voting Timeline</h3>
                      <div className="space-y-1">
                        {Object.entries(forensicsReport.voting_timeline)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([hour, count]) => (
                            <div key={hour} className="flex items-center gap-3 text-sm">
                              <span className="text-gray-500 w-40 font-mono">{hour}</span>
                              <div className="flex-1 bg-gray-200 rounded-full h-4">
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
                              <span className="text-gray-700 font-medium w-8 text-right">{count}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Token Summary */}
                  <div className="border-t pt-4">
                    <h3 className="text-md font-semibold text-gray-900 mb-2">Ballot Tokens</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                      <div className="bg-gray-50 rounded p-3">
                        <div className="text-gray-500">Issued</div>
                        <div className="text-xl font-semibold">{forensicsReport.voting_tokens.total_issued}</div>
                      </div>
                      <div className="bg-gray-50 rounded p-3">
                        <div className="text-gray-500">Used</div>
                        <div className="text-xl font-semibold">{forensicsReport.voting_tokens.total_used}</div>
                      </div>
                      <div className="bg-gray-50 rounded p-3">
                        <div className="text-gray-500">Unused</div>
                        <div className="text-xl font-semibold">
                          {forensicsReport.voting_tokens.total_issued - forensicsReport.voting_tokens.total_used}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Audit Log Summary */}
                  <div className="border-t pt-4">
                    <h3 className="text-md font-semibold text-gray-900 mb-2">
                      Audit Log ({forensicsReport.audit_log.total_entries} entries)
                    </h3>
                    {forensicsReport.audit_log.entries.length === 0 ? (
                      <p className="text-sm text-gray-500">No audit entries.</p>
                    ) : (
                      <div className="max-h-64 overflow-y-auto">
                        <table className="min-w-full text-sm" aria-label="Audit log entries">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500">Time</th>
                              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500">Event</th>
                              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500">Severity</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {forensicsReport.audit_log.entries.slice(0, 50).map((entry, i) => (
                              <tr key={entry.id || i}>
                                <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
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

                  <div className="border-t pt-3">
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
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 id="send-email-modal-title" className="text-lg font-medium text-gray-900">
                {election.email_sent ? 'Resend Ballot Emails' : 'Send Ballot Emails'}
              </h3>
            </div>

            <div className="px-6 py-4">
              {election.email_sent && (
                <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded p-3">
                  <p className="text-sm text-yellow-800">
                    Ballot emails were previously sent{election.email_sent_at ? ` on ${formatDate(election.email_sent_at)}` : ''}.
                    Sending again will generate new voting tokens for all eligible voters.
                  </p>
                </div>
              )}

              {sendEmailError && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded p-3" role="alert">
                  <p className="text-sm text-red-700">{sendEmailError}</p>
                </div>
              )}

              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  This will send ballot emails with unique voting links to all eligible voters.
                </p>

                <div>
                  <label htmlFor="ballot-email-subject" className="block text-sm font-medium text-gray-700">
                    Custom Subject Line <span className="text-xs text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    id="ballot-email-subject"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder={`Vote Now: ${election.title}`}
                    aria-label="Custom subject line"
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label htmlFor="ballot-email-message" className="block text-sm font-medium text-gray-700">
                    Additional Message <span className="text-xs text-gray-400">(optional)</span>
                  </label>
                  <textarea
                    id="ballot-email-message"
                    value={emailMessage}
                    onChange={(e) => setEmailMessage(e.target.value)}
                    rows={3}
                    placeholder="Include any additional instructions or context for voters..."
                    aria-label="Additional message"
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
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
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
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
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
            <div className={`px-6 py-4 border-b ${isDraft ? 'border-gray-200' : 'border-red-300 bg-red-50'}`}>
              <h3 id="delete-election-modal-title" className={`text-lg font-medium ${isDraft ? 'text-gray-900' : 'text-red-900'}`}>
                {isDraft ? 'Delete Draft Election' : 'DELETE ACTIVE ELECTION'}
              </h3>
            </div>

            <div className="px-6 py-4">
              {/* Critical warning for non-draft elections */}
              {!isDraft && (
                <div className="bg-red-50 border-l-4 border-red-600 p-4 mb-4" role="alert">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-red-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-bold text-red-800">
                        CRITICAL: This is a destructive, irreversible action
                      </h3>
                      <div className="mt-2 text-sm text-red-700">
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
                <p className="text-sm text-gray-600 mb-4">
                  Are you sure you want to delete this draft election? This action cannot be undone.
                </p>
              )}

              {deleteError && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded p-3" role="alert">
                  <p className="text-sm text-red-700">{deleteError}</p>
                </div>
              )}

              {/* Reason input for non-draft elections */}
              {!isDraft && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Current Status
                    </label>
                    <div className="mt-1 text-sm font-semibold text-red-600">
                      {election.status.toUpperCase()}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="delete-election-reason" className="block text-sm font-medium text-gray-700">
                      Reason for Deletion <span aria-hidden="true">*</span> <span className="text-xs text-gray-500">(minimum 10 characters)</span>
                    </label>
                    <textarea
                      id="delete-election-reason"
                      value={deleteReason}
                      onChange={(e) => setDeleteReason(e.target.value)}
                      rows={4}
                      placeholder="Provide a detailed reason why this active election must be deleted..."
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-red-500 focus:border-red-500"
                      required
                      aria-required="true"
                    />
                    <p className="mt-1 text-xs text-red-600">
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
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteElection}
                  disabled={isDeleting || (!isDraft && deleteReason.trim().length < 10)}
                  className={`px-4 py-2 text-white rounded-md disabled:opacity-50 ${
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
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 id="extend-election-modal-title" className="text-lg font-medium text-gray-900">Extend Election Time</h3>
            </div>

            <div className="px-6 py-4">
              {extendError && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded p-3" role="alert">
                  <p className="text-sm text-red-700">{extendError}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Current End Time
                  </label>
                  <div className="mt-1 text-sm text-gray-900">
                    {formatDate(election.end_date)}
                  </div>
                </div>

                <div>
                  <label htmlFor="extend-new-end-time" className="block text-sm font-medium text-gray-700">
                    New End Time
                  </label>
                  <input
                    type="datetime-local"
                    id="extend-new-end-time"
                    value={newEndDate}
                    onChange={(e) => setNewEndDate(e.target.value)}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />

                  <div className="mt-2">
                    <p className="text-xs text-gray-500 mb-2">Quick extend:</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => extendByHours(1)}
                        className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                      >
                        +1 Hour
                      </button>
                      <button
                        type="button"
                        onClick={() => extendByHours(2)}
                        className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                      >
                        +2 Hours
                      </button>
                      <button
                        type="button"
                        onClick={() => extendByHours(4)}
                        className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
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
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
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

      {/* Rollback Modal */}
      {showRollbackModal && election && (
        <div
          className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rollback-election-modal-title"
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowRollbackModal(false); setRollbackReason(''); setRollbackError(null); } }}
        >
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 id="rollback-election-modal-title" className="text-lg font-medium text-gray-900">Rollback Election</h3>
            </div>

            <div className="px-6 py-4">
              {/* Warning Message */}
              <div className="bg-orange-50 border-l-4 border-orange-500 p-4 mb-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-orange-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-orange-800">
                      This action requires careful consideration
                    </h3>
                    <div className="mt-2 text-sm text-orange-700">
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
                <div className="mb-4 bg-red-50 border border-red-200 rounded p-3" role="alert">
                  <p className="text-sm text-red-700">{rollbackError}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Current Status
                  </label>
                  <div className="mt-1 text-sm font-semibold text-gray-900">
                    {election.status.toUpperCase()}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    New Status After Rollback
                  </label>
                  <div className="mt-1 text-sm font-semibold text-green-600">
                    {election.status === 'closed' ? 'OPEN' : 'DRAFT'}
                  </div>
                </div>

                <div>
                  <label htmlFor="rollback-reason" className="block text-sm font-medium text-gray-700">
                    Reason for Rollback <span aria-hidden="true">*</span> <span className="text-xs text-gray-500">(minimum 10 characters)</span>
                  </label>
                  <textarea
                    id="rollback-reason"
                    value={rollbackReason}
                    onChange={(e) => setRollbackReason(e.target.value)}
                    rows={4}
                    placeholder="Example: Vote counting error discovered, need to recount all ballots..."
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-orange-500 focus:border-orange-500"
                    required
                    aria-required="true"
                  />
                  <p className="mt-1 text-xs text-gray-500">
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
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
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
  );
};

export default ElectionDetailPage;
