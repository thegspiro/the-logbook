import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSubmitGuard } from '@/hooks/useSubmitGuard';
import { facilitiesService } from '../../../services/api';
import type {
  AccessKeyCreate,
  CapitalProjectCreate,
  InsurancePolicyCreate,
  OccupantCreate,
  ShutoffLocationCreate,
  UtilityAccountCreate,
  UtilityReading,
} from '../../../services/facilitiesServices';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { placeApiError, useFieldErrors, type FieldErrors, type FieldSpecs } from '../../../hooks/useFieldErrors';
import { firstRefused, saveExceptRefused } from '../../../utils/saveExceptRefused';
import { inputCls, labelCls } from '../constants';
import { enumLabel } from '../types';
import { formatCalendarDate, formatCurrency, formatNumber } from '../../../utils/dateFormatting';
import { blankToNull, numberOrNull } from '../../../utils/formValues';

interface FieldDefinition {
  key: string;
  label: string;
  required?: boolean;
  type?: 'text' | 'date' | 'number' | 'select';
  options?: Array<{ value: string; label: string }>;
  /** The request key this box is sent as, when it differs from `key` (a refusal names it). */
  apiKey?: string;
  /** The column's max_length, mirrored from the facilities schema (forms review F-2). */
  maxLength?: number;
  /** For a number: the lowest value the server accepts. */
  min?: number;
  /** For a number: the column is an integer. */
  whole?: boolean;
}

const sameValues = (a: Record<string, string>, b: Record<string, string>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].every((key) => (a[key] ?? '') === (b[key] ?? ''));

/** What a record's form can tell before anything is sent. */
function checkValues(fields: FieldDefinition[], values: Record<string, string>): FieldErrors<string> {
  const problems: FieldErrors<string> = {};
  for (const field of fields) {
    const value = values[field.key]?.trim() ?? '';
    if (field.required && !value) {
      problems[field.key] = `${field.label} is required.`;
    } else if (field.type === 'number' && value) {
      const n = Number(value);
      if (!Number.isFinite(n) || (field.whole && !Number.isInteger(n)))
        problems[field.key] = field.whole ? 'Enter a whole number.' : 'Enter a number.';
      else if (field.min !== undefined && n < field.min) problems[field.key] = `Enter ${field.min} or more.`;
    }
  }
  return problems;
}

interface ResourceSectionProps<T extends { id: string }, U extends object> {
  title: string;
  /** One record, sentence case ("Utility account") — used in toasts, confirms and aria-labels. */
  itemName: string;
  emptyMessage: string;
  /** Create affordance — backend accepts facilities.create/edit/manage. */
  canCreate: boolean;
  /** Create/update affordances — backend accepts facilities.edit or facilities.manage. */
  canEdit: boolean;
  /** Delete affordance — backend accepts facilities.delete or facilities.manage. */
  canDelete: boolean;
  fields: FieldDefinition[];
  /** Must be referentially stable (useCallback) — the fetch effect keys on it. */
  load: () => Promise<T[]>;
  create: (values: Record<string, string>) => Promise<unknown>;
  /** The update body for the form's values, every key the form owns (Pitfall #1). */
  updatePayload: (values: Record<string, string>) => U;
  /** Sends an update, possibly without some of the payload's keys (the single-save rule). */
  update: (id: string, body: Partial<U>) => Promise<unknown>;
  toForm: (item: T) => Record<string, string>;
  remove: (id: string) => Promise<void>;
  /**
   * What the delete takes with it, when that is more than the record itself —
   * stated in the confirmation, ahead of "This cannot be undone."
   */
  deleteConsequence?: string;
  renderSummary: (item: T) => React.ReactNode;
}

