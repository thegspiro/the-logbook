/**
 * Elections Page
 *
 * Lists all elections and allows creating new ones.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { electionService, eventService, meetingsService, ranksService, roleService } from '../services/api';
import type { MeetingRecord, OperationalRankResponse } from '../services/api';
import type { EventListItem } from '../types/event';
import type { Role } from '../types/role';
import type { ElectionListItem, ElectionCreate, ElectionSettings } from '../types/election';
import type { VotingMethod, VictoryCondition } from '../constants/enums';
import { useAuthStore } from '../stores/authStore';
import {
  ElectionStatus,
  MeetingKind,
  QuorumType,
  VotingMethod as VM,
  VictoryCondition as VC,
  RunoffType,
} from '../constants/enums';
import { useTimezone } from '../hooks/useTimezone';
import {
  BUILT_IN_ELECTION_DEFAULTS,
  WINNER_RULES,
  describeQuorum,
  electionDefaultsFrom,
  type ElectionFormDefaults,
} from '../utils/electionDefaults';
import { formatDate, formatForDateTimeInput, getTodayLocalDate, localToUTC } from '../utils/dateFormatting';
import { HelpLink } from '../components/HelpLink';
import DateTimeQuarterHour from '../components/ux/DateTimeQuarterHour';
import { getTimeRemaining, getStatusBadgeClass, getStatusLabel } from '../utils/electionHelpers';
import { eventWindow, meetingWindow, type MeetingWindow } from '../utils/electionMeetingWindow';
import { ElectionSummaryCards } from '../modules/elections/components/ElectionSummaryCards';
import { CreateVoterRulesSection } from '../modules/elections/components/CreateVoterRulesSection';
import { DialogPanel } from '../components/ux/DialogPanel';
import { FIELD_ERROR_CLASS, FormField } from '../components/ux/FormField';
import { useDiscardGuard } from '../hooks/useDiscardGuard';
import { useFieldErrors, type FieldErrors, type FieldSpecs } from '../hooks/useFieldErrors';
import ElectionCloseStamp from '../components/election-detail/ElectionCloseStamp';
import { GovernancePageHeader } from '../components/governance/GovernancePageHeader';
import { ClipboardCheck, Settings, Vote } from 'lucide-react';

interface PositionSuggestion {
  key: string;
  name: string;
  detail?: string | undefined;
  code?: string | undefined;
  kind: 'Position' | 'Rank';
}

/** A new election's form, starting from the department's defaults. */
const blankElectionForm = (defaults: ElectionFormDefaults): ElectionCreate => ({
  title: '',
  description: '',
  election_type: 'general',
  positions: [],
  start_date: '',
  end_date: '',
  max_votes_per_position: 1,
  seats_per_position: 1,
  results_visible_immediately: false,
  enable_runoffs: false,
  runoff_type: RunoffType.TOP_TWO,
  max_runoff_rounds: 3,
  auto_open: false,
  reminder_hours_before_close: undefined,
  tie_policy: 'co_winners',
  // Held at a regular business meeting unless the officer says otherwise,
  // or links an annual meeting record.
  meeting_kind: MeetingKind.REGULAR,
  ...defaults,
});

type CreateField =
  | 'title'
  | 'description'
  | 'start_date'
  | 'end_date'
  | 'positions'
  | 'victory_threshold'
  | 'victory_percentage'
  | 'max_runoff_rounds'
  | 'reminder_hours_before_close'
  | 'seats_per_position';

// Limits from ElectionBase (backend/app/schemas/election.py): title 200,
// description 50,000, and each position name 200 (validate_positions).
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 50_000;
const POSITION_MAX = 200;

const CREATE_FIELD_IDS: Record<CreateField, string> = {
  title: 'election-title',
  description: 'election-description',
  start_date: 'election-start-date',
  end_date: 'election-end-date',
  positions: 'election-position-input',
  victory_threshold: 'election-num-threshold',
  victory_percentage: 'election-pct-threshold',
  max_runoff_rounds: 'election-max-runoff-rounds',
  reminder_hours_before_close: 'election-reminder-hours',
  seats_per_position: 'election-seats',
};

// The election schema has no alias generator, so a 422 names these snake_case
// request keys, which are already the field names. Order is focus order.
const CREATE_FIELDS: FieldSpecs<CreateField> = {
  title: { id: CREATE_FIELD_IDS.title, label: 'Title' },
  description: { id: CREATE_FIELD_IDS.description, label: 'Description' },
  start_date: { id: CREATE_FIELD_IDS.start_date, label: 'Start Date & Time' },
  end_date: { id: CREATE_FIELD_IDS.end_date, label: 'End Date & Time' },
  positions: { id: CREATE_FIELD_IDS.positions, label: 'Positions' },
  victory_threshold: { id: CREATE_FIELD_IDS.victory_threshold, label: 'Numerical threshold' },
  victory_percentage: { id: CREATE_FIELD_IDS.victory_percentage, label: 'Percentage threshold' },
  max_runoff_rounds: { id: CREATE_FIELD_IDS.max_runoff_rounds, label: 'Maximum runoff rounds' },
  reminder_hours_before_close: { id: CREATE_FIELD_IDS.reminder_hours_before_close, label: 'Auto-remind non-voters' },
  seats_per_position: { id: CREATE_FIELD_IDS.seats_per_position, label: 'Seats per race' },
};

// The dialog's own label look, kept as the page had it.
const LABEL_CLASS = 'text-theme-text-primary block text-sm font-medium';

const holdsBuiltInDefaults = (form: ElectionCreate): boolean =>
  (Object.keys(BUILT_IN_ELECTION_DEFAULTS) as (keyof ElectionFormDefaults)[]).every(
    (key) => form[key] === BUILT_IN_ELECTION_DEFAULTS[key]
  );

