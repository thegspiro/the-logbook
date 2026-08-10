import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  BookOpen,
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
  ShieldCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useAuthStore } from '../../../stores/authStore';
import { useNavigate } from 'react-router';
import { meetingsService } from '../../../services/api';
import type { MeetingRecord, MeetingsSummary } from '../../../services/api';
import { minutesService } from '../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { toDisplayString } from '../../../utils/displayValue';
import type { MeetingType } from '../types/minutes';
import TimeQuarterHour from '../../../components/ux/TimeQuarterHour';
import { asArray } from '../../../utils/asArray';

const MEETING_TYPES: { value: MeetingType; label: string; color: string }[] = [
  {
    value: 'business',
    label: 'Business Meeting',
    color: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-400',
  },
  {
    value: 'special',
    label: 'Special Meeting',
    color: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-400',
  },
  {
    value: 'committee',
    label: 'Committee Meeting',
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
  },
  {
    value: 'board',
    label: 'Board Meeting',
    color: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-400',
  },
  {
    value: 'trustee',
    label: 'Trustee Meeting',
    color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-400',
  },
  {
    value: 'executive',
    label: 'Executive Meeting',
    color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-400',
  },
  {
    value: 'annual',
    label: 'Annual Meeting',
    color: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-400',
  },
  { value: 'other', label: 'Other', color: 'bg-theme-surface-secondary text-theme-text-primary' },
];

