/**
 * Outreach Credit Card
 *
 * Time worked on a community outreach signup sheet is community outreach
 * hours, credited through the event the sheet staffs, and is not counted as
 * shift hours (owner decision, 2026-11-24). New check-ins are credited as
 * they happen. This card is the catch-up for sheets worked before that rule:
 * an officer checks what there is to credit, sees the numbers, and runs it.
 *
 * Nothing is fetched until the officer asks. The check is a preview produced
 * by the same code that does the work, so the figure shown is the figure a
 * run credits, and running it twice credits nothing twice.
 */

import React, { useState } from 'react';
import { HandHeart } from 'lucide-react';
import toast from 'react-hot-toast';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatHours } from '../../../utils/hoursFormatting';
import { schedulingService, type OutreachCreditSummary } from '../services/api';

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

export const OutreachCreditCard: React.FC = () => {
  const { confirm } = useConfirm();
  const [summary, setSummary] = useState<OutreachCreditSummary | null>(null);
  const [working, setWorking] = useState(false);

  const check = async () => {
    setWorking(true);
    try {
      setSummary(await schedulingService.previewOutreachCredit());
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not check past outreach sheets.'));
    } finally {
      setWorking(false);
    }
  };

  const run = async () => {
    if (!summary) return;
    const agreed = await confirm({
      title: 'Credit past outreach sheets?',
      message:
        `This records ${plural(summary.volunteers, 'volunteer')} as attending their events, ` +
        `${formatHours(summary.hours)} in all, and writes the hours for events that have already ended. ` +
        'The hours go to the category each event type is mapped to. It is safe to run again.',
      confirmLabel: 'Credit the hours',
      cancelLabel: 'Not now',
    });
    if (!agreed) return;
    setWorking(true);
    try {
      const result = await schedulingService.runOutreachCredit();
      setSummary(result);
      toast.success('Past outreach sheets credited.');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not credit past outreach sheets.'));
    } finally {
      setWorking(false);
    }
  };

  const creditable = summary ? summary.sheets - summary.sheets_waiting_for_event : 0;

  return (
    <div className="card-secondary p-4 sm:p-5" data-testid="outreach-credit-card">
      <h3 className="text-theme-text-primary flex items-center gap-2 text-base font-semibold">
        <HandHeart className="h-4 w-4" aria-hidden="true" /> Community outreach hours
      </h3>
      <p className="text-theme-text-muted mt-1 text-sm">
        Time on a community outreach signup sheet counts as outreach hours through its event, not as shift hours.
        Check-ins from now on are credited automatically. Use this once to credit sheets that were worked earlier.
      </p>

      {summary && (
        <div className="mt-3 text-sm" role="status">
          {summary.sheets === 0 ? (
            <p className="text-theme-text-secondary">No outreach sheet has recorded time.</p>
          ) : (
            <ul className="text-theme-text-secondary list-disc space-y-1 pl-5">
              <li>
                {summary.applied ? 'Credited' : 'To credit'}: {plural(summary.volunteers, 'volunteer')} on{' '}
                {plural(creditable, 'sheet')}, {formatHours(summary.hours)}
              </li>
              {summary.applied && (
                <li>
                  {summary.entries_credited} Admin Hours {summary.entries_credited === 1 ? 'entry' : 'entries'} written
                  or corrected
                </li>
              )}
              {summary.sheets_awaiting_finalize > 0 && (
                <li>
                  {plural(summary.sheets_awaiting_finalize, 'sheet')} for an event that is still open: those hours are
                  written when the event is ended
                </li>
              )}
              {summary.sheets_waiting_for_event > 0 && (
                <li>
                  {plural(summary.sheets_waiting_for_event, 'sheet')} with no event yet: nothing to credit until the
                  request is scheduled
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn-secondary btn-sm" disabled={working} onClick={() => void check()}>
          {summary ? 'Check again' : 'Check past outreach sheets'}
        </button>
        {summary && !summary.applied && creditable > 0 && (
          <button type="button" className="btn-primary btn-sm" disabled={working} onClick={() => void run()}>
            Credit the hours
          </button>
        )}
      </div>
    </div>
  );
};

export default OutreachCreditCard;
