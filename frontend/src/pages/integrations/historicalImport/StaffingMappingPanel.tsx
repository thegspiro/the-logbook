/**
 * Historical Data Import — staffing roster: what each activity is, and what
 * each seat title means.
 *
 * Three lists, each suggested first and decided by the reviewer:
 *   - activities: a shift (duty on a unit) or an event, or left out;
 *   - shift seat titles: one of the department's crew seats, or left out;
 *   - event titles: one of its outreach roles, attendance, or left out.
 * Titles map only to the department's own choices: the import adds no seat or
 * role, so a missing one is added in Scheduling or Event settings first.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { Pagination } from '../../../components/ux';
import { useTablist } from '../../../hooks/useTablist';
import { historicalImportService } from '../../../modules/integrations/services/historicalImportApi';
import {
  STAFFING_ATTENDANCE,
  STAFFING_TITLE_SKIP,
  StaffingMappingList,
  type StaffingChoice,
  type StaffingMappingItem,
  type StaffingMappingView,
} from '../../../modules/integrations/types/historicalImport';
import { formatNumber } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';

const PAGE_SIZE = 25;

const LIST_COPY: Record<StaffingMappingList, { tab: string; help: React.ReactNode }> = {
  [StaffingMappingList.ACTIVITIES]: {
    tab: 'Shifts or events',
    help: 'A shift is duty on a unit; its seats become crew seats. Anything else is an event, whose seats become outreach roles or attendance.',
  },
  [StaffingMappingList.SEAT_TITLES]: {
    tab: 'Shift seats',
    help: (
      <>
        Each title on a shift becomes one of your crew seats. A seat missing from the list is added under{' '}
        <Link to="/scheduling/admin/settings/general" className="underline">
          Scheduling settings → Position Names
        </Link>
        .
      </>
    ),
  },
  [StaffingMappingList.EVENT_TITLES]: {
    tab: 'Event roles',
    help: (
      <>
        Each title at an event becomes one of your outreach roles, or attendance when the person attended. A role
        missing from the list is added under{' '}
        <Link to="/events/admin?tab=settings" className="underline">
          Event settings → Outreach roles
        </Link>
        .
      </>
    ),
  },
};

const ACTIVITY_CHOICES: StaffingChoice[] = [
  { value: 'shift', label: 'Shift' },
  { value: 'event', label: 'Event' },
  { value: 'skip', label: 'Leave out' },
];

function choicesFor(list: StaffingMappingList, view: StaffingMappingView): StaffingChoice[] {
  if (list === StaffingMappingList.ACTIVITIES) return ACTIVITY_CHOICES;
  if (list === StaffingMappingList.SEAT_TITLES) {
    return [...view.seat_choices, { value: STAFFING_TITLE_SKIP, label: 'Leave out' }];
  }
  return [
    ...view.role_choices,
    { value: STAFFING_ATTENDANCE, label: 'Attendance' },
    { value: STAFFING_TITLE_SKIP, label: 'Leave out' },
  ];
}

interface StaffingMappingPanelProps {
  importId: string;
}

const StaffingMappingPanel: React.FC<StaffingMappingPanelProps> = ({ importId }) => {
  const [list, setList] = useState<StaffingMappingList>(StaffingMappingList.ACTIVITIES);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const tablist = useTablist();

  // Each request reads the whole roster, so a search waits for typing to stop.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);
  const [view, setView] = useState<StaffingMappingView | null>(null);
  const [busy, setBusy] = useState(false);

  const params = { search, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE };

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setView(
        await historicalImportService.getStaffingMapping(importId, list, {
          search,
          offset: (page - 1) * PAGE_SIZE,
          limit: PAGE_SIZE,
        })
      );
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not read the staffing decisions'));
    } finally {
      setBusy(false);
    }
  }, [importId, list, search, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = (item: StaffingMappingItem, value: string) =>
    void (async () => {
      setBusy(true);
      try {
        setView(
          await historicalImportService.updateStaffingDecisions(importId, list, { [item.key]: value || null }, params)
        );
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not save that decision'));
      } finally {
        setBusy(false);
      }
    })();

  const acceptAll = () =>
    void (async () => {
      setBusy(true);
      try {
        const taken = await historicalImportService.acceptStaffingSuggestions(importId, list);
        toast.success(`${formatNumber(taken)} suggestions taken`);
        setView(await historicalImportService.getStaffingMapping(importId, list, params));
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not take the suggestions'));
      } finally {
        setBusy(false);
      }
    })();

  const switchList = (next: StaffingMappingList) => {
    setList(next);
    setSearchInput('');
    setSearch('');
    setPage(1);
  };

  const choices = view ? choicesFor(list, view) : [];
  const labelOf = (value: string | null | undefined) => choices.find((c) => c.value === value)?.label ?? value ?? '';
  const progress = view?.progress[list];

  return (
    <div className="space-y-3">
      <h3 className="text-theme-text-primary font-semibold">What the roster means</h3>
      <div className="tab-scroll" role="tablist" {...tablist} aria-label="Staffing decisions">
        {Object.values(StaffingMappingList).map((name) => {
          const p = view?.progress[name];
          return (
            <button
              key={name}
              id={`staffing-tab-${name}`}
              type="button"
              role="tab"
              aria-selected={list === name}
              aria-controls="staffing-tabpanel"
              onClick={() => switchList(name)}
              className={`mobile-touch-target px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                list === name
                  ? 'border-b-2 border-violet-600 text-violet-700 dark:text-violet-400'
                  : 'text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              {LIST_COPY[name].tab}
              {p ? ` (${formatNumber(p.undecided + p.suggested)} to decide)` : ''}
            </button>
          );
        })}
      </div>

      <div
        id="staffing-tabpanel"
        role="tabpanel"
        aria-labelledby={`staffing-tab-${list}`}
        aria-busy={busy}
        className="space-y-3"
      >
        <p className="text-theme-text-secondary text-sm">{LIST_COPY[list].help}</p>

        {progress && (
          <p className="text-theme-text-secondary text-sm" role="status">
            {formatNumber(progress.decided)} of {formatNumber(progress.items)} decided,{' '}
            {formatNumber(progress.suggested)} with a suggestion waiting, {formatNumber(progress.undecided)} with none.{' '}
            {formatNumber(progress.seats_settled)} of {formatNumber(progress.seats)} seats are settled.
          </p>
        )}

        <div className="split-row gap-3">
          <div className="split-row-main">
            <label htmlFor="staffing-mapping-search" className="sr-only">
              Search
            </label>
            <input
              id="staffing-mapping-search"
              type="search"
              className="form-input"
              placeholder="Search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="split-row-aside btn-secondary"
            disabled={busy || !progress?.suggested}
            onClick={acceptAll}
          >
            Accept all suggestions
          </button>
        </div>

        {view && view.items.length === 0 && (
          <p className="text-theme-text-secondary text-sm">Nothing here{search ? ' matches that search' : ''}.</p>
        )}

        <ul className="divide-theme-surface-border divide-y">
          {view?.items.map((item) => {
            const id = `staffing-choice-${list}-${item.key}`;
            return (
              <li key={item.key} className="split-row gap-3 py-2">
                <div className="split-row-main">
                  <label htmlFor={id} className="text-theme-text-primary text-sm font-medium">
                    {item.label}
                  </label>
                  <p className="text-theme-text-muted text-xs">
                    {formatNumber(item.seats)} seats at {formatNumber(item.events)} events
                    {item.examples.length > 1
                      ? ` · as ${item.examples.map((e) => e.trim() || '(blank)').join(', ')}`
                      : ''}
                    {item.suggestion && !item.choice ? ` · suggested: ${labelOf(item.suggestion)}` : ''}
                  </p>
                </div>
                <select
                  id={id}
                  className="split-row-aside form-input sm:w-56"
                  value={item.choice ?? ''}
                  disabled={busy}
                  onChange={(e) => decide(item, e.target.value)}
                >
                  <option value="">{item.suggestion ? `Suggested: ${labelOf(item.suggestion)}` : 'Choose…'}</option>
                  {choices.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>

        {view && view.total > PAGE_SIZE && (
          <Pagination currentPage={page} totalItems={view.total} pageSize={PAGE_SIZE} onPageChange={setPage} />
        )}
      </div>
    </div>
  );
};

export default StaffingMappingPanel;
