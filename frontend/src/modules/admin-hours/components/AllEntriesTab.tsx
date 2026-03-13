/**
 * AllEntriesTab Component
 *
 * All entries list with status/category filters, pagination, and CSV export.
 */

import React, { useState, useEffect } from 'react';
import { Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAdminHoursStore } from '../store/adminHoursStore';
import { adminHoursEntryService } from '../services/api';
import { formatDuration } from '../utils/formatDuration';
import { DEFAULT_PAGE_SIZE } from '../../../constants/config';
import { getErrorMessage } from '@/utils/errorHandling';
import { formatDate } from '../../../../utils/dateFormatting';
import { useTimezone } from '../../../../hooks/useTimezone';
import toast from 'react-hot-toast';

const AllEntriesTab: React.FC = () => {
  const tz = useTimezone();
  const allEntries = useAdminHoursStore((s) => s.allEntries);
  const allEntriesTotal = useAdminHoursStore((s) => s.allEntriesTotal);
  const entriesLoading = useAdminHoursStore((s) => s.entriesLoading);
  const categories = useAdminHoursStore((s) => s.categories);
  const fetchAllEntries = useAdminHoursStore((s) => s.fetchAllEntries);

  const [allStatusFilter, setAllStatusFilter] = useState<string>('');
  const [allCategoryFilter, setAllCategoryFilter] = useState<string>('');
  const [allPage, setAllPage] = useState(0);

  // Fetch entries when filters or page change
  useEffect(() => {
    void fetchAllEntries({
      status: allStatusFilter ?? undefined,
      categoryId: allCategoryFilter ?? undefined,
      skip: allPage * DEFAULT_PAGE_SIZE,
      limit: DEFAULT_PAGE_SIZE,
    });
  }, [fetchAllEntries, allStatusFilter, allCategoryFilter, allPage]);

  const handleExportCSV = () => {
    const url = adminHoursEntryService.getExportUrl({
      status: allStatusFilter ?? undefined,
      categoryId: allCategoryFilter ?? undefined,
    });
    // Fetch with httpOnly cookie auth (credentials: 'include')
    const a = document.createElement('a');
    void (async () => {
      try {
        const response = await fetch(url, {
          credentials: 'include', // Send httpOnly cookies automatically
        });
        if (!response.ok) {
          throw new Error(`Export failed: ${response.status}`);
        }
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        a.href = blobUrl;
        a.download = 'admin_hours_export.csv';
        a.click();
        URL.revokeObjectURL(blobUrl);
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to export CSV'));
      }
    })();
  };

  const allTotalPages = Math.ceil(allEntriesTotal / DEFAULT_PAGE_SIZE);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-theme-text-primary">All Entries</h2>
        <button
          onClick={handleExportCSV}
          className="flex items-center gap-2 px-3 py-2 bg-theme-surface text-theme-text-secondary rounded-lg border border-theme-surface-border hover:bg-theme-surface-hover transition text-sm"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={allStatusFilter}
          onChange={(e) => { setAllStatusFilter(e.target.value); setAllPage(0); }}
          className="px-3 py-1.5 bg-theme-surface border border-theme-surface-border rounded-lg text-sm text-theme-text-primary"
        >
          <option value="">All Statuses</option>
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
          <option value="rejected">Rejected</option>
          <option value="active">Active</option>
        </select>
        <select
          value={allCategoryFilter}
          onChange={(e) => { setAllCategoryFilter(e.target.value); setAllPage(0); }}
          className="px-3 py-1.5 bg-theme-surface border border-theme-surface-border rounded-lg text-sm text-theme-text-primary"
        >
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </select>
        {allEntriesTotal > 0 && (
          <span className="text-xs text-theme-text-muted ml-auto">
            Showing {allPage * DEFAULT_PAGE_SIZE + 1}-{Math.min((allPage + 1) * DEFAULT_PAGE_SIZE, allEntriesTotal)} of {allEntriesTotal}
          </span>
        )}
      </div>

      {entriesLoading ? (
        <div className="text-center py-8 text-theme-text-secondary">Loading...</div>
      ) : allEntries.length === 0 ? (
        <div className="text-center py-12 bg-theme-surface rounded-lg">
          <p className="text-theme-text-secondary">No entries found</p>
        </div>
      ) : (
        <>
          <div className="bg-theme-surface rounded-lg shadow-md overflow-hidden overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-theme-surface-border">
                  <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase">Member</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase">Duration</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase">Method</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase">Reviewed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-surface-border">
                {allEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-3 text-sm text-theme-text-primary">{entry.userName ?? '-'}</td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.categoryColor ?? '#6B7280' }} />
                        <span className="text-theme-text-primary">{entry.categoryName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-theme-text-secondary">{formatDate(entry.clockInAt, tz)}</td>
                    <td className="px-4 py-3 text-sm text-theme-text-secondary">{formatDuration(entry.durationMinutes)}</td>
                    <td className="px-4 py-3 text-sm text-theme-text-secondary capitalize">{entry.entryMethod.replace('_', ' ')}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        entry.status === 'approved' ? 'bg-green-500/20 text-green-400' :
                        entry.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                        entry.status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                        'bg-blue-500/20 text-blue-400'
                      }`}>
                        {entry.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-theme-text-muted">{entry.approverName ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* All Entries Pagination */}
          {allTotalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-4">
              <button
                onClick={() => setAllPage((p) => Math.max(0, p - 1))}
                disabled={allPage === 0}
                className="flex items-center gap-1 px-3 py-1 text-sm text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" /> Previous
              </button>
              <span className="text-sm text-theme-text-muted">
                Page {allPage + 1} of {allTotalPages}
              </span>
              <button
                onClick={() => setAllPage((p) => Math.min(allTotalPages - 1, p + 1))}
                disabled={allPage >= allTotalPages - 1}
                className="flex items-center gap-1 px-3 py-1 text-sm text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AllEntriesTab;
