/**
 * Every row of the file, line by line.
 *
 * Where a row is corrected or excluded, and where each row-level question the
 * analysis asks is answered in place: a probable crew match, a member listed
 * twice on one shift, a shift that may already be on the schedule. An edit
 * overrides the file's cell for that one field and can be reverted to it; the
 * cells as uploaded are never changed, so the column mapping can still be
 * redone after editing.
 *
 * Nothing here decides whether a row is a problem. The issues are the
 * backend's, and the buttons send the decision that issue asks for; the fresh
 * analysis that comes back is what the table shows next (pitfall #29).
 */

import React, { useMemo, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Modal } from '../../../../components/Modal';
import { Pagination } from '../../../../components/ux';
import type {
  HistoryImportAnalysis,
  HistoryImportIssue,
  HistoryImportRow,
  HistoryImportRowUpdate,
  MatchDecision,
} from '../../../../modules/scheduling/types/historyImport';
import { HISTORY_IMPORT_FIELD_LABELS } from '../../../../modules/scheduling/types/historyImport';
import { issueLabel } from './historyImportLabels';

/** A set of rows the reviewer was sent to, from an issue. */
export interface RowFocus {
  label: string;
  rowIds: string[];
}

export interface RowActions {
  busy: boolean;
  onRowUpdate: (rowId: string, payload: HistoryImportRowUpdate) => Promise<boolean>;
  /** Answer a probable match against a shift already on the schedule. */
  onExistingDecision: (shiftKey: string, decision: MatchDecision) => void;
}

interface ReviewRowsProps extends RowActions {
  analysis: HistoryImportAnalysis;
  fields: string[];
  /** Field → the file's header, to show what the file said under an edit. */
  columnMapping: Record<string, string>;
  /** Answer every probable crew match still waiting, at once. */
  onDecideAll: (decision: MatchDecision) => void;
  focus: RowFocus | null;
  onFocus: (focus: RowFocus | null) => void;
}

type RowFilter = 'problems' | 'all' | 'excluded' | 'skipped';

const PAGE_SIZE = 50;
const EDIT_MAX_LENGTH = 255;
const TIME_FIELDS = ['start_time', 'end_time'];

/** The edit dialog's sections, by field. A field in none of them goes under "Other". */
const FIELD_GROUPS: { title: string; fields: string[] }[] = [
  { title: 'When', fields: ['date', 'start_time', 'end_time', 'hours', 'duty_type'] },
  { title: 'Who', fields: ['member_name', 'first_name', 'last_name', 'membership_number', 'email', 'username'] },
  { title: 'Where', fields: ['unit', 'agency', 'position'] },
];

/** The blocking issues that name a row, so a row shows why it blocks. */
const rowIssues = (analysis: HistoryImportAnalysis): Map<string, HistoryImportIssue[]> => {
  const byRow = new Map<string, HistoryImportIssue[]>();
  for (const issue of analysis.issues) {
    if (!issue.blocking) continue;
    for (const rowId of issue.row_ids) {
      const list = byRow.get(rowId) ?? [];
      list.push(issue);
      byRow.set(rowId, list);
    }
  }
  return byRow;
};

const memberOf = (row: HistoryImportRow): string =>
  row.values.member_name ||
  [row.values.first_name, row.values.last_name].filter(Boolean).join(' ') ||
  row.values.membership_number ||
  row.values.email ||
  row.values.username ||
  '—';

const unitOf = (row: HistoryImportRow): string =>
  `${row.values.unit || '—'}${row.values.agency ? ` (${row.values.agency})` : ''}`;

const timesOf = (row: HistoryImportRow): string => `${row.values.start_time || '—'} – ${row.values.end_time || '—'}`;

/** What the file's own cell held for a field, before any edit. */
const fileValue = (row: HistoryImportRow, columnMapping: Record<string, string>, field: string): string => {
  const header = columnMapping[field];
  if (!header) return '';
  const value = row.raw[header];
  if (value === null || value === undefined) return '';
  return (typeof value === 'string' ? value : JSON.stringify(value)).trim();
};

