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
const labelClass = 'block text-xs font-medium text-theme-text-secondary mb-1';

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
  const departmentName = useOnboardingStore(state => state.departmentName);
  const logoPreview = useOnboardingStore(state => state.logoData);
  const lastSaved = useOnboardingStore(state => state.lastSaved);
  const savedApparatus = useOnboardingStore(state => state.apparatus);
  const setApparatus = useOnboardingStore(state => state.setApparatus);

  const [rows, setRows] = useState<OnboardingApparatusDraft[]>(savedApparatus);
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
    setRows(prev => prev.map(row => (row.id === id ? { ...row, [field]: value } : row)));
  };

  const addPosition = (id: string, position: string) => {
    const clean = position.trim().toLowerCase();
    if (!clean) return;
    setRows(prev =>
      prev.map(row =>
        row.id === id && !row.positions.includes(clean)
          ? { ...row, positions: [...row.positions, clean] }
          : row
      )
    );
    setPositionDrafts(prev => ({ ...prev, [id]: '' }));
  };

  const removePosition = (id: string, position: string) => {
    setRows(prev =>
      prev.map(row =>
        row.id === id
          ? { ...row, positions: row.positions.filter((p: string) => p !== position) }
          : row
      )
    );
  };

  const namedRows = rows.filter(row => row.unitNumber.trim());

  const persist = async (apparatusRows: OnboardingApparatusDraft[]) => {
    const { error: apiError } = await execute(
      async () => {
        const response = await apiClient.saveApparatus(
          apparatusRows.map(row => ({
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
    <div className="min-h-screen bg-linear-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to flex flex-col">
      <OnboardingHeader
        departmentName={departmentName}
        logoPreview={logoPreview}
        icon={<Truck aria-hidden="true" className="w-6 h-6 text-white" />}
      />

      <main className="flex-1 flex items-start justify-center p-4 py-8">
        <div className="max-w-3xl w-full">
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-3">
              <Truck className="w-7 h-7 text-red-500" aria-hidden="true" />
            </div>
            <h2 className="text-2xl font-bold text-theme-text-primary">Your Apparatus</h2>
            <p className="text-theme-text-secondary mt-2 max-w-xl mx-auto text-sm">
              Add your engines, trucks, and ambulances. Shift scheduling uses the minimum
              staffing and riding positions to know when a unit is short.
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
            <div className="card p-8 text-center mb-4">
              <p className="text-theme-text-secondary text-sm mb-4">
                No apparatus yet. You can add these later from the Apparatus page.
              </p>
              <button
                onClick={() => setRows([makeApparatus()])}
                className="btn-primary inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                Add Apparatus
              </button>
            </div>
          ) : (
            <div className="space-y-4 mb-4">
              {rows.map(row => (
                <div key={row.id} className="card p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-theme-text-primary">
                      {row.unitNumber.trim() || 'New Apparatus'}
                    </h3>
                    <button
                      onClick={() => setRows(prev => prev.filter(r => r.id !== row.id))}
                      className="text-theme-text-muted hover:text-red-500 transition-colors mobile-touch-target"
                      aria-label={`Remove ${row.unitNumber.trim() || 'apparatus'}`}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div>
                      <label className={labelClass} htmlFor={`unit-${row.id}`}>
                        Unit Number <span className="text-red-500">*</span>
                      </label>
                      <input
                        id={`unit-${row.id}`}
                        className={inputClass}
                        value={row.unitNumber}
                        onChange={e => updateRow(row.id, 'unitNumber', e.target.value)}
                        placeholder="E-1"
                        maxLength={20}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={labelClass} htmlFor={`aname-${row.id}`}>
                        Name
                      </label>
                      <input
                        id={`aname-${row.id}`}
                        className={inputClass}
                        value={row.name}
                        onChange={e => updateRow(row.id, 'name', e.target.value)}
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
                        onChange={e =>
                          updateRow(
                            row.id,
                            'minStaffing',
                            Math.min(20, Math.max(1, Number(e.target.value) || 1))
                          )
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
                        onChange={e => updateRow(row.id, 'apparatusType', e.target.value)}
                      >
                        {APPARATUS_TYPES.map(type => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Riding positions */}
                  <div className="mt-4 pt-4 border-t border-theme-surface-border">
                    <span className={labelClass}>Riding Positions</span>

                    {row.positions.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {row.positions.map(position => (
                          <span
                            key={position}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-medium capitalize"
                          >
                            {position}
                            <button
                              onClick={() => removePosition(row.id, position)}
                              aria-label={`Remove ${position} position`}
                              className="hover:text-red-700 dark:hover:text-red-300"
                            >
                              <X className="w-3 h-3" aria-hidden="true" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 mb-2">
                      {COMMON_POSITIONS.filter(p => !row.positions.includes(p)).map(
                        (position: string) => (
                          <button
                            key={position}
                            onClick={() => addPosition(row.id, position)}
                            className="px-2 py-1 rounded-md border border-dashed border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary hover:border-red-500/40 text-xs capitalize transition-colors"
                          >
                            + {position}
                          </button>
                        )
                      )}
                    </div>

                    <div className="flex gap-2">
                      <input
                        className={inputClass}
                        value={positionDrafts[row.id] ?? ''}
                        onChange={e =>
                          setPositionDrafts(prev => ({ ...prev, [row.id]: e.target.value }))
                        }
                        onKeyDown={e => {
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
                        className="px-3 py-2 rounded-lg border border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover transition-colors shrink-0"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              <button
                onClick={() => setRows(prev => [...prev, makeApparatus()])}
                className="w-full py-3 rounded-lg border border-dashed border-theme-surface-border text-theme-text-secondary hover:border-red-500/40 hover:text-theme-text-primary transition-colors inline-flex items-center justify-center gap-2 mobile-touch-target"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                Add Another Apparatus
              </button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 mt-6">
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
              className="flex-1 px-4 py-3 rounded-lg border border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover transition-colors disabled:opacity-50 mobile-touch-target"
            >
              Skip for now
            </button>
          </div>

          <div className="flex items-center justify-between mt-6">
            <BackButton to="/onboarding/stations" />
            <ResetProgressButton />
          </div>

          <ProgressIndicator
            step="apparatus"
            className="mt-6 pt-6 border-t border-theme-nav-border"
          />
        </div>
      </main>

      <AutoSaveNotification showTimestamp lastSaved={lastSaved} className="mb-4" />
    </div>
  );
};

export default ApparatusSetup;