export const ElectionsPage: React.FC = () => {
  const [elections, setElections] = useState<ElectionListItem[]>([]);
  const [filteredElections, setFilteredElections] = useState<ElectionListItem[]>([]);
  // The filter lives in ?status= so a reload or a shared link keeps it
  // (W50-76). Replace, not push, as the settings screens do for their view
  // state; anything that is not a real status reads as All.
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get('status');
  const statusFilter =
    statusParam && (Object.values(ElectionStatus) as string[]).includes(statusParam) ? statusParam : 'all';
  const setStatusFilter = (next: string) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === 'all') params.delete('status');
        else params.set('status', next);
        return params;
      },
      { replace: true }
    );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { busy, run } = useSubmitGuard();
  const electionErrors = useFieldErrors(CREATE_FIELDS);
  const fieldErrors = electionErrors.errors;
  const clearFieldError = (key: CreateField) => electionErrors.setError(key, null);
  const [electionDefaults, setElectionDefaults] = useState<ElectionFormDefaults>(BUILT_IN_ELECTION_DEFAULTS);
  const [formData, setFormData] = useState<ElectionCreate>(() => blankElectionForm(BUILT_IN_ELECTION_DEFAULTS));
  const [positionInput, setPositionInput] = useState('');
  const [featureFlags, setFeatureFlags] = useState({
    reminders_enabled: true,
    auto_open_enabled: true,
  });
  // The department's eligibility defaults, which the server copies onto a new
  // election by its meeting kind. Shown so the secretary knows what the
  // election starts with.
  const [electionSettings, setElectionSettings] = useState<ElectionSettings>({});
  const [showPositionDropdown, setShowPositionDropdown] = useState(false);
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [upcomingEvents, setBusinessMeetingEvents] = useState<EventListItem[]>([]);
  const [availableRanks, setAvailableRanks] = useState<OperationalRankResponse[]>([]);
  const [availablePositions, setAvailablePositions] = useState<Role[]>([]);

  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('elections.manage');
  const tz = useTimezone();

  // A member cannot create an election, so the unfiltered empty state tells
  // them where a vote will turn up rather than pointing at Create Election. It
  // used to be a blank panel, which on a fresh install read as a broken page:
  // members do have a part here, since they vote. A filtered empty result is
  // feedback on the filter, for everyone.
  const isMemberFirstRun = !canManage && statusFilter === 'all';

  const fetchElections = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await electionService.getElections();
      setElections(data);
    } catch (_err) {
      setError("Couldn't load elections. Check your connection and refresh the page.");
    } finally {
      setLoading(false);
    }
  };

  const fetchMeetings = useCallback(async () => {
    try {
      const today = getTodayLocalDate(tz);
      const [meetingsData, eventsData] = await Promise.all([
        meetingsService.getMeetings({ from_date: today, limit: 100 }),
        eventService.getEvents({ start_after: today, limit: 100 }),
      ]);
      setMeetings(meetingsData.meetings);
      setBusinessMeetingEvents(eventsData);
    } catch {
      // Non-critical — meeting selector will just be empty
    }
  }, [tz]);

  useEffect(() => {
    if (!canManage) return;
    void (async () => {
      try {
        const s = await electionService.getSettings();
        setFeatureFlags({
          reminders_enabled: s.reminders_enabled ?? true,
          auto_open_enabled: s.auto_open_enabled ?? true,
        });
        setElectionSettings(s);
        const defaults = electionDefaultsFrom(s);
        setElectionDefaults(defaults);
        // Only a form still on the built-in values takes the department's
        // defaults: an officer who opened the dialog and chose a winner rule
        // before the settings arrived keeps what they chose.
        setFormData((prev) => (holdsBuiltInDefaults(prev) ? { ...prev, ...defaults } : prev));
      } catch {
        // Non-fatal: fields stay visible; the backend gates enforcement.
      }
    })();
  }, [canManage]);

  useEffect(() => {
    void fetchElections();
  }, []);

  // Meetings, upcoming events and ranks only ever populate selectors inside the
  // create dialog, which a member cannot open. Fetching them anyway asks a
  // member's session for three endpoints they may not be entitled to read.
  useEffect(() => {
    if (!canManage) return;
    void fetchMeetings();
    void fetchRanks();
    void fetchPositions();
  }, [canManage, fetchMeetings]);

  useEffect(() => {
    if (statusFilter === 'all') {
      setFilteredElections(elections);
    } else {
      setFilteredElections(elections.filter((e) => e.status === statusFilter));
    }
  }, [elections, statusFilter]);

  const fetchRanks = async () => {
    try {
      const data = await ranksService.getRanks({ is_active: true });
      setAvailableRanks(data);
    } catch {
      // Non-critical — position dropdown will just allow free text
    }
  };

  // Officer and board seats (President, Treasurer, Board of Directors) are
  // positions, not operational ranks, and elections fill both kinds. GET /roles
  // needs positions.view, which every seeded elections.manage holder has; a
  // custom role without it still gets the ranks and free text.
  const fetchPositions = async () => {
    try {
      setAvailablePositions(await roleService.getRoles());
    } catch {
      // Non-critical — the ranks and free text remain
    }
  };

  /**
   * The election's dates from a linked meeting or event's window. Left as
   * typed when the record has no start time or has already begun — a past
   * start cannot be saved, and a date alone does not say when voting opens.
   * With no end time the end falls back to end of day, as a typed start does.
   */
  const datesFromWindow = (win: MeetingWindow): Pick<typeof formData, 'start_date' | 'end_date'> => {
    if (!win.start || new Date(localToUTC(win.start, tz)).getTime() <= Date.now()) {
      return { start_date: formData.start_date, end_date: formData.end_date };
    }
    return { start_date: win.start, end_date: win.end ?? endOfDepartmentDay(win.start) };
  };

  const handleMeetingChange = (value: string) => {
    if (!value) {
      setFormData({ ...formData, meeting_id: undefined, event_id: undefined });
      return;
    }
    // Values are prefixed with "meeting:" or "event:" to distinguish sources
    const [source, id] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)];
    if (source === 'meeting') {
      const meeting = meetings.find((m) => m.id === id);
      if (meeting) {
        setFormData({
          ...formData,
          ...datesFromWindow(meetingWindow(meeting)),
          meeting_id: id,
          event_id: undefined,
          meeting_date: meeting.meeting_date,
          // An annual or special meeting record decides the kind; any other
          // meeting is a regular one, as the backend's _meeting_kind_of_link
          // decides. Still a choice the secretary can change below.
          meeting_kind:
            meeting.meeting_type === 'annual'
              ? MeetingKind.ANNUAL
              : meeting.meeting_type === 'special'
                ? MeetingKind.SPECIAL
                : MeetingKind.REGULAR,
        });
      }
    } else if (source === 'event') {
      const event = upcomingEvents.find((e) => e.id === id);
      if (event) {
        setFormData({
          ...formData,
          ...datesFromWindow(eventWindow(event, tz)),
          meeting_id: undefined,
          event_id: id,
          meeting_date: event.start_datetime,
        });
      }
    }
  };

  /** 23:59 on the same calendar day as a datetime-local value, zone-free. */
  const endOfDepartmentDay = (dateTimeLocal: string) => `${dateTimeLocal.split('T')[0] ?? ''}T23:59`;

  const handleStartDateChange = (startDate: string) => {
    setFormData({ ...formData, start_date: startDate });

    // If no end date is set, default to same day at 11:59 PM. The value is a
    // datetime-local string in the department zone, so end-of-day is a string
    // operation — parsing it with `new Date` would use the browser's zone.
    if (!formData.end_date && startDate) {
      setFormData({ ...formData, start_date: startDate, end_date: endOfDepartmentDay(startDate) });
    }
  };

  const flagMissingStart = () => {
    const message = 'Set a start date first.';
    electionErrors.setError('start_date', message);
    electionErrors.focusFirst({ start_date: message });
  };

  const setDuration = (hours: number) => {
    if (!formData.start_date) {
      flagMissingStart();
      return;
    }

    // Interpret the start in the department zone (as the submit path does)
    // before adding hours; formatForDateTimeInput(…, tz) is the inverse.
    const start = new Date(localToUTC(formData.start_date, tz));
    const end = new Date(start.getTime() + hours * 60 * 60 * 1000);
    setFormData({ ...formData, end_date: formatForDateTimeInput(end, tz) });
    clearFieldError('end_date');
  };

  const setEndOfDay = () => {
    if (!formData.start_date) {
      flagMissingStart();
      return;
    }

    setFormData({ ...formData, end_date: endOfDepartmentDay(formData.start_date) });
    clearFieldError('end_date');
  };

  const resetCreateForm = () => {
    setFormData(blankElectionForm(electionDefaults));
    setPositionInput('');
    electionErrors.clear();
  };
  const closeCreateModal = () => {
    setShowCreateModal(false);
    resetCreateForm();
  };
  const createDirty =
    showCreateModal &&
    (positionInput.trim() !== '' || JSON.stringify(formData) !== JSON.stringify(blankElectionForm(electionDefaults)));
  // One guard for Escape, the X and Cancel, so leaving a changed form asks
  // once whichever way the officer leaves (forms review F-6).
  const requestCloseCreate = useDiscardGuard({ isDirty: createDirty, onClose: closeCreateModal });

  const showFieldErrors = (errors: FieldErrors<CreateField>) => {
    electionErrors.setErrors(errors);
    electionErrors.focusFirst(errors);
  };

  const handleCreateElection = (e: React.FormEvent) => {
    e.preventDefault();
    return run(async () => {
      electionErrors.setFormError(null);

      // A create form creates nothing until every refusal is fixed (owner,
      // 2026-11-05); each one is written under its own field.
      const errors: FieldErrors<CreateField> = {};
      if (!formData.title.trim()) errors.title = 'Enter a title for the election.';
      if (!formData.start_date) errors.start_date = 'Choose when voting opens.';
      if (!formData.end_date) errors.end_date = 'Choose when voting closes.';
      else if (
        formData.start_date &&
        new Date(localToUTC(formData.end_date, tz)).getTime() <= new Date(localToUTC(formData.start_date, tz)).getTime()
      ) {
        // The schema's model validator refuses this with no field to point at.
        errors.end_date = 'Voting has to end after it starts.';
      }
      if (Object.keys(errors).length > 0) {
        showFieldErrors(errors);
        return;
      }
      electionErrors.setErrors({});

      try {
        // Convert local datetime-local values to UTC before sending to backend
        const submitData = {
          ...formData,
          description: formData.description?.trim() || undefined,
          eligibility_override_reason: formData.eligibility_override_reason?.trim() || undefined,
          start_date: localToUTC(formData.start_date, tz),
          end_date: localToUTC(formData.end_date, tz),
        };
        await electionService.createElection(submitData);
        closeCreateModal();
        await fetchElections();
      } catch (err: unknown) {
        electionErrors.focusFirst(electionErrors.setFromApiError(err, 'Failed to create election'));
      }
    });
  };

  const addPosition = () => {
    if (positionInput.trim() && !formData.positions?.includes(positionInput.trim())) {
      setFormData({
        ...formData,
        positions: [...(formData.positions || []), positionInput.trim()],
      });
      setPositionInput('');
    }
  };

  const removePosition = (position: string) => {
    setFormData({
      ...formData,
      positions: formData.positions?.filter((p) => p !== position) || [],
    });
  };

  const quorumNote = describeQuorum({
    quorum_type: formData.quorum_type ?? QuorumType.NONE,
    quorum_value: formData.quorum_value,
  });
  const addedPositions = formData.positions || [];
  const positionQuery = positionInput.trim().toLowerCase();
  const seenSuggestions = new Set(addedPositions.map((p) => p.toLowerCase()));
  // Positions first, then ranks; a name in both (Chief, Captain) is offered once.
  // `member` is the baseline position every member holds, not a seat to fill.
  const positionSuggestions: PositionSuggestion[] = [
    ...availablePositions
      .filter((p) => p.slug !== 'member')
      .map((p) => ({ key: `position-${p.id}`, name: p.name, detail: p.description, kind: 'Position' as const })),
    ...availableRanks.map((r) => ({
      key: `rank-${r.id}`,
      name: r.display_name,
      detail: r.description ?? undefined,
      code: r.rank_code,
      kind: 'Rank' as const,
    })),
  ].filter((suggestion: PositionSuggestion) => {
    const name = suggestion.name.toLowerCase();
    if (seenSuggestions.has(name)) return false;
    seenSuggestions.add(name);
    return !positionQuery || name.includes(positionQuery) || !!suggestion.code?.toLowerCase().includes(positionQuery);
  });
  // The listbox is open only while there is a suggestion to show; it closes on
  // the input's blur rather than through a click-away scrim, which used to sit
  // over the Add button and eat the first tap (W50-63).
  const positionListboxOpen = showPositionDropdown && positionSuggestions.length > 0;

  const getStatusCount = (status: string): number => {
    if (status === 'all') return elections.length;
    return elections.filter((e) => e.status === status).length;
  };

  // The four lifecycle states are always offered so the row is predictable and
  // matches the progress steps on the detail page. Cancelled is exceptional, so
  // it appears only once there is one — but it has to appear, or a cancelled
  // election is reachable through "All" alone. Leaving Nominations out was the
  // visible bug: the counts did not add up to All, and an election taking
  // nominations could not be filtered to at all.
  const statusFilters: string[] = [
    'all',
    ElectionStatus.DRAFT,
    ElectionStatus.NOMINATIONS,
    ElectionStatus.OPEN,
    ElectionStatus.CLOSED,
    ...(getStatusCount(ElectionStatus.CANCELLED) > 0 ? [ElectionStatus.CANCELLED] : []),
  ];

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <div className="flex h-64 items-center justify-center" role="status" aria-live="polite">
          <div className="text-theme-text-muted">Loading elections...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div>
        <GovernancePageHeader
          icon={Vote}
          title="Elections"
          subtitle={
            canManage ? 'Create elections, send ballots and publish results' : 'See elections and their results'
          }
          actions={
            <>
              <HelpLink
                topic="elections"
                tooltip="Create and manage department elections. Set up voting methods, add candidates, configure ballots, and track results. Supports ranked choice, plurality, and approval voting."
              />
              {canManage && (
                <>
                  {/* Labelled, not a bare gear: officers missed the icon, and the
                      Minutes header beside it already names its Settings link. */}
                  <Link
                    to="/elections/settings"
                    className="btn-secondary touch:min-h-11 inline-flex items-center gap-2"
                  >
                    <Settings className="h-4 w-4" aria-hidden="true" />
                    <span>Election Settings</span>
                  </Link>
                  <Link
                    to="/elections/attendance"
                    className="btn-secondary btn-icon-sm"
                    aria-label="Meeting attendance"
                    title="Meeting Attendance"
                  >
                    <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
                  </Link>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="btn-primary inline-flex items-center rounded-md"
                  >
                    <svg
                      className="mr-2 -ml-1 h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Create Election
                  </button>
                </>
              )}
            </>
          }
        />

        {error && (
          <div
            className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4"
            role="alert"
            aria-live="assertive"
          >
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Secretary Dashboard Summary */}
        {canManage && elections.length > 0 && <ElectionSummaryCards elections={elections} />}

        <div className="mb-4 flex flex-wrap gap-2">
          {statusFilters.map((status) => {
            const count = getStatusCount(status);
            return (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`touch:min-h-[44px] inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium ${
                  statusFilter === status
                    ? 'bg-red-800 text-white'
                    : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
                }`}
              >
                {getStatusLabel(status)}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-xs ${
                    statusFilter === status
                      ? 'bg-red-900 text-white'
                      : 'bg-theme-surface-secondary text-theme-text-muted'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="bg-theme-surface overflow-hidden shadow-sm backdrop-blur-xs sm:rounded-md">
          {filteredElections.length === 0 ? (
            <div className="py-16 text-center">
              <svg
                className="text-theme-text-muted mx-auto h-12 w-12"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              {/* h2: the only heading above it is the page's h1, and an h3
                  here skips a level (axe heading-order). */}
              <h2 className="text-theme-text-primary mt-3 text-sm font-medium">
                {statusFilter !== 'all' ? 'No elections found' : 'No elections yet'}
              </h2>
              <p className="text-theme-text-muted mx-auto mt-1 max-w-md text-sm">
                {statusFilter !== 'all'
                  ? `No ${statusFilter} elections. Try a different filter.`
                  : isMemberFirstRun
                    ? 'When your department opens a vote, it appears here and you can cast your ballot from this page. You may also get a ballot link by email.'
                    : 'Create an election, add the candidates, then open voting and send ballot emails. Each step is a button on the election once it is created.'}
              </p>
            </div>
          ) : (
            <ul className="divide-theme-surface-border divide-y">
              {filteredElections.map((election) => {
                const timeRemaining =
                  election.status === ElectionStatus.OPEN ? getTimeRemaining(election.end_date) : null;

                return (
                  <li key={election.id}>
                    <Link
                      to={`/elections/${election.id}`}
                      className="hover:bg-theme-surface-hover block transition-colors"
                    >
                      <div className="px-4 py-4 sm:px-6">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-theme-text-primary truncate text-base font-semibold">
                                {election.title}
                              </p>
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-xs leading-5 font-semibold ${getStatusBadgeClass(
                                  election.status
                                )}`}
                              >
                                {getStatusLabel(election.status)}
                              </span>
                            </div>

                            <div className="text-theme-text-muted mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                              <span className="inline-flex items-center gap-1.5">
                                <svg
                                  className="h-4 w-4"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  aria-hidden="true"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                                  />
                                </svg>
                                {formatDate(election.start_date, tz)} - {formatDate(election.end_date, tz)}
                              </span>
                              <ElectionCloseStamp election={election} className="inline-flex items-center" />
                              {(election.total_votes ?? 0) > 0 && (
                                <span className="inline-flex items-center gap-1.5">
                                  <svg
                                    className="h-4 w-4"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    aria-hidden="true"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                                    />
                                  </svg>
                                  {election.total_votes} {election.total_votes === 1 ? 'vote' : 'votes'}
                                </span>
                              )}
                              {election.meeting_title && (
                                <span className="inline-flex items-center gap-1.5">
                                  <svg
                                    className="h-4 w-4"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    aria-hidden="true"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                                    />
                                  </svg>
                                  {election.meeting_title}
                                </span>
                              )}
                            </div>

                            {election.positions && election.positions.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {election.positions.map((position) => (
                                  <span
                                    key={position}
                                    className="inline-flex items-center rounded-md bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400"
                                  >
                                    {position}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="flex shrink-0 flex-col items-end gap-1">
                            {timeRemaining && (
                              <span className="inline-flex items-center gap-1 rounded-md bg-green-500/10 px-2 py-1 text-xs font-medium text-green-800 dark:text-green-400">
                                <svg
                                  className="h-3 w-3"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  aria-hidden="true"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                  />
                                </svg>
                                {timeRemaining}
                              </span>
                            )}
                            {election.status === ElectionStatus.OPEN && !timeRemaining && (
                              <span className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-1 text-xs font-medium text-red-700 dark:text-red-400">
                                <svg
                                  className="h-3 w-3"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  aria-hidden="true"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                  />
                                </svg>
                                Time expired
                              </span>
                            )}
                            <svg
                              className="text-theme-text-muted h-5 w-5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              aria-hidden="true"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </div>
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {canManage && showCreateModal && (
          <div
            className="modal-overlay z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-election-title"
          >
            <DialogPanel onClose={requestCloseCreate} className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto">
              <div className="border-theme-surface-border border-b px-6 py-4">
                <h3 id="create-election-title" className="text-theme-text-primary text-lg font-medium">
                  Create New Election
                </h3>
              </div>

              <form
                onSubmit={(e) => {
                  void handleCreateElection(e);
                }}
                noValidate
                className="px-6 py-4"
              >
                {electionErrors.formError && (
                  <p role="alert" className={`mb-4 text-sm ${FIELD_ERROR_CLASS}`}>
                    {electionErrors.formError}
                  </p>
                )}

                <div className="space-y-4">
                  <FormField
                    label="Title"
                    id={CREATE_FIELD_IDS.title}
                    required
                    error={fieldErrors.title}
                    maxLength={TITLE_MAX}
                    count={formData.title.length}
                    labelClassName={LABEL_CLASS}
                  >
                    {(field) => (
                      <input
                        {...field}
                        type="text"
                        autoComplete="off"
                        value={formData.title}
                        onChange={(e) => {
                          setFormData({ ...formData, title: e.target.value });
                          clearFieldError('title');
                        }}
                        className="form-input mt-1 shadow-xs"
                      />
                    )}
                  </FormField>

                  <FormField
                    label="Description"
                    id={CREATE_FIELD_IDS.description}
                    error={fieldErrors.description}
                    maxLength={DESCRIPTION_MAX}
                    count={formData.description?.length ?? 0}
                    labelClassName={LABEL_CLASS}
                  >
                    {(field) => (
                      <textarea
                        {...field}
                        value={formData.description}
                        onChange={(e) => {
                          setFormData({ ...formData, description: e.target.value });
                          clearFieldError('description');
                        }}
                        rows={3}
                        className="form-input mt-1 shadow-xs"
                      />
                    )}
                  </FormField>

                  <FormField
                    label="Linked Meeting"
                    id="election-meeting"
                    hint="Optional. Link a meeting or event to import its attendance into this election."
                    labelClassName={LABEL_CLASS}
                  >
                    {(field) => (
                      <select
                        {...field}
                        value={
                          formData.meeting_id
                            ? `meeting:${formData.meeting_id}`
                            : formData.event_id
                              ? `event:${formData.event_id}`
                              : ''
                        }
                        onChange={(e) => handleMeetingChange(e.target.value)}
                        className="form-input mt-1 shadow-xs"
                      >
                        <option value="">No linked meeting</option>
                        {upcomingEvents.map((event) => (
                          <option key={`event-${event.id}`} value={`event:${event.id}`}>
                            {event.title} ({formatDate(event.start_datetime, tz)})
                          </option>
                        ))}
                        {meetings.length > 0 && (
                          <optgroup label="Meeting Minutes">
                            {meetings.map((meeting) => (
                              <option key={`meeting-${meeting.id}`} value={`meeting:${meeting.id}`}>
                                {meeting.title} ({formatDate(meeting.meeting_date, tz)})
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    )}
                  </FormField>

                  <CreateVoterRulesSection
                    settings={electionSettings}
                    meetingKind={formData.meeting_kind ?? MeetingKind.REGULAR}
                    onMeetingKindChange={(kind) => setFormData({ ...formData, meeting_kind: kind })}
                    customRules={formData.eligibility_rules ?? null}
                    onCustomRulesChange={(rules) => {
                      // Back on the kind's defaults: no rules sent, no reason either.
                      const { eligibility_rules: _rules, eligibility_override_reason: _reason, ...rest } = formData;
                      setFormData(rules ? { ...formData, eligibility_rules: rules } : rest);
                    }}
                    reason={formData.eligibility_override_reason ?? ''}
                    onReasonChange={(reason) => setFormData({ ...formData, eligibility_override_reason: reason })}
                  />

                  <div className="space-y-4">
                    <FormField
                      label="Start Date & Time"
                      id={CREATE_FIELD_IDS.start_date}
                      required
                      error={fieldErrors.start_date}
                      labelClassName={LABEL_CLASS}
                    >
                      {(field) => (
                        <DateTimeQuarterHour
                          {...field}
                          timeLabel="Start time"
                          timezone={tz}
                          value={formData.start_date}
                          onChange={(val) => {
                            handleStartDateChange(val);
                            clearFieldError('start_date');
                          }}
                          className="form-input mt-1 shadow-xs"
                        />
                      )}
                    </FormField>

                    <div>
                      <FormField
                        label="End Date & Time"
                        id={CREATE_FIELD_IDS.end_date}
                        required
                        error={fieldErrors.end_date}
                        labelClassName={LABEL_CLASS}
                      >
                        {(field) => (
                          <DateTimeQuarterHour
                            {...field}
                            timeLabel="End time"
                            timezone={tz}
                            value={formData.end_date}
                            onChange={(val) => {
                              setFormData({ ...formData, end_date: val });
                              clearFieldError('end_date');
                            }}
                            className="form-input mt-1 shadow-xs"
                          />
                        )}
                      </FormField>

                      {formData.start_date && (
                        <div className="mt-2">
                          <p className="text-theme-text-muted mb-2 text-xs">Quick duration:</p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => setDuration(1)}
                              className="bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover rounded-sm px-3 py-1 text-xs"
                            >
                              1 Hour
                            </button>
                            <button
                              type="button"
                              onClick={() => setDuration(2)}
                              className="bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover rounded-sm px-3 py-1 text-xs"
                            >
                              2 Hours
                            </button>
                            <button
                              type="button"
                              onClick={() => setDuration(4)}
                              className="bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover rounded-sm px-3 py-1 text-xs"
                            >
                              4 Hours
                            </button>
                            <button
                              type="button"
                              onClick={() => setEndOfDay()}
                              className="rounded-sm bg-blue-100 px-3 py-1 text-xs text-blue-700 hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-400 dark:hover:bg-blue-500/30"
                            >
                              End of Day (Default)
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <FormField
                      label="Positions"
                      id={CREATE_FIELD_IDS.positions}
                      error={fieldErrors.positions}
                      maxLength={POSITION_MAX}
                      count={positionInput.length}
                      hint="Select a department position (President, Secretary…) or rank, or type a custom name."
                      labelClassName={`${LABEL_CLASS} mb-2`}
                    >
                      {(field) => (
                        <div className="relative">
                          <div className="flex space-x-2">
                            <div className="relative flex-1">
                              <input
                                {...field}
                                type="text"
                                value={positionInput}
                                onChange={(e) => {
                                  setPositionInput(e.target.value);
                                  setShowPositionDropdown(true);
                                  clearFieldError('positions');
                                }}
                                onFocus={() => setShowPositionDropdown(true)}
                                // Options commit on mousedown and prevent the blur,
                                // so closing here cannot swallow a pick. This
                                // replaces a full-screen click-away layer that sat
                                // over the Add button and ate the first click.
                                onBlur={() => setShowPositionDropdown(false)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    addPosition();
                                    setShowPositionDropdown(false);
                                  } else if (e.key === 'Escape' && positionListboxOpen) {
                                    // Escape dismisses the open list only. Left to
                                    // bubble, it also reaches the dialog's Escape
                                    // handlers and discards the whole form.
                                    e.stopPropagation();
                                    setShowPositionDropdown(false);
                                  }
                                }}
                                placeholder="Select or type a position..."
                                aria-label="Position name"
                                role="combobox"
                                aria-autocomplete="list"
                                aria-expanded={positionListboxOpen}
                                aria-controls={positionListboxOpen ? 'election-position-listbox' : undefined}
                                autoComplete="off"
                                className="form-input shadow-xs"
                              />
                              {positionListboxOpen && (
                                <ul
                                  id="election-position-listbox"
                                  className="popover-panel absolute z-20 mt-1 max-h-48 w-full overflow-auto"
                                  role="listbox"
                                  aria-label="Available positions"
                                >
                                  {positionSuggestions.map((suggestion) => (
                                    // presentation: the option, not a list item,
                                    // is the listbox's child in the a11y tree.
                                    <li key={suggestion.key} role="presentation">
                                      <button
                                        type="button"
                                        role="option"
                                        className="hover:bg-theme-surface-hover text-theme-text-primary w-full cursor-pointer px-3 py-2 text-left text-sm"
                                        onMouseDown={(e) => {
                                          e.preventDefault(); // Prevent input blur before click
                                          setPositionInput('');
                                          setShowPositionDropdown(false);
                                          if (!addedPositions.includes(suggestion.name)) {
                                            setFormData({
                                              ...formData,
                                              positions: [...addedPositions, suggestion.name],
                                            });
                                          }
                                        }}
                                      >
                                        <span className="font-medium">{suggestion.name}</span>
                                        <span className="text-theme-text-muted ml-2 text-xs">{suggestion.kind}</span>
                                        {suggestion.detail && (
                                          <span className="text-theme-text-muted ml-2 text-xs">
                                            — {suggestion.detail}
                                          </span>
                                        )}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                addPosition();
                                setShowPositionDropdown(false);
                              }}
                              className="bg-theme-surface-hover text-theme-text-primary hover:bg-theme-surface-hover rounded-md px-4 py-2"
                            >
                              Add
                            </button>
                          </div>
                        </div>
                      )}
                    </FormField>
                    {formData.positions && formData.positions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {formData.positions.map((position) => (
                          <span
                            key={position}
                            className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-800 dark:bg-blue-500/20 dark:text-blue-400"
                          >
                            {position}
                            <button
                              type="button"
                              onClick={() => removePosition(position)}
                              className="ml-2 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                              aria-label={`Remove position ${position}`}
                            >
                              <span aria-hidden="true">×</span>
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label htmlFor="election-voting-method" className={LABEL_CLASS}>
                      How is the Winner Determined?
                    </label>
                    <select
                      id="election-voting-method"
                      value={`${formData.voting_method}|${formData.victory_condition}`}
                      onChange={(e) => {
                        const parts = e.target.value.split('|');
                        const method = (parts[0] || VM.SIMPLE_MAJORITY) as VotingMethod;
                        const condition = (parts[1] || VC.MOST_VOTES) as VictoryCondition;
                        setFormData({
                          ...formData,
                          voting_method: method,
                          victory_condition: condition,
                          victory_percentage: undefined,
                          victory_threshold: undefined,
                          // Ranked choice elects one per race (W50-11).
                          ...(method === VM.RANKED_CHOICE ? { seats_per_position: 1, max_votes_per_position: 1 } : {}),
                        });
                      }}
                      className="form-input mt-1 shadow-xs"
                    >
                      {WINNER_RULES.map((rule) => (
                        <option key={rule.value} value={rule.value}>
                          {rule.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-theme-text-muted mt-1 text-xs">
                      {formData.voting_method === VM.RANKED_CHOICE
                        ? 'Voters rank candidates in order of preference. Lowest-ranked candidates are eliminated until one has a majority.'
                        : formData.voting_method === VM.APPROVAL
                          ? 'Voters approve or disapprove each candidate. The candidate with the most approvals wins.'
                          : formData.victory_condition === VC.MAJORITY
                            ? 'Each voter picks one candidate. Winner must receive more than 50% of the votes.'
                            : formData.victory_condition === VC.SUPERMAJORITY
                              ? 'Each voter picks one candidate. Winner must receive at least 2/3 of the votes.'
                              : formData.victory_condition === VC.THRESHOLD
                                ? 'Each voter picks one candidate. Winner must meet the custom threshold you set below.'
                                : 'Each voter picks one candidate. The candidate with the most votes wins, even without a majority.'}
                    </p>
                  </div>

                  {formData.victory_condition === VC.THRESHOLD && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <FormField
                        label="Numerical Threshold"
                        id={CREATE_FIELD_IDS.victory_threshold}
                        error={fieldErrors.victory_threshold}
                        hint="Minimum votes needed to win"
                        labelClassName={LABEL_CLASS}
                      >
                        {(field) => (
                          <input
                            {...field}
                            type="number"
                            inputMode="numeric"
                            min="1"
                            value={formData.victory_threshold || ''}
                            onChange={(e) => {
                              setFormData({
                                ...formData,
                                victory_threshold: e.target.value ? parseInt(e.target.value) : undefined,
                              });
                              clearFieldError('victory_threshold');
                            }}
                            placeholder="e.g., 10 votes required"
                            className="form-input mt-1 shadow-xs"
                          />
                        )}
                      </FormField>

                      <FormField
                        label="Percentage Threshold"
                        id={CREATE_FIELD_IDS.victory_percentage}
                        error={fieldErrors.victory_percentage}
                        hint="Percentage of votes needed to win"
                        labelClassName={LABEL_CLASS}
                      >
                        {(field) => (
                          <input
                            {...field}
                            type="number"
                            inputMode="numeric"
                            min="1"
                            max="100"
                            value={formData.victory_percentage || ''}
                            onChange={(e) => {
                              setFormData({
                                ...formData,
                                victory_percentage: e.target.value ? parseInt(e.target.value) : undefined,
                              });
                              clearFieldError('victory_percentage');
                            }}
                            placeholder="e.g., 60%"
                            className="form-input mt-1 shadow-xs"
                          />
                        )}
                      </FormField>
                    </div>
                  )}

                  {formData.victory_condition === VC.SUPERMAJORITY && (
                    <FormField
                      label="Supermajority Percentage (default: 67%)"
                      // Shown in place of the threshold pair, never beside it, so it takes
                      // the same id the percentage refusal focuses.
                      id={CREATE_FIELD_IDS.victory_percentage}
                      error={fieldErrors.victory_percentage}
                      hint="Percentage of votes needed (typically 67% for 2/3 majority)"
                      labelClassName={LABEL_CLASS}
                    >
                      {(field) => (
                        <input
                          {...field}
                          type="number"
                          inputMode="numeric"
                          min="51"
                          max="100"
                          value={formData.victory_percentage || 67}
                          onChange={(e) => {
                            setFormData({
                              ...formData,
                              victory_percentage: e.target.value ? parseInt(e.target.value) : 67,
                            });
                            clearFieldError('victory_percentage');
                          }}
                          className="form-input mt-1 shadow-xs"
                        />
                      )}
                    </FormField>
                  )}

                  <div className="border-theme-surface-border border-t pt-4">
                    <label className="mb-3 flex items-center">
                      <input
                        type="checkbox"
                        id="election-enable-runoffs"
                        aria-describedby="election-enable-runoffs-help"
                        checked={formData.enable_runoffs}
                        onChange={(e) => setFormData({ ...formData, enable_runoffs: e.target.checked })}
                        className="form-checkbox"
                      />
                      <span className="text-theme-text-primary ml-2 text-sm font-medium">Enable Automatic Runoffs</span>
                    </label>
                    <p id="election-enable-runoffs-help" className="text-theme-text-muted mb-2 ml-6 text-xs">
                      If no candidate meets the winning rule when voting closes, a runoff election is created
                      automatically.
                    </p>

                    {formData.enable_runoffs && (
                      <div className="bg-theme-surface-secondary ml-6 space-y-3 rounded-sm p-3">
                        <div>
                          <label htmlFor="election-runoff-type" className={LABEL_CLASS}>
                            Runoff Type
                          </label>
                          <select
                            id="election-runoff-type"
                            value={formData.runoff_type}
                            onChange={(e) => setFormData({ ...formData, runoff_type: e.target.value })}
                            className="form-input mt-1 shadow-xs"
                          >
                            <option value="top_two">Top Two (top 2 candidates advance)</option>
                            <option value="eliminate_lowest">Eliminate Lowest (remove lowest, others continue)</option>
                          </select>
                          <p className="text-theme-text-muted mt-1 text-xs">
                            Who moves on to the runoff when no candidate meets the winning condition
                          </p>
                        </div>

                        <FormField
                          label="Maximum Runoff Rounds"
                          id={CREATE_FIELD_IDS.max_runoff_rounds}
                          error={fieldErrors.max_runoff_rounds}
                          hint="No more runoffs are created after this many rounds"
                          labelClassName={LABEL_CLASS}
                        >
                          {(field) => (
                            <input
                              {...field}
                              type="number"
                              inputMode="numeric"
                              min="1"
                              max="10"
                              value={formData.max_runoff_rounds}
                              onChange={(e) => {
                                setFormData({ ...formData, max_runoff_rounds: parseInt(e.target.value) || 3 });
                                clearFieldError('max_runoff_rounds');
                              }}
                              className="form-input mt-1 shadow-xs"
                            />
                          )}
                        </FormField>
                      </div>
                    )}
                  </div>

                  {quorumNote && (
                    <p className="text-theme-text-secondary text-sm">
                      <span className="text-theme-text-primary font-medium">Quorum:</span> {quorumNote}. This is the
                      department&apos;s default, set in Election Settings.
                    </p>
                  )}

                  <div className="space-y-2">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        id="election-anonymous"
                        aria-describedby="election-anonymous-help"
                        checked={formData.anonymous_voting}
                        onChange={(e) => setFormData({ ...formData, anonymous_voting: e.target.checked })}
                        className="form-checkbox"
                      />
                      <span className="text-theme-text-primary ml-2 text-sm">Anonymous Voting</span>
                    </label>
                    <p id="election-anonymous-help" className="text-theme-text-muted mb-2 ml-6 text-xs">
                      Votes are saved without the voter's name or IP address. The app still records who has voted, so
                      each member votes once.
                    </p>

                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        id="election-write-ins"
                        aria-describedby="election-write-ins-help"
                        checked={formData.allow_write_ins}
                        onChange={(e) => setFormData({ ...formData, allow_write_ins: e.target.checked })}
                        className="form-checkbox"
                      />
                      <span className="text-theme-text-primary ml-2 text-sm">Allow Write-in Candidates</span>
                    </label>
                    <p id="election-write-ins-help" className="text-theme-text-muted mb-2 ml-6 text-xs">
                      Voters may type in someone who is not on the ballot. Applies to candidate races only; Approve/Deny
                      items never offer a write-in.
                    </p>

                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        id="election-results-visible"
                        aria-describedby="election-results-visible-help"
                        checked={formData.results_visible_immediately}
                        onChange={(e) => setFormData({ ...formData, results_visible_immediately: e.target.checked })}
                        className="form-checkbox"
                      />
                      <span className="text-theme-text-primary ml-2 text-sm">Show Results Immediately</span>
                    </label>
                    <p id="election-results-visible-help" className="text-theme-text-muted mb-2 ml-6 text-xs">
                      Members see the running tally while voting is still open. Left off, results appear once voting
                      closes. This cannot be changed after voting opens.
                    </p>

                    {featureFlags.auto_open_enabled && (
                      <>
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            id="election-auto-open"
                            aria-describedby="election-auto-open-help"
                            checked={formData.auto_open ?? false}
                            onChange={(e) => setFormData({ ...formData, auto_open: e.target.checked })}
                            className="form-checkbox"
                          />
                          <span className="text-theme-text-primary ml-2 text-sm">Open Automatically at Start Time</span>
                        </label>
                        <p id="election-auto-open-help" className="text-theme-text-muted mb-2 ml-6 text-xs">
                          Voting opens at the start time without anyone selecting Open Election. Ballot emails are still
                          sent separately.
                        </p>
                      </>
                    )}

                    {featureFlags.reminders_enabled && (
                      <FormField
                        label="Auto-Remind Non-Voters"
                        id={CREATE_FIELD_IDS.reminder_hours_before_close}
                        error={fieldErrors.reminder_hours_before_close}
                        hint="Members who haven't voted get one reminder email with a fresh ballot link."
                        labelClassName={LABEL_CLASS}
                      >
                        {(field) => (
                          <select
                            {...field}
                            value={formData.reminder_hours_before_close ?? ''}
                            onChange={(e) => {
                              setFormData({
                                ...formData,
                                reminder_hours_before_close: e.target.value ? Number(e.target.value) : undefined,
                              });
                              clearFieldError('reminder_hours_before_close');
                            }}
                            className="form-input mt-1 shadow-xs"
                          >
                            <option value="">No automatic reminder</option>
                            <option value="2">2 hours before close</option>
                            <option value="6">6 hours before close</option>
                            <option value="24">1 day before close</option>
                            <option value="48">2 days before close</option>
                            <option value="72">3 days before close</option>
                          </select>
                        )}
                      </FormField>
                    )}

                    <div>
                      <label htmlFor="election-tie-policy" className={LABEL_CLASS}>
                        If the Top Candidates Tie
                      </label>
                      <select
                        id="election-tie-policy"
                        value={formData.tie_policy ?? 'co_winners'}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            tie_policy: e.target.value as ElectionCreate['tie_policy'],
                          })
                        }
                        className="form-input mt-1 shadow-xs"
                      >
                        <option value="co_winners">Declare all tied candidates winners</option>
                        <option value="runoff">Hold a runoff round</option>
                        <option value="revote">Revote at the meeting</option>
                        <option value="chair_decides">Chair decides per bylaws</option>
                      </select>
                      <p className="text-theme-text-muted mt-1 text-xs">
                        With any option other than co-winners, a tie is flagged in the results with no winner declared.
                      </p>
                    </div>

                    <FormField
                      label="Seats per Race"
                      id={CREATE_FIELD_IDS.seats_per_position}
                      error={fieldErrors.seats_per_position}
                      hint="How many people each race elects — a board race with two seats elects its top two, and voters may choose up to that many. Ranked choice elects one per race."
                      labelClassName={LABEL_CLASS}
                    >
                      {(field) => (
                        <input
                          {...field}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={50}
                          value={formData.seats_per_position ?? 1}
                          disabled={formData.voting_method === VM.RANKED_CHOICE}
                          onChange={(e) => {
                            const seats = Math.min(50, Math.max(1, Math.trunc(Number(e.target.value)) || 1));
                            // A voter picks as many as there are seats; the
                            // server refuses a cap below the seat count.
                            setFormData({ ...formData, seats_per_position: seats, max_votes_per_position: seats });
                            clearFieldError('seats_per_position');
                          }}
                          className="form-input mt-1 w-24 shadow-xs"
                        />
                      )}
                    </FormField>
                  </div>
                </div>

                <div className="mt-6 flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={requestCloseCreate}
                    className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary rounded-md border px-4 py-2"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="btn-info rounded-md disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Create Election
                  </button>
                </div>
              </form>
            </DialogPanel>
          </div>
        )}
      </div>
    </div>
  );
};

export default ElectionsPage;
