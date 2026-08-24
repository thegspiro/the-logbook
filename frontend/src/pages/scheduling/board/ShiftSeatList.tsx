/**
 * One shift's crew: the seat rows and the single action beneath them.
 *
 * Shared by the desktop day panel and the phone day sheet so the two cannot
 * drift into different answers about the same shift — the phone variant only
 * changes the sizes, never the rules about which seats are open or what the
 * button does.
 */

import React from 'react';
import { ArrowLeftRight, Plus } from 'lucide-react';
import type { ShiftRecord } from '../../../modules/scheduling';
import type { SwapRequest } from '../../../types/scheduling';
import {
  buildSeats,
  canTakeSeat,
  firstClaimableSeat,
  memberInitials,
  shiftCrewName,
  shiftStatusInfo,
  statusBadgeLabel,
} from '../../../modules/scheduling/utils/shiftBoard';
import { formatTime } from '../../../utils/dateFormatting';
import { STATUS_STYLES } from './statusStyles';

export interface ShiftSeatListProps {
  shift: ShiftRecord;
  currentUserId: string | null | undefined;
  timezone: string;
  /** Positions the member is cleared for; empty disables claiming. */
  eligiblePositions: string[];
  /** True while a claim or release on this shift is in flight. */
  pending?: boolean;
  /** Take a specific seat. `position` is null for an unnamed open seat. */
  onClaim: (shift: ShiftRecord, position: string | null) => void;
  onRelease: (shift: ShiftRecord, choice?: 'drop' | 'trade') => void;
  /** Phone sheet: bigger avatars, a full-bleed action at the card's edge. */
  variant?: 'panel' | 'sheet';
  /** A pending offer of this seat to the current member, if there is one. */
  offerToMe?: SwapRequest | null;
  /** A pending offer the current member made of this seat. */
  offerFromMe?: SwapRequest | null;
  onAnswerOffer?: (offer: SwapRequest, accept: boolean) => void;
  onCancelOffer?: (offer: SwapRequest) => void;
}

