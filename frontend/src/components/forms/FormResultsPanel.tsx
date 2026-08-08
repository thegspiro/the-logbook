/**
 * FormResultsPanel - Aggregated survey-style results for a form.
 *
 * Fetches all submissions and computes per-field summaries:
 * - Select / Radio / Checkbox / Multiselect → horizontal bar chart
 * - Number → min, max, average, median
 * - Text / Textarea / Email / Phone → response count + recent answers
 * - Date / Time / Datetime → earliest, latest, most common
 *
 * Usage:
 *   <FormResultsPanel formId="uuid" />
 */
import { useState, useEffect, useMemo } from 'react';
import { RefreshCw, AlertCircle, BarChart3, Hash, Type, Calendar, FileText, Download, Users } from 'lucide-react';
import { formsService } from '../../services/api';
import type { FormField, FormSubmission } from '../../services/api';
import { useTimezone } from '../../hooks/useTimezone';
import { formatShortDateTime } from '../../utils/dateFormatting';
import { toDisplayString } from '../../utils/displayValue';
import { FieldType } from '../../constants/enums';

const CHOICE_TYPES = new Set(['select', 'multiselect', 'checkbox', 'radio']);
const TEXT_TYPES = new Set(['text', 'textarea', 'email', 'phone']);
const DATE_TYPES = new Set(['date', 'time', 'datetime']);

interface ChoiceCount {
  label: string;
  value: string;
  count: number;
  percent: number;
}

interface FieldSummary {
  field: FormField;
  responseCount: number;
  /** Choice fields */
  choices?: ChoiceCount[];
  /** Number fields */
  numStats?: { min: number; max: number; avg: number; median: number; sum: number };
  /** Text fields */
  recentAnswers?: string[];
  /** Date fields */
  dateRange?: { earliest: string; latest: string };
}

export interface FormResultsPanelProps {
  formId: string;
}

/** Compute the median of a sorted numeric array. */
function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

