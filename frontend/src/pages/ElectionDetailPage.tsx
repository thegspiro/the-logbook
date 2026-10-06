/**
 * Election Detail Page
 *
 * Shows detailed information about an election including results.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams, Link, useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import { electionService, eventService, meetingsService } from '../services/api';
import type { MeetingRecord } from '../services/api';
import { electionPackageService, applicantService } from '../modules/prospective-members/services/api';
import type { ElectionPackage } from '../modules/prospective-members/types';
import type {
  Election,
  ForensicsReport,
  VoteIntegrityResult,
  Candidate,
  ManualBallotBatch,
  ElectionUpdate,
} from '../types/election';
import type { EventListItem } from '../types/event';
import { ElectionResults } from '../components/ElectionResults';
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
import { ElectionBallot } from '../components/ElectionBallot';
import { ElectionStatus, VotingMethod } from '../constants/enums';
import { getErrorMessage } from '../utils/errorHandling';
import { Breadcrumbs, PromptDialog } from '../components/ux';
import { useConfirm } from '../contexts/ConfirmContext';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate, formatDateTime, getTodayLocalDate, localToUTC } from '../utils/dateFormatting';
import ElectionCloseStamp from '../components/election-detail/ElectionCloseStamp';
import { groupVoidedVotes } from '../utils/electionForensics';
import {
  getTimeRemaining,
  getStatusBadgeClass,
  getVictoryDescription,
  describePackageSendError,
  electionCanEmailBallots,
} from '../utils/electionHelpers';
import SendBallotEmailsModal from '../components/election-detail/SendBallotEmailsModal';
import RemindNonVotersModal from '../components/election-detail/RemindNonVotersModal';
import NominationsPanel from '../components/election-detail/NominationsPanel';
import RecordPaperBallotsModal from '../components/election-detail/RecordPaperBallotsModal';
import PaperBallotBatchesPanel from '../components/election-detail/PaperBallotBatchesPanel';
import LiveTurnoutPanel from '../components/election-detail/LiveTurnoutPanel';
import CloneElectionModal from '../components/election-detail/CloneElectionModal';
import MergeWriteInsModal from '../components/election-detail/MergeWriteInsModal';
import DeleteElectionModal from '../components/election-detail/DeleteElectionModal';
import ExtendElectionModal from '../components/election-detail/ExtendElectionModal';
import EditDatesModal from '../components/election-detail/EditDatesModal';
import PreMeetingPackageModal from '../components/election-detail/PreMeetingPackageModal';
import BallotPreviewModal from '../components/election-detail/BallotPreviewModal';
import RollbackElectionModal from '../components/election-detail/RollbackElectionModal';

/** Floor the void-reason prompt already enforced, now stated to the user
 *  instead of silently rejecting anything shorter. */
const MIN_VOID_REASON_LENGTH = 3;

// How a voter marks the ballot. Who wins is victory_condition, shown on its
// own row: a plurality election used to read "Simple Majority" here, because
// the create form stores every one-choice rule as simple_majority.
const VOTING_METHOD_LABELS: Record<string, string> = {
  [VotingMethod.SIMPLE_MAJORITY]: 'One choice per voter',
  [VotingMethod.RANKED_CHOICE]: 'Ranked choice',
  [VotingMethod.APPROVAL]: 'Approval',
  [VotingMethod.SUPERMAJORITY]: 'One choice per voter',
};

