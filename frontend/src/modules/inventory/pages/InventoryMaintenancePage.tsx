/**
 * InventoryMaintenancePage — Maintenance tracking for inventory items.
 * Shows items due for inspection/maintenance, maintenance history,
 * and provides a modal to log new maintenance records.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  ArrowLeft,
  Wrench,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Calendar,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type { InventoryItem, MaintenanceRecord, MaintenanceRecordCreate } from '../types';
import { getConditionColor } from '../types';
import { getErrorMessage, toAppError } from '../../../utils/errorHandling';
import { ITEM_CONDITION_OPTIONS } from '../../../constants/enums';
import { Modal } from '../../../components/Modal';
import { useTimezone } from '../../../hooks/useTimezone';
import toast from 'react-hot-toast';
import { formatDate, formatNumber } from '../../../utils/dateFormatting';
import { Breadcrumbs } from '../../../components/ux';

const MAINTENANCE_TYPES = [
  { value: 'inspection', label: 'Inspection' },
  { value: 'repair', label: 'Repair' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'calibration', label: 'Calibration' },
  { value: 'replacement', label: 'Replacement' },
  { value: 'upgrade', label: 'Upgrade' },
] as const;

const inputCls = 'form-input w-full';
const labelCls = 'form-label';
const thCls = 'px-3 py-2 text-xs font-medium text-theme-text-muted';

function daysUntilDue(nextDue?: string): number | null {
  if (!nextDue) return null;
  return Math.ceil((new Date(nextDue).getTime() - Date.now()) / 86_400_000);
}

function getDueColor(days: number | null): string {
  if (days === null) return 'text-theme-text-muted';
  if (days < 0) return 'text-red-600 dark:text-red-400 font-semibold';
  if (days <= 7) return 'text-orange-600 dark:text-orange-400 font-medium';
  if (days <= 30) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-theme-text-secondary';
}

function getDueLabel(days: number | null): string {
  if (days === null) return '--';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  return `${days}d`;
}

const INITIAL_FORM = {
  operation: 'schedule' as 'schedule' | 'repair' | 'inspection' | 'complete',
  maintenance_type: 'inspection',
  description: '',
  scheduled_date: '',
  is_completed: false,
  completed_date: '',
  passed: '' as '' | 'pass' | 'fail',
  condition_after: '',
  next_due_date: '',
  cost: '',
  vendor_name: '',
  notes: '',
};

const InventoryMaintenancePage: React.FC = () => {
  const tz = useTimezone();
  const [dueItems, setDueItems] = useState<InventoryItem[]>([]);
  const [inMaintenanceItems, setInMaintenanceItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'due' | 'history'>('due');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [history, setHistory] = useState<MaintenanceRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [modalItem, setModalItem] = useState<InventoryItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [completedItem, setCompletedItem] = useState<InventoryItem | null>(null);
  const [formData, setFormData] = useState(INITIAL_FORM);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [dueRes, maintRes] = await Promise.all([
        inventoryService.getMaintenanceDueItems(90),
        inventoryService.getItems({ status: 'in_maintenance', limit: 100 }),
      ]);
      setDueItems(dueRes);
      setInMaintenanceItems(maintRes.items);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load maintenance data'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const loadHistory = useCallback(async (item: InventoryItem) => {
    setSelectedItem(item);
    setActiveTab('history');
    setHistoryLoading(true);
    try {
      setHistory(await inventoryService.getItemMaintenanceHistory(item.id));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load maintenance history'));
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Combine due + in-maintenance items, deduplicate, sort by urgency
  const allDueItems = (() => {
    const seen = new Set(dueItems.map((i) => i.id));
    const combined = [...dueItems, ...inMaintenanceItems.filter((i) => !seen.has(i.id))];
    return combined.sort((a, b) => {
      const ad = daysUntilDue(a.next_inspection_due),
        bd = daysUntilDue(b.next_inspection_due);
      if (ad === null && bd === null) return 0;
      if (ad === null) return 1;
      if (bd === null) return -1;
      return ad - bd;
    });
  })();

  const overdueCount = allDueItems.filter((i) => (daysUntilDue(i.next_inspection_due) ?? 1) < 0).length;
  const dueWithin30 = allDueItems.filter((i) => {
    const d = daysUntilDue(i.next_inspection_due);
    return d !== null && d >= 0 && d <= 30;
  }).length;

  const openModal = useCallback((item: InventoryItem) => {
    setModalItem(item);
    setFormData({ ...INITIAL_FORM, condition_after: item.condition || '' });
  }, []);

  /**
   * "+ Add Record" on an item's inspections tab names the item it came from.
   *
   * Fetched by id rather than looked up in the lists above: this page loads
   * what is due within 90 days plus what is in maintenance, and an item whose
   * next inspection is further out — or which has none — is in neither. The
   * link would otherwise land on a generic page with nothing selected, which
   * is what it did before the path was corrected.
   *
   * The parameter is consumed on success so closing the dialog and pressing
   * Back does not reopen it; an id that resolves to nothing is a no-op, not an
   * error.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedItemId = searchParams.get('item');
  const openModalRef = useRef(openModal);
  openModalRef.current = openModal;

  useEffect(() => {
    if (!requestedItemId) return;
    let cancelled = false;
    void (async () => {
      try {
        const item = await inventoryService.getItem(requestedItemId);
        if (cancelled) return;
        openModalRef.current(item);
        setSearchParams(
          (previous) => {
            const next = new URLSearchParams(previous);
            next.delete('item');
            return next;
          },
          { replace: true }
        );
      } catch (err: unknown) {
        if (cancelled) return;
        // A 404 is the expected case and stays silent: the item may have been
        // retired between the link being rendered and followed, and a working
        // page beats an error about a record nobody holds. Anything else —
        // offline, a 403, a 500 — is an operational failure, and swallowing it
        // leaves the officer on a generic page with no form, no explanation
        // and no retry, since the parameter is unchanged and this effect will
        // not run again during the visit.
        if (toAppError(err).status !== 404) {
          toast.error(getErrorMessage(err, 'Could not open the linked item'));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestedItemId, setSearchParams]);

  const handleSave = async () => {
    if (!modalItem) return;
    if (!formData.description.trim()) {
      toast.error(formData.operation === 'complete' ? 'Performed work is required' : 'Task description is required');
      return;
    }
    if (formData.operation === 'schedule' && !formData.scheduled_date) {
      toast.error('Due date is required for scheduled work');
      return;
    }
    if (formData.operation === 'complete' && !formData.completed_date) {
      toast.error('Completion date is required');
      return;
    }
    if (formData.operation === 'complete' && (!formData.vendor_name.trim() || !formData.condition_after)) {
      toast.error('Technician/vendor and condition after work are required');
      return;
    }
    if (formData.operation === 'inspection' && !formData.passed) {
      toast.error('Select a pass/fail result');
      return;
    }
    setIsSaving(true);
    try {
      const payload: MaintenanceRecordCreate = {
        item_id: modalItem.id,
        maintenance_type:
          formData.operation === 'repair' || formData.operation === 'complete'
            ? 'repair'
            : formData.operation === 'inspection'
              ? 'inspection'
              : formData.maintenance_type,
        is_completed: formData.operation === 'inspection' || formData.operation === 'complete',
      };
      if (formData.operation === 'inspection') payload.passed = formData.passed === 'pass';
      payload.description = formData.description.trim();
      if (formData.condition_after) payload.condition_after = formData.condition_after;
      if (formData.completed_date) payload.completed_date = formData.completed_date;
      if (formData.scheduled_date) payload.scheduled_date = formData.scheduled_date;
      if (formData.next_due_date) payload.next_due_date = formData.next_due_date;
      if (formData.cost) payload.cost = Number(formData.cost);
      if (formData.vendor_name.trim()) payload.vendor_name = formData.vendor_name.trim();
      if (formData.notes.trim()) payload.notes = formData.notes.trim();
      await inventoryService.createMaintenanceRecord(payload);
      toast.success('Maintenance record saved');
      if (formData.operation === 'complete' || (formData.operation === 'inspection' && formData.passed === 'pass')) {
        setCompletedItem(modalItem);
      }
      setModalItem(null);
      void loadData();
      if (selectedItem?.id === modalItem.id) void loadHistory(modalItem);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save maintenance record'));
    } finally {
      setIsSaving(false);
    }
  };

  const returnToService = async () => {
    if (!completedItem) return;
    try {
      await inventoryService.updateItem(completedItem.id, { status: 'available' });
      toast.success(`${completedItem.name} returned to service`);
      setCompletedItem(null);
      void loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to return item to service'));
    }
  };

  const setField = <K extends keyof typeof INITIAL_FORM>(field: K, value: (typeof INITIAL_FORM)[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const tabCls = (active: boolean) =>
    `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${active ? 'border-orange-500 text-orange-600 dark:text-orange-400' : 'border-transparent text-theme-text-muted hover:text-theme-text-primary'}`;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <Breadcrumbs />

      <Link
        to="/inventory/admin"
        className="text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Admin
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="shrink-0 rounded-lg bg-orange-500/10 p-2">
            <Wrench className="h-6 w-6 text-orange-600 dark:text-orange-400" />
          </div>
          <div>
            <h1 className="text-theme-text-primary text-2xl font-bold">Maintenance &amp; Inspections</h1>
            <p className="text-theme-text-secondary mt-0.5 text-sm">
              Track due items, log records, and schedule inspections
            </p>
          </div>
        </div>
        <button
          onClick={() => void loadData()}
          className="btn-secondary btn-md flex shrink-0 items-center gap-2 self-start sm:self-auto"
          disabled={isLoading}
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card-secondary flex items-center gap-3 p-4">
          <div className="rounded-lg bg-yellow-500/10 p-2">
            <Clock className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
          </div>
          <div>
            <p className="text-theme-text-primary text-2xl font-bold">{dueWithin30}</p>
            <p className="text-theme-text-muted text-xs">Due within 30 days</p>
          </div>
        </div>
        <div className="card-secondary flex items-center gap-3 p-4">
          <div className="rounded-lg bg-red-500/10 p-2">
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <p className="text-theme-text-primary text-2xl font-bold">{overdueCount}</p>
            <p className="text-theme-text-muted text-xs">Overdue</p>
          </div>
        </div>
        <div className="card-secondary flex items-center gap-3 p-4">
          <div className="rounded-lg bg-orange-500/10 p-2">
            <Wrench className="h-5 w-5 text-orange-600 dark:text-orange-400" />
          </div>
          <div>
            <p className="text-theme-text-primary text-2xl font-bold">{inMaintenanceItems.length}</p>
            <p className="text-theme-text-muted text-xs">In Maintenance</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tab-scroll">
        <button onClick={() => setActiveTab('due')} className={tabCls(activeTab === 'due')}>
          Due Items ({allDueItems.length})
        </button>
        <button onClick={() => setActiveTab('history')} className={tabCls(activeTab === 'history')}>
          Maintenance History
          {selectedItem && <span className="text-theme-text-muted ml-1 text-xs">— {selectedItem.name}</span>}
        </button>
      </div>

      {/* Tab Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
        </div>
      ) : activeTab === 'due' ? (
        allDueItems.length === 0 ? (
          <div className="py-16 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-emerald-500" />
            <p className="text-theme-text-muted">No items due for maintenance.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* Single responsive table: a table on >=md, stacked cards below. */}
            <table className="rwd-table w-full text-sm">
              <thead>
                <tr className="border-theme-surface-border border-b text-left">
                  {[
                    'Item Name',
                    'Category',
                    'Last Inspection',
                    'Next Due',
                    'Days Until Due',
                    'Condition',
                    'Action',
                  ].map((h) => (
                    <th key={h} className={thCls}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allDueItems.map((item) => {
                  const days = daysUntilDue(item.next_inspection_due);
                  return (
                    <tr
                      key={item.id}
                      className="border-theme-surface-border hover:bg-theme-surface-hover border-b transition-colors"
                    >
                      <td data-label="Item Name" className="px-3 py-3">
                        <button
                          onClick={() => void loadHistory(item)}
                          className="text-theme-text-primary flex items-center gap-1 text-left font-medium hover:underline"
                        >
                          {item.name}
                          <ChevronRight className="text-theme-text-muted h-3 w-3" />
                        </button>
                        {item.serial_number && (
                          <span className="text-theme-text-muted block text-xs">SN: {item.serial_number}</span>
                        )}
                      </td>
                      <td data-label="Category" className="text-theme-text-secondary px-3 py-3">
                        {item.station ?? '--'}
                      </td>
                      <td data-label="Last Inspection" className="text-theme-text-secondary px-3 py-3">
                        {item.last_inspection_date ? formatDate(item.last_inspection_date, tz) : '--'}
                      </td>
                      <td data-label="Next Due" className="text-theme-text-secondary px-3 py-3">
                        {item.next_inspection_due ? formatDate(item.next_inspection_due, tz) : '--'}
                      </td>
                      <td data-label="Days Until Due" className={`px-3 py-3 ${getDueColor(days)}`}>
                        {getDueLabel(days)}
                      </td>
                      <td
                        data-label="Condition"
                        className={`px-3 py-3 capitalize ${getConditionColor(item.condition)}`}
                      >
                        {item.condition?.replace(/_/g, ' ') ?? '--'}
                      </td>
                      <td data-label="" className="px-3 py-3">
                        <button onClick={() => openModal(item)} className="btn-info btn-sm">
                          Log Maintenance
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : !selectedItem ? (
        <div className="py-16 text-center">
          <Calendar className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <p className="text-theme-text-muted">
            Select an item from the Due Items tab to view its maintenance history.
          </p>
        </div>
      ) : historyLoading ? (
        <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
        </div>
      ) : history.length === 0 ? (
        <div className="py-16 text-center">
          <Wrench className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <p className="text-theme-text-muted">No maintenance records for {selectedItem.name}.</p>
          <button onClick={() => openModal(selectedItem)} className="btn-info btn-md mt-4">
            Log First Maintenance
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-theme-text-primary text-sm font-medium">
              {selectedItem.name} — {history.length} record{history.length !== 1 ? 's' : ''}
            </h3>
            <button onClick={() => openModal(selectedItem)} className="btn-info btn-sm">
              Log Maintenance
            </button>
          </div>
          {history.map((rec) => (
            <div key={rec.id} className="card-secondary flex items-start gap-3 p-4">
              <div
                className={`mt-0.5 rounded-full p-1.5 ${
                  rec.passed === true
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : rec.passed === false
                      ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                      : 'bg-theme-surface-hover text-theme-text-muted'
                }`}
              >
                {rec.passed === true ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : rec.passed === false ? (
                  <XCircle className="h-4 w-4" />
                ) : (
                  <Wrench className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-theme-text-primary text-sm font-medium capitalize">
                    {rec.maintenance_type.replace(/_/g, ' ')}
                  </span>
                  {rec.passed === true && (
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">
                      Passed
                    </span>
                  )}
                  {rec.passed === false && (
                    <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-700 dark:text-red-400">
                      Failed
                    </span>
                  )}
                </div>
                <div className="text-theme-text-muted flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  {rec.completed_date && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDate(rec.completed_date, tz)}
                    </span>
                  )}
                  {rec.performed_by && <span>By: {rec.performed_by}</span>}
                  {rec.next_due_date && <span>Next due: {formatDate(rec.next_due_date, tz)}</span>}
                  {rec.cost != null && rec.cost > 0 && <span>${formatNumber(rec.cost)}</span>}
                  {rec.vendor_name && <span>Vendor: {rec.vendor_name}</span>}
                </div>
                {rec.description && <p className="text-theme-text-secondary mt-1 text-xs">{rec.description}</p>}
                {rec.notes && <p className="text-theme-text-muted mt-1 text-xs italic">{rec.notes}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Log Maintenance Modal */}
      <Modal
        isOpen={modalItem !== null}
        onClose={() => setModalItem(null)}
        title={`Log Maintenance — ${modalItem?.name ?? ''}`}
        size="lg"
        footer={
          <div className="flex flex-col-reverse items-stretch justify-end gap-2 sm:flex-row sm:items-center sm:gap-3">
            <button onClick={() => setModalItem(null)} className="btn-secondary btn-md">
              Cancel
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={isSaving}
              className="btn-info btn-md flex items-center justify-center gap-2"
            >
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />} Save Record
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <fieldset>
            <legend className={labelCls}>Action *</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  ['schedule', 'Schedule maintenance'],
                  ['repair', 'Open repair'],
                  ['inspection', 'Record inspection'],
                  ['complete', 'Complete work'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={formData.operation === value ? 'btn-info btn-sm' : 'btn-secondary btn-sm'}
                  onClick={() =>
                    setFormData((prev) => ({
                      ...INITIAL_FORM,
                      operation: value,
                      condition_after: prev.condition_after,
                      completed_date:
                        value === 'complete' || value === 'inspection' ? new Date().toISOString().slice(0, 10) : '',
                    }))
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          {formData.operation === 'schedule' && (
            <div>
              <label htmlFor="maintenance-due-date" className={labelCls}>
                Due Date *
              </label>
              <input
                id="maintenance-due-date"
                type="date"
                value={formData.scheduled_date}
                onChange={(e) => setField('scheduled_date', e.target.value)}
                className={inputCls}
              />
            </div>
          )}
          {formData.operation === 'schedule' && (
            <div>
              <label className={labelCls}>Maintenance Type *</label>
              <select
                value={formData.maintenance_type}
                onChange={(e) => setField('maintenance_type', e.target.value)}
                className={inputCls}
              >
                {MAINTENANCE_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className={labelCls}>
              {formData.operation === 'complete' ? 'Performed Work' : 'Task Description'} *
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setField('description', e.target.value)}
              rows={3}
              className={inputCls + ' resize-none'}
              placeholder={
                formData.operation === 'complete'
                  ? 'Describe the work performed...'
                  : 'Describe the maintenance task...'
              }
            />
          </div>

          {(formData.operation === 'complete' || formData.operation === 'inspection') && (
            <div>
              <label className={labelCls}>Completion Date *</label>
              <input
                type="date"
                value={formData.completed_date}
                onChange={(e) => setField('completed_date', e.target.value)}
                className={inputCls}
              />
            </div>
          )}
          {formData.operation === 'inspection' && (
            <fieldset>
              <legend className={labelCls}>Result *</legend>
              <div className="flex gap-4">
                {(['pass', 'fail'] as const).map((result) => (
                  <label key={result} className="text-theme-text-primary flex items-center gap-2 text-sm capitalize">
                    <input
                      type="radio"
                      name="passed"
                      checked={formData.passed === result}
                      onChange={() => setField('passed', result)}
                    />{' '}
                    {result}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {formData.operation === 'complete' && (
            <>
              <div>
                <label className={labelCls}>Technician / Vendor *</label>
                <input
                  type="text"
                  value={formData.vendor_name}
                  onChange={(e) => setField('vendor_name', e.target.value)}
                  className={inputCls}
                  placeholder="Person or service provider"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Condition After Work *</label>
                  <select
                    value={formData.condition_after}
                    onChange={(e) => setField('condition_after', e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Select condition...</option>
                    {ITEM_CONDITION_OPTIONS.map((condition) => (
                      <option key={condition.value} value={condition.value}>
                        {condition.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Cost ($)</label>
                  <input
                    type="number"
                    value={formData.cost}
                    onChange={(e) => setField('cost', e.target.value)}
                    className={inputCls}
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Next Due Date</label>
                <input
                  type="date"
                  value={formData.next_due_date}
                  onChange={(e) => setField('next_due_date', e.target.value)}
                  className={inputCls}
                />
              </div>
            </>
          )}
          <div
            className="text-theme-text-primary rounded-md border border-orange-500/30 bg-orange-500/10 p-3 text-sm"
            role="status"
          >
            {formData.operation === 'repair' || (formData.operation === 'inspection' && formData.passed === 'fail')
              ? 'This will mark the item out of service.'
              : formData.operation === 'complete' || (formData.operation === 'inspection' && formData.passed === 'pass')
                ? 'The item will remain out of service until you deliberately return it to service.'
                : 'This will schedule work without changing the item status.'}
          </div>
        </div>
      </Modal>
      <Modal
        isOpen={completedItem !== null}
        onClose={() => setCompletedItem(null)}
        title="Work completed successfully"
        footer={
          <>
            <button className="btn-secondary btn-md" onClick={() => setCompletedItem(null)}>
              Keep out of service
            </button>
            <button className="btn-success btn-md" onClick={() => void returnToService()}>
              Return to service
            </button>
          </>
        }
      >
        <p className="text-theme-text-secondary">
          {completedItem?.name} remains out of service. Confirm that it is safe and ready before making it available.
        </p>
      </Modal>
    </div>
  );
};

export default InventoryMaintenancePage;
