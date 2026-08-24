/**
 * Events Page
 *
 * Lists all events with filtering by type, search, pagination,
 * and a toggle between upcoming and past events.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { DialogPanel } from '../components/ux/DialogPanel';
import { Link, useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import {
  Calendar,
  List,
  Plus,
  Download,
  Upload,
  Search,
  SlidersHorizontal,
  User,
  Check,
  X,
  CheckSquare,
  XCircle,
  FileText,
  Bookmark,
  BookmarkPlus,
  Trash2,
  AlertCircle,
  BarChart3,
  MoreHorizontal,
  Settings,
} from 'lucide-react';
import { eventService } from '../services/api';
import { eventService as eventServiceDirect } from '../services/eventServices';
import type { CSVImportRowError } from '../services/eventServices';
import type { EventListItem, EventType, EventCategoryConfig, RSVPCreate, EventTemplate } from '../types/event';
import { getEventTypeLabel, getEventUrgency, isUrgentEventState } from '../utils/eventHelpers';
import { EventListCard } from '../components/events/EventListCard';
import { NeedsYouBand } from '../components/events/NeedsYouBand';
import { useAuthStore } from '../stores/authStore';
import { useTimezone } from '../hooks/useTimezone';
import { formatShortDateTime, getTodayLocalDate } from '../utils/dateFormatting';
import { getErrorMessage } from '../utils/errorHandling';
import { buildCsv, downloadCsv } from '../utils/csv';
import { Breadcrumbs, SkeletonCardGrid, EmptyState, Pagination } from '../components/ux';
import { NfcTapButton } from '../components/nfc/NfcTapButton';
import { useRegisterPullToRefresh } from '../hooks/useRegisterPullToRefresh';
import { DEFAULT_PAGE_SIZE, EVENT_MISSED_LOOKBACK_DAYS } from '../constants/config';
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
  EventTypeEnum.RECRUITMENT,
  EventTypeEnum.OTHER,
];

/* How often the page re-evaluates event urgency. A minute is fine: the only
   boundary that matters mid-session is a check-in window opening, and a member
   watching for it will not notice up to 60s of lag. */
const URGENCY_TICK_MS = 60_000;

/* One row of the overflow menu. `max-md` grows it to the 44px touch minimum
   without inflating the same menu on a desktop pointer. */
