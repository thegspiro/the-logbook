/**
 * Minutes Detail Page
 *
 * View and edit meeting minutes, motions, action items, and manage approval workflow.
 */

import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { minutesService, eventService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import type {
  MeetingMinutes,
  MeetingType,
  MotionCreate,
  ActionItemCreate,
  ActionItemPriority,
} from '../types/minutes';
import type { Event as EventDetail, EventListItem } from '../types/event';

const STATUS_BADGES: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800',
  submitted: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};

const MOTION_STATUS_BADGES: Record<string, string> = {
  passed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  tabled: 'bg-yellow-100 text-yellow-800',
  withdrawn: 'bg-gray-100 text-gray-800',
};

const PRIORITY_BADGES: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
};

const ACTION_STATUS_BADGES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-800',
  overdue: 'bg-red-100 text-red-800',
};

const SECTION_FIELDS: { key: string; label: string }[] = [
  { key: 'agenda', label: 'Agenda' },
  { key: 'old_business', label: 'Old Business' },
  { key: 'new_business', label: 'New Business' },
  { key: 'treasurer_report', label: 'Treasurer Report' },
  { key: 'chief_report', label: 'Chief Report' },
  { key: 'committee_reports', label: 'Committee Reports' },
  { key: 'announcements', label: 'Announcements' },
  { key: 'notes', label: 'General Notes' },
];

