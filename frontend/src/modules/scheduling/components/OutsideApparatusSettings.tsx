/**
 * Outside Apparatus
 *
 * The departments members staff apparatus for, and the units at each. Members
 * pick from this list when they log a shift with another department, so the
 * apparatus summary on Scheduling Reports counts one unit once instead of
 * three spellings of it.
 *
 * Every change saves as it is made. A unit or department that shifts were
 * logged on cannot be deleted — the server answers 409 — because those shifts
 * would lose the record of where they were worked; turning it off hides it
 * from members instead and leaves the history intact.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { schedulingService } from '../services/api';
import type { ExternalAgency, ExternalApparatus } from '../services/api';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { PromptDialog } from '../../../components/ux/PromptDialog';
import { getErrorMessage, toAppError } from '../../../utils/errorHandling';

type RenameTarget = { kind: 'agency'; item: ExternalAgency } | { kind: 'apparatus'; item: ExternalApparatus };

interface ToggleProps {
  checked: boolean;
  label: string;
  disabled: boolean;
  onChange: () => void;
}

const ActiveToggle: React.FC<ToggleProps> = ({ checked, label, disabled, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={onChange}
    className="mobile-touch-target flex items-center justify-center"
  >
    <span className={`toggle-track-sm ${checked ? 'bg-violet-600' : 'bg-theme-surface-border'}`}>
      <span className={`toggle-knob-sm ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </span>
  </button>
);

const deleteMessage = (err: unknown, fallback: string): string =>
  toAppError(err).status === 409
    ? 'Shifts have been logged on it, so it stays on record. Turn it off to hide it from members instead.'
    : getErrorMessage(err, fallback);

export const OutsideApparatusSettings: React.FC = () => {
  const { confirm } = useConfirm();
  const [agencies, setAgencies] = useState<ExternalAgency[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newAgency, setNewAgency] = useState('');
  const [newUnit, setNewUnit] = useState<Record<string, { name: string; type: string }>>({});
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await schedulingService.getExternalAgencies();
      setAgencies(data.agencies);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load outside apparatus'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<unknown>, success: string, failure: string, isDelete = false) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await load();
      return true;
    } catch (err) {
      toast.error(isDelete ? deleteMessage(err, failure) : getErrorMessage(err, failure));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addAgency = async () => {
    const name = newAgency.trim();
    if (!name) return;
    if (await run(() => schedulingService.createExternalAgency({ name }), 'Department added', 'Failed to add')) {
      setNewAgency('');
    }
  };

  const addUnit = async (agency: ExternalAgency) => {
    const draft = newUnit[agency.id] ?? { name: '', type: '' };
    const name = draft.name.trim();
    if (!name) return;
    const added = await run(
      () =>
        schedulingService.createExternalApparatus(agency.id, {
          name,
          apparatus_type: draft.type.trim() || undefined,
        }),
      'Apparatus added',
      'Failed to add'
    );
    if (added) setNewUnit((prev) => ({ ...prev, [agency.id]: { name: '', type: '' } }));
  };

  const removeAgency = async (agency: ExternalAgency) => {
    const ok = await confirm({
      title: `Delete ${agency.name}?`,
      message: `${agency.name} and its ${agency.apparatus.length} apparatus will be removed from the list. This only works if no shifts have been logged on them; otherwise turn it off instead.`,
      confirmLabel: 'Delete department',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    await run(() => schedulingService.deleteExternalAgency(agency.id), 'Department deleted', 'Failed to delete', true);
  };

  const removeUnit = async (unit: ExternalApparatus) => {
    const ok = await confirm({
      title: `Delete ${unit.name}?`,
      message: `${unit.name} will be removed from the list. This only works if no shifts have been logged on it; otherwise turn it off instead.`,
      confirmLabel: 'Delete apparatus',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    await run(() => schedulingService.deleteExternalApparatus(unit.id), 'Apparatus deleted', 'Failed to delete', true);
  };

  const submitRename = async (name: string) => {
    const target = renaming;
    if (!target) return;
    const renamed = await run(
      () =>
        target.kind === 'agency'
          ? schedulingService.updateExternalAgency(target.item.id, { name })
          : schedulingService.updateExternalApparatus(target.item.id, { name }),
      'Renamed',
      'Failed to rename'
    );
    if (renamed) setRenaming(null);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-10" role="status" aria-label="Loading outside apparatus">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h3 className="text-theme-text-primary text-base font-semibold">Outside apparatus</h3>
        <p className="text-theme-text-muted mt-0.5 text-sm">
          The departments your members ride with, and their units. Members pick from this list when they log a shift
          with another department, and Scheduling Reports totals shifts and hours per unit from it. Turn an entry off to
          hide it from members; shifts already logged on it keep their record.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="new-outside-agency" className="form-label">
              Add a department
            </label>
            <input
              id="new-outside-agency"
              className="form-input"
              value={newAgency}
              maxLength={255}
              placeholder="e.g. Township Fire Company"
              disabled={busy}
              onChange={(e) => setNewAgency(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void addAgency();
                }
              }}
            />
          </div>
          <button
            type="button"
            className="btn-primary flex items-center gap-2"
            disabled={busy || !newAgency.trim()}
            onClick={() => void addAgency()}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add department
          </button>
        </div>
      </div>

      {agencies.length === 0 ? (
        <div className="card-secondary py-8 text-center">
          <p className="text-theme-text-muted text-sm">
            No outside departments yet. Until one is added, members can&apos;t log shifts with other departments.
          </p>
        </div>
      ) : (
        agencies.map((agency) => {
          const draft = newUnit[agency.id] ?? { name: '', type: '' };
          return (
            <section key={agency.id} className="card p-5" aria-label={agency.name}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="text-theme-text-primary font-semibold">
                    {agency.name}
                    {!agency.is_active && (
                      <span className="text-theme-text-muted ml-2 text-sm font-normal">(hidden from members)</span>
                    )}
                  </h4>
                </div>
                <div className="flex items-center gap-1">
                  <ActiveToggle
                    checked={agency.is_active}
                    label={`Offer ${agency.name} to members`}
                    disabled={busy}
                    onChange={() =>
                      void run(
                        () => schedulingService.updateExternalAgency(agency.id, { is_active: !agency.is_active }),
                        agency.is_active ? 'Department hidden' : 'Department offered',
                        'Failed to update'
                      )
                    }
                  />
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label={`Rename ${agency.name}`}
                    disabled={busy}
                    onClick={() => setRenaming({ kind: 'agency', item: agency })}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn-icon text-red-700 dark:text-red-400"
                    aria-label={`Delete ${agency.name}`}
                    disabled={busy}
                    onClick={() => void removeAgency(agency)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {agency.apparatus.length === 0 ? (
                <p className="text-theme-text-muted mt-3 text-sm">No apparatus yet.</p>
              ) : (
                <ul className="divide-theme-surface-border mt-3 divide-y">
                  {agency.apparatus.map((unit) => (
                    <li key={unit.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <p className="text-theme-text-primary min-w-0 text-sm">
                        <span className="font-medium">{unit.name}</span>
                        {unit.apparatus_type && (
                          <span className="text-theme-text-secondary"> · {unit.apparatus_type}</span>
                        )}
                        {!unit.is_active && <span className="text-theme-text-muted"> (hidden from members)</span>}
                      </p>
                      <div className="flex items-center gap-1">
                        <ActiveToggle
                          checked={unit.is_active}
                          label={`Offer ${unit.name} to members`}
                          disabled={busy}
                          onChange={() =>
                            void run(
                              () => schedulingService.updateExternalApparatus(unit.id, { is_active: !unit.is_active }),
                              unit.is_active ? 'Apparatus hidden' : 'Apparatus offered',
                              'Failed to update'
                            )
                          }
                        />
                        <button
                          type="button"
                          className="btn-icon"
                          aria-label={`Rename ${unit.name}`}
                          disabled={busy}
                          onClick={() => setRenaming({ kind: 'apparatus', item: unit })}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="btn-icon text-red-700 dark:text-red-400"
                          aria-label={`Delete ${unit.name}`}
                          disabled={busy}
                          onClick={() => void removeUnit(unit)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="border-theme-surface-border mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
                <div className="min-w-0 flex-1">
                  <label htmlFor={`new-unit-${agency.id}`} className="form-label">
                    Add apparatus
                  </label>
                  <input
                    id={`new-unit-${agency.id}`}
                    className="form-input"
                    value={draft.name}
                    maxLength={100}
                    placeholder="e.g. Engine 42"
                    disabled={busy}
                    onChange={(e) =>
                      setNewUnit((prev) => ({ ...prev, [agency.id]: { ...draft, name: e.target.value } }))
                    }
                  />
                </div>
                <div className="w-full sm:w-40">
                  <label htmlFor={`new-unit-type-${agency.id}`} className="form-label">
                    Type <span className="text-theme-text-muted font-normal">(optional)</span>
                  </label>
                  <input
                    id={`new-unit-type-${agency.id}`}
                    className="form-input"
                    value={draft.type}
                    maxLength={50}
                    placeholder="e.g. Engine"
                    disabled={busy}
                    onChange={(e) =>
                      setNewUnit((prev) => ({ ...prev, [agency.id]: { ...draft, type: e.target.value } }))
                    }
                  />
                </div>
                <button
                  type="button"
                  className="btn-secondary flex items-center gap-2"
                  disabled={busy || !draft.name.trim()}
                  onClick={() => void addUnit(agency)}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add
                </button>
              </div>
            </section>
          );
        })
      )}

      <PromptDialog
        isOpen={renaming !== null}
        onClose={() => setRenaming(null)}
        onSubmit={(name) => void submitRename(name)}
        title={renaming?.kind === 'agency' ? 'Rename department' : 'Rename apparatus'}
        message="Shifts already logged keep the name they were logged under; the summary shows the new one."
        label="Name"
        defaultValue={renaming?.item.name ?? ''}
        required
        confirmLabel="Rename"
        loading={busy}
      />
    </div>
  );
};

export default OutsideApparatusSettings;
