/**
 * Minutes Detail Page
 *
 * View and edit meeting minutes with dynamic sections, motions, action items,
 * section reordering, and publish-to-documents workflow.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { DialogPanel } from '../../../components/ux/DialogPanel';
import { PromptDialog } from '../../../components/ux/PromptDialog';
import { RichText } from '../../../components/ux/RichText';
import { RichTextEditor } from '../../../components/ux/RichTextEditor';
import { useParams, Link, useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import { useSubmitGuard } from '@/hooks/useSubmitGuard';
import {
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  BookOpen,
  CheckCircle,
  ClipboardList,
  FileDown,
  Gavel,
  ListChecks,
} from 'lucide-react';
import { eventService } from '../../../services/api';
import { electionService } from '../../../services/electionService';
import { minutesService } from '../services/api';
import type { ElectionListItem } from '../../../types/election';
import { getStatusBadgeClass } from '../../../utils/electionHelpers';
import { useAuthStore } from '../../../stores/authStore';
import { PublishingStatusNote } from '../components/PublishingStatusNote';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatCalendarDate, formatDate, formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage, toAppError } from '../../../utils/errorHandling';
import { plainTextToHtml, sectionIsBlank } from '../../../utils/richText';
import type {
  MeetingMinutes,
  MotionCreate,
  MotionStatus,
  ActionItemAssignee,
  ActionItemCreate,
  ActionItemPriority,
  SectionEntry,
  AdoptionDetails,
  ImportableElection,
  MinutesPublishingStatus,
  AdoptionProposal,
} from '../types/minutes';
import type { Event as EventDetail, EventListItem } from '../../../types/event';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { saveBlob } from '../../../utils/saveBlob';
import { PanelDisclosure } from '../components/PanelDisclosure';
import { AdoptDialog } from '../components/AdoptDialog';
import { AgendaSyncDialog } from '../components/AgendaSyncDialog';
import { AttachmentsPanel } from '../components/AttachmentsPanel';
import { AttendancePanel } from '../components/AttendancePanel';
import { CarryForwardDialog } from '../components/CarryForwardDialog';
import { ClosedSessionsPanel } from '../components/ClosedSessionsPanel';
import { ElectionResultsPanel } from '../components/ElectionResultsPanel';
import { OutlinePickerDialog } from '../components/OutlinePickerDialog';
import { MotionVoteFields } from '../components/MotionVoteFields';
import { MotionVoteSummary } from '../components/MotionVoteSummary';
import { MeetingTimeCapture } from '../components/MeetingTimeCapture';
import { PersonPicker } from '../components/PersonPicker';
import { SectionMotion } from '../components/SectionMotion';
import { RevisionsPanel } from '../components/RevisionsPanel';
import { SignaturesPanel } from '../components/SignaturesPanel';
import { SuggestChangeForm } from '../components/SuggestChangeForm';
import { SuggestionsPanel } from '../components/SuggestionsPanel';
import { useMinutesSuggestions } from '../hooks/useMinutesSuggestions';
import { motionMakers } from '../utils/motionMakers';
import { emptyVoteDraft, voteDraftPayload } from '../utils/voteDraft';
import type { VoteDraft } from '../utils/voteDraft';
import { GovernancePageHeader } from '../../../components/governance/GovernancePageHeader';
import { actionItemStatusLabel } from '../utils/actionItemStatus';

const STATUS_BADGES: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  submitted: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
  approved: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Circulated for review',
  approved: 'Adopted',
  rejected: 'Rejected',
};

const MOTION_STATUS_BADGES: Record<string, string> = {
  passed: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  failed: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  tabled: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  withdrawn: 'bg-theme-surface-secondary text-theme-text-primary',
};

const PRIORITY_BADGES: Record<string, string> = {
  low: 'bg-theme-surface-secondary text-theme-text-secondary',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400',
  urgent: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
};

const ACTION_STATUS_BADGES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
  completed: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  cancelled: 'bg-theme-surface-secondary text-theme-text-primary',
  overdue: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
};

export const MinutesDetailPage: React.FC = () => {
  const { confirm } = useConfirm();
  const { minutesId } = useParams<{ minutesId: string }>();
  const navigate = useNavigate();
  const { checkPermission } = useAuthStore();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const tz = useTimezone();
  // MM-3: minutes writes and restricted reads are gated on minutes.manage on
  // the backend, not meetings.manage — check the same permission the API does.
  const canManage = checkPermission('minutes.manage');

  const [minutes, setMinutes] = useState<MeetingMinutes | null>(null);
  // Separate guards: submitting the minutes, adding a motion and adding an
  // action item are independent controls that can be open at the same time.
  const { busy: submitBusy, run: runSubmit } = useSubmitGuard();
  const { busy: motionBusy, run: runMotion } = useSubmitGuard();
  const { busy: actionItemBusy, run: runActionItem } = useSubmitGuard();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inline editing
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [suggestingSection, setSuggestingSection] = useState<string | null>(null);
  const [sectionValue, setSectionValue] = useState('');
  const [saving, setSaving] = useState(false);

  // Add section form
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState('');

  // Publishing
  const [publishing, setPublishing] = useState(false);
  const [publishingStatus, setPublishingStatus] = useState<MinutesPublishingStatus | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // Adopting, and laying an outline over the draft
  const [showAdopt, setShowAdopt] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [hasAcceptedSuggestions, setHasAcceptedSuggestions] = useState(false);
  const [proposal, setProposal] = useState<AdoptionProposal | null>(null);
  const [showApplyOutline, setShowApplyOutline] = useState(false);
  const [showAgendaSync, setShowAgendaSync] = useState(false);
  const [applyingOutline, setApplyingOutline] = useState(false);

  // Closed elections a motion can be tied to; loaded when the motion form opens
  const [ballots, setBallots] = useState<ImportableElection[] | null>(null);

  // Carrying open action items forward from earlier meetings
  const [showCarryForward, setShowCarryForward] = useState(false);

  // Motion form
  const [showMotionForm, setShowMotionForm] = useState(false);
  const [motionForm, setMotionForm] = useState<MotionCreate>({
    motion_text: '',
    moved_by: '',
    seconded_by: '',
    status: 'passed',
  });
  const [voteDraft, setVoteDraft] = useState<VoteDraft>(emptyVoteDraft());

  // Action item form
  const [showActionForm, setShowActionForm] = useState(false);
  const [actionForm, setActionForm] = useState<ActionItemCreate>({
    description: '',
    assignee_id: '',
    due_date: undefined,
    priority: 'medium',
  });
  // Any active member may be assigned (W52-6). Loaded the first time the form
  // opens; null until then, so a failed load can be told from an empty list.
  const [assignees, setAssignees] = useState<ActionItemAssignee[] | null>(null);
  const [assigneesError, setAssigneesError] = useState<string | null>(null);

  useEffect(() => {
    if (!showActionForm || !canManage || assignees !== null) return;
    minutesService
      .getActionItemAssignees()
      .then((list) => {
        setAssignees(list);
        setAssigneesError(null);
      })
      .catch((err: unknown) => setAssigneesError(getErrorMessage(err, 'Could not load members')));
  }, [showActionForm, canManage, assignees]);

  useEffect(() => {
    if (!showMotionForm || !canManage || ballots !== null || !minutesId) return;
    minutesService
      .getImportableElections(minutesId)
      .then(setBallots)
      .catch(() => setBallots([]));
  }, [showMotionForm, canManage, ballots, minutesId]);

  // Linked event
  const [linkedEvent, setLinkedEvent] = useState<EventDetail | null>(null);
  const [linkedElections, setLinkedElections] = useState<ElectionListItem[]>([]);
  const [showLinkEventModal, setShowLinkEventModal] = useState(false);
  const [availableEvents, setAvailableEvents] = useState<EventListItem[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Approval
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showReopenDialog, setShowReopenDialog] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const fetchMinutes = useCallback(async () => {
    if (!minutesId) return;
    try {
      setLoading(true);
      const data = await minutesService.getMinutes(minutesId);
      setMinutes(data);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load minutes'));
    } finally {
      setLoading(false);
    }
  }, [minutesId]);

  useEffect(() => {
    if (minutesId) void fetchMinutes();
  }, [minutesId, fetchMinutes]);

  // Reload without the full-page spinner, for panels that change the record
  // (a saved roll call moves the quorum; carried items join the list) and must
  // stay mounted, with their own state, while it refreshes.
  const refreshMinutes = useCallback(async () => {
    if (!minutesId) return;
    setMinutes(await minutesService.getMinutes(minutesId));
  }, [minutesId]);

  // Fetch linked event details when minutes load
  useEffect(() => {
    if (minutes?.event_id) {
      eventService
        .getEvent(minutes.event_id)
        .then((ev) => setLinkedEvent(ev))
        .catch(() => setLinkedEvent(null));
    } else {
      setLinkedEvent(null);
    }
  }, [minutes?.event_id]);

  // Fetch elections held at the event these minutes record.
  //
  // Keyed on the event, not on the minutes id. `Election.meeting_id` is a
  // `meetings` row; a minutes record is a `meeting_minutes` row. Passing the
  // minutes id as `meeting_id` compared two different id spaces, so the query
  // matched nothing and this card could never appear — however many elections
  // were held at the meeting. The event is the link both sides actually share.
  const linkedEventId = minutes?.event_id;
  useEffect(() => {
    if (linkedEventId) {
      electionService
        .getElectionsByEvent(linkedEventId)
        .then((elections) => setLinkedElections(elections))
        .catch(() => setLinkedElections([]));
    } else {
      setLinkedElections([]);
    }
  }, [linkedEventId]);

  const isEditable = minutes && (minutes.status === 'draft' || minutes.status === 'rejected');
  const suggestions = useMinutesSuggestions(minutesId ?? '', minutes?.status ?? 'draft');
  // A member suggests from a section; the secretary answers rather than suggests.
  const canSuggest = minutes?.status === 'submitted' && !canManage;
  const openSuggestionCount = (sectionKey: string) =>
    suggestions.suggestions.filter((x) => x.section_key === sectionKey && x.status === 'open').length;

  const handleDownloadPdf = async () => {
    if (!minutesId || !minutes) return;
    setDownloadingPdf(true);
    try {
      saveBlob(await minutesService.downloadPdf(minutesId), `${minutes.title}.pdf`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to download the PDF'));
    } finally {
      setDownloadingPdf(false);
    }
  };

  // ── Section CRUD ──

  // Every section edit sends the whole list, so a save from a copy loaded
  // before someone else's save would write their sections back as they were.
  // Naming the version this copy was loaded at makes the server refuse that
  // instead (MM5-4); the editor keeps what was typed, and the banner offers
  // the reload.
  const [staleCopy, setStaleCopy] = useState(false);
  const saveSections = async (sections: SectionEntry[]) => {
    if (!minutesId || !minutes) throw new Error('Minutes not loaded');
    try {
      return await minutesService.updateMinutes(minutesId, {
        sections,
        expected_version: minutes.edit_version ?? 0,
      });
    } catch (err: unknown) {
      if (toAppError(err).status === 409) setStaleCopy(true);
      throw err;
    }
  };

  const reloadStaleCopy = async () => {
    await refreshMinutes();
    setStaleCopy(false);
  };

  const handleSaveSection = async (sectionKey: string) => {
    if (!minutesId || !minutes) return;
    try {
      setSaving(true);
      const updatedSections = minutes.sections.map((s) =>
        s.key === sectionKey ? { ...s, content: sectionValue, format: 'html' as const } : s
      );
      const updated = await saveSections(updatedSections);
      setMinutes(updated);
      setEditingSection(null);
      toast.success('Section saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save section'));
    } finally {
      setSaving(false);
    }
  };

  // Sent as a full sections list like every other section edit; an omitted
  // flag would read as "taken up", so the unchecked state is sent explicitly.
  const handleSetNotTakenUp = async (sectionKey: string, notTakenUp: boolean) => {
    if (!minutesId || !minutes) return;
    try {
      const sections = minutes.sections.map((s) => (s.key === sectionKey ? { ...s, not_taken_up: notTakenUp } : s));
      setMinutes(await saveSections(sections));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update the section'));
    }
  };

  // A time is a field of its own on the minutes, not part of a section. Sent as
  // an explicit null to clear it, since an omitted key means "leave it alone".
  const handleSaveTime = async (field: 'called_to_order_at' | 'adjourned_at', iso: string | null) => {
    if (!minutesId) return;
    const updated = await minutesService.updateMinutes(minutesId, { [field]: iso });
    setMinutes(updated);
    toast.success(iso ? 'Time recorded' : 'Time cleared');
  };

  const handleReorderSection = async (index: number, direction: 'up' | 'down') => {
    if (!minutesId || !minutes) return;
    const sections = [...minutes.sections];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sections.length) return;

    // Swap
    [sections[index], sections[targetIndex]] = [sections[targetIndex] as SectionEntry, sections[index] as SectionEntry];
    // Renumber
    const renumbered = sections.map((s, i) => ({ ...s, order: i }));

    try {
      setSaving(true);
      const updated = await saveSections(renumbered);
      setMinutes(updated);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to move section'));
    } finally {
      setSaving(false);
    }
  };

  const handleAddSection = async () => {
    if (!minutesId || !minutes || !newSectionTitle.trim()) return;
    const key = newSectionTitle
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
    const newSection: SectionEntry = {
      order: minutes.sections.length,
      key,
      title: newSectionTitle.trim(),
      content: '',
    };

    try {
      setSaving(true);
      const updated = await saveSections([...minutes.sections, newSection]);
      setMinutes(updated);
      setNewSectionTitle('');
      setShowAddSection(false);
      toast.success('Section added');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to add section'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSection = async (sectionKey: string) => {
    if (!minutesId || !minutes) return;
    if (
      !(await confirm({
        title: 'Delete section',
        message: 'Delete this section and its content from the minutes?',
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    const filtered = minutes.sections.filter((s) => s.key !== sectionKey).map((s, i) => ({ ...s, order: i }));

    try {
      setSaving(true);
      const updated = await saveSections(filtered);
      setMinutes(updated);
      toast.success('Section deleted');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete section'));
    } finally {
      setSaving(false);
    }
  };

  // ── Publishing ──

  // Only people who manage minutes may ask where publishing stands, and only
  // minutes that were ever adopted can have been published.
  const publishedDocumentId = minutes?.published_document_id;
  const minutesStatus = minutes?.status;
  const loadPublishingStatus = useCallback(async () => {
    if (!minutesId || !canManage || (minutesStatus !== 'approved' && !publishedDocumentId)) {
      setPublishingStatus(null);
      return;
    }
    try {
      setPublishingStatus(await minutesService.getPublishingStatus(minutesId));
    } catch {
      // The status is a convenience; publishing itself reports its own errors.
      setPublishingStatus(null);
    }
  }, [minutesId, canManage, minutesStatus, publishedDocumentId]);

  useEffect(() => {
    void loadPublishingStatus();
  }, [loadPublishingStatus]);

  // A later meeting may already have accepted these minutes; its motion fills in
  // the adoption form. Only circulated minutes can be adopted.
  useEffect(() => {
    if (!minutesId || !canManage || minutesStatus !== 'submitted') {
      setProposal(null);
      return;
    }
    const load = async () => {
      try {
        setProposal(await minutesService.getAdoptionProposal(minutesId));
      } catch {
        // A hint only: adopting works without it.
        setProposal(null);
      }
    };
    void load();
  }, [minutesId, canManage, minutesStatus]);

  const handlePublish = async () => {
    if (!minutesId) return;
    try {
      setPublishing(true);
      const result = await minutesService.publishMinutes(minutesId);
      await fetchMinutes();
      await loadPublishingStatus();
      toast.success(
        result.public_posted ? 'Minutes published to Documents and posted publicly' : 'Minutes published to Documents'
      );
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to publish minutes'));
    } finally {
      setPublishing(false);
    }
  };

  const handleWithdrawPublic = async () => {
    if (!minutesId) return;
    const ok = await confirm({
      title: 'Take the public copy down?',
      message:
        'The public page stops showing these minutes right away. The copy in Documents stays. Publishing them again posts a fresh public copy.',
      confirmLabel: 'Take it down',
      cancelLabel: 'Keep it up',
    });
    if (!ok) return;
    try {
      setWithdrawing(true);
      await minutesService.withdrawPublicCopy(minutesId);
      await loadPublishingStatus();
      toast.success('The public copy was taken down');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to take the public copy down'));
    } finally {
      setWithdrawing(false);
    }
  };

  // ── Workflow ──

  const handleSubmit = () =>
    runSubmit(async () => {
      if (!minutesId) return;
      try {
        const updated = await minutesService.submitForApproval(minutesId);
        setMinutes(updated);
        toast.success('Minutes circulated for review');
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to circulate minutes'));
      }
    });

  const handleOpenAdopt = async () => {
    try {
      const all = await minutesService.getSuggestions(minutesId ?? '');
      setHasAcceptedSuggestions(all.some((x) => x.status === 'accepted'));
    } catch {
      setHasAcceptedSuggestions(false);
    }
    setShowAdopt(true);
  };

  const handleAdopt = async (details: AdoptionDetails) => {
    if (!minutesId) return;
    setAdopting(true);
    try {
      const updated = await minutesService.approve(minutesId, details);
      setMinutes(updated);
      setShowAdopt(false);
      toast.success('Minutes adopted');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to adopt minutes'));
    } finally {
      setAdopting(false);
    }
  };

  const handleRecall = async () => {
    if (!minutesId) return;
    const ok = await confirm({
      title: 'Take these minutes back to draft?',
      message:
        'Members will no longer see them until you circulate them again. Suggestions already made are kept. Use this to work in the changes you accepted.',
      confirmLabel: 'Recall to draft',
      cancelLabel: 'Leave them circulating',
    });
    if (!ok) return;
    try {
      setMinutes(await minutesService.recall(minutesId));
      toast.success('Minutes are a draft again');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to recall the minutes'));
    }
  };

  const handleApplyOutline = async (outlineId: string) => {
    if (!minutesId) return;
    setApplyingOutline(true);
    try {
      setMinutes(await minutesService.applyOutline(minutesId, outlineId));
      setShowApplyOutline(false);
      toast.success('Outline applied. Everything already written was kept.');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to apply the outline'));
    } finally {
      setApplyingOutline(false);
    }
  };

  const handleReject = async () => {
    if (!minutesId || rejectReason.trim().length < 10) return;
    try {
      const updated = await minutesService.reject(minutesId, rejectReason.trim());
      setMinutes(updated);
      setShowRejectModal(false);
      setRejectReason('');
      toast.success('Minutes returned for changes');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to reject minutes'));
    }
  };

  const handleReopen = async (reason: string) => {
    if (!minutesId) return;
    try {
      setReopening(true);
      const updated = await minutesService.reopen(minutesId, reason);
      setMinutes(updated);
      setShowReopenDialog(false);
      toast.success('Minutes reopened as a draft');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to reopen minutes'));
    } finally {
      setReopening(false);
    }
  };

  // ── Motions ──

  const handleAddMotion = () =>
    runMotion(async () => {
      if (!minutesId || !motionForm.motion_text.trim()) return;
      try {
        await minutesService.addMotion(minutesId, {
          ...motionForm,
          ...voteDraftPayload(voteDraft, motionMakers(minutes?.attendees ?? [])),
          order: minutes?.motions.length || 0,
        });
        setShowMotionForm(false);
        setMotionForm({
          motion_text: '',
          moved_by: '',
          seconded_by: '',
          status: 'passed',
        });
        setVoteDraft(emptyVoteDraft());
        void fetchMinutes();
        toast.success('Motion added');
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to add motion'));
      }
    });

  const handleUseSuggestedResult = async (motionId: string, status: 'passed' | 'failed') => {
    if (!minutesId) return;
    try {
      await minutesService.updateMotion(minutesId, motionId, { status });
      await fetchMinutes();
      toast.success(`Result changed to ${status}`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to change the result'));
    }
  };

  const handleDeleteMotion = async (motionId: string) => {
    if (!minutesId) return;
    if (
      !(await confirm({
        title: 'Delete motion',
        message: 'Delete this motion from the minutes?',
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    try {
      await minutesService.deleteMotion(minutesId, motionId);
      void fetchMinutes();
      toast.success('Motion deleted');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete motion'));
    }
  };

  // ── Action Items ──

  const handleAddActionItem = () =>
    runActionItem(async () => {
      if (!minutesId || !actionForm.description.trim()) return;
      try {
        // The server stores the member's name beside the id; a typed name is
        // no longer offered, so an item is either a member's or unassigned.
        await minutesService.addActionItem(minutesId, {
          description: actionForm.description,
          assignee_id: actionForm.assignee_id || undefined,
          due_date: actionForm.due_date || undefined,
          priority: actionForm.priority,
        });
        setShowActionForm(false);
        setActionForm({ description: '', assignee_id: '', due_date: undefined, priority: 'medium' });
        void fetchMinutes();
        toast.success('Action item added');
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to add action item'));
      }
    });

  const handleUpdateActionItemStatus = async (itemId: string, newStatus: string) => {
    if (!minutesId) return;
    try {
      await minutesService.updateActionItem(minutesId, itemId, { status: newStatus });
      void fetchMinutes();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update action item status'));
    }
  };

  const handleDeleteActionItem = async (itemId: string) => {
    if (!minutesId) return;
    if (
      !(await confirm({
        title: 'Delete action item',
        message: 'Delete this action item from the minutes?',
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    try {
      await minutesService.deleteActionItem(minutesId, itemId);
      void fetchMinutes();
      toast.success('Action item deleted');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete action item'));
    }
  };

  // ── Event linking ──

  const handleOpenLinkEvent = async () => {
    setShowLinkEventModal(true);
    if (availableEvents.length === 0) {
      setLoadingEvents(true);
      try {
        const events = await eventService.getEvents({ event_type: 'business_meeting' });
        setAvailableEvents(events);
      } catch {
        toast.error('Failed to load events');
      } finally {
        setLoadingEvents(false);
      }
    }
  };

  const handleLinkEvent = async (eventId: string) => {
    if (!minutesId) return;
    try {
      const updated = await minutesService.updateMinutes(minutesId, { event_id: eventId });
      setMinutes(updated);
      setShowLinkEventModal(false);
      toast.success('Linked to event');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to link event'));
    }
  };

  const handleUnlinkEvent = async () => {
    if (!minutesId) return;
    try {
      // Send an explicit null, not undefined: the update body is
      // JSON.stringify'd, which drops an undefined-valued key entirely, so
      // the backend's exclude_unset=True read it as "field not touched" and
      // silently kept the old event_id despite the success toast (Pitfall #1
      // — update clears need an explicit null, never an omitted key).
      const updated = await minutesService.updateMinutes(minutesId, { event_id: null });
      setMinutes(updated);
      setLinkedEvent(null);
      toast.success('Event unlinked');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to unlink event'));
    }
  };

  const handleDelete = async () => {
    if (!minutesId) return;
    if (
      !(await confirm({
        title: 'Delete draft minutes',
        message: 'Delete these draft minutes? This cannot be undone.',
        confirmLabel: 'Delete',
        cancelLabel: 'Keep them',
      }))
    )
      return;
    try {
      await minutesService.deleteMinutes(minutesId);
      toast.success('Minutes deleted');
      void navigate('/minutes');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete minutes'));
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-7xl">
          <div className="text-theme-text-muted py-12 text-center" role="status" aria-live="polite">
            Loading minutes...
          </div>
        </div>
      </div>
    );
  }

  if (error || !minutes) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4" role="alert" aria-live="assertive">
            <p className="text-sm text-red-700 dark:text-red-300">{error || 'Minutes not found'}</p>
          </div>
        </div>
      </div>
    );
  }

  const recordedMotions = minutes.motions.filter((m) => m.status !== 'pending');

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl">
        <GovernancePageHeader
          icon={ClipboardList}
          breadcrumbLabel={minutes.title}
          title={
            <span className="flex flex-wrap items-center gap-3">
              {minutes.title}{' '}
              <span className={`rounded-full px-3 py-1 text-sm font-semibold ${STATUS_BADGES[minutes.status]}`}>
                {STATUS_LABELS[minutes.status] ?? minutes.status}
              </span>
            </span>
          }
          subtitle={
            <>
              <p>
                {formatDateTime(minutes.meeting_date, tz)}
                {minutes.location && ` \u00b7 ${minutes.location}`}
                {minutes.called_by && ` \u00b7 Called by ${minutes.called_by}`}
              </p>
              {/* How the body adopted them */}
              {minutes.status === 'approved' && minutes.adopted_on && (
                <p className="text-theme-text-secondary mt-1 text-sm">
                  Adopted {formatDate(minutes.adopted_on, tz)}
                  {minutes.adopted_as_amended === true && ' as amended'}
                  {minutes.adopted_as_amended === false && ' as presented'}
                  {minutes.adopting_minutes_id && (
                    <>
                      {' at '}
                      <Link
                        to={`/minutes/${minutes.adopting_minutes_id}`}
                        className="text-blue-600 hover:text-blue-700"
                      >
                        {minutes.adopting_minutes_title ?? 'the adopting meeting'}
                      </Link>
                    </>
                  )}
                </p>
              )}
            </>
          }
          actions={
            <button
              type="button"
              disabled={downloadingPdf}
              onClick={() => {
                void handleDownloadPdf();
              }}
              className="btn-secondary touch:min-h-11 inline-flex items-center gap-2 text-sm"
            >
              <FileDown className="h-4 w-4" aria-hidden="true" />
              {downloadingPdf ? 'Preparing…' : 'Download PDF'}
            </button>
          }
        />

        {/* Rejection notice */}
        {minutes.status === 'rejected' && minutes.rejection_reason && (
          <div className="mb-6 border-l-4 border-red-500 bg-red-500/10 p-4">
            <p className="text-sm font-medium text-red-700 dark:text-red-300">Rejection Reason:</p>
            <p className="mt-1 text-sm text-red-700 dark:text-red-300">{minutes.rejection_reason}</p>
          </div>
        )}

        {/* Linked Event */}
        {(linkedEvent || (canManage && isEditable)) && (
          <div className="bg-theme-surface mb-6 rounded-lg p-4 shadow-sm backdrop-blur-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-theme-text-secondary text-sm font-medium">Linked Meeting Event</h3>
              {canManage && isEditable && (
                <div className="flex gap-2">
                  {linkedEvent && (
                    <button
                      onClick={() => {
                        void handleUnlinkEvent();
                      }}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Unlink
                    </button>
                  )}
                  <button
                    onClick={() => {
                      void handleOpenLinkEvent();
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    {linkedEvent ? 'Change' : 'Link to Event'}
                  </button>
                </div>
              )}
            </div>
            {linkedEvent ? (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="rounded-sm bg-blue-100 px-2 py-0.5 text-xs text-blue-800 dark:bg-blue-500/20 dark:text-blue-400">
                  Business Meeting
                </span>
                <Link
                  to={`/events/${linkedEvent.id}`}
                  className="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  {linkedEvent.title}
                </Link>
                <span className="text-theme-text-muted text-xs">{formatDate(linkedEvent.start_datetime, tz)}</span>
                {linkedEvent.location && <span className="text-theme-text-muted text-xs">{linkedEvent.location}</span>}
              </div>
            ) : (
              canManage &&
              isEditable && (
                <p className="text-theme-text-muted mt-1 text-xs italic">
                  No event linked. Link the business meeting event these minutes record.
                </p>
              )
            )}
          </div>
        )}

        {/* Linked Elections */}
        {linkedElections.length > 0 && (
          <div className="bg-theme-surface mb-6 rounded-lg p-4 shadow-sm backdrop-blur-xs">
            <h3 className="text-theme-text-secondary mb-3 text-sm font-medium">Linked Elections</h3>
            <div className="space-y-2">
              {linkedElections.map((election) => (
                <Link
                  key={election.id}
                  to={`/elections/${election.id}`}
                  className="border-theme-surface-border hover:bg-theme-surface-hover flex items-center justify-between rounded-lg border p-3 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-theme-text-primary truncate text-sm font-medium">{election.title}</p>
                    <p className="text-theme-text-muted mt-0.5 text-xs">
                      {election.election_type.replace(/_/g, ' ')}
                      {election.positions && election.positions.length > 0 ? ` · ${election.positions.join(', ')}` : ''}
                    </p>
                  </div>
                  <span
                    className={`ml-3 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusBadgeClass(election.status)}`}
                  >
                    {election.status}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Workflow Actions */}
        {canManage && (
          <div className="bg-theme-surface mb-6 rounded-lg p-4 shadow-sm backdrop-blur-xs">
            {/* Publishing needs approved minutes, so a published copy alongside
                anything else means the minutes were reopened: Documents shows
                that copy as being corrected until it is re-published. */}
            {minutes.published_document_id && minutes.status !== 'approved' && (
              <p className="alert-warning text-theme-text-primary mb-3 text-sm" role="status">
                The copy published to Documents is marked as being corrected. Once these minutes are approved again,
                re-publish them to replace it.
              </p>
            )}
            {minutes.status === 'submitted' && proposal && (
              <p className="alert-info text-theme-text-primary mb-3 text-sm" role="status">
                <Link to={`/minutes/${proposal.adopting_minutes_id}`} className="underline">
                  {proposal.adopting_minutes_title}
                </Link>{' '}
                accepted these minutes {proposal.as_amended ? 'as revised' : 'as submitted'}
                {proposal.moved_by ? `, moved by ${proposal.moved_by}` : ''}
                {proposal.seconded_by ? `, seconded by ${proposal.seconded_by}` : ''}. Adopt Minutes opens already
                filled in from that motion; an officer other than the one who circulated them confirms it.
              </p>
            )}
            <PublishingStatusNote
              status={publishingStatus}
              withdrawing={withdrawing}
              onWithdraw={() => {
                void handleWithdrawPublic();
              }}
            />
            <div className="flex flex-wrap gap-3">
              {(minutes.status === 'draft' || minutes.status === 'rejected') && (
                <button
                  disabled={submitBusy}
                  onClick={() => {
                    void handleSubmit();
                  }}
                  className="btn-info rounded-md disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Circulate for Review
                </button>
              )}
              {minutes.status === 'submitted' && (
                <>
                  {/* The server refuses an approval by the person who
                      submitted (separation of duties), so it is not offered
                      to them (W51-6). */}
                  {minutes.submitted_by && minutes.submitted_by === currentUserId ? (
                    <p className="text-theme-text-secondary self-center text-sm">
                      Waiting for another officer to adopt them. You circulated these minutes, so you cannot record
                      their adoption.
                    </p>
                  ) : (
                    <button
                      onClick={() => {
                        void handleOpenAdopt();
                      }}
                      className="btn-success rounded-md"
                    >
                      Adopt Minutes
                    </button>
                  )}
                  <button
                    onClick={() => {
                      void handleRecall();
                    }}
                    className="btn-secondary rounded-md"
                  >
                    Recall to Draft
                  </button>
                  <button onClick={() => setShowRejectModal(true)} className="btn-primary rounded-md">
                    Return for Changes
                  </button>
                </>
              )}
              {minutes.status === 'approved' && (
                <button
                  onClick={() => {
                    void handlePublish();
                  }}
                  disabled={publishing}
                  className="inline-flex items-center gap-2 rounded-md bg-cyan-700 px-4 py-2 text-white hover:bg-cyan-800 disabled:opacity-50"
                >
                  <BookOpen className="h-4 w-4" aria-hidden="true" />
                  {publishing
                    ? 'Publishing...'
                    : minutes.published_document_id
                      ? 'Re-publish to Documents'
                      : 'Publish to Documents'}
                </button>
              )}
              {minutes.status === 'approved' && (
                <button
                  onClick={() => setShowReopenDialog(true)}
                  className="bg-theme-surface text-theme-text-primary hover:bg-theme-surface-hover border-theme-surface-border rounded-md border px-4 py-2"
                >
                  Reopen for Correction
                </button>
              )}
              {minutes.published_document_id && (
                <Link
                  to="/documents"
                  className="inline-flex items-center gap-2 rounded-md border border-green-500/30 px-4 py-2 text-green-700 hover:bg-green-500/10 dark:text-green-300"
                >
                  <CheckCircle className="h-4 w-4" aria-hidden="true" />
                  View in Documents
                </Link>
              )}
              {minutes.status === 'draft' && (
                <button
                  onClick={() => {
                    void handleDelete();
                  }}
                  className="bg-theme-surface text-theme-text-primary hover:bg-theme-surface-hover rounded-md px-4 py-2"
                >
                  Delete Draft
                </button>
              )}
            </div>
          </div>
        )}

        <SuggestionsPanel
          minutesId={minutes.id}
          status={minutes.status}
          sections={minutes.sections}
          canManage={canManage}
          suggestions={suggestions.suggestions}
          loaded={suggestions.loaded}
          reload={suggestions.reload}
          onMinutesChanged={fetchMinutes}
        />

        {/* Meeting Info */}
        <div className="bg-theme-surface mb-6 rounded-lg p-6 shadow-sm backdrop-blur-xs">
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            {minutes.called_to_order_at && (
              <div>
                <span className="text-theme-text-muted">Called to Order:</span>
                <div className="text-theme-text-primary font-medium">
                  {formatDateTime(minutes.called_to_order_at, tz)}
                </div>
              </div>
            )}
            {minutes.adjourned_at && (
              <div>
                <span className="text-theme-text-muted">Adjourned:</span>
                <div className="text-theme-text-primary font-medium">{formatDateTime(minutes.adjourned_at, tz)}</div>
              </div>
            )}
            {minutes.quorum_met !== null && minutes.quorum_met !== undefined && (
              <div>
                <span className="text-theme-text-muted">Quorum:</span>
                <div
                  className={`font-medium ${minutes.quorum_met ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}
                >
                  {minutes.quorum_met ? 'Met' : 'Not Met'}
                  {minutes.quorum_count !== null && ` (${minutes.quorum_count})`}
                </div>
              </div>
            )}
          </div>

          <AttendancePanel
            minutesId={minutes.id}
            attendees={minutes.attendees ?? []}
            listing={minutes.attendance_listing_effective ?? 'all'}
            listingOverride={minutes.attendance_listing ?? null}
            canEdit={Boolean(canManage && isEditable)}
            onSaved={refreshMinutes}
          />
        </div>

        {/* Dynamic Content Sections */}
        <div className="mb-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-theme-text-primary text-lg font-semibold">Meeting Sections</h2>
            {canManage && isEditable && (
              <div className="flex flex-wrap gap-2">
                {minutes.meeting_id && (
                  <button
                    type="button"
                    onClick={() => setShowAgendaSync(true)}
                    className="btn-secondary touch:min-h-11 text-sm"
                  >
                    Sync from agenda
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowApplyOutline(true)}
                  className="btn-secondary touch:min-h-11 text-sm"
                >
                  Apply an outline
                </button>
                <button
                  onClick={() => setShowAddSection(!showAddSection)}
                  className="inline-flex items-center gap-1 rounded-md bg-cyan-700 px-3 py-1.5 text-sm text-white hover:bg-cyan-800"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Section
                </button>
              </div>
            )}
          </div>

          {/* Add Section Form */}
          {showAddSection && (
            <div className="card-secondary flex flex-wrap items-end gap-3 p-4" role="form" aria-label="Add new section">
              <div className="flex-1">
                <label htmlFor="new-section-title" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                  Section Title
                </label>
                <input
                  id="new-section-title"
                  type="text"
                  value={newSectionTitle}
                  onChange={(e) => setNewSectionTitle(e.target.value)}
                  placeholder="e.g., Fire Prevention Report"
                  className="form-input"
                />
              </div>
              <button
                onClick={() => {
                  void handleAddSection();
                }}
                disabled={!newSectionTitle.trim() || saving}
                className="rounded-md bg-cyan-700 px-4 py-2 text-sm text-white hover:bg-cyan-800 disabled:opacity-50"
              >
                Add
              </button>
              <button
                onClick={() => {
                  setShowAddSection(false);
                  setNewSectionTitle('');
                }}
                className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-md border px-4 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
          )}

          {staleCopy && (
            <div className="alert-warning flex flex-wrap items-center justify-between gap-3 text-sm" role="alert">
              <p>
                Someone else saved these minutes after you opened them, so your last change was not saved. Anything you
                were typing is still in the editor. Reload to see their changes, then save yours again.
              </p>
              <button type="button" onClick={() => void reloadStaleCopy()} className="btn-primary px-3 py-1.5 text-sm">
                Reload
              </button>
            </div>
          )}

          {minutes.sections.length === 0 ? (
            <div className="bg-theme-surface rounded-lg p-8 text-center shadow-sm backdrop-blur-xs">
              <p className="text-theme-text-muted">These minutes have no sections yet.</p>
              {canManage && isEditable && (
                <button
                  onClick={() => setShowAddSection(true)}
                  className="mt-3 text-sm text-cyan-700 hover:text-cyan-800 dark:text-cyan-600"
                >
                  Add your first section
                </button>
              )}
            </div>
          ) : (
            minutes.sections
              .sort((a, b) => a.order - b.order)
              .map((section, idx) => {
                const isEditing = editingSection === section.key;

                return (
                  <div key={section.key} className="card p-6">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {canManage && isEditable && (
                          <div className="flex flex-col" role="group" aria-label={`Reorder ${section.title}`}>
                            <button
                              onClick={() => {
                                void handleReorderSection(idx, 'up');
                              }}
                              disabled={idx === 0 || saving}
                              className="text-theme-text-muted hover:text-theme-text-secondary p-0.5 disabled:opacity-30"
                              aria-label={`Move ${section.title} up`}
                            >
                              <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <button
                              onClick={() => {
                                void handleReorderSection(idx, 'down');
                              }}
                              disabled={idx === minutes.sections.length - 1 || saving}
                              className="text-theme-text-muted hover:text-theme-text-secondary p-0.5 disabled:opacity-30"
                              aria-label={`Move ${section.title} down`}
                            >
                              <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        )}
                        <h3 className="text-md text-theme-text-primary font-semibold">
                          {section.title}
                          {openSuggestionCount(section.key) > 0 && (
                            <span className="ml-2 rounded-sm bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400">
                              {openSuggestionCount(section.key)} open{' '}
                              {openSuggestionCount(section.key) === 1 ? 'suggestion' : 'suggestions'}
                            </span>
                          )}
                          {section.not_taken_up && (
                            <span className="bg-theme-surface-secondary text-theme-text-primary ml-2 rounded-sm px-2 py-0.5 text-xs font-medium">
                              Not taken up
                            </span>
                          )}
                          {section.required && sectionIsBlank(section) && isEditable && (
                            <span className="ml-2 rounded-sm bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/20 dark:text-amber-400">
                              Required
                            </span>
                          )}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2">
                        {canSuggest && (
                          <button
                            type="button"
                            onClick={() => setSuggestingSection(suggestingSection === section.key ? null : section.key)}
                            aria-expanded={suggestingSection === section.key}
                            aria-label={`Suggest a change to ${section.title}`}
                            className="touch:min-h-11 text-sm text-blue-700 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            Suggest a change
                          </button>
                        )}
                        {canManage && isEditable && !isEditing && (
                          <>
                            <button
                              onClick={() => {
                                setEditingSection(section.key);
                                setSectionValue(
                                  section.format === 'html' ? section.content : plainTextToHtml(section.content)
                                );
                              }}
                              className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                              aria-label={`Edit ${section.title}`}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                void handleDeleteSection(section.key);
                              }}
                              className="text-theme-text-muted p-1 hover:text-red-800 dark:hover:text-red-400"
                              aria-label={`Delete ${section.title} section`}
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {(section.presenter || (section.documents ?? []).length > 0) && (
                      <div className="text-theme-text-muted mb-2 space-y-1 text-xs">
                        {section.presenter && <p>Presented by {section.presenter}</p>}
                        {(section.documents ?? []).length > 0 && (
                          <p>
                            Documents:{' '}
                            {(section.documents ?? []).map((doc, n) => (
                              <React.Fragment key={doc.id}>
                                {n > 0 && ', '}
                                <Link to="/documents" className="text-blue-700 underline dark:text-blue-400">
                                  {doc.name || 'Document'}
                                </Link>
                              </React.Fragment>
                            ))}
                          </p>
                        )}
                      </div>
                    )}

                    {isEditing ? (
                      <div>
                        <RichTextEditor
                          key={section.key}
                          id={`section-edit-${section.key}`}
                          value={sectionValue}
                          onChange={setSectionValue}
                          label={`${section.title} content`}
                        />
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => {
                              void handleSaveSection(section.key);
                            }}
                            disabled={saving}
                            className="rounded-md bg-cyan-700 px-3 py-1.5 text-sm text-white hover:bg-cyan-800 disabled:opacity-50"
                          >
                            {saving ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={() => setEditingSection(null)}
                            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-md border px-3 py-1.5 text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : !sectionIsBlank(section) ? (
                      <RichText
                        content={section.content}
                        format={section.format}
                        className="text-theme-text-secondary text-sm"
                      />
                    ) : section.not_taken_up ? (
                      <p className="text-theme-text-muted text-sm italic">Not taken up.</p>
                    ) : (
                      <p className="text-theme-text-muted text-sm italic">
                        No content yet.{' '}
                        {canManage && isEditable && (
                          <button
                            onClick={() => {
                              setEditingSection(section.key);
                              setSectionValue('');
                            }}
                            className="text-blue-700 underline hover:no-underline dark:text-blue-400"
                          >
                            Add content
                          </button>
                        )}
                      </p>
                    )}

                    {canManage && isEditable && sectionIsBlank(section) && (
                      <label className="mt-2 flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(section.not_taken_up)}
                          onChange={(e) => {
                            void handleSetNotTakenUp(section.key, e.target.checked);
                          }}
                          className="form-checkbox"
                        />
                        <span className="text-theme-text-secondary">The meeting did not take this up</span>
                      </label>
                    )}

                    {(section.key === 'call_to_order' || section.key === 'adjournment') && (
                      <MeetingTimeCapture
                        kind={section.key === 'call_to_order' ? 'start' : 'end'}
                        value={section.key === 'call_to_order' ? minutes.called_to_order_at : minutes.adjourned_at}
                        otherTime={section.key === 'call_to_order' ? minutes.adjourned_at : minutes.called_to_order_at}
                        scheduled={section.key === 'call_to_order' ? minutes.meeting_date : undefined}
                        timezone={tz}
                        canEdit={Boolean(canManage && isEditable)}
                        onSave={(iso) =>
                          handleSaveTime(section.key === 'call_to_order' ? 'called_to_order_at' : 'adjourned_at', iso)
                        }
                      />
                    )}

                    <SectionMotion
                      minutesId={minutes.id}
                      section={section}
                      motions={minutes.motions}
                      attendees={minutes.attendees ?? []}
                      canRecord={Boolean(canManage && isEditable)}
                      onRecorded={fetchMinutes}
                    />

                    {canSuggest && suggestingSection === section.key && (
                      <SuggestChangeForm
                        minutesId={minutes.id}
                        sectionKey={section.key}
                        subject={section.title}
                        original={{ content: section.content, format: section.format }}
                        onSent={async () => {
                          setSuggestingSection(null);
                          await suggestions.reload();
                        }}
                        onCancel={() => setSuggestingSection(null)}
                      />
                    )}
                  </div>
                );
              })
          )}
        </div>

        {/* Motions */}
        <PanelDisclosure
          id="motions-heading"
          icon={<Gavel className="h-5 w-5" aria-hidden="true" />}
          title="Motions"
          count={recordedMotions.length}
          defaultOpen={false}
          actions={
            canManage &&
            isEditable && (
              <button
                onClick={() => setShowMotionForm(!showMotionForm)}
                className="rounded-md bg-cyan-700 px-3 py-1.5 text-sm text-white hover:bg-cyan-800"
              >
                {showMotionForm ? 'Cancel' : 'Add Motion'}
              </button>
            )
          }
        >
          {showMotionForm && (
            <div className="card-secondary mb-4 space-y-3 p-4" role="form" aria-label="Add motion">
              <label htmlFor="motion-text" className="sr-only">
                Motion text
              </label>
              <textarea
                id="motion-text"
                rows={3}
                value={motionForm.motion_text}
                onChange={(e) => setMotionForm({ ...motionForm, motion_text: e.target.value })}
                placeholder="Motion text..."
                aria-label="Motion text"
                className="form-input"
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <PersonPicker
                  id="moved-by"
                  label="Moved by"
                  value={motionForm.moved_by || ''}
                  onChange={(name) => setMotionForm({ ...motionForm, moved_by: name })}
                  attendees={minutes.attendees ?? []}
                />
                <PersonPicker
                  id="seconded-by"
                  label="Seconded by"
                  value={motionForm.seconded_by || ''}
                  onChange={(name) => setMotionForm({ ...motionForm, seconded_by: name })}
                  attendees={minutes.attendees ?? []}
                  exclude={motionForm.moved_by || undefined}
                />
                <div>
                  <label htmlFor="motion-status" className="sr-only">
                    Motion status
                  </label>
                  <select
                    id="motion-status"
                    value={motionForm.status}
                    onChange={(e) => setMotionForm({ ...motionForm, status: e.target.value as MotionStatus })}
                    aria-label="Motion status"
                    className="form-input"
                  >
                    <option value="passed">Passed</option>
                    <option value="failed">Failed</option>
                    <option value="tabled">Tabled</option>
                    <option value="withdrawn">Withdrawn</option>
                  </select>
                </div>
              </div>
              <MotionVoteFields
                idPrefix="motion"
                attendees={minutes.attendees ?? []}
                value={voteDraft}
                onChange={setVoteDraft}
              />
              {ballots && ballots.length > 0 && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="motion-ballot" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                      Decided by ballot
                    </label>
                    <select
                      id="motion-ballot"
                      value={motionForm.election_id ?? ''}
                      onChange={(e) =>
                        setMotionForm({
                          ...motionForm,
                          election_id: e.target.value || undefined,
                          ballot_item_id: undefined,
                        })
                      }
                      className="form-input"
                    >
                      <option value="">Not decided by ballot</option>
                      {ballots.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  {(ballots.find((b) => b.id === motionForm.election_id)?.ballot_items ?? []).length > 0 && (
                    <div>
                      <label
                        htmlFor="motion-ballot-item"
                        className="text-theme-text-secondary mb-1 block text-sm font-medium"
                      >
                        Item on that ballot
                      </label>
                      <select
                        id="motion-ballot-item"
                        value={motionForm.ballot_item_id ?? ''}
                        onChange={(e) => setMotionForm({ ...motionForm, ballot_item_id: e.target.value || undefined })}
                        className="form-input"
                      >
                        <option value="">The ballot as a whole</option>
                        {(ballots.find((b) => b.id === motionForm.election_id)?.ballot_items ?? []).map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={() => {
                  void handleAddMotion();
                }}
                disabled={motionBusy || !motionForm.motion_text.trim()}
                className="rounded-md bg-cyan-700 px-4 py-2 text-sm text-white hover:bg-cyan-800 disabled:opacity-50"
              >
                Add Motion
              </button>
            </div>
          )}

          {recordedMotions.length === 0 ? (
            <p className="text-theme-text-muted text-sm">No motions recorded.</p>
          ) : (
            <div className="space-y-3">
              {recordedMotions.map((motion, i) => (
                <div key={motion.id} className="border-theme-surface-border rounded-lg border p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-theme-text-muted font-mono text-xs">#{i + 1}</span>
                        <span
                          className={`rounded-sm px-2 py-0.5 text-xs font-medium ${MOTION_STATUS_BADGES[motion.status]}`}
                        >
                          {motion.status}
                        </span>
                      </div>
                      <p className="text-theme-text-primary text-sm">{motion.motion_text}</p>
                      <div className="text-theme-text-muted mt-2 space-x-4 text-xs">
                        {motion.moved_by && <span>Moved by: {motion.moved_by}</span>}
                        {motion.seconded_by && <span>Seconded by: {motion.seconded_by}</span>}
                        {motion.election_id && (
                          <span>
                            Decided by ballot:{' '}
                            <Link
                              to={`/elections/${motion.election_id}`}
                              className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
                            >
                              {motion.election_title ?? 'the election'}
                            </Link>
                          </span>
                        )}
                      </div>
                      <MotionVoteSummary
                        motion={motion}
                        onUseSuggested={
                          canManage && isEditable
                            ? (status) => {
                                void handleUseSuggestedResult(motion.id, status);
                              }
                            : undefined
                        }
                      />
                    </div>
                    {canManage && isEditable && (
                      <button
                        onClick={() => {
                          void handleDeleteMotion(motion.id);
                        }}
                        className="ml-2 text-xs text-red-500 hover:text-red-700"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </PanelDisclosure>

        <ClosedSessionsPanel
          minutesId={minutes.id}
          canEdit={Boolean(canManage && isEditable)}
          attendees={minutes.attendees ?? []}
          motions={minutes.motions}
          defaultOpen={false}
        />

        <ElectionResultsPanel
          minutesId={minutes.id}
          canFile={canManage}
          canRemoveDrafted={Boolean(canManage && isEditable)}
          defaultOpen={false}
        />

        {/* Action Items */}
        <PanelDisclosure
          id="action-items-heading"
          icon={<ListChecks className="h-5 w-5" aria-hidden="true" />}
          title="Action Items"
          count={minutes.action_items.length}
          defaultOpen={false}
          actions={
            canManage &&
            isEditable && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setShowCarryForward(true)}
                  className="btn-secondary touch:min-h-11 text-sm"
                >
                  Carry forward open items
                </button>
                <button
                  onClick={() => setShowActionForm(!showActionForm)}
                  className="rounded-md bg-cyan-700 px-3 py-1.5 text-sm text-white hover:bg-cyan-800"
                >
                  {showActionForm ? 'Cancel' : 'Add Action Item'}
                </button>
              </div>
            )
          }
        >
          {showActionForm && (
            <div className="card-secondary mb-4 space-y-3 p-4" role="form" aria-label="Add action item">
              <label htmlFor="action-description" className="sr-only">
                Action item description
              </label>
              <textarea
                id="action-description"
                rows={2}
                value={actionForm.description}
                onChange={(e) => setActionForm({ ...actionForm, description: e.target.value })}
                placeholder="Action item description..."
                aria-label="Action item description"
                className="form-input"
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="action-assignee" className="sr-only">
                    Assignee
                  </label>
                  <select
                    id="action-assignee"
                    value={actionForm.assignee_id || ''}
                    onChange={(e) => setActionForm({ ...actionForm, assignee_id: e.target.value })}
                    aria-label="Assignee"
                    disabled={assignees === null && !assigneesError}
                    className="form-input"
                  >
                    <option value="">
                      {assignees === null && !assigneesError ? 'Loading members…' : 'Unassigned'}
                    </option>
                    {(assignees ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  {assigneesError && (
                    <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
                      {assigneesError}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="action-due-date" className="sr-only">
                    Due date
                  </label>
                  <input
                    id="action-due-date"
                    type="date"
                    value={actionForm.due_date || ''}
                    onChange={(e) => setActionForm({ ...actionForm, due_date: e.target.value || undefined })}
                    aria-label="Due date"
                    className="form-input"
                  />
                </div>
                <div>
                  <label htmlFor="action-priority" className="sr-only">
                    Priority
                  </label>
                  <select
                    id="action-priority"
                    value={actionForm.priority}
                    onChange={(e) => setActionForm({ ...actionForm, priority: e.target.value as ActionItemPriority })}
                    aria-label="Priority"
                    className="form-input"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>
              <button
                onClick={() => {
                  void handleAddActionItem();
                }}
                disabled={actionItemBusy || !actionForm.description.trim()}
                className="rounded-md bg-cyan-700 px-4 py-2 text-sm text-white hover:bg-cyan-800 disabled:opacity-50"
              >
                Add Action Item
              </button>
            </div>
          )}

          {minutes.action_items.length === 0 ? (
            <p className="text-theme-text-muted text-sm">No action items.</p>
          ) : (
            <div className="space-y-3">
              {minutes.action_items.map((item) => (
                <div key={item.id} className="border-theme-surface-border rounded-lg border p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span
                          className={`rounded-sm px-2 py-0.5 text-xs font-medium ${ACTION_STATUS_BADGES[item.status]}`}
                        >
                          {actionItemStatusLabel(item.status)}
                        </span>
                        <span className={`rounded-sm px-2 py-0.5 text-xs ${PRIORITY_BADGES[item.priority]}`}>
                          {item.priority}
                        </span>
                      </div>
                      <p className="text-theme-text-primary text-sm">{item.description}</p>
                      <div className="text-theme-text-muted mt-2 space-x-4 text-xs">
                        {item.assignee_name && <span>Assigned to: {item.assignee_name}</span>}
                        {/* A due date is a calendar day, stored at UTC midnight;
                            converting it to the department's zone showed the
                            day before (W51-5). */}
                        {item.due_date && <span>Due: {formatCalendarDate(item.due_date)}</span>}
                      </div>
                    </div>
                    <div className="ml-2 flex items-center gap-2">
                      {canManage && item.status !== 'completed' && item.status !== 'cancelled' && (
                        <select
                          value={item.status}
                          onChange={(e) => {
                            void handleUpdateActionItemStatus(item.id, e.target.value);
                          }}
                          aria-label={`Update status for: ${item.description.substring(0, 30)}`}
                          className="form-input-sm text-xs"
                        >
                          <option value="pending">Pending</option>
                          <option value="in_progress">In Progress</option>
                          <option value="completed">Completed</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      )}
                      {canManage && isEditable && (
                        <button
                          onClick={() => {
                            void handleDeleteActionItem(item.id);
                          }}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </PanelDisclosure>

        <AttachmentsPanel minutesId={minutes.id} status={minutes.status} canManage={canManage} defaultOpen={false} />

        <SignaturesPanel
          minutesId={minutes.id}
          minutesTitle={minutes.title}
          status={minutes.status}
          version={minutes.updated_at}
          defaultOpen={false}
        />

        <RevisionsPanel
          minutesId={minutes.id}
          status={minutes.status}
          version={minutes.updated_at}
          defaultOpen={false}
        />

        <AdoptDialog
          isOpen={showAdopt}
          minutesId={minutes.id}
          hasAcceptedSuggestions={hasAcceptedSuggestions}
          proposal={proposal}
          attendees={minutes.attendees ?? []}
          busy={adopting}
          onClose={() => setShowAdopt(false)}
          onAdopt={(details) => {
            void handleAdopt(details);
          }}
        />

        <OutlinePickerDialog
          isOpen={showApplyOutline}
          meetingType={minutes.meeting_type}
          busy={applyingOutline}
          title="Apply an outline"
          intro="The outline’s sections are laid over these minutes in its order. Everything you have already written is kept; sections the outline lacks stay if they have text."
          confirmLabel="Apply outline"
          onClose={() => setShowApplyOutline(false)}
          onChoose={(id) => {
            void handleApplyOutline(id);
          }}
        />

        <AgendaSyncDialog
          isOpen={showAgendaSync}
          minutesId={minutes.id}
          onClose={() => setShowAgendaSync(false)}
          onApplied={async () => {
            await fetchMinutes();
            toast.success('Agenda synced. Nothing you had written was changed.');
          }}
        />

        <CarryForwardDialog
          isOpen={showCarryForward}
          minutesId={minutes.id}
          onClose={() => setShowCarryForward(false)}
          onCarried={refreshMinutes}
        />

        {/* Link Event Modal */}
        {showLinkEventModal && (
          <div
            className="modal-overlay z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="link-event-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowLinkEventModal(false);
            }}
          >
            <DialogPanel onClose={() => setShowLinkEventModal(false)} className="modal-panel-scroll w-full max-w-lg">
              <div className="border-theme-surface-border flex items-center justify-between border-b px-6 py-4">
                <h3 id="link-event-title" className="text-theme-text-primary text-lg font-medium">
                  Link to Meeting Event
                </h3>
                <button
                  data-dialog-close
                  onClick={() => setShowLinkEventModal(false)}
                  className="text-theme-text-muted hover:text-theme-text-secondary"
                  aria-label="Close dialog"
                >
                  <span aria-hidden="true">&times;</span>
                </button>
              </div>
              <div className="max-h-96 overflow-y-auto px-6 py-4">
                {loadingEvents ? (
                  <p className="text-theme-text-muted text-sm">Loading events...</p>
                ) : availableEvents.length === 0 ? (
                  <p className="text-theme-text-muted text-sm">
                    No business meeting events to link. Create one in Events first.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {availableEvents.map((ev) => (
                      <button
                        key={ev.id}
                        onClick={() => {
                          void handleLinkEvent(ev.id);
                        }}
                        className={`w-full rounded-lg border p-3 text-left transition-colors hover:border-cyan-500/30 hover:bg-cyan-500/10 ${
                          minutes?.event_id === ev.id ? 'border-cyan-500 bg-cyan-500/10' : 'border-theme-surface-border'
                        }`}
                      >
                        <div className="text-theme-text-primary text-sm font-medium">{ev.title}</div>
                        <div className="text-theme-text-muted mt-1 text-xs">
                          {formatDateTime(ev.start_datetime, tz)}
                          {ev.location && ` \u00b7 ${ev.location}`}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="bg-theme-surface-secondary flex justify-end rounded-b-lg px-6 py-3">
                <button
                  onClick={() => setShowLinkEventModal(false)}
                  className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-md border px-4 py-2"
                >
                  Cancel
                </button>
              </div>
            </DialogPanel>
          </div>
        )}

        <PromptDialog
          isOpen={showReopenDialog}
          onClose={() => setShowReopenDialog(false)}
          onSubmit={(reason) => void handleReopen(reason)}
          title="Reopen adopted minutes"
          message="Adopted minutes are locked. Reopening returns them to draft so they can be corrected; they must then be circulated and adopted again, and members will not see them as adopted until they are."
          label="What needs correcting"
          required
          minLength={10}
          multiline
          hint="Saved in the audit log with the earlier approval."
          confirmLabel="Reopen as draft"
          confirmVariant="warning"
          loading={reopening}
        />

        {/* Reject Modal */}
        {showRejectModal && (
          <div
            className="modal-overlay z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reject-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setShowRejectModal(false);
                setRejectReason('');
              }
            }}
          >
            <DialogPanel onClose={() => setShowRejectModal(false)} className="modal-panel-scroll w-full max-w-md">
              <div className="border-theme-surface-border border-b px-6 py-4">
                <h3 id="reject-title" className="text-theme-text-primary text-lg font-medium">
                  Return Minutes for Changes
                </h3>
              </div>
              <div className="px-6 py-4">
                <label htmlFor="reject-reason" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                  What needs to change <span aria-hidden="true">*</span>{' '}
                  <span className="text-theme-text-muted text-xs">(at least 10 characters)</span>
                </label>
                <textarea
                  id="reject-reason"
                  rows={4}
                  required
                  aria-required="true"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Describe what needs to be corrected..."
                  className="form-input"
                />
                <div className="mt-4 flex justify-end gap-3">
                  <button
                    onClick={() => {
                      setShowRejectModal(false);
                      setRejectReason('');
                    }}
                    className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-md border px-4 py-2"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      void handleReject();
                    }}
                    disabled={rejectReason.trim().length < 10}
                    className="btn-primary rounded-md"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </DialogPanel>
          </div>
        )}
      </div>
    </div>
  );
};

export default MinutesDetailPage;
