/**
 * The suggestions on one set of minutes, shared by the page's section cards
 * (which count them and take new ones) and the suggestions panel (which lists
 * and answers them), so a suggestion sent from a section appears in the list
 * without a reload of the whole page.
 *
 * `status` is a reload signal: a recall or a reopen changes who may answer, and
 * what a member is allowed to see.
 */

import { useCallback, useEffect, useState } from 'react';
import { minutesService } from '../services/api';
import type { MinutesStatus, MinutesSuggestion } from '../types/minutes';

export const useMinutesSuggestions = (minutesId: string, status: MinutesStatus) => {
  const [suggestions, setSuggestions] = useState<MinutesSuggestion[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!minutesId) return;
    try {
      setSuggestions(await minutesService.getSuggestions(minutesId));
    } catch {
      setSuggestions([]);
    } finally {
      setLoaded(true);
    }
  }, [minutesId]);

  useEffect(() => {
    void reload();
  }, [reload, status]);

  return { suggestions, loaded, reload };
};
