/**
 * Historical Data Import — staffing roster: unfilled seats and writing it.
 *
 * Shows what writing the roster would do and what it leaves out, by reason;
 * the members still to decide (shared with the import's other steps); the
 * unfilled seats, each skipped unless a member is assigned; and whether events
 * with no seats become calendar events. Writing fills the hours import's
 * shifts where they exist, checks members in at calendar events and seats them
 * on outreach sheets. It credits no hours and is safe to run again.
 *
 * The roster and the hours share no id, so each seat is paired with the hours
 * entry of the same member whose time overlaps it most; the seat is written
 * onto that shift. The preview shows how many pair, and the first of each side
 * that pairs with nothing, so a reviewer can check before writing.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Collapsible, Pagination } from '../../../components/ux';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useTimezone } from '../../../hooks/useTimezone';
import { historicalImportService } from '../../../modules/integrations/services/historicalImportApi';
import type {
  AdminMemberMapping,
  StaffingCommitPreview,
  StaffingHoursMatch,
  StaffingUnfilledView,
} from '../../../modules/integrations/types/historicalImport';
import { HistoricalUndoStep } from '../../../modules/integrations/types/historicalImport';
import { formatDate, formatNumber, formatTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import MembersToDecide from './MembersToDecide';
import StaffingLeftovers from './StaffingLeftovers';
import StepUndo from './StepUndo';

const PAGE_SIZE = 25;

const SKIP_REASONS: Record<string, string> = {
  no_event: 'name an event the export does not have',
  undated: 'are on an event with no date',
  outside_usual_range: 'are on an event outside the usual years',
  activity_left_out: 'are on an activity you left out',
  activity_undecided: 'are on an activity not yet decided',
  title_left_out: 'have a title you left out',
  title_undecided: 'have a title not yet decided',
  unfilled: 'are unfilled with nobody assigned',
};

const RESULT_LABELS: Record<string, string> = {
  shifts_filled: 'existing shifts filled',
  shifts_filled_by_hours: "shifts found through members' hours",
  shifts_created: 'shifts created',
  seats_matched_to_hours: 'seats paired with hours',
  seats_added: 'crew seats added',
  seats_updated: 'members re-seated',
  events_created: 'calendar events created',
  check_ins: 'check-ins',
  sheets_created: 'outreach sheets created',
  outreach_seats: 'outreach roles',
  members_created: 'former members created',
  already_imported: 'already imported',
};

interface StaffingCommitPanelProps {
  importId: string;
}

const StaffingCommitPanel: React.FC<StaffingCommitPanelProps> = ({ importId }) => {
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const [preview, setPreview] = useState<StaffingCommitPreview | null>(null);
  const [unfilled, setUnfilled] = useState<StaffingUnfilledView | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (action: () => Promise<void>, failure: string) => {
    setBusy(true);
    try {
      await action();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, failure));
    } finally {
      setBusy(false);
    }
  }, []);

  const loadUnfilled = useCallback(
    (target: number) =>
      historicalImportService
        .getStaffingUnfilled(importId, { offset: (target - 1) * PAGE_SIZE, limit: PAGE_SIZE })
        .then(setUnfilled),
    [importId]
  );

  useEffect(() => {
    void run(async () => {
      setPreview(await historicalImportService.getStaffingCommit(importId));
      await loadUnfilled(1);
    }, 'Could not read what the roster would write');
  }, [importId, run, loadUnfilled]);

  const changePage = (next: number) => {
    setPage(next);
    void run(() => loadUnfilled(next), 'Could not read the unfilled seats');
  };

  const assign = (line: number, userId: string) =>
    void run(async () => {
      setUnfilled(
        await historicalImportService.assignStaffingUnfilled(
          importId,
          { [String(line)]: userId || null },
          { offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }
        )
      );
      setPreview(await historicalImportService.getStaffingCommit(importId));
    }, 'Could not save that seat');

  const decideMembers = (members: Record<string, AdminMemberMapping | null>) =>
    void run(async () => {
      setPreview(await historicalImportService.updateStaffingMembers(importId, members));
    }, 'Could not save those members');

  const toggleUnstaffed = (include: boolean) =>
    void run(async () => {
      setPreview(await historicalImportService.setStaffingIncludeUnstaffed(importId, include));
    }, 'Could not save that change');

  const commit = async () => {
    if (!preview) return;
    const c = preview.counts;
    const ok = await confirm({
      title: 'Write the roster?',
      message: `This writes ${formatNumber(c.shift_seats ?? 0)} crew seats on ${formatNumber(
        c.shifts ?? 0
      )} shifts (filling the hours import's shifts where they exist), ${formatNumber(
        c.events ?? 0
      )} calendar events with ${formatNumber(c.check_ins ?? 0)} check-ins and ${formatNumber(
        c.outreach_seats ?? 0
      )} outreach roles. ${formatNumber(
        preview.hours_match.matched
      )} seats are paired with the hours their members already recorded and written onto those shifts. No hours are credited. Running it again writes nothing twice, and you can undo it afterwards.`,
      confirmLabel: 'Write the roster',
      cancelLabel: 'Not yet',
      variant: 'info',
    });
    if (!ok) return;
    await run(async () => {
      setPreview(await historicalImportService.commitStaffing(importId));
      toast.success('Roster written');
    }, 'Could not write the roster');
  };

  if (!preview) return <p className="text-theme-text-secondary text-sm">Working out what the roster would write…</p>;

  const counts = preview.counts;
  const skipped = Object.entries(preview.skipped).filter(([, n]) => n > 0);
  const result = preview.result;

  return (
    <div className="space-y-4">
      <h3 className="text-theme-text-primary font-semibold">Write the roster</h3>

      {result && (
        <p role="status" className="alert-success text-sm">
          Last written:{' '}
          {Object.entries(RESULT_LABELS)
            .flatMap(([key, label]) => {
              const n = result[key];
              return typeof n === 'number' && n > 0 ? [`${formatNumber(n)} ${label}`] : [];
            })
            .join(', ') || 'nothing new'}
          .
        </p>
      )}

      <StepUndo
        importId={importId}
        step={HistoricalUndoStep.STAFFING}
        noun="roster's shifts, seats and events"
        onUndone={() =>
          void run(async () => {
            setPreview(await historicalImportService.getStaffingCommit(importId));
            await loadUnfilled(page);
          }, 'Could not re-read the roster')
        }
      />

      <ul className="text-theme-text-secondary list-disc space-y-1 pl-5 text-sm">
        <li>
          {formatNumber(counts.shift_seats ?? 0)} crew seats on {formatNumber(counts.shifts ?? 0)} shifts.
        </li>
        <li>
          {formatNumber(counts.events ?? 0)} calendar events ({formatNumber(counts.upcoming_events ?? 0)} upcoming),{' '}
          {formatNumber(counts.check_ins ?? 0)} check-ins and {formatNumber(counts.outreach_seats ?? 0)} outreach roles.
        </li>
      </ul>

      <HoursMatchSummary match={preview.hours_match} tz={tz} />

      {(preview.hours_match.signups_without_hours > 0 ||
        preview.hours_match.hours_without_signup > 0 ||
        (preview.hours_match.paired_by_reviewer ?? 0) > 0) && (
        <Collapsible title="Review every unpaired seat and hours entry">
          <StaffingLeftovers
            importId={importId}
            tz={tz}
            onChanged={() =>
              void run(async () => {
                setPreview(await historicalImportService.getStaffingCommit(importId));
              }, 'Could not re-read the roster')
            }
          />
        </Collapsible>
      )}

      {skipped.length > 0 && (
        <div className="text-theme-text-secondary text-sm">
          <p>Left out:</p>
          <ul className="list-disc space-y-1 pl-5">
            {skipped.map(([reason, n]) => (
              <li key={reason}>
                {formatNumber(n)} seats {SKIP_REASONS[reason] ?? reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className="text-theme-text-primary flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="form-checkbox"
          checked={preview.include_unstaffed}
          disabled={busy}
          onChange={(e) => toggleUnstaffed(e.target.checked)}
        />
        Add events with no seats to the calendar too
      </label>

      <MembersToDecide
        members={preview.members}
        options={preview.member_options}
        busy={busy}
        idPrefix="staffing"
        onDecide={decideMembers}
      />

      {unfilled && unfilled.total > 0 && (
        <div className="space-y-2">
          <h4 className="text-theme-text-primary text-sm font-semibold">
            Unfilled seats ({formatNumber(unfilled.total)}, {formatNumber(unfilled.assigned)} assigned)
          </h4>
          <p className="text-theme-text-secondary text-xs">
            Nobody held these seats. Each is skipped unless you choose who held it.
          </p>
          <ul className="divide-theme-surface-border divide-y">
            {unfilled.items.map((seat) => {
              const id = `staffing-unfilled-${seat.line_number}`;
              return (
                <li key={seat.line_number} className="split-row gap-3 py-2">
                  <div className="split-row-main">
                    <label htmlFor={id} className="text-theme-text-primary text-sm font-medium">
                      {seat.title || 'Untitled seat'} → {seat.maps_to}
                    </label>
                    <p className="text-theme-text-muted text-xs">
                      {seat.date ? formatDate(seat.date, tz) : 'No date'} · {seat.activity} · line {seat.line_number}
                      {seat.required ? ' · required seat' : ''}
                    </p>
                  </div>
                  <select
                    id={id}
                    className="split-row-aside form-input sm:w-56"
                    value={seat.assigned_user_id ?? ''}
                    disabled={busy}
                    onChange={(e) => assign(seat.line_number, e.target.value)}
                  >
                    <option value="">Skip this seat</option>
                    {unfilled.member_options.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                        {member.membership_number ? ` (${member.membership_number})` : ''}
                      </option>
                    ))}
                  </select>
                </li>
              );
            })}
          </ul>
          {unfilled.total > PAGE_SIZE && (
            <Pagination currentPage={page} totalItems={unfilled.total} pageSize={PAGE_SIZE} onPageChange={changePage} />
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !preview.can_commit}
          onClick={() => void commit()}
        >
          {result ? 'Write again' : 'Write the roster'}
        </button>
      </div>
    </div>
  );
};

interface HoursMatchSummaryProps {
  match: StaffingHoursMatch;
  tz: string;
}

/** How the roster pairs with the hours already imported. */
const HoursMatchSummary: React.FC<HoursMatchSummaryProps> = ({ match, tz }) => (
  <section aria-labelledby="staffing-hours-match" className="space-y-2">
    <h4 id="staffing-hours-match" className="text-theme-text-primary text-sm font-semibold">
      Paired with the hours already imported
    </h4>
    <p className="text-theme-text-secondary text-xs">
      A seat pairs with the same member&apos;s hours entry whose time overlaps it by at least 30 minutes. A shift seat
      is written onto that shift, beside the hours and calls; an event seat is written there only when its title is a
      crew seat.
    </p>
    <ul className="text-theme-text-secondary list-disc space-y-1 pl-5 text-sm">
      <li>
        {formatNumber(match.matched)} seats paired with hours
        {(match.paired_by_reviewer ?? 0) > 0 ? `, ${formatNumber(match.paired_by_reviewer ?? 0)} of them by you` : ''}.
      </li>
      <li>
        {formatNumber(match.signups_without_hours)} seats with no hours entry: written as scheduled seats
        {(match.signups_reviewed ?? 0) > 0 ? ` (${formatNumber(match.signups_reviewed ?? 0)} reviewed)` : ''}.
      </li>
      <li>
        {formatNumber(match.hours_without_signup)} hours entries on the roster&apos;s days with no seat: they keep their
        hours and calls, with no position from the roster
        {(match.hours_reviewed ?? 0) > 0 ? ` (${formatNumber(match.hours_reviewed ?? 0)} reviewed)` : ''}.
      </li>
    </ul>
    {match.signups_without_hours_examples.length > 0 && (
      <Collapsible title={`Seats with no hours (first ${formatNumber(match.signups_without_hours_examples.length)})`}>
        <ul className="divide-theme-surface-border divide-y text-sm">
          {match.signups_without_hours_examples.map((seat, index) => (
            <li key={`${seat.date ?? ''}-${seat.title}-${seat.member}-${index}`} className="py-1.5">
              <span className="text-theme-text-primary">{seat.member || 'Member to be created'}</span>
              <span className="text-theme-text-muted">
                {' '}
                · {seat.title || 'Untitled seat'} · {seat.date ? formatDate(seat.date, tz) : 'No date'} ·{' '}
                {seat.activity}
              </span>
            </li>
          ))}
        </ul>
      </Collapsible>
    )}
    {match.hours_without_signup_examples.length > 0 && (
      <Collapsible title={`Hours with no seat (first ${formatNumber(match.hours_without_signup_examples.length)})`}>
        <ul className="divide-theme-surface-border divide-y text-sm">
          {match.hours_without_signup_examples.map((entry, index) => (
            <li key={`${entry.start}-${entry.member}-${index}`} className="py-1.5">
              <span className="text-theme-text-primary">{entry.member}</span>
              <span className="text-theme-text-muted">
                {' '}
                · {formatDate(entry.start, tz)}, {formatTime(entry.start, tz)} to {formatTime(entry.end, tz)}
              </span>
            </li>
          ))}
        </ul>
      </Collapsible>
    )}
  </section>
);

export default StaffingCommitPanel;
