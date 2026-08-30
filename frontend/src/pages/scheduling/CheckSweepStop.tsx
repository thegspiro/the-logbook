/**
 * A stop's items, laid out to be read before they are answered.
 *
 * The lap asked one item at a time, each with its own card and its own pair of
 * buttons. A crew with gloves on and 130 items to get through reads the whole
 * cabinet first and then answers in a burst, so the layouts here are shaped for
 * reading: counts become a tally with par and found in columns, switches become
 * one line each with the test written beside them, and only gauges keep a card,
 * because a gauge is the one type whose stored value is the point.
 *
 * The rules are not restated here. Every answer goes through the same
 * `countAnswer` / `levelAnswer` / `expiryAnswer` the original controls call, so
 * "short of par is a restock, not a failure" and "an expired unit fails
 * whatever the crew taps" hold in both layouts or in neither.
 */

import { AlertTriangle, Check, X } from 'lucide-react';
import React from 'react';

import { CheckType, daysUntil, normalizeCheckType } from '@/modules/scheduling/types/equipmentCheck';

import { countAnswer, expiryAnswer, levelAnswer } from './checkAnswers';
import { type CheckItemAnswer, type CheckItemSpec } from './CheckItemControls';
import { type AnswerMap, type LapStop } from './checkLapModel';

export interface StopBodyProps {
  stop: LapStop;
  answers: AnswerMap;
  onAnswer: (itemId: string, patch: Partial<CheckItemAnswer>) => void;
  disabled?: boolean | undefined;
}

// ============================================================================
// Count — a tally, not a queue of cards
// ============================================================================

/**
 * Par and found in columns, so the whole cabinet is one glance.
 *
 * The value is the loud element and par is quiet beside it: par is printed on
 * the truck and never changes, while found is the thing being decided. Colour
 * says which of the three states it is in — unread, at par, short — because a
 * crew scanning back up the column is looking for the one that is orange.
 */
const CountTally: React.FC<StopBodyProps & { items: CheckItemSpec[] }> = ({ items, answers, onAnswer, disabled }) => (
  <div className="border-theme-surface-border overflow-hidden rounded-lg border">
    <div className="border-theme-surface-border bg-theme-surface-secondary text-theme-text-muted flex items-center gap-2 border-b px-3 py-2 text-[11px] font-bold tracking-[.06em] uppercase">
      <span className="flex-1">Item</span>
      <span className="w-10 text-center">Par</span>
      <span className="w-[132px] text-center">Found</span>
    </div>
    {items.map((item) => {
      const par = item.expectedQuantity ?? null;
      const found = answers[item.id]?.quantityFound;
      const short = par !== null && found !== undefined && found < par;
      const set = (next: number) => onAnswer(item.id, countAnswer(item, next));
      return (
        <div
          key={item.id}
          data-testid={`tally-row-${item.id}`}
          className="border-theme-surface-border flex items-center gap-2 border-b px-3 py-2 last:border-b-0"
        >
          <p className="text-theme-text-primary min-w-0 flex-1 text-[16px] font-semibold">{item.name}</p>
          <span className="text-theme-text-secondary w-10 text-center font-mono text-[16px] tabular-nums">
            {par ?? '—'}
          </span>
          <div className="flex w-[132px] items-center justify-end gap-1.5">
            <button
              type="button"
              disabled={disabled}
              onClick={() => set((found ?? par ?? 0) - 1)}
              aria-label={`One fewer ${item.name}`}
              className="border-theme-input-border text-theme-text-secondary hover:bg-theme-surface-hover h-11 w-11 shrink-0 rounded-lg border text-[20px] font-bold disabled:opacity-50"
            >
              −
            </button>
            <span
              data-testid={`tally-value-${item.id}`}
              className={`w-10 text-center font-mono text-[19px] font-bold tabular-nums ${
                found === undefined
                  ? 'text-theme-text-muted'
                  : short
                    ? 'text-orange-700 dark:text-orange-400'
                    : 'text-green-700 dark:text-green-400'
              }`}
            >
              {found ?? '—'}
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => set((found ?? par ?? 0) + 1)}
              aria-label={`One more ${item.name}`}
              className="border-theme-input-border text-theme-text-secondary hover:bg-theme-surface-hover h-11 w-11 shrink-0 rounded-lg border text-[20px] font-bold disabled:opacity-50"
            >
              +
            </button>
          </div>
        </div>
      );
    })}
  </div>
);

