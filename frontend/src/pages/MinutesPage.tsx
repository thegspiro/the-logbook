import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import {
  ClipboardList,
  FileSearch,
  Plus,
  Search,
  X,
  Clock,
  AlertCircle,
  Trash2,
  Calendar,
  MapPin,
  User,
  Loader2,
  CheckSquare,
  Archive,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { meetingsService } from '../services/api';
import type { MeetingRecord, MeetingsSummary } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';

type MeetingType = 'business' | 'special' | 'committee' | 'board' | 'trustee' | 'executive' | 'annual' | 'other';

const MEETING_TYPES: { value: MeetingType; label: string; color: string }[] = [
  { value: 'business', label: 'Business Meeting', color: 'bg-cyan-100 text-cyan-800' },
  { value: 'special', label: 'Special Meeting', color: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-400' },
  { value: 'committee', label: 'Committee Meeting', color: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400' },
  { value: 'board', label: 'Board Meeting', color: 'bg-amber-100 text-amber-800' },
  { value: 'trustee', label: 'Trustee Meeting', color: 'bg-emerald-100 text-emerald-800' },
  { value: 'executive', label: 'Executive Meeting', color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-400' },
  { value: 'annual', label: 'Annual Meeting', color: 'bg-rose-100 text-rose-800' },
  { value: 'other', label: 'Other', color: 'bg-theme-surface-secondary text-theme-text-primary' },
];

const MinutesPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('meetings.manage');

  // Data state
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [summary, setSummary] = useState<MeetingsSummary | null>(null);

  // Loading / error state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Create form state
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Waivers state
  const [expandedWaivers, setExpandedWaivers] = useState<string | null>(null);
  const [waivers, setWaivers] = useState<Record<string, Array<Record<string, unknown>>>>({});
  const [loadingWaivers, setLoadingWaivers] = useState<string | null>(null);

  const [minutesForm, setMinutesForm] = useState({
    title: '',
    meetingType: 'business' as MeetingType,
    meetingDate: '',
    meetingTime: '',
    location: '',
    calledBy: '',
    notes: '',
  });

  // -------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: { meeting_type?: string; search?: string } = {};
      if (typeFilter !== 'all') {
        params.meeting_type = typeFilter;
      }
      if (searchQuery.trim()) {
        params.search = searchQuery.trim();
      }
      const [meetingsRes, summaryRes] = await Promise.all([
        meetingsService.getMeetings(params),
        meetingsService.getSummary(),
      ]);
      setMeetings(meetingsRes.meetings);
      setSummary(summaryRes);
    } catch {
      setError('Unable to load meetings. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [typeFilter, searchQuery]);

  // -------------------------------------------------------
  // Handlers
  // -------------------------------------------------------

  const handleCreateMeeting = async () => {
    if (!minutesForm.title.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const data: Record<string, unknown> = {
        title: minutesForm.title,
        meeting_type: minutesForm.meetingType,
        meeting_date: minutesForm.meetingDate || null,
        start_time: minutesForm.meetingTime ? `${minutesForm.meetingTime}:00` : null,
        location: minutesForm.location || null,
        called_by: minutesForm.calledBy || null,
        notes: minutesForm.notes || null,
      };
      await meetingsService.createMeeting(data);
      setShowCreateModal(false);
      setMinutesForm({
        title: '',
        meetingType: 'business',
        meetingDate: '',
        meetingTime: '',
        location: '',
        calledBy: '',
        notes: '',
      });
      await fetchData();
    } catch {
      setCreateError('Unable to create meeting. Please check your connection and try again.');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteMeeting = async (meetingId: string) => {
    if (!confirm('Are you sure you want to delete this meeting?')) return;
    setDeletingId(meetingId);
    try {
      await meetingsService.deleteMeeting(meetingId);
      await fetchData();
    } catch {
      setError('Unable to delete meeting. Please check your connection and try again.');
    } finally {
      setDeletingId(null);
    }
  };

  const getMeetingTypeInfo = (type: string) => {
    return MEETING_TYPES.find(t => t.value === type) || MEETING_TYPES[MEETING_TYPES.length - 1];
  };

  const handleToggleWaivers = async (meetingId: string) => {
    if (expandedWaivers === meetingId) {
      setExpandedWaivers(null);
      return;
    }
    setExpandedWaivers(meetingId);
    if (waivers[meetingId]) return; // Already loaded
    setLoadingWaivers(meetingId);
    try {
      const data = await meetingsService.getAttendanceWaivers(meetingId);
      setWaivers((prev) => ({ ...prev, [meetingId]: data }));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load waivers'));
      setExpandedWaivers(null);
    } finally {
      setLoadingWaivers(null);
    }
  };

  // -------------------------------------------------------
  // Render
  // -------------------------------------------------------

  return (
    <div className="min-h-screen">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center space-x-3">
          <div className="bg-cyan-600 rounded-lg p-2">
            <ClipboardList className="w-6 h-6 text-theme-text-primary" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-theme-text-primary">Meeting Minutes</h1>
            <p className="text-theme-text-muted text-sm">
              Record meeting minutes, track action items, and maintain organizational history
            </p>
          </div>
        </div>
        {canManage && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>Record Minutes</span>
          </button>
        )}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
          <p className="text-theme-text-muted text-xs font-medium uppercase">Total Minutes</p>
          <p className="text-theme-text-primary text-2xl font-bold mt-1">{summary?.total_meetings ?? 0}</p>
        </div>
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
          <p className="text-theme-text-muted text-xs font-medium uppercase">This Month</p>
          <p className="text-cyan-700 text-2xl font-bold mt-1">{summary?.meetings_this_month ?? 0}</p>
        </div>
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
          <p className="text-theme-text-muted text-xs font-medium uppercase">Open Action Items</p>
          <p className="text-yellow-700 text-2xl font-bold mt-1">{summary?.open_action_items ?? 0}</p>
        </div>
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
          <p className="text-theme-text-muted text-xs font-medium uppercase">Pending Approval</p>
          <p className="text-orange-700 text-2xl font-bold mt-1">{summary?.pending_approval ?? 0}</p>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border mb-6">
        <div className="flex flex-col md:flex-row items-center gap-4">
          <div className="relative flex-1 w-full md:max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-theme-text-muted" aria-hidden="true" />
            <label htmlFor="minutes-search" className="sr-only">Search meetings</label>
            <input
              id="minutes-search"
              type="text"
              placeholder="Search meeting minutes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div>
            <label htmlFor="type-filter" className="sr-only">Filter by meeting type</label>
            <select
              id="type-filter"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
            >
              <option value="all">All Types</option>
              {MEETING_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-5 h-5 text-red-700 flex-shrink-0" />
            <p className="text-red-300 text-sm">{error}</p>
            <button onClick={() => setError(null)} className="ml-auto text-red-700 hover:text-red-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-12 border border-theme-surface-border text-center">
          <Loader2 className="w-10 h-10 text-cyan-700 mx-auto mb-4 animate-spin" />
          <p className="text-theme-text-secondary">Loading meetings...</p>
        </div>
      )}

      {/* Content Area */}
      {!loading && meetings.length > 0 && (
        <div className="space-y-4">
          {meetings.map((meeting) => {
            const typeInfo = getMeetingTypeInfo(meeting.meeting_type);
            return (
              <div
                key={meeting.id}
                className="bg-theme-surface backdrop-blur-sm rounded-lg p-5 border border-theme-surface-border hover:border-white/30 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-theme-text-primary font-semibold text-lg truncate">{meeting.title}</h3>
                      <span className={`px-2 py-0.5 text-xs rounded border ${typeInfo.color}`}>
                        {typeInfo.label}
                      </span>
                      {meeting.status && (
                        <span className={`px-2 py-0.5 text-xs rounded ${
                          meeting.status === 'approved'
                            ? 'bg-green-500/10 text-green-700 border border-green-500/30'
                            : meeting.status === 'draft'
                            ? 'bg-slate-500/10 text-theme-text-muted border border-slate-500/30'
                            : 'bg-yellow-500/10 text-yellow-700 border border-yellow-500/30'
                        }`}>
                          {meeting.status.charAt(0).toUpperCase() + meeting.status.slice(1)}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-theme-text-muted">
                      {meeting.meeting_date && (
                        <div className="flex items-center space-x-1">
                          <Calendar className="w-4 h-4" />
                          <span>{meeting.meeting_date}</span>
                          {meeting.start_time && (
                            <span>at {meeting.start_time.slice(0, 5)}</span>
                          )}
                        </div>
                      )}
                      {meeting.location && (
                        <div className="flex items-center space-x-1">
                          <MapPin className="w-4 h-4" />
                          <span>{meeting.location}</span>
                        </div>
                      )}
                      {meeting.called_by && (
                        <div className="flex items-center space-x-1">
                          <User className="w-4 h-4" />
                          <span>Called by {meeting.called_by}</span>
                        </div>
                      )}
                    </div>
                    {meeting.notes && (
                      <p className="text-theme-text-secondary text-sm mt-2 line-clamp-2">{meeting.notes}</p>
                    )}
                    <div className="flex items-center gap-4 mt-3 text-xs text-theme-text-muted">
                      <span>{meeting.attendee_count} attendee{meeting.attendee_count !== 1 ? 's' : ''}</span>
                      <span>{meeting.action_item_count} action item{meeting.action_item_count !== 1 ? 's' : ''}</span>
                      {meeting.creator_name && <span>Created by {meeting.creator_name}</span>}
                    </div>
                    {/* Waivers Toggle */}
                    {canManage && (
                      <button
                        onClick={() => handleToggleWaivers(meeting.id)}
                        className="flex items-center gap-1.5 mt-3 text-xs text-theme-text-muted hover:text-theme-text-primary transition-colors"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Attendance Waivers</span>
                        {expandedWaivers === meeting.id ? (
                          <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                      </button>
                    )}
                  </div>
                  {canManage && (
                    <button
                      onClick={() => handleDeleteMeeting(meeting.id)}
                      disabled={deletingId === meeting.id}
                      className="ml-4 p-2 text-theme-text-muted hover:text-red-700  hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                      title="Delete meeting"
                    >
                      {deletingId === meeting.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>

                {/* Waivers Section */}
                {expandedWaivers === meeting.id && (
                  <div className="mt-4 pt-4 border-t border-theme-surface-border">
                    <h4 className="text-sm font-medium text-theme-text-primary mb-3 flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                      Attendance Waivers
                    </h4>
                    {loadingWaivers === meeting.id ? (
                      <div className="flex items-center gap-2 py-3 text-theme-text-muted text-sm">
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        Loading waivers...
                      </div>
                    ) : waivers[meeting.id]?.length === 0 ? (
                      <p className="text-sm text-theme-text-muted py-2">No attendance waivers for this meeting.</p>
                    ) : (
                      <div className="space-y-2">
                        {waivers[meeting.id]?.map((waiver, wIdx) => (
                          <div key={wIdx} className="bg-theme-surface rounded-lg p-3 border border-theme-surface-border text-sm">
                            <div className="flex items-center justify-between">
                              <span className="text-theme-text-primary font-medium">
                                {String(waiver.user_name || waiver.user_id || 'Unknown')}
                              </span>
                              <span className="px-2 py-0.5 text-xs rounded-full bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400">
                                Waived
                              </span>
                            </div>
                            {waiver.reason ? (
                              <p className="text-xs text-theme-text-muted mt-1">
                                Reason: {String(waiver.reason)}
                              </p>
                            ) : null}
                            {waiver.granted_by_name ? (
                              <p className="text-xs text-theme-text-muted mt-0.5">
                                Granted by: {String(waiver.granted_by_name)}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Empty State - Feature Cards (shown when no meetings exist and not loading) */}
      {!loading && meetings.length === 0 && !error && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6 border border-theme-surface-border">
              <ClipboardList className="w-8 h-8 text-cyan-700 mb-4" />
              <h3 className="text-theme-text-primary font-semibold text-lg mb-2">Record Minutes</h3>
              <p className="text-theme-text-secondary text-sm mb-3">
                Structured templates for recording meeting minutes with attendees, motions, and votes.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <span className="px-2 py-0.5 text-xs bg-cyan-500/10 text-cyan-700 rounded">Roll Call</span>
                <span className="px-2 py-0.5 text-xs bg-cyan-500/10 text-cyan-700 rounded">Motions</span>
                <span className="px-2 py-0.5 text-xs bg-cyan-500/10 text-cyan-700 rounded">Votes</span>
              </div>
            </div>
            <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6 border border-theme-surface-border">
              <CheckSquare className="w-8 h-8 text-green-700 mb-4" />
              <h3 className="text-theme-text-primary font-semibold text-lg mb-2">Action Items</h3>
              <p className="text-theme-text-secondary text-sm mb-3">
                Track action items from meetings with assignees, due dates, and completion status.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <span className="px-2 py-0.5 text-xs bg-green-500/10 text-green-700 rounded">Assignees</span>
                <span className="px-2 py-0.5 text-xs bg-green-500/10 text-green-700 rounded">Due Dates</span>
                <span className="px-2 py-0.5 text-xs bg-green-500/10 text-green-700 rounded">Follow-up</span>
              </div>
            </div>
            <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6 border border-theme-surface-border">
              <Archive className="w-8 h-8 text-amber-700 mb-4" />
              <h3 className="text-theme-text-primary font-semibold text-lg mb-2">Archives & Search</h3>
              <p className="text-theme-text-secondary text-sm mb-3">
                Full-text search across all meeting minutes for compliance and quick reference.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <span className="px-2 py-0.5 text-xs bg-amber-500/10 text-amber-700 rounded">Full-text Search</span>
                <span className="px-2 py-0.5 text-xs bg-amber-500/10 text-amber-700 rounded">PDF Export</span>
              </div>
            </div>
          </div>

          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-12 border border-theme-surface-border text-center">
            <FileSearch className="w-16 h-16 text-theme-text-muted mx-auto mb-4" />
            <h3 className="text-theme-text-primary text-xl font-bold mb-2">No Meeting Minutes</h3>
            <p className="text-theme-text-secondary mb-6">
              Start recording meeting minutes to maintain your organization's history.
            </p>
            {canManage && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-6 py-3 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg transition-colors inline-flex items-center space-x-2"
              >
                <Plus className="w-5 h-5" />
                <span>Record First Minutes</span>
              </button>
            )}
          </div>
        </>
      )}

      {/* Create Minutes Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-black/60" onClick={() => setShowCreateModal(false)} />
            <div className="relative bg-theme-surface rounded-lg shadow-xl max-w-2xl w-full border border-theme-surface-border">
              <div className="px-6 pt-5 pb-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-medium text-theme-text-primary">Record Meeting Minutes</h3>
                  <button onClick={() => setShowCreateModal(false)} className="text-theme-text-muted hover:text-theme-text-primary">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {createError && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
                    <div className="flex items-center space-x-2">
                      <AlertCircle className="w-4 h-4 text-red-700 flex-shrink-0" />
                      <p className="text-red-300 text-sm">{createError}</p>
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label htmlFor="meeting-title" className="block text-sm font-medium text-theme-text-secondary mb-1">Meeting Title <span aria-hidden="true">*</span></label>
                    <input
                      id="meeting-title"
                      type="text"
                      required
                      value={minutesForm.title}
                      onChange={(e) => setMinutesForm({ ...minutesForm, title: e.target.value })}
                      className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      placeholder="e.g., Regular Business Meeting - February 2026"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="meeting-type" className="block text-sm font-medium text-theme-text-secondary mb-1">Meeting Type</label>
                      <select
                        id="meeting-type"
                        value={minutesForm.meetingType}
                        onChange={(e) => setMinutesForm({ ...minutesForm, meetingType: e.target.value as MeetingType })}
                        className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      >
                        {MEETING_TYPES.map(t => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="called-by" className="block text-sm font-medium text-theme-text-secondary mb-1">Called By</label>
                      <input
                        id="called-by"
                        type="text"
                        value={minutesForm.calledBy}
                        onChange={(e) => setMinutesForm({ ...minutesForm, calledBy: e.target.value })}
                        className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
                        placeholder="e.g., Chief Johnson"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="meeting-date" className="block text-sm font-medium text-theme-text-secondary mb-1">Meeting Date</label>
                      <input
                        id="meeting-date"
                        type="date"
                        value={minutesForm.meetingDate}
                        onChange={(e) => setMinutesForm({ ...minutesForm, meetingDate: e.target.value })}
                        className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      />
                    </div>
                    <div>
                      <label htmlFor="meeting-time" className="block text-sm font-medium text-theme-text-secondary mb-1">Meeting Time</label>
                      <input
                        id="meeting-time"
                        type="time"
                        value={minutesForm.meetingTime}
                        onChange={(e) => setMinutesForm({ ...minutesForm, meetingTime: e.target.value })}
                        className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="meeting-location" className="block text-sm font-medium text-theme-text-secondary mb-1">Location</label>
                    <input
                      id="meeting-location"
                      type="text"
                      value={minutesForm.location}
                      onChange={(e) => setMinutesForm({ ...minutesForm, location: e.target.value })}
                      className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      placeholder="e.g., Station 1 Meeting Room"
                    />
                  </div>

                  <div>
                    <label htmlFor="meeting-notes" className="block text-sm font-medium text-theme-text-secondary mb-1">Initial Notes</label>
                    <textarea
                      id="meeting-notes"
                      rows={4}
                      value={minutesForm.notes}
                      onChange={(e) => setMinutesForm({ ...minutesForm, notes: e.target.value })}
                      className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      placeholder="Meeting opened at... Roll call taken... Old business..."
                    />
                  </div>
                </div>
              </div>
              <div className="bg-theme-input-bg px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-input-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateMeeting}
                  disabled={creating || !minutesForm.title.trim()}
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{creating ? 'Creating...' : 'Start Recording'}</span>
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

export default MinutesPage;
