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
  RefreshCw, AlertCircle, ChevronDown, ChevronRight, Clock, User,
  Globe, Trash2, Download, CheckCircle2, XCircle, RotateCcw, Plug,
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
    const strVal = typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value);

    switch (type) {
      case FieldType.DATE:
        try { return formatDate(strVal, tz); } catch { return strVal; }
      case FieldType.TIME:
        return strVal;
      case FieldType.DATETIME:
        try { return formatShortDateTime(strVal, tz); } catch { return strVal; }
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
        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-red-700 dark:text-red-400" />
        <p className="text-sm text-theme-text-muted">Loading submissions...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg flex items-center gap-2 bg-red-500/10 border border-red-500/30">
        <AlertCircle className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" />
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        {formId && (
          <button onClick={() => { void loadData(); }} className="ml-auto text-xs text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 underline">Retry</button>
        )}
      </div>
    );
  }

  if (submissions.length === 0) {
    return (
      <div className="card-secondary p-8 text-center">
        <p className="text-sm text-theme-text-muted">No submissions yet.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      {!directSubmission && (
        <div className={`flex items-center justify-between ${compact ? 'mb-3' : 'mb-4'}`}>
          <span className="text-sm text-theme-text-muted">
            {total} {total === 1 ? 'submission' : 'submissions'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-theme-text-muted hover:text-theme-text-primary bg-theme-surface-secondary hover:bg-theme-surface-hover rounded-lg transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
            {formId && (
              <button
                type="button"
                onClick={() => { void loadData(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-theme-text-muted hover:text-theme-text-primary bg-theme-surface-secondary hover:bg-theme-surface-hover rounded-lg transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
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
                className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-theme-surface-secondary transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-theme-text-muted shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-theme-text-muted shrink-0" />
                )}

                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {sub.is_public_submission ? (
                    <Globe className="w-4 h-4 text-cyan-700 dark:text-cyan-400 shrink-0" />
                  ) : (
                    <User className="w-4 h-4 text-theme-text-muted shrink-0" />
                  )}
                  <span className="text-sm text-theme-text-primary truncate">
                    {sub.submitter_name || sub.submitted_by || 'Anonymous'}
                  </span>
                  {sub.submitter_email && (
                    <span className="text-xs text-theme-text-muted truncate">({sub.submitter_email})</span>
                  )}
                </div>

                {sub.integration_processed && sub.integration_result && (() => {
                  const results = Object.values(sub.integration_result as Record<string, Record<string, unknown>>);
                  const allOk = results.every((r) => r.success === true);
                  const anyFailed = results.some((r) => r.success === false);
                  return anyFailed ? (
                    <span className="flex items-center gap-1 text-[11px] text-red-700 dark:text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full shrink-0" title="Integration failed">
                      <XCircle className="w-3 h-3" />
                      Failed
                    </span>
                  ) : allOk ? (
                    <span className="flex items-center gap-1 text-[11px] text-green-700 dark:text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full shrink-0" title="Integration succeeded">
                      <CheckCircle2 className="w-3 h-3" />
                      Synced
                    </span>
                  ) : null;
                })()}

                <div className="flex items-center gap-1.5 text-xs text-theme-text-muted shrink-0">
                  <Clock className="w-3 h-3" />
                  {formatShortDateTime(sub.submitted_at, tz)}
                </div>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-theme-surface-border px-4 py-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {Object.entries(sub.data).map(([fieldId, value]) => (
                      <div key={fieldId} className="bg-theme-surface-secondary rounded-lg px-3 py-2">
                        <p className="text-xs text-theme-text-muted font-medium mb-0.5">{getFieldLabel(fieldId)}</p>
                        <p className="text-sm text-theme-text-primary wrap-break-word">{formatValue(fieldId, value)}</p>
                      </div>
                    ))}
                  </div>

                  {/* Integration Results */}
                  {sub.integration_processed && sub.integration_result && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-medium text-theme-text-secondary flex items-center gap-1.5">
                        <Plug className="w-3.5 h-3.5" />
                        Integration Results
                      </p>
                      {Object.entries(sub.integration_result as Record<string, Record<string, unknown>>).map(([key, result]) => {
                        const succeeded = result.success === true;
                        return (
                          <div
                            key={key}
                            className={`p-3 rounded-lg border ${
                              succeeded
                                ? 'bg-green-500/10 border-green-500/20'
                                : 'bg-red-500/10 border-red-500/20'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              {succeeded ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-green-700 dark:text-green-400 shrink-0" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" />
                              )}
                              <span className={`text-xs font-medium capitalize ${
                                succeeded ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
                              }`}>
                                {key.replace(/_/g, ' ')}
                              </span>
                            </div>
                            {typeof result.message === 'string' && (
                              <p className={`text-xs ml-5 ${
                                succeeded ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'
                              }`}>
                                {result.message}
                              </p>
                            )}
                            {!succeeded && typeof result.error === 'string' && (
                              <p className="text-xs text-red-700 dark:text-red-300 ml-5">
                                {result.error}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="mt-3 flex justify-end gap-2">
                    {allowDelete && formId && (
                      <>
                        <button
                          type="button"
                          onClick={() => { void handleReprocess(sub.id); }}
                          disabled={reprocessing === sub.id}
                          aria-label="Reprocess integrations for this submission"
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-orange-700 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {reprocessing === sub.id ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <RotateCcw className="w-3 h-3" />
                          )}
                          Reprocess
                        </button>
                        <button
                          type="button"
                          onClick={() => { void handleDelete(sub.id); }}
                          disabled={deleting === sub.id}
                          aria-label={`Delete submission by ${sub.submitter_name || sub.submitted_by || 'Anonymous'}`}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {deleting === sub.id ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <Trash2 className="w-3 h-3" />
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
        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1.5 text-xs text-theme-text-muted hover:text-theme-text-primary bg-theme-surface-secondary rounded-lg disabled:opacity-30"
          >
            Previous
          </button>
          <span className="text-xs text-theme-text-muted">
            Page {page + 1} of {Math.ceil(total / limit)}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={(page + 1) * limit >= total}
            className="px-3 py-1.5 text-xs text-theme-text-muted hover:text-theme-text-primary bg-theme-surface-secondary rounded-lg disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

export default SubmissionViewer;