const FormResultsPanel = ({ formId }: FormResultsPanelProps) => {
  const tz = useTimezone();
  const [fields, setFields] = useState<FormField[]>([]);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadData();
  }, [formId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load form definition and all submissions
      const formDef = await formsService.getForm(formId);
      setFields(formDef.fields);

      // Paginate through all submissions
      const allSubs: FormSubmission[] = [];
      const pageSize = 100;
      let skip = 0;
      let total = Infinity;

      while (skip < total) {
        const page = await formsService.getSubmissions(formId, { skip, limit: pageSize });
        allSubs.push(...page.submissions);
        total = page.total;
        skip += pageSize;
      }
      setSubmissions(allSubs);
    } catch {
      setError('Failed to load results.');
    } finally {
      setLoading(false);
    }
  };

  const summaries = useMemo((): FieldSummary[] => {
    if (fields.length === 0) return [];

    const sorted = [...fields].sort((a, b) => a.sort_order - b.sort_order);

    return sorted
      .filter(
        (f) =>
          f.field_type !== FieldType.SECTION_HEADER &&
          f.field_type !== FieldType.FILE &&
          f.field_type !== FieldType.SIGNATURE
      )
      .map((field) => {
        // Gather all non-empty values for this field
        const values: string[] = [];
        for (const sub of submissions) {
          const raw = sub.data[field.id];
          const val = typeof raw === 'string' ? raw.trim() : toDisplayString(raw).trim();
          if (val) values.push(val);
        }

        const summary: FieldSummary = {
          field,
          responseCount: values.length,
        };

        if (CHOICE_TYPES.has(field.field_type)) {
          // Count occurrences of each option
          const counts = new Map<string, number>();
          // Initialize with defined options so they all appear
          field.options?.forEach((opt) => counts.set(opt.value, 0));
          for (const val of values) {
            // Multiselect / checkbox store comma-separated values
            const parts = val
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean);
            for (const p of parts) {
              counts.set(p, (counts.get(p) ?? 0) + 1);
            }
          }
          const totalResponses = Math.max(values.length, 1);
          const choices: ChoiceCount[] = [];
          counts.forEach((count, value) => {
            const opt = field.options?.find((o) => o.value === value);
            choices.push({
              label: opt?.label ?? value,
              value,
              count,
              percent: Math.round((count / totalResponses) * 100),
            });
          });
          // Sort by count descending
          choices.sort((a, b) => b.count - a.count);
          summary.choices = choices;
        } else if (field.field_type === FieldType.NUMBER) {
          const nums = values.map(Number).filter((n) => !isNaN(n));
          if (nums.length > 0) {
            nums.sort((a, b) => a - b);
            const sum = nums.reduce((s, n) => s + n, 0);
            summary.numStats = {
              min: nums[0] ?? 0,
              max: nums[nums.length - 1] ?? 0,
              avg: Math.round((sum / nums.length) * 100) / 100,
              median: median(nums),
              sum,
            };
          }
        } else if (DATE_TYPES.has(field.field_type)) {
          if (values.length > 0) {
            const sorted = [...values].sort();
            summary.dateRange = {
              earliest: sorted[0] ?? '',
              latest: sorted[sorted.length - 1] ?? '',
            };
          }
        } else if (TEXT_TYPES.has(field.field_type)) {
          // Show up to 5 most recent unique answers
          const unique = [...new Set(values)];
          summary.recentAnswers = unique.slice(-5).reverse();
        }

        return summary;
      });
  }, [fields, submissions]);

  const exportResultsCsv = () => {
    const lines: string[] = ['Field,Type,Responses,Summary'];
    for (const s of summaries) {
      let summaryText = '';
      if (s.choices) {
        summaryText = s.choices.map((c) => `${c.label}: ${c.count} (${c.percent}%)`).join('; ');
      } else if (s.numStats) {
        summaryText = `Avg: ${s.numStats.avg}, Min: ${s.numStats.min}, Max: ${s.numStats.max}, Median: ${s.numStats.median}`;
      } else if (s.recentAnswers) {
        summaryText = `${s.responseCount} responses`;
      } else if (s.dateRange) {
        summaryText = `${s.dateRange.earliest} to ${s.dateRange.latest}`;
      }
      lines.push(
        [s.field.label, s.field.field_type, String(s.responseCount), summaryText]
          .map((v) => `"${v.replace(/"/g, '""')}"`)
          .join(',')
      );
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `form-results-${formId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="bg-theme-surface-secondary rounded-lg p-8 text-center">
        <RefreshCw className="text-theme-text-muted mx-auto mb-2 h-6 w-6 animate-spin" />
        <p className="text-theme-text-muted text-sm">Analyzing responses...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
        <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-700 dark:text-red-400" />
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        <button
          onClick={() => {
            void loadData();
          }}
          className="ml-auto text-xs text-red-700 underline hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
        >
          Retry
        </button>
      </div>
    );
  }

  if (submissions.length === 0) {
    return (
      <div className="card-secondary p-8 text-center">
        <BarChart3 className="text-theme-text-muted mx-auto mb-3 h-10 w-10" />
        <p className="text-theme-text-muted text-sm">
          No submissions yet. Results will appear here once responses come in.
        </p>
      </div>
    );
  }

  // Determine submission time range
  const submissionDates = submissions.map((s) => s.submitted_at).sort();
  const firstSubmission = submissionDates[0];
  const lastSubmission = submissionDates[submissionDates.length - 1];

  return (
    <div>
      {/* Summary header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Users className="text-theme-text-muted h-4 w-4" />
            <span className="text-theme-text-muted text-sm">
              <span className="text-theme-text-primary text-lg font-bold">{submissions.length}</span>{' '}
              {submissions.length === 1 ? 'response' : 'responses'}
            </span>
          </div>
          {firstSubmission && lastSubmission && (
            <span className="text-theme-text-muted text-xs">
              {formatShortDateTime(firstSubmission, tz)} &mdash; {formatShortDateTime(lastSubmission, tz)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={exportResultsCsv}
          className="text-theme-text-muted hover:text-theme-text-primary bg-theme-surface-secondary hover:bg-theme-surface-hover flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors"
        >
          <Download className="h-3.5 w-3.5" />
          Export Summary
        </button>
      </div>

      {/* Per-field results */}
      <div className="space-y-6">
        {summaries.map((summary) => (
          <div key={summary.field.id} className="card-secondary p-5">
            {/* Field header */}
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {CHOICE_TYPES.has(summary.field.field_type) ? (
                  <BarChart3 className="h-4 w-4 text-red-700 dark:text-red-400" />
                ) : summary.field.field_type === FieldType.NUMBER ? (
                  <Hash className="h-4 w-4 text-cyan-700 dark:text-cyan-400" />
                ) : DATE_TYPES.has(summary.field.field_type) ? (
                  <Calendar className="h-4 w-4 text-green-700 dark:text-green-400" />
                ) : (
                  <Type className="text-theme-text-muted h-4 w-4" />
                )}
                <h4 className="text-theme-text-primary text-sm font-semibold">{summary.field.label}</h4>
              </div>
              <span className="text-theme-text-muted text-xs">
                {summary.responseCount} / {submissions.length} answered
              </span>
            </div>

            {/* Choice field — horizontal bar chart */}
            {summary.choices && (
              <div className="space-y-2">
                {summary.choices.map((choice) => (
                  <div key={choice.value}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-theme-text-secondary mr-3 truncate text-sm">{choice.label}</span>
                      <span className="text-theme-text-muted flex-shrink-0 text-xs">
                        {choice.count} ({choice.percent}%)
                      </span>
                    </div>
                    <div className="bg-theme-surface-secondary h-2.5 w-full overflow-hidden rounded-full">
                      <div
                        className="h-full rounded-full bg-red-600 transition-all duration-500"
                        style={{ width: `${Math.max(choice.percent, choice.count > 0 ? 2 : 0)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Number field — stat cards */}
            {summary.numStats && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="bg-theme-surface-secondary rounded-lg p-3 text-center">
                  <p className="text-theme-text-muted mb-1 text-[10px] tracking-wide uppercase">Average</p>
                  <p className="text-theme-text-primary text-xl font-bold">{summary.numStats.avg}</p>
                </div>
                <div className="bg-theme-surface-secondary rounded-lg p-3 text-center">
                  <p className="text-theme-text-muted mb-1 text-[10px] tracking-wide uppercase">Median</p>
                  <p className="text-theme-text-primary text-xl font-bold">{summary.numStats.median}</p>
                </div>
                <div className="bg-theme-surface-secondary rounded-lg p-3 text-center">
                  <p className="text-theme-text-muted mb-1 text-[10px] tracking-wide uppercase">Min</p>
                  <p className="text-theme-text-primary text-xl font-bold">{summary.numStats.min}</p>
                </div>
                <div className="bg-theme-surface-secondary rounded-lg p-3 text-center">
                  <p className="text-theme-text-muted mb-1 text-[10px] tracking-wide uppercase">Max</p>
                  <p className="text-theme-text-primary text-xl font-bold">{summary.numStats.max}</p>
                </div>
              </div>
            )}

            {/* Date field — range */}
            {summary.dateRange && (
              <div className="text-theme-text-secondary flex items-center gap-3 text-sm">
                <div className="bg-theme-surface-secondary rounded-lg px-3 py-2">
                  <p className="text-theme-text-muted text-[10px] tracking-wide uppercase">Earliest</p>
                  <p className="font-medium">{summary.dateRange.earliest}</p>
                </div>
                <span className="text-theme-text-muted">&rarr;</span>
                <div className="bg-theme-surface-secondary rounded-lg px-3 py-2">
                  <p className="text-theme-text-muted text-[10px] tracking-wide uppercase">Latest</p>
                  <p className="font-medium">{summary.dateRange.latest}</p>
                </div>
              </div>
            )}

            {/* Text field — recent answers */}
            {summary.recentAnswers && (
              <div>
                <p className="text-theme-text-muted mb-2 text-xs">Recent answers:</p>
                <div className="space-y-1.5">
                  {summary.recentAnswers.map((answer, i) => (
                    <div key={i} className="bg-theme-surface-secondary rounded-lg px-3 py-2">
                      <p className="text-theme-text-secondary text-sm break-words">
                        <FileText className="text-theme-text-muted mr-1.5 inline-block h-3 w-3 align-text-top" />
                        {answer}
                      </p>
                    </div>
                  ))}
                  {summary.responseCount > 5 && (
                    <p className="text-theme-text-muted text-xs">+ {summary.responseCount - 5} more responses</p>
                  )}
                </div>
              </div>
            )}

            {/* No responses for this field */}
            {summary.responseCount === 0 && <p className="text-theme-text-muted text-sm italic">No responses yet</p>}
          </div>
        ))}
      </div>
    </div>
  );
};

export default FormResultsPanel;
