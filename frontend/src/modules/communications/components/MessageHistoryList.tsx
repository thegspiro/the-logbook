/**
 * Message History List
 *
 * Displays a paginated, searchable list of all emails sent by the application.
 * Includes a "Send Test Email" action to verify email configuration.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Send,
  Loader2,
  Mail,
  Filter,
  Calendar,
} from 'lucide-react';
import { messageHistoryService } from '../../../services/api';
import type { MessageHistoryRecord, EmailTemplate } from '../types';
import toast from 'react-hot-toast';
import { localToUTC, formatShortDateTime } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';

interface MessageHistoryListProps {
  templates: EmailTemplate[];
}

const PAGE_SIZE = 20;

const MessageHistoryList: React.FC<MessageHistoryListProps> = ({ templates }) => {
  const tz = useTimezone();
  const [items, setItems] = useState<MessageHistoryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sentAfter, setSentAfter] = useState('');
  const [sentBefore, setSentBefore] = useState('');

  // Test email state
  const [showTestForm, setShowTestForm] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testTemplateId, setTestTemplateId] = useState('');
  const [isSendingTest, setIsSendingTest] = useState(false);

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await messageHistoryService.list({
        skip: page * PAGE_SIZE,
        limit: PAGE_SIZE,
        status_filter: statusFilter || undefined,
        search: search || undefined,
        sent_after: sentAfter ? localToUTC(sentAfter + 'T00:00', tz) : undefined,
        sent_before: sentBefore
          ? localToUTC(sentBefore + 'T23:59', tz)
          : undefined,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch {
      toast.error('Failed to load message history');
    } finally {
      setIsLoading(false);
    }
  }, [page, statusFilter, search, sentAfter, sentBefore, tz]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [search, statusFilter, sentAfter, sentBefore]);

  const handleSendTest = async () => {
    if (!testEmail.trim()) {
      toast.error('Please enter a recipient email address');
      return;
    }
    setIsSendingTest(true);
    try {
      const result = await messageHistoryService.sendTestEmail({
        to_email: testEmail.trim(),
        template_id: testTemplateId || undefined,
      });
      if (result.status === 'sent') {
        toast.success(`Test email sent to ${testEmail}`);
      } else {
        toast.error(`Test email failed: ${result.error_message ?? 'Unknown error'}`);
      }
      setShowTestForm(false);
      setTestEmail('');
      setTestTemplateId('');
      void fetchHistory();
    } catch {
      toast.error('Failed to send test email');
    } finally {
      setIsSendingTest(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const templateLabel = (type: string | undefined) => {
    if (!type) return '';
    return type
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const inputClass =
    'w-full rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';
  const selectClass =
    'rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

  return (
    <div className="space-y-4">
      {/* Header with Send Test Email button */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-theme-text-primary">
          Message History
        </h2>
        <button
          onClick={() => setShowTestForm(!showTestForm)}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          <Send className="h-4 w-4" />
          Send Test Email
        </button>
      </div>

      {/* Send Test Email Form */}
      {showTestForm && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-theme-text-primary">
            Send Test Email
          </h3>
          <p className="text-xs text-theme-text-muted">
            Send a test email to verify your email configuration is working correctly.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-theme-text-secondary mb-1">
                Recipient Email *
              </label>
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="admin@example.com"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-theme-text-secondary mb-1">
                Template (optional)
              </label>
              <select
                value={testTemplateId}
                onChange={(e) => setTestTemplateId(e.target.value)}
                className={selectClass + ' w-full'}
              >
                <option value="">Default test message</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                void handleSendTest();
              }}
              disabled={isSendingTest || !testEmail.trim()}
              className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSendingTest ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {isSendingTest ? 'Sending...' : 'Send Test'}
            </button>
            <button
              onClick={() => setShowTestForm(false)}
              className="rounded-md border border-theme-surface-border px-4 py-2 text-sm text-theme-text-secondary hover:bg-theme-surface-hover"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-theme-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search by subject or recipient..." placeholder="Search by subject or recipient..."
            className={inputClass + ' pl-9'}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-theme-text-muted" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={selectClass}
          >
            <option value="">All statuses</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-theme-text-muted" />
          <input
            type="date"
            value={sentAfter}
            onChange={(e) => setSentAfter(e.target.value)}
            className={selectClass}
            title="Sent after"
          />
          <span className="text-xs text-theme-text-muted">to</span>
          <input
            type="date"
            value={sentBefore}
            onChange={(e) => setSentBefore(e.target.value)}
            className={selectClass}
            title="Sent before"
          />
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-theme-text-muted" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12">
          <Mail className="h-12 w-12 mx-auto text-theme-text-muted mb-3" />
          <p className="text-theme-text-secondary text-sm">
            {search || statusFilter
              ? 'No messages match your filters.'
              : 'No emails have been sent yet.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-theme-surface-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-theme-surface-secondary text-left">
                <th scope="col" className="px-4 py-3 font-medium text-theme-text-secondary">Status</th>
                <th scope="col" className="px-4 py-3 font-medium text-theme-text-secondary">Recipient</th>
                <th scope="col" className="px-4 py-3 font-medium text-theme-text-secondary">Subject</th>
                <th scope="col" className="px-4 py-3 font-medium text-theme-text-secondary hidden lg:table-cell">
                  Type
                </th>
                <th scope="col" className="px-4 py-3 font-medium text-theme-text-secondary">Sent At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-theme-surface-border">
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="bg-theme-surface hover:bg-theme-surface-hover transition-colors"
                >
                  <td className="px-4 py-3">
                    {item.status === 'sent' ? (
                      <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                        <CheckCircle2 className="h-4 w-4" />
                        <span className="text-xs">Sent</span>
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 text-red-600 dark:text-red-400"
                        title={item.error_message ?? 'Failed'}
                      >
                        <XCircle className="h-4 w-4" />
                        <span className="text-xs">Failed</span>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-theme-text-primary truncate max-w-[200px]">
                    {item.to_email}
                    {item.recipient_count > 1 && (
                      <span className="ml-1 text-xs text-theme-text-muted">
                        (+{item.recipient_count - 1})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-theme-text-primary truncate max-w-[300px]">
                    {item.subject}
                  </td>
                  <td className="px-4 py-3 text-theme-text-muted hidden lg:table-cell">
                    {item.template_type ? (
                      <span className="inline-flex items-center rounded-full bg-theme-surface-secondary px-2 py-0.5 text-xs">
                        {templateLabel(item.template_type)}
                      </span>
                    ) : (
                      <span className="text-xs text-theme-text-muted">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-theme-text-muted whitespace-nowrap">
                    {formatShortDateTime(item.sent_at, tz)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-theme-text-muted">
            Showing {page * PAGE_SIZE + 1}-
            {Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-md border border-theme-surface-border p-1.5 text-theme-text-secondary hover:bg-theme-surface-hover disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 text-xs text-theme-text-secondary">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded-md border border-theme-surface-border p-1.5 text-theme-text-secondary hover:bg-theme-surface-hover disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MessageHistoryList;