/**
 * The buttons an issue asks for, on the row it is shown against. Excluding and
 * editing are on every row already, so only the decisions are offered here.
 */
const IssueDecisions: React.FC<{ issue: HistoryImportIssue; rowId: string } & RowActions> = ({
  issue,
  rowId,
  busy,
  onRowUpdate,
  onExistingDecision,
}) => {
  if (issue.code === 'probable_match' && issue.row_ids[0] === rowId) {
    return (
      <div className="mt-1 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void onRowUpdate(rowId, { match_decision: 'accept' })}
        >
          Same shift
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => void onRowUpdate(rowId, { match_decision: 'separate' })}
        >
          Keep separate
        </button>
      </div>
    );
  }
  // The later of the two lines is the one joined to a shift the member is
  // already on; keeping it separate puts it on a shift of its own.
  if (issue.code === 'duplicate_member_in_shift' && issue.row_ids[1] === rowId) {
    return (
      <div className="mt-1 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => void onRowUpdate(rowId, { match_decision: 'separate' })}
        >
          Keep this line separate
        </button>
      </div>
    );
  }
  if (issue.code === 'probable_existing_match' && issue.ref) {
    const shiftKey = issue.ref;
    return (
      <div className="mt-1 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => onExistingDecision(shiftKey, 'accept')}
        >
          Add to the scheduled shift
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => onExistingDecision(shiftKey, 'separate')}
        >
          Import separately
        </button>
      </div>
    );
  }
  return null;
};

/**
 * Start and end, editable in the table, for a row whose times collide with
 * another line's. An overlap is nearly always one mistyped time, and fixing it
 * should not take a dialog; the value is saved as an edit like any other, so
 * Revert in the dialog still restores the file's cell. Only fields the column
 * mapping reads are offered — a file with no end-time column has nothing here
 * to edit for it.
 */
