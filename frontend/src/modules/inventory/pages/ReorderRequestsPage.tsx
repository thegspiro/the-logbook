/**
 * ReorderRequestsPage — Manage supply reorder requests with status workflow,
 * vendor tracking, and cost management.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import {
  RefreshCw,
  Search,
  Plus,
  Package,
  Truck,
  CheckCircle,
  Clock,
  XCircle,
  AlertTriangle,
  DollarSign,
} from 'lucide-react';
import { inventoryService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useTimezone } from '../../../hooks/useTimezone';
import { useDeepLinkedRecord } from '../../../hooks/useDeepLinkedRecord';
import { formatDate as formatDateUtil } from '../../../utils/dateFormatting';
import { formatCurrency } from '@/utils/currencyFormatting';
import { Modal } from '../../../components/Modal';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { useFieldErrors, type FieldErrors, type FieldSpecs } from '../../../hooks/useFieldErrors';
import { blankToNull, numberOrNull } from '../../../utils/formValues';
import { firstRefused, saveExceptRefused } from '../../../utils/saveExceptRefused';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { placeApiError } from '../../../hooks/useFieldErrors';
import { VendorName } from '../components/VendorName';
import InventoryItemPicker from '../components/InventoryItemPicker';
import type {
  ReorderRequest,
  ReorderRequestCreate,
  ReorderRequestUpdate,
  InventoryCategory,
  InventoryVendor,
  LowStockAlert,
} from '../../../services/eventServices';

const STATUS_OPTIONS = ['pending', 'approved', 'ordered', 'partially_received', 'received', 'cancelled'] as const;
const URGENCY_OPTIONS = ['low', 'normal', 'high', 'critical'] as const;

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  ordered: 'Ordered',
  partially_received: 'Partially received',
  received: 'Received',
  cancelled: 'Cancelled',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-800 dark:text-yellow-400',
  approved: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  ordered: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
  partially_received: 'bg-cyan-500/10 text-cyan-800 dark:text-cyan-400',
  received: 'bg-green-500/10 text-green-800 dark:text-green-400',
  cancelled: 'bg-theme-surface-secondary text-theme-text-muted',
};

const URGENCY_COLORS: Record<string, string> = {
  low: 'bg-theme-surface-secondary text-theme-text-muted',
  normal: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  high: 'bg-orange-500/10 text-orange-800 dark:text-orange-400',
  critical: 'bg-red-500/10 text-red-700 dark:text-red-400',
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <Clock className="h-3.5 w-3.5" />,
  approved: <CheckCircle className="h-3.5 w-3.5" />,
  ordered: <Truck className="h-3.5 w-3.5" />,
  partially_received: <Package className="h-3.5 w-3.5" />,
  received: <Package className="h-3.5 w-3.5" />,
  cancelled: <XCircle className="h-3.5 w-3.5" />,
};

const lbl = 'form-label';
const inp = 'form-input';

interface CreateFD {
  item_name: string;
  item_id: string;
  category_id: string;
  quantity_requested: string;
  vendor: string;
  vendor_id: string;
  vendor_contact: string;
  estimated_unit_cost: string;
  expected_delivery_date: string;
  urgency: string;
  notes: string;
}

type ReorderField =
  | 'item_name'
  | 'category_id'
  | 'quantity_requested'
  | 'vendor_id'
  | 'vendor_contact'
  | 'estimated_unit_cost'
  | 'expected_delivery_date'
  | 'urgency'
  | 'notes';
const REORDER_FIELDS: FieldSpecs<ReorderField> = {
  item_name: { id: 'reorder-item-name', label: 'Item Name' },
  category_id: { id: 'reorder-category', label: 'Category' },
  quantity_requested: { id: 'reorder-quantity', label: 'Quantity' },
  // The typed-in name sits under the same picker, so its errors land here too.
  vendor_id: { id: 'reorder-vendor', label: 'Vendor', apiKeys: ['vendor'] },
  vendor_contact: { id: 'reorder-vendor-contact', label: 'Vendor Contact' },
  estimated_unit_cost: { id: 'reorder-est-cost', label: 'Est. Unit Cost ($)' },
  expected_delivery_date: { id: 'reorder-delivery', label: 'Expected Delivery' },
  urgency: { id: 'reorder-urgency', label: 'Urgency' },
  notes: { id: 'reorder-notes', label: 'Notes' },
};

const REORDER_ORDER = Object.keys(REORDER_FIELDS) as ReorderField[];
/** The request keys each field writes; the vendor picker writes the id and the typed name both. */
const reorderKeysFor = (field: ReorderField): readonly string[] =>
  field === 'vendor_id' ? ['vendor_id', 'vendor'] : [field];

// Limits mirror ReorderRequestCreate / ReorderRequestUpdate (notes is
// FreeText, capped at 2000).
const REORDER_LIMITS = { item_name: 255, vendor: 255, vendor_contact: 255, notes: 2000 } as const;

const EMPTY_CREATE: CreateFD = {
  item_name: '',
  item_id: '',
  category_id: '',
  quantity_requested: '1',
  vendor: '',
  vendor_id: '',
  vendor_contact: '',
  estimated_unit_cost: '',
  expected_delivery_date: '',
  urgency: 'normal',
  notes: '',
};

