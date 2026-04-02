/**
 * Election Detail Page
 *
 * Shows detailed information about an election including results.
 */

import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { electionService, eventService, meetingsService } from '../services/api';
import type { MeetingRecord } from '../services/api';
import { electionPackageService, applicantService } from '../modules/prospective-members/services/api';
import type { ElectionPackage } from '../modules/prospective-members/types';
import type { Election, ForensicsReport, VoteIntegrityResult, Candidate } from '../types/election';
import type { EventListItem } from '../types/event';
import { ElectionResults } from '../components/ElectionResults';
import { ElectionBallot } from '../components/ElectionBallot';
import { CandidateManagement } from '../components/CandidateManagement';
import { BallotBuilder } from '../components/BallotBuilder';
import { MeetingAttendance } from '../components/MeetingAttendance';
import { VoterOverrideManagement } from '../components/VoterOverrideManagement';
import { ProxyVotingManagement } from '../components/ProxyVotingManagement';
import { EligibilityRoster } from '../modules/elections/components/EligibilityRoster';
import { RunoffChain } from '../modules/elections/components/RunoffChain';
import { PublishResultsPanel } from '../modules/elections/components/PublishResultsPanel';
import { ElectionWorkflowTabs } from '../modules/elections/components/ElectionWorkflowTabs';
import { useAuthStore } from '../stores/authStore';
import { ElectionStatus } from '../constants/enums';
import { getErrorMessage } from '../utils/errorHandling';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate, formatDateTime, getTodayLocalDate, localToUTC } from '../utils/dateFormatting';
import { getTimeRemaining, getStatusBadgeClass } from '../utils/electionHelpers';
import SendBallotEmailsModal from '../components/election-detail/SendBallotEmailsModal';
import RemindNonVotersModal from '../components/election-detail/RemindNonVotersModal';
import DeleteElectionModal from '../components/election-detail/DeleteElectionModal';
import ExtendElectionModal from '../components/election-detail/ExtendElectionModal';
import BallotPreviewModal from '../components/election-detail/BallotPreviewModal';
import RollbackElectionModal from '../components/election-detail/RollbackElectionModal';

