import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Truck, Plus, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  OnboardingHeader,
  ProgressIndicator,
  BackButton,
  ResetProgressButton,
  AutoSaveNotification,
  ErrorAlert,
} from '../components';
import { useOnboardingStore, type OnboardingApparatusDraft } from '../store';
import { useApiRequest } from '../hooks';
import { apiClient } from '../services/api-client';

const inputClass =
  'w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary placeholder:text-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring';
const labelClass = 'form-label-sm';

/** Apparatus types the backend accepts, lowercase per the enum convention. */
const APPARATUS_TYPES = [
  { value: 'engine', label: 'Engine' },
  { value: 'ladder', label: 'Ladder / Truck' },
  { value: 'rescue', label: 'Rescue' },
  { value: 'ambulance', label: 'Ambulance / Medic' },
  { value: 'tanker', label: 'Tanker / Tender' },
  { value: 'brush', label: 'Brush' },
  { value: 'command', label: 'Command' },
  { value: 'utility', label: 'Utility' },
  { value: 'other', label: 'Other' },
] as const;

/** Riding positions offered as one-click adds. Free text is allowed too. */
const COMMON_POSITIONS = ['officer', 'driver', 'firefighter', 'paramedic', 'emt'];

const makeApparatus = (): OnboardingApparatusDraft => ({
  id: crypto.randomUUID(),
  unitNumber: '',
  name: '',
  apparatusType: 'engine',
  minStaffing: 1,
  positions: [],
});

/**
 * Apparatus step.
 *
 * Collects only what shift staffing needs — unit number, type, minimum
 * staffing, and riding positions. Departments that enable the full Apparatus
 * module later get maintenance history and inventory on top of these records;
 * asking for all of that during setup would stall the wizard.
 */