// -- Create/Edit Modal Component --
const ReorderFormModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  categories: InventoryCategory[];
  vendors: InventoryVendor[];
  lowStockAlerts: LowStockAlert[];
  editRequest?: ReorderRequest | null;
  /** Category the caller arrived to order for, from `?category=` on the URL. */
  prefillAlert?: LowStockAlert | null;
}> = ({ isOpen, onClose, onSaved, categories, vendors, lowStockAlerts, editRequest, prefillAlert }) => {
  const [f, setF] = useState<CreateFD>(EMPTY_CREATE);
  const [saving, setSaving] = useState(false);
  const fieldErrors = useFieldErrors(REORDER_FIELDS);
  const { clear: clearErrors } = fieldErrors;
  // What the dialog held when it opened (or last saved), so Escape, the X and
  // Cancel ask before throwing typed changes away (forms review F-6).
  const [baseline, setBaseline] = useState<CreateFD>(EMPTY_CREATE);
  const requestClose = useDiscardGuard({
    isDirty: isOpen && JSON.stringify(f) !== JSON.stringify(baseline),
    onClose,
  });

  useEffect(() => {
    if (!isOpen) return;
    clearErrors();
    const seed = (next: CreateFD) => {
      setF(next);
      setBaseline(next);
    };
    if (editRequest) {
      seed({
        item_name: editRequest.item_name,
        item_id: editRequest.item_id ?? '',
        category_id: editRequest.category_id ?? '',
        quantity_requested: String(editRequest.quantity_requested),
        vendor: editRequest.vendor ?? '',
        vendor_id: editRequest.vendor_id ?? '',
        vendor_contact: editRequest.vendor_contact ?? '',
        estimated_unit_cost: editRequest.estimated_unit_cost != null ? String(editRequest.estimated_unit_cost) : '',
        expected_delivery_date: editRequest.expected_delivery_date ?? '',
        urgency: editRequest.urgency,
        notes: editRequest.notes ?? '',
      });
    } else if (prefillAlert) {
      // Same seed the "Quick fill from low stock" chips apply, done for the
      // reader who arrived from the hub already knowing which category is
      // short — that is what their click said.
      const firstItem = prefillAlert.items?.[0];
      seed({
        ...EMPTY_CREATE,
        item_name: firstItem?.name ?? prefillAlert.category_name,
        item_id: firstItem?.id ?? '',
        category_id: prefillAlert.category_id,
        quantity_requested: String(Math.max(1, prefillAlert.threshold - prefillAlert.current_stock)),
      });
    } else {
      seed(EMPTY_CREATE);
    }
  }, [editRequest, isOpen, prefillAlert, clearErrors]);

  const up = (k: ReorderField, v: string) => {
    setF((p) => ({ ...p, [k]: v }));
    fieldErrors.setError(k, null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Checked here rather than by the browser's required bubble, which
    // vanished after a few seconds and named nothing (forms review F-3).
    const problems: FieldErrors<ReorderField> = {};
    if (!f.item_name.trim()) problems.item_name = 'Enter the item name.';
    if (!f.quantity_requested || Number(f.quantity_requested) < 1) {
      problems.quantity_requested = 'Enter a quantity of at least 1.';
    }
    fieldErrors.setFormError(null);
    fieldErrors.setErrors(problems);
    // A new request is not created until every field is fixed; an edit saves
    // the rest and keeps a refused field's stored value (owner rule, 2026-11-05).
    if (!editRequest && Object.keys(problems).length > 0) {
      fieldErrors.focusFirst(problems);
      return;
    }
    setSaving(true);
    try {
      if (editRequest) {
        const updateData: ReorderRequestUpdate = {
          // Sent every save, null when unlinked (pitfall #1). The server keeps
          // it fixed once stock has arrived, and an unchanged id passes.
          item_id: f.item_id || null,
          // Sent every save so a changed or cleared category persists.
          category_id: f.category_id || null,
          item_name: f.item_name.trim(),
          quantity_requested: Number(f.quantity_requested),
          // Explicit nulls so clearing these persists: an omitted key means
          // "leave it alone" to the backend (CLAUDE.md pitfall #1). Linking a
          // vendor blanks the typed-in name, and without the null the old
          // supplier survives to reappear the moment the link is removed.
          vendor: blankToNull(f.vendor),
          vendor_id: f.vendor_id || null,
          vendor_contact: blankToNull(f.vendor_contact),
          estimated_unit_cost: numberOrNull(f.estimated_unit_cost),
          expected_delivery_date: f.expected_delivery_date || null,
          notes: blankToNull(f.notes),
          // Not nulled: `urgency` is a NOT NULL enum column with a default, so
          // a blank select must leave the stored value alone rather than clear it.
          urgency: f.urgency || undefined,
        };
        const { refused } = await saveExceptRefused<ReorderField, unknown>({
          payload: { ...updateData },
          refused: problems,
          keysFor: reorderKeysFor,
          send: (body) => inventoryService.updateReorderRequest(editRequest.id, body),
          place: (err) => placeApiError(REORDER_FIELDS, err),
        });
        const first = firstRefused(REORDER_ORDER, refused);
        if (first) {
          // The list refreshes behind the dialog, which stays open with the
          // refused field flagged; only that field still counts as unsaved.
          onSaved();
          fieldErrors.setErrors(refused);
          fieldErrors.setFormError(
            `Reorder request saved, except ${REORDER_FIELDS[first].label.toLowerCase()}. Fix it and save again.`
          );
          fieldErrors.focusFirst(refused);
          const keep: Partial<CreateFD> = {};
          for (const field of Object.keys(refused) as ReorderField[]) {
            for (const key of reorderKeysFor(field)) {
              if (key in baseline) keep[key as keyof CreateFD] = baseline[key as keyof CreateFD];
            }
          }
          setBaseline({ ...f, ...keep });
          return;
        }
        toast.success('Reorder request updated');
      } else {
        const createData: ReorderRequestCreate = {
          item_name: f.item_name.trim(),
          item_id: f.item_id || undefined,
          category_id: f.category_id || undefined,
          quantity_requested: Number(f.quantity_requested),
          vendor: f.vendor.trim() || undefined,
          vendor_id: f.vendor_id || undefined,
          vendor_contact: f.vendor_contact.trim() || undefined,
          estimated_unit_cost: f.estimated_unit_cost ? Number(f.estimated_unit_cost) : undefined,
          expected_delivery_date: f.expected_delivery_date || undefined,
          urgency: f.urgency || undefined,
          notes: f.notes.trim() || undefined,
        };
        await inventoryService.createReorderRequest(createData);
        toast.success('Reorder request created');
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      fieldErrors.focusFirst(fieldErrors.setFromApiError(err, 'Failed to save reorder request'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title={editRequest ? 'Edit Reorder Request' : 'New Reorder Request'}
      size="lg"
      onSubmit={(e) => {
        void submit(e);
      }}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-info btn-md text-center disabled:opacity-50">
            {saving ? 'Saving...' : editRequest ? 'Update' : 'Create Request'}
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary btn-md">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4 p-4">
        {fieldErrors.formError && (
          <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
            {fieldErrors.formError}
          </p>
        )}
        {/* Quick-fill from low stock alerts */}
        {!editRequest && lowStockAlerts.length > 0 && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
            <p className="mb-2 text-xs font-semibold text-yellow-700 dark:text-yellow-300">
              Quick fill from low stock:
            </p>
            <div className="flex flex-wrap gap-1">
              {lowStockAlerts.slice(0, 8).map((alert) => (
                <button
                  key={alert.category_id}
                  type="button"
                  className="touch:min-h-[44px] touch:min-w-[44px] rounded bg-yellow-500/20 px-2 py-1 text-xs text-yellow-800 hover:bg-yellow-500/30 dark:text-yellow-300"
                  onClick={() => {
                    const firstItem = alert.items?.[0];
                    fieldErrors.setError('item_name', null);
                    fieldErrors.setError('quantity_requested', null);
                    setF((p) => ({
                      ...p,
                      item_name: firstItem?.name ?? alert.category_name,
                      // Linked, so the order can be received (W41-5).
                      item_id: firstItem?.id ?? '',
                      category_id: alert.category_id,
                      quantity_requested: String(Math.max(1, alert.threshold - alert.current_stock)),
                    }));
                  }}
                >
                  {alert.category_name} ({alert.current_stock}/{alert.threshold})
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <span className={lbl}>Inventory item</span>
            {/* Receiving posts stock onto this item, and the server refuses a
                receipt for an order with none (W41-5). */}
            <InventoryItemPicker
              value={f.item_id || undefined}
              placeholder="Search inventory to link…"
              onChange={(id, name) =>
                setF((p) => ({
                  ...p,
                  item_id: id ?? '',
                  item_name: id && name && !p.item_name.trim() ? name : p.item_name,
                }))
              }
            />
            <p className="text-theme-text-muted mt-1 text-xs">
              Link the item this order restocks. Stock can only be received against a linked item.
            </p>
          </div>
          <FormField
            id={REORDER_FIELDS.item_name.id}
            label="Item Name"
            required
            error={fieldErrors.errors.item_name}
            labelClassName={lbl}
            className="sm:col-span-2"
            maxLength={REORDER_LIMITS.item_name}
            count={f.item_name.length}
          >
            {(field) => (
              <input
                {...field}
                className={inp}
                value={f.item_name}
                onChange={(e) => up('item_name', e.target.value)}
                placeholder="e.g. SCBA Air Cylinders"
              />
            )}
          </FormField>
          <FormField
            id={REORDER_FIELDS.category_id.id}
            label="Category"
            error={fieldErrors.errors.category_id}
            labelClassName={lbl}
          >
            {(field) => (
              <select
                {...field}
                className={inp}
                value={f.category_id}
                onChange={(e) => up('category_id', e.target.value)}
              >
                <option value="">— Select —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField
            id={REORDER_FIELDS.quantity_requested.id}
            label="Quantity"
            required
            error={fieldErrors.errors.quantity_requested}
            labelClassName={lbl}
          >
            {(field) => (
              <input
                {...field}
                type="number"
                min="1"
                className={inp}
                value={f.quantity_requested}
                onChange={(e) => up('quantity_requested', e.target.value)}
              />
            )}
          </FormField>
        </div>

        <fieldset>
          <legend className="text-theme-text-primary mb-2 text-sm font-semibold">Vendor &amp; Cost</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              id={REORDER_FIELDS.vendor_id.id}
              label="Vendor"
              error={fieldErrors.errors.vendor_id}
              labelClassName={lbl}
            >
              {(field) => (
                <>
                  <select
                    {...field}
                    className={inp}
                    value={f.vendor_id}
                    onChange={(e) => {
                      const id = e.target.value;
                      const picked = vendors.find((v) => v.id === id);
                      const contact = picked?.contacts.find((c) => c.is_primary) ?? picked?.contacts[0];
                      fieldErrors.setError('vendor_id', null);
                      setF((p) => ({
                        ...p,
                        vendor_id: id,
                        // Linking wins over the typed-in name, and the vendor's own
                        // contact details save re-typing them onto every order.
                        vendor: id ? '' : p.vendor,
                        vendor_contact: picked
                          ? contact?.email || contact?.phone || picked.email || picked.phone || ''
                          : p.vendor_contact,
                      }));
                    }}
                  >
                    <option value="">— Not linked —</option>
                    {vendors
                      .filter((v) => v.is_active || v.id === f.vendor_id)
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                          {v.is_active ? '' : ' (inactive)'}
                        </option>
                      ))}
                  </select>
                  {!f.vendor_id && (
                    <input
                      className={`${inp} mt-2`}
                      maxLength={REORDER_LIMITS.vendor}
                      value={f.vendor}
                      onChange={(e) => {
                        setF((p) => ({ ...p, vendor: e.target.value }));
                        fieldErrors.setError('vendor_id', null);
                      }}
                      aria-label="Vendor name (not on file)"
                      placeholder="Or type a name not on file"
                    />
                  )}
                </>
              )}
            </FormField>
            <FormField
              id={REORDER_FIELDS.vendor_contact.id}
              label="Vendor Contact"
              error={fieldErrors.errors.vendor_contact}
              labelClassName={lbl}
              maxLength={REORDER_LIMITS.vendor_contact}
              count={f.vendor_contact.length}
            >
              {(field) => (
                <input
                  {...field}
                  className={inp}
                  value={f.vendor_contact}
                  onChange={(e) => up('vendor_contact', e.target.value)}
                  placeholder="Email or phone"
                />
              )}
            </FormField>
            <FormField
              id={REORDER_FIELDS.estimated_unit_cost.id}
              label="Est. Unit Cost ($)"
              error={fieldErrors.errors.estimated_unit_cost}
              labelClassName={lbl}
            >
              {(field) => (
                <input
                  {...field}
                  type="number"
                  min="0"
                  step="0.01"
                  className={inp}
                  value={f.estimated_unit_cost}
                  onChange={(e) => up('estimated_unit_cost', e.target.value)}
                />
              )}
            </FormField>
            <FormField
              id={REORDER_FIELDS.expected_delivery_date.id}
              label="Expected Delivery"
              error={fieldErrors.errors.expected_delivery_date}
              labelClassName={lbl}
            >
              {(field) => (
                <input
                  {...field}
                  type="date"
                  className={inp}
                  value={f.expected_delivery_date}
                  onChange={(e) => up('expected_delivery_date', e.target.value)}
                />
              )}
            </FormField>
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField
            id={REORDER_FIELDS.urgency.id}
            label="Urgency"
            error={fieldErrors.errors.urgency}
            labelClassName={lbl}
          >
            {(field) => (
              <select {...field} className={inp} value={f.urgency} onChange={(e) => up('urgency', e.target.value)}>
                {URGENCY_OPTIONS.map((u) => (
                  <option key={u} value={u}>
                    {u.charAt(0).toUpperCase() + u.slice(1)}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField
            id={REORDER_FIELDS.notes.id}
            label="Notes"
            error={fieldErrors.errors.notes}
            labelClassName={lbl}
            className="sm:col-span-1"
            maxLength={REORDER_LIMITS.notes}
            count={f.notes.length}
          >
            {(field) => (
              <textarea
                {...field}
                className={inp}
                rows={2}
                value={f.notes}
                onChange={(e) => up('notes', e.target.value)}
                placeholder="Additional details..."
              />
            )}
          </FormField>
        </div>
      </div>
    </Modal>
  );
};

// -- Contextual workflow action modal --
type WorkflowAction = 'approve' | 'mark_ordered' | 'receive' | 'cancel';
const ACTION_LABELS: Record<WorkflowAction, string> = {
  approve: 'Approve',
  mark_ordered: 'Mark ordered',
  receive: 'Receive stock',
  cancel: 'Cancel request',
};
const ACTION_DONE: Record<WorkflowAction, string> = {
  approve: 'Request approved',
  mark_ordered: 'Marked as ordered',
  receive: 'Stock received',
  cancel: 'Request cancelled',
};
type ActionField =
  'item' | 'quantity' | 'storage_location' | 'unit_cost' | 'lot_number' | 'vendor_id' | 'purchase_order_number';
// Keys are the receipt and transition request bodies' own, so a 422 lands on
// the field it names.
const ACTION_FIELDS: FieldSpecs<ActionField> = {
  item: { id: 'reorder-receive-item', label: 'Inventory item', apiKeys: ['item_id'] },
  quantity: { id: 'reorder-receive-qty', label: 'Quantity received' },
  storage_location: { id: 'reorder-receive-location', label: 'Storage location' },
  unit_cost: { id: 'reorder-receive-cost', label: 'Unit cost ($)' },
  lot_number: { id: 'reorder-receive-lot', label: 'Lot number' },
  vendor_id: { id: 'reorder-order-vendor', label: 'Vendor', apiKeys: ['vendor'] },
  purchase_order_number: { id: 'reorder-po', label: 'Purchase-order reference' },
};
// Limits mirror ReorderReceiptCreate / ReorderTransitionRequest.
const ACTION_LIMITS = { storage_location: 255, lot_number: 100, purchase_order_number: 255 } as const;

const WorkflowActionModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  request: ReorderRequest | null;
  action: WorkflowAction | null;
  vendors: InventoryVendor[];
}> = ({ isOpen, onClose, onSaved, request, action, vendors }) => {
  const [vendorId, setVendorId] = useState('');
  const [poNumber, setPONumber] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [location, setLocation] = useState('');
  const [lotNumber, setLotNumber] = useState('');
  const [confirmOver, setConfirmOver] = useState(false);
  const [saving, setSaving] = useState(false);
  // W41-5: an unlinked order is linked here, at receipt, before stock posts.
  const [linkItemId, setLinkItemId] = useState('');
  const receivingItemId = request?.item_id || linkItemId;
  const fieldErrors = useFieldErrors(ACTION_FIELDS);
  const { clear: clearErrors } = fieldErrors;
  useEffect(() => {
    if (!isOpen || !request) return;
    clearErrors();
    setLinkItemId('');
    setVendorId(request.vendor_id ?? '');
    setPONumber(request.purchase_order_number ?? '');
    setQuantity(String(request.quantity_outstanding));
    setUnitCost(String(request.actual_unit_cost ?? request.estimated_unit_cost ?? ''));
    setLocation('');
    setLotNumber('');
    setConfirmOver(false);
  }, [isOpen, request, clearErrors]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!request || !action) return;
    // Checked here rather than by the browser's required bubble, which
    // vanished after a few seconds and named nothing (forms review F-3).
    const qty = Number(quantity);
    const problems: FieldErrors<ActionField> = {};
    if (action === 'receive') {
      if (!receivingItemId) {
        problems.item = 'Choose the inventory item the stock goes onto.';
      } else {
        if (!(qty > 0)) problems.quantity = 'Enter a quantity above 0.';
        if (!location.trim()) problems.storage_location = 'Enter where the stock is being put away.';
        if (unitCost === '' || Number(unitCost) < 0) problems.unit_cost = 'Enter a unit cost of 0 or more.';
      }
    }
    fieldErrors.setFormError(null);
    fieldErrors.setErrors(problems);
    if (Object.keys(problems).length > 0) {
      fieldErrors.focusFirst(problems);
      return;
    }
    setSaving(true);
    try {
      if (action === 'receive') {
        if (!request.item_id && linkItemId) {
          // The plain edit does not bump `version`, so the receipt below still
          // matches the version this dialog opened with.
          await inventoryService.updateReorderRequest(request.id, { item_id: linkItemId });
        }
        await inventoryService.receiveReorderStock(request.id, {
          quantity: qty,
          expected_version: request.version,
          idempotency_key: crypto.randomUUID(),
          storage_location: location.trim(),
          unit_cost: Number(unitCost),
          ...(lotNumber.trim() ? { lot_number: lotNumber.trim() } : {}),
          confirm_over_receipt: confirmOver,
        });
      } else {
        await inventoryService.transitionReorderRequest(request.id, {
          action,
          expected_version: request.version,
          ...(vendorId ? { vendor_id: vendorId } : {}),
          ...(poNumber.trim() ? { purchase_order_number: poNumber.trim() } : {}),
        });
      }
      toast.success(ACTION_DONE[action]);
      onSaved();
      onClose();
    } catch (err: unknown) {
      fieldErrors.focusFirst(fieldErrors.setFromApiError(err, `Failed to ${ACTION_LABELS[action].toLowerCase()}`));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={action ? ACTION_LABELS[action] : 'Update order'}
      size="md"
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          <button
            type="submit"
            disabled={saving}
            className={action === 'cancel' ? 'btn-danger btn-md' : 'btn-info btn-md'}
          >
            {saving ? 'Saving…' : action && ACTION_LABELS[action]}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary btn-md">
            Back
          </button>
        </>
      }
    >
      <div className="space-y-4 p-4">
        {fieldErrors.formError && (
          <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
            {fieldErrors.formError}
          </p>
        )}
        {action === 'mark_ordered' && (
          <>
            <FormField
              id={ACTION_FIELDS.vendor_id.id}
              label="Vendor"
              error={fieldErrors.errors.vendor_id}
              labelClassName={lbl}
            >
              {(field) => (
                <select
                  {...field}
                  className={inp}
                  value={vendorId}
                  onChange={(e) => {
                    setVendorId(e.target.value);
                    fieldErrors.setError('vendor_id', null);
                  }}
                >
                  <option value="">Select vendor</option>
                  {vendors
                    .filter((v) => v.is_active)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                </select>
              )}
            </FormField>
            <FormField
              id={ACTION_FIELDS.purchase_order_number.id}
              label="Purchase-order reference"
              error={fieldErrors.errors.purchase_order_number}
              labelClassName={lbl}
            >
              {(field) => (
                <input
                  {...field}
                  className={inp}
                  maxLength={ACTION_LIMITS.purchase_order_number}
                  value={poNumber}
                  onChange={(e) => {
                    setPONumber(e.target.value);
                    fieldErrors.setError('purchase_order_number', null);
                  }}
                />
              )}
            </FormField>
          </>
        )}
        {action === 'receive' && request && !request.item_id && (
          // Receipts post stock onto a linked item, and the server refuses one
          // without (W41-5); link it here first. The group is the focus target
          // for its error: the picker has no single input to name.
          <div
            id={ACTION_FIELDS.item.id}
            role="group"
            aria-labelledby={`${ACTION_FIELDS.item.id}-label`}
            aria-describedby={fieldErrors.errors.item ? `${ACTION_FIELDS.item.id}-error` : undefined}
            tabIndex={-1}
            className="focus:outline-none"
          >
            <span id={`${ACTION_FIELDS.item.id}-label`} className={lbl}>
              Inventory item{' '}
              <span aria-hidden="true" className={FIELD_ERROR_CLASS}>
                *
              </span>
            </span>
            <InventoryItemPicker
              value={linkItemId || undefined}
              placeholder="Search inventory to link…"
              onChange={(id) => {
                setLinkItemId(id ?? '');
                fieldErrors.setError('item', null);
              }}
            />
            {fieldErrors.errors.item && (
              <p id={`${ACTION_FIELDS.item.id}-error`} className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                {fieldErrors.errors.item}
              </p>
            )}
            <p className="text-theme-text-muted mt-1 text-xs">
              This order isn&apos;t linked to an inventory item yet. Choose the item the stock goes onto; the order
              stays linked to it.
            </p>
          </div>
        )}
        {action === 'receive' && receivingItemId && (
          <>
            <p className="text-theme-text-muted text-sm">
              Ordered {request?.quantity_requested ?? 0} · Received {request?.quantity_received ?? 0} · Outstanding{' '}
              {request?.quantity_outstanding ?? 0}
            </p>
            <FormField
              id={ACTION_FIELDS.quantity.id}
              label="Quantity received"
              required
              error={fieldErrors.errors.quantity}
              labelClassName={lbl}
            >
              {(field) => (
                <input
                  {...field}
                  type="number"
                  min="1"
                  className={inp}
                  value={quantity}
                  onChange={(e) => {
                    setQuantity(e.target.value);
                    fieldErrors.setError('quantity', null);
                  }}
                />
              )}
            </FormField>
            <FormField
              id={ACTION_FIELDS.storage_location.id}
              label="Storage location"
              required
              error={fieldErrors.errors.storage_location}
              labelClassName={lbl}
            >
              {(field) => (
                <input
                  {...field}
                  className={inp}
                  maxLength={ACTION_LIMITS.storage_location}
                  value={location}
                  onChange={(e) => {
                    setLocation(e.target.value);
                    fieldErrors.setError('storage_location', null);
                  }}
                />
              )}
            </FormField>
            <FormField
              id={ACTION_FIELDS.unit_cost.id}
              label="Unit cost ($)"
              required
              error={fieldErrors.errors.unit_cost}
              labelClassName={lbl}
            >
              {(field) => (
                <input
                  {...field}
                  type="number"
                  min="0"
                  step="0.01"
                  className={inp}
                  value={unitCost}
                  onChange={(e) => {
                    setUnitCost(e.target.value);
                    fieldErrors.setError('unit_cost', null);
                  }}
                />
              )}
            </FormField>
            <FormField
              id={ACTION_FIELDS.lot_number.id}
              label="Lot number"
              error={fieldErrors.errors.lot_number}
              labelClassName={lbl}
            >
              {(field) => (
                <input
                  {...field}
                  className={inp}
                  maxLength={ACTION_LIMITS.lot_number}
                  value={lotNumber}
                  onChange={(e) => {
                    setLotNumber(e.target.value);
                    fieldErrors.setError('lot_number', null);
                  }}
                />
              )}
            </FormField>
            {Number(quantity) > (request?.quantity_outstanding ?? 0) && (
              <label className="flex gap-2 text-sm">
                <input type="checkbox" checked={confirmOver} onChange={(e) => setConfirmOver(e.target.checked)} />{' '}
                Confirm intentional over-receipt
              </label>
            )}
          </>
        )}
        {action === 'approve' && request && (
          <p className="text-theme-text-secondary text-sm">
            Approve ordering {request.quantity_requested} × {request.item_name}?
          </p>
        )}
        {action === 'cancel' && (
          <p className="text-theme-text-secondary text-sm">
            Cancel this request? This action is recorded in the audit log.
          </p>
        )}
      </div>
    </Modal>
  );
};

// -- Main Page --
export const ReorderRequestsPage: React.FC = () => {
  const tz = useTimezone();
  const [requests, setRequests] = useState<ReorderRequest[]>([]);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [vendors, setVendors] = useState<InventoryVendor[]>([]);
  const [lowStockAlerts, setLowStockAlerts] = useState<LowStockAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [editRequest, setEditRequest] = useState<ReorderRequest | null>(null);
  const [statusRequest, setStatusRequest] = useState<ReorderRequest | null>(null);
  const [workflowAction, setWorkflowAction] = useState<WorkflowAction | null>(null);
  const [prefillAlert, setPrefillAlert] = useState<LowStockAlert | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reqs, cats, lowStock, vendorList] = await Promise.all([
        inventoryService.getReorderRequests({
          status: statusFilter || undefined,
          urgency: urgencyFilter || undefined,
          search: search || undefined,
        }),
        inventoryService.getCategories().catch(() => [] as InventoryCategory[]),
        inventoryService.getLowStockItems().catch(() => [] as LowStockAlert[]),
        // Inactive vendors are fetched too so an existing link to one still
        // shows its name; the options below only offer the active ones.
        inventoryService.getVendors({ active_only: false }).catch(() => [] as InventoryVendor[]),
      ]);
      setRequests(reqs);
      setCategories(cats);
      setLowStockAlerts(lowStock);
      setVendors(vendorList);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load reorder requests'));
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, urgencyFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // "Receive" on the inventory hub's attention queue names an overdue
  // delivery; open its dialog rather than the unfiltered list. An order that
  // has been placed opens straight on Receive stock — that is what the link
  // said — while anything else opens the generic dialog, since the right next
  // step for it is the officer's call and not this link's.
  useDeepLinkedRecord(
    'request',
    requests,
    (request) => request.id,
    (request) => {
      setStatusRequest(request);
      setWorkflowAction(request.status === 'ordered' ? 'receive' : null);
    }
  );

  // A low-stock row on that queue names the category that is short, not a
  // request — there is nothing to open yet, which is the point. Open the
  // create form already filled in for it.
  useDeepLinkedRecord(
    'category',
    lowStockAlerts,
    (alert) => alert.category_id,
    (alert) => {
      setPrefillAlert(alert);
      setShowCreate(true);
    }
  );

  const stats = useMemo(() => {
    const pending = requests.filter((r) => r.status === 'pending').length;
    const ordered = requests.filter((r) => r.status === 'ordered').length;
    const totalEstCost = requests
      .filter((r) => r.status !== 'cancelled' && r.status !== 'received')
      .reduce((sum, r) => sum + (r.estimated_unit_cost ?? 0) * r.quantity_requested, 0);
    return { pending, ordered, totalEstCost };
  }, [requests]);

  const fmtDate = (dateStr: string | undefined) => {
    if (!dateStr) return '—';
    return formatDateUtil(dateStr, tz);
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-5xl py-6 sm:py-8">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex-1">
            <h2 className="text-theme-text-primary text-2xl font-bold">Reorder Requests</h2>
            <p className="text-theme-text-muted text-sm">Track supply orders from request to receipt</p>
          </div>
          <button
            onClick={() => {
              void load();
            }}
            className="btn-secondary btn-md"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-info btn-md flex items-center gap-2">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Request</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>

        {/* Stats */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="card-secondary p-3 text-center">
            <p className="text-theme-text-primary text-2xl font-bold">{requests.length}</p>
            <p className="text-theme-text-muted text-xs">Total Requests</p>
          </div>
          <div className="card-secondary p-3 text-center">
            <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">{stats.pending}</p>
            <p className="text-theme-text-muted text-xs">Pending</p>
          </div>
          <div className="card-secondary p-3 text-center">
            <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{stats.ordered}</p>
            <p className="text-theme-text-muted text-xs">On Order</p>
          </div>
          <div className="card-secondary p-3 text-center">
            <p className="text-theme-text-primary text-2xl font-bold">
              <DollarSign className="-mt-0.5 inline h-4 w-4" />
              {stats.totalEstCost > 0 ? formatCurrency(stats.totalEstCost) : '—'}
            </p>
            <p className="text-theme-text-muted text-xs">Est. Outstanding</p>
          </div>
        </div>

        {/* Low stock banner */}
        {lowStockAlerts.length > 0 && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-700 dark:text-yellow-400" />
            <p className="text-xs text-yellow-700 dark:text-yellow-300">
              {lowStockAlerts.length} categor{lowStockAlerts.length === 1 ? 'y' : 'ies'} below stock threshold
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="ml-auto text-xs font-medium text-yellow-700 hover:underline dark:text-yellow-300"
            >
              Create reorder &rarr;
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="mb-4 flex flex-wrap gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <input
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={`${inp} pl-9`}
              aria-label="Search by item name..."
              placeholder="Search by item name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter by status"
            className={inp + ' w-auto'}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s] ?? s}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by urgency"
            className={inp + ' w-auto'}
            value={urgencyFilter}
            onChange={(e) => setUrgencyFilter(e.target.value)}
          >
            <option value="">All Urgencies</option>
            {URGENCY_OPTIONS.map((u) => (
              <option key={u} value={u}>
                {u.charAt(0).toUpperCase() + u.slice(1)}
              </option>
            ))}
          </select>
        </div>

        {/* Table */}
        {loading && requests.length === 0 ? (
          <div className="text-theme-text-muted py-12 text-center">Loading...</div>
        ) : requests.length === 0 ? (
          <div className="card-secondary rounded-lg py-12 text-center">
            <Package className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
            <p className="text-theme-text-muted">No reorder requests found</p>
            <button onClick={() => setShowCreate(true)} className="btn-info btn-md mt-3">
              Create First Request
            </button>
          </div>
        ) : (
          <div className="card-secondary rwd-table-container overflow-hidden rounded-lg md:overflow-x-auto">
            {/* Single responsive table: stacked cards when this wrapper is
                under 80rem (it needs ~990px), a table above. */}
            <table className="rwd-table rwd-table-xwide w-full text-sm">
              <thead>
                <tr className="border-theme-surface-border bg-theme-surface-secondary border-b">
                  <th scope="col" className="text-theme-text-muted px-4 py-3 text-left font-medium">
                    Item
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-3 text-left font-medium">
                    Qty
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-3 text-left font-medium">
                    Vendor
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-3 text-left font-medium">
                    Est. Cost
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-3 text-left font-medium">
                    Status
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-3 text-left font-medium">
                    Urgency
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-3 text-left font-medium">
                    Requested
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-3 text-right font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {requests.map((req) => (
                  <tr key={req.id} className="border-theme-surface-border hover:bg-theme-surface-hover border-b">
                    <td data-label="Item" className="px-4 py-3">
                      <p className="text-theme-text-primary font-medium">{req.item_name}</p>
                      {req.requester_name && <p className="text-theme-text-muted text-xs">by {req.requester_name}</p>}
                    </td>
                    <td data-label="Qty" className="text-theme-text-primary px-4 py-3">
                      {req.quantity_requested}
                      {req.quantity_received != null && (
                        <span className="ml-1 text-xs text-green-700 dark:text-green-400">
                          ({req.quantity_received} received)
                        </span>
                      )}
                    </td>
                    <td data-label="Vendor" className="px-4 py-3">
                      <VendorName record={req} />
                    </td>
                    <td data-label="Est. Cost" className="text-theme-text-primary px-4 py-3">
                      {req.estimated_unit_cost != null
                        ? formatCurrency(Number(req.estimated_unit_cost) * req.quantity_requested)
                        : '—'}
                      {req.actual_unit_cost != null && (
                        <span className="text-theme-text-muted block text-xs">
                          Actual: {formatCurrency(Number(req.actual_unit_cost) * req.quantity_requested)}
                        </span>
                      )}
                    </td>
                    <td data-label="Status" className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[req.status] ?? ''}`}
                      >
                        {STATUS_ICONS[req.status]}
                        {STATUS_LABELS[req.status] ?? req.status}
                      </span>
                    </td>
                    <td data-label="Urgency" className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${URGENCY_COLORS[req.urgency] ?? ''}`}
                      >
                        {req.urgency}
                      </span>
                    </td>
                    <td data-label="Requested" className="text-theme-text-muted px-4 py-3 text-xs">
                      {fmtDate(req.created_at)}
                      {req.purchase_order_number && (
                        <span className="text-theme-text-primary block">PO: {req.purchase_order_number}</span>
                      )}
                    </td>
                    <td data-label="" className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        {req.status === 'pending' && (
                          <button
                            onClick={() => {
                              setStatusRequest(req);
                              setWorkflowAction('approve');
                            }}
                            className="btn-info btn-sm"
                          >
                            Approve
                          </button>
                        )}
                        {req.status === 'approved' && (
                          <button
                            onClick={() => {
                              setStatusRequest(req);
                              setWorkflowAction('mark_ordered');
                            }}
                            className="btn-info btn-sm"
                          >
                            Mark ordered
                          </button>
                        )}
                        {(req.status === 'ordered' || req.status === 'partially_received') && (
                          <button
                            onClick={() => {
                              setStatusRequest(req);
                              setWorkflowAction('receive');
                            }}
                            className="btn-info btn-sm"
                          >
                            Receive stock
                          </button>
                        )}
                        {!['received', 'cancelled'].includes(req.status) && (
                          <button
                            onClick={() => {
                              setStatusRequest(req);
                              setWorkflowAction('cancel');
                            }}
                            className="btn-secondary btn-sm"
                          >
                            Cancel
                          </button>
                        )}
                        {req.status === 'pending' && (
                          <button
                            onClick={() => {
                              setEditRequest(req);
                              setShowCreate(true);
                            }}
                            className="bg-theme-surface-secondary hover:bg-theme-surface-hover text-theme-text-primary touch:min-h-[44px] touch:min-w-[44px] rounded px-2 py-1 text-xs"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Modals */}
        <ReorderFormModal
          isOpen={showCreate}
          onClose={() => {
            setShowCreate(false);
            setEditRequest(null);
            // Cleared with the dialog, or the next manual "New request" would
            // open pre-filled for whatever category the last deep link named.
            setPrefillAlert(null);
          }}
          onSaved={() => {
            void load();
          }}
          categories={categories}
          vendors={vendors}
          lowStockAlerts={lowStockAlerts}
          prefillAlert={prefillAlert}
          editRequest={editRequest}
        />
        <WorkflowActionModal
          isOpen={statusRequest !== null}
          onClose={() => {
            setStatusRequest(null);
            setWorkflowAction(null);
          }}
          onSaved={() => {
            void load();
          }}
          request={statusRequest}
          action={workflowAction}
          vendors={vendors}
        />
      </div>
    </div>
  );
};

export default ReorderRequestsPage;
