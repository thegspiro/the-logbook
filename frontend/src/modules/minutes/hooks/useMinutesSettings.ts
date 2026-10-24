/**
 * The department's minutes settings, as the server applies them.
 *
 * One read serves every panel on the settings page: reminders, signers,
 * publishing and the attendance listing all come from the same
 * `GET /minutes-records/settings`. Writing goes through the organization
 * settings (`settings.manage`); a panel calls `reload` after a save so the
 * screen shows what the server now holds, not what was sent.
 */

import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '../../../utils/errorHandling';
import { minutesService } from '../services/api';
import type { MinutesReminderSettings } from '../types/minutes';

export const useMinutesSettings = () => {
  const [settings, setSettings] = useState<MinutesReminderSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setSettings(await minutesService.getReminderSettings());
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load the minutes settings'));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { settings, error, reload };
};