export const MinutesDetailPage: React.FC = () => {
  const { minutesId } = useParams<{ minutesId: string }>();
  const navigate = useNavigate();
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('meetings.manage');

  const [minutes, setMinutes] = useState<MeetingMinutes | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inline editing
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [sectionValue, setSectionValue] = useState('');
  const [saving, setSaving] = useState(false);

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
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load minutes');
    } finally {
      setLoading(false);
    }
  };

  const isEditable = minutes && (minutes.status === 'draft' || minutes.status === 'rejected');

  const handleSaveSection = async (key: string) => {
    if (!minutesId) return;
    try {
      setSaving(true);
      const updated = await minutesService.updateMinutes(minutesId, { [key]: sectionValue });
      setMinutes(updated);
      setEditingSection(null);
      toast.success('Section saved');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!minutesId) return;
    try {
      const updated = await minutesService.submitForApproval(minutesId);
      setMinutes(updated);
      toast.success('Minutes submitted for approval');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to submit');
    }
  };

  const handleApprove = async () => {
    if (!minutesId) return;
    try {
      const updated = await minutesService.approve(minutesId);
      setMinutes(updated);
      toast.success('Minutes approved');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to approve');
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
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to reject');
    }
  };

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
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to add motion');
    }
  };

  const handleDeleteMotion = async (motionId: string) => {
    if (!minutesId || !confirm('Delete this motion?')) return;
    try {
      await minutesService.deleteMotion(minutesId, motionId);
      fetchMinutes();
      toast.success('Motion deleted');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to delete motion');
    }
  };

  const handleAddActionItem = async () => {
    if (!minutesId || !actionForm.description.trim()) return;
    try {
      await minutesService.addActionItem(minutesId, actionForm);
      setShowActionForm(false);
      setActionForm({ description: '', assignee_name: '', due_date: undefined, priority: 'medium' });
      fetchMinutes();
      toast.success('Action item added');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to add action item');
    }
  };

  const handleUpdateActionItemStatus = async (itemId: string, newStatus: string) => {
    if (!minutesId) return;
    try {
      await minutesService.updateActionItem(minutesId, itemId, { status: newStatus as any });
      fetchMinutes();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to update');
    }
  };

  const handleDeleteActionItem = async (itemId: string) => {
    if (!minutesId || !confirm('Delete this action item?')) return;
    try {
      await minutesService.deleteActionItem(minutesId, itemId);
      fetchMinutes();
      toast.success('Action item deleted');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to delete');
    }
  };

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
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to link event');
    }
  };

  const handleUnlinkEvent = async () => {
    if (!minutesId) return;
    try {
      const updated = await minutesService.updateMinutes(minutesId, { event_id: '' as any });
      setMinutes(updated);
      setLinkedEvent(null);
      toast.success('Event unlinked');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to unlink event');
    }
  };

  const handleDelete = async () => {
    if (!minutesId || !confirm('Delete these draft minutes? This cannot be undone.')) return;
    try {
      await minutesService.deleteMinutes(minutesId);
      toast.success('Minutes deleted');
      navigate('/minutes');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to delete');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="text-gray-500 text-center py-12">Loading minutes...</div>
      </div>
    );
  }

  if (error || !minutes) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">{error || 'Minutes not found'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <Link to="/minutes" className="text-blue-600 hover:text-blue-700 text-sm">
          &larr; Back to Minutes
        </Link>
        <div className="flex justify-between items-start mt-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{minutes.title}</h1>
            <p className="text-gray-500 mt-1">
              {formatDate(minutes.meeting_date)}
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
          <div className="mt-3 bg-red-50 border-l-4 border-red-500 p-4">
            <p className="text-sm font-medium text-red-800">Rejection Reason:</p>
            <p className="text-sm text-red-700 mt-1">{minutes.rejection_reason}</p>
          </div>
        )}
      </div>

      {/* Linked Event */}
      {(linkedEvent || (canManage && isEditable)) && (
        <div className="bg-white shadow rounded-lg p-4 mb-6">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-medium text-gray-700">Linked Meeting Event</h3>
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
              <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800">Business Meeting</span>
              <Link
                to={`/events/${linkedEvent.id}`}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                {linkedEvent.title}
              </Link>
              <span className="text-xs text-gray-500">
                {new Date(linkedEvent.start_datetime).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
              </span>
              {linkedEvent.location && (
                <span className="text-xs text-gray-500">{linkedEvent.location}</span>
              )}
            </div>
          ) : (
            canManage && isEditable && (
              <p className="mt-1 text-xs text-gray-400 italic">
                No event linked. Link to a scheduled meeting to connect attendance and event data.
              </p>
            )
          )}
        </div>
      )}

      {/* Workflow Actions */}
      {canManage && (
        <div className="bg-white shadow rounded-lg p-4 mb-6">
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
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          {minutes.called_to_order_at && (
            <div>
              <span className="text-gray-500">Called to Order:</span>
              <div className="font-medium">{formatDate(minutes.called_to_order_at)}</div>
            </div>
          )}
          {minutes.adjourned_at && (
            <div>
              <span className="text-gray-500">Adjourned:</span>
              <div className="font-medium">{formatDate(minutes.adjourned_at)}</div>
            </div>
          )}
          {minutes.quorum_met !== null && minutes.quorum_met !== undefined && (
            <div>
              <span className="text-gray-500">Quorum:</span>
              <div className={`font-medium ${minutes.quorum_met ? 'text-green-700' : 'text-red-700'}`}>
                {minutes.quorum_met ? 'Met' : 'Not Met'}
                {minutes.quorum_count !== null && ` (${minutes.quorum_count})`}
              </div>
            </div>
          )}
        </div>

        {/* Attendees */}
        {minutes.attendees && minutes.attendees.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Attendees ({minutes.attendees.length})</h3>
            <div className="flex flex-wrap gap-2">
              {minutes.attendees.map((a, i) => (
                <span
                  key={i}
                  className={`text-xs px-2 py-1 rounded ${a.present ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800 line-through'}`}
                >
                  {a.name}{a.role ? ` (${a.role})` : ''}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Content Sections */}
      <div className="space-y-4 mb-6">
        {SECTION_FIELDS.map(({ key, label }) => {
          const value = (minutes as any)[key] as string | null;
          const isEditing = editingSection === key;

          if (!value && !isEditable && !isEditing) return null;

          return (
            <div key={key} className="bg-white shadow rounded-lg p-6">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-md font-semibold text-gray-900">{label}</h3>
                {canManage && isEditable && !isEditing && (
                  <button
                    onClick={() => { setEditingSection(key); setSectionValue(value || ''); }}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    Edit
                  </button>
                )}
              </div>

              {isEditing ? (
                <div>
                  <textarea
                    rows={6}
                    value={sectionValue}
                    onChange={(e) => setSectionValue(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => handleSaveSection(key)}
                      disabled={saving}
                      className="px-3 py-1.5 text-sm bg-cyan-600 text-white rounded-md hover:bg-cyan-700 disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={() => setEditingSection(null)}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : value ? (
                <div className="text-sm text-gray-700 whitespace-pre-wrap">{value}</div>
              ) : (
                <p className="text-sm text-gray-400 italic">
                  No content yet.{' '}
                  {canManage && isEditable && (
                    <button
                      onClick={() => { setEditingSection(key); setSectionValue(''); }}
                      className="text-blue-600 hover:underline"
                    >
                      Add content
                    </button>
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Motions */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Motions ({minutes.motions.length})</h3>
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
          <div className="border rounded-lg p-4 mb-4 bg-gray-50 space-y-3">
            <textarea
              rows={3}
              value={motionForm.motion_text}
              onChange={(e) => setMotionForm({ ...motionForm, motion_text: e.target.value })}
              placeholder="Motion text..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
            <div className="grid grid-cols-3 gap-3">
              <input
                type="text"
                value={motionForm.moved_by || ''}
                onChange={(e) => setMotionForm({ ...motionForm, moved_by: e.target.value })}
                placeholder="Moved by"
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
              <input
                type="text"
                value={motionForm.seconded_by || ''}
                onChange={(e) => setMotionForm({ ...motionForm, seconded_by: e.target.value })}
                placeholder="Seconded by"
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
              <select
                value={motionForm.status}
                onChange={(e) => setMotionForm({ ...motionForm, status: e.target.value as any })}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
                <option value="tabled">Tabled</option>
                <option value="withdrawn">Withdrawn</option>
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <input
                type="number"
                min={0}
                value={motionForm.votes_for ?? ''}
                onChange={(e) => setMotionForm({ ...motionForm, votes_for: e.target.value ? parseInt(e.target.value) : undefined })}
                placeholder="Votes for"
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
              <input
                type="number"
                min={0}
                value={motionForm.votes_against ?? ''}
                onChange={(e) => setMotionForm({ ...motionForm, votes_against: e.target.value ? parseInt(e.target.value) : undefined })}
                placeholder="Votes against"
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
              <input
                type="number"
                min={0}
                value={motionForm.votes_abstain ?? ''}
                onChange={(e) => setMotionForm({ ...motionForm, votes_abstain: e.target.value ? parseInt(e.target.value) : undefined })}
                placeholder="Abstentions"
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
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
          <p className="text-sm text-gray-500">No motions recorded.</p>
        ) : (
          <div className="space-y-3">
            {minutes.motions.map((motion, i) => (
              <div key={motion.id} className="border rounded-lg p-4">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-gray-400 font-mono">#{i + 1}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${MOTION_STATUS_BADGES[motion.status]}`}>
                        {motion.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-900">{motion.motion_text}</p>
                    <div className="mt-2 text-xs text-gray-500 space-x-4">
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
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Action Items ({minutes.action_items.length})</h3>
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
          <div className="border rounded-lg p-4 mb-4 bg-gray-50 space-y-3">
            <textarea
              rows={2}
              value={actionForm.description}
              onChange={(e) => setActionForm({ ...actionForm, description: e.target.value })}
              placeholder="Action item description..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
            <div className="grid grid-cols-3 gap-3">
              <input
                type="text"
                value={actionForm.assignee_name || ''}
                onChange={(e) => setActionForm({ ...actionForm, assignee_name: e.target.value })}
                placeholder="Assignee name"
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
              <input
                type="date"
                value={actionForm.due_date || ''}
                onChange={(e) => setActionForm({ ...actionForm, due_date: e.target.value || undefined })}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
              <select
                value={actionForm.priority}
                onChange={(e) => setActionForm({ ...actionForm, priority: e.target.value as ActionItemPriority })}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
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
          <p className="text-sm text-gray-500">No action items.</p>
        ) : (
          <div className="space-y-3">
            {minutes.action_items.map(item => (
              <div key={item.id} className="border rounded-lg p-4">
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
                    <p className="text-sm text-gray-900">{item.description}</p>
                    <div className="mt-2 text-xs text-gray-500 space-x-4">
                      {item.assignee_name && <span>Assigned to: {item.assignee_name}</span>}
                      {item.due_date && (
                        <span>
                          Due: {new Date(item.due_date).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    {canManage && item.status !== 'completed' && item.status !== 'cancelled' && (
                      <select
                        value={item.status}
                        onChange={(e) => handleUpdateActionItemStatus(item.id, e.target.value)}
                        className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-cyan-500"
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
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-lg font-medium text-gray-900">Link to Meeting Event</h3>
              <button onClick={() => setShowLinkEventModal(false)} className="text-gray-400 hover:text-gray-600">
                &times;
              </button>
            </div>
            <div className="px-6 py-4 max-h-96 overflow-y-auto">
              {loadingEvents ? (
                <p className="text-sm text-gray-500">Loading events...</p>
              ) : availableEvents.length === 0 ? (
                <p className="text-sm text-gray-500">No business meeting events found.</p>
              ) : (
                <div className="space-y-2">
                  {availableEvents.map(ev => (
                    <button
                      key={ev.id}
                      onClick={() => handleLinkEvent(ev.id)}
                      className={`w-full text-left p-3 border rounded-lg hover:bg-cyan-50 hover:border-cyan-300 transition-colors ${
                        minutes?.event_id === ev.id ? 'border-cyan-500 bg-cyan-50' : 'border-gray-200'
                      }`}
                    >
                      <div className="text-sm font-medium text-gray-900">{ev.title}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {new Date(ev.start_datetime).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        {ev.location && ` \u00b7 ${ev.location}`}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="px-6 py-3 bg-gray-50 flex justify-end rounded-b-lg">
              <button
                onClick={() => setShowLinkEventModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Reject Minutes</h3>
            </div>
            <div className="px-6 py-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason for Rejection * <span className="text-xs text-gray-500">(min 10 characters)</span>
              </label>
              <textarea
                rows={4}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Describe what needs to be corrected..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <div className="mt-4 flex justify-end gap-3">
                <button
                  onClick={() => { setShowRejectModal(false); setRejectReason(''); }}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
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
  );
};

export default MinutesDetailPage;