const ApparatusSetup: React.FC = () => {
  const navigate = useNavigate();
  const departmentName = useOnboardingStore((state) => state.departmentName);
  const logoPreview = useOnboardingStore((state) => state.logoData);
  const lastSaved = useOnboardingStore((state) => state.lastSaved);
  const savedApparatus = useOnboardingStore((state) => state.apparatus);
  const setApparatus = useOnboardingStore((state) => state.setApparatus);

  const [rows, setRows] = useState<OnboardingApparatusDraft[]>(savedApparatus);
  const [invalidRowIds, setInvalidRowIds] = useState<string[]>([]);
  const [positionDrafts, setPositionDrafts] = useState<Record<string, string>>({});
  const { execute, error, canRetry, clearError, isLoading } = useApiRequest();

  useEffect(() => {
    if (!departmentName) {
      void navigate('/onboarding/start');
    }
  }, [departmentName, navigate]);

  const updateRow = <K extends keyof OnboardingApparatusDraft>(
    id: string,
    field: K,
    value: OnboardingApparatusDraft[K]
  ) => {
    const nextRows = rows.map((row) => (row.id === id ? { ...row, [field]: value } : row));
    setRows(nextRows);
    setApparatus(nextRows);
    if (field === 'unitNumber' && typeof value === 'string' && value.trim()) {
      setInvalidRowIds((prev) => prev.filter((rowId) => rowId !== id));
    }
  };

  const addPosition = (id: string, position: string) => {
    const clean = position.trim().toLowerCase();
    if (!clean) return;
    const nextRows = rows.map((row) =>
      row.id === id && !row.positions.includes(clean) ? { ...row, positions: [...row.positions, clean] } : row
    );
    setRows(nextRows);
    setApparatus(nextRows);
    setPositionDrafts((prev) => ({ ...prev, [id]: '' }));
  };

  const removePosition = (id: string, position: string) => {
    const nextRows = rows.map((row) =>
      row.id === id ? { ...row, positions: row.positions.filter((p: string) => p !== position) } : row
    );
    setRows(nextRows);
    setApparatus(nextRows);
  };

  const namedRows = rows.filter((row) => row.unitNumber.trim());
  const rowHasUserData = (row: OnboardingApparatusDraft) =>
    Boolean(row.name.trim() || row.positions.length > 0 || row.apparatusType !== 'engine' || row.minStaffing !== 1);

  const persist = async (apparatusRows: OnboardingApparatusDraft[]) => {
    const { error: apiError } = await execute(
      async () => {
        const response = await apiClient.saveApparatus(
          apparatusRows.map((row) => ({
            unit_number: row.unitNumber.trim(),
            // `||` not `??`: an untouched name is '' and must be omitted so
            // the backend falls back to the unit number.
            name: row.name.trim() || undefined,
            apparatus_type: row.apparatusType,
            min_staffing: row.minStaffing,
            positions: row.positions,
          }))
        );
        if (response.error) {
          throw new Error(response.error);
        }
        return response;
      },
      { step: 'Apparatus', action: 'Save apparatus' }
    );

    return !apiError;
  };

  const handleContinue = async () => {
    clearError();
    const incompleteRows = rows.filter((row) => !row.unitNumber.trim() && rowHasUserData(row));
    if (incompleteRows.length > 0) {
      setInvalidRowIds(incompleteRows.map((row) => row.id));
      toast.error('Add a unit number or remove the incomplete apparatus before continuing.');
      return;
    }
    setApparatus(namedRows);

    if (!(await persist(namedRows))) return;

    if (namedRows.length > 0) {
      toast.success(`${namedRows.length} apparatus added`);
    }
    void navigate('/onboarding/navigation-choice');
  };

  const handleSkip = async () => {
    clearError();
    setApparatus([]);
    if (!(await persist([]))) return;
    void navigate('/onboarding/navigation-choice');
  };

  return (
    <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to safe-top flex min-h-screen flex-col bg-linear-to-br">
      <OnboardingHeader
        departmentName={departmentName}
        logoPreview={logoPreview}
        icon={<Truck aria-hidden="true" className="h-6 w-6 text-white" />}
      />

      <main className="flex flex-1 items-start justify-center p-4 py-8">
        <div className="w-full max-w-3xl">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10">
              <Truck className="h-7 w-7 text-red-500" aria-hidden="true" />
            </div>
            <h2 className="text-theme-text-primary text-2xl font-bold">Your Apparatus</h2>
            <p className="text-theme-text-secondary mx-auto mt-2 max-w-xl text-sm">
              Add your engines, trucks, and ambulances. Shift scheduling uses the minimum staffing and riding positions
              to know when a unit is short.
            </p>
          </div>

          {error && (
            <div className="mb-4">
              <ErrorAlert
                message={error}
                canRetry={canRetry}
                onRetry={() => void handleContinue()}
                onDismiss={clearError}
              />
            </div>
          )}

          {rows.length === 0 ? (
            <div className="card mb-4 p-8 text-center">
              <p className="text-theme-text-secondary mb-4 text-sm">
                No apparatus yet. You can add these later from the Apparatus page.
              </p>
              <button
                onClick={() => {
                  const nextRows = [makeApparatus()];
                  setRows(nextRows);
                  setApparatus(nextRows);
                }}
                className="btn-primary inline-flex items-center gap-2"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Apparatus
              </button>
            </div>
          ) : (
            <div className="mb-4 space-y-4">
              {rows.map((row) => (
                <div key={row.id} className="card p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-theme-text-primary text-sm font-semibold">
                      {row.unitNumber.trim() || 'New Apparatus'}
                    </h3>
                    <button
                      onClick={() => {
                        const nextRows = rows.filter((candidate) => candidate.id !== row.id);
                        setRows(nextRows);
                        setApparatus(nextRows);
                        setInvalidRowIds((prev) => prev.filter((rowId) => rowId !== row.id));
                      }}
                      className="text-theme-text-muted mobile-touch-target transition-colors hover:text-red-500"
                      aria-label={`Remove ${row.unitNumber.trim() || 'apparatus'}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                    <div>
                      <label className={labelClass} htmlFor={`unit-${row.id}`}>
                        Unit Number <span className="text-red-500">*</span>
                      </label>
                      <input
                        id={`unit-${row.id}`}
                        className={`${inputClass} ${invalidRowIds.includes(row.id) ? 'border-red-500' : ''}`}
                        value={row.unitNumber}
                        onChange={(e) => updateRow(row.id, 'unitNumber', e.target.value)}
                        placeholder="E-1"
                        maxLength={20}
                        aria-invalid={invalidRowIds.includes(row.id)}
                        aria-describedby={invalidRowIds.includes(row.id) ? `unit-error-${row.id}` : undefined}
                      />
                      {invalidRowIds.includes(row.id) && (
                        <p id={`unit-error-${row.id}`} className="mt-1 text-xs text-red-500">
                          Unit number is required when other details are entered.
                        </p>
                      )}
                    </div>
                    <div className="sm:col-span-2">
                      <label className={labelClass} htmlFor={`aname-${row.id}`}>
                        Name
                      </label>
                      <input
                        id={`aname-${row.id}`}
                        className={inputClass}
                        value={row.name}
                        onChange={(e) => updateRow(row.id, 'name', e.target.value)}
                        placeholder="Engine 1"
                        maxLength={100}
                      />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor={`staffing-${row.id}`}>
                        Min. Staffing
                      </label>
                      <input
                        id={`staffing-${row.id}`}
                        type="number"
                        min={1}
                        max={20}
                        className={inputClass}
                        value={row.minStaffing}
                        onChange={(e) =>
                          updateRow(row.id, 'minStaffing', Math.min(20, Math.max(1, Number(e.target.value) || 1)))
                        }
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className={labelClass} htmlFor={`type-${row.id}`}>
                        Type
                      </label>
                      <select
                        id={`type-${row.id}`}
                        className={inputClass}
                        value={row.apparatusType}
                        onChange={(e) => updateRow(row.id, 'apparatusType', e.target.value)}
                      >
                        {APPARATUS_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Riding positions */}
                  <div className="border-theme-surface-border mt-4 border-t pt-4">
                    <span className={labelClass}>Riding Positions</span>

                    {row.positions.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {row.positions.map((position) => (
                          <span
                            key={position}
                            className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-1 text-xs font-medium text-red-600 capitalize dark:text-red-400"
                          >
                            {position}
                            <button
                              onClick={() => removePosition(row.id, position)}
                              aria-label={`Remove ${position} position`}
                              className="hover:text-red-700 dark:hover:text-red-300"
                            >
                              <X className="h-3 w-3" aria-hidden="true" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="mb-2 flex flex-wrap gap-2">
                      {COMMON_POSITIONS.filter((p) => !row.positions.includes(p)).map((position: string) => (
                        <button
                          key={position}
                          onClick={() => addPosition(row.id, position)}
                          className="border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary rounded-md border border-dashed px-2 py-1 text-xs capitalize transition-colors hover:border-red-500/40"
                        >
                          + {position}
                        </button>
                      ))}
                    </div>

                    <div className="flex gap-2">
                      <input
                        className={inputClass}
                        value={positionDrafts[row.id] ?? ''}
                        onChange={(e) => setPositionDrafts((prev) => ({ ...prev, [row.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addPosition(row.id, positionDrafts[row.id] ?? '');
                          }
                        }}
                        placeholder="Add a custom position"
                        aria-label={`Custom riding position for ${row.unitNumber.trim() || 'apparatus'}`}
                      />
                      <button
                        onClick={() => addPosition(row.id, positionDrafts[row.id] ?? '')}
                        className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover shrink-0 rounded-lg border px-3 py-2 transition-colors"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              <button
                onClick={() => {
                  const nextRows = [...rows, makeApparatus()];
                  setRows(nextRows);
                  setApparatus(nextRows);
                }}
                className="border-theme-surface-border text-theme-text-secondary hover:text-theme-text-primary mobile-touch-target inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed py-3 transition-colors hover:border-red-500/40"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Another Apparatus
              </button>
            </div>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => void handleContinue()}
              disabled={isLoading}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {isLoading ? 'Saving...' : 'Continue'}
            </button>
            <button
              onClick={() => void handleSkip()}
              disabled={isLoading}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover mobile-touch-target flex-1 rounded-lg border px-4 py-3 transition-colors disabled:opacity-50"
            >
              Skip for now
            </button>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <BackButton to="/onboarding/stations" />
            <ResetProgressButton />
          </div>

          <ProgressIndicator step="apparatus" className="border-theme-nav-border mt-6 border-t pt-6" />
        </div>
      </main>

      <AutoSaveNotification showTimestamp lastSaved={lastSaved} className="mb-4" />
    </div>
  );
};

export default ApparatusSetup;
