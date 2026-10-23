/**
 * Lets a member whose station stays signed in switch their own session to the
 * longer kiosk limits (HIPAA §164.312(a)(2)(iii) sign-out is relaxed, so the
 * switch is explicit, audited server-side, and reversible here).
 *
 * Rendered only for members holding `security.kiosk_session`; anyone else gets
 * nothing, so a station page can mount it unconditionally. The server decides
 * whether the flag counts, so a stale `kiosk_available` here can at worst show
 * a button the server then refuses.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { MonitorCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { authService } from '../services/api';
import { useTimezone } from '../hooks/useTimezone';
import { signalSessionSettingsChanged } from '../hooks/useIdleTimer';
import { formatDateTime } from '../utils/dateFormatting';
import { getErrorMessage } from '../utils/errorHandling';
import type { SessionSettings } from '../types/auth';

export const KioskSessionCard: React.FC = () => {
  const tz = useTimezone();
  const [settings, setSettings] = useState<SessionSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void authService
      .getSessionSettings()
      .then((data) => {
        if (!cancelled) setSettings(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(async () => {
    if (!settings) return;
    const enable = !settings.is_kiosk;
    setBusy(true);
    try {
      const result = await authService.setKioskSession(enable);
      setSettings({
        ...settings,
        is_kiosk: result.is_kiosk,
        session_timeout_minutes: result.session_timeout_minutes,
        session_ends_at: result.session_ends_at,
      });
      signalSessionSettingsChanged();
      toast.success(enable ? 'Kiosk session on' : 'Kiosk session off');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not change the session type'));
    } finally {
      setBusy(false);
    }
  }, [settings]);

  if (!settings?.kiosk_available) return null;

  const idleHours = Math.round(((settings.session_timeout_minutes ?? 0) / 60) * 10) / 10;

  return (
    <section className="card space-y-2 p-4" aria-labelledby="kiosk-session-heading">
      <h2
        id="kiosk-session-heading"
        className="text-theme-text-primary flex items-center gap-2 text-base font-semibold"
      >
        <MonitorCheck className="h-5 w-5" aria-hidden="true" /> Kiosk session
      </h2>
      {settings.is_kiosk ? (
        <p className="text-theme-text-secondary text-sm">
          This device stays signed in through {idleHours} hours of inactivity
          {settings.session_ends_at ? `, and until ${formatDateTime(settings.session_ends_at, tz)} at the latest` : ''}.
          Turn it off if this is not a shared station.
        </p>
      ) : (
        <p className="text-theme-text-secondary text-sm">
          Keep this device signed in between shifts. Use it only on a shared station tablet, signed in with a dedicated
          account.
        </p>
      )}
      <button
        type="button"
        className={settings.is_kiosk ? 'btn-secondary btn-auto' : 'btn-primary btn-auto'}
        disabled={busy}
        onClick={() => void toggle()}
      >
        {settings.is_kiosk ? 'Turn off kiosk session' : 'Turn on kiosk session'}
      </button>
    </section>
  );
};
