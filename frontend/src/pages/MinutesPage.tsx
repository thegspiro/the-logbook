import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ClipboardList,
  FileSearch,
  Plus,
  Search,
  Filter,
  X,
  Clock,
  AlertCircle,
  FileText,
  LayoutTemplate,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { minutesService, eventService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import type {
  MinutesListItem,
  MinutesStats,
  MeetingType,
  MinutesSearchResult,
  TemplateListItem,
} from '../types/minutes';
import type { EventListItem } from '../types/event';

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

const STATUS_BADGES: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800',
  submitted: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};

const MinutesPage: React.FC = () => {
  const navigate = useNavigate();
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('meetings.manage');

  const [minutesList, setMinutesList] = useState<MinutesListItem[]>([]);
  const [stats, setStats] = useState<MinutesStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MinutesSearchResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [meetingEvents, setMeetingEvents] = useState<EventListItem[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  const [form, setForm] = useState({
    title: '',
    meetingType: 'business' as MeetingType,
    meetingDate: '',
    meetingTime: '',
    location: '',
    calledBy: '',
    notes: '',
    eventId: '',
    templateId: '',
  });

  useEffect(() => {
    fetchData();
  }, [typeFilter, statusFilter]);

  // Fetch meeting events and templates when create modal opens
  useEffect(() => {
    if (showCreateModal) {
      if (meetingEvents.length === 0) {
        setLoadingEvents(true);
        eventService.getEvents({ event_type: 'business_meeting' })
          .then(events => setMeetingEvents(events))
          .catch(() => {})
          .finally(() => setLoadingEvents(false));
      }
      if (templates.length === 0) {
        setLoadingTemplates(true);
        minutesService.listTemplates()
          .then(t => {
            setTemplates(t);
            // Auto-select default template for the selected meeting type
            const defaultTpl = t.find(tpl => tpl.meeting_type === form.meetingType && tpl.is_default);
            if (defaultTpl && !form.templateId) {
              setForm(prev => ({ ...prev, templateId: defaultTpl.id }));
            }
          })
          .catch(() => {})
          .finally(() => setLoadingTemplates(false));
      }
    }
  }, [showCreateModal]);

  // Update auto-selected template when meeting type changes
  useEffect(() => {
    if (templates.length > 0) {
      const defaultTpl = templates.find(t => t.meeting_type === form.meetingType && t.is_default);
      setForm(prev => ({ ...prev, templateId: defaultTpl?.id || '' }));
    }
  }, [form.meetingType, templates]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [list, statsData] = await Promise.all([
        minutesService.listMinutes({
          meeting_type: typeFilter !== 'all' ? typeFilter : undefined,
          status_filter: statusFilter !== 'all' ? statusFilter : undefined,
        }),
        minutesService.getStats(),
      ]);
      setMinutesList(list);
      setStats(statsData);
    } catch (err) {
      console.error('Error loading minutes:', err);
      toast.error('Failed to load meeting minutes');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (searchQuery.trim().length < 2) {
      setSearchResults(null);
      return;
    }

    try {
      setIsSearching(true);
      const results = await minutesService.search(searchQuery.trim());
      setSearchResults(results);
    } catch (err) {
      console.error('Error searching:', err);
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.trim().length >= 2) {
        handleSearch();
      } else {
        setSearchResults(null);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleCreate = async () => {
    if (!form.title.trim() || !form.meetingDate) {
      toast.error('Title and date are required');
      return;
    }

    try {
      setCreating(true);
      const meetingDate = form.meetingTime
        ? `${form.meetingDate}T${form.meetingTime}`
        : `${form.meetingDate}T00:00`;

      const created = await minutesService.createMinutes({
        title: form.title,
        meeting_type: form.meetingType,
        meeting_date: meetingDate,
        location: form.location || undefined,
        called_by: form.calledBy || undefined,
        event_id: form.eventId || undefined,
        template_id: form.templateId || undefined,
      });

      setShowCreateModal(false);
      setForm({ title: '', meetingType: 'business', meetingDate: '', meetingTime: '', location: '', calledBy: '', notes: '', eventId: '', templateId: '' });
      toast.success('Minutes created successfully');
      navigate(`/minutes/${created.id}`);
    } catch (err: any) {
      console.error('Error creating minutes:', err);
      toast.error(err.response?.data?.detail || 'Failed to create minutes');
    } finally {
      setCreating(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getMeetingTypeInfo = (type: string) => {
    return MEETING_TYPES.find(t => t.value === type) || MEETING_TYPES[MEETING_TYPES.length - 1];
  };

  const filteredTemplates = templates.filter(t => t.meeting_type === form.meetingType);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center space-x-3">
          <div className="bg-cyan-600 rounded-lg p-2">
            <ClipboardList className="w-6 h-6 text-white" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Meeting Minutes</h1>
            <p className="text-gray-500 text-sm">
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
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8" role="region" aria-label="Minutes statistics">
          <div className="bg-white shadow rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-xs font-medium uppercase">Total Minutes</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total}</p>
              </div>
              <FileText className="w-8 h-8 text-gray-300" aria-hidden="true" />
            </div>
          </div>
          <div className="bg-white shadow rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-xs font-medium uppercase">This Month</p>
                <p className="text-2xl font-bold text-cyan-600 mt-1">{stats.this_month}</p>
              </div>
              <ClipboardList className="w-8 h-8 text-cyan-200" aria-hidden="true" />
            </div>
          </div>
          <div className="bg-white shadow rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-xs font-medium uppercase">Open Action Items</p>
                <p className="text-2xl font-bold text-yellow-600 mt-1">{stats.open_action_items}</p>
              </div>
              <Clock className="w-8 h-8 text-yellow-200" aria-hidden="true" />
            </div>
          </div>
          <div className="bg-white shadow rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-xs font-medium uppercase">Pending Approval</p>
                <p className="text-2xl font-bold text-orange-600 mt-1">{stats.pending_approval}</p>
              </div>
              <AlertCircle className="w-8 h-8 text-orange-200" aria-hidden="true" />
            </div>
          </div>
        </div>
      )}

      {/* Search & Filters */}
      <div className="bg-white shadow rounded-lg p-4 mb-6" role="search" aria-label="Search and filter minutes">
        <div className="flex flex-col md:flex-row items-center gap-4">
          <div className="relative flex-1 w-full md:max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" aria-hidden="true" />
            <label htmlFor="minutes-search" className="sr-only">Search minutes</label>
            <input
              id="minutes-search"
              type="text"
              placeholder="Search minutes by title, content, or action item..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
            />
          </div>
          <div className="flex items-center space-x-2">
            <Filter className="w-5 h-5 text-gray-400" aria-hidden="true" />
            <label htmlFor="type-filter" className="sr-only">Filter by meeting type</label>
            <select
              id="type-filter"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            >
              <option value="all">All Types</option>
              {MEETING_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <label htmlFor="status-filter" className="sr-only">Filter by status</label>
            <select
              id="status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            >
              <option value="all">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        </div>

        {/* Search Results Dropdown */}
        {searchResults !== null && (
          <div className="mt-4 border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-700">
                Search Results ({searchResults.length})
              </h3>
              <button
                onClick={() => { setSearchQuery(''); setSearchResults(null); }}
                className="text-xs text-gray-500 hover:text-gray-700"
                aria-label="Clear search results"
              >
                Clear
              </button>
            </div>
            {isSearching ? (
              <p className="text-sm text-gray-500">Searching...</p>
            ) : searchResults.length === 0 ? (
              <p className="text-sm text-gray-500">No results found.</p>
            ) : (
              <div className="space-y-2">
                {searchResults.map(result => (
                  <Link
                    key={result.id}
                    to={`/minutes/${result.id}`}
                    className="block p-3 rounded-lg border border-gray-200 hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm text-gray-900">{result.title}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${STATUS_BADGES[result.status] || 'bg-gray-100 text-gray-800'}`}>
                        {result.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">
                      {formatDate(result.meeting_date)} &middot; Matched in: {result.match_field.replace('_', ' ')}
                    </p>
                    <p className="text-xs text-gray-600 mt-1 italic">&quot;{result.snippet}&quot;</p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Minutes List */}
      {loading ? (
        <div className="text-center py-12 text-gray-500" role="status" aria-live="polite">Loading minutes...</div>
      ) : minutesList.length === 0 ? (
        <div className="bg-white shadow rounded-lg p-12 text-center">
          <FileSearch className="w-16 h-16 text-gray-300 mx-auto mb-4" aria-hidden="true" />
          <h3 className="text-xl font-bold text-gray-900 mb-2">No Meeting Minutes</h3>
          <p className="text-gray-500 mb-6">
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
      ) : (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200" aria-label="Meeting minutes list">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Motions</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action Items</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {minutesList.map(m => {
                const typeInfo = getMeetingTypeInfo(m.meeting_type);
                return (
                  <tr
                    key={m.id}
                    className="hover:bg-gray-50 cursor-pointer focus-within:bg-gray-50"
                    onClick={() => navigate(`/minutes/${m.id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/minutes/${m.id}`); } }}
                    tabIndex={0}
                    role="link"
                    aria-label={`${m.title} - ${typeInfo.label} - ${m.status}`}
                  >
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">{m.title}</div>
                      {m.location && <div className="text-xs text-gray-500">{m.location}</div>}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2 py-1 rounded ${typeInfo.color}`}>
                        {typeInfo.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                      {formatDate(m.meeting_date)}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2 py-1 rounded font-medium ${STATUS_BADGES[m.status] || 'bg-gray-100 text-gray-800'}`}>
                        {m.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {m.motions_count}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className="text-gray-600">{m.action_items_count}</span>
                      {m.open_action_items > 0 && (
                        <span className="ml-1 text-xs text-yellow-600">
                          ({m.open_action_items} open)
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Minutes Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-minutes-title"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowCreateModal(false); }}
        >
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center sticky top-0 bg-white z-10">
              <h3 id="create-minutes-title" className="text-lg font-medium text-gray-900">Record Meeting Minutes</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600" aria-label="Close dialog">
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div>
                <label htmlFor="meeting-title" className="block text-sm font-medium text-gray-700 mb-1">Meeting Title <span aria-hidden="true">*</span></label>
                <input
                  id="meeting-title"
                  type="text"
                  required
                  aria-required="true"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="e.g., Regular Business Meeting - February 2026"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="meeting-type" className="block text-sm font-medium text-gray-700 mb-1">Meeting Type</label>
                  <select
                    id="meeting-type"
                    value={form.meetingType}
                    onChange={(e) => setForm({ ...form, meetingType: e.target.value as MeetingType })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  >
                    {MEETING_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="called-by" className="block text-sm font-medium text-gray-700 mb-1">Called By</label>
                  <input
                    id="called-by"
                    type="text"
                    value={form.calledBy}
                    onChange={(e) => setForm({ ...form, calledBy: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    placeholder="e.g., Chief Johnson"
                  />
                </div>
              </div>

              {/* Template Selector */}
              <div>
                <label htmlFor="minutes-template" className="block text-sm font-medium text-gray-700 mb-1">
                  <LayoutTemplate className="w-4 h-4 inline mr-1" aria-hidden="true" />
                  Minutes Template
                </label>
                {loadingTemplates ? (
                  <p className="text-sm text-gray-400" role="status">Loading templates...</p>
                ) : filteredTemplates.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No templates found for this meeting type.</p>
                ) : (
                  <select
                    id="minutes-template"
                    value={form.templateId}
                    onChange={(e) => setForm({ ...form, templateId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  >
                    <option value="">No template (blank sections)</option>
                    {filteredTemplates.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.section_count} sections){t.is_default ? ' - Default' : ''}
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-xs text-gray-500 mt-1" id="template-help">
                  Templates pre-fill sections for the meeting type. You can customize sections after creation.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="meeting-date" className="block text-sm font-medium text-gray-700 mb-1">Date <span aria-hidden="true">*</span></label>
                  <input
                    id="meeting-date"
                    type="date"
                    required
                    aria-required="true"
                    value={form.meetingDate}
                    onChange={(e) => setForm({ ...form, meetingDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  />
                </div>
                <div>
                  <label htmlFor="meeting-time" className="block text-sm font-medium text-gray-700 mb-1">Time</label>
                  <input
                    id="meeting-time"
                    type="time"
                    value={form.meetingTime}
                    onChange={(e) => setForm({ ...form, meetingTime: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="meeting-location" className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                <input
                  id="meeting-location"
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="e.g., Station 1 Meeting Room"
                />
              </div>

              <div>
                <label htmlFor="link-event" className="block text-sm font-medium text-gray-700 mb-1">Link to Event</label>
                <select
                  id="link-event"
                  value={form.eventId}
                  onChange={(e) => {
                    const eventId = e.target.value;
                    setForm(prev => ({ ...prev, eventId }));
                    if (eventId) {
                      const ev = meetingEvents.find(ev => ev.id === eventId);
                      if (ev) {
                        const start = new Date(ev.start_datetime);
                        setForm(prev => ({
                          ...prev,
                          eventId,
                          title: prev.title || ev.title,
                          meetingDate: prev.meetingDate || start.toISOString().split('T')[0],
                          meetingTime: prev.meetingTime || start.toTimeString().slice(0, 5),
                          location: prev.location || ev.location || '',
                        }));
                      }
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                >
                  <option value="">None — standalone minutes</option>
                  {loadingEvents ? (
                    <option disabled>Loading events...</option>
                  ) : (
                    meetingEvents.map(ev => (
                      <option key={ev.id} value={ev.id}>
                        {ev.title} ({new Date(ev.start_datetime).toLocaleDateString()})
                      </option>
                    ))
                  )}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Optionally link these minutes to a scheduled meeting event. Fields will auto-populate.
                </p>
              </div>
            </div>

            <div className="px-6 py-3 bg-gray-50 flex justify-end space-x-3 rounded-b-lg sticky bottom-0">
              <button
                onClick={() => setShowCreateModal(false)}
                disabled={creating}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !form.title.trim() || !form.meetingDate}
                className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Start Recording'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MinutesPage;
