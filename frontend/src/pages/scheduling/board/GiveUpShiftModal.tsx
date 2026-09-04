/**
 * Giving up a shift, in three steps: choose, confirm, done.
 *
 * Never a bare destructive button on the calendar. The two ways out of a shift
 * differ in a way that matters to whoever is left covering it — releasing
 * empties the seat now, offering holds it until someone accepts — so the
 * choice is the first thing asked, and the consequence of each is spelled out
 * beside it rather than left to be discovered afterwards.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, ArrowLeftRight, Check, Loader2, X } from 'lucide-react';
import { Modal } from '../../../components/Modal';
import { schedulingService } from '../../../modules/scheduling';
import type { ShiftRecord, StandingShiftClaim, TradeCandidate } from '../../../modules/scheduling';
import { memberInitials, shiftCrewName, shiftStatusInfo } from '../../../modules/scheduling/utils/shiftBoard';
import { useSignupWindow } from '../../../modules/scheduling/hooks/useSignupWindow';
import { positionLabel } from '../../../modules/scheduling/utils/positionLabels';
import { calendarDaysFromToday, formatCalendarDate, formatTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';

export type GiveUpChoice = 'drop' | 'trade';

export interface GiveUpShiftModalProps {
  shift: ShiftRecord;
  /**
   * Which branch to land on. "Offer trade" on the next-shift card means the
   * member has already made the choice this modal opens by asking; re-asking
   * it is a tap that says nothing new.
   */
  initialChoice?: GiveUpChoice;
  currentUserId?: string | null;
  timezone: string;
  onClose: () => void;
  /** Called once the roster has actually changed, so the board can refetch. */
  onChanged: () => void;
}

