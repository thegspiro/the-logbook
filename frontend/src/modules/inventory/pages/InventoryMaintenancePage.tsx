/**
 * InventoryMaintenancePage — Maintenance tracking for inventory items.
 * Shows items due for inspection/maintenance, maintenance history,
 * and provides a modal to log new maintenance records.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Wrench, RefreshCw, AlertTriangle, CheckCircle2, XCircle,
  Clock, Calendar, Loader2, ChevronRight,
} from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type { InventoryItem, MaintenanceRecord, MaintenanceRecordCreate } from '../types';
import { getConditionColor } from '../types';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { ITEM_CONDITION_OPTIONS } from '../../../constants/enums';
import { Modal } from '../../../components/Modal';
import { useTimezone } from '../../../hooks/useTimezone';
import toast from 'react-hot-toast';
import { formatDate, getTodayLocalDate } from '../../../utils/dateFormatting';

const MAINTENANCE_TYPES = [
  { value: 'inspection', label: 'Inspection' }, { value: 'repair', label: 'Repair' },
  { value: 'cleaning', label: 'Cleaning' }, { value: 'calibration', label: 'Calibration' },
  { value: 'replacement', label: 'Replacement' }, { value: 'upgrade', label: 'Upgrade' },
] as const;

const inputCls = 'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring';
const labelCls = 'block text-xs font-medium text-theme-text-muted mb-1';
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
  maintenance_type: 'inspection', description: '', is_completed: true,
  completed_date: '', passed: true, condition_after: '',
  next_due_date: '', cost: '', vendor_name: '', notes: '',
};

const InventoryMaintenancePage: React.FC = () => {
  const tz = useTimezone();
  const user = useAuthStore((s) => s.user);
  const [dueItems, setDueItems] = useState<InventoryItem[]>([]);
  const [inMaintenanceItems, setInMaintenanceItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'due' | 'history'>('due');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [history, setHistory] = useState<MaintenanceRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [modalItem, setModalItem] = useState<InventoryItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
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
    } finally { setIsLoading(false); }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const loadHistory = useCallback(async (item: InventoryItem) => {
    setSelectedItem(item);
    setActiveTab('history');
    setHistoryLoading(true);
    try {
      setHistory(await inventoryService.getItemMaintenanceHistory(item.id));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load maintenance history'));
      setHistory([]);
    } finally { setHistoryLoading(false); }
  }, []);

  // Combine due + in-maintenance items, deduplicate, sort by urgency
  const allDueItems = (() => {
    const seen = new Set(dueItems.map((i) => i.id));
    const combined = [...dueItems, ...inMaintenanceItems.filter((i) => !seen.has(i.id))];
    return combined.sort((a, b) => {
      const ad = daysUntilDue(a.next_inspection_due), bd = daysUntilDue(b.next_inspection_due);
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

  const openModal = (item: InventoryItem) => {
    setModalItem(item);
    setFormData({ ...INITIAL_FORM, completed_date: getTodayLocalDate(tz), condition_after: item.condition || '' });
  };

  const handleSave = async () => {
    if (!modalItem) return;
    if (!formData.description.trim()) { toast.error('Description is required'); return; }
    setIsSaving(true);
    try {
      const payload: MaintenanceRecordCreate = {
        item_id: modalItem.id, maintenance_type: formData.maintenance_type,
        is_completed: formData.is_completed, passed: formData.passed,
      };
      payload.description = formData.description.trim();
      if (formData.condition_after) payload.condition_after = formData.condition_after;
      if (formData.completed_date) payload.completed_date = formData.completed_date;
      if (formData.next_due_date) payload.next_due_date = formData.next_due_date;
      const performedBy = user?.full_name || user?.email;
      if (performedBy) payload.performed_by = performedBy;
      if (formData.cost) payload.cost = Number(formData.cost);
      if (formData.vendor_name.trim()) payload.vendor_name = formData.vendor_name.trim();
      if (formData.notes.trim()) payload.notes = formData.notes.trim();
      await inventoryService.createMaintenanceRecord(payload);
      toast.success('Maintenance record logged');
      setModalItem(null);
      void loadData();
      if (selectedItem?.id === modalItem.id) void loadHistory(modalItem);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save maintenance record'));
    } finally { setIsSaving(false); }
  };

  const setField = <K extends keyof typeof INITIAL_FORM>(field: K, value: (typeof INITIAL_FORM)[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const tabCls = (active: boolean) =>
    `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${active ? 'border-orange-500 text-orange-600 dark:text-orange-400' : 'border-transparent text-theme-text-muted hover:text-theme-text-primary'}`;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-500/10 rounded-lg">
            <Wrench className="w-6 h-6 text-orange-600 dark:text-orange-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-theme-text-primary">Maintenance &amp; Inspections</h1>
            <p className="text-theme-text-secondary text-sm mt-0.5">Track due items, log records, and schedule inspections</p>
          </div>
        </div>
        <button onClick={() => void loadData()} className="btn-info flex items-center gap-2 text-sm" disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card-secondary p-4 flex items-center gap-3">
          <div className="p-2 bg-yellow-500/10 rounded-lg"><Clock className="w-5 h-5 text-yellow-600 dark:text-yellow-400" /></div>
          <div>
            <p className="text-2xl font-bold text-theme-text-primary">{dueWithin30}</p>
            <p className="text-xs text-theme-text-muted">Due within 30 days</p>
          </div>
        </div>
        <div className="card-secondary p-4 flex items-center gap-3">
          <div className="p-2 bg-red-500/10 rounded-lg"><AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" /></div>
          <div>
            <p className="text-2xl font-bold text-theme-text-primary">{overdueCount}</p>
            <p className="text-xs text-theme-text-muted">Overdue</p>
          </div>
        </div>
        <div className="card-secondary p-4 flex items-center gap-3">
          <div className="p-2 bg-orange-500/10 rounded-lg"><Wrench className="w-5 h-5 text-orange-600 dark:text-orange-400" /></div>
          <div>
            <p className="text-2xl font-bold text-theme-text-primary">{inMaintenanceItems.length}</p>
            <p className="text-xs text-theme-text-muted">In Maintenance</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-theme-surface-border">
        <button onClick={() => setActiveTab('due')} className={tabCls(activeTab === 'due')}>
          Due Items ({allDueItems.length})
        </button>
        <button onClick={() => setActiveTab('history')} className={tabCls(activeTab === 'history')}>
          Maintenance History
          {selectedItem && <span className="ml-1 text-xs text-theme-text-muted">— {selectedItem.name}</span>}
        </button>
      </div>

      {/* Tab Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" /></div>
      ) : activeTab === 'due' ? (
        allDueItems.length === 0 ? (
          <div className="text-center py-16">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <p className="text-theme-text-muted">No items due for maintenance.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-theme-surface-border text-left">
                  {['Item Name', 'Category', 'Last Inspection', 'Next Due', 'Days Until Due', 'Condition', 'Action'].map((h) => (
                    <th key={h} className={thCls}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allDueItems.map((item) => {
                  const days = daysUntilDue(item.next_inspection_due);
                  return (
                    <tr key={item.id} className="border-b border-theme-surface-border hover:bg-theme-surface-hover transition-colors">
                      <td className="px-3 py-3">
                        <button onClick={() => void loadHistory(item)} className="text-theme-text-primary font-medium hover:underline text-left flex items-center gap-1">
                          {item.name}<ChevronRight className="w-3 h-3 text-theme-text-muted" />
                        </button>
                        {item.serial_number && <span className="text-xs text-theme-text-muted block">SN: {item.serial_number}</span>}
                      </td>
                      <td className="px-3 py-3 text-theme-text-secondary">{item.station ?? '--'}</td>
                      <td className="px-3 py-3 text-theme-text-secondary">{item.last_inspection_date ? formatDate(item.last_inspection_date, tz) : '--'}</td>
                      <td className="px-3 py-3 text-theme-text-secondary">{item.next_inspection_due ? formatDate(item.next_inspection_due, tz) : '--'}</td>
                      <td className={`px-3 py-3 ${getDueColor(days)}`}>{getDueLabel(days)}</td>
                      <td className={`px-3 py-3 capitalize ${getConditionColor(item.condition)}`}>{item.condition?.replace(/_/g, ' ') ?? '--'}</td>
                      <td className="px-3 py-3">
                        <button onClick={() => openModal(item)} className="btn-primary text-xs px-3 py-1.5">Log Maintenance</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : !selectedItem ? (
        <div className="text-center py-16">
          <Calendar className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <p className="text-theme-text-muted">Select an item from the Due Items tab to view its maintenance history.</p>
        </div>
      ) : historyLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" /></div>
      ) : history.length === 0 ? (
        <div className="text-center py-16">
          <Wrench className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <p className="text-theme-text-muted">No maintenance records for {selectedItem.name}.</p>
          <button onClick={() => openModal(selectedItem)} className="btn-primary text-sm mt-4">Log First Maintenance</button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-theme-text-primary">
              {selectedItem.name} — {history.length} record{history.length !== 1 ? 's' : ''}
            </h3>
            <button onClick={() => openModal(selectedItem)} className="btn-primary text-xs px-3 py-1.5">Log Maintenance</button>
          </div>
          {history.map((rec) => (
            <div key={rec.id} className="card-secondary p-4 flex items-start gap-3">
              <div className={`mt-0.5 p-1.5 rounded-full ${
                rec.passed === true ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : rec.passed === false ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                  : 'bg-theme-surface-hover text-theme-text-muted'
              }`}>
                {rec.passed === true ? <CheckCircle2 className="w-4 h-4" />
                  : rec.passed === false ? <XCircle className="w-4 h-4" />
                  : <Wrench className="w-4 h-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-theme-text-primary capitalize">{rec.maintenance_type.replace(/_/g, ' ')}</span>
                  {rec.passed === true && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">Passed</span>}
                  {rec.passed === false && <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-700 dark:text-red-400">Failed</span>}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-theme-text-muted">
                  {rec.completed_date && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDate(rec.completed_date, tz)}</span>}
                  {rec.performed_by && <span>By: {rec.performed_by}</span>}
                  {rec.next_due_date && <span>Next due: {formatDate(rec.next_due_date, tz)}</span>}
                  {rec.cost != null && rec.cost > 0 && <span>${rec.cost.toLocaleString()}</span>}
                  {rec.vendor_name && <span>Vendor: {rec.vendor_name}</span>}
                </div>
                {rec.description && <p className="text-xs text-theme-text-secondary mt-1">{rec.description}</p>}
                {rec.notes && <p className="text-xs text-theme-text-muted mt-1 italic">{rec.notes}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Log Maintenance Modal */}
      <Modal isOpen={modalItem !== null} onClose={() => setModalItem(null)}
        title={`Log Maintenance — ${modalItem?.name ?? ''}`} size="lg"
        footer={
          <div className="flex items-center justify-end gap-3">
            <button onClick={() => setModalItem(null)} className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary transition-colors text-sm">Cancel</button>
            <button onClick={() => void handleSave()} disabled={isSaving} className="btn-primary flex gap-2 items-center px-5 text-sm">
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />} Save Record
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Maintenance Type *</label>
            <select value={formData.maintenance_type} onChange={(e) => setField('maintenance_type', e.target.value)} className={inputCls}>
              {MAINTENANCE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Description *</label>
            <textarea value={formData.description} onChange={(e) => setField('description', e.target.value)}
              rows={3} className={inputCls + ' resize-none'} placeholder="Describe the maintenance performed..." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="maint-completed" checked={formData.is_completed}
                onChange={(e) => setField('is_completed', e.target.checked)} className="rounded border-theme-input-border" />
              <label htmlFor="maint-completed" className="text-sm text-theme-text-primary">Completed</label>
            </div>
            <div>
              <label className={labelCls}>Completed Date</label>
              <input type="date" value={formData.completed_date} onChange={(e) => setField('completed_date', e.target.value)} className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Result (for inspections)</label>
              <div className="flex items-center gap-4 mt-1">
                <label className="flex items-center gap-1.5 text-sm text-theme-text-primary cursor-pointer">
                  <input type="radio" name="passed" checked={formData.passed} onChange={() => setField('passed', true)} />
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Passed
                </label>
                <label className="flex items-center gap-1.5 text-sm text-theme-text-primary cursor-pointer">
                  <input type="radio" name="passed" checked={!formData.passed} onChange={() => setField('passed', false)} />
                  <XCircle className="w-4 h-4 text-red-500" /> Failed
                </label>
              </div>
            </div>
            <div>
              <label className={labelCls}>Condition After</label>
              <select value={formData.condition_after} onChange={(e) => setField('condition_after', e.target.value)} className={inputCls}>
                <option value="">Select condition...</option>
                {ITEM_CONDITION_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Next Due Date</label>
            <input type="date" value={formData.next_due_date} onChange={(e) => setField('next_due_date', e.target.value)} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Cost ($)</label>
              <input type="number" value={formData.cost} onChange={(e) => setField('cost', e.target.value)}
                className={inputCls} placeholder="0.00" min="0" step="0.01" />
            </div>
            <div>
              <label className={labelCls}>Vendor Name</label>
              <input type="text" value={formData.vendor_name} onChange={(e) => setField('vendor_name', e.target.value)}
                className={inputCls} placeholder="External service provider" />
            </div>
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <textarea value={formData.notes} onChange={(e) => setField('notes', e.target.value)}
              rows={2} className={inputCls + ' resize-none'} placeholder="Additional notes..." />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default InventoryMaintenancePage;
