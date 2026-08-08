/**
 * SubmissionViewer - Displays form submission data in a readable format.
 *
 * Can show a single submission's details or a list of submissions.
 * Embeddable in any module for viewing submitted form data.
 *
 * Usage:
 *   <SubmissionViewer formId="uuid" />
 *
 *   <SubmissionViewer
 *     submission={singleSubmission}
 *     fields={formFields}
 *   />
 */
import { useState, useEffect } from 'react';
import {
  RefreshCw,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  User,
  Globe,
  Trash2,
  Download,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Plug,
} from 'lucide-react';
import { formsService } from '../../services/api';
import { FieldType } from '../../constants/enums';
import type { FormSubmission, FormField } from '../../services/api';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDate, formatShortDateTime } from '../../utils/dateFormatting';

export interface SubmissionViewerProps {
  /** Fetch submissions for this form */
  formId?: string;
  /** Or display a single submission directly */
  submission?: FormSubmission;
  /** Field definitions (needed to resolve field labels from data keys) */
  fields?: FormField[];
  /** Max submissions to show in list mode */
  limit?: number;
  /** Allow deletion */
  allowDelete?: boolean;
  /** Called after a submission is deleted */
  onDelete?: (submissionId: string) => void;
  /** Compact layout */
  compact?: boolean;
}

