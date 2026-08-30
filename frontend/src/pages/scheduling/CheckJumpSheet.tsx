/**
 * The escape hatch: every stop, where you are, and the flat list.
 *
 * The sweep hands the crew one stop at a time, which is the right default and
 * the wrong constraint. A crew interrupted at stop 3 comes back to whichever
 * end of the truck they are standing at; somebody covering a bag they know is
 * fine wants to be there now; somebody auditing wants the whole thing as one
 * list. All three are the same request — *let me out of the sequence* — so the
 * sheet answers it once rather than three times.
 *
 * Progress and faults ride on each row because the question behind opening this
 * is usually "what have I not done", and a list of names alone cannot say.
 */

import { AlertTriangle, Check, List, X } from 'lucide-react';
import React from 'react';

import { DialogPanel } from '@/components/ux/DialogPanel';
import { DialogPortal } from '@/components/DialogPortal';

import {
  answerableItems,
  stillAsked,
  stopAnswered,
  stopMapState,
  stopRestocks,
  stopFailures,
  type AnswerMap,
  type LapStop,
} from './checkLapModel';

export interface CheckJumpSheetProps {
  stops: LapStop[];
  answers: AnswerMap;
  current: number;
  onJump: (index: number) => void;
  onShowFlatList: () => void;
  onClose: () => void;
}

