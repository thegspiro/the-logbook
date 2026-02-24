/**
 * Minutes Detail Page
 *
 * View and edit meeting minutes with dynamic sections, motions, action items,
 * section reordering, and publish-to-documents workflow.
 */

import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  BookOpen,
  CheckCircle,
} from 'lucide-react';
import { minutesService, eventService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate, formatDateTime } from '../utils/dateFormatting';
import { getErrorMessage } from '../utils/errorHandling';
import type {
  MeetingMinutes,
  MotionCreate,
  MotionStatus,
  ActionItemCreate,
  ActionItemPriority,
  SectionEntry,
} from '../types/minutes';
import type { Event as EventDetail, EventListItem } from '../types/event';

const STATUS_BADGES: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  submitted: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
  approved: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
};

const MOTION_STATUS_BADGES: Record<string, string> = {
  passed: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  failed: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  tabled: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  withdrawn: 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400',
};

const PRIORITY_BADGES: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400',
  urgent: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
};

const ACTION_STATUS_BADGES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
  completed: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400',
  overdue: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
};

export const MinutesDetailPage: React.FC = () => {
  const { minutesId } = useParams<{ minutesId: string }>();
  const navigate = useNavigate();
  const { checkPermission } = useAuthStore();
  const tz = useTimezone();
  const canManage = checkPermission('meetings.manage');

  const [minutes, setMinutes] = useState<MeetingMinutes | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inline editing
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [sectionValue, setSectionValue] = useState('');
  const [saving, setSaving] = useState(false);

  // Add section form
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState('');

  // Publishing
  const [publishing, setPublishing] = useState(false);

  // Motion form
  const [showMotionForm, setShowMotionForm] = useState(false);
  const [motionForm, setMotionForm] = useState<MotionCreate>({
    motion_text: '', moved_by: '', seconded_by: '', status: 'passed',
    votes_for: undefined, votes_against: undefined, votes_abstain: undefined,
  });

  // Action item form
  const [showActionForm, setShowActionForm] = useState(false);
  const [actionForm, setActionForm] = useState<ActionItemCreate>({
    description: '', assignee_name: '', due_date: undefined, priority: 'medium',
  });

  // Linked event
  const [linkedEvent, setLinkedEvent] = useState<EventDetail | null>(null);
  const [showLinkEventModal, setShowLinkEventModal] = useState(false);
  const [availableEvents, setAvailableEvents] = useState<EventListItem[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Approval
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    if (minutesId) fetchMinutes();
  }, [minutesId]);

  // Fetch linked event details when minutes load
  useEffect(() => {
    if (minutes?.event_id) {
      eventService.getEvent(minutes.event_id)
        .then(ev => setLinkedEvent(ev))
        .catch(() => setLinkedEvent(null));
    } else {
      setLinkedEvent(null);
    }
  }, [minutes?.event_id]);

  const fetchMinutes = async () => {
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
  };

  const isEditable = minutes && (minutes.status === 'draft' || minutes.status === 'rejected');

  // ── Section CRUD ──

  const handleSaveSection = async (sectionKey: string) => {
    if (!minutesId || !minutes) return;
    try {
      setSaving(true);
      const updatedSections = minutes.sections.map(s =>
        s.key === sectionKey ? { ...s, content: sectionValue } : s
      );
      const updated = await minutesService.updateMinutes(minutesId, { sections: updatedSections });
      setMinutes(updated);
      setEditingSection(null);
      toast.success('Section saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save'));
    } finally {
      setSaving(false);
    }
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
      const updated = await minutesService.updateMinutes(minutesId, { sections: renumbered });
      setMinutes(updated);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to reorder'));
    } finally {
      setSaving(false);
    }
  };

  const handleAddSection = async () => {
    if (!minutesId || !minutes || !newSectionTitle.trim()) return;
    const key = newSectionTitle.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const newSection: SectionEntry = {
      order: minutes.sections.length,
      key,
      title: newSectionTitle.trim(),
      content: '',
    };

    try {
      setSaving(true);
      const updated = await minutesService.updateMinutes(minutesId, {
        sections: [...minutes.sections, newSection],
      });
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
    if (!minutesId || !minutes || !confirm('Delete this section?')) return;
    const filtered = minutes.sections
      .filter(s => s.key !== sectionKey)
      .map((s, i) => ({ ...s, order: i }));

    try {
      setSaving(true);
      const updated = await minutesService.updateMinutes(minutesId, { sections: filtered });
      setMinutes(updated);
      toast.success('Section removed');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete section'));
    } finally {
      setSaving(false);
    }
  };

  // ── Publishing ──

  const handlePublish = async () => {
    if (!minutesId) return;
    try {
      setPublishing(true);
      await minutesService.publishMinutes(minutesId);
      await fetchMinutes();
      toast.success('Minutes published to Documents');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to publish'));
    } finally {
      setPublishing(false);
    }
  };

  // ── Workflow ──

  const handleSubmit = async () => {
    if (!minutesId) return;
    try {
      const updated = await minutesService.submitForApproval(minutesId);
      setMinutes(updated);
      toast.success('Minutes submitted for approval');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to submit'));
    }
  };

  const handleApprove = async () => {
    if (!minutesId) return;
    try {
      const updated = await minutesService.approve(minutesId);
      setMinutes(updated);
      toast.success('Minutes approved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to approve'));
    }
  };

  const handleReject = async () => {
    if (!minutesId || rejectReason.trim().length < 10) return;
    try {
      const updated = await minutesService.reject(minutesId, rejectReason.trim());
      setMinutes(updated);
      setShowRejectModal(false);
      setRejectReason('');
      toast.success('Minutes rejected');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to reject'));
    }
  };

  // ── Motions ──

  const handleAddMotion = async () => {
    if (!minutesId || !motionForm.motion_text.trim()) return;
    try {
      await minutesService.addMotion(minutesId, {
        ...motionForm,
        order: (minutes?.motions.length || 0),
      });
      setShowMotionForm(false);
      setMotionForm({ motion_text: '', moved_by: '', seconded_by: '', status: 'passed', votes_for: undefined, votes_against: undefined, votes_abstain: undefined });
      fetchMinutes();
      toast.success('Motion added');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to add motion'));
    }
  };

  const handleDeleteMotion = async (motionId: string) => {
    if (!minutesId || !confirm('Delete this motion?')) return;
    try {
      await minutesService.deleteMotion(minutesId, motionId);
      fetchMinutes();
      toast.success('Motion deleted');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete motion'));
    }
  };

  // ── Action Items ──

  const handleAddActionItem = async () => {
    if (!minutesId || !actionForm.description.trim()) return;
    try {
      await minutesService.addActionItem(minutesId, actionForm);
      setShowActionForm(false);
      setActionForm({ description: '', assignee_name: '', due_date: undefined, priority: 'medium' });
      fetchMinutes();
      toast.success('Action item added');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to add action item'));
    }
  };

  const handleUpdateActionItemStatus = async (itemId: string, newStatus: string) => {
    if (!minutesId) return;
    try {
      await minutesService.updateActionItem(minutesId, itemId, { status: newStatus });
      fetchMinutes();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update'));
    }
  };

  const handleDeleteActionItem = async (itemId: string) => {
    if (!minutesId || !confirm('Delete this action item?')) return;
    try {
      await minutesService.deleteActionItem(minutesId, itemId);
      fetchMinutes();
      toast.success('Action item deleted');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete'));
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
      const updated = await minutesService.updateMinutes(minutesId, { event_id: '' });
      setMinutes(updated);
      setLinkedEvent(null);
      toast.success('Event unlinked');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to unlink event'));
    }
  };

  const handleDelete = async () => {
    if (!minutesId || !confirm('Delete these draft minutes? This cannot be undone.')) return;
    try {
      await minutesService.deleteMinutes(minutesId);
      toast.success('Minutes deleted');
      navigate('/minutes');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete'));
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="max-w-5xl mx-auto px-4 py-8">
          <div className="text-theme-text-muted text-center py-12" role="status" aria-live="polite">Loading minutes...</div>
        </div>
      </div>
    );
  }

  if (error || !minutes) {
    return (
      <div className="min-h-screen">
        <div className="max-w-5xl mx-auto px-4 py-8">
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
            <p className="text-sm text-red-300">{error || 'Minutes not found'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <Link to="/minutes" className="text-blue-600 hover:text-blue-700 text-sm">
          &larr; Back to Minutes
        </Link>
        <div className="flex justify-between items-start mt-2">
          <div>
            <h1 className="text-2xl font-bold text-theme-text-primary">{minutes.title}</h1>
            <p className="text-theme-text-muted mt-1">
              {formatDateTime(minutes.meeting_date, tz)}
              {minutes.location && ` \u00b7 ${minutes.location}`}
              {minutes.called_by && ` \u00b7 Called by ${minutes.called_by}`}
            </p>
          </div>
          <span className={`px-3 py-1 text-sm font-semibold rounded-full ${STATUS_BADGES[minutes.status]}`}>
            {minutes.status}
          </span>
        </div>

        {/* Rejection notice */}
        {minutes.status === 'rejected' && minutes.rejection_reason && (
          <div className="mt-3 bg-red-500/10 border-l-4 border-red-500 p-4">
            <p className="text-sm font-medium text-red-300">Rejection Reason:</p>
            <p className="text-sm text-red-300 mt-1">{minutes.rejection_reason}</p>
          </div>
        )}
      </div>

      {/* Linked Event */}
      {(linkedEvent || (canManage && isEditable)) && (
        <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-4 mb-6">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-medium text-theme-text-secondary">Linked Meeting Event</h3>
            {canManage && isEditable && (
              <div className="flex gap-2">
                {linkedEvent && (
                  <button
                    onClick={handleUnlinkEvent}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Unlink
                  </button>
                )}
                <button
                  onClick={handleOpenLinkEvent}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  {linkedEvent ? 'Change' : 'Link to Event'}
                </button>
              </div>
            )}
          </div>
          {linkedEvent ? (
            <div className="mt-2 flex items-center gap-3">
              <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400">Business Meeting</span>
              <Link
                to={`/events/${linkedEvent.id}`}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                {linkedEvent.title}
              </Link>
              <span className="text-xs text-theme-text-muted">
                {formatDate(linkedEvent.start_datetime, tz)}
              </span>
              {linkedEvent.location && (
                <span className="text-xs text-theme-text-muted">{linkedEvent.location}</span>
              )}
            </div>
          ) : (
            canManage && isEditable && (
              <p className="mt-1 text-xs text-theme-text-muted italic">
                No event linked. Link to a scheduled meeting to connect attendance and event data.
              </p>
            )
          )}
        </div>
      )}

      {/* Workflow Actions */}
      {canManage && (
        <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-4 mb-6">
          <div className="flex flex-wrap gap-3">
            {(minutes.status === 'draft' || minutes.status === 'rejected') && (
              <button
                onClick={handleSubmit}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Submit for Approval
              </button>
            )}
            {minutes.status === 'submitted' && (
              <>
                <button
                  onClick={handleApprove}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                >
                  Approve Minutes
                </button>
                <button
                  onClick={() => setShowRejectModal(true)}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                >
                  Reject Minutes
                </button>
              </>
            )}
            {minutes.status === 'approved' && (
              <button
                onClick={handlePublish}
                disabled={publishing}
                className="px-4 py-2 bg-cyan-600 text-white rounded-md hover:bg-cyan-700 disabled:opacity-50 inline-flex items-center gap-2"
              >
                <BookOpen className="w-4 h-4" aria-hidden="true" />
                {publishing ? 'Publishing...' : minutes.published_document_id ? 'Re-publish to Documents' : 'Publish to Documents'}
              </button>
            )}
            {minutes.published_document_id && (
              <Link
                to="/documents"
                className="px-4 py-2 border border-green-500/30 text-green-300 rounded-md hover:bg-green-500/10 inline-flex items-center gap-2"
              >
                <CheckCircle className="w-4 h-4" aria-hidden="true" />
                View in Documents
              </Link>
            )}
            {minutes.status === 'draft' && (
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
              >
                Delete Draft
              </button>
            )}
          </div>
        </div>
      )}

      {/* Meeting Info */}
      <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-6 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          {minutes.called_to_order_at && (
            <div>
              <span className="text-theme-text-muted">Called to Order:</span>
              <div className="font-medium text-theme-text-primary">{formatDateTime(minutes.called_to_order_at, tz)}</div>
            </div>
          )}
          {minutes.adjourned_at && (
            <div>
              <span className="text-theme-text-muted">Adjourned:</span>
              <div className="font-medium text-theme-text-primary">{formatDateTime(minutes.adjourned_at, tz)}</div>
            </div>
          )}
          {minutes.quorum_met !== null && minutes.quorum_met !== undefined && (
            <div>
              <span className="text-theme-text-muted">Quorum:</span>
              <div className={`font-medium ${minutes.quorum_met ? 'text-green-300' : 'text-red-300'}`}>
                {minutes.quorum_met ? 'Met' : 'Not Met'}
                {minutes.quorum_count !== null && ` (${minutes.quorum_count})`}
              </div>
            </div>
          )}
        </div>

        {/* Attendees */}
        {minutes.attendees && minutes.attendees.length > 0 && (
          <div className="mt-4 pt-4 border-t border-theme-surface-border">
            <h3 className="text-sm font-medium text-theme-text-secondary mb-2">Attendees ({minutes.attendees.length})</h3>
            <div className="flex flex-wrap gap-2">
              {minutes.attendees.map((a, i) => (
                <span
                  key={i}
                  className={`text-xs px-2 py-1 rounded ${a.present ? 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400' : 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400 line-through'}`}
                >
                  {a.name}{a.role ? ` (${a.role})` : ''}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Dynamic Content Sections */}
      <div className="space-y-4 mb-6">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold text-theme-text-primary">Meeting Sections</h2>
          {canManage && isEditable && (
            <button
              onClick={() => setShowAddSection(!showAddSection)}
              className="px-3 py-1.5 text-sm bg-cyan-600 text-white rounded-md hover:bg-cyan-700 inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Section
            </button>
          )}
        </div>

        {/* Add Section Form */}
        {showAddSection && (
          <div className="bg-theme-surface-secondary border border-theme-surface-border rounded-lg p-4 flex items-end gap-3" role="form" aria-label="Add new section">
            <div className="flex-1">
              <label htmlFor="new-section-title" className="block text-sm font-medium text-theme-text-secondary mb-1">Section Title</label>
              <input
                id="new-section-title"
                type="text"
                value={newSectionTitle}
                onChange={(e) => setNewSectionTitle(e.target.value)}
                placeholder="e.g., Fire Prevention Report"
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-md text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>
            <button
              onClick={handleAddSection}
              disabled={!newSectionTitle.trim() || saving}
              className="px-4 py-2 bg-cyan-600 text-white text-sm rounded-md hover:bg-cyan-700 disabled:opacity-50"
            >
              Add
            </button>
            <button
              onClick={() => { setShowAddSection(false); setNewSectionTitle(''); }}
              className="px-4 py-2 border border-theme-surface-border text-sm text-theme-text-secondary rounded-md hover:bg-theme-surface-hover"
            >
              Cancel
            </button>
          </div>
        )}

        {minutes.sections.length === 0 ? (
          <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-8 text-center">
            <p className="text-theme-text-muted">No sections defined for these minutes.</p>
            {canManage && isEditable && (
              <button
                onClick={() => setShowAddSection(true)}
                className="mt-3 text-sm text-cyan-600 hover:text-cyan-800"
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
                <div key={section.key} className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-6">
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-2">
                      {canManage && isEditable && (
                        <div className="flex flex-col" role="group" aria-label={`Reorder ${section.title}`}>
                          <button
                            onClick={() => handleReorderSection(idx, 'up')}
                            disabled={idx === 0 || saving}
                            className="text-theme-text-muted hover:text-theme-text-secondary disabled:opacity-30 p-0.5"
                            aria-label={`Move ${section.title} up`}
                          >
                            <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <button
                            onClick={() => handleReorderSection(idx, 'down')}
                            disabled={idx === minutes.sections.length - 1 || saving}
                            className="text-theme-text-muted hover:text-theme-text-secondary disabled:opacity-30 p-0.5"
                            aria-label={`Move ${section.title} down`}
                          >
                            <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                      <h3 className="text-md font-semibold text-theme-text-primary">{section.title}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      {canManage && isEditable && !isEditing && (
                        <>
                          <button
                            onClick={() => { setEditingSection(section.key); setSectionValue(section.content || ''); }}
                            className="text-sm text-blue-600 hover:text-blue-800"
                            aria-label={`Edit ${section.title}`}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteSection(section.key)}
                            className="text-theme-text-muted hover:text-red-400 p-1"
                            aria-label={`Delete ${section.title} section`}
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {isEditing ? (
                    <div>
                      <label htmlFor={`section-edit-${section.key}`} className="sr-only">Edit {section.title} content</label>
                      <textarea
                        id={`section-edit-${section.key}`}
                        rows={6}
                        value={sectionValue}
                        onChange={(e) => setSectionValue(e.target.value)}
                        className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-md text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
                        aria-label={`${section.title} content`}
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => handleSaveSection(section.key)}
                          disabled={saving}
                          className="px-3 py-1.5 text-sm bg-cyan-600 text-white rounded-md hover:bg-cyan-700 disabled:opacity-50"
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditingSection(null)}
                          className="px-3 py-1.5 text-sm border border-theme-surface-border text-theme-text-secondary rounded-md hover:bg-theme-surface-hover"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : section.content ? (
                    <div className="text-sm text-theme-text-secondary whitespace-pre-wrap">{section.content}</div>
                  ) : (
                    <p className="text-sm text-theme-text-muted italic">
                      No content yet.{' '}
                      {canManage && isEditable && (
                        <button
                          onClick={() => { setEditingSection(section.key); setSectionValue(''); }}
                          className="text-blue-600 hover:underline"
                        >
                          Add content
                        </button>
                      )}
                    </p>
                  )}
                </div>
              );
            })
        )}
      </div>

      {/* Motions */}
      <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-6 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-theme-text-primary">Motions ({minutes.motions.length})</h3>
          {canManage && isEditable && (
            <button
              onClick={() => setShowMotionForm(!showMotionForm)}
              className="px-3 py-1.5 text-sm bg-cyan-600 text-white rounded-md hover:bg-cyan-700"
            >
              {showMotionForm ? 'Cancel' : 'Add Motion'}
            </button>
          )}
        </div>

        {showMotionForm && (
          <div className="border border-theme-surface-border rounded-lg p-4 mb-4 bg-theme-surface-secondary space-y-3" role="form" aria-label="Add motion">
            <label htmlFor="motion-text" className="sr-only">Motion text</label>
            <textarea
              id="motion-text"
              rows={3}
              value={motionForm.motion_text}
              onChange={(e) => setMotionForm({ ...motionForm, motion_text: e.target.value })}
              placeholder="Motion text..."
              aria-label="Motion text"
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-md text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="moved-by" className="sr-only">Moved by</label>
                <input
                  id="moved-by"
                  type="text"
                  value={motionForm.moved_by || ''}
                  onChange={(e) => setMotionForm({ ...motionForm, moved_by: e.target.value })}
                  placeholder="Moved by"
                  aria-label="Moved by"
                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-md text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
              <div>
                <label htmlFor="seconded-by" className="sr-only">Seconded by</label>
                <input
                  id="seconded-by"
                  type="text"
                  value={motionForm.seconded_by || ''}
                  onChange={(e) => setMotionForm({ ...motionForm, seconded_by: e.target.value })}
                  placeholder="Seconded by"
                  aria-label="Seconded by"
                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-md text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
              <div>
                <label htmlFor="motion-status" className="sr-only">Motion status</label>
                <select
                  id="motion-status"
                  value={motionForm.status}
                  onChange={(e) => setMotionForm({ ...motionForm, status: e.target.value as MotionStatus })}
                  aria-label="Motion status"
                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-md text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
                >
                  <option value="passed">Passed</option>
                  <option value="failed">Failed</option>
                  <option value="tabled">Tabled</option>
                  <option value="withdrawn">Withdrawn</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="votes-for" className="sr-only">Votes for</label>
                <input
                  id="votes-for"
                  type="number"
                  min={0}
                  value={motionForm.votes_for ?? ''}
                  onChange={(e) => setMotionForm({ ...motionForm, votes_for: e.target.value ? parseInt(e.target.value) : undefined })}
                  placeholder="Votes for"
                  aria-label="Votes for"
                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-md text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
              <div>
                <label htmlFor="votes-against" className="sr-only">Votes against</label>
                <input
                  id="votes-against"
                  type="number"
                  min={0}
                  value={motionForm.votes_against ?? ''}
                  onChange={(e) => setMotionForm({ ...motionForm, votes_against: e.target.value ? parseInt(e.target.value) : undefined })}
                  placeholder="Votes against"
                  aria-label="Votes against"
                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-md text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
              <div>
                <label htmlFor="votes-abstain" className="sr-only">Abstentions</label>
                <input
                  id="votes-abstain"
                  type="number"
                  min={0}
                  value={motionForm.votes_abstain ?? ''}
                  onChange={(e) => setMotionForm({ ...motionForm, votes_abstain: e.target.value ? parseInt(e.target.value) : undefined })}
                  placeholder="Abstentions"
                  aria-label="Abstentions"
                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-md text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
            </div>
            <button
              onClick={handleAddMotion}
              disabled={!motionForm.motion_text.trim()}
              className="px-4 py-2 bg-cyan-600 text-white text-sm rounded-md hover:bg-cyan-700 disabled:opacity-50"
            >
              Add Motion
            </button>
          </div>
        )}

        {minutes.motions.length === 0 ? (
          <p className="text-sm text-theme-text-muted">No motions recorded.</p>
        ) : (
          <div className="space-y-3">
            {minutes.motions.map((motion, i) => (
              <div key={motion.id} className="border border-theme-surface-border rounded-lg p-4">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-theme-text-muted font-mono">#{i + 1}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${MOTION_STATUS_BADGES[motion.status]}`}>
                        {motion.status}
                      </span>
                    </div>
                    <p className="text-sm text-theme-text-primary">{motion.motion_text}</p>
                    <div className="mt-2 text-xs text-theme-text-muted space-x-4">
                      {motion.moved_by && <span>Moved by: {motion.moved_by}</span>}
                      {motion.seconded_by && <span>Seconded by: {motion.seconded_by}</span>}
                      {motion.votes_for !== null && motion.votes_for !== undefined && (
                        <span>
                          Vote: {motion.votes_for}-{motion.votes_against || 0}
                          {motion.votes_abstain ? ` (${motion.votes_abstain} abstain)` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  {canManage && isEditable && (
                    <button
                      onClick={() => handleDeleteMotion(motion.id)}
                      className="text-xs text-red-500 hover:text-red-700 ml-2"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action Items */}
      <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-6 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-theme-text-primary">Action Items ({minutes.action_items.length})</h3>
          {canManage && isEditable && (
            <button
              onClick={() => setShowActionForm(!showActionForm)}
              className="px-3 py-1.5 text-sm bg-cyan-600 text-white rounded-md hover:bg-cyan-700"
            >
              {showActionForm ? 'Cancel' : 'Add Action Item'}
            </button>
          )}
        </div>

        {showActionForm && (
          <div className="border border-theme-surface-border rounded-lg p-4 mb-4 bg-theme-surface-secondary space-y-3" role="form" aria-label="Add action item">
            <label htmlFor="action-description" className="sr-only">Action item description</label>
            <textarea
              id="action-description"
              rows={2}
              value={actionForm.description}
              onChange={(e) => setActionForm({ ...actionForm, description: e.target.value })}
              placeholder="Action item description..."
              aria-label="Action item description"
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-md text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="action-assignee" className="sr-only">Assignee name</label>
                <input
                  id="action-assignee"
                  type="text"
                  value={actionForm.assignee_name || ''}
                  onChange={(e) => setActionForm({ ...actionForm, assignee_name: e.target.value })}
                  placeholder="Assignee name"
                  aria-label="Assignee name"
                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-md text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
              <div>
                <label htmlFor="action-due-date" className="sr-only">Due date</label>
                <input
                  id="action-due-date"
                  type="date"
                  value={actionForm.due_date || ''}
                  onChange={(e) => setActionForm({ ...actionForm, due_date: e.target.value || undefined })}
                  aria-label="Due date"
                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-md text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
              <div>
                <label htmlFor="action-priority" className="sr-only">Priority</label>
                <select
                  id="action-priority"
                  value={actionForm.priority}
                  onChange={(e) => setActionForm({ ...actionForm, priority: e.target.value as ActionItemPriority })}
                  aria-label="Priority"
                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-md text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
            <button
              onClick={handleAddActionItem}
              disabled={!actionForm.description.trim()}
              className="px-4 py-2 bg-cyan-600 text-white text-sm rounded-md hover:bg-cyan-700 disabled:opacity-50"
            >
              Add Action Item
            </button>
          </div>
        )}

        {minutes.action_items.length === 0 ? (
          <p className="text-sm text-theme-text-muted">No action items.</p>
        ) : (
          <div className="space-y-3">
            {minutes.action_items.map(item => (
              <div key={item.id} className="border border-theme-surface-border rounded-lg p-4">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${ACTION_STATUS_BADGES[item.status]}`}>
                        {item.status.replace('_', ' ')}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded ${PRIORITY_BADGES[item.priority]}`}>
                        {item.priority}
                      </span>
                    </div>
                    <p className="text-sm text-theme-text-primary">{item.description}</p>
                    <div className="mt-2 text-xs text-theme-text-muted space-x-4">
                      {item.assignee_name && <span>Assigned to: {item.assignee_name}</span>}
                      {item.due_date && (
                        <span>
                          Due: {formatDate(item.due_date, tz)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    {canManage && item.status !== 'completed' && item.status !== 'cancelled' && (
                      <select
                        value={item.status}
                        onChange={(e) => handleUpdateActionItemStatus(item.id, e.target.value)}
                        aria-label={`Update status for: ${item.description.substring(0, 30)}`}
                        className="text-xs bg-theme-input-bg border border-theme-input-border rounded px-2 py-1 text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      >
                        <option value="pending">Pending</option>
                        <option value="in_progress">In Progress</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    )}
                    {canManage && isEditable && (
                      <button
                        onClick={() => handleDeleteActionItem(item.id)}
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
      </div>

      {/* Link Event Modal */}
      {showLinkEventModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="link-event-title"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowLinkEventModal(false); }}
        >
          <div className="bg-theme-surface-modal rounded-lg shadow-xl max-w-lg w-full">
            <div className="px-6 py-4 border-b border-theme-surface-border flex justify-between items-center">
              <h3 id="link-event-title" className="text-lg font-medium text-theme-text-primary">Link to Meeting Event</h3>
              <button onClick={() => setShowLinkEventModal(false)} className="text-theme-text-muted hover:text-theme-text-secondary" aria-label="Close dialog">
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <div className="px-6 py-4 max-h-96 overflow-y-auto">
              {loadingEvents ? (
                <p className="text-sm text-theme-text-muted">Loading events...</p>
              ) : availableEvents.length === 0 ? (
                <p className="text-sm text-theme-text-muted">No business meeting events found.</p>
              ) : (
                <div className="space-y-2">
                  {availableEvents.map(ev => (
                    <button
                      key={ev.id}
                      onClick={() => handleLinkEvent(ev.id)}
                      className={`w-full text-left p-3 border rounded-lg hover:bg-cyan-500/10 hover:border-cyan-500/30 transition-colors ${
                        minutes?.event_id === ev.id ? 'border-cyan-500 bg-cyan-500/10' : 'border-theme-surface-border'
                      }`}
                    >
                      <div className="text-sm font-medium text-theme-text-primary">{ev.title}</div>
                      <div className="text-xs text-theme-text-muted mt-1">
                        {formatDateTime(ev.start_datetime, tz)}
                        {ev.location && ` \u00b7 ${ev.location}`}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="px-6 py-3 bg-theme-surface-secondary flex justify-end rounded-b-lg">
              <button
                onClick={() => setShowLinkEventModal(false)}
                className="px-4 py-2 border border-theme-surface-border rounded-md text-theme-text-secondary hover:bg-theme-surface-hover"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reject-title"
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowRejectModal(false); setRejectReason(''); } }}
        >
          <div className="bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-theme-surface-border">
              <h3 id="reject-title" className="text-lg font-medium text-theme-text-primary">Reject Minutes</h3>
            </div>
            <div className="px-6 py-4">
              <label htmlFor="reject-reason" className="block text-sm font-medium text-theme-text-secondary mb-1">
                Reason for Rejection <span aria-hidden="true">*</span> <span className="text-xs text-theme-text-muted">(min 10 characters)</span>
              </label>
              <textarea
                id="reject-reason"
                rows={4}
                required
                aria-required="true"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Describe what needs to be corrected..."
                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-md text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <div className="mt-4 flex justify-end gap-3">
                <button
                  onClick={() => { setShowRejectModal(false); setRejectReason(''); }}
                  className="px-4 py-2 border border-theme-surface-border rounded-md text-theme-text-secondary hover:bg-theme-surface-hover"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={rejectReason.trim().length < 10}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                >
                  Reject
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

export default MinutesDetailPage;
