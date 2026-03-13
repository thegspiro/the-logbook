/**
 * Events Page
 *
 * Lists all events with filtering by type, search, pagination,
 * and a toggle between upcoming and past events.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Calendar, List, Plus, Download, Upload, Search, Repeat, SlidersHorizontal, User, Check, X, Users, CheckSquare, Square, XCircle, Copy, FileText, Bookmark, BookmarkPlus, Trash2, AlertCircle, BarChart3, Zap } from 'lucide-react';
import { eventService } from '../services/api';
import { eventService as eventServiceDirect } from '../services/eventServices';
import type { CSVImportRowError } from '../services/eventServices';
import type { EventListItem, EventType, EventCategoryConfig, RSVPCreate, EventTemplate } from '../types/event';
import { getEventTypeLabel, getEventTypeBadgeColor, getRSVPStatusLabel, getRSVPStatusColor } from '../utils/eventHelpers';
import { useAuthStore } from '../stores/authStore';
import { useTimezone } from '../hooks/useTimezone';
import { formatShortDateTime } from '../utils/dateFormatting';
import { Breadcrumbs, SkeletonCardGrid, EmptyState, Pagination } from '../components/ux';
import { formatRelativeTime, formatAbsoluteDate } from '../hooks/useRelativeTime';
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

  const handleDeletePreset = useCallback((presetId: string) => {
    const updated = presets.filter((p) => p.id !== presetId);
    setPresets(updated);
    savePresets(updated);
  }, [presets]);

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
          setTemplates(data.filter(t => t.is_active));
        }
      } catch {
        // Silently fail — quick-create is optional enhancement
      } finally {
        if (!cancelled) setTemplatesLoading(false);
      }
    };
    void fetchTemplates();
    return () => { cancelled = true; };
  }, [canManage]);

  const tzAbbr = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
        .formatToParts(new Date())
        .find(p => p.type === 'timeZoneName')?.value ?? '';
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
                going_count: status === 'going'
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
    eventService.getVisibleEventTypesWithCategories()
      .then((data) => {
        setVisibleTypes(data.visible_event_types);
        setCustomCategories(data.custom_event_categories || []);
        setVisibleCustomCategories(data.visible_custom_categories || []);
      })
      .catch(() => { /* fall back to showing all types */ });
  }, [fetchEvents]);

  // Types not marked visible are grouped under the "Other" tab
  const hiddenTypes = useMemo(
    () => ALL_EVENT_TYPES.filter((t) => !visibleTypes.includes(t)),
    [visibleTypes]
  );

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
      return events.filter(
        (e) => e.event_type === EventTypeEnum.OTHER || hiddenTypes.includes(e.event_type)
      );
    }
    return events.filter(e => e.event_type === typeFilter);
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
    const rows = sortedEvents.map(e => [
      e.title,
      getEventTypeLabel(e.event_type),
      formatShortDateTime(e.start_datetime, tz),
      e.location || '',
      e.is_mandatory ? 'Yes' : 'No',
      e.is_cancelled ? 'Yes' : 'No',
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `events-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sortedEvents, tz]);

  const handleDuplicate = useCallback(async (eventId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const newEvent = await eventService.duplicateEvent(eventId);
      toast.success('Event duplicated successfully');
      navigate(`/events/${newEvent.id}`);
    } catch {
      toast.error('Failed to duplicate event');
    }
  }, [navigate]);

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
    const rows = selected.map(e => [
      e.title,
      getEventTypeLabel(e.event_type),
      formatShortDateTime(e.start_datetime, tz),
      e.location || '',
      e.is_mandatory ? 'Yes' : 'No',
      e.is_cancelled ? 'Yes' : 'No',
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `events-selected-${new Date().toISOString().slice(0, 10)}.csv`;
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
    const sampleRow = 'Monthly Business Meeting,business_meeting,2026-04-01 18:00,2026-04-01 20:00,Station 1,Regular monthly meeting,true';
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Breadcrumbs />
        <div className="mb-6">
          <div className="h-8 w-32 bg-theme-surface-hover rounded-sm animate-pulse mb-2" />
          <div className="h-4 w-64 bg-theme-surface-hover rounded-sm animate-pulse" />
        </div>
        <SkeletonCardGrid count={6} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
          <p className="text-red-700 dark:text-red-300">{error}</p>
          <button
            onClick={() => { void fetchEvents(); }}
            className="mt-2 text-sm text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-theme-text-primary">Events</h1>
          <p className="mt-1 text-sm text-theme-text-secondary">
            Department events, meetings, training sessions, and more
          </p>
        </div>
        <div className="flex items-center gap-3">
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
            <Link
              to="/events/admin"
              className="btn-secondary btn-icon"
              title="Module Settings"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </Link>
            <div className="relative" ref={quickCreateRef}>
              <button
                onClick={() => setShowQuickCreate(prev => !prev)}
                className="btn-primary inline-flex items-center gap-2"
                title="Quick Create from Template"
              >
                <Zap className="h-5 w-5" aria-hidden="true" />
                <span className="hidden sm:inline">Quick Create</span>
              </button>
              {showQuickCreate && (
                <div className="absolute right-0 mt-2 w-64 rounded-lg border border-theme-surface-border bg-theme-surface shadow-lg z-50">
                  <div className="p-2">
                    <p className="px-3 py-1.5 text-xs font-semibold text-theme-text-secondary uppercase tracking-wider">
                      Create from Template
                    </p>
                    {templatesLoading ? (
                      <p className="px-3 py-2 text-sm text-theme-text-secondary">Loading templates...</p>
                    ) : templates.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-theme-text-secondary">No templates available</p>
                    ) : (
                      templates.map(template => (
                        <button
                          key={template.id}
                          onClick={() => {
                            setShowQuickCreate(false);
                            navigate(`/events/admin?tab=create&template=${template.id}`);
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-theme-text-primary rounded-md hover:bg-theme-surface-hover transition-colors"
                        >
                          <span className="font-medium">{template.name}</span>
                          {template.description && (
                            <span className="block text-xs text-theme-text-secondary truncate">{template.description}</span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <Link
              to="/events/new"
              className="btn-primary inline-flex items-center gap-2"
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
              Create Event
            </Link>
            </>
          )}
        </div>
      </div>

      {/* Upcoming / Past Toggle + View Mode + Search + My Events + Sort */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-4">
        <div className="inline-flex rounded-lg border border-theme-surface-border bg-theme-surface p-1">
          <button
            onClick={() => setShowPastEvents(false)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              !showPastEvents
                ? 'bg-red-600 text-white shadow-sm'
                : 'text-theme-text-secondary hover:text-theme-text-primary'
            }`}
          >
            Upcoming
          </button>
          <button
            onClick={() => setShowPastEvents(true)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              showPastEvents
                ? 'bg-red-600 text-white shadow-sm'
                : 'text-theme-text-secondary hover:text-theme-text-primary'
            }`}
          >
            Past
          </button>
        </div>
        <div className="inline-flex rounded-lg border border-theme-surface-border bg-theme-surface p-1">
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded-md transition-colors ${
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
            className={`p-1.5 rounded-md transition-colors ${
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
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
            showMyEventsOnly
              ? 'bg-red-600 text-white border-red-600 shadow-sm'
              : 'bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:text-theme-text-primary'
          }`}
        >
          <User className="h-4 w-4" aria-hidden="true" />
          My Events
        </button>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-theme-text-muted" aria-hidden="true" />
          <input
            type="text"
            placeholder="Search events..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
          />
        </div>
        <div className="relative">
          <SlidersHorizontal className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-theme-text-muted pointer-events-none" aria-hidden="true" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'date' | 'title' | 'rsvp_count')}
            className="pl-9 pr-8 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring appearance-none"
          >
            <option value="date">Sort by Date</option>
            <option value="title">Sort by Title</option>
            <option value="rsvp_count">Sort by RSVP Count</option>
          </select>
        </div>

        {/* Filter Presets */}
        <div className="relative" ref={presetMenuRef}>
          <button
            onClick={() => { setShowPresetMenu((prev) => !prev); setShowSavePresetInput(false); setPresetName(''); }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:text-theme-text-primary transition-colors"
            title="Filter presets"
          >
            <Bookmark className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Presets</span>
          </button>

          {showPresetMenu && (
            <div className="absolute right-0 top-full mt-1 w-72 bg-theme-surface border border-theme-surface-border rounded-lg shadow-lg z-40">
              <div className="p-2 border-b border-theme-surface-border">
                {!showSavePresetInput ? (
                  <button
                    onClick={() => setShowSavePresetInput(true)}
                    className="w-full inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-theme-text-primary rounded-md hover:bg-theme-surface-hover transition-colors"
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
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSavePreset(); if (e.key === 'Escape') { setShowSavePresetInput(false); setPresetName(''); } }}
                      placeholder="Preset name..."
                      className="flex-1 px-2 py-1.5 text-sm bg-theme-input-bg border border-theme-input-border rounded-md text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                      autoFocus
                    />
                    <button
                      onClick={handleSavePreset}
                      disabled={!presetName.trim()}
                      className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      Save
                    </button>
                  </div>
                )}
              </div>
              <div className="max-h-60 overflow-y-auto">
                {presets.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-theme-text-muted text-center">
                    No saved presets yet
                  </p>
                ) : (
                  <ul className="py-1">
                    {presets.map((preset) => (
                      <li key={preset.id} className="flex items-center gap-1 px-2">
                        <button
                          onClick={() => handleLoadPreset(preset)}
                          className="flex-1 text-left px-2 py-2 text-sm text-theme-text-primary rounded-md hover:bg-theme-surface-hover transition-colors truncate"
                          title={`Load "${preset.name}"`}
                        >
                          {preset.name}
                        </button>
                        <button
                          onClick={() => handleDeletePreset(preset.id)}
                          className="p-1.5 text-theme-text-muted hover:text-red-600 dark:hover:text-red-400 rounded-md hover:bg-theme-surface-hover transition-colors shrink-0"
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
      <div className="border-b border-theme-surface-border mb-6 -mx-4 px-4 sm:mx-0 sm:px-0">
        <nav className="-mb-px flex space-x-4 sm:space-x-8 overflow-x-auto scrollbar-thin pb-px" aria-label="Tabs">
          {filterTabs.map((filter) => (
            <button
              key={filter}
              onClick={() => setTypeFilter(filter)}
              className={`${
                typeFilter === filter
                  ? 'border-red-500 text-red-700 dark:text-red-400'
                  : 'border-transparent text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border'
              } whitespace-nowrap py-3 sm:py-4 px-1 border-b-2 font-medium text-sm shrink-0`}
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
                  : `No ${getEventTypeLabel(typeFilter as EventType).toLowerCase()} events found.`
          }
          actions={canManage && !showPastEvents ? [
            { label: 'Create Event', onClick: () => window.location.href = '/events/new', icon: Plus },
          ] : undefined}
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
                  className={`absolute top-3 left-3 z-10 p-0.5 rounded transition-colors ${
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
              className={`card block hover:border-red-300 hover:shadow-md transition-all ${
                selectedEvents.has(event.id) ? 'ring-2 ring-red-500/50 border-red-300' : ''
              }`}
            >
              <div className={`p-5 ${canManage ? 'pl-10' : ''}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {event.event_type === EventTypeEnum.TRAINING && (
                        <svg className="h-5 w-5 text-purple-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                      )}
                      <h3 className="text-lg font-medium text-theme-text-primary truncate">{event.title}</h3>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getEventTypeBadgeColor(event.event_type)}`}>
                        {getEventTypeLabel(event.event_type)}
                      </span>
                      {event.is_draft && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300">
                          Draft
                        </span>
                      )}
                      {event.is_mandatory && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400">
                          Mandatory
                        </span>
                      )}
                      {(event.is_recurring || event.recurrence_parent_id) && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                          <Repeat className="h-3 w-3" />
                          Recurring
                        </span>
                      )}
                      {event.user_rsvp_status && (
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRSVPStatusColor(event.user_rsvp_status)}`}>
                          {getRSVPStatusLabel(event.user_rsvp_status)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    {canManage && (
                      <button
                        onClick={(e) => { void handleDuplicate(event.id, e); }}
                        className="p-1 rounded text-theme-text-muted hover:text-blue-600 dark:hover:text-blue-400 hover:bg-theme-surface-hover transition-colors"
                        title="Duplicate event"
                        aria-label={`Duplicate ${event.title}`}
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    )}
                    {event.is_cancelled && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300">
                        Cancelled
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <div className="flex items-center text-sm text-theme-text-muted">
                    <svg className="shrink-0 mr-1.5 h-5 w-5 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span title={formatAbsoluteDate(event.start_datetime, tz)}>
                      {formatShortDateTime(event.start_datetime, tz)}{tzAbbr ? ` ${tzAbbr}` : ''}
                      <span className="text-theme-text-muted ml-1">
                        ({formatRelativeTime(event.start_datetime)})
                      </span>
                    </span>
                  </div>

                  {(event.location_name || event.location) && (
                    <div className="flex items-center text-sm text-theme-text-muted">
                      <svg className="shrink-0 mr-1.5 h-5 w-5 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="truncate">{event.location_name || event.location}</span>
                    </div>
                  )}

                  {event.requires_rsvp && (
                    <div className="flex items-center text-sm">
                      <Users className="shrink-0 mr-1.5 h-5 w-5 text-theme-text-muted" aria-hidden="true" />
                      <span className="text-green-600 dark:text-green-400 font-medium">
                        {event.going_count ?? 0} going
                      </span>
                      {(event.rsvp_count ?? 0) > (event.going_count ?? 0) && (
                        <span className="text-theme-text-muted ml-1">
                          / {event.rsvp_count ?? 0} RSVP'd
                        </span>
                      )}
                    </div>
                  )}

                  {/* Inline Quick RSVP */}
                  {event.requires_rsvp && !event.is_cancelled && (
                    <div
                      className="flex items-center gap-2 pt-1"
                      onClick={(e) => e.preventDefault()}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.preventDefault(); }}
                      role="group"
                      aria-label="Quick RSVP"
                    >
                      {(!event.user_rsvp_status || rsvpChanging[event.id]) ? (
                        <>
                          <button
                            onClick={(e) => { e.preventDefault(); void handleQuickRSVP(event.id, 'going'); }}
                            disabled={!!rsvpLoading[event.id]}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-500/20 dark:text-green-400 dark:hover:bg-green-500/30 transition-colors disabled:opacity-50"
                          >
                            <Check className="h-3 w-3" aria-hidden="true" />
                            Going
                          </button>
                          <button
                            onClick={(e) => { e.preventDefault(); void handleQuickRSVP(event.id, 'not_going'); }}
                            disabled={!!rsvpLoading[event.id]}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-500/20 dark:text-red-400 dark:hover:bg-red-500/30 transition-colors disabled:opacity-50"
                          >
                            <X className="h-3 w-3" aria-hidden="true" />
                            Not Going
                          </button>
                          {event.user_rsvp_status && (
                            <button
                              onClick={(e) => { e.preventDefault(); setRsvpChanging((prev) => ({ ...prev, [event.id]: false })); }}
                              className="text-xs text-theme-text-muted hover:text-theme-text-primary"
                            >
                              Cancel
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          onClick={(e) => { e.preventDefault(); setRsvpChanging((prev) => ({ ...prev, [event.id]: true })); }}
                          className="text-xs text-theme-text-muted hover:text-theme-text-primary underline"
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
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-6 py-3 bg-theme-surface border border-theme-surface-border rounded-xl shadow-lg">
          <span className="text-sm font-medium text-theme-text-primary">
            {selectedEvents.size} selected
          </span>
          <div className="h-5 w-px bg-theme-surface-border" />
          <button
            onClick={handleExportSelectedCSV}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-theme-surface-hover text-theme-text-primary hover:bg-theme-surface-hover/80 transition-colors"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Export CSV
          </button>
          {canManage && (
            <button
              onClick={() => setShowCancelConfirm(true)}
              disabled={bulkActionLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-500/20 dark:text-red-400 dark:hover:bg-red-500/30 transition-colors disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
              Cancel Selected
            </button>
          )}
          <button
            onClick={() => setSelectedEvents(new Set())}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md text-theme-text-secondary hover:text-theme-text-primary transition-colors"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Clear
          </button>
        </div>
      )}

      {/* CSV Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Import Events from CSV">
          <div className="fixed inset-0 bg-black/50" onClick={handleCloseImportModal} />
          <div className="relative bg-theme-surface-modal rounded-lg shadow-xl p-6 max-w-lg w-full mx-4">
            <h3 className="text-lg font-medium text-theme-text-primary mb-4">Import Events from CSV</h3>

            {!importResult ? (
              <>
                <p className="text-sm text-theme-text-secondary mb-4">
                  Upload a CSV file with columns: <code className="text-xs bg-theme-surface-hover px-1 py-0.5 rounded">title</code>, <code className="text-xs bg-theme-surface-hover px-1 py-0.5 rounded">event_type</code>, <code className="text-xs bg-theme-surface-hover px-1 py-0.5 rounded">start_datetime</code>, <code className="text-xs bg-theme-surface-hover px-1 py-0.5 rounded">end_datetime</code>, <code className="text-xs bg-theme-surface-hover px-1 py-0.5 rounded">location</code>, <code className="text-xs bg-theme-surface-hover px-1 py-0.5 rounded">description</code>, <code className="text-xs bg-theme-surface-hover px-1 py-0.5 rounded">is_mandatory</code>.
                </p>
                <p className="text-xs text-theme-text-muted mb-4">
                  Valid event types: business_meeting, public_education, training, social, fundraiser, ceremony, other.
                  Dates can be in formats like <code className="bg-theme-surface-hover px-1 py-0.5 rounded">YYYY-MM-DD HH:MM</code> or <code className="bg-theme-surface-hover px-1 py-0.5 rounded">MM/DD/YYYY HH:MM</code>.
                </p>

                <div className="mb-4">
                  <input
                    ref={importFileRef}
                    type="file"
                    accept=".csv"
                    onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                    className="block w-full text-sm text-theme-text-primary file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-red-50 file:text-red-700 hover:file:bg-red-100 dark:file:bg-red-500/20 dark:file:text-red-400"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <button
                    onClick={handleDownloadTemplate}
                    className="text-sm text-red-600 dark:text-red-400 hover:underline inline-flex items-center gap-1"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    Download Template
                  </button>
                  <div className="flex gap-3">
                    <button
                      onClick={handleCloseImportModal}
                      className="px-4 py-2 text-sm font-medium text-theme-text-secondary bg-theme-surface border border-theme-surface-border rounded-md hover:bg-theme-surface-hover"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => { void handleImportCSV(); }}
                      disabled={!importFile || importLoading}
                      className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-2"
                    >
                      {importLoading ? (
                        <>
                          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
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
                  <div className={`flex items-center gap-3 p-3 rounded-lg ${
                    importResult.importedCount > 0
                      ? 'bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30'
                      : 'bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/30'
                  }`}>
                    <Check className={`h-5 w-5 shrink-0 ${importResult.importedCount > 0 ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'}`} />
                    <span className="text-sm font-medium text-theme-text-primary">
                      {importResult.importedCount} event{importResult.importedCount !== 1 ? 's' : ''} imported successfully
                    </span>
                  </div>

                  {importResult.errors.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="h-4 w-4 text-red-500" aria-hidden="true" />
                        <span className="text-sm font-medium text-red-700 dark:text-red-400">
                          {importResult.errors.length} error{importResult.errors.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="max-h-48 overflow-y-auto rounded-lg border border-theme-surface-border">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-theme-surface-hover">
                              <th className="px-3 py-2 text-left font-medium text-theme-text-secondary">Row</th>
                              <th className="px-3 py-2 text-left font-medium text-theme-text-secondary">Error</th>
                            </tr>
                          </thead>
                          <tbody>
                            {importResult.errors.map((err, i) => (
                              <tr key={i} className="border-t border-theme-surface-border">
                                <td className="px-3 py-2 text-theme-text-muted">{err.row}</td>
                                <td className="px-3 py-2 text-red-600 dark:text-red-400">{err.error}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex justify-end mt-4">
                  <button
                    onClick={handleCloseImportModal}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
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
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowCancelConfirm(false)} />
          <div className="relative bg-theme-surface-modal rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-medium text-theme-text-primary mb-2">
              Cancel {selectedEvents.size} Event{selectedEvents.size !== 1 ? 's' : ''}?
            </h3>
            <p className="text-sm text-theme-text-secondary mb-4">
              This will cancel all selected events. This action cannot be easily undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowCancelConfirm(false)}
                disabled={bulkActionLoading}
                className="px-4 py-2 text-sm font-medium text-theme-text-secondary bg-theme-surface border border-theme-surface-border rounded-md hover:bg-theme-surface-hover"
              >
                Go Back
              </button>
              <button
                onClick={() => { void handleCancelSelected(); }}
                disabled={bulkActionLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
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