function ResourceSection<T extends { id: string }, U extends object>({
  title,
  itemName,
  emptyMessage,
  canCreate,
  canEdit,
  canDelete,
  fields,
  load,
  create,
  updatePayload,
  update,
  toForm,
  remove,
  deleteConsequence,
  renderSummary,
}: ResourceSectionProps<T, U>) {
  const { confirm } = useConfirm();
  const idBase = useId();
  const [items, setItems] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  // What the form opened with, so closing it with typed changes asks first.
  const [initialValues, setInitialValues] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savedExcept, setSavedExcept] = useState<string | null>(null);

  // One field spec per box; a refusal names the request key, so that is the
  // key it answers for.
  const specs = useMemo(() => {
    const result: Record<string, { id: string; label: string; apiKeys: string[] }> = {};
    for (const field of fields) {
      result[field.key] = { id: `${idBase}-${field.key}`, label: field.label, apiKeys: [field.apiKey ?? field.key] };
    }
    const fieldSpecs: FieldSpecs<string> = result;
    return fieldSpecs;
  }, [fields, idBase]);
  const fieldErrors = useFieldErrors(specs);
  const fieldOrder = useMemo(() => fields.map((field) => field.key), [fields]);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      setItems(await load());
    } catch {
      toast.error(`Failed to load ${title.toLowerCase()}`);
    } finally {
      setIsLoading(false);
    }
  }, [load, title]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const isDirty = showForm && !sameValues(values, initialValues);

  const openForm = (id: string | null, startWith: Record<string, string>) => {
    setEditingId(id);
    setValues(startWith);
    setInitialValues(startWith);
    setSavedExcept(null);
    fieldErrors.clear();
    setShowForm(true);
  };

  const closeForm = () => {
    setEditingId(null);
    setValues({});
    setInitialValues({});
    setSavedExcept(null);
    fieldErrors.clear();
    setShowForm(false);
  };

  // Cancel throws away what was typed into the form (forms review F-6).
  const requestClose = useDiscardGuard({ isDirty, onClose: closeForm });

  const askToDiscard = () =>
    confirm({
      title: 'Discard your changes?',
      message: 'What you entered in this form has not been saved. Opening another record will lose it.',
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      variant: 'warning',
    });

  const handleSave = async () => {
    const problems = checkValues(fields, values);
    setSavedExcept(null);
    fieldErrors.setFormError(null);
    fieldErrors.setErrors(problems);
    // A new record is added only once every flagged box is fixed.
    if (!editingId && Object.keys(problems).length > 0) {
      fieldErrors.focusFirst(problems);
      return;
    }
    setIsSaving(true);
    try {
      if (editingId) {
        // An edit follows the single-save rule (owner, 2026-11-05): a flagged
        // box is left out and keeps its stored value, the rest is written.
        const apiKeyFor = (key: string) => fields.find((field) => field.key === key)?.apiKey ?? key;
        const { refused } = await saveExceptRefused<string, unknown>({
          payload: Object.fromEntries(Object.entries(updatePayload(values))),
          refused: problems,
          keysFor: (key) => [apiKeyFor(key)],
          // The body is the payload with some keys left out.
          send: (body) => update(editingId, body as Partial<U>),
          place: (err) => placeApiError(specs, err),
        });
        const first = firstRefused(fieldOrder, refused);
        if (first) {
          fieldErrors.setErrors(refused);
          setInitialValues((prev) => {
            const next = { ...values };
            for (const key of Object.keys(refused)) next[key] = prev[key] ?? '';
            return next;
          });
          setSavedExcept(
            `${itemName} saved, except ${(specs[first]?.label ?? first).toLowerCase()}. Fix it and save again.`
          );
          fieldErrors.focusFirst(refused);
          await reload();
          return;
        }
      } else {
        await create(values);
      }
      toast.success(`${itemName} ${editingId ? 'updated' : 'added'}`);
      closeForm();
      await reload();
    } catch (err: unknown) {
      // Nothing was saved. A refusal lands on the box it names; anything no
      // box answers for is said in the form, beside Save, not in a toast.
      fieldErrors.focusFirst(fieldErrors.setFromApiError(err, `Failed to save ${itemName.toLowerCase()}`));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (item: T) => {
    const accepted = await confirm({
      title: `Delete ${itemName.toLowerCase()}`,
      message: deleteConsequence ? `${deleteConsequence} This cannot be undone.` : 'This cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!accepted) return;
    try {
      await remove(item.id);
      await reload();
    } catch {
      toast.error(`Failed to delete ${itemName.toLowerCase()}`);
    }
  };

  return (
    <section className="card">
      <header className="border-theme-surface-border flex items-center justify-between border-b p-4">
        <h2 className="text-theme-text-primary text-sm font-semibold">
          {title} {!isLoading && `(${items.length})`}
        </h2>
        {canCreate && (
          <button
            type="button"
            onClick={() => {
              if (showForm) requestClose();
              else openForm(null, {});
            }}
            className="touch:min-h-11 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-red-600 hover:bg-red-500/10 dark:text-red-400"
          >
            {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showForm ? 'Cancel' : 'Add'}
          </button>
        )}
      </header>

      <div className="p-4">
        {showForm && (editingId ? canEdit : canCreate) && (
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
            className="bg-theme-surface-hover/50 mb-5 grid grid-cols-1 gap-3 rounded-lg p-4 sm:grid-cols-2"
          >
            {fields.map((field) => {
              const value = values[field.key] ?? '';
              const setValue = (next: string) => {
                setValues((current) => ({ ...current, [field.key]: next }));
                fieldErrors.setError(field.key, null);
              };
              return (
                <FormField
                  key={field.key}
                  id={specs[field.key]?.id}
                  label={field.label}
                  labelClassName={labelCls}
                  required={field.required}
                  error={fieldErrors.errors[field.key]}
                  className="min-w-0"
                  {...(field.maxLength !== undefined ? { maxLength: field.maxLength, count: value.length } : {})}
                >
                  {(props) =>
                    field.type === 'select' ? (
                      <select
                        {...props}
                        className={`${inputCls} w-full min-w-0`}
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                      >
                        <option value="">Select...</option>
                        {field.options?.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        {...props}
                        className={`${inputCls} w-full min-w-0`}
                        type={field.type ?? 'text'}
                        {...(field.type === 'number' && field.min !== undefined ? { min: field.min } : {})}
                        {...(field.type === 'number' && !field.whole ? { step: 'any' } : {})}
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                      />
                    )
                  }
                </FormField>
              );
            })}
            {(savedExcept || fieldErrors.formError) && (
              <div className="sm:col-span-2">
                {savedExcept && (
                  <p role="status" className={`text-sm font-medium ${FIELD_ERROR_CLASS}`}>
                    {savedExcept}
                  </p>
                )}
                {fieldErrors.formError && (
                  <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
                    {fieldErrors.formError}
                  </p>
                )}
              </div>
            )}
            <div className="flex items-end">
              <button type="submit" disabled={isSaving} className="btn-primary w-full">
                {isSaving ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Save'}
              </button>
            </div>
          </form>
        )}

        {isLoading ? (
          <Loader2 className="text-theme-text-muted mx-auto my-8 h-6 w-6 animate-spin" />
        ) : items.length === 0 ? (
          <p className="text-theme-text-muted py-8 text-center text-sm">{emptyMessage}</p>
        ) : (
          <div className="divide-theme-surface-border divide-y">
            {items.map((item) => (
              <div key={item.id} className="group flex items-center justify-between gap-4 py-3">
                <div className="min-w-0 flex-1">{renderSummary(item)}</div>
                {(canEdit || canDelete) && (
                  <div className="flex items-center gap-1">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => {
                          void (async () => {
                            if (isDirty && !(await askToDiscard())) return;
                            openForm(item.id, toForm(item));
                          })();
                        }}
                        className="text-theme-text-muted hover:bg-theme-surface-hover touch:min-h-11 touch:min-w-11 rounded-lg p-2"
                        aria-label={`Edit ${itemName.toLowerCase()}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(item)}
                        className="text-theme-text-muted touch:min-h-11 touch:min-w-11 rounded-lg p-2 hover:bg-red-500/10 hover:text-red-500"
                        aria-label={`Delete ${itemName.toLowerCase()}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

const text = (value?: string | number) => value || '—';
const numberValue = (value?: string) => (value ? Number(value) : undefined);
const options = (values: string[]) => values.map((value) => ({ value, label: enumLabel(value) }));

const UTILITY_TYPES = options(['electric', 'gas', 'water', 'sewer', 'internet', 'phone', 'trash', 'other']);
const KEY_TYPES = options(['physical_key', 'fob', 'access_code', 'key_card', 'biometric', 'combination', 'other']);
const SHUTOFF_TYPES = options([
  'water_main',
  'gas_main',
  'electrical_main',
  'fire_suppression',
  'hvac',
  'irrigation',
  'other',
]);
const PROJECT_TYPES = options([
  'renovation',
  'new_construction',
  'repair',
  'upgrade',
  'expansion',
  'demolition',
  'environmental',
  'ada_compliance',
  'other',
]);
const PROJECT_STATUSES = options([
  'planning',
  'approved',
  'bidding',
  'in_progress',
  'on_hold',
  'completed',
  'cancelled',
]);
const POLICY_TYPES = options([
  'property',
  'liability',
  'flood',
  'earthquake',
  'workers_comp',
  'umbrella',
  'equipment',
  'other',
]);

interface SectionProps {
  facilityId: string;
  /** facilities.delete or facilities.manage — delete affordances. */
  canDelete: boolean;
  /** facilities.create, facilities.edit, or facilities.manage — create affordances. */
  canCreate: boolean;
  /** facilities.edit or facilities.manage — update affordances (mirrors backend gates). */
  canEdit: boolean;
}

type ReadingField = 'readingDate' | 'amount' | 'usage';

function UtilityReadings({ accountId, canEdit }: { accountId: string; canEdit: boolean }) {
  const idBase = useId();
  const [readings, setReadings] = useState<UtilityReading[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [readingDate, setReadingDate] = useState('');
  const { busy, run } = useSubmitGuard();
  const [amount, setAmount] = useState('');
  const [usage, setUsage] = useState('');
  // FacilityUtilityReadingCreate: the request keys a refusal names.
  const readingFields = useMemo<FieldSpecs<ReadingField>>(
    () => ({
      readingDate: { id: `${idBase}-date`, label: 'Reading date', apiKeys: ['reading_date'] },
      amount: { id: `${idBase}-amount`, label: 'Bill amount' },
      usage: { id: `${idBase}-usage`, label: 'Usage quantity', apiKeys: ['usage_quantity'] },
    }),
    [idBase]
  );
  const readingErrors = useFieldErrors(readingFields);

  const loadReadings = useCallback(async () => {
    try {
      setReadings(await facilitiesService.getUtilityReadings(accountId, { limit: 12 }));
    } catch {
      setReadings([]);
    }
  }, [accountId]);

  useEffect(() => {
    void loadReadings();
  }, [loadReadings]);

  const closeForm = () => {
    setReadingDate('');
    setAmount('');
    setUsage('');
    readingErrors.clear();
    setShowForm(false);
  };
  const requestClose = useDiscardGuard({
    isDirty: showForm && (readingDate !== '' || amount !== '' || usage !== ''),
    onClose: closeForm,
  });

  const addReading = () =>
    run(async () => {
      // A reading is recorded only once it has a date and its numbers are
      // numbers: said on the box, not in a toast (forms review F-3).
      const problems: FieldErrors<ReadingField> = {};
      if (!readingDate) problems.readingDate = 'Reading date is required.';
      if (amount && !(Number(amount) >= 0)) problems.amount = 'Enter an amount, 0 or more.';
      if (usage && !Number.isFinite(Number(usage))) problems.usage = 'Enter a number.';
      readingErrors.setFormError(null);
      readingErrors.setErrors(problems);
      if (Object.keys(problems).length > 0) {
        readingErrors.focusFirst(problems);
        return;
      }
      try {
        await facilitiesService.createUtilityReading(accountId, {
          utility_account_id: accountId,
          reading_date: readingDate,
          ...(amount ? { amount: Number(amount) } : {}),
          ...(usage ? { usage_quantity: Number(usage) } : {}),
        });
      } catch (err: unknown) {
        readingErrors.focusFirst(readingErrors.setFromApiError(err, 'Failed to add reading'));
        return;
      }
      closeForm();
      await loadReadings();
    });

  // The API returns newest-first, but the order is a display guarantee here,
  // so it is not left to the server.
  const sortedReadings = [...readings].sort((a, b) => b.readingDate.localeCompare(a.readingDate));

  const readingInput = (
    field: ReadingField,
    value: string,
    setValue: (value: string) => void,
    extra: { type: 'date' | 'number'; placeholder?: string; min?: number }
  ) => (
    <FormField
      id={readingFields[field].id}
      label={readingFields[field].label}
      labelClassName={labelCls}
      required={field === 'readingDate'}
      error={readingErrors.errors[field]}
      className="min-w-0"
    >
      {(props) => (
        <input
          {...props}
          type={extra.type}
          className={`${inputCls} w-full min-w-0`}
          {...(extra.placeholder ? { placeholder: extra.placeholder } : {})}
          {...(extra.min !== undefined ? { min: extra.min } : {})}
          {...(extra.type === 'number' ? { step: 'any' } : {})}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            readingErrors.setError(field, null);
          }}
        />
      )}
    </FormField>
  );

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-theme-text-muted">
          {readings.length ? `${readings.length} recent reading${readings.length === 1 ? '' : 's'}` : 'No readings'}
        </span>
        {canEdit && (
          <button
            type="button"
            onClick={() => (showForm ? requestClose() : setShowForm(true))}
            className="touch:min-h-11 text-red-600 dark:text-red-400"
          >
            {showForm ? 'Cancel' : 'Add reading'}
          </button>
        )}
      </div>
      {sortedReadings.length > 0 && (
        <ul className="border-theme-surface-border divide-theme-surface-border mt-2 divide-y rounded-lg border">
          {sortedReadings.map((reading) => (
            <li key={reading.id} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
              {/* reading_date is a backend `date` (calendar date) — the
                  non-shifting formatter keeps it on the day that was entered */}
              <span className="text-theme-text-secondary">{formatCalendarDate(reading.readingDate)}</span>
              <span className="text-theme-text-muted">
                {reading.usageQuantity != null
                  ? `${formatNumber(reading.usageQuantity)}${reading.usageUnit ? ` ${reading.usageUnit}` : ''}`
                  : '—'}
              </span>
              <span className="text-theme-text-primary">
                {reading.amount != null ? formatCurrency(reading.amount) : '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {showForm && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void addReading();
          }}
          className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3"
          onClick={(event) => event.stopPropagation()}
        >
          {readingInput('readingDate', readingDate, setReadingDate, { type: 'date' })}
          {readingInput('amount', amount, setAmount, { type: 'number', placeholder: 'Amount', min: 0 })}
          {readingInput('usage', usage, setUsage, { type: 'number', placeholder: 'Usage' })}
          {readingErrors.formError && (
            <p role="alert" className={`text-xs sm:col-span-3 ${FIELD_ERROR_CLASS}`}>
              {readingErrors.formError}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="btn-primary py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-3"
          >
            {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Save reading'}
          </button>
        </form>
      )}
    </div>
  );
}

export function UtilitiesSection({ facilityId, canDelete, canCreate, canEdit }: SectionProps) {
  // Stable per facilityId — an inline closure would re-trigger the section's
  // fetch effect on every completed request (infinite refetch loop).
  const load = useCallback(() => facilitiesService.getUtilityAccounts({ facility_id: facilityId }), [facilityId]);
  return (
    <ResourceSection
      title="Utilities"
      itemName="Utility account"
      emptyMessage="No utility accounts have been added."
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
      load={load}
      create={(v) =>
        facilitiesService.createUtilityAccount({
          facility_id: facilityId,
          utility_type: v.utility_type,
          provider_name: v.provider_name,
          account_number: v.account_number || undefined,
          meter_number: v.meter_number || undefined,
        } as UtilityAccountCreate)
      }
      updatePayload={(v) => ({
        utility_type: v.utility_type,
        provider_name: v.provider_name,
        account_number: blankToNull(v.account_number),
        meter_number: blankToNull(v.meter_number),
      })}
      update={(id, body) => facilitiesService.updateUtilityAccount(id, body)}
      toForm={(item) => ({
        utility_type: item.utilityType,
        provider_name: item.providerName,
        account_number: item.accountNumber ?? '',
        meter_number: item.meterNumber ?? '',
      })}
      remove={(id) => facilitiesService.deleteUtilityAccount(id)}
      // facility_utility_readings cascade on the account's delete.
      deleteConsequence="Its meter readings are deleted with it."
      fields={[
        { key: 'utility_type', label: 'Utility type', required: true, type: 'select', options: UTILITY_TYPES },
        { key: 'provider_name', label: 'Provider', required: true, maxLength: 200 },
        { key: 'account_number', label: 'Account number', maxLength: 100 },
        { key: 'meter_number', label: 'Meter number', maxLength: 100 },
      ]}
      renderSummary={(item) => (
        <>
          <p className="text-theme-text-primary text-sm font-medium">{enumLabel(item.utilityType)}</p>
          <p className="text-theme-text-muted text-xs">
            {text(item.providerName)} · Account {text(item.accountNumber)}
          </p>
          <UtilityReadings accountId={item.id} canEdit={canCreate || canEdit} />
        </>
      )}
    />
  );
}

export function AccessKeysSection({ facilityId, canDelete, canCreate, canEdit }: SectionProps) {
  const load = useCallback(() => facilitiesService.getAccessKeys({ facility_id: facilityId }), [facilityId]);
  return (
    <ResourceSection
      title="Access Keys"
      itemName="Access key"
      emptyMessage="No keys or credentials are tracked."
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
      load={load}
      create={(v) =>
        facilitiesService.createAccessKey({
          facility_id: facilityId,
          key_type: v.key_type,
          key_identifier: v.key_identifier || undefined,
          description: v.description || undefined,
          assigned_to_name: v.assigned_to_name || undefined,
        } as AccessKeyCreate)
      }
      updatePayload={(v) => ({
        key_type: v.key_type,
        key_identifier: blankToNull(v.key_identifier),
        description: blankToNull(v.description),
        assigned_to_name: blankToNull(v.assigned_to_name),
      })}
      update={(id, body) => facilitiesService.updateAccessKey(id, body)}
      toForm={(item) => ({
        key_type: item.keyType,
        key_identifier: item.keyIdentifier ?? '',
        description: item.description ?? '',
        assigned_to_name: item.assignedToName ?? '',
      })}
      remove={(id) => facilitiesService.deleteAccessKey(id)}
      fields={[
        { key: 'key_type', label: 'Key type', required: true, type: 'select', options: KEY_TYPES },
        { key: 'key_identifier', label: 'Identifier', maxLength: 100 },
        { key: 'assigned_to_name', label: 'Assigned to', maxLength: 200 },
        { key: 'description', label: 'Description', maxLength: 300 },
      ]}
      renderSummary={(item) => (
        <>
          <p className="text-theme-text-primary text-sm font-medium">
            {enumLabel(item.keyType)} · {text(item.keyIdentifier)}
          </p>
          <p className="text-theme-text-muted text-xs">
            {item.assignedToName ? `Assigned to ${item.assignedToName}` : 'Unassigned'}
          </p>
        </>
      )}
    />
  );
}

export function ShutoffsSection({ facilityId, canDelete, canCreate, canEdit }: SectionProps) {
  const load = useCallback(() => facilitiesService.getShutoffLocations({ facility_id: facilityId }), [facilityId]);
  return (
    <ResourceSection
      title="Shutoff Locations"
      itemName="Shutoff location"
      emptyMessage="No utility shutoffs are documented."
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
      load={load}
      create={(v) =>
        facilitiesService.createShutoffLocation({
          facility_id: facilityId,
          shutoff_type: v.shutoff_type,
          location_description: v.location_description,
          floor: numberValue(v.floor),
        } as ShutoffLocationCreate)
      }
      updatePayload={(v) => ({
        shutoff_type: v.shutoff_type,
        location_description: v.location_description,
        // Explicit null so a cleared floor persists (Pitfall #1 update rule)
        floor: numberOrNull(v.floor),
      })}
      update={(id, body) => facilitiesService.updateShutoffLocation(id, body)}
      toForm={(item) => ({
        shutoff_type: item.shutoffType,
        location_description: item.locationDescription ?? '',
        floor: item.floor?.toString() ?? '',
      })}
      remove={(id) => facilitiesService.deleteShutoffLocation(id)}
      fields={[
        { key: 'shutoff_type', label: 'Shutoff type', required: true, type: 'select', options: SHUTOFF_TYPES },
        { key: 'location_description', label: 'Location', required: true },
        // A basement is a negative floor, so there is no lower bound.
        { key: 'floor', label: 'Floor', type: 'number', whole: true },
      ]}
      renderSummary={(item) => (
        <>
          <p className="text-theme-text-primary text-sm font-medium">{enumLabel(item.shutoffType)}</p>
          <p className="text-theme-text-muted text-xs">
            {text(item.locationDescription)}
            {item.floor != null ? ` · Floor ${item.floor}` : ''}
          </p>
        </>
      )}
    />
  );
}

export function CapitalProjectsSection({ facilityId, canDelete, canCreate, canEdit }: SectionProps) {
  const load = useCallback(() => facilitiesService.getCapitalProjects({ facility_id: facilityId }), [facilityId]);
  return (
    <ResourceSection
      title="Capital Projects"
      itemName="Capital project"
      emptyMessage="No capital projects are tracked."
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
      load={load}
      create={(v) =>
        facilitiesService.createCapitalProject({
          facility_id: facilityId,
          project_type: v.project_type,
          project_name: v.name,
          project_status: v.status || 'planning',
          estimated_cost: numberValue(v.estimated_budget),
          // Blank date must be omitted on create — '' fails Pydantic date parsing
          start_date: v.start_date || undefined,
        } as CapitalProjectCreate)
      }
      updatePayload={(v) => ({
        project_name: v.name,
        project_type: v.project_type,
        // Status is a non-nullable enum server-side — omit rather than clear
        project_status: v.status || undefined,
        // Explicit nulls so cleared fields persist (Pitfall #1 update rule)
        estimated_cost: numberOrNull(v.estimated_budget),
        start_date: blankToNull(v.start_date),
      })}
      update={(id, body) => facilitiesService.updateCapitalProject(id, body)}
      toForm={(item) => ({
        name: item.projectName,
        project_type: item.projectType,
        status: item.projectStatus,
        estimated_budget: item.estimatedCost?.toString() ?? '',
        start_date: item.startDate ?? '',
      })}
      remove={(id) => facilitiesService.deleteCapitalProject(id)}
      fields={[
        { key: 'name', label: 'Project name', required: true, apiKey: 'project_name', maxLength: 300 },
        { key: 'project_type', label: 'Project type', required: true, type: 'select', options: PROJECT_TYPES },
        { key: 'status', label: 'Status', type: 'select', options: PROJECT_STATUSES, apiKey: 'project_status' },
        { key: 'estimated_budget', label: 'Estimated budget', type: 'number', apiKey: 'estimated_cost', min: 0 },
        { key: 'start_date', label: 'Start date', type: 'date' },
      ]}
      renderSummary={(item) => (
        <>
          <p className="text-theme-text-primary text-sm font-medium">{item.projectName}</p>
          <p className="text-theme-text-muted text-xs">
            {enumLabel(item.projectType)} · {enumLabel(item.projectStatus)}
            {item.estimatedCost != null ? ` · $${formatNumber(item.estimatedCost)}` : ''}
          </p>
        </>
      )}
    />
  );
}

export function InsuranceSection({ facilityId, canDelete, canCreate, canEdit }: SectionProps) {
  const load = useCallback(() => facilitiesService.getInsurancePolicies({ facility_id: facilityId }), [facilityId]);
  return (
    <ResourceSection
      title="Insurance"
      itemName="Insurance policy"
      emptyMessage="No insurance policies are tracked."
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
      load={load}
      create={(v) =>
        facilitiesService.createInsurancePolicy({
          facility_id: facilityId,
          policy_type: v.policy_type,
          policy_number: v.policy_number || undefined,
          carrier_name: v.provider,
          coverage_amount: numberValue(v.coverage_amount),
          // Blank date must be omitted on create — '' fails Pydantic date parsing
          expiration_date: v.expiration_date || undefined,
        } as InsurancePolicyCreate)
      }
      updatePayload={(v) => ({
        policy_type: v.policy_type,
        policy_number: blankToNull(v.policy_number),
        carrier_name: v.provider,
        // Explicit nulls so cleared fields persist (Pitfall #1 update rule)
        coverage_amount: numberOrNull(v.coverage_amount),
        expiration_date: blankToNull(v.expiration_date),
      })}
      update={(id, body) => facilitiesService.updateInsurancePolicy(id, body)}
      toForm={(item) => ({
        policy_type: item.policyType,
        policy_number: item.policyNumber ?? '',
        provider: item.carrierName,
        coverage_amount: item.coverageAmount?.toString() ?? '',
        expiration_date: item.expirationDate ?? '',
      })}
      remove={(id) => facilitiesService.deleteInsurancePolicy(id)}
      fields={[
        { key: 'policy_type', label: 'Policy type', required: true, type: 'select', options: POLICY_TYPES },
        { key: 'policy_number', label: 'Policy number', maxLength: 100 },
        { key: 'provider', label: 'Carrier', required: true, apiKey: 'carrier_name', maxLength: 200 },
        { key: 'coverage_amount', label: 'Coverage amount', type: 'number', min: 0 },
        { key: 'expiration_date', label: 'Expiration date', type: 'date' },
      ]}
      renderSummary={(item) => (
        <>
          <p className="text-theme-text-primary text-sm font-medium">
            {enumLabel(item.policyType)} · {text(item.policyNumber)}
          </p>
          <p className="text-theme-text-muted text-xs">
            {text(item.carrierName)}
            {item.expirationDate ? ` · Expires ${formatCalendarDate(item.expirationDate)}` : ''}
          </p>
        </>
      )}
    />
  );
}

export function OccupantsSection({ facilityId, canDelete, canCreate, canEdit }: SectionProps) {
  const load = useCallback(() => facilitiesService.getOccupants({ facility_id: facilityId }), [facilityId]);
  return (
    <ResourceSection
      title="Occupants"
      itemName="Occupant"
      emptyMessage="No occupants or units are assigned."
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
      load={load}
      create={(v) =>
        facilitiesService.createOccupant({
          facility_id: facilityId,
          unit_name: v.name,
          description: v.occupant_type || undefined,
          // Blank date must be omitted on create — '' fails Pydantic date parsing
          effective_date: v.start_date || undefined,
        } as OccupantCreate)
      }
      updatePayload={(v) => ({
        unit_name: v.name,
        description: blankToNull(v.occupant_type),
        // Explicit null so a cleared date persists (Pitfall #1 update rule)
        effective_date: blankToNull(v.start_date),
      })}
      update={(id, body) => facilitiesService.updateOccupant(id, body)}
      toForm={(item) => ({
        name: item.unitName,
        occupant_type: item.description ?? '',
        start_date: item.effectiveDate ?? '',
      })}
      remove={(id) => facilitiesService.deleteOccupant(id)}
      fields={[
        { key: 'name', label: 'Name', required: true, apiKey: 'unit_name', maxLength: 200 },
        { key: 'occupant_type', label: 'Occupant type', apiKey: 'description' },
        { key: 'start_date', label: 'Start date', type: 'date', apiKey: 'effective_date' },
      ]}
      renderSummary={(item) => (
        <>
          <p className="text-theme-text-primary text-sm font-medium">{text(item.unitName)}</p>
          <p className="text-theme-text-muted text-xs">
            {item.description || 'Occupant'}
            {item.effectiveDate ? ` · Since ${formatCalendarDate(item.effectiveDate)}` : ''}
          </p>
        </>
      )}
    />
  );
}