// ============================================================================
// Level — the one type that keeps a card
// ============================================================================

/**
 * A reading, its threshold, and what it read last shift.
 *
 * Last shift is on screen because the trend is the useful part: a cylinder
 * reading 1850 every shift and one reading 1850 after three weeks at 2100 are
 * different facts, and only the pair tells them apart.
 */
const GaugeCard: React.FC<{
  item: CheckItemSpec;
  answer: CheckItemAnswer | undefined;
  onAnswer: (patch: Partial<CheckItemAnswer>) => void;
  disabled?: boolean | undefined;
}> = ({ item, answer, onAnswer, disabled }) => {
  const unit = item.levelUnit?.trim() || '';
  const threshold = item.minLevel ?? null;
  const reading = answer?.levelReading;
  const short = threshold !== null && reading !== undefined && reading < threshold;
  const last = item.lastLevelReading;

  return (
    <div
      data-testid={`gauge-${item.id}`}
      className={`rounded-lg border p-3 ${
        short
          ? 'border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20'
          : 'border-theme-surface-border bg-theme-surface'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-theme-text-primary text-[16px] font-semibold">{item.name}</p>
        <span className="text-theme-text-muted text-[11px] font-bold tracking-[.06em] uppercase">Level</span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          data-testid={`gauge-input-${item.id}`}
          aria-label={`${item.name} reading${unit ? ` in ${unit}` : ''}`}
          value={reading ?? ''}
          disabled={disabled}
          onChange={(e) => onAnswer(levelAnswer(item, e.target.value))}
          placeholder="—"
          className={`form-input h-14 w-[118px] text-center font-mono text-[22px] tabular-nums ${short ? 'border-red-500' : ''}`}
        />
        {unit ? <span className="text-theme-text-secondary text-[15px]">{unit}</span> : null}
      </div>

      <div className="text-theme-text-muted mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[12px]">
        {threshold !== null && (
          <span className={short ? 'font-bold text-red-700 dark:text-red-400' : undefined}>
            Swap below {threshold}
            {unit ? ` ${unit}` : ''}
          </span>
        )}
        {last !== null && last !== undefined && (
          <span>
            Last shift {last}
            {unit ? ` ${unit}` : ''}
          </span>
        )}
      </div>

      {short && (
        <p className="mt-2 flex items-start gap-1.5 text-[13px] font-bold text-red-700 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Under the swap threshold — this opens a swap task and shows as a fault on the finished check.
        </p>
      )}
    </div>
  );
};

// ============================================================================
// Function — one line, the test beside it
// ============================================================================

const FunctionRow: React.FC<{
  item: CheckItemSpec;
  answer: CheckItemAnswer | undefined;
  onAnswer: (patch: Partial<CheckItemAnswer>) => void;
  disabled?: boolean | undefined;
}> = ({ item, answer, onAnswer, disabled }) => {
  const status = answer?.status;
  return (
    <div
      data-testid={`switch-${item.id}`}
      className="border-theme-surface-border flex items-center gap-3 border-b px-3 py-2 last:border-b-0"
    >
      <div className="min-w-0 flex-1">
        <p className="text-theme-text-primary text-[16px] font-semibold">{item.name}</p>
        {/* The test is written on the item so two people run it the same way. */}
        {item.description && <p className="text-theme-text-muted text-[13px]">{item.description}</p>}
      </div>
      <div className="flex shrink-0 gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAnswer({ status: 'pass' })}
          aria-label={`${item.name} works`}
          aria-pressed={status === 'pass'}
          className={`flex h-11 w-12 items-center justify-center rounded-lg border transition-colors disabled:opacity-50 ${
            status === 'pass'
              ? 'border-green-700 bg-green-700 text-white'
              : 'border-theme-input-border text-theme-text-secondary hover:border-green-700'
          }`}
        >
          <Check className="h-5 w-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAnswer({ status: 'fail' })}
          aria-label={`${item.name} does not work`}
          aria-pressed={status === 'fail'}
          className={`flex h-11 w-12 items-center justify-center rounded-lg border transition-colors disabled:opacity-50 ${
            status === 'fail'
              ? 'border-red-800 bg-red-800 text-white'
              : 'border-theme-input-border text-theme-text-secondary hover:border-red-800'
          }`}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// Expiry — confirmed, never retyped
// ============================================================================

const ExpiryRow: React.FC<{
  item: CheckItemSpec;
  answer: CheckItemAnswer | undefined;
  onAnswer: (patch: Partial<CheckItemAnswer>) => void;
  disabled?: boolean | undefined;
}> = ({ item, answer, onAnswer, disabled }) => {
  const days = daysUntil(item.expirationDate, new Date());
  const pullAt = item.expirationWarningDays ?? 30;
  const expired = days !== null && days < 0;
  const inWindow = days !== null && days >= 0 && days <= pullAt;
  const confirmed = answer?.expiryConfirmed === true;

  return (
    <div
      data-testid={`expiry-${item.id}`}
      className={`flex items-center gap-3 border-b px-3 py-2 last:border-b-0 ${
        expired
          ? 'border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20'
          : inWindow
            ? 'border-orange-200 bg-orange-50 dark:border-orange-900/40 dark:bg-orange-950/20'
            : 'border-theme-surface-border'
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-theme-text-primary text-[16px] font-semibold">{item.name}</p>
        <p
          className={`font-mono text-[13px] ${
            expired || inWindow ? 'font-bold text-orange-700 dark:text-orange-400' : 'text-theme-text-muted'
          }`}
        >
          {item.expirationDate ? `Expires ${item.expirationDate}` : 'No date on record'}
          {days !== null && ` · ${expired ? `${Math.abs(days)} days ago` : `${days} days`}`}
          {inWindow && ` · pull at ${pullAt}`}
        </p>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onAnswer(expiryAnswer(item))}
        className={`min-h-11 shrink-0 rounded-lg border px-3 text-[14px] font-bold transition-colors disabled:opacity-50 ${
          confirmed
            ? 'border-green-700 bg-green-700 text-white'
            : 'border-theme-input-border text-theme-text-secondary hover:border-green-700'
        }`}
      >
        {confirmed ? 'Read' : 'Confirm'}
      </button>
    </div>
  );
};

// ============================================================================
// The stop
// ============================================================================

/**
 * Groups by type rather than keeping template order, because the layouts are
 * per type and interleaving them would put a tally header between two switches.
 * Within a group the template's order is kept — that order is the order the
 * items sit in the cabinet.
 */
export const CheckSweepStop: React.FC<StopBodyProps> = ({ stop, answers, onAnswer, disabled }) => {
  const of = (type: string) => stop.items.filter((i) => normalizeCheckType(i.checkType) === type);
  const counts = of(CheckType.COUNT);
  const gauges = of(CheckType.LEVEL);
  const switches = of(CheckType.FUNCTION);
  const dates = of(CheckType.EXPIRY);
  const labels = stop.items.filter((i) => {
    const t = normalizeCheckType(i.checkType);
    return t === CheckType.HEADER || t === CheckType.TEXT;
  });

  return (
    <div className="flex flex-col gap-3">
      {labels.map((item) =>
        normalizeCheckType(item.checkType) === CheckType.HEADER ? (
          <p key={item.id} className="text-theme-text-muted text-[11px] font-bold tracking-[.06em] uppercase">
            {item.name}
          </p>
        ) : (
          <p key={item.id} className="text-theme-text-secondary text-[13px]">
            {item.name}
          </p>
        )
      )}

      {counts.length > 0 && (
        <CountTally stop={stop} items={counts} answers={answers} onAnswer={onAnswer} disabled={disabled} />
      )}

      {gauges.map((item) => (
        <GaugeCard
          key={item.id}
          item={item}
          answer={answers[item.id]}
          onAnswer={(patch) => onAnswer(item.id, patch)}
          disabled={disabled}
        />
      ))}

      {(switches.length > 0 || dates.length > 0) && (
        <div className="border-theme-surface-border overflow-hidden rounded-lg border">
          {switches.map((item) => (
            <FunctionRow
              key={item.id}
              item={item}
              answer={answers[item.id]}
              onAnswer={(patch) => onAnswer(item.id, patch)}
              disabled={disabled}
            />
          ))}
          {dates.map((item) => (
            <ExpiryRow
              key={item.id}
              item={item}
              answer={answers[item.id]}
              onAnswer={(patch) => onAnswer(item.id, patch)}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default CheckSweepStop;