export const ShiftSeatList: React.FC<ShiftSeatListProps> = ({
  shift,
  currentUserId,
  timezone,
  eligiblePositions,
  pending = false,
  onClaim,
  onRelease,
  variant = 'panel',
  offerToMe = null,
  offerFromMe = null,
  onAnswerOffer,
  onCancelOffer,
}) => {
  const info = shiftStatusInfo(shift, currentUserId);
  const seats = buildSeats(shift, currentUserId);
  const claimable = firstClaimableSeat(shift, eligiblePositions, currentUserId);
  const isSheet = variant === 'sheet';
  const avatar = isSheet ? 'h-6 w-6 text-[10px]' : 'h-[26px] w-[26px] text-[10px]';

  const timeRange = shift.end_time
    ? `${formatTime(shift.start_time, timezone)} – ${formatTime(shift.end_time, timezone)}`
    : formatTime(shift.start_time, timezone);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h4 className="text-theme-text-primary text-[15px] font-bold">{shiftCrewName(shift, timezone)}</h4>
        <span className="text-theme-text-muted font-mono text-xs">{timeRange}</span>
        <span
          className={`ml-auto rounded-full border px-2.5 py-[3px] text-[11px] font-bold ${STATUS_STYLES[info.status].chip}`}
        >
          {statusBadgeLabel(info)}
        </span>
      </div>

      <ul className="mb-3 flex flex-col gap-1.5">
        {seats.map((seat, index) => {
          const key = seat.member?.assignment_id ?? `open-${index}`;
          const label = seat.position ? seat.position.replace(/_/g, ' ') : 'Open seat';

          if (seat.member) {
            return (
              <li
                key={key}
                className={`flex items-center gap-2 rounded-md border px-2.5 py-[7px] ${
                  seat.isMine
                    ? 'border-blue-300 bg-blue-50 dark:border-blue-500/40 dark:bg-blue-500/10'
                    : 'border-theme-surface-border bg-theme-surface'
                }`}
              >
                <span
                  className={`flex shrink-0 items-center justify-center rounded-full font-mono font-bold ${avatar} ${
                    seat.isMine ? 'bg-blue-600 text-white' : 'bg-theme-surface-hover text-theme-text-secondary'
                  }`}
                  aria-hidden="true"
                >
                  {seat.isMine ? 'YOU' : memberInitials(seat.member.user_name)}
                </span>
                <span className="text-theme-text-primary min-w-0 truncate text-[13px] font-medium">
                  {seat.isMine ? 'You' : (seat.member.user_name ?? 'Assigned member')}
                </span>
                <span className="text-theme-text-muted ml-auto shrink-0 text-[11px] font-bold tracking-[0.08em] uppercase">
                  {label}
                </span>
              </li>
            );
          }

          const takeable = !pending && canTakeSeat(seat.position, eligiblePositions);
          return (
            <li key={key}>
              <button
                type="button"
                disabled={!takeable}
                onClick={() => onClaim(shift, seat.position)}
                className={`bg-theme-surface-secondary border-theme-input-border mobile-touch-target flex w-full items-center gap-2 rounded-md border border-dashed px-2.5 py-[7px] text-left transition-colors ${
                  takeable ? 'hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-500/10' : 'cursor-default'
                }`}
                aria-label={
                  takeable
                    ? `Take the ${seat.position ? label : 'open'} seat on this shift`
                    : `${seat.position ? label : 'Open'} seat — you are not cleared for it`
                }
              >
                <span
                  className={`border-theme-input-border text-theme-text-muted flex shrink-0 items-center justify-center rounded-full border border-dashed ${avatar}`}
                  aria-hidden="true"
                >
                  <Plus className="h-3 w-3" />
                </span>
                <span className="text-theme-text-muted text-[13px]">Open seat</span>
                {seat.position && (
                  <span className="text-theme-text-muted ml-auto shrink-0 text-[11px] font-bold tracking-[0.08em] uppercase">
                    {label}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {offerToMe && onAnswerOffer && (
        <div className="alert-info mb-3">
          <p className="text-theme-text-primary flex items-center gap-1.5 text-sm font-bold">
            <ArrowLeftRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            {offerToMe.requesting_user_name ?? 'A member'} offered you this seat
          </p>
          <p className="text-theme-text-secondary mt-0.5 text-xs">
            They stay on the roster until you answer, so the seat is never left empty.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => onAnswerOffer(offerToMe, true)}
              className="btn-primary btn-sm rounded-lg px-3 font-semibold"
            >
              Take the shift
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => onAnswerOffer(offerToMe, false)}
              className="btn-secondary btn-sm rounded-lg px-3 font-semibold"
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {offerFromMe && (
        <div className="alert-warning mb-3">
          <p className="text-theme-text-primary text-sm font-bold">
            Offered to {offerFromMe.target_user_name ?? 'a member'}
          </p>
          <p className="text-theme-text-secondary mt-0.5 text-xs">
            The shift is still yours until they accept. Nobody else can claim the seat while the offer stands.
          </p>
          {onCancelOffer && (
            <button
              type="button"
              disabled={pending}
              onClick={() => onCancelOffer(offerFromMe)}
              className="btn-secondary btn-sm mt-2.5 rounded-lg px-3 font-semibold"
            >
              Withdraw the offer
            </button>
          )}
        </div>
      )}

      {info.isMine ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => onRelease(shift)}
          className={`btn-secondary w-full justify-center rounded-lg text-sm font-bold ${
            isSheet ? 'min-h-[52px]' : 'min-h-[44px]'
          }`}
        >
          Give up this shift
        </button>
      ) : info.capacity !== null && info.openSeats === 0 ? (
        <p className="text-theme-text-muted border-theme-surface-border rounded-lg border border-dashed px-3 py-3 text-center text-[13px]">
          This crew is full. Nothing to claim here.
        </p>
      ) : claimable ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => onClaim(shift, claimable.position)}
          className={`btn-primary w-full justify-center rounded-lg text-sm font-bold ${
            isSheet ? 'min-h-[52px]' : 'min-h-[44px]'
          }`}
        >
          {pending ? 'Working…' : info.capacity === null ? 'Join this shift' : 'Take a seat on this shift'}
        </button>
      ) : (
        // Naming the reason matters: a greyed-out button with no explanation
        // reads as a broken page rather than as a qualification the member
        // has not earned yet.
        <p className="text-theme-text-muted border-theme-surface-border rounded-lg border border-dashed px-3 py-3 text-center text-[13px]">
          {eligiblePositions.length === 0
            ? 'You are not cleared for any seat on this shift.'
            : 'The open seats need a qualification you do not hold yet.'}
        </p>
      )}
    </div>
  );
};

export default ShiftSeatList;
