import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { facilitiesService } from '../../../services/api';
import type {
  AccessKey,
  AccessKeyCreate,
  CapitalProject,
  CapitalProjectCreate,
  InsurancePolicy,
  InsurancePolicyCreate,
  Occupant,
  OccupantCreate,
  ShutoffLocation,
  ShutoffLocationCreate,
  UtilityAccount,
  UtilityAccountCreate,
  UtilityReading,
} from '../../../services/facilitiesServices';
import { useConfirm } from '../../../contexts/ConfirmContext';
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
}

interface ResourceSectionProps<T extends { id: string }> {
  title: string;
  emptyMessage: string;
  /** Create/update affordances — backend accepts facilities.edit or facilities.manage. */
  canEdit: boolean;
  /** Delete affordance — backend accepts facilities.manage only. */
  canDelete: boolean;
  fields: FieldDefinition[];
  /** Must be referentially stable (useCallback) — the fetch effect keys on it. */
  load: () => Promise<T[]>;
  create: (values: Record<string, string>) => Promise<unknown>;
  update: (id: string, values: Record<string, string>) => Promise<unknown>;
  toForm: (item: T) => Record<string, string>;
  remove: (id: string) => Promise<void>;
  renderSummary: (item: T) => React.ReactNode;
}

function ResourceSection<T extends { id: string }>({
  title,
  emptyMessage,
  canEdit,
  canDelete,
  fields,
  load,
  create,
  update,
  toForm,
  remove,
  renderSummary,
}: ResourceSectionProps<T>) {
  const { confirm } = useConfirm();
  const [items, setItems] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

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

  const handleCreate = async () => {
    const missing = fields.find((field) => field.required && !values[field.key]?.trim());
    if (missing) {
      toast.error(`${missing.label} is required`);
      return;
    }
    setIsSaving(true);
    try {
      if (editingId) await update(editingId, values);
      else await create(values);
      setValues({});
      setEditingId(null);
      setShowForm(false);
      toast.success(`${title.replace(/s$/, '')} ${editingId ? 'updated' : 'added'}`);
      await reload();
    } catch {
      toast.error(`Failed to add ${title.toLowerCase().replace(/s$/, '')}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (item: T) => {
    const accepted = await confirm({
      title: `Delete ${title.replace(/s$/, '').toLowerCase()}`,
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!accepted) return;
    try {
      await remove(item.id);
      await reload();
    } catch {
      toast.error(`Failed to delete ${title.toLowerCase().replace(/s$/, '')}`);
    }
  };

  return (
    <section className="bg-theme-surface border-theme-surface-border rounded-xl border">
      <header className="border-theme-surface-border flex items-center justify-between border-b p-5">
        <h2 className="text-theme-text-primary text-sm font-semibold">
          {title} {!isLoading && `(${items.length})`}
        </h2>
        {canEdit && (
          <button
            onClick={() => {
              setEditingId(null);
              setValues({});
              setShowForm((visible) => !visible);
            }}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-red-600 hover:bg-red-500/10 dark:text-red-400"
          >
            {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showForm ? 'Cancel' : 'Add'}
          </button>
        )}
      </header>

      <div className="p-5">
        {canEdit && showForm && (
          <div className="bg-theme-surface-hover/50 mb-5 grid grid-cols-1 gap-3 rounded-lg p-4 sm:grid-cols-2">
            {fields.map((field) => (
              <div key={field.key}>
                <label className={labelCls}>
                  {field.label} {field.required ? '*' : ''}
                </label>
                {field.type === 'select' ? (
                  <select
                    className={inputCls}
                    value={values[field.key] ?? ''}
                    onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
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
                    className={inputCls}
                    type={field.type ?? 'text'}
                    value={values[field.key] ?? ''}
                    onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                  />
                )}
              </div>
            ))}
            <div className="flex items-end">
              <button onClick={() => void handleCreate()} disabled={isSaving} className="btn-primary w-full">
                {isSaving ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Save'}
              </button>
            </div>
          </div>
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
                        onClick={() => {
                          setEditingId(item.id);
                          setValues(toForm(item));
                          setShowForm(true);
                        }}
                        className="text-theme-text-muted hover:bg-theme-surface-hover rounded-lg p-2"
                        aria-label={`Edit ${title.replace(/s$/, '').toLowerCase()}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        onClick={() => void handleDelete(item)}
                        className="text-theme-text-muted rounded-lg p-2 hover:bg-red-500/10 hover:text-red-500"
                        aria-label={`Delete ${title.replace(/s$/, '').toLowerCase()}`}
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
  /** facilities.manage — delete affordances. */
  canManage: boolean;
  /** facilities.edit or facilities.manage — create/update affordances (mirrors backend gates). */
  canEdit: boolean;
}

function UtilityReadings({ accountId, canEdit }: { accountId: string; canEdit: boolean }) {
  const [readings, setReadings] = useState<UtilityReading[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [readingDate, setReadingDate] = useState('');
  const [amount, setAmount] = useState('');
  const [usage, setUsage] = useState('');

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

  const addReading = async () => {
    if (!readingDate) {
      toast.error('Reading date is required');
      return;
    }
    // No server-side uniqueness constraint — a double-click would file the
    // same reading twice, so the guard has to live here.
    if (isSaving) return;
    setIsSaving(true);
    try {
      await facilitiesService.createUtilityReading(accountId, {
        utility_account_id: accountId,
        reading_date: readingDate,
        ...(amount ? { amount: Number(amount) } : {}),
        ...(usage ? { usage_quantity: Number(usage) } : {}),
      });
    } catch {
      toast.error('Failed to add reading');
      return;
    } finally {
      setIsSaving(false);
    }
    setReadingDate('');
    setAmount('');
    setUsage('');
    setShowForm(false);
    await loadReadings();
  };

  // The API returns newest-first, but the order is a display guarantee here,
  // so it is not left to the server.
  const sortedReadings = [...readings].sort((a, b) => b.readingDate.localeCompare(a.readingDate));

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-theme-text-muted">
          {readings.length ? `${readings.length} recent readings` : 'No readings'}
        </span>
        {canEdit && (
          <button onClick={() => setShowForm((value) => !value)} className="text-red-600 dark:text-red-400">
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
        <div className="mt-2 grid grid-cols-3 gap-2" onClick={(event) => event.stopPropagation()}>
          <input
            aria-label="Reading date"
            type="date"
            className={inputCls}
            value={readingDate}
            onChange={(event) => setReadingDate(event.target.value)}
          />
          <input
            aria-label="Bill amount"
            type="number"
            className={inputCls}
            placeholder="Amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <input
            aria-label="Usage quantity"
            type="number"
            className={inputCls}
            placeholder="Usage"
            value={usage}
            onChange={(event) => setUsage(event.target.value)}
          />
          <button
            className="btn-primary col-span-3 py-1.5 text-xs"
            onClick={() => void addReading()}
            disabled={isSaving}
          >
            {isSaving ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Save reading'}
          </button>
        </div>
      )}
    </div>
  );
}

export function UtilitiesSection({ facilityId, canManage, canEdit }: SectionProps) {
  // Stable per facilityId — an inline closure would re-trigger the section's
  // fetch effect on every completed request (infinite refetch loop).
  const load = useCallback(() => facilitiesService.getUtilityAccounts({ facility_id: facilityId }), [facilityId]);
  return (
    <ResourceSection<UtilityAccount>
      title="Utilities"
      emptyMessage="No utility accounts have been added."
      canEdit={canEdit}
      canDelete={canManage}
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
      update={(id, v) =>
        facilitiesService.updateUtilityAccount(id, {
          utility_type: v.utility_type,
          provider_name: v.provider_name,
          account_number: blankToNull(v.account_number),
          meter_number: blankToNull(v.meter_number),
        })
      }
      toForm={(item) => ({
        utility_type: item.utilityType,
        provider_name: item.providerName,
        account_number: item.accountNumber ?? '',
        meter_number: item.meterNumber ?? '',
      })}
      remove={(id) => facilitiesService.deleteUtilityAccount(id)}
      fields={[
        { key: 'utility_type', label: 'Utility type', required: true, type: 'select', options: UTILITY_TYPES },
        { key: 'provider_name', label: 'Provider', required: true },
        { key: 'account_number', label: 'Account number' },
        { key: 'meter_number', label: 'Meter number' },
      ]}
      renderSummary={(item) => (
        <>
          <p className="text-theme-text-primary text-sm font-medium">{enumLabel(item.utilityType)}</p>
          <p className="text-theme-text-muted text-xs">
            {text(item.providerName)} · Account {text(item.accountNumber)}
          </p>
          <UtilityReadings accountId={item.id} canEdit={canEdit} />
        </>
      )}
    />
  );
}

export function AccessKeysSection({ facilityId, canManage, canEdit }: SectionProps) {
  const load = useCallback(() => facilitiesService.getAccessKeys({ facility_id: facilityId }), [facilityId]);
  return (
    <ResourceSection<AccessKey>
      title="Access Keys"
      emptyMessage="No keys or credentials are tracked."
      canEdit={canEdit}
      canDelete={canManage}
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
      update={(id, v) =>
        facilitiesService.updateAccessKey(id, {
          key_type: v.key_type,
          key_identifier: blankToNull(v.key_identifier),
          description: blankToNull(v.description),
          assigned_to_name: blankToNull(v.assigned_to_name),
        })
      }
      toForm={(item) => ({
        key_type: item.keyType,
        key_identifier: item.keyIdentifier ?? '',
        description: item.description ?? '',
        assigned_to_name: item.assignedToName ?? '',
      })}
      remove={(id) => facilitiesService.deleteAccessKey(id)}
      fields={[
        { key: 'key_type', label: 'Key type', required: true, type: 'select', options: KEY_TYPES },
        { key: 'key_identifier', label: 'Identifier' },
        { key: 'assigned_to_name', label: 'Assigned to' },
        { key: 'description', label: 'Description' },
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

export function ShutoffsSection({ facilityId, canManage, canEdit }: SectionProps) {
  const load = useCallback(() => facilitiesService.getShutoffLocations({ facility_id: facilityId }), [facilityId]);
  return (
    <ResourceSection<ShutoffLocation>
      title="Shutoff Locations"
      emptyMessage="No utility shutoffs are documented."
      canEdit={canEdit}
      canDelete={canManage}
      load={load}
      create={(v) =>
        facilitiesService.createShutoffLocation({
          facility_id: facilityId,
          shutoff_type: v.shutoff_type,
          location_description: v.location_description,
          floor: numberValue(v.floor),
        } as ShutoffLocationCreate)
      }
      update={(id, v) =>
        facilitiesService.updateShutoffLocation(id, {
          shutoff_type: v.shutoff_type,
          location_description: v.location_description,
          // Explicit null so a cleared floor persists (Pitfall #1 update rule)
          floor: numberOrNull(v.floor),
        })
      }
      toForm={(item) => ({
        shutoff_type: item.shutoffType,
        location_description: item.locationDescription ?? '',
        floor: item.floor?.toString() ?? '',
      })}
      remove={(id) => facilitiesService.deleteShutoffLocation(id)}
      fields={[
        { key: 'shutoff_type', label: 'Shutoff type', required: true, type: 'select', options: SHUTOFF_TYPES },
        { key: 'location_description', label: 'Location', required: true },
        { key: 'floor', label: 'Floor', type: 'number' },
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

export function CapitalProjectsSection({ facilityId, canManage, canEdit }: SectionProps) {
  const load = useCallback(() => facilitiesService.getCapitalProjects({ facility_id: facilityId }), [facilityId]);
  return (
    <ResourceSection<CapitalProject>
      title="Capital Projects"
      emptyMessage="No capital projects are tracked."
      canEdit={canEdit}
      canDelete={canManage}
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
      update={(id, v) =>
        facilitiesService.updateCapitalProject(id, {
          project_name: v.name,
          project_type: v.project_type,
          // Status is a non-nullable enum server-side — omit rather than clear
          project_status: v.status || undefined,
          // Explicit nulls so cleared fields persist (Pitfall #1 update rule)
          estimated_cost: numberOrNull(v.estimated_budget),
          start_date: blankToNull(v.start_date),
        })
      }
      toForm={(item) => ({
        name: item.projectName,
        project_type: item.projectType,
        status: item.projectStatus,
        estimated_budget: item.estimatedCost?.toString() ?? '',
        start_date: item.startDate ?? '',
      })}
      remove={(id) => facilitiesService.deleteCapitalProject(id)}
      fields={[
        { key: 'name', label: 'Project name', required: true },
        { key: 'project_type', label: 'Project type', required: true, type: 'select', options: PROJECT_TYPES },
        { key: 'status', label: 'Status', type: 'select', options: PROJECT_STATUSES },
        { key: 'estimated_budget', label: 'Estimated budget', type: 'number' },
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

export function InsuranceSection({ facilityId, canManage, canEdit }: SectionProps) {
  const load = useCallback(() => facilitiesService.getInsurancePolicies({ facility_id: facilityId }), [facilityId]);
  return (
    <ResourceSection<InsurancePolicy>
      title="Insurance"
      emptyMessage="No insurance policies are tracked."
      canEdit={canEdit}
      canDelete={canManage}
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
      update={(id, v) =>
        facilitiesService.updateInsurancePolicy(id, {
          policy_type: v.policy_type,
          policy_number: blankToNull(v.policy_number),
          carrier_name: v.provider,
          // Explicit nulls so cleared fields persist (Pitfall #1 update rule)
          coverage_amount: numberOrNull(v.coverage_amount),
          expiration_date: blankToNull(v.expiration_date),
        })
      }
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
        { key: 'policy_number', label: 'Policy number' },
        { key: 'provider', label: 'Carrier', required: true },
        { key: 'coverage_amount', label: 'Coverage amount', type: 'number' },
        { key: 'expiration_date', label: 'Expiration', type: 'date' },
      ]}
      renderSummary={(item) => (
        <>
          <p className="text-theme-text-primary text-sm font-medium">
            {enumLabel(item.policyType)} · {text(item.policyNumber)}
          </p>
          <p className="text-theme-text-muted text-xs">
            {text(item.carrierName)}
            {item.expirationDate ? ` · Expires ${item.expirationDate}` : ''}
          </p>
        </>
      )}
    />
  );
}

export function OccupantsSection({ facilityId, canManage, canEdit }: SectionProps) {
  const load = useCallback(() => facilitiesService.getOccupants({ facility_id: facilityId }), [facilityId]);
  return (
    <ResourceSection<Occupant>
      title="Occupants"
      emptyMessage="No occupants or units are assigned."
      canEdit={canEdit}
      canDelete={canManage}
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
      update={(id, v) =>
        facilitiesService.updateOccupant(id, {
          unit_name: v.name,
          description: blankToNull(v.occupant_type),
          // Explicit null so a cleared date persists (Pitfall #1 update rule)
          effective_date: blankToNull(v.start_date),
        })
      }
      toForm={(item) => ({
        name: item.unitName,
        occupant_type: item.description ?? '',
        start_date: item.effectiveDate ?? '',
      })}
      remove={(id) => facilitiesService.deleteOccupant(id)}
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'occupant_type', label: 'Occupant type' },
        { key: 'start_date', label: 'Start date', type: 'date' },
      ]}
      renderSummary={(item) => (
        <>
          <p className="text-theme-text-primary text-sm font-medium">{text(item.unitName)}</p>
          <p className="text-theme-text-muted text-xs">
            {item.description || 'Occupant'}
            {item.effectiveDate ? ` · Since ${item.effectiveDate}` : ''}
          </p>
        </>
      )}
    />
  );
}
