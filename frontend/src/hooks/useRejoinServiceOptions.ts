/**
 * State for choosing how a returning member's earlier service counts.
 *
 * Paired with `RejoinServiceFields`, which renders it. Kept apart so the
 * dialogs that bring a member back own the state and can send `options`.
 */

import { useEffect, useMemo, useState } from 'react';
import { memberStatusService } from '../services/api';
import { RejoinServiceCredit } from '../constants/enums';
import type { RejoinServiceOptions, ServiceHistory } from '../types/user';
import { getTodayLocalDate } from '../utils/dateFormatting';

export interface RejoinServiceState {
  loading: boolean;
  loadFailed: boolean;
  history: ServiceHistory | null;
  credit: RejoinServiceCredit;
  setCredit: (value: RejoinServiceCredit) => void;
  rejoinDate: string;
  setRejoinDate: (value: string) => void;
  previousServiceEnd: string;
  setPreviousServiceEnd: (value: string) => void;
  /** No stints are recorded, so the end of earlier service is an estimate to confirm. */
  needsPreviousServiceEnd: boolean;
  today: string;
  /** What to send; fields the officer left blank fall back to the server's defaults. */
  options: RejoinServiceOptions;
}

/**
 * Loads the member's service history whenever `active` turns on, and seeds
 * the choices from it — so a dialog reopened for someone else never carries
 * the previous member's dates.
 */
export function useRejoinServiceOptions(userId: string | null, active: boolean, tz: string): RejoinServiceState {
  const today = getTodayLocalDate(tz);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [history, setHistory] = useState<ServiceHistory | null>(null);
  const [credit, setCredit] = useState<RejoinServiceCredit>(RejoinServiceCredit.CONTINUE);
  const [rejoinDate, setRejoinDate] = useState(today);
  const [previousServiceEnd, setPreviousServiceEnd] = useState('');

  useEffect(() => {
    if (!active || !userId) return undefined;
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    setHistory(null);
    setCredit(RejoinServiceCredit.CONTINUE);
    setRejoinDate(today);
    setPreviousServiceEnd('');
    memberStatusService
      .getServiceHistory(userId)
      .then((data) => {
        if (cancelled) return;
        setHistory(data);
        setCredit(data.default_rejoin_credit);
        if (!data.is_recorded) setPreviousServiceEnd(data.periods[0]?.end_date ?? '');
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, active, today]);

  const needsPreviousServiceEnd = Boolean(history && !history.is_recorded && history.hire_date);

  const options = useMemo<RejoinServiceOptions>(() => {
    // Nothing loaded means nothing chosen: let the server apply every default
    // rather than send a choice the officer never saw.
    if (!history) return {};
    return {
      service_credit: credit,
      rejoin_date: rejoinDate || undefined,
      previous_service_end: (needsPreviousServiceEnd && previousServiceEnd) || undefined,
    };
  }, [history, credit, rejoinDate, needsPreviousServiceEnd, previousServiceEnd]);

  return {
    loading,
    loadFailed,
    history,
    credit,
    setCredit,
    rejoinDate,
    setRejoinDate,
    previousServiceEnd,
    setPreviousServiceEnd,
    needsPreviousServiceEnd,
    today,
    options,
  };
}
