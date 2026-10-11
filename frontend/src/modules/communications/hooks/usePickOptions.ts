/**
 * The members or vehicles a suggestion box's pick questions offer.
 *
 * Fetched once per kind, and only when the box asks such a question; the
 * member filters the list in the browser, so what they type never leaves it.
 */

import { useEffect, useState } from 'react';
import { suggestionsService } from '../services/suggestionsService';
import type { PickKind, PickOption } from '../types/suggestions';

export interface PickOptionsState {
  options: PickOption[];
  isLoading: boolean;
  failed: boolean;
}

const IDLE: PickOptionsState = { options: [], isLoading: false, failed: false };

export function usePickOptions(kind: PickKind, enabled: boolean): PickOptionsState {
  const [state, setState] = useState<PickOptionsState>(IDLE);

  useEffect(() => {
    if (!enabled) {
      setState(IDLE);
      return undefined;
    }
    let cancelled = false;
    setState({ options: [], isLoading: true, failed: false });
    suggestionsService
      .pickOptions(kind)
      .then((options) => {
        if (!cancelled) setState({ options, isLoading: false, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ options: [], isLoading: false, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [kind, enabled]);

  return state;
}
