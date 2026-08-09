/**
 * Issuance Allowances Page
 *
 * Admin page for configuring per-category issuance caps (e.g. "3 polo shirts
 * per year per firefighter"). These caps are enforced by the backend when
 * issuing pool items, so this page is how admins actually make the limits real.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, SlidersHorizontal, RefreshCw, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import { roleService } from '../../../services/userServices';
import type { IssuanceAllowance, InventoryCategory, Role } from '../types';
import { getErrorMessage } from '../../../utils/errorHandling';
import { Modal } from '../../../components/Modal';
import { ConfirmDialog } from '../../../components/ux/ConfirmDialog';
import toast from 'react-hot-toast';

const PERIOD_OPTIONS = [
  { value: 'annual', label: 'Per Year' },
  { value: 'career', label: 'Per Career' },
  { value: 'one_time', label: 'One Time' },
];

const periodLabel = (value: string): string => PERIOD_OPTIONS.find((p) => p.value === value)?.label ?? value;

const inputClass = 'form-input w-full';
const labelClass = 'block text-sm font-medium text-theme-text-primary mb-1';

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
  const [form, setForm] = useState({ category_id: '', role_id: '', max_quantity: '1', period_type: 'annual' });
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

  const openCreate = () => {
    setForm({ category_id: categories[0]?.id ?? '', role_id: '', max_quantity: '1', period_type: 'annual' });
    setModal({ open: true, editing: null });
  };

  const openEdit = (a: IssuanceAllowance) => {
    setForm({
      category_id: a.category_id,
      role_id: a.role_id ?? '',
      max_quantity: String(a.max_quantity),
      period_type: a.period_type,
    });
    setModal({ open: true, editing: a });
  };

  const handleSave = async () => {
    const qty = Number(form.max_quantity);
    if (!form.category_id) {
      toast.error('Select a category');
      return;
    }
    if (!Number.isInteger(qty) || qty < 0) {
      toast.error('Max quantity must be a non-negative whole number');
      return;
    }
    setSaving(true);
    try {
      if (modal.editing) {
        await inventoryService.updateAllowance(modal.editing.id, {
          max_quantity: qty,
          period_type: form.period_type,
        });
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
      setModal({ open: false, editing: null });
      void load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save allowance'));
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
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <Link
          to="/inventory/admin"
          className="text-theme-text-muted hover:text-theme-text-secondary mb-6 flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Admin
        </Link>

        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-600 p-2">
              <SlidersHorizontal className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-xl font-bold">Issuance Allowances</h1>
              <p className="text-theme-text-muted text-sm">
                Limit how many units of a category each member can be issued per period
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
            <h3 className="text-theme-text-primary mb-2 text-lg font-semibold">No Allowances Configured</h3>
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
                    {roleName(a.role_id)} — max <strong>{a.max_quantity}</strong>{' '}
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
          onClose={() => setModal({ open: false, editing: null })}
          title={modal.editing ? 'Edit Allowance' : 'New Allowance'}
          size="sm"
        >
          <div className="space-y-4">
            <div>
              <label htmlFor="allow-cat" className={labelClass}>
                Category
              </label>
              <select
                id="allow-cat"
                value={form.category_id}
                onChange={(e) => setForm((p) => ({ ...p, category_id: e.target.value }))}
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
            </div>

            <div>
              <label htmlFor="allow-role" className={labelClass}>
                Applies To
              </label>
              <select
                id="allow-role"
                value={form.role_id}
                onChange={(e) => setForm((p) => ({ ...p, role_id: e.target.value }))}
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
              <p className="text-theme-text-muted mt-1 text-xs">
                A role-specific allowance overrides the all-members default.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="allow-qty" className={labelClass}>
                  Max Quantity
                </label>
                <input
                  id="allow-qty"
                  type="number"
                  min={0}
                  value={form.max_quantity}
                  onChange={(e) => setForm((p) => ({ ...p, max_quantity: e.target.value }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="allow-period" className={labelClass}>
                  Period
                </label>
                <select
                  id="allow-period"
                  value={form.period_type}
                  onChange={(e) => setForm((p) => ({ ...p, period_type: e.target.value }))}
                  className={inputClass}
                >
                  {PERIOD_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col-reverse items-stretch justify-end gap-2 pt-2 sm:flex-row sm:items-center">
              <button onClick={() => setModal({ open: false, editing: null })} className="btn-secondary btn-md">
                Cancel
              </button>
              <button
                onClick={() => {
                  void handleSave();
                }}
                disabled={saving}
                className="btn-info btn-md inline-flex items-center justify-center gap-1"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {modal.editing ? 'Save Changes' : 'Create'}
              </button>
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
