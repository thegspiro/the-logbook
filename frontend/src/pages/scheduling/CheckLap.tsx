/**
 * The check, ordered as a lap of the vehicle.
 *
 * The list is stops in walking order — wall, compartment, shelf, bag,
 * stretcher — rather than a category tree, so the order on screen is the order
 * in front of the crew. A category tree is a filing system, and a filing
 * system is a thing you navigate; a lap is a thing you walk. Reading a truck
 * by category means crossing it four times.
 *
 * The current stop opens in place and finished stops collapse to a line, so
 * the screen holds one stop's worth of decisions at a time. **The numbering is
 * a route, not a lock**: any stop can be opened at any point, because a crew
 * interrupted at stop 3 comes back to whichever end of the truck they are
 * standing at, and a checklist that argues with them is one they work around.
 */

import { AlertTriangle, Check, ChevronDown, ChevronRight } from 'lucide-react';
import React from 'react';

import { CheckItemControl, type CheckItemAnswer } from './CheckItemControls';
import { CheckType, containerTypeLabel, normalizeCheckType } from '@/modules/inventory/types/equipmentCheck';

import {
  answerableItems,
  bulkConfirmable,
  bulkLabel,
  contentsAreSealed,
  isStopComplete,
  stopFailures,
  type AnswerMap,
  type LapStop,
} from './checkLapModel';

// ============================================================================
// The seal
// ============================================================================

/**
 * What the seal says, and what it therefore asks of the crew.
 *
 * Intact: read the tag and move on. Broken: the contents are unknown again, so
 * every pocket is counted — and the replacement tag is named here so the crew
 * that re-seals reaches for a number on the record rather than inventing one,
 * which is what keeps the chain traceable.
 */
