/**
 * Records → Possible Double Credit: a finalized event's record beside a record
 * the member already had for the same class on the same day.
 *
 * Owner decision 2026-11-23: finalizing a Training event never merges its
 * credit into a self-report or a hand-entered record, and never takes one
 * over. When the two look like the same class — the same library course, or
 * names that match once case, spacing and punctuation are ignored — the pair
 * waits here. Until an officer keeps both or voids one, the member's hours
 * count twice. Voiding uses the ordinary record void: the member is told, with
 * the reason, and any program credit the record fed is taken back.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { EmptyState, PromptDialog } from '../../components/ux';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useTimezone } from '../../hooks/useTimezone';
import { trainingService } from '../../services/api';
import type { DoubleCreditPair, DoubleCreditRecord, DoubleCreditView } from '../../types/training';
import { formatDate, formatNumber } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';

interface DoubleCreditPanelProps {
  /** Called after a decision, so the hub re-reads its attention queue. */
  onResolved?: (() => void) | undefined;
}

/** Which record of a pair the void dialog is open for. */
interface VoidTarget {
  pair: DoubleCreditPair;
  record: DoubleCreditRecord;
  side: 'event' | 'other';
}

const hours = (value: number) => `${formatNumber(value)} ${value === 1 ? 'hour' : 'hours'}`;

const DoubleCreditPanel: React.FC<DoubleCreditPanelProps> = ({ onResolved }) => {
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const [view, setView] = useState<DoubleCreditView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null);
  const [voidError, setVoidError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await trainingService.getDoubleCredit());
      setLoadError(null);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Could not read the possible double credit'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const otherLabel = (pair: DoubleCreditPair) => (pair.other_from_self_report ? 'Self-report' : 'Entered by hand');

  const keepBoth = async (pair: DoubleCreditPair) => {
    const ok = await confirm({
      title: `Keep both records for ${pair.member_name}?`,
      message: `${pair.member_name} keeps ${hours(pair.event_record.hours_completed)} from the event and ${hours(
        pair.other_record.hours_completed
      )} from the other record. Use this when they really are two different classes. Finalizing the event again will not raise this pair again.`,
      confirmLabel: 'Keep both',
      cancelLabel: 'Not yet',
      variant: 'info',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await trainingService.keepBothDoubleCredit(pair.id);
      toast.success('Both records kept');
      onResolved?.();
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not keep both records'));
    } finally {
      setBusy(false);
    }
  };

  const submitVoid = async (reason: string) => {
    if (!voidTarget) return;
    setBusy(true);
    try {
      await trainingService.voidRecord(voidTarget.record.id, reason);
      toast.success('Record voided');
      setVoidTarget(null);
      setVoidError(null);
      onResolved?.();
      await load();
    } catch (err: unknown) {
      setVoidError(getErrorMessage(err, 'Could not void that record'));
    } finally {
      setBusy(false);
    }
  };

  const recordBlock = (pair: DoubleCreditPair, record: DoubleCreditRecord, label: string) => (
    <div className="min-w-0">
      <p className="text-theme-text-muted text-xs font-medium tracking-wide uppercase">{label}</p>
      <p className="text-theme-text-primary font-medium break-words">{record.course_name}</p>
      <p className="text-theme-text-secondary">
        {hours(record.hours_completed)}
        {record.completion_date ? ` · ${formatDate(record.completion_date, tz)}` : ''}
      </p>
      <span className="sr-only">for {pair.member_name}</span>
    </div>
  );

  return (
    <div className="space-y-4 py-6">
      <div>
        <h2 className="text-theme-text-primary text-lg font-semibold">Possible Double Credit</h2>
        <p className="text-theme-text-secondary mt-1 text-sm">
          A finalized event credited a member who already had a record of the same class on the same day — a self-report
          or one entered by hand. Neither record was changed, so the hours count twice until you keep both or void one.
          Records match when they name the same library course, or when their names are the same once case, spacing and
          punctuation are ignored.
        </p>
      </div>

      {loadError && (
        <p role="alert" className="alert-error text-sm">
          {loadError}
        </p>
      )}

      {!view && !loadError && <p className="text-theme-text-secondary text-sm">Reading the possible double credit…</p>}

      {view && view.items.length === 0 && (
        <EmptyState title="No possible double credit" description="Nothing is waiting on a decision." />
      )}

      {view && view.items.length > 0 && (
        <ul className="divide-theme-surface-border card divide-y">
          {view.items.map((pair) => (
            <li key={pair.id} className="space-y-3 p-4 text-sm">
              <div className="split-row gap-2">
                <p className="split-row-main text-theme-text-primary font-semibold">{pair.member_name}</p>
                <p className="split-row-aside text-theme-text-muted text-xs">
                  {pair.match_reason === 'same_course' ? 'Same course' : 'Same name'} · found{' '}
                  {formatDate(pair.detected_at, tz)}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {recordBlock(pair, pair.event_record, 'From the event')}
                {recordBlock(pair, pair.other_record, otherLabel(pair))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  aria-label={`Keep both records for ${pair.member_name}`}
                  onClick={() => void keepBoth(pair)}
                >
                  Keep both
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  aria-label={`Void the event's record for ${pair.member_name}`}
                  onClick={() => {
                    setVoidError(null);
                    setVoidTarget({ pair, record: pair.event_record, side: 'event' });
                  }}
                >
                  Void the event’s record
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  aria-label={`Void the ${otherLabel(pair).toLowerCase()} for ${pair.member_name}`}
                  onClick={() => {
                    setVoidError(null);
                    setVoidTarget({ pair, record: pair.other_record, side: 'other' });
                  }}
                >
                  Void the {pair.other_from_self_report ? 'self-report' : 'hand-entered'} record
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <PromptDialog
        isOpen={voidTarget !== null}
        onClose={() => {
          setVoidTarget(null);
          setVoidError(null);
        }}
        onSubmit={(reason) => void submitVoid(reason)}
        title={
          voidTarget?.side === 'event'
            ? 'Void the event’s record?'
            : `Void ${voidTarget?.pair.member_name ?? ''}’s record?`
        }
        message={
          voidTarget
            ? `“${voidTarget.record.course_name}”, ${hours(voidTarget.record.hours_completed)}, stops counting. ${
                voidTarget.pair.member_name
              } is told, with your reason. Any program credit it fed is taken back.`
            : undefined
        }
        label="Reason"
        hint="Shown to the member."
        multiline
        required
        confirmLabel="Void record"
        cancelLabel="Keep it"
        confirmVariant="warning"
        loading={busy}
        error={voidError}
      />
    </div>
  );
};

export default DoubleCreditPanel;
