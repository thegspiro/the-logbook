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

import { AlertTriangle, Check, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import React from 'react';

import { CheckType, daysUntil, normalizeCheckType } from '@/modules/inventory/types/equipmentCheck';

import { countAnswer, expiryAnswer, levelAnswer } from './checkAnswers';
import { FaultDetail, type CheckItemAnswer, type CheckItemSpec } from './CheckItemControls';
import {
  contentsAreSealed,
  expiryUrgency,
  sealBlockers,
  sealCannotClear,
  type AnswerMap,
  type LapStop,
  type SealState,
} from './checkLapModel';

export interface StopBodyProps {
  stop: LapStop;
  answers: AnswerMap;
  onAnswer: (itemId: string, patch: Partial<CheckItemAnswer>) => void;
  /** Records the crew's reading of a tamper seal. Absent on a read-only body. */
  onSeal?: ((stopId: string, patch: Partial<SealState>) => void) | undefined;
  /**
   * A seal further up is already standing in for this pocket's contents.
   *
   * A pocket is inside its bag's seal, and the model agrees: `isStopComplete`
   * and `stillAsked` clear the whole tree, not just the bag's own shelf. Without
   * this the counting in a pocket stays on screen while the tally reports it
   * answered — six rows asking to be filled in under "2 of 2 answered".
   */
  clearedByAncestorSeal?: boolean | undefined;
  /**
   * Which pocket to show, for a stop that has them.
   *
   * The sweep hands over one pocket at a time and owns the strip that
   * navigates them, so the body shows the one that is open. Absent — the
   * builder's preview, a read-only render — every pocket stacks, because
   * there is nothing to drive the strip.
   */
  openPocketIndex?: number | undefined;
  /**
   * The calendar day every expiry here is judged against.
   *
   * The organization's day, not the device's. A phone in another timezone an
   * hour either side of midnight lands on a different date, and expiry is the
   * one verdict that comes from the department's own record rather than from
   * the crew — so the sweep and the accordion have to agree on which day it is.
   */
  today?: Date | undefined;
  disabled?: boolean | undefined;
}

// ============================================================================
// Count — a tally, not a queue of cards
// ============================================================================

/**
 * Par and found in columns, so the whole cabinet is one glance.
 *
 * The value is the loud element and par is quiet beside it: par is printed on
 * the truck and never changes, while found is the thing being decided.
 *
 * The three states — unread, at par, short — are carried by the value's colour
 * and, for short, by a tint on the whole row: high-contrast holds every alert
 * text at #f0f0f0, so colour alone would collapse two of the three there.
 */
const CountTally: React.FC<Omit<StopBodyProps, 'stop'> & { items: CheckItemSpec[] }> = ({
  items,
  answers,
  onAnswer,
  disabled,
}) => {
  // One line under the table rather than a caption on every carried row: the
  // tally is built to be scanned down, and a repeated sub-label in each row is
  // the thing that stops it being scannable.
  const anyCarried = items.some((item) => {
    const answer = answers[item.id];
    const unconfirmed = answer?.status === undefined || answer.status === 'not_checked';
    return unconfirmed && (answer?.quantityFound ?? item.carriedQuantity) != null;
  });

  return (
    <div className="flex flex-col gap-1.5">
      <div className="border-theme-surface-border overflow-hidden rounded-lg border">
        <div className="border-theme-surface-border bg-theme-surface-secondary text-theme-text-muted flex items-center gap-2 border-b px-3 py-2 text-[11px] font-bold tracking-[.06em] uppercase">
          <span className="flex-1">Item</span>
          <span className="w-10 text-center">Par</span>
          <span className="w-[132px] text-center">Found</span>
        </div>
        {items.map((item) => {
          const par = item.expectedQuantity ?? null;
          const answer = answers[item.id];
          // A carried number is on the screen before anybody looks at the shelf, so
          // the value shown and the value confirmed are two different things. The
          // status is what separates them: the seed is written `not_checked`
          // precisely so a crew cannot submit a full report having looked at
          // nothing — and the row has to say so, or the number reads as a check.
          const confirmed = answer?.status !== undefined && answer.status !== 'not_checked';
          const found = answer?.quantityFound ?? item.carriedQuantity ?? undefined;
          const short = par !== null && found !== undefined && found < par;
          const carried = found !== undefined && !confirmed;
          const set = (next: number) => onAnswer(item.id, countAnswer(item, next));
          return (
            <div
              key={item.id}
              data-testid={`tally-row-${item.id}`}
              // The short row is tinted, not just its number recoloured. In
              // high-contrast every `--alert-*-text` is #f0f0f0 — the theme puts
              // severity on the ground and the border and keeps text white — so a
              // colour-only distinction between "at par" and "short" disappears
              // exactly where legibility matters most.
              className={`border-theme-surface-border flex items-center gap-2 border-b px-3 py-2 last:border-b-0 ${
                short && !carried ? 'bg-theme-alert-warning-bg' : ''
              }`}
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
                    found === undefined || carried
                      ? 'text-theme-text-muted'
                      : short
                        ? 'text-theme-alert-warning-text'
                        : 'text-theme-alert-success-text'
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

      {anyCarried && (
        <p data-testid="tally-carried-note" className="text-theme-text-muted text-[12px]">
          Grey numbers are carried from the last check. Change what is different — the rest still needs confirming.
        </p>
      )}
    </div>
  );
};

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
          ? 'bg-theme-alert-danger-bg border-theme-alert-danger-border'
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
          className={`form-input h-14 w-[118px] text-center font-mono text-[22px] tabular-nums ${short ? 'border-theme-alert-danger-icon' : ''}`}
        />
        {unit ? <span className="text-theme-text-secondary text-[15px]">{unit}</span> : null}
      </div>

      <div className="text-theme-text-muted mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[12px]">
        {threshold !== null && (
          <span className={short ? 'text-theme-alert-danger-title font-bold' : undefined}>
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
        <p className="text-theme-alert-danger-title mt-2 flex items-start gap-1.5 text-[13px] font-bold">
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
    <div data-testid={`switch-${item.id}`} className="border-theme-surface-border border-b last:border-b-0">
      <div className="flex items-center gap-3 px-3 py-2">
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
                ? 'border-green-800 bg-green-800 text-white'
                : 'border-theme-input-border text-theme-text-secondary hover:border-green-800'
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

      {/* A fault opens the same two fields here as in the accordion, from the
          same component — a note written on one screen and a note written on
          the other are the same field on the same record. */}
      {status === 'fail' && (
        <div className="px-3 pb-3">
          <FaultDetail item={item} answer={answer} onChange={onAnswer} disabled={disabled} />
        </div>
      )}
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
  today: Date;
}> = ({ item, answer, onAnswer, disabled, today }) => {
  const days = daysUntil(item.expirationDate, today);
  const pullAt = item.expirationWarningDays ?? 30;
  const expired = days !== null && days < 0;
  const inWindow = days !== null && days >= 0 && days <= pullAt;
  const confirmed = answer?.expiryConfirmed === true;

  return (
    <div
      data-testid={`expiry-${item.id}`}
      className={`flex items-center gap-3 border-b px-3 py-2 last:border-b-0 ${
        expired
          ? 'bg-theme-alert-danger-bg border-theme-alert-danger-border'
          : inWindow
            ? 'bg-theme-alert-warning-bg border-theme-alert-warning-border'
            : 'border-theme-surface-border'
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-theme-text-primary text-[16px] font-semibold">{item.name}</p>
        <p
          className={`font-mono text-[13px] ${
            expired
              ? 'text-theme-alert-danger-title font-bold'
              : inWindow
                ? 'text-theme-alert-warning-text font-bold'
                : 'text-theme-text-muted'
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
            ? 'border-green-800 bg-green-800 text-white'
            : 'border-theme-input-border text-theme-text-secondary hover:border-green-800'
        }`}
      >
        {confirmed ? 'Read' : 'Confirm'}
      </button>
    </div>
  );
};

// ============================================================================
// One level's items
// ============================================================================

/**
 * Groups by type rather than keeping template order, because the layouts are
 * per type and interleaving them would put a tally header between two switches.
 * Within a group the template's order is kept — that order is the order the
 * items sit in the cabinet.
 */
const ItemGroups: React.FC<Omit<StopBodyProps, 'stop'> & { items: CheckItemSpec[] }> = ({
  items,
  answers,
  onAnswer,
  disabled,
  today = new Date(),
}) => {
  const of = (type: string) => items.filter((i) => normalizeCheckType(i.checkType) === type);
  const counts = of(CheckType.COUNT);
  const gauges = of(CheckType.LEVEL);
  const switches = of(CheckType.FUNCTION);
  const dates = of(CheckType.EXPIRY);
  const labels = items.filter((i) => {
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

      {counts.length > 0 && <CountTally items={counts} answers={answers} onAnswer={onAnswer} disabled={disabled} />}

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
              today={today}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Seal — the tag answers for the contents, or it does not
// ============================================================================

/**
 * A tamper seal, and the one question it puts to the crew.
 *
 * The record supplies both numbers before anyone has looked, so all that is
 * being asked is whether the tag on the container is the tag on the record.
 * That is deliberately two buttons and not three: a broken seal and an intact
 * seal bearing the wrong number have the same consequence — no evidence the
 * container stayed shut, so the full count comes back — and asking a crew to
 * classify which kind of wrong it is buys nothing they would act on.
 *
 * A matching tag clears the counting inside and nothing else. Dates and
 * pressures move while the container sits shut, so they are still asked; a
 * seal proves unchanged, not full.
 */
const SealCard: React.FC<{
  stop: LapStop;
  onSeal: ((stopId: string, patch: Partial<SealState>) => void) | undefined;
  disabled?: boolean | undefined;
  today: Date;
}> = ({ stop, onSeal, disabled, today }) => {
  const seal = stop.seal;
  const status = seal?.status;
  const tag = seal?.tagNumber;
  const blockers = sealBlockers(stop, today);

  // An intact tag does not survive contact with a drug that is expiring. The
  // crew is going in whatever the tag says, so this branch is checked first
  // and the calm green banner never renders over it.
  if (blockers.length > 0 && status !== 'broken') {
    return (
      <div data-testid={`seal-${stop.id}`} className="alert-danger p-3">
        <p className="text-theme-alert-danger-title flex items-center gap-1.5 text-[15px] font-bold">
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          Break the seal — something inside has to come out
        </p>
        <ul className="text-theme-text-secondary mt-1 flex flex-col gap-0.5 text-[13px]">
          {blockers.map((item) => (
            <li key={item.id} data-testid={`seal-blocker-${item.id}`}>
              <span className="font-semibold">{item.name}</span>{' '}
              {expiryUrgency(item, today) === 'expired' ? 'has expired' : 'is inside the pull window'}
              {item.expirationDate ? <span className="font-mono"> · {item.expirationDate}</span> : null}
            </li>
          ))}
        </ul>
        <p className="text-theme-text-secondary mt-1.5 text-[13px]">
          The tag is only evidence that nothing was taken — it says nothing about what is still usable. Open it, replace
          {blockers.length === 1 ? ' it' : ' them'}, and re-seal
          {seal?.replacementTagNumber ? (
            <>
              {' '}
              with <span className="font-mono font-bold">{seal.replacementTagNumber}</span>
            </>
          ) : null}
          . The full count is below, because once it is open the seal vouches for nothing.
        </p>
        {onSeal && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSeal(stop.id, { status: 'broken' })}
            className="border-theme-alert-danger-icon text-theme-alert-danger-title bg-theme-surface mt-2.5 min-h-12 w-full rounded-lg border text-[15px] font-bold"
          >
            I have broken the seal
          </button>
        )}
      </div>
    );
  }

  // Intact, but the number is not the one on record. Not a broken seal — and
  // not evidence either, which is why the count below is still being asked.
  if (status === 'intact' && seal?.cleared === false) {
    return (
      <div data-testid={`seal-${stop.id}`} className="alert-warning p-3">
        <p className="text-theme-alert-warning-text flex items-center gap-1.5 text-[15px] font-bold">
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          Tag intact, but not the one on record
        </p>
        <p className="text-theme-text-secondary mt-0.5 text-[13px]">
          A number nobody recognises is evidence the container was opened, not evidence it was not — so the full count
          is below.
        </p>
      </div>
    );
  }

  if (status === 'intact') {
    return (
      <div data-testid={`seal-${stop.id}`} className="alert-success p-3">
        <p className="text-theme-alert-success-title flex items-center gap-1.5 text-[15px] font-bold">
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          Seal intact{tag ? <span className="font-mono">· {tag}</span> : null}
        </p>
        <p className="text-theme-text-secondary mt-0.5 text-[13px]">
          The counting inside is answered by the tag. Dates and readings are still asked — a seal proves unchanged, not
          full.
        </p>
        {onSeal && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSeal(stop.id, { status: 'broken' })}
            className="text-theme-text-secondary mt-2 min-h-11 text-[13px] font-semibold underline"
          >
            Actually, the tag is broken or wrong
          </button>
        )}
      </div>
    );
  }

  if (status === 'broken') {
    return (
      <div data-testid={`seal-${stop.id}`} className="alert-warning p-3">
        <p className="text-theme-alert-warning-text flex items-center gap-1.5 text-[15px] font-bold">
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          Seal broken or wrong
        </p>
        <p className="text-theme-text-secondary mt-0.5 text-[13px]">
          Nothing vouches for the contents, so the full count is back below.
          {seal?.replacementTagNumber ? (
            <>
              {' '}
              Re-seal with <span className="font-mono font-bold">{seal.replacementTagNumber}</span>.
            </>
          ) : null}
        </p>
        {onSeal && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSeal(stop.id, { status: 'intact' })}
            className="text-theme-text-secondary mt-2 min-h-11 text-[13px] font-semibold underline"
          >
            Undo — the tag matches after all
          </button>
        )}
      </div>
    );
  }

  return (
    <div data-testid={`seal-${stop.id}`} className="border-theme-surface-border rounded-lg border p-3">
      <p className="text-theme-text-primary text-[15px] font-bold">Read the tag before you open it</p>
      <p className="text-theme-text-secondary mt-0.5 text-[13px]">
        {tag ? (
          <>
            The record says <span className="font-mono font-bold">{tag}</span>.
          </>
        ) : (
          'No tag number on record for this container.'
        )}
      </p>
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={disabled || !onSeal}
          onClick={() => onSeal?.(stop.id, { status: 'intact' })}
          className="min-h-14 rounded-lg border border-green-800 bg-green-800 text-[15px] font-bold text-white disabled:opacity-50"
        >
          Tag matches
        </button>
        <button
          type="button"
          disabled={disabled || !onSeal}
          onClick={() => onSeal?.(stop.id, { status: 'broken' })}
          className="border-theme-input-border text-theme-text-secondary min-h-14 rounded-lg border text-[15px] font-bold hover:border-red-800 disabled:opacity-50"
        >
          Broken or wrong
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// The stop
// ============================================================================

/**
 * A stop's own items, then its pockets.
 */
export const CheckSweepStop: React.FC<StopBodyProps> = ({
  stop,
  answers,
  onAnswer,
  onSeal,
  disabled,
  clearedByAncestorSeal,
  openPocketIndex,
  today = new Date(),
}) => {
  // An intact tag answers the counting, so those rows come off the screen
  // rather than sitting there inviting a crew to count through a seal they
  // have just vouched for. What it cannot answer stays.
  //
  // A pocket carries its own seal where it has one — the flatten helper on main
  // promotes a sealed bag out of its parent for exactly this reason, that a
  // seal is a claim about one container and needs a group of its own. Here the
  // nesting gives it that group, so an inner seal is answered on its own card
  // and an outer one clearing says nothing about it.
  const sealed = clearedByAncestorSeal === true || contentsAreSealed(stop, today);
  const own = sealed ? sealCannotClear(stop.items) : stop.items;

  // One pocket while the sweep is driving the strip, all of them when nothing
  // is. Never none: a pocket that renders nowhere is an item the tally counts
  // and the crew cannot reach.
  const pockets = stop.children ?? [];
  const slice = openPocketIndex === undefined ? pockets : pockets.slice(openPocketIndex, openPocketIndex + 1);
  const shownPockets = slice.length > 0 ? slice : pockets;

  return (
    <div className="flex flex-col gap-3">
      {stop.isSealed && <SealCard stop={stop} onSeal={onSeal} disabled={disabled} today={today} />}

      <ItemGroups items={own} answers={answers} onAnswer={onAnswer} disabled={disabled} today={today} />

      {/* Pockets. A bag is one stop, not several — the crew is standing in front
        of the whole thing — so its pockets are sections inside this screen
        rather than stops of their own. Recursive because the model lets a
        pocket hold pockets, and rendering one level deep is the same bug as
        rendering none: stopItems() counts the whole tree, so the tally would
        ask for items that are nowhere on screen. */}
      {shownPockets.map((pocket) => (
        <section key={pocket.id} data-testid={`pocket-${pocket.id}`} className="flex flex-col gap-2">
          {/* The sweep puts the open pocket's name on its own heading above
              the body, so repeating it here would say it twice. */}
          {openPocketIndex === undefined && (
            <h3 className="text-theme-text-secondary border-theme-surface-border border-l-2 pl-2 text-[13px] font-bold">
              {pocket.name}
            </h3>
          )}
          <CheckSweepStop
            stop={pocket}
            answers={answers}
            onAnswer={onAnswer}
            onSeal={onSeal}
            disabled={disabled}
            // A pocket with its own tag answers for itself; otherwise it is
            // inside whatever the bag's tag has already settled.
            clearedByAncestorSeal={pocket.isSealed ? false : sealed}
            today={today}
          />
        </section>
      ))}
    </div>
  );
};

export default CheckSweepStop;
