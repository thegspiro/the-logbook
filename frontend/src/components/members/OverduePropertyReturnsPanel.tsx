/**
 * Former members still holding department property.
 *
 * The overdue-returns endpoints existed with no screen (member lifecycle,
 * KNOWN_LIMITATIONS). The owner chose to put lifecycle operations where people
 * already look rather than build a separate page, so this panel sits on the
 * Inventory Member Equipment page. It lists dropped members with items still
 * out, links each to their profile, and can send the 30- and 90-day reminders
 * that are due now — the same run the daily scheduler makes; each reminder goes
 * once per member, so running it early never sends a duplicate.
 *
 * Its endpoints need members.manage; the page renders it only for holders.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Mail, PackageX } from 'lucide-react';
import toast from 'react-hot-toast';
import { memberStatusService } from '../../services/api';
import type { OverdueMember } from '../../types/user';
import { useConfirm } from '../../contexts/ConfirmContext';
import { formatDate } from '../../utils/dateFormatting';
import { formatCurrency } from '../../utils/currencyFormatting';
import { getErrorMessage } from '../../utils/errorHandling';

interface OverduePropertyReturnsPanelProps {
  tz: string;
}

export const OverduePropertyReturnsPanel: React.FC<OverduePropertyReturnsPanelProps> = ({ tz }) => {
  const { confirm } = useConfirm();
  const [members, setMembers] = useState<OverdueMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await memberStatusService.getOverduePropertyReturns();
      setMembers(result.members);
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load overdue property returns'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sendReminders = async () => {
    const ok = await confirm({
      title: 'Send due reminders?',
      message:
        'Emails the 30- and 90-day property return reminders that are due now. Each reminder goes to a member once, so anyone already reminded is skipped.',
      confirmLabel: 'Send reminders',
      cancelLabel: 'Not now',
      variant: 'info',
    });
    if (!ok) return;
    setSending(true);
    try {
      const result = await memberStatusService.processPropertyReturnReminders();
      const sent = result.reminders_sent;
      toast.success(sent === 1 ? '1 reminder sent' : `${sent} reminders sent`);
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not send reminders'));
    } finally {
      setSending(false);
    }
  };

  if (error) {
    return <div className="alert-danger mb-6 text-sm">{error}</div>;
  }
  if (members === null) return null;

  return (
    <section className="card mb-6 p-4" aria-labelledby="overdue-returns-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2
          id="overdue-returns-heading"
          className="text-theme-text-primary flex items-center gap-2 text-base font-semibold"
        >
          <PackageX className="h-4 w-4" aria-hidden="true" />
          Former members still holding property
        </h2>
        {members.length > 0 && (
          <button
            type="button"
            className="btn-secondary btn-md flex items-center gap-1.5"
            onClick={() => void sendReminders()}
            disabled={sending}
          >
            <Mail className="h-4 w-4" aria-hidden="true" />
            Send due reminders
          </button>
        )}
      </div>
      {members.length === 0 ? (
        <p className="text-theme-text-muted text-sm">No dropped member has property outstanding.</p>
      ) : (
        <ul className="divide-theme-surface-border divide-y">
          {members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div>
                <Link
                  to={`/members/${m.user_id}`}
                  className="touch-target-phone font-medium text-blue-700 hover:underline dark:text-blue-400"
                >
                  {m.member_name}
                </Link>
                <p className="text-theme-text-muted text-xs">
                  Dropped {formatDate(m.dropped_date, tz)} · {m.days_since_drop} days ago
                  {m.reminders_sent.length > 0 && ` · reminded (${m.reminders_sent.join(', ')})`}
                </p>
              </div>
              <p className="text-theme-text-secondary">
                {m.items_outstanding} {m.items_outstanding === 1 ? 'item' : 'items'} · {formatCurrency(m.total_value)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default OverduePropertyReturnsPanel;
