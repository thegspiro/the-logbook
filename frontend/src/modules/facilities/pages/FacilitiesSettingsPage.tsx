import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import { useConfirm } from '@/contexts/ConfirmContext';
import { DialogPortal } from '@/components/DialogPortal';
import { DialogPanel } from '@/components/ux/DialogPanel';
import { facilitiesService } from '../../../services/facilitiesServices';
import { getErrorMessage } from '../../../utils/errorHandling';
import type { FacilityStatus, FacilityType, MaintenanceType } from '../types';
type Lookup = FacilityType | FacilityStatus | MaintenanceType;
type Kind = 'types' | 'statuses' | 'maintenance';
const definitions: Record<Kind, { title: string; singular: string; offeredOn: string }> = {
  types: { title: 'Facility Types', singular: 'facility type', offeredOn: 'when creating or editing a facility' },
  statuses: {
    title: 'Facility Statuses',
    singular: 'facility status',
    offeredOn: 'when creating or editing a facility',
  },
  maintenance: {
    title: 'Maintenance Types',
    singular: 'maintenance type',
    offeredOn: 'when logging a maintenance record',
  },
};
export default function FacilitiesSettingsPage() {
  const navigate = useNavigate(),
    [data, setData] = useState<Record<Kind, Lookup[]>>({ types: [], statuses: [], maintenance: [] }),
    [loading, setLoading] = useState(true),
    [editing, setEditing] = useState<{ kind: Kind; item?: Lookup } | null>(null);
  const { confirm } = useConfirm();
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [types, statuses, maintenance] = await Promise.all([
        facilitiesService.getTypes(),
        facilitiesService.getStatuses(),
        // Both states: this screen is the only one that can reactivate a
        // deactivated type, and the endpoint filters to active by default.
        facilitiesService.getMaintenanceTypes({ limit: 500, include_inactive: true }),
      ]);
      setData({ types, statuses, maintenance });
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to load facility settings'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);
  const remove = async (kind: Kind, item: Lookup) => {
    if ((item.usageCount ?? 0) > 0 || item.isSystem) return;
    if (
      !(await confirm({
        title: `Delete this ${definitions[kind].singular}?`,
        message: `“${item.name}” will no longer be offered ${definitions[kind].offeredOn}.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
        variant: 'danger',
      }))
    )
      return;
    try {
      if (kind === 'types') await facilitiesService.deleteType(item.id);
      else if (kind === 'statuses') await facilitiesService.deleteStatus(item.id);
      else await facilitiesService.deleteMaintenanceType(item.id);
      toast.success(`${definitions[kind].singular} deleted`);
    } catch (error) {
      toast.error(getErrorMessage(error, `Unable to delete ${definitions[kind].singular}`));
    } finally {
      await load();
    }
  };
  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <button className="btn-icon" aria-label="Back to Facilities" onClick={() => void navigate('/facilities')}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-theme-text-primary text-2xl font-bold">Facility Settings</h1>
          <p className="text-theme-text-secondary mt-1 text-sm">
            Manage lookup values used by facilities and maintenance records.
          </p>
        </div>
      </header>
      {loading ? (
        <div className="flex justify-center py-16" role="status">
          <Loader2 className="h-7 w-7 animate-spin" />
          <span className="sr-only">Loading facility settings</span>
        </div>
      ) : (
        (Object.keys(definitions) as Kind[]).map((kind) => (
          <LookupEditor
            key={kind}
            kind={kind}
            items={data[kind]}
            onEdit={(item) => setEditing({ kind, item })}
            onAdd={() => setEditing({ kind })}
            onDelete={(item) => void remove(kind, item)}
          />
        ))
      )}
      {editing && (
        <LookupDialog
          kind={editing.kind}
          {...(editing.item ? { item: editing.item } : {})}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}
function LookupEditor({
  kind,
  items,
  onEdit,
  onAdd,
  onDelete,
}: {
  kind: Kind;
  items: Lookup[];
  onEdit: (item: Lookup) => void;
  onAdd: () => void;
  onDelete: (item: Lookup) => void;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="border-theme-surface-border flex items-center justify-between border-b p-4">
        <div>
          <h2 className="text-theme-text-primary font-semibold">{definitions[kind].title}</h2>
          <p className="text-theme-text-muted text-xs">Ordered as shown in facility forms.</p>
        </div>
        <button className="btn-primary flex items-center gap-1 text-sm" onClick={onAdd}>
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="rwd-table w-full text-left text-sm">
          <thead>
            <tr>
              <th className="p-3">Order</th>
              <th className="p-3">Name</th>
              <th className="p-3">State</th>
              <th className="p-3">Owner</th>
              <th className="p-3">Usage</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const used = item.usageCount ?? 0,
                reason = item.isSystem
                  ? 'System lookups cannot be deleted'
                  : used
                    ? `In use by ${used} record${used === 1 ? '' : 's'}`
                    : undefined;
              return (
                <tr className="border-theme-surface-border border-t" key={item.id}>
                  <td data-label="Order" className="p-3">
                    {item.sortOrder ?? index + 1}
                  </td>
                  <td data-label="Name" className="p-3 font-medium">
                    {item.name}
                  </td>
                  <td data-label="State" className="p-3">
                    {item.isActive === false ? 'Inactive' : 'Active'}
                  </td>
                  <td data-label="Owner" className="p-3">
                    {item.isSystem ? 'System' : 'Organization'}
                  </td>
                  <td data-label="Usage" className="p-3">
                    {used}
                  </td>
                  <td data-label="" className="p-3">
                    <div className="flex justify-end gap-2">
                      <button aria-label={`Edit ${item.name}`} className="btn-icon" onClick={() => onEdit(item)}>
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        aria-label={`Delete ${item.name}`}
                        title={reason}
                        className="btn-icon text-red-500 disabled:opacity-40"
                        disabled={Boolean(reason)}
                        onClick={() => onDelete(item)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function LookupDialog({
  kind,
  item,
  onClose,
  onSaved,
}: {
  kind: Kind;
  item?: Lookup;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(item?.name ?? ''),
    [active, setActive] = useState(item?.isActive !== false),
    [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    // No sort_order: none of the three lookup models has that column and no
    // schema declares it, so Pydantic dropped it and the ordering the dialog
    // appeared to offer was never stored. The control is gone rather than
    // left writing nothing (CLAUDE.md pitfall #19).
    const payload = { name: name.trim(), is_active: active };
    try {
      if (kind === 'types') {
        if (item) await facilitiesService.updateType(item.id, payload);
        else await facilitiesService.createType(payload);
      } else if (kind === 'statuses') {
        if (item) await facilitiesService.updateStatus(item.id, payload);
        else await facilitiesService.createStatus(payload);
      } else if (item) {
        await facilitiesService.updateMaintenanceType(item.id, payload);
      } else {
        await facilitiesService.createMaintenanceType(payload);
      }
      toast.success(`${definitions[kind].singular} saved`);
      await onSaved();
    } catch (error) {
      toast.error(getErrorMessage(error, `Unable to save ${definitions[kind].singular}`));
    } finally {
      setSaving(false);
    }
  };
  // Through DialogPortal/DialogPanel rather than a hand-rolled fixed overlay:
  // that shell had no focus trap, no Escape handling, no body scroll lock, and
  // never registered with useOverlaySurface — so on a phone the bottom nav bar
  // painted over its buttons.
  return (
    <DialogPortal>
      <div className="modal-overlay z-50 flex items-center justify-center p-4">
        <DialogPanel
          onClose={onClose}
          className="card modal-panel-scroll w-full max-w-md space-y-4 p-5"
          aria-labelledby="lookup-title"
        >
          <form className="space-y-4" onSubmit={(event) => void submit(event)}>
            <h2 id="lookup-title" className="text-lg font-semibold">
              {item ? 'Edit' : 'Add'} {definitions[kind].singular}
            </h2>
            <label className="form-label block">
              Name
              {/* form-input, not "input": no such utility exists in this
                  project or in Tailwind, so both controls rendered with
                  browser default styling — no theme colours, no focus ring,
                  and none of the 44px mobile floor. */}
              <input
                className="form-input mt-1 w-full"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="mobile-touch-target flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="form-checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />{' '}
              Active
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button className="btn-primary" disabled={saving || !name.trim()}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </DialogPanel>
      </div>
    </DialogPortal>
  );
}