export const ElectionDetailPage: React.FC = () => {
  const { electionId } = useParams<{ electionId: string }>();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  // Core election state
  const [election, setElection] = useState<Election | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Modal visibility state
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [showEditDatesModal, setShowEditDatesModal] = useState(false);
  const [editDatesError, setEditDatesError] = useState<string | null>(null);
  const [showPackageModal, setShowPackageModal] = useState(false);
  const [isSendingPackage, setIsSendingPackage] = useState(false);
  const [packageError, setPackageError] = useState<string | null>(null);
  const [extendError, setExtendError] = useState<string | null>(null);
  const [showRollbackModal, setShowRollbackModal] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [isRollingBack, setIsRollingBack] = useState(false);
  // A CLOSED -> OPEN rollback with no recorded votes regenerates the anonymity
  // salt and expires every issued ballot token, so the "Ballots sent" stamp
  // beside Resend is true and useless at once: the links in those emails are
  // dead. Neither the rollback response nor GET /elections/{id} carries
  // `ballots_must_be_resent` (it lives in rollback_history, exposed only via
  // forensics), so the page derives it from the same facts the backend
  // decides on and holds it until ballots go out again or the page reloads.
  const [ballotsMustBeResent, setBallotsMustBeResent] = useState(false);
  const [showSendEmailModal, setShowSendEmailModal] = useState(false);
  const [isSendingEmails, setIsSendingEmails] = useState(false);
  const [sendEmailError, setSendEmailError] = useState<string | null>(null);
  const [lastSkippedDetails, setLastSkippedDetails] = useState<Array<{ name: string; reason: string }>>([]);
  // Both the ballot send and the reminder send feed the skipped banner; the
  // heading names which one, so a reminder-time skip is not read as a ballot skip.
  const [lastSkippedSource, setLastSkippedSource] = useState<'ballots' | 'reminders'>('ballots');
  const [isLoadingNonVoters, setIsLoadingNonVoters] = useState(false);
  const [showRemindModal, setShowRemindModal] = useState(false);
  const [nonVoterCount, setNonVoterCount] = useState(0);
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
  // Addressable, so a secretary can send "the eligibility roster for this
  // election" as a link. Plain state before, which also broke the Back button
  // after a tab change and pinned the screenshot harness to Ballot. Sixth page
  // to get this treatment, after Email Templates, Notifications, Medical
  // Screening, Compliance Config and Item Detail.
  //
  // Derived from the URL rather than mirrored into state: mirroring reads the
  // parameter once, on mount, so every later URL change — which is what Back
  // is — would be ignored. `ElectionWorkflowTabs` already falls back to its
  // first visible tab when the active one is not one this viewer may see, so
  // an unknown or forbidden `?tab=` lands somewhere sensible rather than on a
  // blank panel.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') ?? 'ballot';
  // The fallback in ElectionWorkflowTabs corrects a forbidden `?tab=` with
  // `replace`, so Back leaves the page rather than re-landing on the URL that
  // triggers the correction again. Click-driven changes keep the default push.
  const setActiveTab = (tab: string, options?: { replace?: boolean }) =>
    options?.replace ? setSearchParams({ tab }, { replace: true }) : setSearchParams({ tab });

  // Pending election packages state
  const [pendingPackages, setPendingPackages] = useState<ElectionPackage[]>([]);
  const [isLoadingPackages, setIsLoadingPackages] = useState(false);
  const [showPendingPackages, setShowPendingPackages] = useState(false);
  const [assigningPackageId, setAssigningPackageId] = useState<string | null>(null);

  // Upcoming events state
  const [upcomingEvents, setUpcomingEvents] = useState<EventListItem[]>([]);

  // Org-level feature toggles (default ON until settings load)
  const [featureFlags, setFeatureFlags] = useState({
    nominations_enabled: true,
    paper_ballots_enabled: true,
    reminders_enabled: true,
    auto_open_enabled: true,
    paper_ballot_attestations_required: 2,
  });

  // Paper-ballot entry state
  const [showPaperBallotsModal, setShowPaperBallotsModal] = useState(false);
  const [isRecordingPaper, setIsRecordingPaper] = useState(false);
  const [paperBallotsError, setPaperBallotsError] = useState<string | null>(null);
  const [paperCandidates, setPaperCandidates] = useState<Candidate[]>([]);
  const [paperBatches, setPaperBatches] = useState<ManualBallotBatch[]>([]);
  const [attestingBatchId, setAttestingBatchId] = useState<string | null>(null);
  const [voidBatchId, setVoidBatchId] = useState<string | null>(null);
  const [voidingBatch, setVoidingBatch] = useState(false);

  // Enhancement batch: turnout dashboard, clone, write-in merge
  const [showTurnout, setShowTurnout] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeCandidates, setMergeCandidates] = useState<Candidate[]>([]);

  // Meeting binding state
  const [showMeetingSelector, setShowMeetingSelector] = useState(false);
  const [availableMeetings, setAvailableMeetings] = useState<MeetingRecord[]>([]);
  const [isImportingAttendees, setIsImportingAttendees] = useState(false);

  const { checkPermission, user: currentUser } = useAuthStore();
  const canManage = checkPermission('elections.manage');
  const tz = useTimezone();

  useEffect(() => {
    // Settings require elections.manage; members keep the all-on defaults
    // (their only feature surface, the nominations tab, is driven by the
    // election's actual status).
    if (!canManage) return;
    void (async () => {
      try {
        const s = await electionService.getSettings();
        setFeatureFlags({
          nominations_enabled: s.nominations_enabled ?? true,
          paper_ballots_enabled: s.paper_ballots_enabled ?? true,
          reminders_enabled: s.reminders_enabled ?? true,
          auto_open_enabled: s.auto_open_enabled ?? true,
          paper_ballot_attestations_required: s.paper_ballot_attestations_required ?? 2,
        });
      } catch {
        // Non-fatal: buttons stay visible; the backend gates enforcement.
      }
    })();
  }, [canManage]);

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
      // The skeleton replaces the whole page, which unmounts every tab panel
      // and the state it holds — including the vote receipt ElectionBallot has
      // just shown (W50-53). Show it only until this election has loaded
      // once; a refetch after a vote, a close or a publish updates in place.
      if (!election || election.id !== electionId) {
        setLoading(true);
      }
      setError(null);
      const data = await electionService.getElection(electionId);
      setElection(data);

      // Auto-select results only when the URL names no section: an explicit
      // `?tab=` deep link is honoured, and refreshes (every vote, close,
      // publish) no longer yank the viewer off the tab they are on. Replace so
      // the initial landing does not add a history entry.
      if (!searchParams.get('tab') && (data.status === ElectionStatus.CLOSED || data.results_visible_immediately)) {
        setActiveTab('results', { replace: true });
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

    const [source, id] = value ? [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)] : ['', ''];

    try {
      // PATCH is applied with exclude_unset: an omitted key leaves the old
      // link in place, so every "clear" position must be an explicit null.
      const updateData: Pick<ElectionUpdate, 'meeting_id' | 'event_id' | 'meeting_date'> = {};
      if (source === 'meeting') {
        const meeting = availableMeetings.find((m) => m.id === id);
        updateData.meeting_id = id;
        updateData.event_id = null;
        updateData.meeting_date = meeting?.meeting_date ?? null;
      } else if (source === 'event') {
        const event = upcomingEvents.find((e) => e.id === id);
        updateData.meeting_id = null;
        updateData.event_id = id;
        updateData.meeting_date = event?.start_datetime ?? null;
      } else {
        updateData.meeting_id = null;
        updateData.event_id = null;
        updateData.meeting_date = null;
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
    } catch (err: unknown) {
      // The refusal's own reason is the useful part — "This applicant is
      // rejected and cannot be added to a ballot" tells the officer what
      // happened; a fixed string leaves them retrying a button that will
      // never work.
      toast.error(getErrorMessage(err, 'Failed to add application to ballot'));
    } finally {
      setAssigningPackageId(null);
    }
  };

  // ── Election lifecycle handlers ──────────────────────────────────

  const handleOpenElection = async () => {
    if (!electionId || !election) return;

    // Opening freezes the voter roll and, when the scheduled start is still
    // ahead, moves it to now (W50-56) — say so before the click, and say
    // that ballots are a separate send, which the manual once got wrong.
    const startIsAhead = new Date(election.start_date).getTime() > Date.now();
    // The emailed ballot carries ballot items and plain positions; an
    // election with neither (candidates with no race) cannot mail a ballot,
    // and the ballot locks on opening — say so while it can still be changed
    // (W50-11, owner decision 2026-10-05).
    const emailBallotsImpossible = !electionCanEmailBallots(election);
    const emailWarning = emailBallotsImpossible
      ? ' This election has no ballot items or positions, so ballot emails cannot be sent once it opens and members can vote in the app only. To email ballots, add the races in the Ballot Builder before opening.'
      : '';
    const openMessage =
      (startIsAhead
        ? `Open voting now? The scheduled start (${formatDateTime(election.start_date, tz)}) moves to now, the voter roll is frozen and the ballot locks. Ballot emails are not sent by this step — use Send Ballot Emails afterwards.`
        : 'Open voting now? The voter roll is frozen and the ballot locks. Ballot emails are not sent by this step — use Send Ballot Emails afterwards.') +
      emailWarning;
    if (
      !(await confirm({
        title: 'Open election',
        message: openMessage,
        confirmLabel: 'Open election',
        cancelLabel: 'Keep as draft',
        variant: 'warning',
      }))
    ) {
      return;
    }

    try {
      const updated = await electionService.openElection(electionId);
      setElection(updated);
      // The server clamps a future start to the open time and records it in
      // the audit log only; the toast is the officer's one visible notice.
      toast.success(
        updated.start_date !== election.start_date
          ? `Election opened — start moved from ${formatDateTime(election.start_date, tz)} to now`
          : 'Election opened'
      );
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to open election'));
    }
  };

  const handleCloseElection = async () => {
    if (!electionId) return;

    // Closing destroys the per-election anonymity salt, so an anonymous
    // election with votes can never be reopened (the server refuses the
    // rollback). A non-anonymous one can, at the cost of every ballot link
    // already sent; say which case this is instead of a blanket "cannot be undone".
    const closeMessage = election?.anonymous_voting
      ? 'Close this election? Voting ends immediately. Because ballots are anonymous, closing is final: once any vote has been recorded the election cannot be reopened, and a recount needs a new election.'
      : 'Close this election? Voting ends immediately. Reopening it later takes a Roll Back, which invalidates every ballot link already sent.';
    if (
      !(await confirm({
        title: 'Close election',
        message: closeMessage,
        confirmLabel: 'Close election',
        cancelLabel: 'Keep it open',
      }))
    ) {
      return;
    }

    try {
      const updated = await electionService.closeElection(electionId);
      setElection(updated);
      setActiveTab('results');
      toast.success('Election closed');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to close election'));
    }
  };

  const handleOpenNominations = async () => {
    if (!electionId) return;
    // The backend announces the phase to every active member by email the
    // moment it opens (W50-57); nothing on the button says so.
    if (
      !(await confirm({
        title: 'Open nominations',
        message:
          'Open nominations now? Every active member is emailed that nominations are open, and the election leaves draft until nominations close.',
        confirmLabel: 'Open nominations and email members',
        cancelLabel: 'Keep as draft',
        variant: 'warning',
      }))
    ) {
      return;
    }
    try {
      const updated = await electionService.openNominations(electionId);
      setElection(updated);
      setActiveTab('nominations');
      toast.success('Nominations opened');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to open nominations'));
    }
  };

  const handleCloseNominations = async () => {
    if (!electionId) return;
    try {
      const updated = await electionService.closeNominations(electionId);
      setElection(updated);
      toast.success('Nominations closed — finalize the ballot, then open voting');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to close nominations'));
    }
  };

  const handleShowPaperBallots = async () => {
    if (!electionId) return;
    try {
      const candidatesData = await electionService.getCandidates(electionId);
      setPaperCandidates(candidatesData.filter((c: Candidate) => c.accepted));
      setPaperBallotsError(null);
      setShowPaperBallotsModal(true);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load candidates'));
    }
  };

  const handleRecordPaperBallots = async (
    entries: Array<{ candidate_id: string; count: number }>,
    notes: string,
    allowOverCount: boolean,
    ballotsCast: number | undefined
  ) => {
    if (!electionId || entries.length === 0) return;
    try {
      setIsRecordingPaper(true);
      setPaperBallotsError(null);
      const result = await electionService.recordManualBallots(electionId, {
        entries,
        notes: notes.trim() || undefined,
        allow_over_count: allowOverCount || undefined,
        ballots_cast: ballotsCast,
      });
      setShowPaperBallotsModal(false);
      toast.success(result.message);
      await fetchElection();
      await loadPaperBatches();
    } catch (err: unknown) {
      setPaperBallotsError(getErrorMessage(err, 'Failed to record paper ballots'));
    } finally {
      setIsRecordingPaper(false);
    }
  };

  const loadPaperBatches = useCallback(async () => {
    if (!electionId || !canManage) return;
    try {
      const result = await electionService.getManualBallotBatches(electionId);
      setPaperBatches(result.batches);
    } catch {
      // Non-fatal: the panel simply stays hidden.
    }
  }, [electionId, canManage]);

  useEffect(() => {
    void loadPaperBatches();
  }, [loadPaperBatches]);

  const handleAttestPaperBatch = async (batchId: string) => {
    if (!electionId) return;
    try {
      setAttestingBatchId(batchId);
      const result = await electionService.attestManualBallots(electionId, batchId);
      toast.success(result.message);
      await loadPaperBatches();
      await fetchElection();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to attest paper ballots'));
    } finally {
      setAttestingBatchId(null);
    }
  };

  /** Void a paper-ballot batch, with the reason the audit log will carry.
   *
   * Was a window.prompt, which a browser may suppress — and a suppressed
   * prompt returns null, the same value Cancel returns, so voiding a batch
   * could silently do nothing. A reason under the minimum length was dropped
   * the same silent way, with no indication that anything had been rejected.
   */
  const handleVoidPaperBatch = async (reason: string) => {
    if (!electionId || !voidBatchId) return;
    const batchId = voidBatchId;
    setVoidingBatch(true);
    try {
      const result = await electionService.voidManualBallots(electionId, batchId, reason);
      toast.success(result.message);
      setVoidBatchId(null);
      await loadPaperBatches();
      await fetchElection();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to void paper ballots'));
    } finally {
      setVoidingBatch(false);
    }
  };

  const handleClone = async (payload: {
    title: string;
    start_date: string;
    end_date: string;
    include_candidates: boolean;
  }) => {
    if (!electionId) return;
    try {
      setIsCloning(true);
      setCloneError(null);
      const clone = await electionService.cloneElection(electionId, {
        title: payload.title,
        start_date: localToUTC(payload.start_date, tz),
        end_date: localToUTC(payload.end_date, tz),
        include_candidates: payload.include_candidates,
      });
      setShowCloneModal(false);
      toast.success('Draft election created');
      // Name the tab explicitly: the source was cloned from an open or closed
      // election, and a bare draft URL lets the auto-select in fetchElection
      // land on Results — a tally of nothing on an election with no ballot
      // yet (W50-69). Ballot setup is what the officer does next.
      void navigate(`/elections/${clone.id}?tab=ballot`);
    } catch (err: unknown) {
      setCloneError(getErrorMessage(err, 'Failed to clone election'));
    } finally {
      setIsCloning(false);
    }
  };

  const handleShowMergeWriteIns = async () => {
    if (!electionId) return;
    try {
      const candidatesData = await electionService.getCandidates(electionId);
      setMergeCandidates(candidatesData);
      setMergeError(null);
      setShowMergeModal(true);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load candidates'));
    }
  };

  const handleMergeWriteIns = async (sourceIds: string[], targetId: string) => {
    if (!electionId) return;
    try {
      setIsMerging(true);
      setMergeError(null);
      const result = await electionService.mergeWriteIns(electionId, {
        source_candidate_ids: sourceIds,
        target_candidate_id: targetId,
      });
      setShowMergeModal(false);
      toast.success(result.message);
      await fetchElection();
    } catch (err: unknown) {
      setMergeError(getErrorMessage(err, 'Failed to merge write-ins'));
    } finally {
      setIsMerging(false);
    }
  };

  const downloadPdfBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPrintableBallot = async () => {
    if (!electionId || !election) return;
    try {
      const blob = await electionService.downloadPrintableBallot(electionId);
      downloadPdfBlob(blob, `ballot_${election.title.replace(/[^A-Za-z0-9_-]+/g, '_')}.pdf`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to generate the printable ballot'));
    }
  };

  const handleDownloadCertifiedResults = async () => {
    if (!electionId || !election) return;
    try {
      const blob = await electionService.downloadCertifiedResults(electionId);
      downloadPdfBlob(blob, `certified_results_${election.title.replace(/[^A-Za-z0-9_-]+/g, '_')}.pdf`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to generate certified results'));
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
      toast.success(`Voting now closes ${formatDateTime(updated.end_date, tz)}`);
    } catch (err: unknown) {
      setExtendError(getErrorMessage(err, 'Failed to extend election'));
    }
  };

  /** Updates a draft election's voting window (start + end). */
  const handleEditDates = async (newStartDate: string, newEndDate: string) => {
    if (!electionId || !newStartDate || !newEndDate) return;

    try {
      setEditDatesError(null);
      const updated = await electionService.updateElection(electionId, {
        start_date: localToUTC(newStartDate, tz),
        end_date: localToUTC(newEndDate, tz),
      });
      setElection(updated);
      setShowEditDatesModal(false);
      toast.success('Voting window updated');
    } catch (err: unknown) {
      setEditDatesError(getErrorMessage(err, 'Failed to update voting window'));
    }
  };

  /** Emails the pre-meeting package PDF to the secretary-edited list. */
  const handleSendPackage = async (recipientEmails: string[], message: string, includeFullRoster: boolean) => {
    if (!electionId || recipientEmails.length === 0) return;

    try {
      setIsSendingPackage(true);
      setPackageError(null);
      const result = await electionService.sendPreMeetingPackage(electionId, {
        recipient_emails: recipientEmails,
        message: message.trim() || undefined,
        include_full_roster: includeFullRoster,
      });
      setShowPackageModal(false);
      toast.success(result.message);
    } catch (err: unknown) {
      setPackageError(describePackageSendError(err, recipientEmails, 'Failed to send pre-meeting package'));
    } finally {
      setIsSendingPackage(false);
    }
  };

  // Mirrors the refusal in ElectionService.rollback_election: closing NULLs
  // the anonymity salt, so an anonymous election with votes cannot be reopened
  // without letting every prior voter vote again undetected. Offering the
  // button anyway meant a modal that promised "Reopen voting" and then a 400.
  const rollbackBlockedReason: string | null =
    election?.status === ElectionStatus.CLOSED && election.anonymous_voting && (election.total_votes ?? 0) > 0
      ? 'This election cannot be reopened: its anonymity salt was destroyed when it closed, so members who already voted could vote again undetected. Create a new election instead.'
      : null;

  const handleRollbackElection = async (reason: string) => {
    if (!electionId) return;

    try {
      setIsRollingBack(true);
      setRollbackError(null);

      // Read before the response replaces the election: the decision is
      // about the state the rollback left, not the one it produced.
      const wasClosedWithoutVotes = election?.status === ElectionStatus.CLOSED && (election.total_votes ?? 0) === 0;

      const response = await electionService.rollbackElection(electionId, reason);

      setElection(response.election);
      setShowRollbackModal(false);
      // Mirrors ElectionService.rollback_election: the salt is regenerated (and
      // the tokens expired) only on the zero-vote CLOSED -> OPEN path; with
      // votes the salt stays as it was and the issued links are left alone.
      if (wasClosedWithoutVotes && response.election.status === ElectionStatus.OPEN && response.election.email_sent) {
        setBallotsMustBeResent(true);
      }

      toast.success(`Election rolled back. ${response.notifications_sent} leadership members notified.`);
    } catch (err: unknown) {
      setRollbackError(getErrorMessage(err, 'Failed to roll back election'));
    } finally {
      setIsRollingBack(false);
    }
  };

  // ── Communication handlers ──────────────────────────────────────

  /** Sends ballot emails to all eligible voters. Tracks skipped members for UI banner. */
  const handleSendBallotEmails = async (payload: {
    subject: string;
    message: string;
    sendEligibilitySummary: boolean;
  }) => {
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
      if (response.success) {
        setBallotsMustBeResent(false);
      }

      // Persist skipped details so they stay visible in a banner
      setLastSkippedSource('ballots');
      if (response.skipped_details && response.skipped_details.length > 0) {
        setLastSkippedDetails(response.skipped_details.map((d) => ({ name: d.name, reason: d.reason })));
      } else {
        setLastSkippedDetails([]);
      }

      if (!response.success && response.recipients_count === 0 && response.failed_count === 0) {
        toast.error(response.message || "No eligible voters to send to. Check the election's eligibility settings.");
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
      // Only the count is kept: remind_non_voters recomputes the recipient
      // list server-side at send time, so a client copy could only go stale.
      setNonVoterCount(data.count);

      if (data.count === 0) {
        toast.success('All eligible voters have already voted.');
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
    // Guarded on the count the modal itself displays. The request below carries
    // only `message` — the server recomputes the recipients — so gating the send
    // on a client-side id list meant a payload that reported a count without an
    // expanded list (redaction, truncation) would leave the officer pressing
    // Send Reminders on a modal saying "N members haven't voted" with no
    // request, no error and no explanation.
    if (!electionId || nonVoterCount === 0) return;

    try {
      setIsSendingReminders(true);
      setRemindError(null);

      // Dedicated endpoint: the server recomputes the non-voter list at
      // send time (no stale client-side list) and stamps reminder_sent_at,
      // which suppresses the automatic pre-close reminder.
      const response = await electionService.remindNonVoters(electionId, {
        message: message || 'This is a reminder to cast your vote. The voting window will be closing soon.',
      });

      setShowRemindModal(false);
      // The server stamps reminder_sent_at on a delivered send; the stamp and
      // the modal's cooldown both read it from the election, so refresh it.
      void fetchElection();

      // Show skipped details from reminders in the persistent banner. A clean
      // send clears it, as the ballot send does, so a banner from an earlier
      // ballot send is not left standing under a reminder that skipped nobody.
      setLastSkippedSource('reminders');
      if (response.skipped_details && response.skipped_details.length > 0) {
        setLastSkippedDetails(response.skipped_details.map((d) => ({ name: d.name, reason: d.reason })));
      } else {
        setLastSkippedDetails([]);
      }

      if (response.recipients_count === 0 && response.failed_count === 0) {
        toast.success(response.message || 'All eligible voters have already voted.');
        return;
      }

      const parts = [`Reminders sent to ${response.recipients_count} non-voter(s)`];
      if (response.failed_count > 0) {
        parts.push(`${response.failed_count} failed`);
      }
      if (response.skipped_count > 0) {
        parts.push(`${response.skipped_count} skipped (see banner)`);
      }

      // The backend decides success (`failed == 0`); report it rather than
      // re-deriving it from the counts.
      if (!response.success) {
        toast.error(parts.join(', '));
      } else {
        toast.success(parts.join(', '));
      }
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

      const response = await electionService.deleteElection(electionId, isDraft ? undefined : reason.trim());

      setShowDeleteModal(false);
      toast.success(response.message);
      void navigate('/elections');
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
      toast.success('Vote voided');
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

  // Explicit items rather than a generated trail: the URL is /elections/:id, and
  // the generator skips the id, which would leave a single "Elections" crumb —
  // and a one-crumb generated trail renders nothing at all. Defined once so it
  // reaches the loading and not-found branches too; before this they offered no
  // route away from the page whatsoever, not even the "Back to Elections" link
  // the loaded branch carries.
  const trail = [{ label: 'Elections', path: '/elections' }, { label: election?.title || 'Election' }];

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <Breadcrumbs items={trail} />
          <div className="flex h-64 items-center justify-center" role="status" aria-live="polite">
            <div className="text-theme-text-muted">Loading election...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !election) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <Breadcrumbs items={trail} />
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4" role="alert" aria-live="assertive">
            <p className="text-sm text-red-700 dark:text-red-300">{error || 'Election not found'}</p>
          </div>
        </div>
      </div>
    );
  }

  const resultsAvailable = election.status === ElectionStatus.CLOSED || election.results_visible_immediately;
  const isDraft = election.status === ElectionStatus.DRAFT;
  const isActiveOrCompleted = election.status === ElectionStatus.OPEN || election.status === ElectionStatus.CLOSED;

  const canEmailBallots = electionCanEmailBallots(election);

  // ── Lifecycle stepper config ────────────────────────────────────
  const lifecycleSteps = [
    { key: 'draft', label: 'Draft', description: 'Configure ballot & candidates' },
    ...(election.status === ElectionStatus.NOMINATIONS
      ? [{ key: 'nominations', label: 'Nominations', description: 'Members nominate candidates' }]
      : []),
    { key: 'open', label: 'Voting Open', description: 'Members can cast votes' },
    { key: 'closed', label: 'Closed', description: 'Results finalized' },
  ];

  /** Determines whether a lifecycle step is completed, current, or upcoming based on election status. */
  const getStepStatus = (stepKey: string): 'completed' | 'current' | 'upcoming' => {
    const order =
      election.status === ElectionStatus.NOMINATIONS
        ? ['draft', 'nominations', 'open', 'closed']
        : ['draft', 'open', 'closed'];
    const currentIdx = election.status === ElectionStatus.CANCELLED ? -1 : order.indexOf(election.status);
    const stepIdx = order.indexOf(stepKey);
    if (stepIdx < currentIdx) return 'completed';
    if (stepIdx === currentIdx) return 'current';
    return 'upcoming';
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumbs items={trail} />

        {/* Header */}
        <div className="mb-6">
          <div className="mb-2 flex items-center">
            <Link to="/elections" className="mr-2 text-blue-600 hover:text-blue-700">
              &larr; Back to Elections
            </Link>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 className="text-theme-text-primary min-w-0 text-2xl font-bold break-words">{election.title}</h2>
                {election.is_runoff && (
                  <span className="rounded-sm bg-purple-100 px-2 py-1 text-xs font-semibold text-purple-800 dark:bg-purple-500/20 dark:text-purple-400">
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
              {election.description && <p className="text-theme-text-secondary mt-2">{election.description}</p>}
            </div>
            <span
              className={`inline-flex shrink-0 rounded-full px-3 py-1 text-sm leading-5 font-semibold ${getStatusBadgeClass(
                election.status
              )}`}
            >
              {election.status}
            </span>
          </div>
        </div>

        {/* Election Lifecycle Stepper */}
        {election.status !== ElectionStatus.CANCELLED && (
          <div className="bg-theme-surface mb-6 rounded-lg p-4 shadow-sm backdrop-blur-xs">
            <div className="flex items-center justify-between" role="list" aria-label="Election progress">
              {lifecycleSteps.map((step, idx) => {
                const status = getStepStatus(step.key);
                return (
                  <React.Fragment key={step.key}>
                    {idx > 0 && (
                      <div
                        aria-hidden="true"
                        className={`mx-2 h-0.5 flex-1 ${
                          status === 'upcoming' ? 'bg-theme-surface-border' : 'bg-blue-500'
                        }`}
                      />
                    )}
                    <div
                      role="listitem"
                      className="flex shrink-0 items-center gap-2"
                      aria-current={status === 'current' ? 'step' : undefined}
                    >
                      <div
                        aria-hidden="true"
                        className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                          status === 'completed'
                            ? 'bg-blue-600 text-white'
                            : status === 'current'
                              ? 'bg-blue-600 text-white ring-4 ring-blue-600/20'
                              : 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border border'
                        }`}
                      >
                        {status === 'completed' ? (
                          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        ) : (
                          idx + 1
                        )}
                      </div>
                      {/* Hidden visually on a phone, where the circles alone fit, but
                          kept for a screen reader: without it the stepper read as
                          bare numbers with nothing saying which step is current. */}
                      <div className="sr-only sm:not-sr-only">
                        <div
                          className={`text-sm font-medium ${
                            status === 'upcoming' ? 'text-theme-text-muted' : 'text-theme-text-primary'
                          }`}
                        >
                          {step.label}
                        </div>
                        <div className="text-theme-text-muted text-xs">{step.description}</div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
            {/* Time remaining for open elections */}
            {election.status === ElectionStatus.OPEN && (
              <div className="border-theme-surface-border mt-3 flex items-center justify-center gap-2 border-t pt-3 text-sm">
                <svg
                  className="text-theme-text-muted h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {getTimeRemaining(election.end_date) ? (
                  <span className="font-medium text-green-700 dark:text-green-400">
                    {getTimeRemaining(election.end_date)}
                  </span>
                ) : (
                  <span className="font-medium text-red-700 dark:text-red-400">Voting period has ended</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Integrity Alert Banner */}
        {integrityResult && integrityResult.integrity_status !== 'PASS' && (
          <div className="mb-6 flex items-start gap-3 rounded-lg border-2 border-red-500/50 bg-red-500/10 p-4">
            <svg
              className="mt-0.5 h-6 w-6 shrink-0 text-red-500"
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <h3 className="text-sm font-bold text-red-700 dark:text-red-300">Vote Integrity Issue Detected</h3>
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">
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

        {/* Dead ballot links after a rollback — persists until ballots are resent */}
        {canManage && ballotsMustBeResent && election.status === ElectionStatus.OPEN && (
          <div className="alert-warning mb-6" role="alert" data-testid="rollback-resend-banner">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex-1">
                <h3 className="text-sm font-bold text-amber-700 dark:text-amber-300">
                  Every ballot link already sent was invalidated by the rollback
                </h3>
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  Reopening regenerated the anonymity salt, so the links in the ballot emails sent{' '}
                  {election.email_sent_at ? formatDateTime(election.email_sent_at, tz) : 'earlier'} no longer work.
                  Resend ballots so members can vote.
                </p>
              </div>
              <button type="button" onClick={() => setShowSendEmailModal(true)} className="btn-primary text-sm">
                Resend Ballot Emails
              </button>
            </div>
          </div>
        )}

        {/* Skipped Voters Banner — persists until dismissed */}
        {canManage && lastSkippedDetails.length > 0 && (
          <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="text-sm font-bold text-amber-700 dark:text-amber-300">
                  {lastSkippedDetails.length} member(s) skipped when sending{' '}
                  {lastSkippedSource === 'reminders' ? 'reminders' : 'ballots'}
                </h3>
                <p className="mt-1 mb-2 text-xs text-amber-600 dark:text-amber-400">
                  These members were not sent a {lastSkippedSource === 'reminders' ? 'reminder' : 'ballot'}, for the
                  reason shown. To let one of them vote, add a voter override on the Overrides tab.
                </p>
                <ul className="space-y-1 text-sm text-amber-700 dark:text-amber-300">
                  {lastSkippedDetails.map((d, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="shrink-0 font-medium">{d.name}:</span>
                      <span className="text-amber-600 dark:text-amber-400">{d.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <button
                type="button"
                onClick={() => setLastSkippedDetails([])}
                className="ml-4 shrink-0 text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200"
                aria-label="Dismiss skipped voters banner"
              >
                &times;
              </button>
            </div>
          </div>
        )}

        {/* Election Info */}
        <div className="bg-theme-surface mb-6 rounded-lg p-6 shadow-sm backdrop-blur-xs">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <div className="text-theme-text-muted text-sm">Start Date</div>
              <div className="text-theme-text-primary mt-1 text-sm font-medium">
                {formatDateTime(election.start_date, tz)}
              </div>
            </div>
            <div>
              <div className="text-theme-text-muted text-sm">
                {election.status === ElectionStatus.CLOSED ? 'Scheduled End' : 'End Date'}
              </div>
              <div className="text-theme-text-primary mt-1 text-sm font-medium">
                {formatDateTime(election.end_date, tz)}
              </div>
              {election.status === ElectionStatus.CLOSED && (
                <div className="text-theme-text-secondary mt-1 text-sm">
                  <ElectionCloseStamp election={election} showActor />
                </div>
              )}
            </div>
            {election.positions && election.positions.length > 0 && (
              // md:col-span-2, not col-span-2: on the single-column phone grid an
              // unconditional span forces an implicit second track, which is
              // what collapsed "Start Date" to 0px and drew "Voting Method"
              // over "Anonymous Voting" at 390px (W50-62).
              <div className="md:col-span-2">
                <div className="text-theme-text-muted text-sm">Positions</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {election.positions.map((position) => (
                    <span
                      key={position}
                      className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-800 dark:bg-blue-500/20 dark:text-blue-400"
                    >
                      {position}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="text-theme-text-muted text-sm">Voting Method</div>
              <div className="text-theme-text-primary mt-1 text-sm font-medium">
                {VOTING_METHOD_LABELS[election.voting_method] ?? election.voting_method}
              </div>
            </div>
            <div>
              <div className="text-theme-text-muted text-sm">Winner</div>
              <div className="text-theme-text-primary mt-1 text-sm font-medium">{getVictoryDescription(election)}</div>
            </div>
            <div>
              <div className="text-theme-text-muted text-sm">Anonymous Voting</div>
              <div className="text-theme-text-primary mt-1 text-sm font-medium">
                {election.anonymous_voting ? 'Yes' : 'No'}
              </div>
            </div>
            <div>
              <div className="text-theme-text-muted text-sm">Linked Meeting</div>
              <div className="text-theme-text-primary mt-1 text-sm font-medium">
                {election.meeting_id ? (
                  <div className="flex items-center gap-2">
                    {/* Text, not a link: there is no meeting detail screen to
                        link to. /minutes/:minutesId is not one — it takes a
                        *minutes* id, and MinutesPage lists meetings without
                        linking to any. This was a <Link> to /meetings/:id,
                        which matches no route and fell through App.tsx's
                        catch-all to the dashboard, so naming the linked
                        meeting cost the reader their place. */}
                    <span className="text-theme-text-primary">{election.meeting_title || 'Linked'}</span>
                    {canManage && election.status === ElectionStatus.DRAFT && (
                      <button
                        onClick={() => {
                          void fetchAvailableMeetings();
                          setShowMeetingSelector(true);
                        }}
                        className="text-theme-text-muted hover:text-theme-text-secondary text-xs"
                        title="Change linked meeting"
                      >
                        (change)
                      </button>
                    )}
                  </div>
                ) : election.event_id ? (
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/events/${election.event_id}`}
                      className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      View Event &rarr;
                    </Link>
                    {canManage && election.status === ElectionStatus.DRAFT && (
                      <button
                        onClick={() => {
                          void fetchAvailableMeetings();
                          setShowMeetingSelector(true);
                        }}
                        className="text-theme-text-muted hover:text-theme-text-secondary text-xs"
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
                        onClick={() => {
                          void fetchAvailableMeetings();
                          setShowMeetingSelector(true);
                        }}
                        className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        Link a meeting
                      </button>
                    )}
                  </div>
                )}
              </div>
              {election.meeting_id && election.meeting_date && (
                <div className="text-theme-text-muted mt-0.5 text-xs">
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
            <div className="bg-theme-surface-secondary border-theme-surface-border mt-4 rounded-lg border p-4">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-theme-text-primary text-sm font-medium">Link Meeting or Event</h4>
                <button
                  onClick={() => setShowMeetingSelector(false)}
                  className="text-theme-text-muted hover:text-theme-text-secondary text-sm"
                >
                  Cancel
                </button>
              </div>
              <select
                value={
                  election.meeting_id
                    ? `meeting:${election.meeting_id}`
                    : election.event_id
                      ? `event:${election.event_id}`
                      : ''
                }
                onChange={(e) => void handleMeetingChange(e.target.value)}
                className="form-input shadow-xs"
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
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {isImportingAttendees
                  ? 'Importing...'
                  : `Import Attendees from ${election.meeting_id ? 'Meeting' : 'Event'}`}
              </button>
              <p className="text-theme-text-muted mt-1 text-xs">
                {election.meeting_id
                  ? 'Copy the attendance list from the linked meeting into this election.'
                  : 'Copy checked-in attendees (or RSVPs) from the linked event into this election.'}
              </p>
            </div>
          )}

          {/* Secretary Controls */}
          {canManage && (
            <div className="border-theme-surface-border mt-6 space-y-4 border-t pt-6">
              {/* Lifecycle Actions */}
              <div>
                <h4 className="text-theme-text-muted mb-2 text-xs font-semibold tracking-wider uppercase">Lifecycle</h4>
                <div className="flex flex-wrap gap-2">
                  {election.ballot_items && election.ballot_items.length > 0 && (
                    <button
                      onClick={() => {
                        void handleOpenPreview();
                      }}
                      disabled={loadingPreview}
                      className="rounded-md bg-cyan-700 px-4 py-2 text-sm text-white hover:bg-cyan-800 disabled:opacity-50"
                    >
                      {loadingPreview ? 'Loading Preview...' : 'Preview Ballot'}
                    </button>
                  )}

                  {election.status === ElectionStatus.DRAFT && (
                    <>
                      <button
                        onClick={() => {
                          setShowEditDatesModal(true);
                        }}
                        className="rounded-md bg-purple-600 px-4 py-2 text-sm text-white hover:bg-purple-700"
                      >
                        Edit Dates
                      </button>
                      {featureFlags.nominations_enabled && (election.positions?.length ?? 0) > 0 && (
                        <button
                          onClick={() => {
                            void handleOpenNominations();
                          }}
                          className="rounded-md bg-amber-700 px-4 py-2 text-sm text-white hover:bg-amber-800"
                        >
                          Open Nominations
                        </button>
                      )}
                      <button
                        onClick={() => {
                          void handleOpenElection();
                        }}
                        className="btn-success rounded-md text-sm"
                      >
                        Open Election
                      </button>
                    </>
                  )}

                  {election.status === ElectionStatus.NOMINATIONS && (
                    <button
                      onClick={() => {
                        void handleCloseNominations();
                      }}
                      className="rounded-md bg-amber-700 px-4 py-2 text-sm text-white hover:bg-amber-800"
                    >
                      Close Nominations
                    </button>
                  )}

                  {election.status === ElectionStatus.OPEN && (
                    <>
                      <button
                        onClick={() => setShowTurnout((s) => !s)}
                        className="rounded-md bg-sky-700 px-4 py-2 text-sm text-white hover:bg-sky-800"
                      >
                        {showTurnout ? 'Hide Live Turnout' : 'Live Turnout'}
                      </button>
                      {featureFlags.paper_ballots_enabled && (
                        <button
                          onClick={() => {
                            void handleShowPaperBallots();
                          }}
                          className="rounded-md bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800"
                        >
                          Record Paper Ballots
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setShowExtendModal(true);
                        }}
                        className="rounded-md bg-purple-600 px-4 py-2 text-sm text-white hover:bg-purple-700"
                      >
                        Extend Time
                      </button>
                      <button
                        onClick={() => {
                          void handleCloseElection();
                        }}
                        className="btn-primary rounded-md text-sm"
                      >
                        Close Election
                      </button>
                    </>
                  )}

                  {(election.status === ElectionStatus.OPEN || election.status === ElectionStatus.CLOSED) && (
                    <>
                      <button
                        onClick={() => setShowRollbackModal(true)}
                        disabled={rollbackBlockedReason !== null}
                        aria-describedby={rollbackBlockedReason !== null ? 'rollback-blocked-reason' : undefined}
                        className="rounded-md bg-orange-700 px-4 py-2 text-sm text-white hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Roll Back
                      </button>
                      {rollbackBlockedReason !== null && (
                        <p id="rollback-blocked-reason" className="text-theme-text-muted basis-full text-xs">
                          {rollbackBlockedReason}
                        </p>
                      )}
                    </>
                  )}

                  {election.status !== ElectionStatus.CLOSED &&
                    election.status !== ElectionStatus.CANCELLED &&
                    (election.positions?.length ?? 0) > 0 && (
                      <button
                        onClick={() => {
                          void handleDownloadPrintableBallot();
                        }}
                        className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-md border px-4 py-2 text-sm"
                      >
                        Print Blank Ballots
                      </button>
                    )}

                  {election.status === ElectionStatus.CLOSED && (
                    <button
                      onClick={() => {
                        void handleDownloadCertifiedResults();
                      }}
                      className="rounded-md bg-emerald-700 px-4 py-2 text-sm text-white hover:bg-emerald-800"
                    >
                      Certified Results (PDF)
                    </button>
                  )}

                  {election.allow_write_ins &&
                    (election.status === ElectionStatus.OPEN || election.status === ElectionStatus.CLOSED) && (
                      <button
                        onClick={() => {
                          void handleShowMergeWriteIns();
                        }}
                        className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-md border px-4 py-2 text-sm"
                      >
                        Merge Write-Ins
                      </button>
                    )}

                  <button
                    onClick={() => {
                      setCloneError(null);
                      setShowCloneModal(true);
                    }}
                    className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-md border px-4 py-2 text-sm"
                  >
                    Clone Election
                  </button>
                </div>
              </div>

              {/* Communication Actions — pre-meeting package is available while
                drafting; ballot emails only once voting is open */}
              {(election.status === ElectionStatus.DRAFT || election.status === ElectionStatus.OPEN) && (
                <div>
                  <h4 className="text-theme-text-muted mb-2 text-xs font-semibold tracking-wider uppercase">
                    Communication
                  </h4>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setShowPackageModal(true)}
                      className="rounded-md bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800"
                    >
                      Pre-Meeting Package
                    </button>
                    {election.status === ElectionStatus.OPEN && (
                      <button
                        onClick={() => setShowSendEmailModal(true)}
                        disabled={!canEmailBallots}
                        aria-describedby={canEmailBallots ? undefined : 'send-ballot-unavailable'}
                        className="btn-primary text-sm"
                      >
                        {election.email_sent ? 'Resend Ballot Emails' : 'Send Ballot Emails'}
                      </button>
                    )}
                    {/* The emailed ballot carries ballot items and plain positions.
                        The reason used to be a hover title on a disabled button,
                        which a phone, a keyboard and a screen reader never show. */}
                    {election.status === ElectionStatus.OPEN && !canEmailBallots && (
                      <p id="send-ballot-unavailable" className="text-theme-text-muted w-full text-xs">
                        Ballot emails need ballot items or positions, and the ballot cannot change while voting is open.
                        Members can vote in the app.
                      </p>
                    )}
                    {/* email_sent_at is the ballot-send stamp only: a reminder
                      stamps reminder_sent_at and leaves it alone (W50-27), so the
                      two are shown as two stamps rather than one that moves. */}
                    {election.status === ElectionStatus.OPEN && election.email_sent && (
                      <span className="text-theme-text-muted inline-flex items-center gap-1 text-xs">
                        <svg
                          className="h-4 w-4 text-green-600"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                          aria-hidden="true"
                        >
                          <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                          <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                        </svg>
                        Ballots sent {election.email_sent_at ? formatDateTime(election.email_sent_at, tz) : 'N/A'}
                      </span>
                    )}
                    {featureFlags.reminders_enabled &&
                      election.status === ElectionStatus.OPEN &&
                      election.email_sent && (
                        <>
                          <button
                            onClick={() => {
                              void handleOpenRemindModal();
                            }}
                            disabled={isLoadingNonVoters}
                            className="rounded-md bg-amber-700 px-4 py-2 text-sm text-white hover:bg-amber-800 disabled:opacity-50"
                          >
                            {isLoadingNonVoters ? 'Loading...' : 'Remind Non-Voters'}
                          </button>
                          {election.reminder_sent_at && (
                            <span className="text-theme-text-muted inline-flex items-center gap-1 text-xs">
                              Reminder sent {formatDateTime(election.reminder_sent_at, tz)}
                            </span>
                          )}
                        </>
                      )}
                  </div>
                </div>
              )}

              {/* Danger Zone */}
              {election.status !== ElectionStatus.CANCELLED && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold tracking-wider text-red-500 uppercase dark:text-red-400">
                    Danger Zone
                  </h4>
                  <button
                    onClick={() => setShowDeleteModal(true)}
                    className={`rounded-md px-4 py-2 text-sm ${
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
        {canManage && electionId && <PublishResultsPanel electionId={electionId} election={election} />}

        {/* Live turnout dashboard (secretary, meeting night) */}
        {canManage && showTurnout && election.status === ElectionStatus.OPEN && electionId && (
          <LiveTurnoutPanel electionId={electionId} election={election} />
        )}

        {/* Paper-ballot batches + attestation trail (secretary) */}
        {canManage && featureFlags.paper_ballots_enabled && paperBatches.length > 0 && (
          <PaperBallotBatchesPanel
            batches={paperBatches}
            currentUserId={currentUser?.id ?? null}
            electionOpen={election.status === ElectionStatus.OPEN}
            attestingBatchId={attestingBatchId}
            onAttest={(batchId) => {
              void handleAttestPaperBatch(batchId);
            }}
            onVoid={(batchId) => setVoidBatchId(batchId)}
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

            <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
              {/* Tab: Ballot Builder */}
              {activeTab === 'ballot' && canManage && election.status !== ElectionStatus.CANCELLED && (
                <div className="mb-6 space-y-6">
                  <BallotBuilder electionId={electionId} election={election} onUpdate={setElection} />

                  {/* Pending Member Applications (draft only) */}
                  {election.status === ElectionStatus.DRAFT && (
                    <div className="card overflow-hidden">
                      <button
                        className="flex w-full items-center justify-between px-6 py-4 text-left"
                        onClick={() => {
                          const next = !showPendingPackages;
                          setShowPendingPackages(next);
                          if (next && pendingPackages.length === 0) void fetchPendingPackages();
                        }}
                      >
                        <h2 className="text-theme-text-primary text-lg font-semibold">Pending Member Applications</h2>
                        <span className="text-theme-text-muted text-sm">{showPendingPackages ? '▾' : '▸'}</span>
                      </button>

                      {showPendingPackages && (
                        <div className="px-6 pb-4">
                          {isLoadingPackages ? (
                            <p className="text-theme-text-muted py-2 text-sm">Loading pending applications...</p>
                          ) : pendingPackages.length === 0 ? (
                            <p className="text-theme-text-muted py-2 text-sm">
                              No applications are ready to add to the ballot.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              <p className="text-theme-text-muted mb-2 text-xs">
                                {pendingPackages.length} application{pendingPackages.length !== 1 ? 's' : ''} ready to
                                be added to this election.
                              </p>
                              {pendingPackages.map((pkg) => (
                                <div
                                  key={pkg.id}
                                  className="bg-theme-surface-secondary border-theme-surface-border flex items-center justify-between rounded-lg border p-3"
                                >
                                  <div>
                                    <p className="text-theme-text-primary text-sm font-medium">{pkg.applicant_name}</p>
                                    <p className="text-theme-text-muted text-xs capitalize">
                                      {pkg.target_membership_type} membership
                                      {pkg.coordinator_notes && ` — ${pkg.coordinator_notes}`}
                                    </p>
                                  </div>
                                  <button
                                    onClick={() => {
                                      void handleAssignPackage(pkg);
                                    }}
                                    disabled={assigningPackageId === pkg.id}
                                    className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
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

              {/* Tab: Nominations */}
              {activeTab === 'nominations' && election.status !== ElectionStatus.CANCELLED && (
                <div className="mb-6">
                  <NominationsPanel
                    electionId={electionId}
                    election={election}
                    currentUserId={currentUser?.id ?? null}
                    nominationsOpen={election.status === ElectionStatus.NOMINATIONS}
                  />
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
                  <MeetingAttendance electionId={electionId} election={election} onUpdate={setElection} />
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
                    onVoteCast={() => {
                      void fetchElection();
                    }}
                  />
                </div>
              )}

              {/* Tab: Results */}
              {activeTab === 'results' && resultsAvailable && (
                <div className="mb-6">
                  <ElectionResults electionId={electionId} election={election} />
                </div>
              )}
            </div>
          </>
        )}

        {/* Message if results not available (non-tabbed fallback for non-admin users) */}
        {!canManage && !resultsAvailable && (
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
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
              className="bg-theme-surface hover:bg-theme-surface-hover flex w-full items-center justify-between rounded-lg p-4 shadow-sm backdrop-blur-xs"
            >
              <span className="text-theme-text-primary text-lg font-medium">Forensics &amp; Integrity</span>
              <svg
                className={`text-theme-text-muted h-6 w-6 transform transition-transform ${
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
              <div className="bg-theme-surface mt-2 space-y-6 rounded-lg p-6 shadow-sm backdrop-blur-xs">
                {/* Integrity Check */}
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-md text-theme-text-primary font-semibold">Vote Integrity Check</h3>
                    <button
                      onClick={() => {
                        void handleRunIntegrityCheck();
                      }}
                      disabled={loadingIntegrity}
                      className="btn-info rounded-md px-3 py-1.5 text-sm"
                    >
                      {loadingIntegrity ? 'Checking...' : integrityResult ? 'Re-run Check' : 'Run Check'}
                    </button>
                  </div>

                  {integrityResult && (
                    <div
                      className={`rounded-lg border p-4 ${
                        integrityResult.integrity_status === 'PASS'
                          ? 'border-green-500/30 bg-green-500/10'
                          : 'border-red-500/30 bg-red-500/10'
                      }`}
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <span
                          className={`text-lg font-bold ${
                            integrityResult.integrity_status === 'PASS'
                              ? 'text-green-700 dark:text-green-300'
                              : 'text-red-700 dark:text-red-300'
                          }`}
                        >
                          {integrityResult.integrity_status}
                        </span>
                        <span className="text-theme-text-secondary text-sm">
                          ({integrityResult.valid_signatures}/{integrityResult.total_votes} valid signatures)
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                        <div>
                          <span className="text-theme-text-muted">Votes checked:</span>{' '}
                          <span className="text-theme-text-primary font-medium">{integrityResult.total_votes}</span>{' '}
                          {/* Every chained row is checked, but only counted
                              votes are in the tally (W50-65) */}
                          <span className="text-theme-text-muted">
                            ({integrityResult.counted_votes} counted, {integrityResult.pending_paper_votes} pending
                            paper, {integrityResult.test_votes} test)
                          </span>
                        </div>
                        <div>
                          <span className="text-theme-text-muted">Valid:</span>{' '}
                          <span className="font-medium text-green-700 dark:text-green-300">
                            {integrityResult.valid_signatures}
                          </span>
                        </div>
                        <div>
                          <span className="text-theme-text-muted">Unsigned:</span>{' '}
                          <span className="font-medium text-yellow-700 dark:text-yellow-300">
                            {integrityResult.unsigned_votes}
                          </span>
                        </div>
                        <div>
                          <span className="text-theme-text-muted">Tampered:</span>{' '}
                          <span
                            className={`font-medium ${integrityResult.tampered_votes > 0 ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300'}`}
                          >
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
                        <div className="mt-3 rounded-sm bg-red-500/20 p-3">
                          <p className="mb-1 text-sm font-semibold text-red-700 dark:text-red-300">
                            Tampered Vote IDs:
                          </p>
                          <div className="space-y-1">
                            {integrityResult.tampered_vote_ids.map((id) => (
                              <div key={id} className="flex items-center gap-2">
                                <code className="rounded-sm bg-red-500/10 px-2 py-0.5 text-xs text-red-700 dark:text-red-300">
                                  {id}
                                </code>
                                <button
                                  onClick={() => setVoidVoteId(id)}
                                  className="text-xs text-red-600 underline hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
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
                <div className="border-theme-surface-border border-t pt-4">
                  <h3 className="text-md text-theme-text-primary mb-3 font-semibold">Void a Vote</h3>
                  <p className="text-theme-text-muted mb-3 text-sm">
                    Removes a vote from the results. The vote record is kept, and the void is logged in the audit trail.
                  </p>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <input
                      type="text"
                      value={voidVoteId}
                      onChange={(e) => setVoidVoteId(e.target.value)}
                      placeholder="Vote ID (UUID)"
                      aria-label="Vote ID (UUID)"
                      className="form-input flex-1 shadow-xs"
                    />
                    <input
                      type="text"
                      value={voidVoteReason}
                      onChange={(e) => setVoidVoteReason(e.target.value)}
                      placeholder="Reason for voiding"
                      aria-label="Reason for voiding"
                      className="form-input flex-1 shadow-xs"
                    />
                    <button
                      onClick={() => {
                        void handleVoidVote();
                      }}
                      disabled={isVoidingVote || !voidVoteId.trim() || !voidVoteReason.trim()}
                      className="btn-primary rounded-md text-sm whitespace-nowrap"
                    >
                      {isVoidingVote ? 'Voiding...' : 'Void Vote'}
                    </button>
                  </div>
                </div>

                {/* Forensics Report Detail */}
                {loadingForensics && (
                  <div className="text-theme-text-muted py-4 text-center" role="status" aria-live="polite">
                    Loading forensics report...
                  </div>
                )}

                {forensicsReport && (
                  <>
                    {/* Deleted Votes */}
                    <div className="border-theme-surface-border border-t pt-4">
                      <h3 className="text-md text-theme-text-primary mb-2 font-semibold">
                        Voided Votes ({forensicsReport.deleted_votes.count})
                        {forensicsReport.deleted_votes.paper_batch_count > 0 &&
                          ` — ${forensicsReport.deleted_votes.paper_batch_count} paper batch${forensicsReport.deleted_votes.paper_batch_count === 1 ? '' : 'es'} voided`}
                      </h3>
                      {forensicsReport.deleted_votes.count === 0 ? (
                        <p className="text-theme-text-muted text-sm">No votes have been voided.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-sm" aria-label="Voided votes">
                            <thead className="bg-theme-surface-secondary">
                              <tr>
                                <th
                                  scope="col"
                                  className="text-theme-text-muted px-3 py-2 text-left text-xs font-medium"
                                >
                                  Vote ID
                                </th>
                                <th
                                  scope="col"
                                  className="text-theme-text-muted px-3 py-2 text-left text-xs font-medium"
                                >
                                  Position
                                </th>
                                <th
                                  scope="col"
                                  className="text-theme-text-muted px-3 py-2 text-left text-xs font-medium"
                                >
                                  Reason
                                </th>
                                <th
                                  scope="col"
                                  className="text-theme-text-muted px-3 py-2 text-left text-xs font-medium"
                                >
                                  Voided At
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-theme-surface-border divide-y">
                              {groupVoidedVotes(forensicsReport.deleted_votes.records).map((v) => (
                                <tr key={v.key}>
                                  <td className="px-3 py-2 font-mono text-xs">
                                    {v.batch_size !== null
                                      ? `paper batch voided (${v.batch_size} ballot${v.batch_size === 1 ? '' : 's'})`
                                      : `${v.vote_id.slice(0, 8)}...`}
                                  </td>
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
                    {forensicsReport.anomaly_detection &&
                      Object.keys(forensicsReport.anomaly_detection.suspicious_ips || {}).length > 0 && (
                        <div className="border-theme-surface-border border-t pt-4">
                          <h3 className="text-md mb-2 font-semibold text-red-700 dark:text-red-300">
                            Suspicious IP Addresses
                          </h3>
                          <div className="rounded-sm border border-red-500/30 bg-red-500/10 p-3">
                            {Object.entries(forensicsReport.anomaly_detection.suspicious_ips).map(([ip, count]) => (
                              <div key={ip} className="flex justify-between py-1 text-sm">
                                <code className="text-red-700 dark:text-red-300">{ip}</code>
                                <span className="font-semibold text-red-700 dark:text-red-300">{count} votes</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                    {/* Voting Timeline */}
                    {forensicsReport.voting_timeline && Object.keys(forensicsReport.voting_timeline).length > 0 && (
                      <div className="border-theme-surface-border border-t pt-4">
                        <h3 className="text-md text-theme-text-primary mb-2 font-semibold">
                          Voting Timeline
                          {/* Buckets are keyed in the zone the backend chose,
                              so the key is printed as sent and the zone named
                              instead of re-converting it (W50-65) */}
                          {forensicsReport.voting_timeline_timezone && (
                            <span className="text-theme-text-muted ml-2 text-sm font-normal">
                              (times in {forensicsReport.voting_timeline_timezone})
                            </span>
                          )}
                        </h3>
                        <div className="space-y-1">
                          {Object.entries(forensicsReport.voting_timeline)
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([hour, count]) => (
                              <div key={hour} className="flex items-center gap-3 text-sm">
                                <span className="text-theme-text-muted w-40 font-mono">{hour}</span>
                                <div className="bg-theme-surface h-4 flex-1 rounded-full">
                                  <div
                                    className="h-4 rounded-full bg-blue-600"
                                    style={{
                                      width: `${Math.min(
                                        100,
                                        (Number(count) /
                                          Math.max(...Object.values(forensicsReport.voting_timeline).map(Number))) *
                                          100
                                      )}%`,
                                    }}
                                  />
                                </div>
                                <span className="text-theme-text-secondary w-8 text-right font-medium">{count}</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Token Summary */}
                    <div className="border-theme-surface-border border-t pt-4">
                      <h3 className="text-md text-theme-text-primary mb-2 font-semibold">Ballot Tokens</h3>
                      {/* issued = live + superseded + used (+ expired); a
                          resent ballot's old token is superseded, not
                          "unused" (W50-65) */}
                      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
                        <div className="bg-theme-surface-secondary rounded-sm p-3">
                          <div className="text-theme-text-muted">Issued</div>
                          <div className="text-theme-text-primary text-xl font-semibold">
                            {forensicsReport.voting_tokens.total_issued}
                          </div>
                        </div>
                        <div className="bg-theme-surface-secondary rounded-sm p-3">
                          <div className="text-theme-text-muted">Live</div>
                          <div className="text-theme-text-primary text-xl font-semibold">
                            {forensicsReport.voting_tokens.total_live}
                          </div>
                        </div>
                        <div className="bg-theme-surface-secondary rounded-sm p-3">
                          <div className="text-theme-text-muted">Superseded</div>
                          <div className="text-theme-text-primary text-xl font-semibold">
                            {forensicsReport.voting_tokens.total_superseded}
                          </div>
                        </div>
                        <div className="bg-theme-surface-secondary rounded-sm p-3">
                          <div className="text-theme-text-muted">Used</div>
                          <div className="text-theme-text-primary text-xl font-semibold">
                            {forensicsReport.voting_tokens.total_used}
                          </div>
                        </div>
                        <div className="bg-theme-surface-secondary rounded-sm p-3">
                          <div className="text-theme-text-muted">Expired</div>
                          <div className="text-theme-text-primary text-xl font-semibold">
                            {forensicsReport.voting_tokens.total_expired}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Audit Log Summary */}
                    {forensicsReport.audit_log && (
                      <div className="border-theme-surface-border border-t pt-4">
                        <h3 className="text-md text-theme-text-primary mb-2 font-semibold">
                          Audit Log ({forensicsReport.audit_log.total_entries} entries)
                        </h3>
                        {(forensicsReport.audit_log.entries || []).length === 0 ? (
                          <p className="text-theme-text-muted text-sm">No audit entries.</p>
                        ) : (
                          <div className="max-h-64 overflow-x-auto overflow-y-auto">
                            <table className="min-w-full text-sm" aria-label="Audit log entries">
                              <thead className="bg-theme-surface-secondary sticky top-0">
                                <tr>
                                  <th
                                    scope="col"
                                    className="text-theme-text-muted px-3 py-2 text-left text-xs font-medium"
                                  >
                                    Time
                                  </th>
                                  <th
                                    scope="col"
                                    className="text-theme-text-muted px-3 py-2 text-left text-xs font-medium"
                                  >
                                    Event
                                  </th>
                                  <th
                                    scope="col"
                                    className="text-theme-text-muted px-3 py-2 text-left text-xs font-medium"
                                  >
                                    Severity
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-theme-surface-border divide-y">
                                {(forensicsReport.audit_log.entries || []).slice(0, 50).map((entry, i) => (
                                  <tr key={entry.id || i}>
                                    <td className="text-theme-text-muted px-3 py-2 text-xs whitespace-nowrap">
                                      {entry.timestamp ? formatDateTime(entry.timestamp, tz) : '—'}
                                    </td>
                                    <td className="px-3 py-2 text-xs">{entry.event_type}</td>
                                    <td className="px-3 py-2">
                                      <span
                                        className={`rounded px-2 py-0.5 text-xs ${
                                          entry.severity === 'critical'
                                            ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                                            : entry.severity === 'warning'
                                              ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
                                              : 'bg-theme-surface-secondary text-theme-text-muted'
                                        }`}
                                      >
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

                    <div className="border-theme-surface-border border-t pt-3">
                      <button
                        onClick={() => {
                          void handleLoadForensics();
                        }}
                        disabled={loadingForensics}
                        className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50 dark:text-blue-400 dark:hover:text-blue-300"
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
            onSubmit={(payload) => {
              void handleSendBallotEmails(payload);
            }}
            onClose={() => {
              setShowSendEmailModal(false);
              setSendEmailError(null);
            }}
            timezone={tz}
          />
        )}

        <PromptDialog
          isOpen={voidBatchId !== null}
          onClose={() => setVoidBatchId(null)}
          onSubmit={(reason) => void handleVoidPaperBatch(reason)}
          title="Void paper-ballot batch"
          message="The batch stops counting toward the result. The record and this reason stay in the election's audit log."
          label="Reason for voiding"
          placeholder="e.g. Batch entered against the wrong election"
          minLength={MIN_VOID_REASON_LENGTH}
          multiline
          hint={`At least ${String(MIN_VOID_REASON_LENGTH)} characters. Recorded in the audit log.`}
          confirmLabel="Void batch"
          cancelLabel="Keep it"
          confirmVariant="warning"
          loading={voidingBatch}
        />

        {showCloneModal && election && (
          <CloneElectionModal
            sourceTitle={election.title}
            cloning={isCloning}
            error={cloneError}
            onSubmit={(payload) => {
              void handleClone(payload);
            }}
            onClose={() => {
              setShowCloneModal(false);
              setCloneError(null);
            }}
          />
        )}

        {showMergeModal && election && (
          <MergeWriteInsModal
            candidates={mergeCandidates}
            ballotItems={election.ballot_items}
            merging={isMerging}
            error={mergeError}
            onSubmit={(sourceIds, targetId) => {
              void handleMergeWriteIns(sourceIds, targetId);
            }}
            onClose={() => {
              setShowMergeModal(false);
              setMergeError(null);
            }}
          />
        )}

        {showPaperBallotsModal && election && (
          <RecordPaperBallotsModal
            candidates={paperCandidates}
            ballotItems={election.ballot_items}
            recording={isRecordingPaper}
            error={paperBallotsError}
            attestationsRequired={featureFlags.paper_ballot_attestations_required}
            onSubmit={(entries, notes, allowOverCount, ballotsCast) => {
              void handleRecordPaperBallots(entries, notes, allowOverCount, ballotsCast);
            }}
            onClose={() => {
              setShowPaperBallotsModal(false);
              setPaperBallotsError(null);
            }}
          />
        )}

        {showRemindModal && election && (
          <RemindNonVotersModal
            nonVoterCount={nonVoterCount}
            reminderSentAt={election.reminder_sent_at ?? null}
            sending={isSendingReminders}
            error={remindError}
            onSubmit={(message) => {
              void handleSendReminders(message);
            }}
            onClose={() => {
              setShowRemindModal(false);
              setRemindError(null);
            }}
          />
        )}

        {showDeleteModal && election && (
          <DeleteElectionModal
            election={election}
            isDraft={isDraft}
            deleting={isDeleting}
            error={deleteError}
            onSubmit={(reason) => {
              void handleDeleteElection(reason);
            }}
            onClose={() => {
              setShowDeleteModal(false);
              setDeleteError(null);
            }}
          />
        )}

        {showExtendModal && election && (
          <ExtendElectionModal
            currentEndDate={election.end_date}
            error={extendError}
            onSubmit={(newEndDate) => {
              void handleExtendElection(newEndDate);
            }}
            onClose={() => {
              setShowExtendModal(false);
              setExtendError(null);
            }}
            timezone={tz}
          />
        )}

        {showEditDatesModal && election && (
          <EditDatesModal
            currentStartDate={election.start_date}
            currentEndDate={election.end_date}
            error={editDatesError}
            onSubmit={(newStartDate, newEndDate) => {
              void handleEditDates(newStartDate, newEndDate);
            }}
            onClose={() => {
              setShowEditDatesModal(false);
              setEditDatesError(null);
            }}
            timezone={tz}
          />
        )}

        {showPackageModal && election && electionId && (
          <PreMeetingPackageModal
            electionId={electionId}
            electionTitle={election.title}
            sending={isSendingPackage}
            error={packageError}
            onSubmit={(recipientEmails, message, includeFullRoster) => {
              void handleSendPackage(recipientEmails, message, includeFullRoster);
            }}
            onClose={() => {
              setShowPackageModal(false);
              setPackageError(null);
            }}
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
            onSubmit={(reason) => {
              void handleRollbackElection(reason);
            }}
            onClose={() => {
              setShowRollbackModal(false);
              setRollbackError(null);
            }}
          />
        )}
      </div>
    </div>
  );
};

export default ElectionDetailPage;
