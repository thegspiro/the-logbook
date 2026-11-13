/**
 * Issuance Allowances Page
 *
 * Admin page for configuring per-category issuance caps (e.g. "3 polo shirts
 * per year per firefighter"). These caps are enforced by the backend when
 * issuing pool items, so this page is how admins actually make the limits real.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { SlidersHorizontal, RefreshCw, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import { roleService } from '../../../services/userServices';
import type { IssuanceAllowance, InventoryCategory, Role } from '../types';
import { getErrorMessage } from '../../../utils/errorHandling';
import { Modal } from '../../../components/Modal';
import { ConfirmDialog } from '../../../components/ux/ConfirmDialog';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { firstRefused, saveExceptRefused } from '../../../utils/saveExceptRefused';
import toast from 'react-hot-toast';

const PERIOD_OPTIONS = [
  { value: 'annual', label: 'Per Year' },
  { value: 'career', label: 'Per Career' },
  { value: 'one_time', label: 'One Time' },
];

const periodLabel = (value: string): string => PERIOD_OPTIONS.find((p) => p.value === value)?.label ?? value;

type AllowanceField = 'category_id' | 'role_id' | 'max_quantity' | 'period_type';
type AllowanceForm = Record<AllowanceField, string>;

/** `IssuanceAllowanceCreate` / `Update` in schemas/inventory.py; ordered as on screen. */
const ALLOWANCE_FIELDS: Record<AllowanceField, ServerFieldSpec & { id: string }> = {
  category_id: { label: 'Category', id: 'allow-cat' },
  role_id: { label: 'Applies To', id: 'allow-role' },
  max_quantity: { label: 'Max Quantity', id: 'allow-qty' },
  period_type: { label: 'Period', id: 'allow-period' },
};
const ALLOWANCE_ORDER = Object.keys(ALLOWANCE_FIELDS) as AllowanceField[];
const EMPTY_FORM: AllowanceForm = { category_id: '', role_id: '', max_quantity: '1', period_type: 'annual' };

const inputClass = 'form-input w-full';
const labelClass = 'form-label';