export const SealBanner: React.FC<{ stop: LapStop }> = ({ stop }) => {
  const seal = stop.seal;
  if (!stop.isSealed || !seal) return null;

  if (seal.status === 'intact') {
    return (
      <div
        data-testid={`seal-${stop.id}`}
        className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-900/40 dark:bg-green-950/20"
      >
        <p className="flex items-center gap-1.5 text-sm font-semibold text-green-800 dark:text-green-400">
          <Check className="h-4 w-4" aria-hidden="true" />
          Sealed{seal.tagNumber ? ` · tag ${seal.tagNumber}` : ''}
        </p>
        <p className="text-theme-text-secondary mt-1 text-xs">
          Check the tag matches. The counting inside is cleared — expiry dates and readings still are not.
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid={`seal-${stop.id}`}
      className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-950/20"
    >
      <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-400">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        Seal broken · count all pockets
      </p>
      {seal.brokenAt || seal.brokenNote ? (
        <p className="text-theme-text-secondary mt-1 text-xs">
          Opened{seal.brokenAt ? ` ${seal.brokenAt}` : ''}
          {seal.brokenNote ? ` on ${seal.brokenNote}` : ''}.
        </p>
      ) : null}
      {seal.replacementTagNumber ? (
        <p className="text-theme-text-secondary mt-1 text-xs">
          Tag {seal.replacementTagNumber}
          {seal.tagNumber ? ` replaces ${seal.tagNumber}` : ''} when you re-seal.
        </p>
      ) : null}
    </div>
  );
};

// ============================================================================
// One stop
// ============================================================================

interface CheckLapProps {
  stops: LapStop[];
  answers: AnswerMap;
  openStopId: string | null;
  onOpenStop: (stopId: string) => void;
  onAnswer: (itemId: string, patch: Partial<CheckItemAnswer>) => void;
  /** Mark everything in this stop that can be marked without a reading. */
  onAllGood?: ((stopId: string) => void) | undefined;
  disabled?: boolean;
}

interface StopProps {
  stop: LapStop;
  index: number;
  open: boolean;
  answers: AnswerMap;
  onOpen: () => void;
  onAnswer: (itemId: string, patch: Partial<CheckItemAnswer>) => void;
  onAllGood?: (() => void) | undefined;
  disabled?: boolean;
  depth?: number;
}

export const CheckStop: React.FC<StopProps> = ({
  stop,
  index,
  open,
  answers,
  onOpen,
  onAnswer,
  onAllGood,
  disabled,
  depth = 0,
}) => {
  const items = answerableItems(stop);
  const failures = stopFailures(stop, answers);
  const complete = isStopComplete(stop, answers);
  const hasLevels = items.length !== bulkConfirmable(items).length;
  const sealed = contentsAreSealed(stop);

  return (
    <li className="border-theme-surface-border border-b last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        data-testid={`stop-${stop.id}`}
        className="hover:bg-theme-surface-hover flex min-h-[56px] w-full items-center gap-3 px-3 py-3 text-left"
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            failures.length > 0
              ? 'bg-red-800 text-white'
              : complete
                ? 'bg-green-600 text-white'
                : 'border-theme-surface-border text-theme-text-muted border'
          }`}
        >
          {failures.length > 0 ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
        </span>

        <span className="min-w-0 flex-1">
          <span className="text-theme-text-primary block truncate text-sm font-semibold">{stop.name}</span>
          {/* A collapsed stop shows its fault rather than its item count. The
              count is what you need before you walk it; once something is
              wrong, the fault is the only thing worth the line. */}
          {!open && failures.length > 0 ? (
            <span className="block truncate text-xs font-medium text-red-600">
              {failures[0]?.name} — {normalizeCheckType(failures[0]?.checkType)} check failed
              {failures.length > 1 ? ` · +${failures.length - 1} more` : ''}
            </span>
          ) : !open ? (
            <span className="text-theme-text-muted block text-xs">
              {stop.children?.length
                ? `${stop.children.length} ${containerTypeLabel(stop.children[0]?.containerType).toLowerCase()}${
                    stop.children.length === 1 ? '' : 's'
                  }`
                : `${items.length} item${items.length === 1 ? '' : 's'}`}
            </span>
          ) : null}
        </span>

        {open ? (
          <ChevronDown className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
        )}
      </button>

      {open ? (
        <div className="flex flex-col gap-4 px-3 pb-4" style={depth ? { paddingLeft: 12 + depth * 12 } : undefined}>
          <SealBanner stop={stop} />

          {onAllGood && items.length > 0 && !sealed ? (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                data-testid={`all-good-${stop.id}`}
                disabled={disabled}
                onClick={onAllGood}
                className="border-theme-surface-border text-theme-text-secondary flex min-h-[44px] w-fit items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:border-green-600 hover:text-green-700"
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                {bulkLabel(items)}
              </button>
              {hasLevels ? <p className="text-theme-text-muted text-xs">Gauges are left for you to read.</p> : null}
            </div>
          ) : null}

          {stop.items.map((item) => {
            const type = normalizeCheckType(item.checkType);
            if (type === CheckType.HEADER) {
              return (
                <p key={item.id} className="text-theme-text-muted text-xs font-semibold tracking-wide uppercase">
                  {item.name}
                </p>
              );
            }
            if (type === CheckType.TEXT) {
              return (
                <p key={item.id} className="text-theme-text-secondary text-sm">
                  {item.name}
                </p>
              );
            }
            return (
              <div key={item.id} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-theme-text-primary text-sm font-medium">{item.name}</span>
                  <span className="text-theme-text-muted shrink-0 text-[11px] tracking-wide uppercase">{type}</span>
                </div>
                <CheckItemControl
                  item={item}
                  answer={answers[item.id]}
                  onChange={(patch) => onAnswer(item.id, patch)}
                  {...(disabled === undefined ? {} : { disabled })}
                />
              </div>
            );
          })}

          {/* Pockets, front to back in the order you unzip them. An intact
              seal clears the counting inside, so they collapse — but see
              sealCannotClear: expiry dates and readings are still asked for
              above, because a seal proves unchanged, not full. */}
          {!sealed && stop.children?.length ? (
            <CheckPockets
              pockets={stop.children}
              answers={answers}
              onAnswer={onAnswer}
              {...(onAllGood ? { onAllGood } : {})}
              {...(disabled === undefined ? {} : { disabled })}
              depth={depth + 1}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
};

// ============================================================================
// Pockets
// ============================================================================

/**
 * A bag is a stop with its own stops.
 *
 * Which pocket is open is local disclosure, not something the walk needs to
 * know about, so it is held here rather than lifted into the form. The four
 * item types behave the same inside a bag as they do on a wall.
 */
export const CheckPockets: React.FC<{
  pockets: LapStop[];
  answers: AnswerMap;
  onAnswer: (itemId: string, patch: Partial<CheckItemAnswer>) => void;
  onAllGood?: (() => void) | undefined;
  disabled?: boolean;
  depth?: number;
}> = ({ pockets, answers, onAnswer, onAllGood, disabled, depth = 1 }) => {
  const [openId, setOpenId] = React.useState<string | null>(pockets[0]?.id ?? null);
  const openIndex = pockets.findIndex((p) => p.id === openId);
  const next = openIndex >= 0 ? pockets[openIndex + 1] : undefined;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-theme-text-muted text-xs font-semibold tracking-wide uppercase" data-testid="pocket-progress">
        {openIndex >= 0 ? `Pocket ${openIndex + 1}/${pockets.length}` : `${pockets.length} pockets`}
      </p>
      <ul className="border-theme-surface-border divide-theme-surface-border divide-y rounded-lg border">
        {pockets.map((pocket, i) => (
          <CheckStop
            key={pocket.id}
            stop={pocket}
            index={i}
            open={pocket.id === openId}
            answers={answers}
            onOpen={() => setOpenId(pocket.id === openId ? null : pocket.id)}
            onAnswer={onAnswer}
            {...(onAllGood ? { onAllGood } : {})}
            {...(disabled === undefined ? {} : { disabled })}
            depth={depth}
          />
        ))}
      </ul>
      {next ? (
        <button
          type="button"
          data-testid="next-pocket"
          onClick={() => setOpenId(next.id)}
          className="border-theme-surface-border text-theme-text-secondary min-h-[44px] w-full rounded-lg border text-sm font-medium"
        >
          Next pocket · {next.name}
        </button>
      ) : null}
    </div>
  );
};

// ============================================================================
// The lap
// ============================================================================

export const CheckLap: React.FC<CheckLapProps> = ({
  stops,
  answers,
  openStopId,
  onOpenStop,
  onAnswer,
  onAllGood,
  disabled,
}) => {
  const openIndex = stops.findIndex((s) => s.id === openStopId);
  const next = openIndex >= 0 ? stops[openIndex + 1] : undefined;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-theme-text-muted text-xs font-semibold tracking-wide uppercase" data-testid="lap-progress">
        {openIndex >= 0 ? `Stop ${openIndex + 1}/${stops.length}` : `${stops.length} stops`}
      </p>

      <ul className="border-theme-surface-border divide-theme-surface-border card divide-y overflow-hidden rounded-lg border">
        {stops.map((stop, i) => (
          <CheckStop
            key={stop.id}
            stop={stop}
            index={i}
            open={stop.id === openStopId}
            answers={answers}
            onOpen={() => onOpenStop(stop.id)}
            onAnswer={onAnswer}
            {...(onAllGood ? { onAllGood: () => onAllGood(stop.id) } : {})}
            {...(disabled === undefined ? {} : { disabled })}
          />
        ))}
      </ul>

      {next ? (
        <button
          type="button"
          data-testid="next-stop"
          onClick={() => onOpenStop(next.id)}
          className="btn-primary min-h-[48px] w-full"
        >
          Next stop · {next.name}
        </button>
      ) : null}
    </div>
  );
};

export default CheckLap;
