/**
 * Departure Clearance
 *
 * The record of a leaving member's outstanding gear: one line per assignment,
 * temporary loan or pool issuance snapshotted when the clearance opened. The
 * quartermaster resolves each line (returned, returned damaged, written off or
 * waived) and then completes the clearance — or closes it incomplete when
 * leadership decides the remainder will not come back.
 *
 * Resolving a line as returned performs the underlying return on the server
 * (unassign, check-in or pool return), so this screen never calls those
 * endpoints itself.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, ClipboardCheck, Loader2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { inventoryService } from '../../../services/api';
import { Modal } from '../../../components/Modal';
import { Breadcrumbs } from '../../../components/ux';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useTimezone } from '../../../hooks/useTimezone';
import { RETURN_CONDITION_OPTIONS } from '../../../constants/enums';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCurrency, formatDate, formatDateTime } from '../../../utils/dateFormatting';
import {
  CLEARANCE_DISPOSITIONS,
  CLEARANCE_DISPOSITION_LABELS,
  CLEARANCE_SOURCE_LABELS,
  CLEARANCE_STATUS_LABELS,
  type ClearanceLineItem,
  type ClearanceResolveDisposition,
  type DepartureClearance,
} from '../types/clearance';

const DISPOSITION_HINTS: Record<ClearanceResolveDisposition, string> = {
  returned: 'Handed back in usable condition. The return is recorded on the item.',
  returned_damaged: 'Handed back damaged. The return is recorded with the damage.',
  written_off: 'Lost or not coming back. Stays on the record as written off.',
  waived: 'The department does not require it back.',
};

const isReturn = (disposition: ClearanceResolveDisposition) =>
  disposition === 'returned' || disposition === 'returned_damaged';

const DISPOSITION_BADGE: Record<ClearanceLineItem['disposition'], string> = {
  pending: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-white',
  returned: 'bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-white',
  returned_damaged: 'bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-white',
  written_off: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-white',
  waived: 'bg-slate-100 text-slate-900 dark:bg-slate-700 dark:text-white',
};

interface ResolveDialogProps {
  line: ClearanceLineItem | null;
  submitting: boolean;
  onClose: () => void;
  onResolve: (
    line: ClearanceLineItem,
    disposition: ClearanceResolveDisposition,
    condition: string,
    notes: string
  ) => void;
}

const ResolveDialog: React.FC<ResolveDialogProps> = ({ line, submitting, onClose, onResolve }) => {
  const [disposition, setDisposition] = useState<ClearanceResolveDisposition>('returned');
  const [condition, setCondition] = useState('good');
  const [notes, setNotes] = useState('');

  // Fresh on every line, so a note typed for one item is never filed against the next.
  useEffect(() => {
    setDisposition('returned');
    setCondition('good');
    setNotes('');
  }, [line?.id]);

  useEffect(() => {
    if (disposition === 'returned_damaged') setCondition('damaged');
    else if (disposition === 'returned') setCondition('good');
  }, [disposition]);

  if (!line) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Resolve ${line.item_name}`}
      size="sm"
      onSubmit={(event) => {
        event.preventDefault();
        onResolve(line, disposition, condition, notes);
      }}
      footer={
        <>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting && <Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-hidden="true" />}
            Resolve
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <fieldset className="space-y-2">
        <legend className="text-theme-text-primary mb-2 text-sm font-medium">What happened to it?</legend>
        {CLEARANCE_DISPOSITIONS.map((value) => (
          <label key={value} className="border-theme-surface-border flex cursor-pointer gap-2 rounded-md border p-3">
            <input
              type="radio"
              name="clearance-disposition"
              checked={disposition === value}
              onChange={() => setDisposition(value)}
              aria-labelledby={`disposition-${value}-label`}
              aria-describedby={`disposition-${value}-hint`}
            />
            <span>
              <span id={`disposition-${value}-label`} className="text-theme-text-primary block text-sm font-medium">
                {CLEARANCE_DISPOSITION_LABELS[value]}
              </span>
              <span id={`disposition-${value}-hint`} className="text-theme-text-muted block text-xs">
                {DISPOSITION_HINTS[value]}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {isReturn(disposition) && (
        <label className="form-label mt-3 block">
          Condition
          <select
            className="form-input mt-1 block w-full"
            value={condition}
            onChange={(event) => setCondition(event.target.value)}
          >
            {RETURN_CONDITION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="form-label mt-3 block">
        Notes
        <textarea
          className="form-input mt-1 block w-full"
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
    </Modal>
  );
};

const DepartureClearancePage: React.FC = () => {
  const { clearanceId = '' } = useParams<{ clearanceId: string }>();
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const [clearance, setClearance] = useState<DepartureClearance | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<ClearanceLineItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [closeNotes, setCloseNotes] = useState('');

  const load = useCallback(async () => {
    if (!clearanceId) return;
    setLoading(true);
    setLoadError(null);
    try {
      setClearance(await inventoryService.getDepartureClearance(clearanceId));
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Could not load this clearance.'));
    } finally {
      setLoading(false);
    }
  }, [clearanceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleResolve = async (
    line: ClearanceLineItem,
    disposition: ClearanceResolveDisposition,
    condition: string,
    notes: string
  ) => {
    setSubmitting(true);
    try {
      await inventoryService.resolveClearanceItem(clearanceId, line.id, {
        disposition,
        return_condition: isReturn(disposition) ? condition : undefined,
        resolution_notes: notes.trim() || undefined,
      });
      toast.success(`${line.item_name}: ${CLEARANCE_DISPOSITION_LABELS[disposition].toLowerCase()}`);
      setResolving(null);
      // The totals and status move with each line, so re-read the record.
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not resolve this item.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = async () => {
    if (!clearance) return;
    const outstanding = clearance.items_outstanding;
    const confirmed = await confirm(
      outstanding > 0
        ? {
            title: 'Close clearance incomplete?',
            message: `${outstanding} item${outstanding === 1 ? '' : 's'} (${formatCurrency(
              clearance.value_outstanding
            )}) will stay unresolved on this record, and the clearance closes as Closed incomplete. Nothing more can be resolved on it afterwards.`,
            confirmLabel: 'Close incomplete',
            cancelLabel: 'Keep it open',
            variant: 'warning',
          }
        : {
            title: 'Complete clearance?',
            message: 'Every item is resolved. Completing closes the clearance; nothing more can be resolved on it.',
            confirmLabel: 'Complete clearance',
            cancelLabel: 'Keep it open',
            variant: 'info',
          }
    );
    if (!confirmed) return;
    setSubmitting(true);
    try {
      await inventoryService.completeClearance(clearanceId, {
        force_close: outstanding > 0,
        notes: closeNotes.trim() || undefined,
      });
      toast.success(outstanding > 0 ? 'Clearance closed incomplete' : 'Clearance completed');
      setCloseNotes('');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not close this clearance.'));
    } finally {
      setSubmitting(false);
    }
  };

  const closed = clearance?.status === 'completed' || clearance?.status === 'closed_incomplete';

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl py-6 sm:py-8">
        <Breadcrumbs />
        <Link
          to="/inventory/admin"
          className="text-theme-text-muted hover:text-theme-text-secondary touch:min-h-11 mb-6 flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Admin
        </Link>

        <div className="page-header mb-6 gap-3 sm:items-center">
          <div className="page-header-title flex items-center gap-3">
            <div className="shrink-0 rounded-lg bg-blue-800 p-2">
              <ClipboardCheck className="h-5 w-5 text-white" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-xl font-bold">
                Departure clearance{clearance?.member_name ? ` — ${clearance.member_name}` : ''}
              </h1>
              {clearance && (
                <p className="text-theme-text-muted text-sm">
                  {CLEARANCE_STATUS_LABELS[clearance.status]} · opened {formatDate(clearance.initiated_at, tz)}
                  {clearance.return_deadline ? ` · gear due ${formatDate(clearance.return_deadline, tz)}` : ''}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="btn-secondary btn-md shrink-0 self-start sm:self-auto"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>

        {loadError && (
          <div className="alert-danger mb-4" role="alert">
            {loadError}
          </div>
        )}

        {loading && !clearance && (
          <div className="flex justify-center py-12">
            <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-label="Loading" />
          </div>
        )}

        {clearance && (
          <>
            <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ['Items', String(clearance.total_items)],
                  ['Resolved', String(clearance.items_cleared)],
                  ['Outstanding', String(clearance.items_outstanding)],
                  ['Value outstanding', formatCurrency(clearance.value_outstanding)],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="card-secondary p-3">
                  <dt className="text-theme-text-muted text-xs">{label}</dt>
                  <dd className="text-theme-text-primary text-lg font-semibold">{value}</dd>
                </div>
              ))}
            </dl>

            {clearance.notes && <p className="text-theme-text-secondary mb-4 text-sm">{clearance.notes}</p>}

            <div className="card-secondary mb-6 overflow-x-auto">
              <table className="rwd-table w-full text-sm">
                <thead>
                  <tr className="text-theme-text-muted text-left">
                    <th className="p-3">Item</th>
                    <th className="p-3">Held as</th>
                    <th className="p-3">Qty</th>
                    <th className="p-3">Value</th>
                    <th className="p-3">Disposition</th>
                    <th className="p-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {clearance.line_items.map((line) => (
                    <tr key={line.id} className="border-theme-surface-border border-t">
                      <td className="rwd-table-lead p-3" data-label="Item">
                        <span className="text-theme-text-primary font-medium">{line.item_name}</span>
                        {(line.item_serial_number || line.item_asset_tag) && (
                          <span className="text-theme-text-muted block text-xs">
                            {[line.item_serial_number, line.item_asset_tag].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </td>
                      <td className="p-3" data-label="Held as">
                        {CLEARANCE_SOURCE_LABELS[line.source_type]}
                      </td>
                      <td className="p-3" data-label="Qty">
                        {line.quantity}
                      </td>
                      <td className="p-3" data-label="Value">
                        {line.item_value != null ? formatCurrency(line.item_value) : '—'}
                      </td>
                      <td className="p-3" data-label="Disposition">
                        <span className={`badge ${DISPOSITION_BADGE[line.disposition]}`}>
                          {CLEARANCE_DISPOSITION_LABELS[line.disposition]}
                        </span>
                        {line.resolved_at && (
                          <span className="text-theme-text-muted block text-xs">
                            {formatDateTime(line.resolved_at, tz)}
                            {line.return_condition ? ` · ${line.return_condition}` : ''}
                          </span>
                        )}
                        {line.resolution_notes && (
                          <span className="text-theme-text-secondary block text-xs">{line.resolution_notes}</span>
                        )}
                      </td>
                      <td className="p-3 text-right" data-label="Action">
                        {line.disposition === 'pending' && !closed && (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => setResolving(line)}
                            aria-label={`Resolve ${line.item_name}`}
                          >
                            Resolve
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {clearance.line_items.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-theme-text-muted p-6 text-center" data-label="">
                        The member held no gear when this clearance opened.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {closed ? (
              <p className="text-theme-text-secondary text-sm" role="status">
                {CLEARANCE_STATUS_LABELS[clearance.status]}
                {clearance.completed_at ? ` on ${formatDate(clearance.completed_at, tz)}` : ''}. This record is closed.
              </p>
            ) : (
              <div className="card-secondary space-y-3 p-4">
                <h2 className="text-theme-text-primary font-medium">
                  {clearance.items_outstanding > 0 ? 'Close this clearance' : 'Complete this clearance'}
                </h2>
                <p className="text-theme-text-secondary text-sm">
                  {clearance.items_outstanding > 0
                    ? `${clearance.items_outstanding} item${clearance.items_outstanding === 1 ? ' is' : 's are'} still outstanding. Resolve them above, or close the clearance incomplete if leadership has decided they will not come back.`
                    : 'Every item is resolved.'}
                </p>
                <label className="form-label block">
                  Closing notes
                  <textarea
                    className="form-input mt-1 block w-full"
                    rows={2}
                    value={closeNotes}
                    onChange={(event) => setCloseNotes(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className={clearance.items_outstanding > 0 ? 'btn-warning' : 'btn-primary'}
                  disabled={submitting}
                  onClick={() => void handleClose()}
                >
                  {clearance.items_outstanding > 0 ? 'Close incomplete' : 'Complete clearance'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <ResolveDialog
        line={resolving}
        submitting={submitting}
        onClose={() => setResolving(null)}
        onResolve={(line, disposition, condition, notes) => void handleResolve(line, disposition, condition, notes)}
      />
    </div>
  );
};

export default DepartureClearancePage;
