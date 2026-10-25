/**
 * The caller's own action items across every approved set of minutes.
 *
 * Shown to every member, since anyone can be assigned work at a meeting; it
 * lists only items assigned to the signed-in member, and renders nothing for
 * a member with none. An assignee may mark their own item in progress or done
 * (the server allows exactly that on approved minutes).
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckSquare } from 'lucide-react';
import { Link } from 'react-router';
import { formatCalendarDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { minutesService } from '../services/api';
import type { ActionItemStatus, MyActionItem } from '../types/minutes';
import { actionItemStatusLabel } from '../utils/actionItemStatus';

export const MyActionItemsPanel: React.FC = () => {
  const [items, setItems] = useState<MyActionItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await minutesService.getMyActionItems());
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (item: MyActionItem, status: ActionItemStatus) => {
    setBusy(item.id);
    try {
      await minutesService.updateActionItem(item.minutes_id, item.id, { status });
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update the action item'));
    } finally {
      setBusy(null);
    }
  };

  if (items.length === 0) return null;

  return (
    <section className="card mb-6 p-4" aria-labelledby="my-action-items-heading">
      <h2
        id="my-action-items-heading"
        className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold"
      >
        <CheckSquare className="h-5 w-5" aria-hidden="true" />
        Assigned to me ({items.length})
      </h2>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="border-theme-surface-border flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
          >
            <div className="min-w-0">
              <p className="text-theme-text-primary text-sm font-medium">{item.description}</p>
              <p className="text-theme-text-muted text-xs">
                <Link to={`/minutes/${item.minutes_id}`} className="text-blue-600 hover:text-blue-800">
                  {item.minutes_title}
                </Link>
                {item.due_date ? ` · due ${formatCalendarDate(item.due_date)}` : ''}
                {` · ${actionItemStatusLabel(item.status)}`}
              </p>
            </div>
            <div className="flex gap-2">
              {item.status === 'pending' && (
                <button
                  type="button"
                  disabled={busy === item.id}
                  onClick={() => {
                    void setStatus(item, 'in_progress');
                  }}
                  className="btn-secondary touch:min-h-11 text-sm"
                >
                  Start
                </button>
              )}
              <button
                type="button"
                disabled={busy === item.id}
                onClick={() => {
                  void setStatus(item, 'completed');
                }}
                className="btn-success touch:min-h-11 text-sm"
              >
                Mark done
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default MyActionItemsPanel;
