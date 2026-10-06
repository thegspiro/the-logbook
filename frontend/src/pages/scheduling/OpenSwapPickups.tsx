/**
 * Open Swap Pickups
 *
 * Open swaps — a member's "I can't make this one", naming nobody — that the
 * viewer is cleared to take. The server lists only seats the viewer passes the
 * signup eligibility rule for (the same rule exchanges use), and picking one up
 * moves the seat at once: there is no officer step, because taking it is the
 * offerer withdrawing and the viewer signing up, both already self-service.
 * Leave, overlap and the seat cap are re-checked on the pickup itself, so a
 * listed shift can still be refused with the reason.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { HandHeart, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { OpenSwapPickup } from '../../modules/scheduling/types';
import { positionLabel } from '../../modules/scheduling/utils/positionLabels';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDateCustom, formatTime } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';

interface OpenSwapPickupsProps {
  /** Called after a pickup so the surrounding request list can refresh. */
  onPickedUp: () => void;
}

export const OpenSwapPickups: React.FC<OpenSwapPickupsProps> = ({ onPickedUp }) => {
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const [items, setItems] = useState<OpenSwapPickup[]>([]);
  const [pickingUp, setPickingUp] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await schedulingService.getOpenSwaps());
    } catch (err: unknown) {
      setItems([]);
      toast.error(getErrorMessage(err, 'Could not load the open shifts you can pick up'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const describe = (item: OpenSwapPickup): string => {
    const day = formatDateCustom(
      `${item.shift_date}T12:00:00`,
      { weekday: 'short', month: 'short', day: 'numeric' },
      tz
    );
    const time = item.start_time ? ` ${formatTime(item.start_time, tz)}` : '';
    return `${day}${time}`;
  };

  const pickUp = async (item: OpenSwapPickup) => {
    const seat = item.position ? positionLabel(item.position) : 'a seat';
    const ok = await confirm({
      title: 'Pick up this shift?',
      message: `You take ${item.requesting_user_name || 'the member'}’s ${seat} on ${describe(item)}. It comes off their roster and onto yours straight away.`,
      confirmLabel: 'Pick it up',
      cancelLabel: 'Not now',
      variant: 'info',
    });
    if (!ok) return;
    setPickingUp(item.swap_request_id);
    try {
      await schedulingService.pickUpOpenSwap(item.swap_request_id);
      toast.success('The shift is yours');
      onPickedUp();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not pick up this shift'));
    } finally {
      setPickingUp(null);
      // Reloaded either way: a refusal usually means somebody else took it.
      void load();
    }
  };

  if (items.length === 0) return null;

  return (
    <section aria-labelledby="open-swaps-heading" className="space-y-2">
      <h3 id="open-swaps-heading" className="text-theme-text-primary text-sm font-semibold">
        Open shifts you can pick up
      </h3>
      <p className="text-theme-text-muted text-xs">
        Members who can’t make these asked for cover, and you’re cleared for the seat.
      </p>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.swap_request_id} className="card flex items-center justify-between gap-3 p-3 sm:p-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-500/10">
                <HandHeart className="h-4 w-4 text-green-700 dark:text-green-400" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-theme-text-primary text-sm font-medium">
                  {describe(item)}
                  {item.apparatus_label ? ` · ${item.apparatus_label}` : ''}
                </p>
                <p className="text-theme-text-muted text-xs">
                  {item.position ? `${positionLabel(item.position)} · ` : ''}
                  from {item.requesting_user_name || 'a member'}
                </p>
                {item.reason && <p className="text-theme-text-secondary mt-1 line-clamp-2 text-xs">{item.reason}</p>}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                void pickUp(item);
              }}
              disabled={pickingUp !== null}
              className="btn-success inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium"
              aria-label={`Pick up ${describe(item)} from ${item.requesting_user_name || 'a member'}`}
            >
              {pickingUp === item.swap_request_id && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              )}
              Pick up
            </button>
          </div>
        ))}
      </div>
    </section>
  );
};

export default OpenSwapPickups;
