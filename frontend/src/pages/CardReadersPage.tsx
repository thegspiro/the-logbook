/**
 * Card Readers — which rooms take member ID card taps at their kiosk, and how
 * each reader is being used.
 *
 * URL: /locations/card-readers. Opens for room managers and tag writers
 * (`locations.manage`, `facilities.manage`, `locations.manage_nfc_tags`) with
 * or without the Facilities module, because a department on the plain
 * Locations page runs room kiosks too.
 *
 * Two things the server decides and this page only reflects:
 *   * switching a reader is `locations.manage_nfc_tags`, and turning one on
 *     also needs the NFC ID Cards integration (turning off never does);
 *   * whose card a tap was is shown only to a viewer who also holds
 *     `members.manage_id_cards` — everyone else sees that a tap happened and
 *     how it ended.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Nfc } from 'lucide-react';
import toast from 'react-hot-toast';
import { Breadcrumbs } from '../components/ux';
import { EmptyState } from '../components/ux/EmptyState';
import { useConfirm } from '../contexts/ConfirmContext';
import { useTimezone } from '../hooks/useTimezone';
import { locationsService } from '../services/api';
import { nfcActivityService } from '../services/nfcActivityService';
import { formatDateTime, formatNumber } from '../utils/dateFormatting';
import { getErrorMessage } from '../utils/errorHandling';
import { CardTapTable } from '../modules/membership/components/CardTapTable';
import type { NfcCardTap, NfcReaderList, NfcReaderRoom } from '../modules/membership/types/idCard';

const ROOM_TAPS_PAGE = 25;

const roomLabel = (room: NfcReaderRoom): string =>
  [room.name, room.building, room.roomNumber ? `Room ${room.roomNumber}` : null].filter(Boolean).join(' · ');

interface RoomTapsProps {
  room: NfcReaderRoom;
  showMembers: boolean;
  tz: string;
}

const RoomTaps: React.FC<RoomTapsProps> = ({ room, showMembers, tz }) => {
  const [taps, setTaps] = useState<NfcCardTap[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      setError(null);
      try {
        const page = await nfcActivityService.listRoomTaps(room.locationId, {}, ROOM_TAPS_PAGE, offset);
        setTaps((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
        setTotal(page.total);
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Unable to load this room’s taps'));
      } finally {
        setLoading(false);
      }
    },
    [room.locationId]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  if (error) {
    return <p className="text-theme-alert-danger-text p-3 text-sm">{error}</p>;
  }
  if (!loading && taps.length === 0) {
    return <p className="text-theme-text-secondary p-3 text-sm">No card has been tapped at this room’s kiosk.</p>;
  }
  return (
    <div className="space-y-2">
      {!showMembers && (
        <p className="text-theme-text-muted px-3 pt-3 text-xs">
          Who tapped is shown only to people who manage member ID cards.
        </p>
      )}
      <CardTapTable
        taps={taps}
        tz={tz}
        columns={{ member: showMembers, card: showMembers, where: false, target: true }}
        targetLabel="Event"
      />
      {taps.length < total && (
        <div className="p-3">
          <button
            type="button"
            className="btn-secondary btn-auto"
            disabled={loading}
            onClick={() => void load(taps.length)}
          >
            {loading ? 'Loading…' : `Show more (${formatNumber(total - taps.length)} older)`}
          </button>
        </div>
      )}
    </div>
  );
};

const CardReadersPage: React.FC = () => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const [data, setData] = useState<NfcReaderList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyOn, setOnlyOn] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setData(await nfcActivityService.listReaders());
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load card readers'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rooms = useMemo(() => (data?.items ?? []).filter((room) => !onlyOn || room.readerEnabled), [data, onlyOn]);

  const toggle = async (room: NfcReaderRoom) => {
    const enabling = !room.readerEnabled;
    if (
      enabling &&
      !(await confirm({
        title: 'Turn on badge check-in',
        message: `Members will be able to tap their ID card at the "${room.name}" kiosk to check in to the event open there, or out if they are already in — with nobody signed in at the kiosk. Turn it on only where a card reader is mounted beside the display.`,
        confirmLabel: 'Turn on',
        cancelLabel: 'Leave it off',
      }))
    )
      return;
    setSwitching(room.locationId);
    try {
      const updated = await locationsService.setBadgeCheckIn(room.locationId, enabling);
      const now = updated.nfc_badge_check_in_enabled ?? enabling;
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((r) => (r.locationId === room.locationId ? { ...r, readerEnabled: now } : r)),
            }
          : prev
      );
      toast.success(enabling ? 'Badge check-in turned on' : 'Badge check-in turned off');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to change badge check-in'));
    } finally {
      setSwitching(null);
    }
  };

  const onCount = data?.items.filter((r) => r.readerEnabled).length ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <Breadcrumbs />
      <div className="flex items-center gap-3">
        <Nfc className="text-theme-text-secondary h-6 w-6" aria-hidden="true" />
        <div>
          <h1 className="text-theme-text-primary text-2xl font-bold">Card Readers</h1>
          <p className="text-theme-text-secondary text-sm">
            Rooms whose kiosk accepts member ID card taps, and how each reader has been used.
          </p>
        </div>
      </div>

      {data && !data.cardsEnabled && (
        <div className="alert-warning flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-sm">
            NFC ID cards are turned off under Settings → Integrations, so no reader accepts taps and none can be turned
            on. Readers can still be turned off, and taps recorded while cards were on are still listed.
          </p>
        </div>
      )}

      {error && (
        <div className="alert-danger flex items-start gap-2">
          <AlertTriangle className="text-theme-alert-danger-icon mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-theme-alert-danger-text text-sm">{error}</p>
        </div>
      )}

      {data && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-theme-text-secondary text-sm">
            {formatNumber(onCount)} of {formatNumber(data.items.length)} rooms have a reader turned on. Counts cover the
            last {data.days} days.
          </p>
          <label className="text-theme-text-primary flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={onlyOn}
              onChange={(e) => setOnlyOn(e.target.checked)}
            />
            Only rooms with a reader on
          </label>
        </div>
      )}

      {!loading && data && rooms.length === 0 && (
        <div className="card p-4">
          <EmptyState
            headingLevel={2}
            icon={Nfc}
            title={data.items.length === 0 ? 'No rooms yet' : 'No room has a reader turned on'}
            description={
              data.items.length === 0
                ? 'Add rooms under Locations first.'
                : 'Turn a reader on for a room where a card reader is mounted beside its kiosk display.'
            }
          />
        </div>
      )}

      {data && rooms.length > 0 && (
        <ul className="space-y-3">
          {rooms.map((room) => {
            const expanded = open === room.locationId;
            const canTurnOn = data.cardsEnabled || room.readerEnabled;
            return (
              <li key={room.locationId} className="card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <h2 className="text-theme-text-primary font-semibold">{roomLabel(room)}</h2>
                    <p className="text-theme-text-secondary text-sm">
                      {formatNumber(room.taps)} taps · {formatNumber(room.refusals)} refused
                      {' · '}
                      {room.lastTapAt ? `last tap ${formatDateTime(room.lastTapAt, tz)}` : 'never tapped'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {data.canSwitch && canTurnOn ? (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={room.readerEnabled}
                        aria-label={`Badge check-in at ${room.name}`}
                        aria-disabled={switching === room.locationId}
                        onClick={() => {
                          if (switching) return;
                          void toggle(room);
                        }}
                        className="text-theme-text-secondary touch:min-h-11 flex items-center gap-2 text-sm"
                      >
                        <span
                          className={`toggle-track-sm ${room.readerEnabled ? 'bg-green-700' : 'bg-theme-surface-border'}`}
                        >
                          <span
                            className={`toggle-knob-sm ${room.readerEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                          />
                        </span>
                        {room.readerEnabled ? 'Reader on' : 'Reader off'}
                      </button>
                    ) : (
                      <span className="text-theme-text-secondary text-sm">
                        {room.readerEnabled ? 'Reader on' : 'Reader off'}
                      </span>
                    )}
                    <button
                      type="button"
                      className="btn-secondary btn-auto inline-flex items-center gap-1.5"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : room.locationId)}
                    >
                      {expanded ? (
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      )}
                      Recent taps
                    </button>
                  </div>
                </div>
                {expanded && (
                  <div className="border-theme-surface-border border-t">
                    <RoomTaps room={room} showMembers={data.canSeeMembers} tz={tz} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default CardReadersPage;
