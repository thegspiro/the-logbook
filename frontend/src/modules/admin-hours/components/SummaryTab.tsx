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
      <h2 className="text-xl font-semibold text-theme-text-primary mb-4">Hours Summary</h2>
      {!summary ? (
        <div className="text-center py-8 text-theme-text-secondary">Loading summary...</div>
      ) : (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-theme-surface rounded-lg shadow-md p-6">
              <p className="text-sm text-theme-text-muted">Total Hours</p>
              <p className="text-3xl font-bold text-theme-text-primary">{summary.totalHours}</p>
              <p className="text-xs text-theme-text-muted mt-1">{summary.totalEntries} entries</p>
            </div>
            <div className="bg-theme-surface rounded-lg shadow-md p-6">
              <p className="text-sm text-green-400">Approved Hours</p>
              <p className="text-3xl font-bold text-green-400">{summary.approvedHours}</p>
              <p className="text-xs text-theme-text-muted mt-1">{summary.approvedEntries} entries</p>
            </div>
            <div className="bg-theme-surface rounded-lg shadow-md p-6">
              <p className="text-sm text-yellow-400">Pending Hours</p>
              <p className="text-3xl font-bold text-yellow-400">{summary.pendingHours}</p>
              <p className="text-xs text-theme-text-muted mt-1">{summary.pendingEntries} entries</p>
            </div>
          </div>

          {summary.byCategory.length > 0 && (
            <div className="bg-theme-surface rounded-lg shadow-md p-6">
              <h3 className="font-semibold text-theme-text-primary mb-4">By Category</h3>
              <div className="space-y-3">
                {summary.byCategory.map((cat) => (
                  <div key={cat.category_id} className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.category_color ?? '#6B7280' }} />
                    <span className="flex-1 text-theme-text-primary">{cat.category_name}</span>
                    <span className="text-theme-text-secondary">{cat.total_hours}h</span>
                    <span className="text-theme-text-muted text-sm">({cat.entry_count} entries)</span>
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
