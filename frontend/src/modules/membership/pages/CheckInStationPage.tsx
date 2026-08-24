/**
 * ID Card Check-In Station
 *
 * A phone, tablet or desktop left at the door of a station, a drill night or a
 * meeting. An officer picks what is being checked into, arms the reader, and
 * from then on members tap their ID card and walk in — nobody touches the
 * screen between taps.
 *
 * Two readers, because departments have both:
 *   * **Web NFC** (Chrome on Android, over HTTPS) — the tablet reads the card
 *     itself, using the tag's serial number rather than anything written on it.
 *     ID cards ship with a blank tag, so the serial is all there is.
 *   * **USB reader** — the desk kind that types the serial like a keyboard and
 *     presses Enter. Keystrokes are captured page-wide rather than into a
 *     focused box, because a kiosk loses focus to the first stray tap on the
 *     screen and a station that silently stops reading is worse than one that
 *     was never armed.
 *
 * URL: /members/check-in-station. Requires `members.check_in`, and the
 * organization must have the NFC ID Cards integration turned on — the station
 * endpoint refuses while it is off, so the page says so rather than looking
 * broken.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  Nfc,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Info,
  Loader2,
  Play,
  Square,
  Keyboard,
  AlertTriangle,
} from 'lucide-react';
import { EmptyState } from '../../../components/ux/EmptyState';
import { nfcCardService } from '../services/nfcCardService';
import { eventService } from '../../../services/api';
import { schedulingService } from '../../scheduling/services/api';
import { adminHoursCategoryService } from '../../admin-hours/services/api';
import { useNfcScanner } from '../../../hooks/useNfcScanner';
import { useTimezone } from '../../../hooks/useTimezone';
import { addCalendarDays, formatTime, getTodayLocalDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { getNfcUnavailableReason } from '../../../constants/nfc';
import {
  normalizeCardSerial,
  isPlausibleCardSerial,
  checkInResultTone,
  isIssuedCardCode,
  NFC_ID_CARDS_INTEGRATION,
} from '../constants/idCards';
import { useConnectedIntegrations } from '../../../hooks/useConnectedIntegrations';
import { signalUserActivity } from '../../../hooks/useIdleTimer';
import { NfcCheckInDirection, NfcCheckInTarget } from '../../../constants/enums';
import type { NfcStationCheckInResult } from '../types/idCard';

interface TargetOption {
  id: string;
  label: string;
  sublabel?: string;
}

/**
 * A card held a beat too long against the reader fires twice. Inside this
 * window the second read is dropped outright rather than sent, so the screen
 * keeps showing the confirmation the member is still reading. The backend
 * enforces its own, longer guard against a tap being read as a check-out.
 */
const DUPLICATE_TAP_MS = 4000;

/** How long a result stays on screen before the station returns to "ready". */
const RESULT_VISIBLE_MS = 7000;

/**
 * How often an armed station re-checks that its target still exists.
 *
 * Five minutes: long enough not to matter next to the traffic a station
 * generates by being used, short enough that a shift which ended is caught
 * before a whole relief crew has tapped into it.
 */
const TARGET_REFRESH_MS = 5 * 60 * 1000;

/**
 * A USB reader types its whole serial in a burst and ends with Enter. A gap
 * longer than this means a human is typing, so the buffer is dropped —
 * otherwise a stray keystroke would sit in it and corrupt the next real read.
 */
const WEDGE_KEY_GAP_MS = 120;

interface TapRecord {
  key: number;
  result: NfcStationCheckInResult;
}