const MENU_ITEM_CLASS =
  'text-theme-text-primary hover:bg-theme-surface-hover flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors max-md:min-h-[44px]';

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
  /**
   * Bulk selection is a mode, entered from the overflow menu, rather than a
   * checkbox on every card. Bulk-cancelling is occasional; the checkbox was
   * permanent, and the 40px of gutter it claimed came out of the title on the
   * single-column phone layout.
   */
  const [selectionMode, setSelectionMode] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');

  /**
   * Recently-ended mandatory events the member has no check-in against, for
   * the band's "missed" rows. Fetched separately because the grid only holds
   * past events while the Past toggle is on, and the band must work either way.
   */
  const [pastMandatoryEvents, setPastMandatoryEvents] = useState<EventListItem[]>([]);

  /**
   * Shared clock for every urgency decision on the page, so a card and the
   * band row pointing at it can never straddle a boundary. It ticks because a
   * check-in window opening is the one state change that must appear without a
   * reload — that is what the band's aria-live is there to announce.
   */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), URGENCY_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const gridRef = React.useRef<HTMLDivElement>(null);

  // Templates offered inside the overflow menu (quick-create)
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  // Header overflow menu, and the phone-only disclosure over the secondary
  // filters. Both are open-by-intent: on a desktop pointer the filters are
  // laid out inline and the disclosure button is not rendered at all.
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const moreMenuRef = React.useRef<HTMLDivElement>(null);

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

  // Close the overflow menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    if (showMoreMenu) {
      document.addEventListener('mousedown', handler);
    }
    return () => document.removeEventListener('mousedown', handler);
  }, [showMoreMenu]);

  const closeMoreMenu = useCallback(() => setShowMoreMenu(false), []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedEvents(new Set());
  }, []);

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

  /**
   * Non-critical: the band simply renders without "missed" rows if this fails,
   * exactly as the templates fetch above degrades. It deliberately does not
   * touch `error`, which is the grid's own state.
   */
  useEffect(() => {
    let cancelled = false;
    const fetchPastMandatory = async () => {
      try {
        const data = await eventService.getMissedMandatoryEvents(EVENT_MISSED_LOOKBACK_DAYS);
        if (!cancelled) setPastMandatoryEvents(data);
      } catch {
        // Silently fail — the "missed" rows are an enhancement.
      }
    };
    void fetchPastMandatory();
    return () => {
      cancelled = true;
    };
  }, []);

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
    } catch (err: unknown) {
      // The card is only updated on success, so without this the tap looks
      // exactly like a tap that never registered — the member re-taps and
      // assumes the button is broken rather than that the RSVP was refused
      // (event locked, roster full, session expired).
      toast.error(getErrorMessage(err, 'Could not save your RSVP'));
    } finally {
      setRsvpLoading((prev) => ({ ...prev, [eventId]: false }));
    }
  }, []);

  const handleStartChangeRsvp = useCallback((eventId: string) => {
    setRsvpChanging((prev) => ({ ...prev, [eventId]: true }));
  }, []);

  const handleCancelChangeRsvp = useCallback((eventId: string) => {
    setRsvpChanging((prev) => ({ ...prev, [eventId]: false }));
  }, []);

  /** The band's overflow link: narrow the grid to what needs a response. */
  const handleShowAllNeedsYou = useCallback(() => {
    setShowMyEventsOnly(true);
    setCurrentPage(1);
    gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  /** Card and band buttons are plain handlers; the page owns the promise. */
  const handleQuickRSVPAction = useCallback(
    (eventId: string, status: 'going' | 'not_going') => {
      void handleQuickRSVP(eventId, status);
    },
    [handleQuickRSVP]
  );

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
      // "Mine" is not only what I have already answered. A mandatory event with
      // no RSVP is the most mine of all, and it is what the band's
      // "+N more need a response" link narrows the grid to — filtering on
      // user_rsvp_status alone would hide the very events that link promises.
      filtered = filtered.filter((e) => e.user_rsvp_status || isUrgentEventState(getEventUrgency(e, now)));
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
  }, [typeFilteredEvents, searchQuery, showMyEventsOnly, now]);

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

  /**
   * What a screen reader should hear when a check-in window opens while the
   * page is already sitting open.
   *
   * This has to live here, not on the band's row. An `aria-live` attribute on
   * an element that enters the DOM together with its text is not reliably
   * announced — assistive tech watches for changes *inside* a region that
   * already existed. The band itself renders nothing when it has no rows, so
   * it cannot host the region either: the whole band appears at the same
   * moment as the row. A region that is always mounted, and whose text changes,
   * is the shape that actually announces.
   */
  const liveEventAnnouncement = useMemo(() => {
    const live = events.filter((e) => getEventUrgency(e, now) === 'live');
    if (live.length === 0) return '';
    return live.map((e) => `${e.title} is happening now. Check-in is open.`).join(' ');
  }, [events, now]);

  const paginatedEvents = useMemo(() => {
    const start = (currentPage - 1) * DEFAULT_PAGE_SIZE;
    return sortedEvents.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [sortedEvents, currentPage]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [typeFilter, searchQuery, showPastEvents, showMyEventsOnly, sortBy]);

  // #48: CSV export for events
  /** One builder for both export paths, so a fix to either cannot miss the other. */
  const exportEventsToCsv = useCallback(
    (events: EventListItem[], filename: string) => {
      const headers = ['Title', 'Type', 'Date', 'Location', 'Mandatory', 'Cancelled'];
      const rows = events.map((e) => [
        e.title,
        getEventTypeLabel(e.event_type),
        formatShortDateTime(e.start_datetime, tz),
        e.location || '',
        e.is_mandatory ? 'Yes' : 'No',
        e.is_cancelled ? 'Yes' : 'No',
      ]);
      downloadCsv(buildCsv([headers, ...rows]), filename);
    },
    [tz]
  );

  const handleExportCSV = useCallback(() => {
    exportEventsToCsv(sortedEvents, `events-${getTodayLocalDate(tz)}.csv`);
  }, [exportEventsToCsv, sortedEvents, tz]);

  const handleExportFromMenu = useCallback(() => {
    setShowMoreMenu(false);
    handleExportCSV();
  }, [handleExportCSV]);

  // Drives the count on the phone-only filter button. Only the filters hidden
  // behind the disclosure are counted — the ones still on screen (upcoming/past,
  // list/calendar, search) say what they are without a badge.
  const activeFilterCount = (showMyEventsOnly ? 1 : 0) + (sortBy !== 'date' ? 1 : 0);

  // With no events to export and no management rights the menu has no rows, so
  // the trigger would open an empty panel.
  const hasMoreActions = canManage || sortedEvents.length > 0;

  const handleDuplicate = useCallback(
    async (eventId: string) => {
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

  /** The card owns no promises; the page decides how a duplicate is awaited. */
  const handleDuplicateEvent = useCallback(
    (eventId: string) => {
      void handleDuplicate(eventId);
    },
    [handleDuplicate]
  );

  const toggleEventSelection = useCallback((eventId: string) => {
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
    exportEventsToCsv(selected, `events-selected-${getTodayLocalDate(tz)}.csv`);
  }, [exportEventsToCsv, sortedEvents, selectedEvents, tz]);

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
      let failed = 0;
      for (const evt of selected) {
        try {
          await eventService.cancelEvent(evt.id, {
            cancellation_reason: 'Bulk cancelled by administrator',
            send_notifications: false,
          });
          cancelled++;
        } catch {
          // Keep going so one rejected event doesn't strand the rest, but count
          // it — reporting only the successes made a run where every cancel was
          // refused read as "Cancelled 0 events" in a success toast.
          failed++;
        }
      }
      if (cancelled > 0) toast.success(`Cancelled ${cancelled} event${cancelled !== 1 ? 's' : ''}`);
      if (failed > 0) toast.error(`${failed} event${failed !== 1 ? 's' : ''} could not be cancelled`);
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
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="shrink-0 rounded-lg bg-red-600 p-2">
              <Calendar className="h-6 w-6 text-white" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-2xl font-bold sm:text-3xl">Events</h1>
              <p className="text-theme-text-secondary mt-1 text-sm">
                Department events, meetings, training sessions, and more
              </p>
            </div>
          </div>

          {/* One row at every width: the create action, with everything else
              behind a single overflow menu. As eight sibling buttons these
              wrapped to a column of full-width bars on a phone — and since
              each hid its label below 640px, a column of unlabelled ones —
              which pushed the first event most of a screen below the fold. */}
          <div className="flex items-center gap-2">
            <NfcTapButton />
            {canManage && (
              <Link
                to="/events/admin?tab=create"
                className="btn-primary btn-auto inline-flex flex-1 items-center justify-center gap-2 sm:flex-none"
              >
                <Plus className="h-5 w-5" aria-hidden="true" />
                Create Event
              </Link>
            )}
            {hasMoreActions && (
              <div className="relative shrink-0" ref={moreMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowMoreMenu((prev) => !prev)}
                  className="btn-secondary btn-auto btn-icon"
                  aria-label="More event actions"
                  aria-haspopup="true"
                  aria-expanded={showMoreMenu}
                >
                  <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                </button>
                {showMoreMenu && (
                  <div className="popover-panel absolute right-0 z-50 mt-2 w-64">
                    {canManage && (
                      <div className="border-theme-surface-border border-b p-2">
                        <p className="text-theme-text-secondary px-3 py-1.5 text-xs font-semibold tracking-wider uppercase">
                          Create from Template
                        </p>
                        {templatesLoading ? (
                          <p className="text-theme-text-secondary px-3 py-2 text-sm">Loading templates...</p>
                        ) : templates.length === 0 ? (
                          <p className="text-theme-text-secondary px-3 py-2 text-sm">No templates available</p>
                        ) : (
                          <div className="max-h-48 overflow-y-auto">
                            {templates.map((template) => (
                              <button
                                key={template.id}
                                onClick={() => {
                                  setShowMoreMenu(false);
                                  void navigate(`/events/admin?tab=create&template=${template.id}`);
                                }}
                                className={MENU_ITEM_CLASS}
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate font-medium">{template.name}</span>
                                  {template.description && (
                                    <span className="text-theme-text-secondary block truncate text-xs">
                                      {template.description}
                                    </span>
                                  )}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="p-2">
                      {canManage && sortedEvents.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowMoreMenu(false);
                            setSelectionMode(true);
                          }}
                          className={MENU_ITEM_CLASS}
                        >
                          <CheckSquare className="h-4 w-4 shrink-0" aria-hidden="true" />
                          Select Events
                        </button>
                      )}
                      {sortedEvents.length > 0 && (
                        <button type="button" onClick={handleExportFromMenu} className={MENU_ITEM_CLASS}>
                          <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
                          Export to CSV
                        </button>
                      )}
                      {canManage && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setShowMoreMenu(false);
                              setShowImportModal(true);
                            }}
                            className={MENU_ITEM_CLASS}
                          >
                            <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
                            Import from CSV
                          </button>
                          <Link to="/events/templates" onClick={closeMoreMenu} className={MENU_ITEM_CLASS}>
                            <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                            Event Templates
                          </Link>
                          <Link to="/events/analytics" onClick={closeMoreMenu} className={MENU_ITEM_CLASS}>
                            <BarChart3 className="h-4 w-4 shrink-0" aria-hidden="true" />
                            Attendance Trends
                          </Link>
                          <Link to="/events/admin?tab=settings" onClick={closeMoreMenu} className={MENU_ITEM_CLASS}>
                            <Settings className="h-4 w-4 shrink-0" aria-hidden="true" />
                            Event Module Settings
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Always mounted, so a check-in window opening mid-session is a text
            change inside an existing live region rather than a new region
            nobody is listening to. */}
        <div className="sr-only" role="status" aria-live="polite">
          {liveEventAnnouncement}
        </div>

        {/* Only the events with something outstanding, each beside the control
            that clears it. Renders nothing when there is nothing to do. */}
        <NeedsYouBand
          events={events}
          pastMandatoryEvents={pastMandatoryEvents}
          timezone={tz}
          now={now}
          rsvpLoading={rsvpLoading}
          onQuickRSVP={handleQuickRSVPAction}
          onShowAll={handleShowAllNeedsYou}
        />

        {/* Mode + view + search stay on screen; the filters nobody changes on
            every visit sit behind a disclosure on phones, where each one cost
            a full-width row above the first event. */}
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
          <div className="flex items-center gap-2">
            <div className="segmented-group inline-flex shrink-0 items-center">
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
            <div className="segmented-group inline-flex shrink-0 items-center">
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
          </div>

          <div className="flex items-center gap-2 md:min-w-0 md:flex-1">
            <div className="relative min-w-0 flex-1 md:max-w-sm">
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
            <button
              type="button"
              onClick={() => setShowFilters((prev) => !prev)}
              className="btn-secondary btn-auto btn-icon relative shrink-0 md:hidden"
              aria-controls="event-filter-options"
              aria-expanded={showFilters}
              aria-label={showFilters ? 'Hide filter options' : 'Show filter options'}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1 text-xs font-semibold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          <div
            id="event-filter-options"
            data-testid="event-filter-options"
            className={`${showFilters ? 'flex' : 'hidden'} flex-col gap-2 md:flex md:flex-row md:items-center md:gap-3`}
          >
            <button
              onClick={() => setShowMyEventsOnly((prev) => !prev)}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors max-md:min-h-[44px] ${
                showMyEventsOnly
                  ? 'border-red-600 bg-red-600 text-white shadow-sm'
                  : 'bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:text-theme-text-primary'
              }`}
            >
              <User className="h-4 w-4" aria-hidden="true" />
              My Events
            </button>
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
                className="btn-secondary text-theme-text-secondary hover:text-theme-text-primary inline-flex w-full items-center justify-center gap-1.5 px-3 text-sm font-medium max-md:min-h-[44px]"
                title="Filter presets"
              >
                <Bookmark className="h-4 w-4" aria-hidden="true" />
                Presets
              </button>

              {showPresetMenu && (
                <div className="popover-panel absolute top-full right-0 z-40 mt-1 w-72">
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
        </div>

        {/* Filter Tabs */}
        <div className="border-theme-surface-border -mx-4 mb-6 border-b px-4 sm:mx-0 sm:px-0">
          <nav
            className="-mb-px flex scrollbar-thin space-x-4 overflow-x-auto pb-px sm:space-x-8"
            data-mobile-scroll-region
            aria-label="Event filters"
            tabIndex={0}
          >
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
                ? [
                    {
                      label: 'Create Event',
                      onClick: () => void navigate('/events/admin?tab=create'),
                      icon: Plus,
                    },
                  ]
                : undefined
            }
            className="bg-theme-surface-secondary rounded-lg"
          />
        ) : (
          <>
            <div
              ref={gridRef}
              data-testid="events-grid"
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              {paginatedEvents.map((event) => (
                <EventListCard
                  key={event.id}
                  event={event}
                  urgency={getEventUrgency(event, now)}
                  timezone={tz}
                  timezoneAbbr={tzAbbr}
                  now={now}
                  canManage={canManage}
                  selectionMode={selectionMode}
                  isSelected={selectedEvents.has(event.id)}
                  onToggleSelect={toggleEventSelection}
                  onDuplicate={handleDuplicateEvent}
                  rsvpLoading={!!rsvpLoading[event.id]}
                  isChangingRsvp={!!rsvpChanging[event.id]}
                  onQuickRSVP={handleQuickRSVPAction}
                  onStartChangeRsvp={handleStartChangeRsvp}
                  onCancelChangeRsvp={handleCancelChangeRsvp}
                />
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

      {/* Floating Bulk Action Bar.
          Shown for the whole of selection mode, not only once something is
          selected: it carries the only way back out, so appearing at the first
          tick and vanishing at the last would strand anyone who entered the mode
          and changed their mind. Raised on phones to clear the bottom navigation,
          which the previous `bottom-6` sat on top of — the nav is 56px tall plus
          the home-indicator inset, and shares this z-index. */}
      {selectionMode && (
        <div
          className="popover-panel fixed left-1/2 z-50 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-3 px-6 py-3 max-md:bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-6"
          role="region"
          aria-label="Bulk event actions"
        >
          <span className="text-theme-text-primary text-sm font-medium">{selectedEvents.size} selected</span>
          <div className="bg-theme-surface-border h-5 w-px" />
          <button
            onClick={handleExportSelectedCSV}
            disabled={selectedEvents.size === 0}
            className="bg-theme-surface-hover text-theme-text-primary hover:bg-theme-surface-hover/80 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 max-md:min-h-[44px]"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Export CSV
          </button>
          {canManage && (
            <button
              onClick={() => setShowCancelConfirm(true)}
              disabled={bulkActionLoading || selectedEvents.size === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-red-100 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-200 disabled:opacity-50 max-md:min-h-[44px] dark:bg-red-500/20 dark:text-red-400 dark:hover:bg-red-500/30"
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
              Cancel Selected
            </button>
          )}
          <button
            onClick={exitSelectionMode}
            className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors max-md:min-h-[44px]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Done
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
          <div className="modal-overlay" onClick={handleCloseImportModal} aria-hidden="true" />
          <DialogPanel
            onClose={handleCloseImportModal}
            className="modal-panel-scroll relative mx-4 w-full max-w-lg p-6"
          >
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
                  Valid event types: business_meeting, public_education, training, social, fundraiser, ceremony,
                  recruitment, other. Dates can be in formats like{' '}
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
                      className="btn-secondary text-theme-text-secondary text-sm font-medium"
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
          </DialogPanel>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
          <div className="modal-overlay" onClick={() => setShowCancelConfirm(false)} aria-hidden="true" />
          <DialogPanel
            onClose={() => setShowCancelConfirm(false)}
            className="modal-panel-scroll relative mx-4 w-full max-w-md p-6"
          >
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
                className="btn-secondary text-theme-text-secondary text-sm font-medium"
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
          </DialogPanel>
        </div>
      )}
    </div>
  );
};