const InlineTimes: React.FC<{ row: HistoryImportRow; fields: string[] } & Pick<RowActions, 'busy' | 'onRowUpdate'>> = ({
  row,
  fields,
  busy,
  onRowUpdate,
}) => {
  const editable = TIME_FIELDS.filter((f) => fields.includes(f));
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(editable.map((f) => [f, row.values[f] ?? '']))
  );
  const changes: Record<string, string> = {};
  for (const field of editable) {
    const next = (values[field] ?? '').trim();
    if (next !== (row.values[field] ?? '')) changes[field] = next;
  }
  const dirty = Object.keys(changes).length > 0;

  return (
    <form
      className="flex flex-col items-start gap-1"
      aria-label={`Times for line ${row.line_number}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) void onRowUpdate(row.id, { edits: changes });
      }}
    >
      <div className="flex items-center gap-1">
        {editable.map((field, index) => (
          <React.Fragment key={field}>
            {index > 0 && <span aria-hidden="true">–</span>}
            <input
              className="form-input-sm w-20"
              aria-label={`${HISTORY_IMPORT_FIELD_LABELS[field] ?? field}, line ${row.line_number}`}
              maxLength={EDIT_MAX_LENGTH}
              value={values[field] ?? ''}
              onChange={(e) => setValues({ ...values, [field]: e.target.value })}
            />
          </React.Fragment>
        ))}
      </div>
      <button type="submit" className="btn-secondary" disabled={busy || !dirty}>
        Save times
      </button>
    </form>
  );
};

/** Why a row is ready, skipped or excluded, and any decision already made on it. */
const RowState: React.FC<{ row: HistoryImportRow } & RowActions> = ({ row, busy, onRowUpdate }) => (
  <>
    {row.keep_separate && (
      <div className="text-theme-text-secondary mt-1">
        Kept apart from the entry before it{' '}
        <button
          type="button"
          className="underline"
          disabled={busy}
          onClick={() => void onRowUpdate(row.id, { keep_separate: false })}
        >
          Rejoin
        </button>
      </div>
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
  </>
);

const statusText = (row: HistoryImportRow, issues: HistoryImportIssue[]): string | null => {
  if (row.excluded) return 'Excluded';
  if (row.skipped_reason) return `Skipped: ${row.skipped_reason}`;
  return issues.length > 0 ? null : 'Ready';
};

const RowEditModal: React.FC<
  {
    row: HistoryImportRow;
    fields: string[];
    columnMapping: Record<string, string>;
    issues: HistoryImportIssue[];
    related: HistoryImportRow[];
    relatedIssues: Map<string, HistoryImportIssue[]>;
    onClose: () => void;
    onSave: (edits: Record<string, string | null>) => void;
  } & RowActions
> = ({ row, fields, columnMapping, issues, related, relatedIssues, onClose, onSave, ...actions }) => {
  const { busy } = actions;
  const [values, setValues] = useState<Record<string, string>>({ ...row.values });

  const edits = (): Record<string, string | null> => {
    const out: Record<string, string | null> = {};
    for (const field of fields) {
      const next = values[field] ?? '';
      if (next !== (row.values[field] ?? '')) out[field] = next;
    }
    return out;
  };

  const grouped = new Set(FIELD_GROUPS.flatMap((g) => g.fields));
  const sections = [
    ...FIELD_GROUPS.map((g) => ({ title: g.title, fields: g.fields.filter((f) => fields.includes(f)) })),
    { title: 'Other', fields: fields.filter((f) => !grouped.has(f)) },
  ].filter((s) => s.fields.length > 0);

  const state = statusText(row, issues);

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
      <div className="space-y-6">
        <section aria-labelledby="row-edit-status" className="space-y-2">
          <h3 id="row-edit-status" className="text-theme-text-primary text-sm font-semibold">
            Status
          </h3>
          {state ? (
            <p className="text-theme-text-secondary text-sm">{state}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>
                  <span className="text-red-700 dark:text-red-400">{issue.message}</span>
                  <IssueDecisions issue={issue} rowId={row.id} {...actions} />
                </li>
              ))}
            </ul>
          )}
          <div className="text-sm">
            <RowState row={row} {...actions} />
          </div>
        </section>

        {related.length > 0 && (
          <section aria-labelledby="row-edit-related" className="space-y-2">
            <h3 id="row-edit-related" className="text-theme-text-primary text-sm font-semibold">
              Other lines in these issues
            </h3>
            <ul className="divide-theme-surface-border card-secondary divide-y text-sm">
              {related.map((other) => (
                <li key={other.id} className="split-row gap-2 p-2 sm:items-center">
                  <span className="split-row-main">
                    <span className="text-theme-text-primary font-medium">Line {other.line_number}</span>
                    <span className="text-theme-text-secondary">
                      {' '}
                      · {memberOf(other)} · {unitOf(other)} · {other.values.date || '—'} · {timesOf(other)}
                      {' · '}
                      {statusText(other, relatedIssues.get(other.id) ?? []) ?? 'Needs attention'}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="split-row-aside btn-secondary shrink-0"
                    disabled={busy}
                    onClick={() => void actions.onRowUpdate(other.id, { excluded: !other.excluded })}
                  >
                    {other.excluded ? `Include line ${other.line_number}` : `Exclude line ${other.line_number}`}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {sections.map((section) => (
          <fieldset key={section.title} className="space-y-3">
            <legend className="text-theme-text-primary mb-2 text-sm font-semibold">{section.title}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {section.fields.map((field) => {
                const id = `row-edit-${field}`;
                const edited = Boolean(row.edits && field in row.edits);
                const original = fileValue(row, columnMapping, field);
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
                    {edited && (
                      <p className="text-theme-text-secondary mt-1 text-xs">In the file: {original || '(blank)'}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </Modal>
  );
};

const ReviewRows: React.FC<ReviewRowsProps> = ({
  analysis,
  fields,
  columnMapping,
  onDecideAll,
  focus,
  onFocus,
  ...actions
}) => {
  const { busy, onRowUpdate } = actions;
  const [filter, setFilter] = useState<RowFilter>('problems');
  const [code, setCode] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);

  const issuesByRow = useMemo(() => rowIssues(analysis), [analysis]);
  const rowsById = useMemo(() => new Map(analysis.rows.map((r) => [r.id, r])), [analysis.rows]);

  const needsAttention = (r: HistoryImportRow) => !r.excluded && issuesByRow.has(r.id);
  const counts = {
    problems: analysis.rows.filter(needsAttention).length,
    all: analysis.rows.length,
    excluded: analysis.rows.filter((r) => r.excluded).length,
    skipped: analysis.rows.filter((r) => !r.excluded && r.skipped_reason).length,
  };

  /** Rows needing attention, counted by each kind of issue they carry. */
  const codeCounts = useMemo(() => {
    const out = new Map<string, number>();
    for (const row of analysis.rows) {
      if (row.excluded) continue;
      const codes = new Set((issuesByRow.get(row.id) ?? []).map((i) => i.code));
      for (const c of codes) out.set(c, (out.get(c) ?? 0) + 1);
    }
    return [...out.entries()].sort((a, b) => b[1] - a[1]);
  }, [analysis.rows, issuesByRow]);
  const activeCode = code && codeCounts.some(([c]) => c === code) ? code : null;

  const probable = analysis.issues.filter((i) => i.blocking && i.code === 'probable_match').length;

  const rows = focus
    ? focus.rowIds.map((id) => rowsById.get(id)).filter((r): r is HistoryImportRow => r !== undefined)
    : analysis.rows.filter((r) => {
        if (filter === 'problems') {
          if (!needsAttention(r)) return false;
          return !activeCode || (issuesByRow.get(r.id) ?? []).some((i) => i.code === activeCode);
        }
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

  const chipClass = (active: boolean) =>
    `touch-target-phone rounded-full border px-3 py-1 text-sm whitespace-nowrap ${
      active
        ? 'border-violet-600 bg-violet-600/10 text-violet-700 dark:text-violet-300'
        : 'border-theme-surface-border text-theme-text-secondary'
    }`;

  const editing = editingId ? rowsById.get(editingId) : undefined;
  const editingIssues = editing ? (issuesByRow.get(editing.id) ?? []) : [];
  const relatedIds = new Set(editingIssues.flatMap((i) => (i.row_ids.length <= 10 ? i.row_ids : [])));
  if (editing) relatedIds.delete(editing.id);
  const related = [...relatedIds]
    .map((id) => rowsById.get(id))
    .filter((r): r is HistoryImportRow => r !== undefined)
    .sort((a, b) => a.line_number - b.line_number);

  return (
    <section aria-labelledby="review-rows-heading" className="space-y-4">
      <div>
        <h2 id="review-rows-heading" className="text-theme-text-primary text-lg font-semibold">
          Rows
        </h2>
        <p className="text-theme-text-secondary text-sm">
          Answer each row's question, correct it, or exclude it from the import. Cancelled and no-show rows are skipped
          automatically.
        </p>
      </div>

      {probable > 0 && (
        <div className="card split-row gap-3 p-4 sm:items-center">
          <p className="split-row-main text-theme-text-secondary text-sm">
            {probable} {probable === 1 ? 'row is a probable match' : 'rows are probable matches'} for a crew's shift — a
            member who signed in up to two hours away from the rest. Answer each below, or all of them at once.
          </p>
          <div className="split-row-aside flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => onDecideAll('accept')}>
              All the same shift
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => onDecideAll('separate')}>
              Keep all separate
            </button>
          </div>
        </div>
      )}

      <div className="hscroll flex gap-2" role="group" aria-label="Filter rows">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={!focus && filter === option.id}
            className={chipClass(!focus && filter === option.id)}
            onClick={() => {
              setFilter(option.id);
              setPage(1);
              onFocus(null);
            }}
          >
            {option.label} ({counts[option.id]})
          </button>
        ))}
      </div>

      {!focus && filter === 'problems' && codeCounts.length > 1 && (
        <div className="hscroll flex gap-2" role="group" aria-label="Filter by issue">
          <button
            type="button"
            aria-pressed={!activeCode}
            className={chipClass(!activeCode)}
            onClick={() => {
              setCode(null);
              setPage(1);
            }}
          >
            Any issue
          </button>
          {codeCounts.map(([c, n]) => (
            <button
              key={c}
              type="button"
              aria-pressed={activeCode === c}
              className={chipClass(activeCode === c)}
              onClick={() => {
                setCode(c);
                setPage(1);
              }}
            >
              {issueLabel(c)} ({n})
            </button>
          ))}
        </div>
      )}

      {focus && (
        <div className="alert-info split-row gap-3 rounded-lg p-3 text-sm sm:items-center">
          <p className="split-row-main">
            Showing {rows.length === 1 ? 'line' : 'lines'} {rows.map((r) => r.line_number).join(', ')}: {focus.label}
          </p>
          <button
            type="button"
            className="split-row-aside btn-secondary shrink-0"
            onClick={() => {
              setPage(1);
              onFocus(null);
            }}
          >
            Show all rows
          </button>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="card text-theme-text-secondary p-4 text-sm">No rows here.</p>
      ) : (
        <div className="card rwd-table-container overflow-x-auto">
          <table className="rwd-table rwd-table-wide w-full text-sm">
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
                const issues = issuesByRow.get(row.id) ?? [];
                const state = statusText(row, issues);
                return (
                  <tr key={row.id} className={row.excluded ? 'opacity-60' : ''}>
                    <td data-label="Line" className="px-3 py-2">
                      {row.line_number}
                    </td>
                    <td data-label="Member" className="px-3 py-2">
                      {memberOf(row)}
                    </td>
                    <td data-label="Unit" className="px-3 py-2">
                      {unitOf(row)}
                    </td>
                    <td data-label="Date" className="px-3 py-2 whitespace-nowrap">
                      {row.values.date || '—'}
                    </td>
                    <td data-label="Times" className="px-3 py-2 whitespace-nowrap">
                      {!row.excluded &&
                      issues.some((i) => i.code === 'overlapping_entries') &&
                      TIME_FIELDS.some((f) => fields.includes(f)) ? (
                        <InlineTimes
                          // A fresh analysis with new times starts the inputs over.
                          key={`${row.values.start_time ?? ''}|${row.values.end_time ?? ''}`}
                          row={row}
                          fields={fields}
                          busy={busy}
                          onRowUpdate={onRowUpdate}
                        />
                      ) : (
                        timesOf(row)
                      )}
                    </td>
                    <td data-label="Status" className="px-3 py-2">
                      {state ?? (
                        <ul className="space-y-2">
                          {issues.map((issue, index) => {
                            const comparable =
                              issue.row_ids.length > 1 && issue.row_ids.length <= 10 && focus?.label !== issue.message;
                            return (
                              <li key={`${issue.code}-${index}`}>
                                <span className="text-red-700 dark:text-red-400">{issue.message}</span>
                                {comparable && (
                                  <>
                                    {' '}
                                    <button
                                      type="button"
                                      className="text-theme-text-secondary underline"
                                      onClick={() => {
                                        setPage(1);
                                        onFocus({ label: issue.message, rowIds: issue.row_ids });
                                      }}
                                    >
                                      Compare lines
                                    </button>
                                  </>
                                )}
                                <IssueDecisions issue={issue} rowId={row.id} {...actions} />
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      <RowState row={row} {...actions} />
                    </td>
                    <td data-label="Actions" className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="btn-icon"
                          aria-label={`Edit line ${row.line_number}`}
                          disabled={busy}
                          onClick={() => setEditingId(row.id)}
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
          columnMapping={columnMapping}
          issues={editingIssues}
          related={related}
          relatedIssues={issuesByRow}
          onClose={() => setEditingId(null)}
          onSave={(edits) => {
            void onRowUpdate(editing.id, { edits }).then((ok) => {
              if (ok) setEditingId(null);
            });
          }}
          {...actions}
        />
      )}
    </section>
  );
};

export default ReviewRows;