const MinutesPage: React.FC = () => {
  const navigate = useNavigate();
  const { checkPermission } = useAuthStore();
  // MM-3: minutes writes and restricted reads are gated on minutes.manage on
  // the backend, not meetings.manage — check the same permission the API does.
  const canManage = checkPermission('minutes.manage');

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

  const fetchData = useCallback(async () => {
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
      setMeetings(asArray(meetingsRes.meetings));
      setSummary(summaryRes);
    } catch {
      setError('Unable to load meetings. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [typeFilter, searchQuery]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

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
    return (
      MEETING_TYPES.find((t) => t.value === type) ??
      MEETING_TYPES[MEETING_TYPES.length - 1] ?? {
        value: 'other' as MeetingType,
        label: 'Other',
        color: 'bg-theme-surface-secondary text-theme-text-primary',
      }
    );
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
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="rounded-lg bg-cyan-600 p-2">
              <ClipboardList className="h-6 w-6 text-white" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-2xl font-bold">Meeting Minutes</h1>
              <p className="text-theme-text-muted text-sm">
                Record meeting minutes, track action items, and maintain organizational history
              </p>
            </div>
          </div>
          {canManage && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center space-x-2 rounded-lg bg-cyan-600 px-4 py-2 text-white transition-colors hover:bg-cyan-700"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Record Minutes</span>
            </button>
          )}
        </div>

        {/* Quick Stats */}
        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Total Minutes</p>
            <p className="text-theme-text-primary mt-1 text-2xl font-bold">{summary?.total_meetings ?? 0}</p>
          </div>
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">This Month</p>
            <p className="mt-1 text-2xl font-bold text-cyan-700">{summary?.meetings_this_month ?? 0}</p>
          </div>
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Open Action Items</p>
            <p className="mt-1 text-2xl font-bold text-yellow-700">{summary?.open_action_items ?? 0}</p>
          </div>
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Pending Approval</p>
            <p className="mt-1 text-2xl font-bold text-orange-700">{summary?.pending_approval ?? 0}</p>
          </div>
        </div>

        {/* Search & Filter */}
        <div className="card mb-6 p-4">
          <div className="flex flex-col items-center gap-4 md:flex-row">
            <div className="relative w-full flex-1 md:max-w-md">
              <Search
                className="text-theme-text-muted absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 transform"
                aria-hidden="true"
              />
              <label htmlFor="minutes-search" className="sr-only">
                Search meetings
              </label>
              <input
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                id="minutes-search"
                type="text"
                aria-label="Search meeting minutes..."
                placeholder="Search meeting minutes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="form-input placeholder-theme-text-muted pr-4 pl-10"
              />
            </div>
            <div>
              <label htmlFor="type-filter" className="sr-only">
                Filter by meeting type
              </label>
              <select
                id="type-filter"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="form-input"
              >
                <option value="all">All Types</option>
                {MEETING_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
            <div className="flex items-center space-x-2">
              <AlertCircle className="h-5 w-5 shrink-0 text-red-700" />
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
              <button onClick={() => setError(null)} className="ml-auto text-red-700 hover:text-red-600">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="card p-12 text-center" role="status" aria-live="polite">
            <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-cyan-700" />
            <p className="text-theme-text-secondary">Loading meetings...</p>
          </div>
        )}

        {/* Content Area */}
        {!loading && meetings.length > 0 && (
          <div className="space-y-4">
            {meetings.map((meeting) => {
              const typeInfo = getMeetingTypeInfo(meeting.meeting_type);
              return (
                <div key={meeting.id} className="stat-card hover:border-theme-text-muted/40 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-center gap-3">
                        <h3 className="text-theme-text-primary truncate text-lg font-semibold">{meeting.title}</h3>
                        <span className={`rounded-sm border px-2 py-0.5 text-xs ${typeInfo?.color}`}>
                          {typeInfo?.label}
                        </span>
                        {meeting.status && (
                          <span
                            className={`rounded px-2 py-0.5 text-xs ${
                              meeting.status === 'approved'
                                ? 'border border-green-500/30 bg-green-500/10 text-green-700'
                                : meeting.status === 'draft'
                                  ? 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border border'
                                  : 'border border-yellow-500/30 bg-yellow-500/10 text-yellow-700'
                            }`}
                          >
                            {meeting.status.charAt(0).toUpperCase() + meeting.status.slice(1)}
                          </span>
                        )}
                      </div>
                      <div className="text-theme-text-muted flex flex-wrap items-center gap-4 text-sm">
                        {meeting.meeting_date && (
                          <div className="flex items-center space-x-1">
                            <Calendar className="h-4 w-4" />
                            <span>{meeting.meeting_date}</span>
                            {meeting.start_time && <span>at {meeting.start_time.slice(0, 5)}</span>}
                          </div>
                        )}
                        {meeting.location && (
                          <div className="flex items-center space-x-1">
                            <MapPin className="h-4 w-4" />
                            <span>{meeting.location}</span>
                          </div>
                        )}
                        {meeting.called_by && (
                          <div className="flex items-center space-x-1">
                            <User className="h-4 w-4" />
                            <span>Called by {meeting.called_by}</span>
                          </div>
                        )}
                      </div>
                      {meeting.notes && (
                        <p className="text-theme-text-secondary mt-2 line-clamp-2 text-sm">{meeting.notes}</p>
                      )}
                      <div className="text-theme-text-muted mt-3 flex items-center gap-4 text-xs">
                        <span>
                          {meeting.attendee_count} attendee{meeting.attendee_count !== 1 ? 's' : ''}
                        </span>
                        <span>
                          {meeting.action_item_count} action item{meeting.action_item_count !== 1 ? 's' : ''}
                        </span>
                        {meeting.creator_name && <span>Created by {meeting.creator_name}</span>}
                      </div>
                      {/* Waivers Toggle */}
                      {canManage && (
                        <button
                          onClick={() => {
                            void handleToggleWaivers(meeting.id);
                          }}
                          className="text-theme-text-muted hover:text-theme-text-primary mt-3 flex items-center gap-1.5 text-xs transition-colors"
                        >
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Attendance Waivers</span>
                          {expandedWaivers === meeting.id ? (
                            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                        </button>
                      )}
                    </div>
                    {canManage && (
                      <div className="ml-4 flex items-center gap-1">
                        <button
                          onClick={() => {
                            void (async () => {
                              try {
                                const minutes = await minutesService.createFromMeeting(meeting.id);
                                toast.success('Minutes created from meeting');
                                void navigate(`/minutes/${minutes.id}`);
                              } catch {
                                toast.error('Failed to create minutes from meeting');
                              }
                            })();
                          }}
                          className="text-theme-text-muted rounded-lg p-2 transition-colors hover:bg-cyan-500/10 hover:text-cyan-800 dark:hover:text-cyan-400"
                          title="Create minutes from this meeting"
                        >
                          <BookOpen className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            void handleDeleteMeeting(meeting.id);
                          }}
                          disabled={deletingId === meeting.id}
                          className="text-theme-text-muted rounded-lg p-2 transition-colors hover:bg-red-500/10 hover:text-red-700 disabled:opacity-50"
                          title="Delete meeting"
                        >
                          {deletingId === meeting.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Waivers Section */}
                  {expandedWaivers === meeting.id && (
                    <div className="border-theme-surface-border mt-4 border-t pt-4">
                      <h4 className="text-theme-text-primary mb-3 flex items-center gap-2 text-sm font-medium">
                        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                        Attendance Waivers
                      </h4>
                      {loadingWaivers === meeting.id ? (
                        <div
                          className="text-theme-text-muted flex items-center gap-2 py-3 text-sm"
                          role="status"
                          aria-live="polite"
                        >
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          Loading waivers...
                        </div>
                      ) : waivers[meeting.id]?.length === 0 ? (
                        <p className="text-theme-text-muted py-2 text-sm">No attendance waivers for this meeting.</p>
                      ) : (
                        <div className="space-y-2">
                          {waivers[meeting.id]?.map((waiver, wIdx) => (
                            <div
                              key={wIdx}
                              className="bg-theme-surface border-theme-surface-border rounded-lg border p-3 text-sm"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-theme-text-primary font-medium">
                                  {toDisplayString(waiver.user_name ?? waiver.user_id ?? 'Unknown')}
                                </span>
                                <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-700 dark:bg-green-500/20 dark:text-green-400">
                                  Waived
                                </span>
                              </div>
                              {waiver.reason ? (
                                <p className="text-theme-text-muted mt-1 text-xs">
                                  Reason: {toDisplayString(waiver.reason)}
                                </p>
                              ) : null}
                              {waiver.granted_by_name ? (
                                <p className="text-theme-text-muted mt-0.5 text-xs">
                                  Granted by: {toDisplayString(waiver.granted_by_name)}
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
            <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
              <div className="card p-6">
                <ClipboardList className="mb-4 h-8 w-8 text-cyan-700" />
                <h3 className="text-theme-text-primary mb-2 text-lg font-semibold">Record Minutes</h3>
                <p className="text-theme-text-secondary mb-3 text-sm">
                  Structured templates for recording meeting minutes with attendees, motions, and votes.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded-sm bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-700">Roll Call</span>
                  <span className="rounded-sm bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-700">Motions</span>
                  <span className="rounded-sm bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-700">Votes</span>
                </div>
              </div>
              <div className="card p-6">
                <CheckSquare className="mb-4 h-8 w-8 text-green-700" />
                <h3 className="text-theme-text-primary mb-2 text-lg font-semibold">Action Items</h3>
                <p className="text-theme-text-secondary mb-3 text-sm">
                  Track action items from meetings with assignees, due dates, and completion status.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded-sm bg-green-500/10 px-2 py-0.5 text-xs text-green-700">Assignees</span>
                  <span className="rounded-sm bg-green-500/10 px-2 py-0.5 text-xs text-green-700">Due Dates</span>
                  <span className="rounded-sm bg-green-500/10 px-2 py-0.5 text-xs text-green-700">Follow-up</span>
                </div>
              </div>
              <div className="card p-6">
                <Archive className="mb-4 h-8 w-8 text-amber-700" />
                <h3 className="text-theme-text-primary mb-2 text-lg font-semibold">Archives & Search</h3>
                <p className="text-theme-text-secondary mb-3 text-sm">
                  Full-text search across all meeting minutes for compliance and quick reference.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded-sm bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700">
                    Full-text Search
                  </span>
                  <span className="rounded-sm bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700">PDF Export</span>
                </div>
              </div>
            </div>

            <div className="card p-12 text-center">
              <FileSearch className="text-theme-text-muted mx-auto mb-4 h-16 w-16" />
              <h3 className="text-theme-text-primary mb-2 text-xl font-bold">No Meeting Minutes</h3>
              <p className="text-theme-text-secondary mb-6">
                Start recording meeting minutes to maintain your organization's history.
              </p>
              {canManage && (
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="inline-flex items-center space-x-2 rounded-lg bg-cyan-600 px-6 py-3 text-white transition-colors hover:bg-cyan-700"
                >
                  <Plus className="h-5 w-5" />
                  <span>Record First Minutes</span>
                </button>
              )}
            </div>
          </>
        )}

        {/* Create Minutes Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex min-h-screen items-center justify-center px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowCreateModal(false)} aria-hidden="true" />
              <div className="bg-theme-surface-modal border-theme-surface-border relative w-full max-w-2xl rounded-lg border shadow-xl">
                <div className="px-6 pt-5 pb-4">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-theme-text-primary text-lg font-medium">Record Meeting Minutes</h3>
                    <button
                      onClick={() => setShowCreateModal(false)}
                      className="text-theme-text-muted hover:text-theme-text-primary"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  {createError && (
                    <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                      <div className="flex items-center space-x-2">
                        <AlertCircle className="h-4 w-4 shrink-0 text-red-700" />
                        <p className="text-sm text-red-700 dark:text-red-300">{createError}</p>
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div>
                      <label
                        htmlFor="meeting-title"
                        className="text-theme-text-secondary mb-1 block text-sm font-medium"
                      >
                        Meeting Title <span aria-hidden="true">*</span>
                      </label>
                      <input
                        id="meeting-title"
                        type="text"
                        required
                        value={minutesForm.title}
                        onChange={(e) => setMinutesForm({ ...minutesForm, title: e.target.value })}
                        className="form-input"
                        placeholder="e.g., Regular Business Meeting - February 2026"
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor="meeting-type"
                          className="text-theme-text-secondary mb-1 block text-sm font-medium"
                        >
                          Meeting Type
                        </label>
                        <select
                          id="meeting-type"
                          value={minutesForm.meetingType}
                          onChange={(e) =>
                            setMinutesForm({ ...minutesForm, meetingType: e.target.value as MeetingType })
                          }
                          className="form-input"
                        >
                          {MEETING_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="called-by" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                          Called By
                        </label>
                        <input
                          id="called-by"
                          type="text"
                          value={minutesForm.calledBy}
                          onChange={(e) => setMinutesForm({ ...minutesForm, calledBy: e.target.value })}
                          className="form-input"
                          placeholder="e.g., Chief Johnson"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor="meeting-date"
                          className="text-theme-text-secondary mb-1 block text-sm font-medium"
                        >
                          Meeting Date
                        </label>
                        <input
                          id="meeting-date"
                          type="date"
                          value={minutesForm.meetingDate}
                          onChange={(e) => setMinutesForm({ ...minutesForm, meetingDate: e.target.value })}
                          className="form-input"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="meeting-time"
                          className="text-theme-text-secondary mb-1 block text-sm font-medium"
                        >
                          Meeting Time
                        </label>
                        <TimeQuarterHour
                          id="meeting-time"
                          value={minutesForm.meetingTime}
                          onChange={(e) => setMinutesForm({ ...minutesForm, meetingTime: e.target.value })}
                          className="form-input"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="meeting-location"
                        className="text-theme-text-secondary mb-1 block text-sm font-medium"
                      >
                        Location
                      </label>
                      <input
                        id="meeting-location"
                        type="text"
                        value={minutesForm.location}
                        onChange={(e) => setMinutesForm({ ...minutesForm, location: e.target.value })}
                        className="form-input"
                        placeholder="e.g., Station 1 Meeting Room"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="meeting-notes"
                        className="text-theme-text-secondary mb-1 block text-sm font-medium"
                      >
                        Initial Notes
                      </label>
                      <textarea
                        id="meeting-notes"
                        rows={4}
                        value={minutesForm.notes}
                        onChange={(e) => setMinutesForm({ ...minutesForm, notes: e.target.value })}
                        className="form-input"
                        placeholder="Meeting opened at... Roll call taken... Old business..."
                      />
                    </div>
                  </div>
                </div>
                <div className="bg-theme-input-bg flex justify-end space-x-3 rounded-b-lg px-6 py-3">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="border-theme-input-border text-theme-text-secondary hover:bg-theme-input-bg rounded-lg border px-4 py-2 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      void handleCreateMeeting();
                    }}
                    disabled={creating || !minutesForm.title.trim()}
                    className="flex items-center space-x-2 rounded-lg bg-cyan-600 px-4 py-2 text-white transition-colors hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creating && <Loader2 className="h-4 w-4 animate-spin" />}
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
