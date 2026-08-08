/**
 * AllEntriesTab Component
 *
 * All entries list with status/category filters, pagination, and CSV export.
 */

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router';
import { Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAdminHoursStore } from '../store/adminHoursStore';
import { adminHoursEntryService } from '../services/api';
import { formatDuration } from '../utils/formatDuration';
import { DEFAULT_PAGE_SIZE } from '../../../constants/config';
import { getErrorMessage } from '@/utils/errorHandling';
import { formatDate } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
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
      status: allStatusFilter || undefined,
      categoryId: allCategoryFilter || undefined,
      skip: allPage * DEFAULT_PAGE_SIZE,
      limit: DEFAULT_PAGE_SIZE,
    });
  }, [fetchAllEntries, allStatusFilter, allCategoryFilter, allPage]);

  const handleExportCSV = () => {
    const url = adminHoursEntryService.getExportUrl({
      status: allStatusFilter || undefined,
      categoryId: allCategoryFilter || undefined,
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
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-theme-text-primary text-xl font-semibold">All Entries</h2>
        <button
          onClick={handleExportCSV}
          className="bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={allStatusFilter}
          onChange={(e) => {
            setAllStatusFilter(e.target.value);
            setAllPage(0);
          }}
          className="bg-theme-surface border-theme-surface-border text-theme-text-primary rounded-lg border px-3 py-1.5 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
          <option value="rejected">Rejected</option>
          <option value="active">Active</option>
        </select>
        <select
          value={allCategoryFilter}
          onChange={(e) => {
            setAllCategoryFilter(e.target.value);
            setAllPage(0);
          }}
          className="bg-theme-surface border-theme-surface-border text-theme-text-primary rounded-lg border px-3 py-1.5 text-sm"
        >
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
        {allEntriesTotal > 0 && (
          <span className="text-theme-text-muted ml-auto text-xs">
            Showing {allPage * DEFAULT_PAGE_SIZE + 1}-{Math.min((allPage + 1) * DEFAULT_PAGE_SIZE, allEntriesTotal)} of{' '}
            {allEntriesTotal}
          </span>
        )}
      </div>

      {entriesLoading ? (
        <div className="text-theme-text-secondary py-8 text-center">Loading...</div>
      ) : allEntries.length === 0 ? (
        <div className="bg-theme-surface rounded-lg py-12 text-center">
          <p className="text-theme-text-secondary">No entries found</p>
        </div>
      ) : (
        <>
          <div className="bg-theme-surface overflow-hidden overflow-x-auto rounded-lg shadow-md">
            <table className="w-full">
              <thead>
                <tr className="border-theme-surface-border border-b">
                  <th scope="col" className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium uppercase">
                    Member
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium uppercase">
                    Category
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium uppercase">
                    Date
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium uppercase">
                    Duration
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium uppercase">
                    Method
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium uppercase">
                    Status
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium uppercase">
                    Reviewed By
                  </th>
                </tr>
              </thead>
              <tbody className="divide-theme-surface-border divide-y">
                {allEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="text-theme-text-primary px-4 py-3 text-sm">{entry.userName ?? '-'}</td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: entry.categoryColor ?? '#6B7280' }}
                        />
                        <span className="text-theme-text-primary">{entry.categoryName}</span>
                      </div>
                    </td>
                    <td className="text-theme-text-secondary px-4 py-3 text-sm">{formatDate(entry.clockInAt, tz)}</td>
                    <td className="text-theme-text-secondary px-4 py-3 text-sm">
                      {formatDuration(entry.durationMinutes)}
                    </td>
                    <td className="text-theme-text-secondary px-4 py-3 text-sm">
                      <span className="capitalize">{entry.entryMethod.replace(/_/g, ' ')}</span>
                      {entry.entryMethod === 'event_attendance' && entry.sourceEventId && (
                        <Link
                          to={`/events/${entry.sourceEventId}`}
                          className="text-theme-accent-blue mt-0.5 block max-w-[160px] truncate text-xs hover:underline"
                          title={entry.sourceEventName ?? 'View event'}
                        >
                          {entry.sourceEventName ?? 'View event'}
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          entry.status === 'approved'
                            ? 'bg-green-500/20 text-green-700 dark:text-green-400'
                            : entry.status === 'pending'
                              ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400'
                              : entry.status === 'rejected'
                                ? 'bg-red-500/20 text-red-700 dark:text-red-400'
                                : 'bg-blue-500/20 text-blue-700 dark:text-blue-400'
                        }`}
                      >
                        {entry.status}
                      </span>
                    </td>
                    <td className="text-theme-text-muted px-4 py-3 text-sm">{entry.approverName ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* All Entries Pagination */}
          {allTotalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-4">
              <button
                onClick={() => setAllPage((p) => Math.max(0, p - 1))}
                disabled={allPage === 0}
                className="text-theme-text-secondary hover:text-theme-text-primary flex items-center gap-1 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </button>
              <span className="text-theme-text-muted text-sm">
                Page {allPage + 1} of {allTotalPages}
              </span>
              <button
                onClick={() => setAllPage((p) => Math.min(allTotalPages - 1, p + 1))}
                disabled={allPage >= allTotalPages - 1}
                className="text-theme-text-secondary hover:text-theme-text-primary flex items-center gap-1 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AllEntriesTab;