export const ElectionDetailPage: React.FC = () => {
  const { electionId } = useParams<{ electionId: string }>();
  const navigate = useNavigate();
  // Core election state
  const [election, setElection] = useState<Election | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Modal visibility state
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [extendError, setExtendError] = useState<string | null>(null);
  const [showRollbackModal, setShowRollbackModal] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [showSendEmailModal, setShowSendEmailModal] = useState(false);
  const [isSendingEmails, setIsSendingEmails] = useState(false);
  const [sendEmailError, setSendEmailError] = useState<string | null>(null);
  const [lastSkippedDetails, setLastSkippedDetails] = useState<Array<{ name: string; reason: string }>>([]);
  const [isLoadingNonVoters, setIsLoadingNonVoters] = useState(false);
  const [showRemindModal, setShowRemindModal] = useState(false);
  const [nonVoterCount, setNonVoterCount] = useState(0);
  const [nonVoterIds, setNonVoterIds] = useState<string[]>([]);
  const [isSendingReminders, setIsSendingReminders] = useState(false);
  const [remindError, setRemindError] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
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

  // Tabbed workflow state
  const [activeTab, setActiveTab] = useState('ballot');

  // Pending election packages state
  const [pendingPackages, setPendingPackages] = useState<ElectionPackage[]>([]);
  const [isLoadingPackages, setIsLoadingPackages] = useState(false);
  const [showPendingPackages, setShowPendingPackages] = useState(false);
  const [assigningPackageId, setAssigningPackageId] = useState<string | null>(null);

  // Upcoming events state
  const [upcomingEvents, setUpcomingEvents] = useState<EventListItem[]>([]);

  // Meeting binding state
  const [showMeetingSelector, setShowMeetingSelector] = useState(false);
  const [availableMeetings, setAvailableMeetings] = useState<MeetingRecord[]>([]);
  const [isImportingAttendees, setIsImportingAttendees] = useState(false);

  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('elections.manage');
  const tz = useTimezone();

  useEffect(() => {
    if (electionId) {
      void fetchElection();
    }
    void fetchUpcomingEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [electionId]);

  const fetchElection = async () => {
    if (!electionId) return;

    try {
      setLoading(true);
      setError(null);
      const data = await electionService.getElection(electionId);
      setElection(data);

      // Auto-select results tab if they're available
      if (data.status === ElectionStatus.CLOSED || data.results_visible_immediately) {
        setActiveTab('results');
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load election'));
    } finally {
      setLoading(false);
    }
  };

  const fetchUpcomingEvents = async () => {
    try {
      const today = getTodayLocalDate(tz);
      const events = await eventService.getEvents({
        start_after: today,
        limit: 10,
      });
      setUpcomingEvents(events);
    } catch {
      // Non-critical — section will just be empty
    }
  };

  const fetchAvailableMeetings = async () => {
    try {
      const data = await meetingsService.getMeetings({ limit: 100 });
      setAvailableMeetings(data.meetings);
    } catch {
      // Non-critical
    }
  };

  const handleMeetingChange = async (value: string) => {
    if (!electionId || !election) return;

    const [source, id] = value
      ? [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)]
      : ['', ''];

    try {
      const updateData: Record<string, string | undefined> = {};
      if (source === 'meeting') {
        const meeting = availableMeetings.find(m => m.id === id);
        updateData.meeting_id = id;
        updateData.event_id = undefined;
        updateData.meeting_date = meeting?.meeting_date;
      } else if (source === 'event') {
        const event = upcomingEvents.find(e => e.id === id);
        updateData.meeting_id = undefined;
        updateData.event_id = id;
        updateData.meeting_date = event?.start_datetime;
      } else {
        updateData.meeting_id = undefined;
        updateData.event_id = undefined;
        updateData.meeting_date = undefined;
      }

      const updated = await electionService.updateElection(electionId, updateData);
      setElection(updated);
      setShowMeetingSelector(false);
      toast.success('Meeting link updated');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update meeting link'));
    }
  };

  const handleImportMeetingAttendees = async () => {
    if (!electionId || !election?.meeting_id) return;

    try {
      setIsImportingAttendees(true);
      const result = await electionService.importMeetingAttendees(electionId);
      toast.success(result.message);
      void fetchElection();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to import meeting attendees'));
    } finally {
      setIsImportingAttendees(false);
    }
  };

  const fetchPendingPackages = async () => {
    setIsLoadingPackages(true);
    try {
      const packages = await electionPackageService.getPendingPackages();
      setPendingPackages(packages);
    } catch {
      // Non-critical
    } finally {
      setIsLoadingPackages(false);
    }
  };

  const handleAssignPackage = async (pkg: ElectionPackage) => {
    if (!electionId) return;
    setAssigningPackageId(pkg.id);
    try {
      await applicantService.assignToElection(pkg.applicant_id, electionId);
      toast.success(`Added "${pkg.applicant_name}" to ballot`);
      setPendingPackages((prev) => prev.filter((p) => p.id !== pkg.id));
      void fetchElection();
    } catch {
      toast.error('Failed to add application to ballot');
    } finally {
      setAssigningPackageId(null);
    }
  };

  // ── Election lifecycle handlers ──────────────────────────────────

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
      setActiveTab('results');
      toast.success('Election closed successfully');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to close election'));
    }
  };

  const handleExtendElection = async (newEndDate: string) => {
    if (!electionId || !newEndDate) return;

    try {
      setExtendError(null);
      const updated = await electionService.updateElection(electionId, {
        end_date: localToUTC(newEndDate, tz),
      });
      setElection(updated);
      setShowExtendModal(false);
    } catch (err: unknown) {
      setExtendError(getErrorMessage(err, 'Failed to extend election'));
    }
  };

  const handleRollbackElection = async (reason: string) => {
    if (!electionId) return;

    try {
      setIsRollingBack(true);
      setRollbackError(null);

      const response = await electionService.rollbackElection(electionId, reason);

      setElection(response.election);
      setShowRollbackModal(false);

      toast.success(`Election rolled back successfully. ${response.notifications_sent} leadership members were notified.`);
    } catch (err: unknown) {
      setRollbackError(getErrorMessage(err, 'Failed to rollback election'));
    } finally {
      setIsRollingBack(false);
    }
  };

  // ── Communication handlers ──────────────────────────────────────

  /** Sends ballot emails to all eligible voters. Tracks skipped members for UI banner. */
  const handleSendBallotEmails = async (payload: { subject: string; message: string; sendEligibilitySummary: boolean }) => {
    if (!electionId) return;

    try {
      setIsSendingEmails(true);
      setSendEmailError(null);

      const response = await electionService.sendBallotEmail(electionId, {
        subject: payload.subject.trim() || undefined,
        message: payload.message.trim() || undefined,
        include_ballot_link: true,
        send_eligibility_summary: payload.sendEligibilitySummary,
      });

      setShowSendEmailModal(false);
      void fetchElection(); // Refresh to update email_sent status

      // Persist skipped details so they stay visible in a banner
      if (response.skipped_details && response.skipped_details.length > 0) {
        setLastSkippedDetails(
          response.skipped_details.map((d) => ({ name: d.name, reason: d.reason })),
        );
      } else {
        setLastSkippedDetails([]);
      }

      if (!response.success && response.recipients_count === 0 && response.failed_count === 0) {
        toast.error(
          response.message || 'No eligible recipients found. Verify election settings.',
        );
        return;
      }

      const parts = [`Ballots sent to ${response.recipients_count} voter(s)`];
      if (response.failed_count > 0) {
        parts.push(`${response.failed_count} failed`);
      }
      if (response.skipped_count > 0) {
        parts.push(`${response.skipped_count} skipped (see banner below)`);
      }

      if (!response.success) {
        toast.error(parts.join(', '));
      } else {
        toast.success(parts.join(', '));
      }
    } catch (err: unknown) {
      setSendEmailError(getErrorMessage(err, 'Failed to send ballot emails'));
    } finally {
      setIsSendingEmails(false);
    }
  };

  /** Loads the list of non-voters and opens the reminder modal. */
  const handleOpenRemindModal = async () => {
    if (!electionId) return;

    try {
      setIsLoadingNonVoters(true);
      const data = await electionService.getNonVoters(electionId);
      setNonVoterCount(data.count);
      setNonVoterIds(data.non_voters.map((v) => v.id));

      if (data.count === 0) {
        toast.success('All eligible voters have already voted!');
        return;
      }

      setRemindError(null);
      setShowRemindModal(true);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load non-voters'));
    } finally {
      setIsLoadingNonVoters(false);
    }
  };

  const handleSendReminders = async (message: string) => {
    if (!electionId || nonVoterIds.length === 0) return;

    try {
      setIsSendingReminders(true);
      setRemindError(null);

      const response = await electionService.sendBallotEmail(electionId, {
        recipient_user_ids: nonVoterIds,
        message: message || 'This is a reminder to cast your vote. The voting window will be closing soon.',
        include_ballot_link: true,
      });

      setShowRemindModal(false);

      // Show skipped details from reminders in the persistent banner
      if (response.skipped_details && response.skipped_details.length > 0) {
        setLastSkippedDetails(
          response.skipped_details.map((d) => ({ name: d.name, reason: d.reason })),
        );
      }

      const parts = [`Reminders sent to ${response.recipients_count} non-voter(s)`];
      if (response.failed_count > 0) {
        parts.push(`${response.failed_count} failed`);
      }
      if (response.skipped_count > 0) {
        parts.push(`${response.skipped_count} skipped (see banner)`);
      }
      toast.success(parts.join(', '));
    } catch (err: unknown) {
      setRemindError(getErrorMessage(err, 'Failed to send reminders'));
    } finally {
      setIsSendingReminders(false);
    }
  };

  // ── Destructive action handlers ─────────────────────────────────

  /** Deletes the election. Requires a reason (10+ chars) for non-draft elections. */
  const handleDeleteElection = async (reason: string) => {
    if (!electionId || !election) return;

    const isDraft = election.status === ElectionStatus.DRAFT;

    try {
      setIsDeleting(true);
      setDeleteError(null);

      const response = await electionService.deleteElection(
        electionId,
        isDraft ? undefined : reason.trim(),
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

  // ── Forensics & integrity handlers ──────────────────────────────

  /** Verifies vote signatures and chain integrity. Results shown in forensics panel. */
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

  /** Loads the full forensics report (deleted votes, anomalies, timeline, tokens). */
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

  /** Soft-deletes a vote by ID. The vote is preserved but excluded from results. */
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
        void handleLoadForensics();
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
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert" aria-live="assertive">
            <p className="text-sm text-red-700 dark:text-red-300">{error || 'Election not found'}</p>
          </div>
        </div>
      </div>
    );
  }

  const resultsAvailable = election.status === ElectionStatus.CLOSED || election.results_visible_immediately;
  const isDraft = election.status === ElectionStatus.DRAFT;
  const isActiveOrCompleted = election.status === ElectionStatus.OPEN || election.status === ElectionStatus.CLOSED;

  // ── Lifecycle stepper config ────────────────────────────────────
  const lifecycleSteps = [
    { key: 'draft', label: 'Draft', description: 'Configure ballot & candidates' },
    { key: 'open', label: 'Voting Open', description: 'Members can cast votes' },
    { key: 'closed', label: 'Closed', description: 'Results finalized' },
  ] as const;

  /** Determines whether a lifecycle step is completed, current, or upcoming based on election status. */
  const getStepStatus = (stepKey: string): 'completed' | 'current' | 'upcoming' => {
    const order = ['draft', 'open', 'closed'];
    const currentIdx = election.status === ElectionStatus.CANCELLED
      ? -1
      : order.indexOf(election.status);
    const stepIdx = order.indexOf(stepKey);
    if (stepIdx < currentIdx) return 'completed';
    if (stepIdx === currentIdx) return 'current';
    return 'upcoming';
  };

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
                <span className="px-2 py-1 text-xs font-semibold bg-purple-100 dark:bg-purple-500/20 text-purple-800 dark:text-purple-400 rounded-sm">
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

      {/* Election Lifecycle Stepper */}
      {election.status !== ElectionStatus.CANCELLED && (
        <div className="bg-theme-surface backdrop-blur-xs shadow-sm rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between">
            {lifecycleSteps.map((step, idx) => {
              const status = getStepStatus(step.key);
              return (
                <React.Fragment key={step.key}>
                  {idx > 0 && (
                    <div className={`flex-1 h-0.5 mx-2 ${
                      status === 'upcoming'
                        ? 'bg-theme-surface-border'
                        : 'bg-blue-500'
                    }`} />
                  )}
                  <div className="flex items-center gap-2 shrink-0">
                    <div className={`flex items-center justify-center h-8 w-8 rounded-full text-sm font-semibold ${
                      status === 'completed'
                        ? 'bg-blue-600 text-white'
                        : status === 'current'
                          ? 'bg-blue-600 text-white ring-4 ring-blue-600/20'
                          : 'bg-theme-surface-secondary text-theme-text-muted border border-theme-surface-border'
                    }`}>
                      {status === 'completed' ? (
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        idx + 1
                      )}
                    </div>
                    <div className="hidden sm:block">
                      <div className={`text-sm font-medium ${
                        status === 'upcoming'
                          ? 'text-theme-text-muted'
                          : 'text-theme-text-primary'
                      }`}>
                        {step.label}
                      </div>
                      <div className="text-xs text-theme-text-muted">{step.description}</div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
          {/* Time remaining for open elections */}
          {election.status === ElectionStatus.OPEN && (
            <div className="mt-3 pt-3 border-t border-theme-surface-border flex items-center justify-center gap-2 text-sm">
              <svg className="h-4 w-4 text-theme-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {getTimeRemaining(election.end_date) ? (
                <span className="font-medium text-green-700 dark:text-green-400">{getTimeRemaining(election.end_date)}</span>
              ) : (
                <span className="font-medium text-red-700 dark:text-red-400">Voting period has ended</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Integrity Alert Banner */}
      {integrityResult && integrityResult.integrity_status !== 'PASS' && (
        <div className="bg-red-500/10 border-2 border-red-500/50 rounded-lg p-4 mb-6 flex items-start gap-3">
          <svg className="h-6 w-6 text-red-500 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <div>
            <h3 className="text-sm font-bold text-red-700 dark:text-red-300">
              Vote Integrity Issue Detected
            </h3>
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
              {integrityResult.tampered_votes > 0
                ? `${integrityResult.tampered_votes} tampered vote(s) detected. `
                : ''}
              {!integrityResult.chain_verified
                ? 'Vote chain is broken — votes may have been deleted or reordered. '
                : ''}
              Review the Forensics & Integrity section below for details.
            </p>
          </div>
        </div>
      )}

      {/* Skipped Voters Banner — persists until dismissed */}
      {canManage && lastSkippedDetails.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="text-sm font-bold text-amber-700 dark:text-amber-300">
                {lastSkippedDetails.length} member(s) skipped when sending ballots
              </h3>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 mb-2">
                These members were not sent a ballot because they did not meet the eligibility requirements for any ballot item.
                You can use voter overrides to grant exceptions.
              </p>
              <ul className="text-sm text-amber-700 dark:text-amber-300 space-y-1">
                {lastSkippedDetails.map((d, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-medium shrink-0">{d.name}:</span>
                    <span className="text-amber-600 dark:text-amber-400">{d.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              onClick={() => setLastSkippedDetails([])}
              className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 ml-4 shrink-0"
              aria-label="Dismiss skipped voters banner"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* Election Info */}
      <div className="bg-theme-surface backdrop-blur-xs shadow-sm rounded-lg p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-theme-text-muted">Start Date</div>
            <div className="mt-1 text-sm font-medium text-theme-text-primary">
              {formatDateTime(election.start_date, tz)}
            </div>
          </div>
          <div>
            <div className="text-sm text-theme-text-muted">End Date</div>
            <div className="mt-1 text-sm font-medium text-theme-text-primary">
              {formatDateTime(election.end_date, tz)}
            </div>
          </div>
          {election.positions && election.positions.length > 0 && (
            <div className="col-span-2">
              <div className="text-sm text-theme-text-muted">Positions</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {election.positions.map((position) => (
                  <span
                    key={position}
                    className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400"
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
          <div>
            <div className="text-sm text-theme-text-muted">Linked Meeting</div>
            <div className="mt-1 text-sm font-medium text-theme-text-primary">
              {election.meeting_id ? (
                <div className="flex items-center gap-2">
                  <Link to={`/meetings/${election.meeting_id}`} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300">
                    {election.meeting_title || 'View Meeting'} &rarr;
                  </Link>
                  {canManage && election.status === ElectionStatus.DRAFT && (
                    <button
                      onClick={() => { void fetchAvailableMeetings(); setShowMeetingSelector(true); }}
                      className="text-xs text-theme-text-muted hover:text-theme-text-secondary"
                      title="Change linked meeting"
                    >
                      (change)
                    </button>
                  )}
                </div>
              ) : election.event_id ? (
                <div className="flex items-center gap-2">
                  <Link to={`/events/${election.event_id}`} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300">
                    View Event &rarr;
                  </Link>
                  {canManage && election.status === ElectionStatus.DRAFT && (
                    <button
                      onClick={() => { void fetchAvailableMeetings(); setShowMeetingSelector(true); }}
                      className="text-xs text-theme-text-muted hover:text-theme-text-secondary"
                      title="Change linked meeting"
                    >
                      (change)
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-theme-text-muted">None</span>
                  {canManage && election.status === ElectionStatus.DRAFT && (
                    <button
                      onClick={() => { void fetchAvailableMeetings(); setShowMeetingSelector(true); }}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                    >
                      Link a meeting
                    </button>
                  )}
                </div>
              )}
            </div>
            {election.meeting_id && election.meeting_date && (
              <div className="mt-0.5 text-xs text-theme-text-muted">
                {election.meeting_type && (
                  <span className="capitalize">{election.meeting_type.replace('_', ' ')}</span>
                )}
                {election.meeting_type && ' — '}
                {formatDate(election.meeting_date, tz)}
              </div>
            )}
          </div>
        </div>

        {/* Meeting Selector Modal (inline) */}
        {showMeetingSelector && canManage && (
          <div className="mt-4 p-4 bg-theme-surface-alt rounded-lg border border-theme-surface-border">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-theme-text-primary">Link Meeting or Event</h4>
              <button
                onClick={() => setShowMeetingSelector(false)}
                className="text-theme-text-muted hover:text-theme-text-secondary text-sm"
              >
                Cancel
              </button>
            </div>
            <select
              value={election.meeting_id ? `meeting:${election.meeting_id}` : election.event_id ? `event:${election.event_id}` : ''}
              onChange={(e) => void handleMeetingChange(e.target.value)}
              className="block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-xs py-2 px-3 text-theme-text-primary text-sm focus:outline-hidden focus:ring-theme-focus-ring focus:border-theme-focus-ring"
            >
              <option value="">No linked meeting</option>
              {upcomingEvents.map((event) => (
                <option key={`event-${event.id}`} value={`event:${event.id}`}>
                  {event.title} ({formatDate(event.start_datetime, tz)})
                </option>
              ))}
              {availableMeetings.length > 0 && (
                <optgroup label="Meeting Minutes">
                  {availableMeetings.map((meeting) => (
                    <option key={`meeting-${meeting.id}`} value={`meeting:${meeting.id}`}>
                      {meeting.title} ({formatDate(meeting.meeting_date, tz)})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        )}

        {/* Import Attendees from Linked Meeting or Event */}
        {(election.meeting_id || election.event_id) && canManage && election.status === ElectionStatus.DRAFT && (
          <div className="mt-4">
            <button
              onClick={() => void handleImportMeetingAttendees()}
              disabled={isImportingAttendees}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 text-sm"
            >
              {isImportingAttendees ? 'Importing...' : `Import Attendees from ${election.meeting_id ? 'Meeting' : 'Event'}`}
            </button>
            <p className="mt-1 text-xs text-theme-text-muted">
              {election.meeting_id
                ? 'Copy the attendance list from the linked meeting into this election.'
                : 'Copy checked-in attendees (or RSVPs) from the linked event into this election.'}
            </p>
          </div>
        )}

        {/* Secretary Controls */}
        {canManage && (
          <div className="mt-6 pt-6 border-t border-theme-surface-border space-y-4">
            {/* Lifecycle Actions */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-2">
                Lifecycle
              </h4>
              <div className="flex flex-wrap gap-2">
                {election.ballot_items && election.ballot_items.length > 0 && (
                  <button
                    onClick={() => { void handleOpenPreview(); }}
                    disabled={loadingPreview}
                    className="px-4 py-2 bg-cyan-600 text-white rounded-md hover:bg-cyan-700 disabled:opacity-50 text-sm"
                  >
                    {loadingPreview ? 'Loading Preview...' : 'Preview Ballot'}
                  </button>
                )}

                {election.status === ElectionStatus.DRAFT && (
                  <button
                    onClick={() => { void handleOpenElection(); }}
                    className="btn-success rounded-md text-sm"
                  >
                    Open Election
                  </button>
                )}

                {election.status === ElectionStatus.OPEN && (
                  <>
                    <button
                      onClick={() => {
                        setShowExtendModal(true);
                      }}
                      className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 text-sm"
                    >
                      Extend Time
                    </button>
                    <button
                      onClick={() => { void handleCloseElection(); }}
                      className="btn-primary rounded-md text-sm"
                    >
                      Close Election
                    </button>
                  </>
                )}

                {(election.status === ElectionStatus.OPEN || election.status === ElectionStatus.CLOSED) && (
                  <button
                    onClick={() => setShowRollbackModal(true)}
                    className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 text-sm"
                  >
                    Rollback
                  </button>
                )}

              </div>
            </div>

            {/* Communication Actions */}
            {election.status === ElectionStatus.OPEN && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-2">
                  Communication
                </h4>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setShowSendEmailModal(true)}
                    disabled={!election.ballot_items || election.ballot_items.length === 0}
                    className="btn-primary text-sm"
                    title={
                      !election.ballot_items || election.ballot_items.length === 0
                        ? 'Add ballot items before sending emails'
                        : undefined
                    }
                  >
                    {election.email_sent ? 'Resend Ballot Emails' : 'Send Ballot Emails'}
                  </button>
                  {election.email_sent && (
                    <button
                      onClick={() => { void handleOpenRemindModal(); }}
                      disabled={isLoadingNonVoters}
                      className="px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50 text-sm"
                    >
                      {isLoadingNonVoters ? 'Loading...' : 'Remind Non-Voters'}
                    </button>
                  )}
                  {election.email_sent && (
                    <span className="inline-flex items-center text-xs text-theme-text-muted gap-1">
                      <svg className="h-4 w-4 text-green-600" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                        <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                      </svg>
                      Sent {election.email_sent_at ? formatDateTime(election.email_sent_at, tz) : 'N/A'}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Danger Zone */}
            {election.status !== ElectionStatus.CANCELLED && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-red-500 dark:text-red-400 mb-2">
                  Danger Zone
                </h4>
                <button
                  onClick={() => setShowDeleteModal(true)}
                  className={`px-4 py-2 rounded-md text-sm ${
                    isDraft
                      ? 'bg-theme-surface-hover text-theme-text-primary hover:bg-theme-surface-secondary'
                      : 'bg-red-800 text-white hover:bg-red-900'
                  }`}
                >
                  Delete Election
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Runoff Chain (multi-stage elections) */}
      <RunoffChain election={election} />

      {/* Publish Results Panel (secretary - open/closed elections) */}
      {canManage && electionId && (
        <PublishResultsPanel
          electionId={electionId}
          election={election}
          onUpdate={setElection}
        />
      )}

      {/* Tabbed Workflow (secretary) */}
      {electionId && (
        <>
          <ElectionWorkflowTabs
            election={election}
            canManage={canManage}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />

          {/* Tab: Ballot Builder */}
          {activeTab === 'ballot' && canManage && election.status !== ElectionStatus.CANCELLED && (
            <div className="mb-6 space-y-6">
              <BallotBuilder
                electionId={electionId}
                election={election}
                onUpdate={setElection}
              />

              {/* Pending Member Applications (draft only) */}
              {election.status === ElectionStatus.DRAFT && (
                <div className="bg-theme-surface rounded-xl shadow-sm border border-theme-surface-border overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-6 py-4 text-left"
                    onClick={() => {
                      const next = !showPendingPackages;
                      setShowPendingPackages(next);
                      if (next && pendingPackages.length === 0) void fetchPendingPackages();
                    }}
                  >
                    <h2 className="text-lg font-semibold text-theme-text-primary">
                      Pending Member Applications
                    </h2>
                    <span className="text-sm text-theme-text-muted">{showPendingPackages ? '▾' : '▸'}</span>
                  </button>

                  {showPendingPackages && (
                    <div className="px-6 pb-4">
                      {isLoadingPackages ? (
                        <p className="text-sm text-theme-text-muted py-2">Loading pending applications...</p>
                      ) : pendingPackages.length === 0 ? (
                        <p className="text-sm text-theme-text-muted py-2">
                          No applications are ready for ballot assignment.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-xs text-theme-text-muted mb-2">
                            {pendingPackages.length} application{pendingPackages.length !== 1 ? 's' : ''} ready to be added to this election.
                          </p>
                          {pendingPackages.map((pkg) => (
                            <div
                              key={pkg.id}
                              className="flex items-center justify-between p-3 bg-theme-bg rounded-lg border border-theme-surface-border"
                            >
                              <div>
                                <p className="text-sm font-medium text-theme-text-primary">{pkg.applicant_name}</p>
                                <p className="text-xs text-theme-text-muted capitalize">
                                  {pkg.target_membership_type} membership
                                  {pkg.coordinator_notes && ` — ${pkg.coordinator_notes}`}
                                </p>
                              </div>
                              <button
                                onClick={() => { void handleAssignPackage(pkg); }}
                                disabled={assigningPackageId === pkg.id}
                                className="px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors disabled:opacity-50"
                              >
                                {assigningPackageId === pkg.id ? 'Adding...' : 'Add to Ballot'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

            </div>
          )}

          {/* Tab: Candidates */}
          {activeTab === 'candidates' && canManage && (
            <div className="mb-6">
              <CandidateManagement electionId={electionId} election={election} />
            </div>
          )}

          {/* Tab: Eligibility Roster */}
          {activeTab === 'eligibility' && canManage && election.status !== ElectionStatus.CANCELLED && (
            <div className="mb-6">
              <EligibilityRoster electionId={electionId} />
            </div>
          )}

          {/* Tab: Attendance */}
          {activeTab === 'attendance' && canManage && election.status !== ElectionStatus.CANCELLED && (
            <div className="mb-6">
              <MeetingAttendance
                electionId={electionId}
                election={election}
                onUpdate={setElection}
              />
            </div>
          )}

          {/* Tab: Voter Overrides */}
          {activeTab === 'overrides' && canManage && election.status !== ElectionStatus.CANCELLED && (
            <div className="mb-6">
              <VoterOverrideManagement electionId={electionId} canManage={canManage} />
            </div>
          )}

          {/* Tab: Proxy Voting */}
          {activeTab === 'proxies' && canManage && election.status !== ElectionStatus.CANCELLED && (
            <div className="mb-6">
              <ProxyVotingManagement electionId={electionId} canManage={canManage} />
            </div>
          )}

          {/* Tab: Cast Vote (when election is open) */}
          {activeTab === 'voting' && election.status === ElectionStatus.OPEN && (
            <div className="mb-6">
              <ElectionBallot
                electionId={electionId}
                election={election}
                onVoteCast={() => { void fetchElection(); }}
              />
            </div>
          )}

          {/* Tab: Results */}
          {activeTab === 'results' && resultsAvailable && (
            <div className="mb-6">
              <ElectionResults electionId={electionId} election={election} />
            </div>
          )}
        </>
      )}

      {/* Message if results not available (non-tabbed fallback for non-admin users) */}
      {!canManage && !resultsAvailable && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            Results will be available when the election is closed.
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
                void handleLoadForensics();
              }
            }}
            className="w-full bg-theme-surface backdrop-blur-xs shadow-sm rounded-lg p-4 flex items-center justify-between hover:bg-theme-surface-hover"
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
            <div className="bg-theme-surface backdrop-blur-xs shadow-sm rounded-lg mt-2 p-6 space-y-6">
              {/* Integrity Check */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-md font-semibold text-theme-text-primary">Vote Integrity Check</h3>
                  <button
                    onClick={() => { void handleRunIntegrityCheck(); }}
                    disabled={loadingIntegrity}
                    className="btn-info px-3 py-1.5 rounded-md text-sm"
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
                        {integrityResult.integrity_status}
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
                    {/* Vote chain verification status */}
                    <div className="mt-3 flex items-center gap-2 text-sm">
                      <span className="text-theme-text-muted">Vote Chain:</span>
                      {integrityResult.chain_verified ? (
                        <span className="font-medium text-green-700 dark:text-green-300">Verified</span>
                      ) : (
                        <span className="font-medium text-red-700 dark:text-red-300">
                          Broken{integrityResult.chain_break_at ? ` at vote ${integrityResult.chain_break_at}` : ''}
                        </span>
                      )}
                    </div>
                    {integrityResult.tampered_vote_ids.length > 0 && (
                      <div className="mt-3 p-3 bg-red-500/20 rounded-sm">
                        <p className="text-sm font-semibold text-red-700 dark:text-red-300 mb-1">Tampered Vote IDs:</p>
                        <div className="space-y-1">
                          {integrityResult.tampered_vote_ids.map(id => (
                            <div key={id} className="flex items-center gap-2">
                              <code className="text-xs text-red-700 dark:text-red-300 bg-red-500/10 px-2 py-0.5 rounded-sm">{id}</code>
                              <button
                                onClick={() => setVoidVoteId(id)}
                                className="text-xs text-red-600 dark:text-red-400 underline hover:text-red-800 dark:hover:text-red-300"
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
                    className="flex-1 bg-theme-input-bg border border-theme-input-border rounded-md shadow-xs py-2 px-3 text-sm text-theme-text-primary focus:outline-hidden focus:ring-theme-focus-ring focus:border-theme-focus-ring"
                  />
                  <input
                    type="text"
                    value={voidVoteReason}
                    onChange={(e) => setVoidVoteReason(e.target.value)}
                    placeholder="Reason for voiding"
                    aria-label="Reason for voiding"
                    className="flex-1 bg-theme-input-bg border border-theme-input-border rounded-md shadow-xs py-2 px-3 text-sm text-theme-text-primary focus:outline-hidden focus:ring-theme-focus-ring focus:border-theme-focus-ring"
                  />
                  <button
                    onClick={() => { void handleVoidVote(); }}
                    disabled={isVoidingVote || !voidVoteId.trim() || !voidVoteReason.trim()}
                    className="btn-primary rounded-md text-sm whitespace-nowrap"
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
                          <thead className="bg-theme-surface-secondary">
                            <tr>
                              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-theme-text-muted">Vote ID</th>
                              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-theme-text-muted">Position</th>
                              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-theme-text-muted">Reason</th>
                              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-theme-text-muted">Deleted At</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-theme-surface-border">
                            {forensicsReport.deleted_votes.records.map(v => (
                              <tr key={v.vote_id}>
                                <td className="px-3 py-2 font-mono text-xs">{v.vote_id.slice(0, 8)}...</td>
                                <td className="px-3 py-2">{v.position || '—'}</td>
                                <td className="px-3 py-2">{v.deletion_reason || '—'}</td>
                                <td className="px-3 py-2">{v.deleted_at ? formatDateTime(v.deleted_at, tz) : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Anomaly Detection */}
                  {forensicsReport.anomaly_detection && Object.keys(forensicsReport.anomaly_detection.suspicious_ips || {}).length > 0 && (
                    <div className="border-t border-theme-surface-border pt-4">
                      <h3 className="text-md font-semibold text-red-700 dark:text-red-300 mb-2">
                        Suspicious IP Addresses
                      </h3>
                      <div className="bg-red-500/10 border border-red-500/30 rounded-sm p-3">
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
                  {forensicsReport.voting_timeline && Object.keys(forensicsReport.voting_timeline).length > 0 && (
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
                                      (Number(count) / Math.max(...Object.values(forensicsReport.voting_timeline).map(Number))) * 100
                                    )}%`,
                                  }}
                                />
                              </div>
                              <span className="text-theme-text-secondary font-medium w-8 text-right">{count}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Token Summary */}
                  <div className="border-t border-theme-surface-border pt-4">
                    <h3 className="text-md font-semibold text-theme-text-primary mb-2">Ballot Tokens</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                      <div className="bg-theme-surface-secondary rounded-sm p-3">
                        <div className="text-theme-text-muted">Issued</div>
                        <div className="text-xl font-semibold text-theme-text-primary">{forensicsReport.voting_tokens.total_issued}</div>
                      </div>
                      <div className="bg-theme-surface-secondary rounded-sm p-3">
                        <div className="text-theme-text-muted">Used</div>
                        <div className="text-xl font-semibold text-theme-text-primary">{forensicsReport.voting_tokens.total_used}</div>
                      </div>
                      <div className="bg-theme-surface-secondary rounded-sm p-3">
                        <div className="text-theme-text-muted">Unused</div>
                        <div className="text-xl font-semibold text-theme-text-primary">
                          {forensicsReport.voting_tokens.total_issued - forensicsReport.voting_tokens.total_used}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Audit Log Summary */}
                  {forensicsReport.audit_log && (
                  <div className="border-t border-theme-surface-border pt-4">
                    <h3 className="text-md font-semibold text-theme-text-primary mb-2">
                      Audit Log ({forensicsReport.audit_log.total_entries} entries)
                    </h3>
                    {(forensicsReport.audit_log.entries || []).length === 0 ? (
                      <p className="text-sm text-theme-text-muted">No audit entries.</p>
                    ) : (
                      <div className="max-h-64 overflow-y-auto">
                        <table className="min-w-full text-sm" aria-label="Audit log entries">
                          <thead className="bg-theme-surface-secondary sticky top-0">
                            <tr>
                              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-theme-text-muted">Time</th>
                              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-theme-text-muted">Event</th>
                              <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-theme-text-muted">Severity</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-theme-surface-border">
                            {(forensicsReport.audit_log.entries || []).slice(0, 50).map((entry, i) => (
                              <tr key={entry.id || i}>
                                <td className="px-3 py-2 text-xs text-theme-text-muted whitespace-nowrap">
                                  {entry.timestamp ? formatDateTime(entry.timestamp, tz) : '—'}
                                </td>
                                <td className="px-3 py-2 text-xs">{entry.event_type}</td>
                                <td className="px-3 py-2">
                                  <span className={`text-xs px-2 py-0.5 rounded ${
                                    entry.severity === 'critical' ? 'bg-red-500/10 text-red-700 dark:text-red-400' :
                                    entry.severity === 'warning' ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400' :
                                    'bg-theme-surface-secondary text-theme-text-muted'
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
                  )}

                  <div className="border-t border-theme-surface-border pt-3">
                    <button
                      onClick={() => { void handleLoadForensics(); }}
                      disabled={loadingForensics}
                      className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 disabled:opacity-50"
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

      {showSendEmailModal && election && (
        <SendBallotEmailsModal
          election={election}
          sending={isSendingEmails}
          error={sendEmailError}
          onSubmit={(payload) => { void handleSendBallotEmails(payload); }}
          onClose={() => { setShowSendEmailModal(false); setSendEmailError(null); }}
          timezone={tz}
        />
      )}

      {showRemindModal && election && (
        <RemindNonVotersModal
          nonVoterCount={nonVoterCount}
          sending={isSendingReminders}
          error={remindError}
          onSubmit={(message) => { void handleSendReminders(message); }}
          onClose={() => { setShowRemindModal(false); setRemindError(null); }}
        />
      )}

      {showDeleteModal && election && (
        <DeleteElectionModal
          election={election}
          isDraft={isDraft}
          deleting={isDeleting}
          error={deleteError}
          onSubmit={(reason) => { void handleDeleteElection(reason); }}
          onClose={() => { setShowDeleteModal(false); setDeleteError(null); }}
        />
      )}

      {showExtendModal && election && (
        <ExtendElectionModal
          currentEndDate={election.end_date}
          error={extendError}
          onSubmit={(newEndDate) => { void handleExtendElection(newEndDate); }}
          onClose={() => { setShowExtendModal(false); setExtendError(null); }}
          timezone={tz}
        />
      )}

      {showPreview && election && (
        <BallotPreviewModal
          election={election}
          candidates={previewCandidates}
          onClose={() => setShowPreview(false)}
          timezone={tz}
        />
      )}

      {showRollbackModal && election && (
        <RollbackElectionModal
          currentStatus={election.status.toUpperCase()}
          targetStatus={election.status === ElectionStatus.CLOSED ? 'OPEN' : 'DRAFT'}
          rolling={isRollingBack}
          error={rollbackError}
          onSubmit={(reason) => { void handleRollbackElection(reason); }}
          onClose={() => { setShowRollbackModal(false); setRollbackError(null); }}
        />
      )}
    </div>
    </div>
  );
};

export default ElectionDetailPage;
