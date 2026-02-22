/**
 * Action Items Page (C2)
 *
 * Unified view of action items from both Meeting and Minutes modules.
 * Allows filtering by status and showing items assigned to the current user.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  Filter,
  ClipboardList,
  Loader2,
} from 'lucide-react';
import { dashboardService } from '../services/api';
import type { ActionItemSummary } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';
import { formatDate } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';

const STATUS_BADGES: Record<string, string> = {
  open: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
  completed: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400',
};

const PRIORITY_BADGES: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400',
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
    fetchItems();
  }, [statusFilter, assignedToMe]);

  const fetchItems = async () => {
    try {
      setLoading(true);
      const data = await dashboardService.getActionItems({
        status_filter: statusFilter || undefined,
        assigned_to_me: assignedToMe || undefined,
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
    if (diff < 0) return 'text-red-400 font-semibold';
    if (diff <= 3) return 'text-orange-400';
    return 'text-theme-text-secondary';
  };

  const overdue = items.filter(i => {
    if (!i.due_date) return false;
    return new Date(i.due_date) < new Date() && !['completed', 'cancelled'].includes(i.status);
  }).length;

  const open = items.filter(i => !['completed', 'cancelled'].includes(i.status)).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-theme-text-primary flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-red-400" />
          Action Items
        </h1>
        <p className="mt-1 text-sm text-theme-text-muted">
          Unified view of action items from meetings and minutes
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-theme-surface-secondary border border-theme-surface-border rounded-lg p-4">
          <p className="text-sm text-theme-text-muted">Total Items</p>
          <p className="text-2xl font-bold text-theme-text-primary">{items.length}</p>
        </div>
        <div className="bg-theme-surface-secondary border border-theme-surface-border rounded-lg p-4">
          <p className="text-sm text-theme-text-muted">Open</p>
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{open}</p>
        </div>
        <div className="bg-theme-surface-secondary border border-theme-surface-border rounded-lg p-4">
          <p className="text-sm text-theme-text-muted">Overdue</p>
          <p className="text-2xl font-bold text-red-700 dark:text-red-400">{overdue}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-theme-text-muted" />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-theme-input-bg border border-theme-input-border rounded-md px-3 py-1.5 text-sm text-theme-text-primary"
          >
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={assignedToMe}
            onChange={e => setAssignedToMe(e.target.checked)}
            className="rounded border-theme-input-border bg-theme-input-bg"
          />
          Assigned to me
        </label>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 text-theme-text-muted animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-theme-text-muted">
          <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>No action items found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div
              key={`${item.source}-${item.id}`}
              className="bg-theme-surface-secondary border border-theme-surface-border rounded-lg p-4 hover:bg-theme-surface-hover transition-colors cursor-pointer"
              onClick={() => {
                if (item.source === 'meeting') {
                  navigate(`/minutes`);
                } else {
                  navigate(`/minutes/${item.source_id}`);
                }
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-theme-text-primary text-sm font-medium truncate">
                    {item.description}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGES[item.status] || 'bg-gray-100 text-gray-800'}`}>
                      {item.status.replace('_', ' ')}
                    </span>
                    {item.priority && (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_BADGES[item.priority] || ''}`}>
                        {item.priority}
                      </span>
                    )}
                    <span className="text-xs text-theme-text-muted">
                      {item.source === 'meeting' ? 'Meeting' : 'Minutes'}
                    </span>
                    {item.assignee_name && (
                      <span className="text-xs text-theme-text-muted">
                        {item.assignee_name}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {item.due_date ? (
                    <div className={`text-sm ${getDueDateClass(item.due_date)}`}>
                      <Clock className="h-3 w-3 inline mr-1" />
                      {formatDate(item.due_date, tz)}
                    </div>
                  ) : (
                    <span className="text-xs text-theme-text-muted">No due date</span>
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
