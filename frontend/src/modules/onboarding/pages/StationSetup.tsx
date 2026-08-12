import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { MapPin, Plus, Trash2, Building2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  OnboardingHeader,
  ProgressIndicator,
  ResetProgressButton,
  AutoSaveNotification,
  ErrorAlert,
} from '../components';
import { useOnboardingStore, type OnboardingStationDraft } from '../store';
import { useApiRequest } from '../hooks';
import { apiClient } from '../services/api-client';

const inputClass =
  'w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary placeholder:text-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring';
const labelClass = 'form-label-sm';

const makeStation = (): OnboardingStationDraft => ({
  // crypto.randomUUID is available in every browser that meets the app's
  // secure-context requirement; onboarding already runs over HTTPS.
  id: crypto.randomUUID(),
  name: '',
  stationNumber: '',
  address: '',
  city: '',
  state: '',
  zipCode: '',
  phone: '',
  email: '',
});

/**
 * Stations step.
 *
 * Organization setup already created headquarters from the department's
 * address. This step collects the *other* stations, which a multi-station
 * department would otherwise have to discover in the Facilities module after
 * setup. Skipping is a first-class outcome — plenty of departments have one
 * station.
 */
const StationSetup: React.FC = () => {
  const navigate = useNavigate();
  const departmentName = useOnboardingStore((state) => state.departmentName);
  const logoPreview = useOnboardingStore((state) => state.logoData);
  const lastSaved = useOnboardingStore((state) => state.lastSaved);
  const savedStations = useOnboardingStore((state) => state.stations);
  const setStations = useOnboardingStore((state) => state.setStations);

  const [rows, setRows] = useState<OnboardingStationDraft[]>(savedStations.length > 0 ? savedStations : []);
  const [invalidRowIds, setInvalidRowIds] = useState<string[]>([]);
  const { execute, error, canRetry, clearError, isLoading } = useApiRequest();

  useEffect(() => {
    if (!departmentName) {
      void navigate('/onboarding/start');
    }
  }, [departmentName, navigate]);

  const updateRow = (id: string, field: keyof OnboardingStationDraft, value: string) => {
    const nextRows = rows.map((row) => (row.id === id ? { ...row, [field]: value } : row));
    setRows(nextRows);
    setStations(nextRows);
    if (field === 'name' && value.trim()) {
      setInvalidRowIds((prev) => prev.filter((rowId) => rowId !== id));
    }
  };

  const namedRows = rows.filter((row) => row.name.trim());
  const rowHasData = (row: OnboardingStationDraft) =>
    Object.entries(row).some(([field, value]) => field !== 'id' && typeof value === 'string' && value.trim());

  const persist = async (stationRows: OnboardingStationDraft[]) => {
    const { error: apiError } = await execute(
      async () => {
        const response = await apiClient.saveStations(
          stationRows.map((row) => ({
            name: row.name.trim(),
            // `||` not `??`: an untouched field is '' and must be omitted,
            // not sent as an empty string the API would reject.
            station_number: row.stationNumber.trim() || undefined,
            address: row.address.trim() || undefined,
            city: row.city.trim() || undefined,
            state: row.state.trim() || undefined,
            zip_code: row.zipCode.trim() || undefined,
            phone: row.phone.trim() || undefined,
            email: row.email.trim() || undefined,
          }))
        );
        if (response.error) {
          throw new Error(response.error);
        }
        return response;
      },
      { step: 'Stations', action: 'Save stations' }
    );

    return !apiError;
  };

  const handleContinue = async () => {
    clearError();
    const incompleteRows = rows.filter((row) => !row.name.trim() && rowHasData(row));
    if (incompleteRows.length > 0) {
      setInvalidRowIds(incompleteRows.map((row) => row.id));
      toast.error('Add a station name or remove the incomplete station before continuing.');
      return;
    }
    setStations(namedRows);

    if (!(await persist(namedRows))) return;

    if (namedRows.length > 0) {
      toast.success(`${namedRows.length} station${namedRows.length === 1 ? '' : 's'} added`);
    }
    void navigate('/onboarding/apparatus');
  };

  const handleSkip = async () => {
    clearError();
    setStations([]);
    // Persist the empty list so a previous pass's stations are cleared if the
    // admin came back and decided against them.
    if (!(await persist([]))) return;
    void navigate('/onboarding/apparatus');
  };

  return (
    <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to safe-top flex min-h-screen flex-col bg-linear-to-br">
      <OnboardingHeader departmentName={departmentName} logoPreview={logoPreview} />

      <main className="flex flex-1 items-start justify-center p-4 py-8">
        <div className="w-full max-w-3xl">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10">
              <MapPin className="h-7 w-7 text-red-500" aria-hidden="true" />
            </div>
            <h2 className="text-theme-text-primary text-2xl font-bold">Your Stations</h2>
            <p className="text-theme-text-secondary mx-auto mt-2 max-w-xl text-sm">
              We already created headquarters from your department address. Add any other stations here so they are
              ready for event check-in, scheduling, and apparatus assignment.
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

          <div className="card mb-4 p-5">
            <div className="text-theme-text-secondary flex items-center gap-2 text-sm">
              <Building2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
              <span>
                <span className="text-theme-text-primary font-medium">{departmentName || 'Headquarters'}</span> is
                already set up as Station 1.
              </span>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="card mb-4 p-8 text-center">
              <p className="text-theme-text-secondary mb-4 text-sm">
                No additional stations yet. Single-station departments can skip this step.
              </p>
              <button
                onClick={() => {
                  const nextRows = [makeStation()];
                  setRows(nextRows);
                  setStations(nextRows);
                }}
                className="btn-primary inline-flex items-center gap-2"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add a Station
              </button>
            </div>
          ) : (
            <div className="mb-4 space-y-4">
              {rows.map((row, index) => (
                <div key={row.id} className="card p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-theme-text-primary text-sm font-semibold">Station {index + 2}</h3>
                    <button
                      onClick={() => {
                        const nextRows = rows.filter((candidate) => candidate.id !== row.id);
                        setRows(nextRows);
                        setStations(nextRows);
                        setInvalidRowIds((prev) => prev.filter((rowId) => rowId !== row.id));
                      }}
                      className="text-theme-text-muted mobile-touch-target transition-colors hover:text-red-500"
                      aria-label={`Remove station ${index + 2}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <label className={labelClass} htmlFor={`name-${row.id}`}>
                        Station Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        id={`name-${row.id}`}
                        className={`${inputClass} ${invalidRowIds.includes(row.id) ? 'border-red-500' : ''}`}
                        value={row.name}
                        onChange={(e) => updateRow(row.id, 'name', e.target.value)}
                        placeholder="North Station"
                        aria-invalid={invalidRowIds.includes(row.id)}
                        aria-describedby={invalidRowIds.includes(row.id) ? `name-error-${row.id}` : undefined}
                      />
                      {invalidRowIds.includes(row.id) && (
                        <p id={`name-error-${row.id}`} className="mt-1 text-xs text-red-500">
                          Station name is required when other details are entered.
                        </p>
                      )}
                    </div>
                    <div>
                      <label className={labelClass} htmlFor={`number-${row.id}`}>
                        Station Number
                      </label>
                      <input
                        id={`number-${row.id}`}
                        className={inputClass}
                        value={row.stationNumber}
                        onChange={(e) => updateRow(row.id, 'stationNumber', e.target.value)}
                        placeholder="Station 2"
                      />
                    </div>

                    <div className="sm:col-span-3">
                      <label className={labelClass} htmlFor={`address-${row.id}`}>
                        Street Address
                      </label>
                      <input
                        id={`address-${row.id}`}
                        className={inputClass}
                        value={row.address}
                        onChange={(e) => updateRow(row.id, 'address', e.target.value)}
                        placeholder="450 Oak Avenue"
                      />
                    </div>

                    <div>
                      <label className={labelClass} htmlFor={`city-${row.id}`}>
                        City
                      </label>
                      <input
                        id={`city-${row.id}`}
                        className={inputClass}
                        value={row.city}
                        onChange={(e) => updateRow(row.id, 'city', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor={`state-${row.id}`}>
                        State
                      </label>
                      <input
                        id={`state-${row.id}`}
                        className={inputClass}
                        value={row.state}
                        onChange={(e) => updateRow(row.id, 'state', e.target.value)}
                        maxLength={50}
                      />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor={`zip-${row.id}`}>
                        ZIP Code
                      </label>
                      <input
                        id={`zip-${row.id}`}
                        className={inputClass}
                        value={row.zipCode}
                        onChange={(e) => updateRow(row.id, 'zipCode', e.target.value)}
                      />
                    </div>

                    <div>
                      <label className={labelClass} htmlFor={`phone-${row.id}`}>
                        Phone
                      </label>
                      <input
                        id={`phone-${row.id}`}
                        className={inputClass}
                        value={row.phone}
                        onChange={(e) => updateRow(row.id, 'phone', e.target.value)}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={labelClass} htmlFor={`email-${row.id}`}>
                        Email
                      </label>
                      <input
                        id={`email-${row.id}`}
                        type="email"
                        className={inputClass}
                        value={row.email}
                        onChange={(e) => updateRow(row.id, 'email', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ))}

              <button
                onClick={() => {
                  const nextRows = [...rows, makeStation()];
                  setRows(nextRows);
                  setStations(nextRows);
                }}
                className="border-theme-surface-border text-theme-text-secondary hover:text-theme-text-primary mobile-touch-target inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed py-3 transition-colors hover:border-red-500/40"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Another Station
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
              Skip — one station only
            </button>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <p className="text-theme-text-muted max-w-md text-xs">
              Organization details are already saved. You can update them from Settings after setup.
            </p>
            <ResetProgressButton />
          </div>

          <ProgressIndicator step="stations" className="border-theme-nav-border mt-6 border-t pt-6" />
        </div>
      </main>

      <AutoSaveNotification showTimestamp lastSaved={lastSaved} className="mb-4" />
    </div>
  );
};

export default StationSetup;
