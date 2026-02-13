import React, { useState, useEffect } from 'react';
import {
  ClipboardList,
  FileSearch,
  Plus,
  Search,
  X,
  AlertCircle,
  Trash2,
  Calendar,
  MapPin,
  User,
  Loader2,
  CheckSquare,
  Archive,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { meetingsService } from '../services/api';
import type { MeetingRecord, MeetingsSummary } from '../services/api';

type MeetingType = 'business' | 'special' | 'committee' | 'board' | 'trustee' | 'executive' | 'annual' | 'other';

const MEETING_TYPES: { value: MeetingType; label: string; color: string }[] = [
  { value: 'business', label: 'Business Meeting', color: 'bg-cyan-100 text-cyan-800' },
  { value: 'special', label: 'Special Meeting', color: 'bg-purple-100 text-purple-800' },
  { value: 'committee', label: 'Committee Meeting', color: 'bg-blue-100 text-blue-800' },
  { value: 'board', label: 'Board Meeting', color: 'bg-amber-100 text-amber-800' },
  { value: 'trustee', label: 'Trustee Meeting', color: 'bg-emerald-100 text-emerald-800' },
  { value: 'executive', label: 'Executive Meeting', color: 'bg-indigo-100 text-indigo-800' },
  { value: 'annual', label: 'Annual Meeting', color: 'bg-rose-100 text-rose-800' },
  { value: 'other', label: 'Other', color: 'bg-gray-100 text-gray-800' },
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

  // -------------------------------------------------------
  // Render
  // -------------------------------------------------------

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center space-x-3">
          <div className="bg-cyan-600 rounded-lg p-2">
            <ClipboardList className="w-6 h-6 text-white" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Meeting Minutes</h1>
            <p className="text-slate-400 text-sm">
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
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
          <p className="text-slate-400 text-xs font-medium uppercase">Total Minutes</p>
          <p className="text-white text-2xl font-bold mt-1">{summary?.total_meetings ?? 0}</p>
        </div>
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
          <p className="text-slate-400 text-xs font-medium uppercase">This Month</p>
          <p className="text-cyan-400 text-2xl font-bold mt-1">{summary?.meetings_this_month ?? 0}</p>
        </div>
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
          <p className="text-slate-400 text-xs font-medium uppercase">Open Action Items</p>
          <p className="text-yellow-400 text-2xl font-bold mt-1">{summary?.open_action_items ?? 0}</p>
        </div>
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
          <p className="text-slate-400 text-xs font-medium uppercase">Pending Approval</p>
          <p className="text-orange-400 text-2xl font-bold mt-1">{summary?.pending_approval ?? 0}</p>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20 mb-6">
        <div className="flex flex-col md:flex-row items-center gap-4">
          <div className="relative flex-1 w-full md:max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" aria-hidden="true" />
            <label htmlFor="minutes-search" className="sr-only">Search meetings</label>
            <input
              id="minutes-search"
              type="text"
              placeholder="Search meeting minutes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div>
            <label htmlFor="type-filter" className="sr-only">Filter by meeting type</label>
            <select
              id="type-filter"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
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
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <p className="text-red-300 text-sm">{error}</p>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
          <Loader2 className="w-10 h-10 text-cyan-400 mx-auto mb-4 animate-spin" />
          <p className="text-slate-300">Loading meetings...</p>
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
                className="bg-white/10 backdrop-blur-sm rounded-lg p-5 border border-white/20 hover:border-white/30 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-white font-semibold text-lg truncate">{meeting.title}</h3>
                      <span className={`px-2 py-0.5 text-xs rounded border ${typeInfo.color}`}>
                        {typeInfo.label}
                      </span>
                      {meeting.status && (
                        <span className={`px-2 py-0.5 text-xs rounded ${
                          meeting.status === 'approved'
                            ? 'bg-green-500/10 text-green-400 border border-green-500/30'
                            : meeting.status === 'draft'
                            ? 'bg-slate-500/10 text-slate-400 border border-slate-500/30'
                            : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/30'
                        }`}>
                          {meeting.status.charAt(0).toUpperCase() + meeting.status.slice(1)}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-slate-400">
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
                      <p className="text-slate-300 text-sm mt-2 line-clamp-2">{meeting.notes}</p>
                    )}
                    <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
                      <span>{meeting.attendee_count} attendee{meeting.attendee_count !== 1 ? 's' : ''}</span>
                      <span>{meeting.action_item_count} action item{meeting.action_item_count !== 1 ? 's' : ''}</span>
                      {meeting.creator_name && <span>Created by {meeting.creator_name}</span>}
                    </div>
                  </div>
                  {canManage && (
                    <button
                      onClick={() => handleDeleteMeeting(meeting.id)}
                      disabled={deletingId === meeting.id}
                      className="ml-4 p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
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
              </div>
            );
          })}
        </div>
      )}

      {/* Empty State - Feature Cards (shown when no meetings exist and not loading) */}
      {!loading && meetings.length === 0 && !error && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
              <ClipboardList className="w-8 h-8 text-cyan-400 mb-4" />
              <h3 className="text-white font-semibold text-lg mb-2">Record Minutes</h3>
              <p className="text-slate-300 text-sm mb-3">
                Structured templates for recording meeting minutes with attendees, motions, and votes.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <span className="px-2 py-0.5 text-xs bg-cyan-500/10 text-cyan-400 rounded">Roll Call</span>
                <span className="px-2 py-0.5 text-xs bg-cyan-500/10 text-cyan-400 rounded">Motions</span>
                <span className="px-2 py-0.5 text-xs bg-cyan-500/10 text-cyan-400 rounded">Votes</span>
              </div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
              <CheckSquare className="w-8 h-8 text-green-400 mb-4" />
              <h3 className="text-white font-semibold text-lg mb-2">Action Items</h3>
              <p className="text-slate-300 text-sm mb-3">
                Track action items from meetings with assignees, due dates, and completion status.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <span className="px-2 py-0.5 text-xs bg-green-500/10 text-green-400 rounded">Assignees</span>
                <span className="px-2 py-0.5 text-xs bg-green-500/10 text-green-400 rounded">Due Dates</span>
                <span className="px-2 py-0.5 text-xs bg-green-500/10 text-green-400 rounded">Follow-up</span>
              </div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
              <Archive className="w-8 h-8 text-amber-400 mb-4" />
              <h3 className="text-white font-semibold text-lg mb-2">Archives & Search</h3>
              <p className="text-slate-300 text-sm mb-3">
                Full-text search across all meeting minutes for compliance and quick reference.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <span className="px-2 py-0.5 text-xs bg-amber-500/10 text-amber-400 rounded">Full-text Search</span>
                <span className="px-2 py-0.5 text-xs bg-amber-500/10 text-amber-400 rounded">PDF Export</span>
              </div>
            </div>
          </div>

          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
            <FileSearch className="w-16 h-16 text-slate-500 mx-auto mb-4" />
            <h3 className="text-white text-xl font-bold mb-2">No Meeting Minutes</h3>
            <p className="text-slate-300 mb-6">
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
            <div className="relative bg-slate-800 rounded-lg shadow-xl max-w-2xl w-full border border-white/20">
              <div className="px-6 pt-5 pb-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-medium text-white">Record Meeting Minutes</h3>
                  <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {createError && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
                    <div className="flex items-center space-x-2">
                      <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                      <p className="text-red-300 text-sm">{createError}</p>
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label htmlFor="meeting-title" className="block text-sm font-medium text-slate-300 mb-1">Meeting Title <span aria-hidden="true">*</span></label>
                    <input
                      id="meeting-title"
                      type="text"
                      required
                      value={minutesForm.title}
                      onChange={(e) => setMinutesForm({ ...minutesForm, title: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      placeholder="e.g., Regular Business Meeting - February 2026"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="meeting-type" className="block text-sm font-medium text-slate-300 mb-1">Meeting Type</label>
                      <select
                        id="meeting-type"
                        value={minutesForm.meetingType}
                        onChange={(e) => setMinutesForm({ ...minutesForm, meetingType: e.target.value as MeetingType })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      >
                        {MEETING_TYPES.map(t => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="called-by" className="block text-sm font-medium text-slate-300 mb-1">Called By</label>
                      <input
                        id="called-by"
                        type="text"
                        value={minutesForm.calledBy}
                        onChange={(e) => setMinutesForm({ ...minutesForm, calledBy: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                        placeholder="e.g., Chief Johnson"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="meeting-date" className="block text-sm font-medium text-slate-300 mb-1">Meeting Date</label>
                      <input
                        id="meeting-date"
                        type="date"
                        value={minutesForm.meetingDate}
                        onChange={(e) => setMinutesForm({ ...minutesForm, meetingDate: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      />
                    </div>
                    <div>
                      <label htmlFor="meeting-time" className="block text-sm font-medium text-slate-300 mb-1">Meeting Time</label>
                      <input
                        id="meeting-time"
                        type="time"
                        value={minutesForm.meetingTime}
                        onChange={(e) => setMinutesForm({ ...minutesForm, meetingTime: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="meeting-location" className="block text-sm font-medium text-slate-300 mb-1">Location</label>
                    <input
                      id="meeting-location"
                      type="text"
                      value={minutesForm.location}
                      onChange={(e) => setMinutesForm({ ...minutesForm, location: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      placeholder="e.g., Station 1 Meeting Room"
                    />
                  </div>

                  <div>
                    <label htmlFor="meeting-notes" className="block text-sm font-medium text-slate-300 mb-1">Initial Notes</label>
                    <textarea
                      id="meeting-notes"
                      rows={4}
                      value={minutesForm.notes}
                      onChange={(e) => setMinutesForm({ ...minutesForm, notes: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      placeholder="Meeting opened at... Roll call taken... Old business..."
                    />
                  </div>
                </div>
              </div>
              <div className="bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-slate-600 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors"
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
  );
};

export default MinutesPage;
