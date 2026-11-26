/**
 * Every roster seat that pairs with no hours entry, and every hours entry on
 * the roster's days that pairs with no seat (owner decisions, 2026-11-26).
 *
 * The overlap rule pairs most of them. What it leaves can be paired here by
 * hand, with one of the same member's unpaired hours within a day of the
 * seat, or marked reviewed, which accepts it as unpaired so it stops counting
 * as outstanding. Nothing is written until the roster is: a hand pairing is
 * a decision the commit reads, like a member assigned to an unfilled seat.
 */

import React, { useCallback, useEffect, useId, useState } from 'react';
import toast from 'react-hot-toast';
import { Pagination } from '../../../components/ux';
import { historicalImportService } from '../../../modules/integrations/services/historicalImportApi';
import {
  STAFFING_LEFTOVER_PREFIX,
  StaffingLeftoverKind,
  StaffingLeftoverState,
  type StaffingLeftover,
  type StaffingLeftoverHours,
  type StaffingLeftoversUpdate,
  type StaffingLeftoversView,
} from '../../../modules/integrations/types/historicalImport';
import { formatDate, formatNumber, formatTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';

const PAGE_SIZE = 25;

interface Props {
  importId: string;
  tz: string;
  /** After a change, so the counts above can be re-read. */
  onChanged: () => void;
}

const TABS: { kind: StaffingLeftoverKind; label: string }[] = [
  { kind: StaffingLeftoverKind.SIGNUPS, label: 'Seats with no hours' },
  { kind: StaffingLeftoverKind.HOURS, label: 'Hours with no seat' },
];

const STATE_LABELS: Record<StaffingLeftoverState, string> = {
  open: 'Open',
  reviewed: 'Reviewed',
  paired: 'Paired by you',
};

export const StaffingLeftovers: React.FC<Props> = ({ importId, tz, onChanged }) => {
  const idPrefix = useId();
  const [kind, setKind] = useState<StaffingLeftoverKind>(StaffingLeftoverKind.SIGNUPS);
  const [memberId, setMemberId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<StaffingLeftoversView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setView(
        await historicalImportService.getStaffingLeftovers(importId, {
          kind,
          member_id: memberId || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          show_resolved: showResolved,
          offset: (page - 1) * PAGE_SIZE,
          limit: PAGE_SIZE,
        })
      );
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not read the unpaired seats and hours'));
    } finally {
      setBusy(false);
    }
  }, [importId, kind, memberId, dateFrom, dateTo, showResolved, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (update: StaffingLeftoversUpdate) => {
    setBusy(true);
    try {
      await historicalImportService.updateStaffingLeftovers(importId, update);
      onChanged();
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save that change'));
      setBusy(false);
    }
  };

  const markReviewed = (item: StaffingLeftover, value: boolean) =>
    void save({ reviewed: { [`${STAFFING_LEFTOVER_PREFIX[kind]}${item.key}`]: value } });

  const span = (entry: { date?: string | null | undefined; start: string; end: string }) =>
    `${formatDate(entry.date || entry.start, tz)}, ${formatTime(entry.start, tz)} to ${formatTime(entry.end, tz)}`;

  const changeFilter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  const renderSeat = (item: StaffingLeftover) => {
    const selectId = `${idPrefix}-pair-${item.key}`;
    const candidates: StaffingLeftoverHours[] = item.candidates ?? [];
    return (
      <>
        <div className="split-row-main">
          <p className="text-theme-text-primary text-sm font-medium">
            {item.member || 'Member to be created'} · {item.title || 'Untitled seat'}
          </p>
          <p className="text-theme-text-muted text-xs">
            {item.date ? formatDate(item.date, tz) : 'No date'} · {item.activity} · {STATE_LABELS[item.state]}
          </p>
          {item.paired_with && (
            <p className="text-theme-text-secondary text-xs">Paired with hours {span(item.paired_with)}</p>
          )}
        </div>
        <div className="split-row-aside flex flex-wrap items-center gap-2">
          {item.state === StaffingLeftoverState.OPEN && candidates.length > 0 && (
            <>
              <label htmlFor={selectId} className="sr-only">
                Pair {item.member}&apos;s {item.title} seat with hours
              </label>
              <select
                id={selectId}
                className="form-input sm:w-64"
                value=""
                disabled={busy}
                onChange={(e) => e.target.value && void save({ pairs: { [item.key]: e.target.value } })}
              >
                <option value="">Pair with their hours…</option>
                {candidates.map((entry) => (
                  <option key={entry.attendance_id} value={entry.attendance_id}>
                    {span(entry)}
                  </option>
                ))}
              </select>
            </>
          )}
          {item.state === StaffingLeftoverState.OPEN && (
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => markReviewed(item, true)}>
              Mark reviewed
            </button>
          )}
          {item.state === StaffingLeftoverState.PAIRED && (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => void save({ pairs: { [item.key]: null } })}
            >
              Unpair
            </button>
          )}
          {item.state === StaffingLeftoverState.REVIEWED && (
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => markReviewed(item, false)}>
              Mark open again
            </button>
          )}
        </div>
      </>
    );
  };

  const renderHours = (item: StaffingLeftover) => (
    <>
      <div className="split-row-main">
        <p className="text-theme-text-primary text-sm font-medium">{item.member}</p>
        <p className="text-theme-text-muted text-xs">
          {item.start && item.end ? span({ date: item.date, start: item.start, end: item.end }) : 'No time'} ·{' '}
          {STATE_LABELS[item.state]}
        </p>
      </div>
      <div className="split-row-aside">
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => markReviewed(item, item.state === StaffingLeftoverState.OPEN)}
        >
          {item.state === StaffingLeftoverState.OPEN ? 'Mark reviewed' : 'Mark open again'}
        </button>
      </div>
    </>
  );

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Which side" className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.kind}
            type="button"
            aria-pressed={kind === tab.kind}
            className={kind === tab.kind ? 'btn-primary' : 'btn-secondary'}
            onClick={() => changeFilter(() => setKind(tab.kind))}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`${idPrefix}-member`} className="form-label">
            Member
          </label>
          <select
            id={`${idPrefix}-member`}
            className="form-input sm:w-56"
            value={memberId}
            onChange={(e) => changeFilter(() => setMemberId(e.target.value))}
          >
            <option value="">Everyone</option>
            {(view?.members ?? []).map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-from`} className="form-label">
            From
          </label>
          <input
            id={`${idPrefix}-from`}
            type="date"
            className="form-input"
            value={dateFrom}
            onChange={(e) => changeFilter(() => setDateFrom(e.target.value))}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-to`} className="form-label">
            To
          </label>
          <input
            id={`${idPrefix}-to`}
            type="date"
            className="form-input"
            value={dateTo}
            onChange={(e) => changeFilter(() => setDateTo(e.target.value))}
          />
        </div>
        <label className="text-theme-text-primary flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={showResolved}
            onChange={(e) => changeFilter(() => setShowResolved(e.target.checked))}
          />
          Show paired and reviewed
        </label>
      </div>

      {view && (
        <p className="text-theme-text-secondary text-sm" aria-live="polite">
          {formatNumber(view.total)} {view.total === 1 ? 'entry' : 'entries'}
        </p>
      )}

      {view && view.items.length > 0 ? (
        <ul className="divide-theme-surface-border divide-y">
          {view.items.map((item) => (
            <li key={item.key} className="split-row gap-3 py-2">
              {kind === StaffingLeftoverKind.SIGNUPS ? renderSeat(item) : renderHours(item)}
            </li>
          ))}
        </ul>
      ) : (
        view && <p className="text-theme-text-muted text-sm">Nothing left to review here.</p>
      )}

      {view && view.total > PAGE_SIZE && (
        <Pagination currentPage={page} totalItems={view.total} pageSize={PAGE_SIZE} onPageChange={setPage} />
      )}
    </div>
  );
};

export default StaffingLeftovers;
