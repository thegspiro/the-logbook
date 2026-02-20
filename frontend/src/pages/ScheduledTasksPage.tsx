/**
 * Scheduled Tasks Page
 *
 * Admin page for viewing and manually triggering background scheduled tasks.
 */

import React, { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  Clock,
  Play,
  Loader2,
  AlertTriangle,
  Calendar,
  RefreshCw,
} from 'lucide-react';
import { scheduledTasksService } from '../services/api';
import type { ScheduledTask } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';

export const ScheduledTasksPage: React.FC = () => {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningTask, setRunningTask] = useState<string | null>(null);
  const [confirmTask, setConfirmTask] = useState<ScheduledTask | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await scheduledTasksService.listTasks();
      setTasks(data.tasks);
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to load scheduled tasks. Please check your permissions and try again.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleRunTask = async (task: ScheduledTask) => {
    setConfirmTask(null);
    setRunningTask(task.id);

    try {
      await scheduledTasksService.runTask(task.id);
      toast.success(`Task "${formatTaskName(task.id)}" completed successfully`);
    } catch (err) {
      toast.error(getErrorMessage(err, `Failed to run task "${formatTaskName(task.id)}"`));
    } finally {
      setRunningTask(null);
    }
  };

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && confirmTask) {
      setConfirmTask(null);
    }
  }, [confirmTask]);

  const formatTaskName = (id: string): string => {
    return id
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const getFrequencyBadge = (frequency: string) => {
    switch (frequency) {
      case 'daily':
        return 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400';
      case 'weekly':
        return 'bg-purple-500/10 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400';
      case 'monthly':
        return 'bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400';
      default:
        return 'bg-gray-500/10 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-center items-center h-64">
            <Loader2 className="w-8 h-8 text-red-600 animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-theme-text-primary flex items-center gap-2">
              <Clock className="w-7 h-7" />
              Scheduled Tasks
            </h2>
            <p className="mt-1 text-sm text-theme-text-muted">
              Manually trigger background tasks
            </p>
          </div>
          <button
            onClick={fetchTasks}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md border border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-700 dark:text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          </div>
        )}

        {tasks.length === 0 && !error ? (
          <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-12 text-center">
            <Clock className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
            <h3 className="text-lg font-medium text-theme-text-primary mb-1">No Scheduled Tasks</h3>
            <p className="text-sm text-theme-text-muted">
              There are no scheduled tasks configured for this system.
            </p>
          </div>
        ) : (
          <div className="bg-theme-surface rounded-lg border border-theme-surface-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-theme-surface-border">
                <thead>
                  <tr className="bg-theme-surface-secondary">
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                      Task Name
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                      Description
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                      Frequency
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                      Recommended Time
                    </th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-theme-surface-border">
                  {tasks.map((task) => (
                    <tr key={task.id} className="hover:bg-theme-surface-hover transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm font-medium text-theme-text-primary">
                          {formatTaskName(task.id)}
                        </span>
                        <p className="text-xs text-theme-text-muted font-mono mt-0.5">{task.id}</p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm text-theme-text-secondary max-w-md">
                          {task.description}
                        </p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${getFrequencyBadge(task.frequency)}`}>
                          {task.frequency}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-sm text-theme-text-secondary">
                          <Calendar className="w-4 h-4 text-theme-text-muted" />
                          {task.recommended_time}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <button
                          onClick={() => setConfirmTask(task)}
                          disabled={runningTask === task.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                        >
                          {runningTask === task.id ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Running...
                            </>
                          ) : (
                            <>
                              <Play className="w-4 h-4" />
                              Run Now
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Confirmation Modal */}
        {confirmTask && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-task-title"
            onKeyDown={handleKeyDown}
          >
            <div className="bg-theme-surface-modal rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <div className="px-6 py-4 border-b border-theme-surface-border">
                <h3 id="confirm-task-title" className="text-lg font-medium text-theme-text-primary">
                  Confirm Task Execution
                </h3>
              </div>
              <div className="px-6 py-4">
                <p className="text-sm text-theme-text-secondary">
                  Are you sure you want to run <strong className="text-theme-text-primary">{formatTaskName(confirmTask.id)}</strong>?
                </p>
                <p className="text-sm text-theme-text-muted mt-2">
                  {confirmTask.description}
                </p>
                <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-700 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-yellow-700 dark:text-yellow-300">
                      This will execute the task immediately. Normally this task runs {confirmTask.frequency} at {confirmTask.recommended_time}.
                    </p>
                  </div>
                </div>
              </div>
              <div className="px-6 py-4 border-t border-theme-surface-border flex justify-end gap-3">
                <button
                  onClick={() => setConfirmTask(null)}
                  className="px-4 py-2 text-sm font-medium rounded-md border border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleRunTask(confirmTask)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                >
                  <Play className="w-4 h-4" />
                  Run Now
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScheduledTasksPage;