export const GiveUpShiftModal: React.FC<GiveUpShiftModalProps> = ({
  shift,
  initialChoice = 'drop',
  currentUserId,
  timezone,
  onClose,
  onChanged,
}) => {
  const signupWindow = useSignupWindow();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [choice, setChoice] = useState<GiveUpChoice>(initialChoice);
  const [candidates, setCandidates] = useState<TradeCandidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [standingClaim, setStandingClaim] = useState<StandingShiftClaim | null>(null);
  const [endSeries, setEndSeries] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const info = shiftStatusInfo(shift, currentUserId, new Date(), signupWindow);
  const crewAfterRelease = Math.max(info.filled - 1, 0);
  const leadDays = calendarDaysFromToday(shift.shift_date, timezone);
  const target = candidates.find((c) => c.user_id === targetId) ?? null;

  const subtitle = [
    formatCalendarDate(shift.shift_date, { weekday: 'short', month: 'short', day: 'numeric' }),
    `${shiftCrewName(shift, timezone).replace(' Duty Crew', '')} ${formatTime(shift.start_time, timezone)}${
      shift.end_time ? `–${formatTime(shift.end_time, timezone)}` : ''
    }`,
    shift.apparatus_unit_number ?? shift.apparatus_name ?? '',
  ]
    .filter(Boolean)
    .join(' · ');

  // Only ask about the series when there is one. An always-present checkbox
  // invites a member to end a series they never set up.
  useEffect(() => {
    let cancelled = false;
    void schedulingService
      .getStandingClaimForShift(shift.id)
      .then((claim) => {
        if (!cancelled) setStandingClaim(claim);
      })
      .catch(() => {
        // Non-critical: without it the checkbox simply does not appear, and
        // the member can end the series from the standing-shift list.
      });
    return () => {
      cancelled = true;
    };
  }, [shift.id]);

  const loadCandidates = useCallback(() => {
    setCandidatesLoading(true);
    setCandidatesError(null);
    schedulingService
      .getTradeCandidates(shift.id)
      .then(setCandidates)
      .catch((err: unknown) => setCandidatesError(getErrorMessage(err, 'Could not load who is available.')))
      .finally(() => setCandidatesLoading(false));
  }, [shift.id]);

  const handleContinue = () => {
    if (choice === 'trade') loadCandidates();
    setStep(1);
  };

  const handleRelease = async () => {
    setSubmitting(true);
    try {
      await schedulingService.withdrawSignup(shift.id);
      if (endSeries && standingClaim) {
        // The remaining dates go with it — that is what the member ticked.
        await schedulingService.endStandingShift(standingClaim.id, true);
      }
      onChanged();
      setStep(2);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not release this shift.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleOffer = async () => {
    if (!target) return;
    setSubmitting(true);
    try {
      await schedulingService.createSwapRequest({
        offering_shift_id: shift.id,
        target_user_id: target.user_id,
      });
      onChanged();
      setStep(2);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not send the offer.'));
    } finally {
      setSubmitting(false);
    }
  };

  const footer = (() => {
    if (step === 2) {
      return (
        <button type="button" onClick={onClose} className="btn-primary min-h-[42px] rounded-lg">
          Done
        </button>
      );
    }
    if (step === 0) {
      return (
        <>
          <button type="button" onClick={handleContinue} className="btn-primary min-h-[42px] rounded-lg">
            Continue
          </button>
          <button type="button" onClick={onClose} className="btn-secondary min-h-[42px] rounded-lg">
            Cancel
          </button>
        </>
      );
    }
    return (
      <>
        {choice === 'drop' ? (
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleRelease()}
            className="focus:ring-theme-focus-ring inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2 font-semibold text-white shadow-sm transition-all hover:bg-red-800 focus:ring-2 focus:outline-hidden disabled:pointer-events-none disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Release shift
          </button>
        ) : (
          <button
            type="button"
            disabled={submitting || !target}
            onClick={() => void handleOffer()}
            className="btn-primary min-h-[42px] rounded-lg"
          >
            {target ? `Send offer to ${target.user_name ?? 'member'}` : 'Pick someone to cover'}
          </button>
        )}
        <button type="button" onClick={() => setStep(0)} className="btn-secondary min-h-[42px] rounded-lg">
          Back
        </button>
      </>
    );
  })();

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={step === 2 ? 'All set' : 'Give up this shift'}
      size="md"
      footer={footer}
      titleId="give-up-shift-title"
    >
      <p className="text-theme-text-secondary mb-4 font-mono text-[13px]">{subtitle}</p>

      {step === 0 && (
        <div className="flex flex-col gap-3">
          <ChoiceCard
            selected={choice === 'drop'}
            onSelect={() => setChoice('drop')}
            icon={<X className="h-[18px] w-[18px]" aria-hidden="true" />}
            title="Release it to the open list"
            body="The seat goes back on the calendar right away and the duty officer is notified. You are off the roster as soon as you confirm."
          />
          <ChoiceCard
            selected={choice === 'trade'}
            onSelect={() => setChoice('trade')}
            icon={<ArrowLeftRight className="h-[18px] w-[18px]" aria-hidden="true" />}
            title="Offer it to someone specific"
            body="Pick a member who can cover it. You stay on the roster until they accept, so the seat is never left empty."
          />
        </div>
      )}

      {step === 1 && choice === 'drop' && (
        <div className="flex flex-col gap-4">
          <div className="alert-danger flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 h-[18px] w-[18px] shrink-0 text-red-600 dark:text-red-400"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-bold text-red-800 dark:text-red-200">
                This drops the crew to {crewAfterRelease} of {info.capacity}
              </p>
              <p className="mt-0.5 text-[13px] text-red-700 dark:text-red-300">
                {leadDays !== null && leadDays >= 0
                  ? `${formatCalendarDate(shift.shift_date, { month: 'short', day: 'numeric' })} is ${
                      leadDays === 0 ? 'today' : `${leadDays} day${leadDays === 1 ? '' : 's'} out`
                    }. `
                  : ''}
                The duty officer will be notified so the seat can be filled.
              </p>
            </div>
          </div>

          {standingClaim && (
            <label className="text-theme-text-secondary mobile-touch-target flex items-start gap-2.5 text-[13px]">
              <input
                type="checkbox"
                checked={endSeries}
                onChange={(event) => setEndSeries(event.target.checked)}
                className="form-checkbox mt-0.5 accent-red-600"
              />
              <span>
                Also remove me from the rest of this standing series
                <span className="text-theme-text-muted block text-xs">
                  Ends the series and gives up its remaining dates. Leave it unticked to keep the shifts already on the
                  roster.
                </span>
              </span>
            </label>
          )}
        </div>
      )}

      {step === 1 && choice === 'trade' && (
        <div>
          <p className="text-theme-text-muted mb-2 text-[10px] font-bold tracking-[0.12em] uppercase">
            Available and qualified that {shiftCrewName(shift, timezone) === 'Night Duty Crew' ? 'night' : 'day'}
          </p>

          {candidatesLoading && (
            <p className="text-theme-text-muted flex items-center gap-2 py-6 text-sm" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking who is free…
            </p>
          )}
          {candidatesError && <p className="text-sm text-red-700 dark:text-red-300">{candidatesError}</p>}
          {!candidatesLoading && !candidatesError && candidates.length === 0 && (
            <p className="text-theme-text-muted border-theme-surface-border rounded-lg border border-dashed px-3 py-6 text-center text-sm">
              Nobody qualified is free that shift. Releasing it to the open list reaches everyone.
            </p>
          )}

          <ul className="flex flex-col gap-2">
            {candidates.map((candidate) => {
              const selected = candidate.user_id === targetId;
              return (
                <li key={candidate.user_id}>
                  <button
                    type="button"
                    onClick={() => setTargetId(candidate.user_id)}
                    aria-pressed={selected}
                    className={`mobile-touch-target flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      selected
                        ? 'border-2 border-red-600 bg-red-50 dark:border-red-500 dark:bg-red-500/10'
                        : 'border-theme-surface-border bg-theme-surface hover:bg-theme-surface-hover'
                    }`}
                  >
                    <span
                      className="bg-theme-surface-hover text-theme-text-secondary flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold"
                      aria-hidden="true"
                    >
                      {memberInitials(candidate.user_name)}
                    </span>
                    <span className="min-w-0">
                      <span className="text-theme-text-primary block truncate text-sm font-semibold">
                        {candidate.user_name ?? 'Member'}
                      </span>
                      <span className="text-theme-text-muted block text-xs">
                        {[
                          candidate.rank_display_name ?? positionLabel(candidate.position),
                          `${candidate.shifts_this_month} shift${candidate.shifts_this_month === 1 ? '' : 's'} this month`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span
                      className={`ml-auto shrink-0 rounded-full px-2.5 py-[3px] text-[11px] font-semibold ${
                        candidate.owes_trade
                          ? 'bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300'
                          : 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300'
                      }`}
                    >
                      {candidate.owes_trade ? 'Owes you a trade' : 'Free that shift'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {step === 2 && (
        <div className="py-4 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-green-200 bg-green-50 dark:border-green-500/40 dark:bg-green-500/10">
            <Check className="h-6 w-6 text-green-600 dark:text-green-400" aria-hidden="true" />
          </span>
          <h4 className="text-theme-text-primary text-[17px] font-bold">
            {choice === 'trade'
              ? `Offer sent to ${target?.user_name ?? 'them'}`
              : `You're off the ${formatCalendarDate(shift.shift_date, { month: 'short', day: 'numeric' })} shift`}
          </h4>
          <p className="text-theme-text-secondary mx-auto mt-1.5 max-w-[380px] text-sm">
            {choice === 'trade'
              ? `You are still on the roster until ${target?.user_name ?? 'they'} accept. If nobody accepts, the shift stays yours and the duty officer is notified.`
              : 'The seat is back on the calendar and the duty officer has been notified. Anyone qualified can now claim it.'}
          </p>
        </div>
      )}
    </Modal>
  );
};

interface ChoiceCardProps {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  body: string;
}

const ChoiceCard: React.FC<ChoiceCardProps> = ({ selected, onSelect, icon, title, body }) => (
  <button
    type="button"
    onClick={onSelect}
    aria-pressed={selected}
    className={`rounded-lg border px-4 py-3.5 text-left transition-colors ${
      selected
        ? 'border-2 border-red-600 bg-red-50 dark:border-red-500 dark:bg-red-500/10'
        : 'border-theme-surface-border bg-theme-surface hover:bg-theme-surface-hover'
    }`}
  >
    <span
      className={`flex items-center gap-2 text-[15px] font-bold ${
        selected ? 'text-red-700 dark:text-red-300' : 'text-theme-text-primary'
      }`}
    >
      {icon}
      {title}
    </span>
    <span className="text-theme-text-secondary mt-1 block text-[13px] leading-[18px]">{body}</span>
  </button>
);

export default GiveUpShiftModal;
