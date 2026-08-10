/**
 * Action Items Page (C2)
 *
 * Unified view of action items from both Meeting and Minutes modules.
 * Allows filtering by status and showing items assigned to the current user.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { CheckCircle2, Clock, Filter, ClipboardList, Loader2 } from 'lucide-react';
import { dashboardService } from '../services/api';
import type { ActionItemSummary } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';
import { formatDate } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import { EmptyState } from '../components/ux';

const STATUS_BADGES: Record<string, string> = {
  open: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
  completed: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  cancelled: 'bg-theme-surface-secondary text-theme-text-primary',
};

const PRIORITY_BADGES: Record<string, string> = {
  low: 'bg-theme-surface-secondary text-theme-text-secondary',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400',
  urgent: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
};

const ActionItemsPage: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const [items, setItems] = useState<ActionItemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [assignedToMe, setAssignedToMe] = useState(false);

  useEffect(() => {
    void fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, assignedToMe]);

  const fetchItems = async () => {
    try {
      setLoading(true);
      const data = await dashboardService.getActionItems({
        ...(statusFilter ? { status_filter: statusFilter } : {}),
        ...(assignedToMe ? { assigned_to_me: assignedToMe } : {}),
      });
      setItems(data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const getDueDateClass = (dueDate?: string) => {
    if (!dueDate) return 'text-theme-text-muted';
    const due = new Date(dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return 'text-red-700 dark:text-red-400 font-semibold';
    if (diff <= 3) return 'text-orange-700 dark:text-orange-400';
    return 'text-theme-text-secondary';
  };

  const overdue = items.filter((i) => {
    if (!i.due_date) return false;
    return new Date(i.due_date) < new Date() && !['completed', 'cancelled'].includes(i.status);
  }).length;

  const open = items.filter((i) => !['completed', 'cancelled'].includes(i.status)).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
          <ClipboardList className="h-6 w-6 text-red-700 dark:text-red-400" />
          Action Items
        </h1>
        <p className="text-theme-text-muted mt-1 text-sm">Unified view of action items from meetings and minutes</p>
      </div>

      {/* Summary Cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card-secondary p-4">
          <p className="text-theme-text-muted text-sm">Total Items</p>
          <p className="text-theme-text-primary text-2xl font-bold">{items.length}</p>
        </div>
        <div className="card-secondary p-4">
          <p className="text-theme-text-muted text-sm">Open</p>
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{open}</p>
        </div>
        <div className="card-secondary p-4">
          <p className="text-theme-text-muted text-sm">Overdue</p>
          <p className="text-2xl font-bold text-red-700 dark:text-red-400">{overdue}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Filter className="text-theme-text-muted h-4 w-4" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="form-input-sm">
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        <label className="text-theme-text-secondary flex cursor-pointer items-center gap-2 text-sm max-md:min-h-[44px]">
          <input
            type="checkbox"
            checked={assignedToMe}
            onChange={(e) => setAssignedToMe(e.target.checked)}
            className="form-checkbox"
          />
          Assigned to me
        </label>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-red-700 dark:text-red-400">
          {error}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No action items"
          description="Nothing on your plate right now. Action items from meetings and minutes will show up here."
        />
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={`${item.source}-${item.id}`}
              className="card-secondary hover:bg-theme-surface-hover cursor-pointer p-4 transition-colors"
              onClick={() => {
                if (item.source === 'meeting') {
                  void navigate(`/minutes`);
                } else {
                  void navigate(`/minutes/${item.source_id}`);
                }
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-theme-text-primary truncate text-sm font-medium">{item.description}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium ${STATUS_BADGES[item.status] || 'bg-theme-surface-secondary text-theme-text-primary'}`}
                    >
                      {item.status.replace('_', ' ')}
                    </span>
                    {item.priority && (
                      <span
                        className={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium ${PRIORITY_BADGES[item.priority] || ''}`}
                      >
                        {item.priority}
                      </span>
                    )}
                    <span className="text-theme-text-muted text-xs">
                      {item.source === 'meeting' ? 'Meeting' : 'Minutes'}
                    </span>
                    {item.assignee_name && <span className="text-theme-text-muted text-xs">{item.assignee_name}</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {item.due_date ? (
                    <div className={`text-sm ${getDueDateClass(item.due_date)}`}>
                      <Clock className="mr-1 inline h-3 w-3" />
                      {formatDate(item.due_date, tz)}
                    </div>
                  ) : (
                    <span className="text-theme-text-muted text-xs">No due date</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ActionItemsPage;
