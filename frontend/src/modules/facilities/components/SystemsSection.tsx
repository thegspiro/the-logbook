/**
 * SystemsSection — Manage building systems for a facility.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Archive, Settings, Plus, Loader2, Pencil, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { facilitiesService } from '../../../services/api';
import type { FacilitySystemCreate } from '../../../services/facilitiesServices';
import type { FacilitySystem } from '../types';
import { enumLabel, SYSTEM_TYPES } from '../types';
import { inputCls, labelCls, CONDITION_OPTIONS, CONDITION_COLORS } from '../constants';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, isPastDate } from '../../../utils/dateFormatting';
import { formCoercions } from '../../../utils/formValues';
import { getErrorMessage } from '../../../utils/errorHandling';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { placeApiError, useFieldErrors, type FieldErrors, type FieldSpecs } from '../../../hooks/useFieldErrors';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { firstRefused, saveExceptRefused } from '../../../utils/saveExceptRefused';
import { useConfirm } from '../../../contexts/ConfirmContext';

const EMPTY_FORM = {
  name: '',
  system_type: 'other',
  description: '',
  manufacturer: '',
  model_number: '',
  serial_number: '',
  install_date: '',
  warranty_expiration: '',
  condition: 'good',
  notes: '',
  test_frequency_days: '',
};
type SystemForm = typeof EMPTY_FORM;
type SystemField = Exclude<keyof SystemForm, 'description'>;

// Ordered as on screen, so the first refusal takes focus. Limits mirror
// FacilitySystemBase.
const SYSTEM_FIELDS: FieldSpecs<SystemField> = {
  name: { id: 'facility-system-name', label: 'Name' },
  system_type: { id: 'facility-system-type', label: 'Type' },
  condition: { id: 'facility-system-condition', label: 'Condition' },
  manufacturer: { id: 'facility-system-manufacturer', label: 'Manufacturer' },
  model_number: { id: 'facility-system-model', label: 'Model number' },
  serial_number: { id: 'facility-system-serial', label: 'Serial number' },
  install_date: { id: 'facility-system-install', label: 'Install date' },
  warranty_expiration: { id: 'facility-system-warranty', label: 'Warranty expiration' },
  test_frequency_days: { id: 'facility-system-test-frequency', label: 'Test frequency (days)' },
  notes: { id: 'facility-system-notes', label: 'Notes' },
};
const SYSTEM_ORDER = Object.keys(SYSTEM_FIELDS) as SystemField[];
const SYSTEM_LIMITS = { name: 200, manufacturer: 200, model_number: 100, serial_number: 100 } as const;

interface Props {
  facilityId: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export default function SystemsSection({ facilityId, canCreate, canEdit, canDelete }: Props) {
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const [systems, setSystems] = useState<FacilitySystem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingSystem, setEditingSystem] = useState<FacilitySystem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<SystemForm>(EMPTY_FORM);
  // What the form held when it opened (or last saved), so Cancel asks before
  // throwing typed changes away (forms review F-6).
  const [baseline, setBaseline] = useState<SystemForm>(EMPTY_FORM);
  const systemErrors = useFieldErrors(SYSTEM_FIELDS);
  const set = (patch: Partial<SystemForm>) => {
    setFormData((p) => ({ ...p, ...patch }));
    for (const key of Object.keys(patch)) systemErrors.setError(key as SystemField, null);
  };

  const loadSystems = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await facilitiesService.getSystems({ facility_id: facilityId });
      setSystems(data);
    } catch {
      toast.error('Failed to load systems');
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void loadSystems();
  }, [loadSystems]);

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setBaseline(EMPTY_FORM);
    systemErrors.clear();
    setEditingSystem(null);
    setShowForm(false);
  };
  const requestCancel = useDiscardGuard({
    isDirty: showForm && JSON.stringify(formData) !== JSON.stringify(baseline),
    onClose: resetForm,
  });

  const openEdit = (sys: FacilitySystem) => {
    setEditingSystem(sys);
    const seeded: SystemForm = {
      name: sys.name || '',
      system_type: sys.systemType || 'other',
      description: sys.description || '',
      manufacturer: sys.manufacturer || '',
      model_number: sys.modelNumber || '',
      serial_number: sys.serialNumber || '',
      install_date: sys.installDate || '',
      warranty_expiration: sys.warrantyExpiration || '',
      condition: sys.condition || 'good',
      notes: sys.notes || '',
      test_frequency_days: sys.testFrequencyDays != null ? String(sys.testFrequencyDays) : '',
    };
    setFormData(seeded);
    setBaseline(seeded);
    systemErrors.clear();
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    // Named on the field rather than in a toast that vanished (forms review F-3).
    const problems: FieldErrors<SystemField> = {};
    if (!formData.name.trim()) problems.name = 'Enter a name for the system.';
    const freq = formData.test_frequency_days.trim();
    if (freq && !(Number.isInteger(Number(freq)) && Number(freq) >= 1))
      problems.test_frequency_days = 'Enter a whole number of days, 1 or more, or leave it empty.';
    systemErrors.setFormError(null);
    systemErrors.setErrors(problems);
    // A new system is not added until every field is fixed; an edit saves the
    // rest and keeps a refused field's stored value (owner rule, 2026-11-05).
    if (!editingSystem && Object.keys(problems).length > 0) {
      systemErrors.focusFirst(problems);
      return;
    }
    setIsSaving(true);
    try {
      // On edit, a cleared box is sent as null: the update endpoint treats an
      // omitted key as "keep the stored value".
      const { text, pick, num } = formCoercions(Boolean(editingSystem));
      const payload: FacilitySystemCreate = {
        facility_id: facilityId,
        name: formData.name.trim(),
        system_type: formData.system_type,
        condition: formData.condition,
        description: text(formData.description),
        manufacturer: text(formData.manufacturer),
        model_number: text(formData.model_number),
        serial_number: text(formData.serial_number),
        install_date: pick(formData.install_date),
        warranty_expiration: pick(formData.warranty_expiration),
        notes: text(formData.notes),
        test_frequency_days: num(formData.test_frequency_days),
      };

      if (editingSystem) {
        const { refused } = await saveExceptRefused<SystemField, unknown>({
          payload: { ...payload },
          refused: problems,
          send: (body) => facilitiesService.updateSystem(editingSystem.id, body),
          place: (err) => placeApiError(SYSTEM_FIELDS, err),
        });
        const first = firstRefused(SYSTEM_ORDER, refused);
        if (first) {
          // The list refreshes behind the form, which stays open with the
          // refused field flagged; only that field still counts as unsaved.
          void loadSystems();
          systemErrors.setErrors(refused);
          systemErrors.setFormError(
            `System saved, except ${SYSTEM_FIELDS[first].label.toLowerCase()}. Fix it and save again.`
          );
          systemErrors.focusFirst(refused);
          const keep = Object.fromEntries(Object.keys(refused).map((k) => [k, baseline[k as SystemField]]));
          setBaseline({ ...formData, ...keep });
          return;
        }
        toast.success('System updated');
      } else {
        await facilitiesService.createSystem(payload);
        toast.success('System added');
      }
      resetForm();
      void loadSystems();
    } catch (err: unknown) {
      // A refused field is flagged on that field (forms review F-2); anything
      // no field answers for is said in the form.
      const placed = systemErrors.setFromApiError(err, 'Failed to save system');
      systemErrors.focusFirst(placed);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (sys: FacilitySystem) => {
    if (
      !(await confirm({
        // The endpoint archives (`delete_system` sets is_active false and
        // stamps archived_at); the record and its history are kept.
        title: 'Archive system',
        message: `Archive "${sys.name}"? It leaves this facility's systems list, but its record and history are kept.`,
        confirmLabel: 'Archive',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    try {
      await facilitiesService.deleteSystem(sys.id);
      toast.success('System archived');
      void loadSystems();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to archive system'));
    }
  };

  return (
    <div className="card">
      <div className="border-theme-surface-border flex items-center justify-between border-b p-4">
        <h2 className="text-theme-text-primary text-sm font-semibold">
          Building Systems {!isLoading && `(${systems.length})`}
        </h2>
        {canCreate && (
          <button
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
          >
            <Plus className="h-3.5 w-3.5" /> Add System
          </button>
        )}
      </div>

      <div className="p-4">
        {showForm && (editingSystem ? canEdit : canCreate) && (
          <form
            onSubmit={(e) => void handleSave(e)}
            noValidate
            className="bg-theme-surface-hover/50 mb-5 space-y-3 rounded-lg p-4"
          >
            <h3 className="text-theme-text-primary text-sm font-medium">
              {editingSystem ? 'Edit System' : 'Add System'}
            </h3>
            {systemErrors.formError && (
              <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
                {systemErrors.formError}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <FormField
                id={SYSTEM_FIELDS.name.id}
                label="Name"
                required
                error={systemErrors.errors.name}
                labelClassName={labelCls}
                maxLength={SYSTEM_LIMITS.name}
                count={formData.name.length}
              >
                {(field) => (
                  <input
                    {...field}
                    type="text"
                    value={formData.name}
                    onChange={(e) => set({ name: e.target.value })}
                    placeholder="e.g., Main HVAC Unit"
                    className={inputCls}
                    autoFocus
                  />
                )}
              </FormField>
              <FormField
                id={SYSTEM_FIELDS.system_type.id}
                label="Type"
                error={systemErrors.errors.system_type}
                labelClassName={labelCls}
              >
                {(field) => (
                  <select
                    {...field}
                    value={formData.system_type}
                    onChange={(e) => set({ system_type: e.target.value })}
                    className={inputCls}
                  >
                    {SYSTEM_TYPES.map((st) => (
                      <option key={st} value={st}>
                        {enumLabel(st)}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              <FormField
                id={SYSTEM_FIELDS.condition.id}
                label="Condition"
                error={systemErrors.errors.condition}
                labelClassName={labelCls}
              >
                {(field) => (
                  <select
                    {...field}
                    value={formData.condition}
                    onChange={(e) => set({ condition: e.target.value })}
                    className={inputCls}
                  >
                    {CONDITION_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {enumLabel(c)}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              {(
                [
                  ['manufacturer', 'Manufacturer'],
                  ['model_number', 'Model Number'],
                  ['serial_number', 'Serial Number'],
                ] as const
              ).map(([key, label]) => (
                <FormField
                  key={key}
                  id={SYSTEM_FIELDS[key].id}
                  label={label}
                  error={systemErrors.errors[key]}
                  labelClassName={labelCls}
                  maxLength={SYSTEM_LIMITS[key]}
                  count={formData[key].length}
                >
                  {(field) => (
                    <input
                      {...field}
                      type="text"
                      value={formData[key]}
                      onChange={(e) => set({ [key]: e.target.value })}
                      className={inputCls}
                    />
                  )}
                </FormField>
              ))}
              {(
                [
                  ['install_date', 'Install Date'],
                  ['warranty_expiration', 'Warranty Expiration'],
                ] as const
              ).map(([key, label]) => (
                <FormField
                  key={key}
                  id={SYSTEM_FIELDS[key].id}
                  label={label}
                  error={systemErrors.errors[key]}
                  labelClassName={labelCls}
                >
                  {(field) => (
                    <input
                      {...field}
                      type="date"
                      value={formData[key]}
                      onChange={(e) => set({ [key]: e.target.value })}
                      className={inputCls}
                    />
                  )}
                </FormField>
              ))}
              <FormField
                id={SYSTEM_FIELDS.test_frequency_days.id}
                label="Test Frequency (days)"
                error={systemErrors.errors.test_frequency_days}
                labelClassName={labelCls}
              >
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    min={1}
                    step={1}
                    value={formData.test_frequency_days}
                    onChange={(e) => set({ test_frequency_days: e.target.value })}
                    className={inputCls}
                  />
                )}
              </FormField>
            </div>
            <FormField
              id={SYSTEM_FIELDS.notes.id}
              label="Notes"
              error={systemErrors.errors.notes}
              labelClassName={labelCls}
            >
              {(field) => (
                <textarea
                  {...field}
                  value={formData.notes}
                  onChange={(e) => set({ notes: e.target.value })}
                  rows={2}
                  className={inputCls + ' resize-none'}
                />
              )}
            </FormField>
            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={isSaving}
                className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {editingSystem ? 'Save Changes' : 'Save System'}
              </button>
              <button
                type="button"
                onClick={requestCancel}
                className="text-theme-text-muted hover:text-theme-text-primary touch:min-h-11 px-3 py-1.5 text-xs transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {isLoading ? (
          <div className="flex justify-center py-8" role="status" aria-live="polite">
            <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
          </div>
        ) : systems.length === 0 ? (
          <div className="py-8 text-center">
            <Settings className="text-theme-text-muted mx-auto mb-2 h-8 w-8" />
            <p className="text-theme-text-muted text-sm">No building systems recorded.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {systems.map((sys) => (
              <div
                key={sys.id}
                className="bg-theme-surface-hover/30 group flex items-center justify-between rounded-lg p-3"
              >
                <div className="flex items-center gap-3">
                  <Settings className="text-theme-text-muted h-4 w-4" />
                  <div>
                    <p className="text-theme-text-primary text-sm font-medium">{sys.name}</p>
                    <div className="text-theme-text-muted flex items-center gap-2 text-xs">
                      <span>{enumLabel(sys.systemType)}</span>
                      {sys.condition && (
                        <span className={`font-medium ${CONDITION_COLORS[sys.condition.toLowerCase()] || ''}`}>
                          {enumLabel(sys.condition)}
                        </span>
                      )}
                      {sys.manufacturer && <span>{sys.manufacturer}</span>}
                      {sys.warrantyExpiration && (
                        <span className={isPastDate(sys.warrantyExpiration) ? 'text-red-500' : ''}>
                          Warranty: {formatDate(sys.warrantyExpiration, tz)}
                        </span>
                      )}
                      {sys.testFrequencyDays != null && <span>Test every {sys.testFrequencyDays} days</span>}
                    </div>
                  </div>
                </div>
                {(canEdit || canDelete) && (
                  <div className="flex items-center gap-1 transition-opacity pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100">
                    {canEdit && (
                      <button
                        onClick={() => openEdit(sys)}
                        className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg p-1.5 transition-colors"
                        aria-label={`Edit ${sys.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        onClick={() => {
                          void handleDelete(sys);
                        }}
                        className="text-theme-text-muted rounded-lg p-1.5 transition-colors hover:bg-red-500/10 hover:text-red-500"
                        aria-label={`Archive ${sys.name}`}
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
