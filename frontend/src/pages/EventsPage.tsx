/**
 * Events Page
 *
 * Lists all events with filtering by type, search, pagination,
 * and a toggle between upcoming and past events.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import {
  Calendar,
  List,
  Plus,
  Download,
  Upload,
  Search,
  Repeat,
  SlidersHorizontal,
  User,
  Check,
  X,
  Users,
  CheckSquare,
  Square,
  XCircle,
  Copy,
  FileText,
  Bookmark,
  BookmarkPlus,
  Trash2,
  AlertCircle,
  BarChart3,
  Zap,
} from 'lucide-react';
import { eventService } from '../services/api';
import { eventService as eventServiceDirect } from '../services/eventServices';
import type { CSVImportRowError } from '../services/eventServices';
import type { EventListItem, EventType, EventCategoryConfig, RSVPCreate, EventTemplate } from '../types/event';
import {
  getEventTypeLabel,
  getEventTypeBadgeColor,
  getRSVPStatusLabel,
  getRSVPStatusColor,
} from '../utils/eventHelpers';
import { useAuthStore } from '../stores/authStore';
import { useTimezone } from '../hooks/useTimezone';
import { formatShortDateTime, getTodayLocalDate } from '../utils/dateFormatting';
import { Breadcrumbs, SkeletonCardGrid, EmptyState, Pagination } from '../components/ux';
import { formatRelativeTime, formatAbsoluteDate } from '../hooks/useRelativeTime';
import { useRegisterPullToRefresh } from '../hooks/useRegisterPullToRefresh';
import { DEFAULT_PAGE_SIZE } from '../constants/config';
import { EventType as EventTypeEnum } from '../constants/enums';
import { CalendarView } from '../components/CalendarView';

// --- Filter Presets (localStorage) ---

const PRESETS_STORAGE_KEY = 'event-filter-presets';

interface FilterPreset {
  id: string;
  name: string;
  eventTypeFilter: string;
  sortField: string;
  searchQuery: string;
  myEventsOnly: boolean;
  viewMode: 'list' | 'calendar';
}

function loadPresets(): FilterPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as FilterPreset[];
  } catch {
    return [];
  }
}

function savePresets(presets: FilterPreset[]): void {
  localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
}

const ALL_EVENT_TYPES: EventType[] = [
  EventTypeEnum.BUSINESS_MEETING,
  EventTypeEnum.PUBLIC_EDUCATION,
  EventTypeEnum.TRAINING,
  EventTypeEnum.SOCIAL,
  EventTypeEnum.FUNDRAISER,
  EventTypeEnum.CEREMONY,
  EventTypeEnum.OTHER,
];

export const EventsPage: React.FC = () => {
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleTypes, setVisibleTypes] = useState<EventType[]>(ALL_EVENT_TYPES);
  const [customCategories, setCustomCategories] = useState<EventCategoryConfig[]>([]);
  const [visibleCustomCategories, setVisibleCustomCategories] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showPastEvents, setShowPastEvents] = useState(false);
  const [showMyEventsOnly, setShowMyEventsOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'date' | 'title' | 'rsvp_count'>('date');
  const [rsvpLoading, setRsvpLoading] = useState<Record<string, boolean>>({});
  const [rsvpChanging, setRsvpChanging] = useState<Record<string, boolean>>({});
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');

  // Quick-create from template state
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const quickCreateRef = React.useRef<HTMLDivElement>(null);

  // CSV Import state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ importedCount: number; errors: CSVImportRowError[] } | null>(null);
  const importFileRef = React.useRef<HTMLInputElement>(null);

  // Filter presets
  const [presets, setPresets] = useState<FilterPreset[]>(loadPresets);
  const [showPresetMenu, setShowPresetMenu] = useState(false);
  const [showSavePresetInput, setShowSavePresetInput] = useState(false);
  const [presetName, setPresetName] = useState('');
  const presetMenuRef = React.useRef<HTMLDivElement>(null);

  const handleSavePreset = useCallback(() => {
    const name = presetName.trim();
    if (!name) return;
    const newPreset: FilterPreset = {
      id: crypto.randomUUID(),
      name,
      eventTypeFilter: typeFilter,
      sortField: sortBy,
      searchQuery,
      myEventsOnly: showMyEventsOnly,
      viewMode,
    };
    const updated = [...presets, newPreset];
    setPresets(updated);
    savePresets(updated);
    setPresetName('');
    setShowSavePresetInput(false);
    toast.success(`Preset "${name}" saved`);
  }, [presetName, typeFilter, sortBy, searchQuery, showMyEventsOnly, viewMode, presets]);

  const handleLoadPreset = useCallback((preset: FilterPreset) => {
    setTypeFilter(preset.eventTypeFilter);
    setSortBy(preset.sortField as 'date' | 'title' | 'rsvp_count');
    setSearchQuery(preset.searchQuery);
    setShowMyEventsOnly(preset.myEventsOnly);
    setViewMode(preset.viewMode);
    setShowPresetMenu(false);
    toast.success(`Loaded preset "${preset.name}"`);
  }, []);

  const handleDeletePreset = useCallback(
    (presetId: string) => {
      const updated = presets.filter((p) => p.id !== presetId);
      setPresets(updated);
      savePresets(updated);
    },
    [presets]
  );

  // Close preset menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (presetMenuRef.current && !presetMenuRef.current.contains(e.target as Node)) {
        setShowPresetMenu(false);
        setShowSavePresetInput(false);
        setPresetName('');
      }
    };
    if (showPresetMenu) {
      document.addEventListener('mousedown', handler);
    }
    return () => document.removeEventListener('mousedown', handler);
  }, [showPresetMenu]);

  // Close quick-create dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (quickCreateRef.current && !quickCreateRef.current.contains(e.target as Node)) {
        setShowQuickCreate(false);
      }
    };
    if (showQuickCreate) {
      document.addEventListener('mousedown', handler);
    }
    return () => document.removeEventListener('mousedown', handler);
  }, [showQuickCreate]);

  const navigate = useNavigate();
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('events.manage');
  const tz = useTimezone();

  // Fetch event templates on mount for quick-create dropdown
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    const fetchTemplates = async () => {
      setTemplatesLoading(true);
      try {
        const data = await eventServiceDirect.getTemplates();
        if (!cancelled) {
          setTemplates(data.filter((t) => t.is_active));
        }
      } catch {
        // Silently fail — quick-create is optional enhancement
      } finally {
        if (!cancelled) setTemplatesLoading(false);
      }
    };
    void fetchTemplates();
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  const tzAbbr = useMemo(() => {
    try {
      return (
        new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
          .formatToParts(new Date())
          .find((p) => p.type === 'timeZoneName')?.value ?? ''
      );
    } catch {
      return '';
    }
  }, [tz]);

  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = showPastEvents
        ? { end_before: new Date().toISOString(), include_drafts: canManage }
        : { end_after: new Date().toISOString(), include_drafts: canManage };
      const data = await eventService.getEvents(params);
      setEvents(data);
    } catch (_err) {
      setError('Failed to load events. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [showPastEvents, canManage]);

  useRegisterPullToRefresh(fetchEvents);

  const handleQuickRSVP = useCallback(async (eventId: string, status: 'going' | 'not_going') => {
    try {
      setRsvpLoading((prev) => ({ ...prev, [eventId]: true }));
      const rsvpData: RSVPCreate = { status, guest_count: 0 };
      await eventService.createOrUpdateRSVP(eventId, rsvpData);
      setEvents((prev) =>
        prev.map((e) =>
          e.id === eventId
            ? {
                ...e,
                user_rsvp_status: status,
                going_count:
                  status === 'going'
                    ? (e.going_count ?? 0) + (e.user_rsvp_status === 'going' ? 0 : 1)
                    : (e.going_count ?? 0) - (e.user_rsvp_status === 'going' ? 1 : 0),
              }
            : e
        )
      );
      setRsvpChanging((prev) => ({ ...prev, [eventId]: false }));
    } catch {
      // Silently fail — user can retry
    } finally {
      setRsvpLoading((prev) => ({ ...prev, [eventId]: false }));
    }
  }, []);

  useEffect(() => {
    void fetchEvents();
    eventService
      .getVisibleEventTypesWithCategories()
      .then((data) => {
        // The axios response generic asserts this field exists rather than
        // proving it, so a payload without it would replace the default with
        // undefined and crash the whole page on the `.includes` below. `??`
        // rather than `||` so an explicitly empty list still means "no standard
        // types configured" (everything groups under the Other tab) instead of
        // silently re-enabling all of them.
        setVisibleTypes(data.visible_event_types ?? ALL_EVENT_TYPES);
        setCustomCategories(data.custom_event_categories || []);
        setVisibleCustomCategories(data.visible_custom_categories || []);
      })
      .catch(() => {
        /* fall back to showing all types */
      });
  }, [fetchEvents]);

  // Types not marked visible are grouped under the "Other" tab
  const hiddenTypes = useMemo(() => ALL_EVENT_TYPES.filter((t) => !visibleTypes.includes(t)), [visibleTypes]);

  // Build filter tab keys: "all" + visible types + visible custom categories + "other"
  const filterTabs = useMemo(() => {
    const tabs: string[] = ['all', ...visibleTypes.filter((t) => t !== 'other')];
    // Add visible custom categories as tabs (prefixed with "cat:" to distinguish from event types)
    for (const catValue of visibleCustomCategories) {
      tabs.push(`cat:${catValue}`);
    }
    // Always include "other" at the end
    tabs.push('other');
    return tabs;
  }, [visibleTypes, visibleCustomCategories]);

  // Filter by type, then search, then paginate
  const typeFilteredEvents = useMemo(() => {
    if (typeFilter === 'all') return events;
    if (typeFilter.startsWith('cat:')) {
      const catValue = typeFilter.slice(4);
      return events.filter((e) => e.custom_category === catValue);
    }
    if (typeFilter === EventTypeEnum.OTHER) {
      return events.filter((e) => e.event_type === EventTypeEnum.OTHER || hiddenTypes.includes(e.event_type));
    }
    return events.filter((e) => e.event_type === typeFilter);
  }, [events, typeFilter, hiddenTypes]);

  const searchFilteredEvents = useMemo(() => {
    let filtered = typeFilteredEvents;
    if (showMyEventsOnly) {
      filtered = filtered.filter((e) => e.user_rsvp_status);
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.title.toLowerCase().includes(query) ||
          (e.location ?? '').toLowerCase().includes(query) ||
          (e.location_name ?? '').toLowerCase().includes(query) ||
          (e.custom_category ?? '').toLowerCase().includes(query)
      );
    }
    return filtered;
  }, [typeFilteredEvents, searchQuery, showMyEventsOnly]);

  const sortedEvents = useMemo(() => {
    const sorted = [...searchFilteredEvents];
    switch (sortBy) {
      case 'title':
        sorted.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
        break;
      case 'rsvp_count':
        sorted.sort((a, b) => (b.going_count ?? 0) - (a.going_count ?? 0));
        break;
      case 'date':
      default:
        sorted.sort((a, b) => {
          const dateA = new Date(a.start_datetime).getTime();
          const dateB = new Date(b.start_datetime).getTime();
          return showPastEvents ? dateB - dateA : dateA - dateB;
        });
        break;
    }
    return sorted;
  }, [searchFilteredEvents, sortBy, showPastEvents]);

  const paginatedEvents = useMemo(() => {
    const start = (currentPage - 1) * DEFAULT_PAGE_SIZE;
    return sortedEvents.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [sortedEvents, currentPage]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [typeFilter, searchQuery, showPastEvents, showMyEventsOnly, sortBy]);

  // #48: CSV export for events
  const handleExportCSV = useCallback(() => {
    const headers = ['Title', 'Type', 'Date', 'Location', 'Mandatory', 'Cancelled'];
    const rows = sortedEvents.map((e) => [
      e.title,
      getEventTypeLabel(e.event_type),
      formatShortDateTime(e.start_datetime, tz),
      e.location || '',
      e.is_mandatory ? 'Yes' : 'No',
      e.is_cancelled ? 'Yes' : 'No',
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `events-${getTodayLocalDate(tz)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sortedEvents, tz]);

  const handleDuplicate = useCallback(
    async (eventId: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const newEvent = await eventService.duplicateEvent(eventId);
        toast.success('Event duplicated successfully');
        void navigate(`/events/${newEvent.id}`);
      } catch {
        toast.error('Failed to duplicate event');
      }
    },
    [navigate]
  );

  const toggleEventSelection = useCallback((eventId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }, []);

  const handleExportSelectedCSV = useCallback(() => {
    const selected = sortedEvents.filter((e) => selectedEvents.has(e.id));
    if (selected.length === 0) return;
    const headers = ['Title', 'Type', 'Date', 'Location', 'Mandatory', 'Cancelled'];
    const rows = selected.map((e) => [
      e.title,
      getEventTypeLabel(e.event_type),
      formatShortDateTime(e.start_datetime, tz),
      e.location || '',
      e.is_mandatory ? 'Yes' : 'No',
      e.is_cancelled ? 'Yes' : 'No',
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `events-selected-${getTodayLocalDate(tz)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sortedEvents, selectedEvents, tz]);

  const handleCancelSelected = useCallback(async () => {
    const selected = sortedEvents.filter((e) => selectedEvents.has(e.id) && !e.is_cancelled);
    if (selected.length === 0) {
      toast.error('No cancellable events selected');
      setShowCancelConfirm(false);
      return;
    }

    try {
      setBulkActionLoading(true);
      let cancelled = 0;
      for (const evt of selected) {
        try {
          await eventService.cancelEvent(evt.id, {
            cancellation_reason: 'Bulk cancelled by administrator',
            send_notifications: false,
          });
          cancelled++;
        } catch {
          // Continue with remaining events
        }
      }
      toast.success(`Cancelled ${cancelled} event${cancelled !== 1 ? 's' : ''}`);
      setSelectedEvents(new Set());
      setShowCancelConfirm(false);
      void fetchEvents();
    } catch {
      toast.error('Failed to cancel events');
    } finally {
      setBulkActionLoading(false);
    }
  }, [sortedEvents, selectedEvents, fetchEvents]);

  // CSV Import handlers
  const handleDownloadTemplate = useCallback(() => {
    const headers = 'title,event_type,start_datetime,end_datetime,location,description,is_mandatory';
    const sampleRow =
      'Monthly Business Meeting,business_meeting,2026-04-01 18:00,2026-04-01 20:00,Station 1,Regular monthly meeting,true';
    const csv = `${headers}\n${sampleRow}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'events-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImportCSV = useCallback(async () => {
    if (!importFile) return;
    setImportLoading(true);
    setImportResult(null);
    try {
      const result = await eventServiceDirect.importEventsCSV(importFile);
      setImportResult({ importedCount: result.imported_count, errors: result.errors });
      if (result.imported_count > 0) {
        toast.success(`Imported ${result.imported_count} event${result.imported_count !== 1 ? 's' : ''}`);
        void fetchEvents();
      }
      if (result.errors.length > 0 && result.imported_count === 0) {
        toast.error('No events were imported. Check the errors below.');
      }
    } catch {
      toast.error('Failed to import CSV file');
    } finally {
      setImportLoading(false);
    }
  }, [importFile, fetchEvents]);

  const handleCloseImportModal = useCallback(() => {
    setShowImportModal(false);
    setImportFile(null);
    setImportResult(null);
    if (importFileRef.current) {
      importFileRef.current.value = '';
    }
  }, []);

  // Clear selection when filters change
  useEffect(() => {
    setSelectedEvents(new Set());
  }, [typeFilter, searchQuery, showPastEvents, showMyEventsOnly, sortBy]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumbs />
        <div className="mb-6">
          <div className="bg-theme-surface-hover mb-2 h-8 w-32 animate-pulse rounded-sm" />
          <div className="bg-theme-surface-hover h-4 w-64 animate-pulse rounded-sm" />
        </div>
        <SkeletonCardGrid count={6} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4" role="alert" aria-live="assertive">
          <p className="text-red-700 dark:text-red-300">{error}</p>
          <button
            onClick={() => {
              void fetchEvents();
            }}
            className="mt-2 text-sm text-red-700 underline hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumbs />

        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-theme-text-primary text-2xl font-bold sm:text-3xl">Events</h1>
            <p className="text-theme-text-secondary mt-1 text-sm">
              Department events, meetings, training sessions, and more
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {sortedEvents.length > 0 && (
              <button
                onClick={handleExportCSV}
                className="btn-secondary inline-flex items-center gap-2"
                title="Export to CSV"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Export</span>
              </button>
            )}
            {canManage && (
              <>
                <button
                  onClick={() => setShowImportModal(true)}
                  className="btn-secondary inline-flex items-center gap-2"
                  title="Import from CSV"
                >
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Import</span>
                </button>
                <Link
                  to="/events/templates"
                  className="btn-secondary inline-flex items-center gap-2"
                  title="Event Templates"
                >
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Templates</span>
                </Link>
                <Link
                  to="/events/analytics"
                  className="btn-secondary inline-flex items-center gap-2"
                  title="Attendance Trends"
                >
                  <BarChart3 className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Analytics</span>
                </Link>
                <Link to="/events/admin" className="btn-secondary btn-icon" title="Module Settings">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </Link>
                <div className="relative" ref={quickCreateRef}>
                  <button
                    onClick={() => setShowQuickCreate((prev) => !prev)}
                    className="btn-primary inline-flex items-center gap-2"
                    title="Quick Create from Template"
                  >
                    <Zap className="h-5 w-5" aria-hidden="true" />
                    <span className="hidden sm:inline">Quick Create</span>
                  </button>
                  {showQuickCreate && (
                    <div className="border-theme-surface-border bg-theme-surface-modal absolute right-0 z-50 mt-2 w-64 rounded-lg border shadow-lg">
                      <div className="p-2">
                        <p className="text-theme-text-secondary px-3 py-1.5 text-xs font-semibold tracking-wider uppercase">
                          Create from Template
                        </p>
                        {templatesLoading ? (
                          <p className="text-theme-text-secondary px-3 py-2 text-sm">Loading templates...</p>
                        ) : templates.length === 0 ? (
                          <p className="text-theme-text-secondary px-3 py-2 text-sm">No templates available</p>
                        ) : (
                          templates.map((template) => (
                            <button
                              key={template.id}
                              onClick={() => {
                                setShowQuickCreate(false);
                                void navigate(`/events/admin?tab=create&template=${template.id}`);
                              }}
                              className="text-theme-text-primary hover:bg-theme-surface-hover w-full rounded-md px-3 py-2 text-left text-sm transition-colors"
                            >
                              <span className="font-medium">{template.name}</span>
                              {template.description && (
                                <span className="text-theme-text-secondary block truncate text-xs">
                                  {template.description}
                                </span>
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <Link to="/events/new" className="btn-primary inline-flex items-center gap-2">
                  <Plus className="h-5 w-5" aria-hidden="true" />
                  Create Event
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Upcoming / Past Toggle + View Mode + Search + My Events + Sort */}
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="border-theme-surface-border bg-theme-surface inline-flex rounded-lg border p-1">
            <button
              onClick={() => setShowPastEvents(false)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors max-md:min-h-[44px] ${
                !showPastEvents
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
            >
              Upcoming
            </button>
            <button
              onClick={() => setShowPastEvents(true)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors max-md:min-h-[44px] ${
                showPastEvents
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
            >
              Past
            </button>
          </div>
          <div className="border-theme-surface-border bg-theme-surface inline-flex rounded-lg border p-1">
            <button
              onClick={() => setViewMode('list')}
              className={`rounded-md p-1.5 transition-colors max-md:inline-flex max-md:min-h-[44px] max-md:min-w-[44px] max-md:items-center max-md:justify-center ${
                viewMode === 'list'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
              aria-label="List view"
              title="List view"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`rounded-md p-1.5 transition-colors max-md:inline-flex max-md:min-h-[44px] max-md:min-w-[44px] max-md:items-center max-md:justify-center ${
                viewMode === 'calendar'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-theme-text-secondary hover:text-theme-text-primary'
              }`}
              aria-label="Calendar view"
              title="Calendar view"
            >
              <Calendar className="h-4 w-4" />
            </button>
          </div>
          <button
            onClick={() => setShowMyEventsOnly((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors max-md:min-h-[44px] ${
              showMyEventsOnly
                ? 'border-red-600 bg-red-600 text-white shadow-sm'
                : 'bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:text-theme-text-primary'
            }`}
          >
            <User className="h-4 w-4" aria-hidden="true" />
            My Events
          </button>
          <div className="relative max-w-sm flex-1">
            <Search
              className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              type="text"
              aria-label="Search events..."
              placeholder="Search events..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="form-input pr-4 pl-10"
            />
          </div>
          <div className="relative">
            <SlidersHorizontal
              className="text-theme-text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'date' | 'title' | 'rsvp_count')}
              className="form-input appearance-none pr-8 pl-9"
            >
              <option value="date">Sort by Date</option>
              <option value="title">Sort by Title</option>
              <option value="rsvp_count">Sort by RSVP Count</option>
            </select>
          </div>

          {/* Filter Presets */}
          <div className="relative" ref={presetMenuRef}>
            <button
              onClick={() => {
                setShowPresetMenu((prev) => !prev);
                setShowSavePresetInput(false);
                setPresetName('');
              }}
              className="border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors max-md:min-h-[44px] max-md:min-w-[44px]"
              title="Filter presets"
            >
              <Bookmark className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Presets</span>
            </button>

            {showPresetMenu && (
              <div className="bg-theme-surface-modal border-theme-surface-border absolute top-full right-0 z-40 mt-1 w-72 rounded-lg border shadow-lg">
                <div className="border-theme-surface-border border-b p-2">
                  {!showSavePresetInput ? (
                    <button
                      onClick={() => setShowSavePresetInput(true)}
                      className="text-theme-text-primary hover:bg-theme-surface-hover inline-flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors"
                    >
                      <BookmarkPlus className="h-4 w-4" aria-hidden="true" />
                      Save Current Filters
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSavePreset();
                          if (e.key === 'Escape') {
                            setShowSavePresetInput(false);
                            setPresetName('');
                          }
                        }}
                        placeholder="Preset name..."
                        className="form-input-sm flex-1"
                        autoFocus
                      />
                      <button
                        onClick={handleSavePreset}
                        disabled={!presetName.trim()}
                        className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                      >
                        Save
                      </button>
                    </div>
                  )}
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {presets.length === 0 ? (
                    <p className="text-theme-text-muted px-3 py-4 text-center text-sm">No saved presets yet</p>
                  ) : (
                    <ul className="py-1">
                      {presets.map((preset) => (
                        <li key={preset.id} className="flex items-center gap-1 px-2">
                          <button
                            onClick={() => handleLoadPreset(preset)}
                            className="text-theme-text-primary hover:bg-theme-surface-hover flex-1 truncate rounded-md px-2 py-2 text-left text-sm transition-colors"
                            title={`Load "${preset.name}"`}
                          >
                            {preset.name}
                          </button>
                          <button
                            onClick={() => handleDeletePreset(preset.id)}
                            className="text-theme-text-muted hover:bg-theme-surface-hover shrink-0 rounded-md p-1.5 transition-colors hover:text-red-600 dark:hover:text-red-400"
                            title={`Delete "${preset.name}"`}
                            aria-label={`Delete preset ${preset.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="border-theme-surface-border -mx-4 mb-6 border-b px-4 sm:mx-0 sm:px-0">
          <nav className="-mb-px flex scrollbar-thin space-x-4 overflow-x-auto pb-px sm:space-x-8" aria-label="Tabs">
            {filterTabs.map((filter) => (
              <button
                key={filter}
                onClick={() => setTypeFilter(filter)}
                className={`${
                  typeFilter === filter
                    ? 'border-red-500 text-red-700 dark:text-red-400'
                    : 'text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border border-transparent'
                } shrink-0 border-b-2 px-1 py-3 text-sm font-medium whitespace-nowrap max-md:min-w-[44px] sm:py-4`}
              >
                {filter === 'all'
                  ? 'All Events'
                  : filter.startsWith('cat:')
                    ? customCategories.find((c) => c.value === filter.slice(4))?.label || filter.slice(4)
                    : getEventTypeLabel(filter as EventType)}
              </button>
            ))}
          </nav>
        </div>

        {/* Events: Calendar or List View */}
        {viewMode === 'calendar' ? (
          <CalendarView events={sortedEvents} timezone={tz} />
        ) : paginatedEvents.length === 0 ? (
          <EmptyState
            icon={Calendar}
            title="No events found"
            description={
              searchQuery
                ? `No events matching "${searchQuery}".`
                : typeFilter === 'all'
                  ? showPastEvents
                    ? 'No past events found.'
                    : 'Get started by creating a new event.'
                  : typeFilter.startsWith('cat:')
                    ? `No events in "${customCategories.find((c) => c.value === typeFilter.slice(4))?.label || typeFilter.slice(4)}" category.`
                    : `No ${getEventTypeLabel(typeFilter).toLowerCase()} events found.`
            }
            actions={
              canManage && !showPastEvents
                ? [{ label: 'Create Event', onClick: () => (window.location.href = '/events/new'), icon: Plus }]
                : undefined
            }
            className="bg-theme-surface-secondary rounded-lg"
          />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {paginatedEvents.map((event) => (
                <div key={event.id} className="relative">
                  {canManage && (
                    <button
                      onClick={(e) => toggleEventSelection(event.id, e)}
                      className={`absolute top-3 left-3 z-10 rounded p-0.5 transition-colors ${
                        selectedEvents.has(event.id)
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-theme-text-muted hover:text-theme-text-primary'
                      }`}
                      aria-label={selectedEvents.has(event.id) ? `Deselect ${event.title}` : `Select ${event.title}`}
                    >
                      {selectedEvents.has(event.id) ? (
                        <CheckSquare className="h-5 w-5" />
                      ) : (
                        <Square className="h-5 w-5" />
                      )}
                    </button>
                  )}
                  <Link
                    to={`/events/${event.id}`}
                    className={`card block transition-all hover:border-red-300 hover:shadow-md ${
                      selectedEvents.has(event.id) ? 'border-red-300 ring-2 ring-red-500/50' : ''
                    }`}
                  >
                    <div className={`p-5 ${canManage ? 'pl-10' : ''}`}>
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {event.event_type === EventTypeEnum.TRAINING && (
                              <svg
                                className="h-5 w-5 shrink-0 text-purple-600"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                                />
                              </svg>
                            )}
                            <h3 className="text-theme-text-primary truncate text-lg font-medium">{event.title}</h3>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getEventTypeBadgeColor(event.event_type)}`}
                            >
                              {getEventTypeLabel(event.event_type)}
                            </span>
                            {event.is_draft && (
                              <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-500/20 dark:text-gray-300">
                                Draft
                              </span>
                            )}
                            {event.is_mandatory && (
                              <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-500/20 dark:text-orange-400">
                                Mandatory
                              </span>
                            )}
                            {(event.is_recurring || event.recurrence_parent_id) && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                                <Repeat className="h-3 w-3" />
                                Recurring
                              </span>
                            )}
                            {event.user_rsvp_status && (
                              <span
                                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getRSVPStatusColor(event.user_rsvp_status)}`}
                              >
                                {getRSVPStatusLabel(event.user_rsvp_status)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="ml-2 flex shrink-0 items-center gap-1">
                          {canManage && (
                            <button
                              onClick={(e) => {
                                void handleDuplicate(event.id, e);
                              }}
                              className="text-theme-text-muted hover:bg-theme-surface-hover rounded p-1 transition-colors hover:text-blue-600 dark:hover:text-blue-400"
                              title="Duplicate event"
                              aria-label={`Duplicate ${event.title}`}
                            >
                              <Copy className="h-4 w-4" />
                            </button>
                          )}
                          {event.is_cancelled && (
                            <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/20 dark:text-red-300">
                              Cancelled
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 space-y-2">
                        <div className="text-theme-text-muted flex items-center text-sm">
                          <svg
                            className="text-theme-text-muted mr-1.5 h-5 w-5 shrink-0"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                            />
                          </svg>
                          <span title={formatAbsoluteDate(event.start_datetime, tz)}>
                            {formatShortDateTime(event.start_datetime, tz)}
                            {tzAbbr ? ` ${tzAbbr}` : ''}
                            <span className="text-theme-text-muted ml-1">
                              ({formatRelativeTime(event.start_datetime)})
                            </span>
                          </span>
                        </div>

                        {(event.location_name || event.location) && (
                          <div className="text-theme-text-muted flex items-center text-sm">
                            <svg
                              className="text-theme-text-muted mr-1.5 h-5 w-5 shrink-0"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                              />
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                              />
                            </svg>
                            <span className="truncate">{event.location_name || event.location}</span>
                          </div>
                        )}

                        {event.requires_rsvp && (
                          <div className="flex items-center text-sm">
                            <Users className="text-theme-text-muted mr-1.5 h-5 w-5 shrink-0" aria-hidden="true" />
                            <span className="font-medium text-green-600 dark:text-green-400">
                              {event.going_count ?? 0} going
                            </span>
                            {(event.rsvp_count ?? 0) > (event.going_count ?? 0) && (
                              <span className="text-theme-text-muted ml-1">/ {event.rsvp_count ?? 0} RSVP'd</span>
                            )}
                          </div>
                        )}

                        {/* Inline Quick RSVP */}
                        {event.requires_rsvp && !event.is_cancelled && (
                          <div
                            className="flex items-center gap-2 pt-1"
                            onClick={(e) => e.preventDefault()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') e.preventDefault();
                            }}
                            role="group"
                            aria-label="Quick RSVP"
                          >
                            {!event.user_rsvp_status || rsvpChanging[event.id] ? (
                              <>
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    void handleQuickRSVP(event.id, 'going');
                                  }}
                                  disabled={!!rsvpLoading[event.id]}
                                  className="inline-flex items-center gap-1 rounded-md bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700 transition-colors hover:bg-green-200 disabled:opacity-50 dark:bg-green-500/20 dark:text-green-400 dark:hover:bg-green-500/30"
                                >
                                  <Check className="h-3 w-3" aria-hidden="true" />
                                  Going
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    void handleQuickRSVP(event.id, 'not_going');
                                  }}
                                  disabled={!!rsvpLoading[event.id]}
                                  className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-200 disabled:opacity-50 dark:bg-red-500/20 dark:text-red-400 dark:hover:bg-red-500/30"
                                >
                                  <X className="h-3 w-3" aria-hidden="true" />
                                  Not Going
                                </button>
                                {event.user_rsvp_status && (
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setRsvpChanging((prev) => ({ ...prev, [event.id]: false }));
                                    }}
                                    className="text-theme-text-muted hover:text-theme-text-primary text-xs"
                                  >
                                    Cancel
                                  </button>
                                )}
                              </>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  setRsvpChanging((prev) => ({ ...prev, [event.id]: true }));
                                }}
                                className="text-theme-text-muted hover:text-theme-text-primary text-xs underline"
                              >
                                Change RSVP
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                </div>
              ))}
            </div>

            {sortedEvents.length > DEFAULT_PAGE_SIZE && (
              <div className="mt-6">
                <Pagination
                  currentPage={currentPage}
                  totalItems={sortedEvents.length}
                  pageSize={DEFAULT_PAGE_SIZE}
                  onPageChange={setCurrentPage}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Floating Bulk Action Bar */}
      {selectedEvents.size > 0 && (
        <div className="bg-theme-surface-modal border-theme-surface-border fixed bottom-6 left-1/2 z-50 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-xl border px-6 py-3 shadow-lg">
          <span className="text-theme-text-primary text-sm font-medium">{selectedEvents.size} selected</span>
          <div className="bg-theme-surface-border h-5 w-px" />
          <button
            onClick={handleExportSelectedCSV}
            className="bg-theme-surface-hover text-theme-text-primary hover:bg-theme-surface-hover/80 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors max-md:min-h-[44px]"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Export CSV
          </button>
          {canManage && (
            <button
              onClick={() => setShowCancelConfirm(true)}
              disabled={bulkActionLoading}
              className="inline-flex items-center gap-1.5 rounded-md bg-red-100 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-200 disabled:opacity-50 max-md:min-h-[44px] dark:bg-red-500/20 dark:text-red-400 dark:hover:bg-red-500/30"
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
              Cancel Selected
            </button>
          )}
          <button
            onClick={() => setSelectedEvents(new Set())}
            className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Clear
          </button>
        </div>
      )}

      {/* CSV Import Modal */}
      {showImportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-label="Import Events from CSV"
        >
          <div className="fixed inset-0 bg-black/50" onClick={handleCloseImportModal} aria-hidden="true" />
          <div className="bg-theme-surface-modal relative mx-4 w-full max-w-lg rounded-lg p-6 shadow-xl">
            <h3 className="text-theme-text-primary mb-4 text-lg font-medium">Import Events from CSV</h3>

            {!importResult ? (
              <>
                <p className="text-theme-text-secondary mb-4 text-sm">
                  Upload a CSV file with columns:{' '}
                  <code className="bg-theme-surface-hover rounded px-1 py-0.5 text-xs">title</code>,{' '}
                  <code className="bg-theme-surface-hover rounded px-1 py-0.5 text-xs">event_type</code>,{' '}
                  <code className="bg-theme-surface-hover rounded px-1 py-0.5 text-xs">start_datetime</code>,{' '}
                  <code className="bg-theme-surface-hover rounded px-1 py-0.5 text-xs">end_datetime</code>,{' '}
                  <code className="bg-theme-surface-hover rounded px-1 py-0.5 text-xs">location</code>,{' '}
                  <code className="bg-theme-surface-hover rounded px-1 py-0.5 text-xs">description</code>,{' '}
                  <code className="bg-theme-surface-hover rounded px-1 py-0.5 text-xs">is_mandatory</code>.
                </p>
                <p className="text-theme-text-muted mb-4 text-xs">
                  Valid event types: business_meeting, public_education, training, social, fundraiser, ceremony, other.
                  Dates can be in formats like{' '}
                  <code className="bg-theme-surface-hover rounded px-1 py-0.5">YYYY-MM-DD HH:MM</code> or{' '}
                  <code className="bg-theme-surface-hover rounded px-1 py-0.5">MM/DD/YYYY HH:MM</code>.
                </p>

                <div className="mb-4">
                  <input
                    ref={importFileRef}
                    type="file"
                    accept=".csv"
                    onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                    className="text-theme-text-primary block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-red-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-red-700 hover:file:bg-red-100 dark:file:bg-red-500/20 dark:file:text-red-400"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    onClick={handleDownloadTemplate}
                    className="inline-flex items-center gap-1 text-sm text-red-600 hover:underline dark:text-red-400"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    Download Template
                  </button>
                  <div className="flex gap-3">
                    <button
                      onClick={handleCloseImportModal}
                      className="text-theme-text-secondary bg-theme-surface border-theme-surface-border hover:bg-theme-surface-hover rounded-md border px-4 py-2 text-sm font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        void handleImportCSV();
                      }}
                      disabled={!importFile || importLoading}
                      className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {importLoading ? (
                        <>
                          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                            />
                          </svg>
                          Importing...
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4" aria-hidden="true" />
                          Import
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Import Results */}
                <div className="space-y-4">
                  <div
                    className={`flex items-center gap-3 rounded-lg p-3 ${
                      importResult.importedCount > 0
                        ? 'border border-green-200 bg-green-50 dark:border-green-500/30 dark:bg-green-500/10'
                        : 'border border-yellow-200 bg-yellow-50 dark:border-yellow-500/30 dark:bg-yellow-500/10'
                    }`}
                  >
                    <Check
                      className={`h-5 w-5 shrink-0 ${importResult.importedCount > 0 ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'}`}
                    />
                    <span className="text-theme-text-primary text-sm font-medium">
                      {importResult.importedCount} event{importResult.importedCount !== 1 ? 's' : ''} imported
                      successfully
                    </span>
                  </div>

                  {importResult.errors.length > 0 && (
                    <div>
                      <div className="mb-2 flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-red-500" aria-hidden="true" />
                        <span className="text-sm font-medium text-red-700 dark:text-red-400">
                          {importResult.errors.length} error{importResult.errors.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="border-theme-surface-border max-h-48 overflow-y-auto rounded-lg border">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-theme-surface-hover">
                              <th scope="col" className="text-theme-text-secondary px-3 py-2 text-left font-medium">
                                {' '}
                                Row
                              </th>
                              <th scope="col" className="text-theme-text-secondary px-3 py-2 text-left font-medium">
                                {' '}
                                Error
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {importResult.errors.map((err, i) => (
                              <tr key={i} className="border-theme-surface-border border-t">
                                <td className="text-theme-text-muted px-3 py-2">{err.row}</td>
                                <td className="px-3 py-2 text-red-600 dark:text-red-400">{err.error}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    onClick={handleCloseImportModal}
                    className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                  >
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowCancelConfirm(false)} aria-hidden="true" />
          <div className="bg-theme-surface-modal relative mx-4 w-full max-w-md rounded-lg p-6 shadow-xl">
            <h3 className="text-theme-text-primary mb-2 text-lg font-medium">
              Cancel {selectedEvents.size} Event{selectedEvents.size !== 1 ? 's' : ''}?
            </h3>
            <p className="text-theme-text-secondary mb-4 text-sm">
              This will cancel all selected events. This action cannot be easily undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowCancelConfirm(false)}
                disabled={bulkActionLoading}
                className="text-theme-text-secondary bg-theme-surface border-theme-surface-border hover:bg-theme-surface-hover rounded-md border px-4 py-2 text-sm font-medium"
              >
                Go Back
              </button>
              <button
                onClick={() => {
                  void handleCancelSelected();
                }}
                disabled={bulkActionLoading}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {bulkActionLoading ? 'Cancelling...' : 'Confirm Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
