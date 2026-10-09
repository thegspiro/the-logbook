/**
 * Every row of the file, line by line.
 *
 * Where a row is corrected or excluded. An edit overrides the file's cell for
 * that one field and can be reverted to it; the cells as uploaded are never
 * changed, so the column mapping can still be redone after editing.
 */

import React, { useMemo, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Modal } from '../../../../components/Modal';
import { Pagination } from '../../../../components/ux';
import type {
  HistoryImportAnalysis,
  HistoryImportRow,
  HistoryImportRowUpdate,
} from '../../../../modules/scheduling/types/historyImport';
import { HISTORY_IMPORT_FIELD_LABELS } from '../../../../modules/scheduling/types/historyImport';

interface ReviewRowsProps {
  analysis: HistoryImportAnalysis;
  fields: string[];
  busy: boolean;
  onRowUpdate: (rowId: string, payload: HistoryImportRowUpdate) => Promise<boolean>;
}

type RowFilter = 'problems' | 'all' | 'excluded' | 'skipped';

const PAGE_SIZE = 50;
const EDIT_MAX_LENGTH = 255;

/** The issues that name a row, flattened, so a row shows why it blocks. */
const rowProblems = (analysis: HistoryImportAnalysis): Map<string, string[]> => {
  const byRow = new Map<string, string[]>();
  for (const issue of analysis.issues) {
    if (!issue.blocking) continue;
    for (const rowId of issue.row_ids) {
      const list = byRow.get(rowId) ?? [];
      list.push(issue.message);
      byRow.set(rowId, list);
    }
  }
  return byRow;
};