const AllowancesPage: React.FC = () => {
  const [allowances, setAllowances] = useState<IssuanceAllowance[]>([]);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [modal, setModal] = useState<{ open: boolean; editing: IssuanceAllowance | null }>({
    open: false,
    editing: null,
  });
  const [form, setForm] = useState<AllowanceForm>(EMPTY_FORM);
  const [baseline, setBaseline] = useState<AllowanceForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<AllowanceField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const closeModal = () => setModal({ open: false, editing: null });
  // Escape, the X and Cancel ask before throwing typed changes away (forms review F-6).
  const requestClose = useDiscardGuard({
    isDirty: modal.open && JSON.stringify(form) !== JSON.stringify(baseline),
    onClose: closeModal,
  });
  const setField = (key: AllowanceField, value: string) => {
    setForm((p) => ({ ...p, [key]: value }));
    setErrors((p) => ({ ...p, [key]: undefined }));
  };
  const [deleteTarget, setDeleteTarget] = useState<IssuanceAllowance | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [allow, cats, roleList] = await Promise.all([
        inventoryService.getAllowances(),
        inventoryService.getCategories(undefined, false),
        roleService.getRoles(),
      ]);
      setAllowances(allow);
      setCategories(cats);
      setRoles(roleList);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load allowances'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? id;
  const roleName = (id?: string) => (id ? (roles.find((r) => r.id === id)?.name ?? id) : 'All members');

  const open = (seeded: AllowanceForm, editing: IssuanceAllowance | null) => {
    setForm(seeded);
    setBaseline(seeded);
    setErrors({});
    setFormError(null);
    setModal({ open: true, editing });
  };

  const openCreate = () => open({ ...EMPTY_FORM, category_id: categories[0]?.id ?? '' }, null);

  const openEdit = (a: IssuanceAllowance) =>
    open(
      {
        category_id: a.category_id,
        role_id: a.role_id ?? '',
        max_quantity: String(a.max_quantity),
        period_type: a.period_type,
      },
      a
    );

  const showErrors = (next: Partial<Record<AllowanceField, string>>) => {
    setErrors(next);
    const first = firstRefused(ALLOWANCE_ORDER, next);
    if (first) window.setTimeout(() => document.getElementById(ALLOWANCE_FIELDS[first].id)?.focus(), 0);
  };

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const rawQty = form.max_quantity.trim();
    // Number('') is 0, and 0 is a real setting ("none may be issued"), so an
    // emptied box must be refused rather than silently saved as a zero cap.
    const qty = rawQty === '' ? NaN : Number(rawQty);
    const problems: Partial<Record<AllowanceField, string>> = {};
    if (!form.category_id) problems.category_id = 'Choose the category this allowance caps.';
    if (!Number.isInteger(qty) || qty < 0) problems.max_quantity = 'Enter a whole number of 0 or more.';
    setFormError(null);
    // A new allowance is not created until every field is fixed; an edit saves
    // the rest and keeps a refused field's stored value (owner rule, 2026-11-05).
    if (!modal.editing && Object.keys(problems).length > 0) {
      showErrors(problems);
      return;
    }
    setSaving(true);
    try {
      if (modal.editing) {
        const editing = modal.editing;
        const { refused } = await saveExceptRefused<AllowanceField, unknown>({
          payload: { max_quantity: qty, period_type: form.period_type },
          refused: problems,
          send: (body) => inventoryService.updateAllowance(editing.id, body),
          place: (err) => mapServerFieldErrors(err, ALLOWANCE_FIELDS),
        });
        const first = firstRefused(ALLOWANCE_ORDER, refused);
        if (first) {
          void load();
          showErrors(refused);
          setFormError(
            `Allowance saved, except ${ALLOWANCE_FIELDS[first].label.toLowerCase()}. Fix it and save again.`
          );
          const keep = Object.fromEntries(Object.keys(refused).map((k) => [k, baseline[k as AllowanceField]]));
          setBaseline({ ...form, ...keep });
          return;
        }
        toast.success('Allowance updated');
      } else {
        await inventoryService.createAllowance({
          category_id: form.category_id,
          role_id: form.role_id || undefined,
          max_quantity: qty,
          period_type: form.period_type,
        });
        toast.success('Allowance created');
      }
      closeModal();
      void load();
    } catch (err: unknown) {
      // A refusal lands on its field (forms review F-2); anything no field
      // answers for is said in the dialog, which stays open.
      const mapped = mapServerFieldErrors(err, ALLOWANCE_FIELDS);
      if (mapped) showErrors(mapped.fieldErrors);
      setFormError(
        mapped?.unmatched.join(' ') ||
          (mapped && Object.keys(mapped.fieldErrors).length > 0
            ? null
            : getErrorMessage(err, 'Failed to save allowance'))
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await inventoryService.deleteAllowance(deleteTarget.id);
      toast.success('Allowance deleted');
      setDeleteTarget(null);
      void load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete allowance'));
    }
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl py-6 sm:py-8">
        <div className="split-row mb-6 gap-3 sm:items-center">
          <div className="split-row-main flex items-center gap-3">
            <div className="shrink-0 rounded-lg bg-blue-600 p-2">
              <SlidersHorizontal className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-theme-text-primary text-xl font-bold">Issuance Allowances</h2>
              <p className="text-theme-text-muted text-sm">
                Limit how many units of a category each member can be issued per period
              </p>
            </div>
          </div>
          <div className="split-row-aside flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                void load();
              }}
              className="btn-secondary btn-md"
              aria-label="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={openCreate} className="btn-info btn-md inline-flex items-center gap-1">
              <Plus className="h-4 w-4" /> New Allowance
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12" role="status" aria-live="polite">
            <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
          </div>
        ) : allowances.length === 0 ? (
          <div className="card-secondary p-8 text-center">
            <SlidersHorizontal className="text-theme-text-muted mx-auto mb-4 h-12 w-12" />
            <h2 className="text-theme-text-primary mb-2 text-lg font-semibold">No Allowances Configured</h2>
            <p className="text-theme-text-muted mb-4 text-sm">
              Without allowances, members can be issued unlimited quantities of any category.
            </p>
            <button onClick={openCreate} className="btn-info btn-md inline-flex items-center gap-1">
              <Plus className="h-4 w-4" /> Create your first allowance
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {allowances.map((a) => (
              <div key={a.id} className="card-secondary flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-theme-text-primary text-sm font-semibold">{categoryName(a.category_id)}</span>
                    {!a.is_active && (
                      <span className="bg-theme-surface-secondary text-theme-text-muted rounded-full px-2 py-0.5 text-xs">
                        inactive
                      </span>
                    )}
                  </div>
                  <p className="text-theme-text-muted mt-0.5 text-xs">
                    {roleName(a.role_id)} —{' '}
                    {a.max_quantity === 0 ? (
                      <strong>none may be issued</strong>
                    ) : (
                      <>
                        max <strong>{a.max_quantity}</strong>
                      </>
                    )}{' '}
                    {periodLabel(a.period_type).toLowerCase()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => openEdit(a)}
                    className="btn-secondary btn-sm inline-flex items-center gap-1"
                    aria-label="Edit allowance"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(a)}
                    className="btn-secondary btn-sm inline-flex items-center gap-1 text-red-600"
                    aria-label="Delete allowance"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create / Edit Modal */}
        <Modal
          isOpen={modal.open}
          onClose={requestClose}
          title={modal.editing ? 'Edit Allowance' : 'New Allowance'}
          size="sm"
          onSubmit={(e) => void handleSave(e)}
          noValidate
          footer={
            <>
              <button
                type="submit"
                disabled={saving}
                className="btn-info btn-md inline-flex items-center justify-center gap-1"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {modal.editing ? 'Save Changes' : 'Create'}
              </button>
              <button type="button" onClick={requestClose} className="btn-secondary btn-md">
                Cancel
              </button>
            </>
          }
        >
          <div className="space-y-4">
            {formError && (
              <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
                {formError}
              </p>
            )}
            <FormField
              id={ALLOWANCE_FIELDS.category_id.id}
              label="Category"
              required
              error={errors.category_id}
              labelClassName={labelClass}
            >
              {(field) => (
                <select
                  {...field}
                  value={form.category_id}
                  onChange={(e) => setField('category_id', e.target.value)}
                  className={inputClass}
                  disabled={!!modal.editing}
                >
                  <option value="">Select a category…</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>

            <FormField
              id={ALLOWANCE_FIELDS.role_id.id}
              label="Applies To"
              error={errors.role_id}
              labelClassName={labelClass}
              hint="A role-specific allowance overrides the all-members default."
            >
              {(field) => (
                <select
                  {...field}
                  value={form.role_id}
                  onChange={(e) => setField('role_id', e.target.value)}
                  className={inputClass}
                  disabled={!!modal.editing}
                >
                  <option value="">All members</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                id={ALLOWANCE_FIELDS.max_quantity.id}
                label="Max Quantity"
                required
                error={errors.max_quantity}
                labelClassName={labelClass}
              >
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={form.max_quantity}
                    onChange={(e) => setField('max_quantity', e.target.value)}
                    className={inputClass}
                  />
                )}
              </FormField>
              <FormField
                id={ALLOWANCE_FIELDS.period_type.id}
                label="Period"
                error={errors.period_type}
                labelClassName={labelClass}
              >
                {(field) => (
                  <select
                    {...field}
                    value={form.period_type}
                    onChange={(e) => setField('period_type', e.target.value)}
                    className={inputClass}
                  >
                    {PERIOD_OPTIONS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
            </div>
          </div>
        </Modal>

        <ConfirmDialog
          isOpen={deleteTarget !== null}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => {
            void handleDelete();
          }}
          title="Delete Allowance"
          message={
            deleteTarget
              ? `Remove the allowance for "${categoryName(deleteTarget.category_id)}"? Members will no longer be capped for this category.`
              : ''
          }
          confirmLabel="Delete"
          variant="danger"
        />
      </div>
    </div>
  );
};

export default AllowancesPage;