export const CheckJumpSheet: React.FC<CheckJumpSheetProps> = ({
  stops,
  answers,
  current,
  onJump,
  onShowFlatList,
  onClose,
}) => (
  <DialogPortal>
    <div
      className="modal-overlay z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="jump-sheet-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/* The cap is on the panel: a sheet taller than the viewport in a
          flex-centred container is reachable at neither end. (CLAUDE.md #21) */}
      <DialogPanel onClose={onClose} className="flex max-h-[85dvh] w-full max-w-[520px] flex-col rounded-b-none p-0">
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <div>
            <h2 id="jump-sheet-title" className="text-theme-text-primary text-[20px] leading-7 font-bold">
              Jump to a stop
            </h2>
            <p className="text-theme-text-muted text-[13px]">
              Walk it in any order — the numbers are a route, not a lock.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the jump sheet"
            className="text-theme-text-muted hover:text-theme-text-primary mobile-touch-target flex items-center justify-center rounded-md"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto px-4">
          <ul className="border-theme-surface-border overflow-hidden rounded-lg border">
            {stops.map((stop, index) => {
              const state = stopMapState(stop, answers);
              const answered = stopAnswered(stop, answers);
              // What the crew is actually being asked for, not every item in
              // the container: an intact seal clears the counting inside, and
              // a sealed box reading "0/1" beside a green tick asks a question
              // it has already answered.
              const total = stillAsked(stop).length;
              const isCurrent = index === current;
              const faults = stopFailures(stop, answers);
              const restocks = stopRestocks(stop, answers);
              return (
                <li key={stop.id}>
                  <button
                    type="button"
                    onClick={() => onJump(index)}
                    aria-current={isCurrent ? 'step' : undefined}
                    className={`border-theme-surface-border flex w-full items-center gap-3 border-b px-3 py-3 text-left last:border-b-0 ${
                      isCurrent
                        ? 'bg-theme-surface-secondary border-l-4 border-l-slate-900 dark:border-l-white'
                        : state === 'fault'
                          ? 'bg-red-50 dark:bg-red-950/20'
                          : 'hover:bg-theme-surface-hover'
                    }`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${
                        state === 'complete'
                          ? 'bg-green-700 text-white'
                          : state === 'fault'
                            ? 'bg-red-800 text-white'
                            : state === 'restock'
                              ? 'bg-orange-700 text-white'
                              : isCurrent
                                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                                : 'border-theme-surface-border text-theme-text-muted border'
                      }`}
                      aria-hidden="true"
                    >
                      {state === 'complete' ? <Check className="h-4 w-4" /> : index + 1}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="text-theme-text-primary block text-[15px] font-semibold">
                        {index + 1} · {stop.name}
                      </span>
                      {faults.length > 0 && (
                        <span className="block text-[13px] font-semibold text-red-700 dark:text-red-400">
                          {faults[0]?.name}
                          {faults.length > 1 ? ` +${faults.length - 1} more` : ''}
                        </span>
                      )}
                      {faults.length === 0 && restocks.length > 0 && (
                        <span className="block text-[13px] text-orange-700 dark:text-orange-400">
                          {restocks.length} restock line{restocks.length === 1 ? '' : 's'}
                        </span>
                      )}
                      {isCurrent && <span className="text-theme-text-muted block text-[13px]">You are here</span>}
                      {stop.isSealed && stop.seal?.status !== 'broken' && (
                        <span className="block text-[13px] font-semibold text-green-700 dark:text-green-400">
                          Sealed{stop.seal?.tagNumber ? ` · tag ${stop.seal.tagNumber}` : ''}
                        </span>
                      )}
                    </span>

                    {total > 0 && (
                      <span className="text-theme-text-muted shrink-0 font-mono text-[13px] tabular-nums">
                        {answered}/{total}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onShowFlatList}
            className="btn-secondary flex min-h-12 w-full items-center justify-center gap-2 text-[15px] font-semibold"
          >
            <List className="h-4 w-4" aria-hidden="true" />
            Show every item as one list
          </button>
        </div>
      </DialogPanel>
    </div>
  </DialogPortal>
);

/**
 * The flat list, for the crew that wants the whole thing at once.
 *
 * Deliberately not a second way to answer: it is a reading surface, and every
 * row jumps to the stop that owns it. Two places to answer the same item is two
 * places for the answer to differ.
 */
export const CheckFlatList: React.FC<{
  stops: LapStop[];
  answers: AnswerMap;
  onJump: (index: number) => void;
  onClose: () => void;
}> = ({ stops, answers, onJump, onClose }) => (
  <DialogPortal>
    <div
      className="modal-overlay z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="flat-list-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <DialogPanel onClose={onClose} className="flex max-h-[85dvh] w-full max-w-[520px] flex-col rounded-b-none p-0">
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <div>
            <h2 id="flat-list-title" className="text-theme-text-primary text-[20px] leading-7 font-bold">
              Every item
            </h2>
            <p className="text-theme-text-muted text-[13px]">Tap any line to go to the stop it belongs to.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the item list"
            className="text-theme-text-muted hover:text-theme-text-primary mobile-touch-target flex items-center justify-center rounded-md"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {stops.map((stop, index) => {
            const asked = new Set(stillAsked(stop).map((i) => i.id));
            const cleared = new Set(
              answerableItems(stop)
                .filter((i) => !asked.has(i.id))
                .map((i) => i.id)
            );
            return (
              <div key={stop.id} className="mb-3">
                <p className="text-theme-text-muted mb-1 text-[11px] font-bold tracking-[.06em] uppercase">
                  {index + 1} · {stop.name}
                </p>
                <ul className="border-theme-surface-border overflow-hidden rounded-lg border">
                  {answerableItems(stop).map((item) => {
                    const status = answers[item.id]?.status;
                    const failed = status === 'fail' || status === 'out_of_service';
                    const answered = status !== undefined && status !== 'not_checked';
                    // "Every item" means every item, including the ones an intact
                    // seal has cleared — but those are not unanswered, they are
                    // answered by the tag, and saying otherwise sends a crew to
                    // count through a seal.
                    const state = failed
                      ? 'Fault'
                      : answered
                        ? 'Done'
                        : cleared.has(item.id)
                          ? 'Sealed'
                          : 'Not answered';
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => onJump(index)}
                          // Named explicitly: the name and the state are adjacent
                          // spans, and JSX drops the newline between them, so the
                          // computed name would run them together as one word.
                          aria-label={`${item.name}, ${state}, go to stop ${index + 1}`}
                          className="border-theme-surface-border hover:bg-theme-surface-hover flex w-full items-center gap-2 border-b px-3 py-2 text-left last:border-b-0"
                        >
                          {failed ? (
                            <AlertTriangle
                              className="h-4 w-4 shrink-0 text-red-700 dark:text-red-400"
                              aria-hidden="true"
                            />
                          ) : answered ? (
                            <Check className="h-4 w-4 shrink-0 text-green-700 dark:text-green-400" aria-hidden="true" />
                          ) : (
                            <span
                              className="border-theme-surface-border h-4 w-4 shrink-0 rounded-full border"
                              aria-hidden="true"
                            />
                          )}
                          <span className="text-theme-text-primary min-w-0 flex-1 text-[15px]">{item.name}</span>
                          <span className="text-theme-text-muted shrink-0 text-[12px]">{state}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </DialogPanel>
    </div>
  </DialogPortal>
);