const RowEditModal: React.FC<{
  row: HistoryImportRow;
  fields: string[];
  busy: boolean;
  onClose: () => void;
  onSave: (edits: Record<string, string | null>) => void;
}> = ({ row, fields, busy, onClose, onSave }) => {
  const [values, setValues] = useState<Record<string, string>>({ ...row.values });

  const edits = (): Record<string, string | null> => {
    const out: Record<string, string | null> = {};
    for (const field of fields) {
      const next = values[field] ?? '';
      if (next !== (row.values[field] ?? '')) out[field] = next;
    }
    return out;
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Edit line ${row.line_number}`}
      size="lg"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(edits());
      }}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || Object.keys(edits()).length === 0}>
            Save row
          </button>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => {
          const id = `row-edit-${field}`;
          const edited = row.edits && field in row.edits;
          return (
            <div key={field}>
              <label htmlFor={id} className="form-label">
                {HISTORY_IMPORT_FIELD_LABELS[field] ?? field}
                {edited ? ' (edited)' : ''}
              </label>
              <div className="flex gap-2">
                <input
                  id={id}
                  className="form-input"
                  maxLength={EDIT_MAX_LENGTH}
                  value={values[field] ?? ''}
                  onChange={(e) => setValues({ ...values, [field]: e.target.value })}
                />
                {edited && (
                  <button
                    type="button"
                    className="btn-secondary shrink-0"
                    disabled={busy}
                    onClick={() => onSave({ [field]: null })}
                  >
                    Revert
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
};

const ReviewRows: React.FC<ReviewRowsProps> = ({ analysis, fields, busy, onRowUpdate }) => {
  const [filter, setFilter] = useState<RowFilter>('problems');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<HistoryImportRow | null>(null);

  const problems = useMemo(() => rowProblems(analysis), [analysis]);
  const counts = {
    problems: analysis.rows.filter((r) => !r.excluded && problems.has(r.id)).length,
    all: analysis.rows.length,
    excluded: analysis.rows.filter((r) => r.excluded).length,
    skipped: analysis.rows.filter((r) => !r.excluded && r.skipped_reason).length,
  };
  const rows = analysis.rows.filter((r) => {
    if (filter === 'problems') return !r.excluded && problems.has(r.id);
    if (filter === 'excluded') return r.excluded;
    if (filter === 'skipped') return !r.excluded && Boolean(r.skipped_reason);
    return true;
  });
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const shown = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const FILTERS: { id: RowFilter; label: string }[] = [
    { id: 'problems', label: 'Need attention' },
    { id: 'all', label: 'All' },
    { id: 'skipped', label: 'Skipped' },
    { id: 'excluded', label: 'Excluded' },
  ];

  return (
    <section aria-labelledby="review-rows-heading" className="space-y-4">
      <div>
        <h2 id="review-rows-heading" className="text-theme-text-primary text-lg font-semibold">
          Rows
        </h2>
        <p className="text-theme-text-secondary text-sm">
          Correct a row, or exclude it from the import. Cancelled and no-show rows are skipped automatically.
        </p>
      </div>

      <div className="hscroll flex gap-2" role="group" aria-label="Filter rows">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={filter === option.id}
            className={`touch-target-phone rounded-full border px-3 py-1 text-sm whitespace-nowrap ${
              filter === option.id
                ? 'border-violet-600 bg-violet-600/10 text-violet-700 dark:text-violet-300'
                : 'border-theme-surface-border text-theme-text-secondary'
            }`}
            onClick={() => {
              setFilter(option.id);
              setPage(1);
            }}
          >
            {option.label} ({counts[option.id]})
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="card text-theme-text-secondary p-4 text-sm">No rows here.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="rwd-table w-full text-sm">
            <thead>
              <tr className="text-theme-text-secondary text-left text-xs uppercase">
                <th scope="col" className="px-3 py-2">
                  Line
                </th>
                <th scope="col" className="px-3 py-2">
                  Member
                </th>
                <th scope="col" className="px-3 py-2">
                  Unit
                </th>
                <th scope="col" className="px-3 py-2">
                  Date
                </th>
                <th scope="col" className="px-3 py-2">
                  Times
                </th>
                <th scope="col" className="px-3 py-2">
                  Status
                </th>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-theme-surface-border divide-y">
              {shown.map((row) => {
                const rowIssues = problems.get(row.id) ?? [];
                const who =
                  row.values.member_name ||
                  [row.values.first_name, row.values.last_name].filter(Boolean).join(' ') ||
                  row.values.membership_number ||
                  row.values.email ||
                  row.values.username ||
                  '—';
                return (
                  <tr key={row.id} className={row.excluded ? 'opacity-60' : ''}>
                    <td data-label="Line" className="px-3 py-2">
                      {row.line_number}
                    </td>
                    <td data-label="Member" className="px-3 py-2">
                      {who}
                    </td>
                    <td data-label="Unit" className="px-3 py-2">
                      {row.values.unit || '—'}
                      {row.values.agency ? ` (${row.values.agency})` : ''}
                    </td>
                    <td data-label="Date" className="px-3 py-2">
                      {row.values.date || '—'}
                    </td>
                    <td data-label="Times" className="px-3 py-2 whitespace-nowrap">
                      {row.values.start_time || '—'} – {row.values.end_time || '—'}
                    </td>
                    <td data-label="Status" className="px-3 py-2">
                      {row.excluded ? (
                        'Excluded'
                      ) : row.skipped_reason ? (
                        `Skipped: ${row.skipped_reason}`
                      ) : rowIssues.length > 0 ? (
                        <ul className="list-disc pl-4 text-red-700 dark:text-red-400">
                          {rowIssues.map((message) => (
                            <li key={message}>{message}</li>
                          ))}
                        </ul>
                      ) : (
                        'Ready'
                      )}
                      {row.match_decision && (
                        <div className="text-theme-text-secondary mt-1">
                          Decided: {row.match_decision === 'accept' ? 'same shift' : 'separate shift'}{' '}
                          <button
                            type="button"
                            className="underline"
                            disabled={busy}
                            onClick={() => void onRowUpdate(row.id, { match_decision: null })}
                          >
                            Undo
                          </button>
                        </div>
                      )}
                    </td>
                    <td data-label="Actions" className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="btn-icon"
                          aria-label={`Edit line ${row.line_number}`}
                          disabled={busy}
                          onClick={() => setEditing(row)}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={busy}
                          onClick={() => void onRowUpdate(row.id, { excluded: !row.excluded })}
                        >
                          {row.excluded ? 'Include' : 'Exclude'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > PAGE_SIZE && (
        <Pagination currentPage={current} totalItems={rows.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
      )}

      {editing && (
        <RowEditModal
          row={editing}
          fields={fields}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(edits) => {
            void onRowUpdate(editing.id, { edits }).then((ok) => {
              if (ok) setEditing(null);
            });
          }}
        />
      )}
    </section>
  );
};

export default ReviewRows;
