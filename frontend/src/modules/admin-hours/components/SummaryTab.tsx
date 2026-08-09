/**
 * SummaryTab Component
 *
 * Hours summary display showing total, approved, and pending hours
 * along with a per-category breakdown.
 */

import React, { useEffect } from 'react';
import { useAdminHoursStore } from '../store/adminHoursStore';

const SummaryTab: React.FC = () => {
  const summary = useAdminHoursStore((s) => s.summary);
  const fetchSummary = useAdminHoursStore((s) => s.fetchSummary);

  // Fetch summary data on mount
  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  return (
    <div>
      <h2 className="text-theme-text-primary mb-4 text-xl font-semibold">Hours Summary</h2>
      {!summary ? (
        <div className="text-theme-text-secondary py-8 text-center">Loading summary...</div>
      ) : (
        <div>
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="bg-theme-surface rounded-lg p-6 shadow-md">
              <p className="text-theme-text-muted text-sm">Total Hours</p>
              <p className="text-theme-text-primary text-3xl font-bold">{summary.totalHours}</p>
              <p className="text-theme-text-muted mt-1 text-xs">{summary.totalEntries} entries</p>
            </div>
            <div className="bg-theme-surface rounded-lg p-6 shadow-md">
              <p className="text-sm text-green-700 dark:text-green-400">Approved Hours</p>
              <p className="text-3xl font-bold text-green-700 dark:text-green-400">{summary.approvedHours}</p>
              <p className="text-theme-text-muted mt-1 text-xs">{summary.approvedEntries} entries</p>
            </div>
            <div className="bg-theme-surface rounded-lg p-6 shadow-md">
              <p className="text-sm text-yellow-700 dark:text-yellow-400">Pending Hours</p>
              <p className="text-3xl font-bold text-yellow-700 dark:text-yellow-400">{summary.pendingHours}</p>
              <p className="text-theme-text-muted mt-1 text-xs">{summary.pendingEntries} entries</p>
            </div>
          </div>

          {summary.byCategory.length > 0 && (
            <div className="bg-theme-surface rounded-lg p-6 shadow-md">
              <h3 className="text-theme-text-primary mb-4 font-semibold">By Category</h3>
              <div className="space-y-3">
                {summary.byCategory.map((cat) => (
                  <div key={cat.categoryId} className="flex items-center gap-3">
                    <div className="h-3 w-3 rounded-full" style={{ backgroundColor: cat.categoryColor ?? '#6B7280' }} />
                    <span className="text-theme-text-primary flex-1">{cat.categoryName}</span>
                    <span className="text-theme-text-secondary">{cat.totalHours}h</span>
                    <span className="text-theme-text-muted text-sm">({cat.entryCount} entries)</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SummaryTab;
