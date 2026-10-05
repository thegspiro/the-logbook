/**
 * NFPA Compliance Tab
 *
 * Shown when the department tracks NFPA apparatus compliance and the
 * apparatus has tracking on. Two lists, both graded by the server
 * (`GET /apparatus/{id}/nfpa-summary`) so this screen and any report agree
 * (CLAUDE.md pitfall 29):
 *
 * - Required tests: the maintenance types marked NFPA-required that apply to
 *   this apparatus, with the last test and the next due date taken from its
 *   maintenance records. Tests are recorded on the Maintenance tab.
 * - Compliance items: the standard-by-standard list a department keeps by
 *   hand, editable here.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, Pencil, Plus, Shield, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { ConfirmDialog } from '../../../components/ux/ConfirmDialog';
import { useAuthStore } from '../../../stores/authStore';
import { formatDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { apparatusNfpaService } from '../services/api';
import type { ApparatusNfpaCompliance, ApparatusNfpaSummary, NfpaStanding } from '../types';
import { NfpaItemModal } from './NfpaItemModal';

interface NfpaComplianceTabProps {
  apparatusId: string;
  timezone: string;
  onOpenMaintenance: () => void;
}

const STANDING: Record<NfpaStanding, { label: string; className: string }> = {
  current: { label: 'Current', className: 'bg-green-500/10 text-green-800 dark:text-green-300' },
  compliant: { label: 'Compliant', className: 'bg-green-500/10 text-green-800 dark:text-green-300' },
  due_soon: { label: 'Due soon', className: 'bg-amber-500/10 text-amber-800 dark:text-amber-300' },
  scheduled: { label: 'Scheduled', className: 'bg-blue-500/10 text-blue-800 dark:text-blue-300' },
  pending: { label: 'Pending', className: 'bg-blue-500/10 text-blue-800 dark:text-blue-300' },
  overdue: { label: 'Overdue', className: 'bg-red-500/10 text-red-800 dark:text-red-300' },
  non_compliant: { label: 'Not compliant', className: 'bg-red-500/10 text-red-800 dark:text-red-300' },
  never_performed: { label: 'No record yet', className: 'bg-theme-surface-secondary text-theme-text-secondary' },
  exempt: { label: 'Exempt', className: 'bg-theme-surface-secondary text-theme-text-secondary' },
};

const StandingBadge: React.FC<{ status: NfpaStanding }> = ({ status }) => {
  const standing = STANDING[status] ?? STANDING.pending;
  return (
    <span className={`badge rounded px-2 py-0.5 text-xs font-medium ${standing.className}`}>{standing.label}</span>
  );
};

export const NfpaComplianceTab: React.FC<NfpaComplianceTabProps> = ({ apparatusId, timezone, onOpenMaintenance }) => {
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const canEdit = checkPermission('apparatus.manage') || checkPermission('apparatus.edit');

  const [summary, setSummary] = useState<ApparatusNfpaSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<ApparatusNfpaCompliance | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApparatusNfpaCompliance | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await apparatusNfpaService.getSummary(apparatusId));
      setLoadError(null);
    } catch (err) {
      setLoadError(getErrorMessage(err, 'Could not load NFPA compliance'));
    } finally {
      setLoading(false);
    }
  }, [apparatusId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apparatusNfpaService.deleteItem(deleteTarget.id);
      toast.success('Compliance item removed');
      setDeleteTarget(null);
      void load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to remove the compliance item'));
    }
  };

  if (loading && !summary) {
    return (
      <div className="card py-8 text-center" role="status" aria-live="polite">
        <div className="border-theme-text-primary mx-auto h-8 w-8 animate-spin rounded-full border-b-2"></div>
        <span className="sr-only">Loading NFPA compliance</span>
      </div>
    );
  }

  if (loadError || !summary) {
    return (
      <div className="card p-6">
        <p className="text-theme-text-secondary">{loadError ?? 'Could not load NFPA compliance'}</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <div className="card p-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-theme-text-primary flex items-center gap-2 font-bold">
              <Shield className="h-5 w-5" />
              Required NFPA Tests
            </h2>
            <p className="text-theme-text-secondary text-sm">
              {summary.overdueCount > 0 && (
                <span className="font-semibold text-red-700 dark:text-red-400">{summary.overdueCount} overdue · </span>
              )}
              {summary.dueSoonCount > 0 && <span>{summary.dueSoonCount} due within 30 days · </span>}
              as of {formatDate(summary.asOf, timezone)}
            </p>
          </div>
          <p className="text-theme-text-muted mb-4 text-sm">
            Maintenance types marked NFPA-required. Record a test on the{' '}
            <button type="button" onClick={onOpenMaintenance} className="text-theme-accent-blue underline">
              Maintenance tab
            </button>
            ; a test that does not apply to this vehicle simply stays at &ldquo;No record yet&rdquo;.
          </p>
          {summary.requiredMaintenance.length === 0 ? (
            <p className="text-theme-text-muted py-4 text-center">
              No maintenance types are marked NFPA-required for this apparatus type.
            </p>
          ) : (
            <table className="rwd-table w-full text-sm">
              <thead>
                <tr className="text-theme-text-muted text-left text-xs uppercase">
                  <th className="py-2 pr-4">Test</th>
                  <th className="py-2 pr-4">Standard</th>
                  <th className="py-2 pr-4">Last test</th>
                  <th className="py-2 pr-4">Next due</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {summary.requiredMaintenance.map((test) => (
                  <tr key={test.maintenanceTypeId} className="border-theme-surface-border border-t">
                    <td data-label="Test" className="text-theme-text-primary py-2 pr-4 font-medium">
                      {test.name}
                    </td>
                    <td data-label="Standard" className="text-theme-text-secondary py-2 pr-4">
                      {test.nfpaReference ?? '—'}
                    </td>
                    <td data-label="Last test" className="text-theme-text-secondary py-2 pr-4">
                      {test.lastCompletedDate ? formatDate(test.lastCompletedDate, timezone) : '—'}
                    </td>
                    <td data-label="Next due" className="text-theme-text-secondary py-2 pr-4">
                      {test.nextDueDate ? formatDate(test.nextDueDate, timezone) : '—'}
                    </td>
                    <td data-label="Status" className="py-2">
                      <StandingBadge status={test.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-theme-text-primary flex items-center gap-2 font-bold">
              <ClipboardCheck className="h-5 w-5" />
              Compliance Items
            </h2>
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setEditItem(null);
                  setShowModal(true);
                }}
                className="btn-primary inline-flex items-center gap-1 text-sm"
              >
                <Plus className="h-4 w-4" /> Add Item
              </button>
            )}
          </div>
          {summary.complianceItems.length === 0 ? (
            <p className="text-theme-text-muted py-4 text-center">
              No compliance items yet.
              {canEdit && ' Add one for each standard or section this apparatus is checked against.'}
            </p>
          ) : (
            <div className="space-y-3">
              {summary.complianceItems.map(({ record, status }) => (
                <div key={record.id} className="card-secondary flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-theme-text-primary font-medium">
                      {record.standardCode} · {record.sectionReference}
                    </p>
                    <p className="text-theme-text-secondary mt-0.5 text-sm">{record.requirementDescription}</p>
                    <p className="text-theme-text-muted mt-1 text-xs">
                      {record.lastCheckedDate
                        ? `Last checked ${formatDate(record.lastCheckedDate, timezone)}`
                        : 'Not checked yet'}
                      {record.nextDueDate && ` · Next due ${formatDate(record.nextDueDate, timezone)}`}
                    </p>
                    {record.exemptionReason && (
                      <p className="text-theme-text-muted mt-1 text-xs">Exempt: {record.exemptionReason}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StandingBadge status={status} />
                    {canEdit && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditItem(record);
                            setShowModal(true);
                          }}
                          className="btn-icon text-theme-text-muted hover:text-theme-text-primary"
                          aria-label={`Edit ${record.standardCode} ${record.sectionReference}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(record)}
                          className="btn-icon text-theme-text-muted hover:text-red-600"
                          aria-label={`Remove ${record.standardCode} ${record.sectionReference}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <NfpaItemModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSaved={() => void load()}
        apparatusId={apparatusId}
        editItem={editItem}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
        title="Remove Compliance Item"
        message={`Remove ${deleteTarget?.standardCode ?? ''} ${deleteTarget?.sectionReference ?? ''} from this apparatus? You can't undo this.`}
        confirmLabel="Remove item"
        variant="danger"
      />
    </>
  );
};

export default NfpaComplianceTab;
