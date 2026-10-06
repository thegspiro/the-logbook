/**
 * Classes a late joiner missed, and the officer's decision for each (W27-3).
 *
 * A member added to a running cohort is RSVP'd only to the classes still to
 * come. Each class held before they joined needs a decision: credit them for
 * it (they covered the material elsewhere), or schedule a make-up session for
 * them alone. A make-up is credited the ordinary way, when its attendance is
 * finalized; scheduling it credits nothing.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarPlus, CheckCircle2 } from 'lucide-react';
import { Modal } from '../Modal';
import DateTimeQuarterHour from '../ux/DateTimeQuarterHour';
import { courseCohortService } from '../../services/api';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useTimezone } from '../../hooks/useTimezone';
import { formatShortDateTime, localToUTC } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import type { CohortMissedClass } from '../../types/training';

interface CohortMissedClassesModalProps {
  isOpen: boolean;
  cohortId: string;
  userId: string;
  memberName: string;
  onClose: () => void;
  /** Called after any decision, so the roster's pending count refreshes. */
  onChanged: () => void;
}

export const CohortMissedClassesModal: React.FC<CohortMissedClassesModalProps> = ({
  isOpen,
  cohortId,
  userId,
  memberName,
  onClose,
  onChanged,
}) => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const [classes, setClasses] = useState<CohortMissedClass[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [makeupFor, setMakeupFor] = useState<string | null>(null);
  const [makeupStart, setMakeupStart] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setClasses(await courseCohortService.listMissedClasses(cohortId, userId));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not load the classes this member missed'));
    } finally {
      setLoading(false);
    }
  }, [cohortId, userId]);

  useEffect(() => {
    if (!isOpen) return;
    setMakeupFor(null);
    setMakeupStart('');
    void load();
  }, [isOpen, load]);

  const handleCredit = async (item: CohortMissedClass) => {
    const ok = await confirm({
      title: 'Credit this class?',
      message: `${memberName} will get a completed training record for "${item.title}", dated the day it was held, and its hours count toward their pipeline. Use this when they covered the material elsewhere.`,
      confirmLabel: 'Credit as completed',
      cancelLabel: 'Keep deciding',
    });
    if (!ok) return;
    setBusyId(item.cohort_class_id);
    try {
      const result = await courseCohortService.creditMissedClass(cohortId, userId, item.cohort_class_id);
      toast.success(`Credited for ${item.title}`);
      result.warnings.forEach((w) => toast.error(w));
      await load();
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not credit the class'));
    } finally {
      setBusyId(null);
    }
  };

  const handleMakeup = async (item: CohortMissedClass) => {
    if (!makeupStart) {
      toast.error('Pick when the make-up session runs');
      return;
    }
    const start = localToUTC(makeupStart, tz);
    // Same length as the class it replaces.
    const durationMs = new Date(item.scheduled_end).getTime() - new Date(item.scheduled_start).getTime();
    setBusyId(item.cohort_class_id);
    try {
      await courseCohortService.scheduleMakeup(cohortId, userId, item.cohort_class_id, {
        scheduled_start: start,
        scheduled_end: new Date(new Date(start).getTime() + durationMs).toISOString(),
      });
      toast.success('Make-up session scheduled and on their calendar');
      setMakeupFor(null);
      setMakeupStart('');
      await load();
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not schedule the make-up session'));
    } finally {
      setBusyId(null);
    }
  };

  const decisionText = (item: CohortMissedClass): string | null => {
    if (item.resolution === 'credited') return 'Credited as completed';
    if (item.resolution === 'makeup_scheduled' && !item.pending && item.makeup_scheduled_start) {
      return `Make-up session ${formatShortDateTime(item.makeup_scheduled_start, tz)}`;
    }
    if (item.resolution === 'makeup_scheduled' && item.pending) {
      return 'Make-up session was cancelled — decide again';
    }
    return null;
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Classes ${memberName} missed`} size="lg">
      <p className="text-theme-text-secondary mb-4 text-sm">
        These classes were held before {memberName} joined the cohort. For each one, credit them for it or schedule a
        make-up session they attend on their own.
      </p>
      {loading && <p className="text-theme-text-muted text-sm">Loading…</p>}
      {!loading && classes.length === 0 && (
        <p className="text-theme-text-muted text-sm">No classes were held before they joined.</p>
      )}
      <ul className="space-y-3">
        {classes.map((item) => {
          const decided = decisionText(item);
          return (
            <li key={item.cohort_class_id} className="card-secondary p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-theme-text-primary font-medium">
                    {item.sequence}. {item.title}
                  </p>
                  <p className="text-theme-text-muted text-xs">
                    Held {formatShortDateTime(item.scheduled_start, tz)}
                    {item.credit_hours != null ? ` · ${item.credit_hours} h` : ''}
                  </p>
                  {decided && <p className="text-theme-text-secondary mt-1 text-sm">{decided}</p>}
                </div>
                {item.pending && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => void handleCredit(item)}
                      className="btn-primary flex items-center gap-1 text-sm"
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      Credit as completed
                    </button>
                    <button
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => {
                        setMakeupFor(makeupFor === item.cohort_class_id ? null : item.cohort_class_id);
                        setMakeupStart('');
                      }}
                      className="btn-secondary flex items-center gap-1 text-sm"
                      aria-expanded={makeupFor === item.cohort_class_id}
                    >
                      <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                      Schedule make-up
                    </button>
                  </div>
                )}
              </div>
              {item.pending && makeupFor === item.cohort_class_id && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div>
                    <span className="form-label">Make-up session starts</span>
                    <DateTimeQuarterHour value={makeupStart} onChange={(value: string) => setMakeupStart(value)} />
                  </div>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void handleMakeup(item)}
                    className="btn-primary text-sm"
                  >
                    Schedule
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
};

export default CohortMissedClassesModal;
