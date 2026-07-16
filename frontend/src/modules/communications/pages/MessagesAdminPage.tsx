/**
 * Messages Admin Page
 *
 * Compose and manage department messages/announcements, and view per-message
 * read/acknowledgment stats. Gated on notifications.manage at the route level.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Megaphone,
  Plus,
  Trash2,
  BarChart3,
  Pencil,
  Pin,
  Loader2,
  AlertCircle,
  Check,
  Eye,
  Clock,
} from 'lucide-react';
import { Breadcrumbs, ConfirmDialog, EmptyState, SkeletonPage } from '../../../components/ux';
import { messagesService } from '../../../services/api';
import type { DepartmentMessageRecord, AcknowledgmentReport } from '../../../services/adminServices';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDateTime } from '../../../utils/dateFormatting';
import MessageComposeForm from '../components/MessageComposeForm';
import toast from 'react-hot-toast';

const PRIORITY_BADGE: Record<string, string> = {
  normal: 'bg-theme-surface-secondary text-theme-text-secondary',
  important: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  urgent: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};

function audienceLabel(m: DepartmentMessageRecord, roleNames: Record<string, string>): string {
  switch (m.target_type) {
    case 'roles': {
      // target_roles holds role ids; resolve to names, falling back to the raw
      // value for legacy name-based entries that predate role-id targeting.
      const names = (m.target_roles ?? []).map((r) => roleNames[r] ?? r);
      return `Roles: ${names.join(', ') || '—'}`;
    }
    case 'statuses':
      return `Statuses: ${(m.target_statuses ?? []).join(', ') || '—'}`;
    case 'members':
      return `${(m.target_member_ids ?? []).length} members`;
    default:
      return 'Everyone';
  }
}

const MessagesAdminPage: React.FC = () => {
  const tz = useTimezone();
  const [messages, setMessages] = useState<DepartmentMessageRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<DepartmentMessageRecord | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DepartmentMessageRecord | null>(null);
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [report, setReport] = useState<AcknowledgmentReport | null>(null);
  // id -> name, so role-targeted messages show role names instead of raw ids.
  const [roleNames, setRoleNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await messagesService.getMessages({ include_inactive: true });
      setMessages(data.messages);
    } catch {
      setError('Unable to load messages. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const roles = await messagesService.getAvailableRoles();
        setRoleNames(Object.fromEntries(roles.map((r) => [r.id, r.name])));
      } catch {
        // Non-fatal: labels fall back to raw ids if roles can't be loaded.
      }
    })();
  }, []);

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await messagesService.deleteMessage(pendingDelete.id);
      toast.success('Message deleted');
      setPendingDelete(null);
      void load();
    } catch {
      toast.error('Unable to delete the message. Please try again.');
    }
  };

  const handleShowReport = async (id: string) => {
    if (reportFor === id) {
      setReportFor(null);
      setReport(null);
      return;
    }
    setReportFor(id);
    setReport(null);
    try {
      setReport(await messagesService.getAcknowledgmentReport(id));
    } catch {
      toast.error('Unable to load the acknowledgment report.');
      setReportFor(null);
    }
  };

  const startEdit = (m: DepartmentMessageRecord) => {
    setComposing(false);
    setEditing(m);
  };

  if (isLoading) {
    return <SkeletonPage />;
  }

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'Communications' }, { label: 'Messages' }]} />
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
          <Megaphone className="h-6 w-6" aria-hidden="true" />
          Department Messages
        </h1>
        {!composing && !editing && (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="btn-info inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New message
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
        >
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          {error}
        </div>
      )}

      {(composing || editing) && (
        <div className="border-theme-surface-border bg-theme-surface mb-6 rounded-lg border p-4">
          <h2 className="text-theme-text-primary mb-3 text-lg font-semibold">
            {editing ? 'Edit message' : 'New message'}
          </h2>
          <MessageComposeForm
            key={editing?.id ?? 'new'}
            {...(editing ? { message: editing } : {})}
            onSaved={() => {
              setComposing(false);
              setEditing(null);
              void load();
            }}
            onCancel={() => {
              setComposing(false);
              setEditing(null);
            }}
          />
        </div>
      )}

      {messages.length === 0 && !composing && !editing ? (
        <EmptyState
          icon={Megaphone}
          title="No messages yet"
          description="Post a department announcement to reach your members."
          actions={[{ label: 'New message', onClick: () => setComposing(true) }]}
        />
      ) : (
        <ul className="space-y-3">
          {messages.map((m) => (
            <li key={m.id} className="border-theme-surface-border bg-theme-surface rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {m.is_pinned && <Pin className="text-theme-info h-4 w-4" aria-label="Pinned" />}
                    <span className="text-theme-text-primary font-semibold">{m.title}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                        PRIORITY_BADGE[m.priority] ?? PRIORITY_BADGE.normal
                      }`}
                    >
                      {m.priority}
                    </span>
                    {m.requires_acknowledgment && (
                      <span className="bg-theme-surface-secondary text-theme-text-secondary rounded-full px-2 py-0.5 text-xs">
                        Ack required
                      </span>
                    )}
                    {!m.is_active && (
                      <span className="bg-theme-surface-secondary text-theme-text-muted rounded-full px-2 py-0.5 text-xs">
                        Inactive
                      </span>
                    )}
                  </div>
                  <p className="text-theme-text-muted mt-1 text-xs">
                    {audienceLabel(m, roleNames)} · {formatDateTime(m.created_at, tz)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void handleShowReport(m.id)}
                    aria-label="View acknowledgments"
                    className="text-theme-text-secondary hover:bg-theme-surface-secondary rounded-md p-2"
                  >
                    <BarChart3 className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(m)}
                    aria-label="Edit message"
                    className="text-theme-text-secondary hover:bg-theme-surface-secondary rounded-md p-2"
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(m)}
                    aria-label="Delete message"
                    className="rounded-md p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {reportFor === m.id && (
                <div className="border-theme-surface-border text-theme-text-secondary mt-3 border-t pt-3 text-sm">
                  {report ? (
                    <>
                      <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1">
                        <span>
                          Read:{' '}
                          <strong className="text-theme-text-primary">
                            {report.total_read}/{report.total_targeted}
                          </strong>
                        </span>
                        {report.requires_acknowledgment && (
                          <span>
                            Acknowledged:{' '}
                            <strong className="text-theme-text-primary">
                              {report.total_acknowledged}/{report.total_targeted}
                            </strong>
                          </span>
                        )}
                      </div>
                      {report.recipients.length === 0 ? (
                        <p className="text-theme-text-muted">This message is not targeted at anyone.</p>
                      ) : (
                        <ul className="max-h-60 divide-y divide-theme-surface-border overflow-y-auto">
                          {report.recipients.map((r) => {
                            const state = r.is_acknowledged
                              ? {
                                  icon: Check,
                                  label: 'Acknowledged',
                                  cls: 'text-theme-success',
                                }
                              : r.is_read
                                ? { icon: Eye, label: 'Read', cls: 'text-theme-text-muted' }
                                : {
                                    icon: Clock,
                                    label: report.requires_acknowledgment
                                      ? 'Not acknowledged'
                                      : 'Unread',
                                    cls: 'text-amber-600 dark:text-amber-400',
                                  };
                            const StateIcon = state.icon;
                            return (
                              <li key={r.user_id} className="flex items-center justify-between gap-3 py-1.5">
                                <span className="text-theme-text-primary min-w-0 truncate">
                                  {r.name}
                                  {r.status ? (
                                    <span className="text-theme-text-muted ml-2 text-xs capitalize">{r.status}</span>
                                  ) : null}
                                </span>
                                <span className={`flex shrink-0 items-center gap-1 text-xs ${state.cls}`}>
                                  <StateIcon className="h-3.5 w-3.5" aria-hidden="true" />
                                  {state.label}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </>
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title="Delete message"
        message={`Delete "${pendingDelete?.title ?? ''}"? Members will no longer see it. Read and acknowledgment records are kept for compliance.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => void handleDelete()}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
};

export default MessagesAdminPage;