const CheckInStationPage: React.FC = () => {
  const tz = useTimezone();

  const [targetType, setTargetType] = useState<NfcCheckInTarget>(NfcCheckInTarget.SHIFT);
  const [targets, setTargets] = useState<TargetOption[]>([]);
  const [targetId, setTargetId] = useState('');
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [direction, setDirection] = useState<NfcCheckInDirection>(NfcCheckInDirection.AUTO);

  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NfcStationCheckInResult | null>(null);
  const [recent, setRecent] = useState<TapRecord[]>([]);
  const [manualSerial, setManualSerial] = useState('');

  const nfcUnavailable = useMemo(() => getNfcUnavailableReason(), []);
  const { isConnected, loading: integrationsLoading } = useConnectedIntegrations();
  const cardsEnabled = isConnected(NFC_ID_CARDS_INTEGRATION);

  // Latest values for the page-wide key handler and the scan callback, both of
  // which are registered once and must not re-register on every keystroke.
  const stateRef = useRef({ armed, targetId, targetType, direction, busy, cardsEnabled });
  stateRef.current = { armed, targetId, targetType, direction, busy, cardsEnabled };
  const lastTapRef = useRef<{ serial: string; at: number } | null>(null);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Assigned once `disarm` exists below; the refresh above needs to reach it.
  const disarmRef = useRef<() => void>(() => {});

  // ---------------------------------------------------------------- targets

  const fetchTargets = useCallback(async (): Promise<TargetOption[]> => {
    if (targetType === NfcCheckInTarget.SHIFT) {
      // Yesterday as well as today, because a shift is filed under the date it
      // *started*. A 24-hour tour that began at 06:00 yesterday is still the
      // shift running at 02:00 now, and asking only for today's date made the
      // crew on duty disappear from the station at midnight.
      const today = getTodayLocalDate(tz);
      const { shifts } = await schedulingService.getShifts({
        start_date: addCalendarDays(today, -1),
        end_date: today,
      });
      const now = Date.now();
      return shifts
        .filter((s) => !s.is_finalized)
        .filter((s) => {
          // A yesterday-dated shift only belongs here while it is still
          // running; without this the station would offer every finished tour
          // from the previous day.
          if (!s.end_time) return true;
          return new Date(s.end_time).getTime() >= now;
        })
        .map((s) => ({
          id: s.id,
          label: s.apparatus_unit_number || s.apparatus_name || 'Shift',
          sublabel: `${formatTime(s.start_time, tz)}${s.end_time ? `–${formatTime(s.end_time, tz)}` : ''}`,
        }));
    }
    if (targetType === NfcCheckInTarget.EVENT) {
      // A window rather than "today": a drill that started last night and
      // a breakfast that starts in three hours are both things somebody
      // could be standing at a station for.
      //
      // `end_after` is what keeps a finished event out of it. Filtering on
      // start time alone left this morning's drill in the list — and because
      // the list is ordered by start time it could be the *default*, so an
      // operator could arm the station against an event whose check-in window
      // shut hours ago and have every tap refused.
      const now = Date.now();
      const events = await eventService.getEvents({
        start_after: new Date(now - 12 * 60 * 60 * 1000).toISOString(),
        start_before: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        end_after: new Date(now).toISOString(),
      });
      return events
        .filter((e) => !e.is_cancelled && !e.is_draft)
        .map((e) => ({
          id: e.id,
          label: e.title,
          sublabel: formatTime(e.start_datetime, tz),
        }));
    }
    const categories = await adminHoursCategoryService.list();
    return categories.map((c) => ({ id: c.id, label: c.name }));
  }, [targetType, tz]);

  // Load the list for a newly chosen kind of target, selecting the first.
  useEffect(() => {
    if (!cardsEnabled) return;
    let cancelled = false;
    const load = async () => {
      setTargetsLoading(true);
      setTargetsError(null);
      setTargetId('');
      try {
        const options = await fetchTargets();
        if (cancelled) return;
        setTargets(options);
        setTargetId(options[0]?.id ?? '');
      } catch (err: unknown) {
        if (!cancelled) setTargetsError(getErrorMessage(err, 'Unable to load what can be checked into'));
      } finally {
        if (!cancelled) setTargetsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [fetchTargets, cardsEnabled]);

  /**
   * Re-check that the selected target is still a thing to check into.
   *
   * A station is armed once and then left alone for hours, so the list it was
   * armed against goes stale in a way nobody is watching: a shift ends, an
   * officer finalizes it, the small hours roll into a new duty day. Taps kept
   * landing on yesterday's shift, and the only sign was attendance appearing
   * somewhere nobody looked.
   *
   * Keeps the operator's selection when it survives the refresh — silently
   * moving an armed station onto a different shift would be worse than the
   * staleness it fixes.
   */
  const refreshTargets = useCallback(async () => {
    if (!stateRef.current.cardsEnabled) return;
    let options: TargetOption[];
    try {
      options = await fetchTargets();
    } catch {
      // Leave the station on what it has. A failed refresh is not evidence the
      // target ended, and disarming on a dropped request would take a working
      // station down for a blip of station Wi-Fi.
      return;
    }
    setTargets(options);

    const selected = stateRef.current.targetId;
    if (!selected || options.some((option) => option.id === selected)) return;

    setTargetId(options[0]?.id ?? '');
    if (stateRef.current.armed) {
      disarmRef.current();
      setResult(null);
      setTargetsError(
        'That shift or event has ended, so the reader stopped. Pick what members are checking into now and start it again.'
      );
    }
  }, [fetchTargets]);

  // A wall-mounted tablet never changes visibility or focus, so the poll is
  // what actually covers the unattended case; the listeners cover a phone
  // coming back out of a pocket.
  useEffect(() => {
    if (!cardsEnabled) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshTargets();
    };
    const interval = setInterval(() => void refreshTargets(), TARGET_REFRESH_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refreshTargets, cardsEnabled]);

  // ------------------------------------------------------------------ taps

  const showResult = useCallback((next: NfcStationCheckInResult) => {
    setResult(next);
    setRecent((prev) => [{ key: Date.now(), result: next }, ...prev].slice(0, 12));
    if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    resultTimerRef.current = setTimeout(() => setResult(null), RESULT_VISIBLE_MS);
  }, []);

  const submitSerial = useCallback(
    async (rawSerial: string, rawPayload?: string | null) => {
      const serial = normalizeCardSerial(rawSerial);
      const state = stateRef.current;
      if (!serial || !state.targetId || state.busy) return;
      if (!isPlausibleCardSerial(serial)) return;

      // A card held against the reader is a person standing at the device, but
      // Web NFC fires no mouse, key, scroll or touch event, so the session
      // timer counted a station in constant use as idle and logged it out
      // mid-drill. Signalled before the request, so a refused tap keeps the
      // session alive too — somebody is still there either way.
      signalUserActivity();

      // Only a payload that looks like a code this system issued is forwarded.
      // A transit card or a hotel key read at the door carries text of its own,
      // and sending it would put arbitrary strings from strangers' tags through
      // a credential lookup for nothing.
      const payload = isIssuedCardCode(rawPayload) ? normalizeCardSerial(rawPayload ?? '') : undefined;

      // Deduplicated on whichever identifier will actually be resolved, so a
      // rewritten tag whose serial belongs to a previous holder does not
      // suppress the real card behind it.
      const dedupeKey = payload ?? serial;
      const previous = lastTapRef.current;
      if (previous && previous.serial === dedupeKey && Date.now() - previous.at < DUPLICATE_TAP_MS) return;
      lastTapRef.current = { serial: dedupeKey, at: Date.now() };

      setBusy(true);
      try {
        const response = await nfcCardService.stationCheckIn({
          tag_uid: serial,
          tag_payload: payload,
          target_type: state.targetType,
          target_id: state.targetId,
          direction: state.direction,
        });
        showResult(response);
      } catch (err: unknown) {
        // Only transport and caller errors land here; every domain outcome
        // (unknown card, closed window) arrives as a normal result above.
        showResult({
          status: 'refused',
          message: getErrorMessage(err, 'The check-in could not be recorded. Try the tap again.'),
        });
      } finally {
        setBusy(false);
      }
    },
    [showResult]
  );

  const handleTag = useCallback(
    (tag: { serialNumber: string; payload: string | null }) => {
      void submitSerial(tag.serialNumber, tag.payload);
    },
    [submitSerial]
  );

  const { supported: nfcSupported, scanning, error: scanError, start, stop } = useNfcScanner({ onTag: handleTag });

  const disarm = useCallback(() => {
    stop();
    setArmed(false);
  }, [stop]);
  disarmRef.current = disarm;

  const arm = useCallback(() => {
    setArmed(true);
    // Web NFC needs transient user activation, so scan() runs inside the click
    // handler. A device without it still arms — the USB reader path below
    // works everywhere, and that is what most front desks actually have.
    if (nfcSupported) void start();
  }, [nfcSupported, start]);

  useEffect(
    () => () => {
      stop();
      if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    },
    [stop]
  );

  // Re-arming after a target change would silently write taps to the previous
  // shift for as long as nobody looked at the screen.
  useEffect(() => {
    disarm();
  }, [targetType, targetId, disarm]);

  // --------------------------------------------------- USB keyboard wedge

  useEffect(() => {
    if (!armed) return;
    let buffer = '';
    let lastKeyAt = 0;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Someone typing into the manual box owns their keystrokes; capturing
      // them page-wide as well would submit each serial twice.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      const now = Date.now();
      if (now - lastKeyAt > WEDGE_KEY_GAP_MS) buffer = '';
      lastKeyAt = now;

      if (event.key === 'Enter') {
        const captured = buffer;
        buffer = '';
        if (captured) void submitSerial(captured);
        return;
      }
      if (event.key.length === 1) buffer += event.key;
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [armed, submitSerial]);

  // ---------------------------------------------------------------- render

  const tone = result ? checkInResultTone(result.status) : null;
  const toneClasses =
    tone === 'success'
      ? 'border-green-500 bg-green-50 dark:bg-green-500/10'
      : tone === 'info'
        ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
        : 'border-red-500 bg-red-50 dark:bg-red-500/10';

  const selectedTarget = targets.find((t) => t.id === targetId);

  const header = (
    <div className="flex items-center gap-3">
      <Link to="/members" className="btn-icon" aria-label="Back to members">
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
      </Link>
      <div>
        <h1 className="text-theme-text-primary text-2xl font-bold">Check-In Station</h1>
        <p className="text-theme-text-secondary text-sm">Members tap their ID card to be checked in.</p>
      </div>
    </div>
  );

  // The endpoint refuses while the integration is off, so an armed-looking
  // reader here would fail on every tap with nothing to explain why.
  if (!integrationsLoading && !cardsEnabled) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-4">
        {header}
        <div className="card">
          <EmptyState
            icon={Nfc}
            title="NFC ID cards are turned off"
            description="An administrator can turn them on under Settings → Integrations. Until then no card can be issued or read."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      {header}

      <div className="card space-y-4">
        <div>
          <span className="form-label" id="station-target-type">
            Check members into
          </span>
          <div className="hscroll mt-1 flex gap-2" role="group" aria-labelledby="station-target-type">
            {(
              [
                [NfcCheckInTarget.SHIFT, 'Shift'],
                [NfcCheckInTarget.EVENT, 'Event or meeting'],
                [NfcCheckInTarget.ADMIN_HOURS, 'Admin hours'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTargetType(value)}
                aria-pressed={targetType === value}
                className={
                  targetType === value
                    ? 'btn-primary btn-auto whitespace-nowrap'
                    : 'btn-secondary btn-auto whitespace-nowrap'
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="form-label" htmlFor="station-target">
            {targetType === NfcCheckInTarget.SHIFT
              ? "Today's shifts"
              : targetType === NfcCheckInTarget.EVENT
                ? 'Events happening around now'
                : 'Admin hours category'}
          </label>
          <select
            id="station-target"
            className="form-input"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            disabled={targetsLoading || targets.length === 0}
          >
            {targets.length === 0 && <option value="">{targetsLoading ? 'Loading…' : 'Nothing available'}</option>}
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.sublabel ? `${t.label} — ${t.sublabel}` : t.label}
              </option>
            ))}
          </select>
          {targetsError && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{targetsError}</p>}
        </div>

        <div>
          <span className="form-label" id="station-direction">
            Each tap
          </span>
          <div className="hscroll mt-1 flex gap-2" role="group" aria-labelledby="station-direction">
            {(
              [
                [NfcCheckInDirection.AUTO, 'In, then out'],
                [NfcCheckInDirection.IN, 'Checks in'],
                [NfcCheckInDirection.OUT, 'Checks out'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setDirection(value)}
                aria-pressed={direction === value}
                className={
                  direction === value
                    ? 'btn-primary btn-auto whitespace-nowrap'
                    : 'btn-secondary btn-auto whitespace-nowrap'
                }
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-theme-text-secondary mt-1 text-xs">
            &ldquo;In, then out&rdquo; lets one card serve arrival and departure. Pick a fixed direction when a second
            station covers the way out.
          </p>
        </div>
      </div>

      <div className="card space-y-4 text-center">
        {!armed ? (
          <>
            <button
              type="button"
              onClick={arm}
              disabled={!targetId}
              className="btn-primary mx-auto inline-flex items-center gap-2"
            >
              <Play className="h-5 w-5" aria-hidden="true" />
              Start the reader
            </button>
            {!targetId && (
              <p className="text-theme-text-secondary text-sm">
                Pick something to check members into before starting the reader.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-3">
              <div className={`rounded-full bg-blue-500/10 p-6 ${scanning || armed ? 'animate-pulse' : ''}`}>
                <Nfc className="h-12 w-12 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              </div>
              <p className="text-theme-text-primary text-lg font-medium" role="status">
                {busy ? 'Checking in…' : `Ready — tap a card for ${selectedTarget?.label ?? 'this'}`}
              </p>
              {busy && <Loader2 className="text-theme-text-secondary h-5 w-5 animate-spin" aria-hidden="true" />}
            </div>
            <button type="button" onClick={disarm} className="btn-secondary mx-auto inline-flex items-center gap-2">
              <Square className="h-4 w-4" aria-hidden="true" />
              Stop the reader
            </button>
          </>
        )}

        {!nfcSupported && nfcUnavailable && (
          <div className="alert-info flex items-start gap-2 text-left">
            <Keyboard className="text-theme-alert-info-icon mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p className="text-theme-alert-info-text text-sm">
              {nfcUnavailable} A USB card reader still works on this device — hold a card against it and the station
              will read it.
            </p>
          </div>
        )}

        {scanError && (
          <div className="alert-danger flex items-start gap-2 text-left">
            <AlertTriangle className="text-theme-alert-danger-icon mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p className="text-theme-alert-danger-text text-sm">{scanError}</p>
          </div>
        )}

        {result && (
          <div className={`rounded-lg border-2 p-6 text-left ${toneClasses}`} role="status" aria-live="polite">
            <div className="flex items-start gap-3">
              {tone === 'success' ? (
                <CheckCircle2
                  className="mt-0.5 h-8 w-8 shrink-0 text-green-600 dark:text-green-400"
                  aria-hidden="true"
                />
              ) : tone === 'info' ? (
                <Info className="mt-0.5 h-8 w-8 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              ) : (
                <XCircle className="mt-0.5 h-8 w-8 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
              )}
              <div className="min-w-0">
                <p className="text-theme-text-primary text-xl font-semibold">{result.memberName || 'Card read'}</p>
                <p className="text-theme-text-secondary">{result.message}</p>
                {result.durationMinutes != null && (
                  <p className="text-theme-text-secondary text-sm">{result.durationMinutes} minutes recorded.</p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="text-left">
          <label className="form-label" htmlFor="station-manual">
            Card not reading? Enter the serial
          </label>
          <div className="flex gap-2">
            <input
              id="station-manual"
              type="text"
              className="form-input font-mono uppercase"
              value={manualSerial}
              onChange={(e) => setManualSerial(normalizeCardSerial(e.target.value))}
              placeholder="04A2245B7C1180"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="btn-secondary btn-auto"
              disabled={!targetId || !isPlausibleCardSerial(manualSerial)}
              onClick={() => {
                const value = manualSerial;
                setManualSerial('');
                void submitSerial(value);
              }}
            >
              Check in
            </button>
          </div>
        </div>
      </div>

      {recent.length > 0 && (
        <div className="card">
          <h2 className="text-theme-text-primary mb-3 text-lg font-semibold">This session</h2>
          <ul className="divide-theme-surface-border divide-y">
            {recent.map((tap) => (
              <li key={tap.key} className="flex items-center justify-between gap-3 py-2">
                <span className="text-theme-text-primary min-w-0 truncate">
                  {tap.result.memberName || 'Unknown card'}
                </span>
                <span className="text-theme-text-secondary shrink-0 text-sm">{tap.result.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default CheckInStationPage;
