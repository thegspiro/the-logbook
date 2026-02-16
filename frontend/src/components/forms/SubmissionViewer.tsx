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
  Globe, Trash2, Download,
} from 'lucide-react';
import { formsService } from '../../services/api';
import type { FormSubmission, FormField, FormDetailDef, SubmissionsListResponse } from '../../services/api';

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
  const [submissions, setSubmissions] = useState<FormSubmission[]>(directSubmission ? [directSubmission] : []);
  const [fields, setFields] = useState<FormField[]>(directFields || []);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(!!formId && !directSubmission);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(directSubmission?.id || null);
  const [page, setPage] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (formId && !directSubmission) {
      loadData();
    }
  }, [formId, page]);

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
      ]) as [FormDetailDef | null, SubmissionsListResponse];

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
    const strVal = String(value);

    switch (type) {
      case 'date':
        try { return new Date(strVal).toLocaleDateString(); } catch { return strVal; }
      case 'time':
        return strVal;
      case 'datetime':
        try { return new Date(strVal).toLocaleString(); } catch { return strVal; }
      case 'checkbox':
      case 'multiselect':
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
      new Date(s.submitted_at).toLocaleString(),
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
        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-pink-700 dark:text-pink-400" />
        <p className="text-sm text-theme-text-muted">Loading submissions...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg flex items-center gap-2 bg-red-500/10 border border-red-500/30">
        <AlertCircle className="w-4 h-4 text-red-700 dark:text-red-400 flex-shrink-0" />
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        {formId && (
          <button onClick={loadData} className="ml-auto text-xs text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 underline">Retry</button>
        )}
      </div>
    );
  }

  if (submissions.length === 0) {
    return (
      <div className="bg-theme-surface-secondary border border-theme-surface-border rounded-lg p-8 text-center">
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
                onClick={loadData}
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
            <div key={sub.id} className="bg-theme-surface-secondary border border-theme-surface-border rounded-lg overflow-hidden">
              {/* Summary row */}
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : sub.id)}
                className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-theme-surface-secondary transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" />
                )}

                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {sub.is_public_submission ? (
                    <Globe className="w-4 h-4 text-cyan-700 dark:text-cyan-400 flex-shrink-0" />
                  ) : (
                    <User className="w-4 h-4 text-theme-text-muted flex-shrink-0" />
                  )}
                  <span className="text-sm text-theme-text-primary truncate">
                    {sub.submitter_name || sub.submitted_by || 'Anonymous'}
                  </span>
                  {sub.submitter_email && (
                    <span className="text-xs text-slate-500 truncate">({sub.submitter_email})</span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 text-xs text-slate-500 flex-shrink-0">
                  <Clock className="w-3 h-3" />
                  {new Date(sub.submitted_at).toLocaleString()}
                </div>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-theme-surface-border px-4 py-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {Object.entries(sub.data).map(([fieldId, value]) => (
                      <div key={fieldId} className="bg-theme-surface-secondary rounded-lg px-3 py-2">
                        <p className="text-xs text-slate-500 font-medium mb-0.5">{getFieldLabel(fieldId)}</p>
                        <p className="text-sm text-theme-text-primary break-words">{formatValue(fieldId, value)}</p>
                      </div>
                    ))}
                  </div>

                  {sub.integration_processed && sub.integration_result && (
                    <div className="mt-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                      <p className="text-xs text-green-700 dark:text-green-400 font-medium mb-1">Integration Result</p>
                      <pre className="text-xs text-green-700 dark:text-green-300 overflow-x-auto">
                        {JSON.stringify(sub.integration_result, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Actions */}
                  {allowDelete && formId && (
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleDelete(sub.id)}
                        disabled={deleting === sub.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {deleting === sub.id ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                        Delete
                      </button>
                    </div>
                  )}
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
          <span className="text-xs text-slate-500">
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