const SubmissionViewer = ({
  formId,
  submission: directSubmission,
  fields: directFields,
  limit = 20,
  allowDelete = false,
  onDelete,
  compact = false,
}: SubmissionViewerProps) => {
  const tz = useTimezone();
  const [submissions, setSubmissions] = useState<FormSubmission[]>(directSubmission ? [directSubmission] : []);
  const [fields, setFields] = useState<FormField[]>(directFields || []);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(!!formId && !directSubmission);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(directSubmission?.id || null);
  const [page, setPage] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState<string | null>(null);

  useEffect(() => {
    if (formId && !directSubmission) {
      void loadData();
    }
  }, [formId, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (directSubmission) {
      setSubmissions([directSubmission]);
      setExpandedId(directSubmission.id);
    }
  }, [directSubmission]);

  useEffect(() => {
    if (directFields) {
      setFields(directFields);
    }
  }, [directFields]);

  const loadData = async () => {
    if (!formId) return;
    try {
      setLoading(true);
      setError(null);

      // Load form + submissions in parallel
      const [formData, subsData] = await Promise.all([
        fields.length === 0 ? formsService.getForm(formId) : null,
        formsService.getSubmissions(formId, { skip: page * limit, limit }),
      ]);

      if (formData) {
        setFields(formData.fields);
      }
      setSubmissions(subsData.submissions);
      setTotal(subsData.total);
    } catch {
      setError('Failed to load submissions.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (submissionId: string) => {
    if (!formId) return;
    try {
      setDeleting(submissionId);
      await formsService.deleteSubmission(formId, submissionId);
      setSubmissions((prev) => prev.filter((s) => s.id !== submissionId));
      setTotal((prev) => prev - 1);
      onDelete?.(submissionId);
    } catch {
      setError('Failed to delete submission.');
    } finally {
      setDeleting(null);
    }
  };

  const handleReprocess = async (submissionId: string) => {
    if (!formId) return;
    try {
      setReprocessing(submissionId);
      const updated = await formsService.reprocessSubmission(formId, submissionId);
      setSubmissions((prev) => prev.map((s) => (s.id === submissionId ? updated : s)));
    } catch {
      setError('Failed to reprocess integrations.');
    } finally {
      setReprocessing(null);
    }
  };

  const getFieldLabel = (fieldId: string): string => {
    const field = fields.find((f) => f.id === fieldId);
    return field?.label || fieldId;
  };

  const getFieldType = (fieldId: string): string => {
    const field = fields.find((f) => f.id === fieldId);
    return field?.field_type || 'text';
  };

  const formatValue = (fieldId: string, value: unknown): string => {
    if (value === null || value === undefined) return '—';
    const type = getFieldType(fieldId);
    const strVal =
      typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : JSON.stringify(value);

    switch (type) {
      case FieldType.DATE:
        try {
          return formatDate(strVal, tz);
        } catch {
          return strVal;
        }
      case FieldType.TIME:
        return strVal;
      case FieldType.DATETIME:
        try {
          return formatShortDateTime(strVal, tz);
        } catch {
          return strVal;
        }
      case FieldType.CHECKBOX:
      case FieldType.MULTISELECT:
        return strVal.split(',').join(', ');
      default:
        return strVal;
    }
  };

  const exportCsv = () => {
    if (submissions.length === 0) return;

    // Collect all unique field IDs
    const allFieldIds = new Set<string>();
    submissions.forEach((s) => {
      Object.keys(s.data).forEach((k) => allFieldIds.add(k));
    });
    const fieldIds = Array.from(allFieldIds);

    const headers = ['Submitted At', 'Submitter', ...fieldIds.map(getFieldLabel)];
    const rows = submissions.map((s) => [
      formatShortDateTime(s.submitted_at, tz),
      s.submitter_name || s.submitted_by || 'Anonymous',
      ...fieldIds.map((fId) => formatValue(fId, s.data[fId])),
    ]);

    const csv = [
      headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(','),
      ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `submissions-${formId || 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="bg-theme-surface-secondary rounded-lg p-8 text-center">
        <RefreshCw className="text-theme-text-muted mx-auto mb-2 h-6 w-6 animate-spin" />
        <p className="text-theme-text-muted text-sm">Loading submissions...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
        <AlertCircle className="h-4 w-4 shrink-0 text-red-700 dark:text-red-400" />
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        {formId && (
          <button
            onClick={() => {
              void loadData();
            }}
            className="ml-auto text-xs text-red-700 underline hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  if (submissions.length === 0) {
    return (
      <div className="card-secondary p-8 text-center">
        <p className="text-theme-text-muted text-sm">No submissions yet.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      {!directSubmission && (
        <div className={`flex items-center justify-between ${compact ? 'mb-3' : 'mb-4'}`}>
          <span className="text-theme-text-muted text-sm">
            {total} {total === 1 ? 'submission' : 'submissions'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportCsv}
              className="text-theme-text-muted hover:text-theme-text-primary bg-theme-surface-secondary hover:bg-theme-surface-hover flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
            {formId && (
              <button
                type="button"
                onClick={() => {
                  void loadData();
                }}
                className="text-theme-text-muted hover:text-theme-text-primary bg-theme-surface-secondary hover:bg-theme-surface-hover flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
            )}
          </div>
        </div>
      )}

      {/* Submission list */}
      <div className="space-y-2">
        {submissions.map((sub) => {
          const isExpanded = expandedId === sub.id;
          return (
            <div key={sub.id} className="card-secondary overflow-hidden">
              {/* Summary row */}
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : sub.id)}
                aria-expanded={isExpanded}
                aria-label={`Submission by ${sub.submitter_name || sub.submitted_by || 'Anonymous'}`}
                className="hover:bg-theme-surface-secondary flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="text-theme-text-muted h-4 w-4 shrink-0" />
                ) : (
                  <ChevronRight className="text-theme-text-muted h-4 w-4 shrink-0" />
                )}

                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {sub.is_public_submission ? (
                    <Globe className="h-4 w-4 shrink-0 text-cyan-700 dark:text-cyan-400" />
                  ) : (
                    <User className="text-theme-text-muted h-4 w-4 shrink-0" />
                  )}
                  <span className="text-theme-text-primary truncate text-sm">
                    {sub.submitter_name || sub.submitted_by || 'Anonymous'}
                  </span>
                  {sub.submitter_email && (
                    <span className="text-theme-text-muted truncate text-xs">({sub.submitter_email})</span>
                  )}
                </div>

                {sub.integration_processed &&
                  sub.integration_result &&
                  (() => {
                    const results = Object.values(sub.integration_result as Record<string, Record<string, unknown>>);
                    const allOk = results.every((r) => r.success === true);
                    const anyFailed = results.some((r) => r.success === false);
                    return anyFailed ? (
                      <span
                        className="flex shrink-0 items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] text-red-700 dark:text-red-400"
                        title="Integration failed"
                      >
                        <XCircle className="h-3 w-3" />
                        Failed
                      </span>
                    ) : allOk ? (
                      <span
                        className="flex shrink-0 items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] text-green-700 dark:text-green-400"
                        title="Integration succeeded"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Synced
                      </span>
                    ) : null;
                  })()}

                <div className="text-theme-text-muted flex shrink-0 items-center gap-1.5 text-xs">
                  <Clock className="h-3 w-3" />
                  {formatShortDateTime(sub.submitted_at, tz)}
                </div>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-theme-surface-border border-t px-4 py-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {Object.entries(sub.data).map(([fieldId, value]) => (
                      <div key={fieldId} className="bg-theme-surface-secondary rounded-lg px-3 py-2">
                        <p className="text-theme-text-muted mb-0.5 text-xs font-medium">{getFieldLabel(fieldId)}</p>
                        <p className="text-theme-text-primary text-sm wrap-break-word">{formatValue(fieldId, value)}</p>
                      </div>
                    ))}
                  </div>

                  {/* Integration Results */}
                  {sub.integration_processed && sub.integration_result && (
                    <div className="mt-3 space-y-2">
                      <p className="text-theme-text-secondary flex items-center gap-1.5 text-xs font-medium">
                        <Plug className="h-3.5 w-3.5" />
                        Integration Results
                      </p>
                      {Object.entries(sub.integration_result as Record<string, Record<string, unknown>>).map(
                        ([key, result]) => {
                          const succeeded = result.success === true;
                          return (
                            <div
                              key={key}
                              className={`rounded-lg border p-3 ${
                                succeeded ? 'border-green-500/20 bg-green-500/10' : 'border-red-500/20 bg-red-500/10'
                              }`}
                            >
                              <div className="mb-1 flex items-center gap-2">
                                {succeeded ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-700 dark:text-green-400" />
                                ) : (
                                  <XCircle className="h-3.5 w-3.5 shrink-0 text-red-700 dark:text-red-400" />
                                )}
                                <span
                                  className={`text-xs font-medium capitalize ${
                                    succeeded ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
                                  }`}
                                >
                                  {key.replace(/_/g, ' ')}
                                </span>
                              </div>
                              {typeof result.message === 'string' && (
                                <p
                                  className={`ml-5 text-xs ${
                                    succeeded ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'
                                  }`}
                                >
                                  {result.message}
                                </p>
                              )}
                              {!succeeded && typeof result.error === 'string' && (
                                <p className="ml-5 text-xs text-red-700 dark:text-red-300">{result.error}</p>
                              )}
                            </div>
                          );
                        }
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="mt-3 flex justify-end gap-2">
                    {allowDelete && formId && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            void handleReprocess(sub.id);
                          }}
                          disabled={reprocessing === sub.id}
                          aria-label="Reprocess integrations for this submission"
                          className="flex items-center gap-1.5 rounded-lg bg-orange-500/10 px-3 py-1.5 text-xs text-orange-700 transition-colors hover:bg-orange-500/20 hover:text-orange-700 disabled:opacity-50 dark:text-orange-400 dark:hover:text-orange-300"
                        >
                          {reprocessing === sub.id ? (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3 w-3" />
                          )}
                          Reprocess
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void handleDelete(sub.id);
                          }}
                          disabled={deleting === sub.id}
                          aria-label={`Delete submission by ${sub.submitter_name || sub.submitted_by || 'Anonymous'}`}
                          className="flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-red-700 transition-colors hover:bg-red-500/20 hover:text-red-700 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
                        >
                          {deleting === sub.id ? (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="text-theme-text-muted hover:text-theme-text-primary bg-theme-surface-secondary rounded-lg px-3 py-1.5 text-xs disabled:opacity-30"
          >
            Previous
          </button>
          <span className="text-theme-text-muted text-xs">
            Page {page + 1} of {Math.ceil(total / limit)}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={(page + 1) * limit >= total}
            className="text-theme-text-muted hover:text-theme-text-primary bg-theme-surface-secondary rounded-lg px-3 py-1.5 text-xs disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

export default SubmissionViewer;
