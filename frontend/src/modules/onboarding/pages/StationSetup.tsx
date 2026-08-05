import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { MapPin, Plus, Trash2, Building2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  OnboardingHeader,
  ProgressIndicator,
  BackButton,
  ResetProgressButton,
  AutoSaveNotification,
  ErrorAlert,
} from '../components';
import { useOnboardingStore, type OnboardingStationDraft } from '../store';
import { useApiRequest } from '../hooks';
import { apiClient } from '../services/api-client';

const inputClass =
  'w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary placeholder:text-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring';
const labelClass = 'block text-xs font-medium text-theme-text-secondary mb-1';

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
  const departmentName = useOnboardingStore(state => state.departmentName);
  const logoPreview = useOnboardingStore(state => state.logoData);
  const lastSaved = useOnboardingStore(state => state.lastSaved);
  const savedStations = useOnboardingStore(state => state.stations);
  const setStations = useOnboardingStore(state => state.setStations);

  const [rows, setRows] = useState<OnboardingStationDraft[]>(
    savedStations.length > 0 ? savedStations : []
  );
  const { execute, error, canRetry, clearError, isLoading } = useApiRequest();

  useEffect(() => {
    if (!departmentName) {
      void navigate('/onboarding/start');
    }
  }, [departmentName, navigate]);

  const updateRow = (id: string, field: keyof OnboardingStationDraft, value: string) => {
    setRows(prev => prev.map(row => (row.id === id ? { ...row, [field]: value } : row)));
  };

  const namedRows = rows.filter(row => row.name.trim());

  const persist = async (stationRows: OnboardingStationDraft[]) => {
    const { error: apiError } = await execute(
      async () => {
        const response = await apiClient.saveStations(
          stationRows.map(row => ({
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
    <div className="min-h-screen bg-linear-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to flex flex-col">
      <OnboardingHeader departmentName={departmentName} logoPreview={logoPreview} />

      <main className="flex-1 flex items-start justify-center p-4 py-8">
        <div className="max-w-3xl w-full">
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-3">
              <MapPin className="w-7 h-7 text-red-500" aria-hidden="true" />
            </div>
            <h2 className="text-2xl font-bold text-theme-text-primary">Your Stations</h2>
            <p className="text-theme-text-secondary mt-2 max-w-xl mx-auto text-sm">
              We already created headquarters from your department address. Add any other
              stations here so they are ready for event check-in, scheduling, and apparatus
              assignment.
            </p>
          </div>

          {error && (
            <div className="mb-4">
              <ErrorAlert message={error} canRetry={canRetry} onRetry={() => void handleContinue()} onDismiss={clearError} />
            </div>
          )}

          <div className="card p-5 mb-4">
            <div className="flex items-center gap-2 text-sm text-theme-text-secondary">
              <Building2 className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden="true" />
              <span>
                <span className="font-medium text-theme-text-primary">
                  {departmentName || 'Headquarters'}
                </span>{' '}
                is already set up as Station 1.
              </span>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="card p-8 text-center mb-4">
              <p className="text-theme-text-secondary text-sm mb-4">
                No additional stations yet. Single-station departments can skip this step.
              </p>
              <button
                onClick={() => setRows([makeStation()])}
                className="btn-primary inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                Add a Station
              </button>
            </div>
          ) : (
            <div className="space-y-4 mb-4">
              {rows.map((row, index) => (
                <div key={row.id} className="card p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-theme-text-primary">
                      Station {index + 2}
                    </h3>
                    <button
                      onClick={() => setRows(prev => prev.filter(r => r.id !== row.id))}
                      className="text-theme-text-muted hover:text-red-500 transition-colors mobile-touch-target"
                      aria-label={`Remove station ${index + 2}`}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className={labelClass} htmlFor={`name-${row.id}`}>
                        Station Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        id={`name-${row.id}`}
                        className={inputClass}
                        value={row.name}
                        onChange={e => updateRow(row.id, 'name', e.target.value)}
                        placeholder="North Station"
                      />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor={`number-${row.id}`}>
                        Station Number
                      </label>
                      <input
                        id={`number-${row.id}`}
                        className={inputClass}
                        value={row.stationNumber}
                        onChange={e => updateRow(row.id, 'stationNumber', e.target.value)}
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
                        onChange={e => updateRow(row.id, 'address', e.target.value)}
                        placeholder="450 Oak Avenue"
                      />
                    </div>

                    <div>
                      <label className={labelClass} htmlFor={`city-${row.id}`}>City</label>
                      <input
                        id={`city-${row.id}`}
                        className={inputClass}
                        value={row.city}
                        onChange={e => updateRow(row.id, 'city', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor={`state-${row.id}`}>State</label>
                      <input
                        id={`state-${row.id}`}
                        className={inputClass}
                        value={row.state}
                        onChange={e => updateRow(row.id, 'state', e.target.value)}
                        maxLength={50}
                      />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor={`zip-${row.id}`}>ZIP Code</label>
                      <input
                        id={`zip-${row.id}`}
                        className={inputClass}
                        value={row.zipCode}
                        onChange={e => updateRow(row.id, 'zipCode', e.target.value)}
                      />
                    </div>

                    <div>
                      <label className={labelClass} htmlFor={`phone-${row.id}`}>Phone</label>
                      <input
                        id={`phone-${row.id}`}
                        className={inputClass}
                        value={row.phone}
                        onChange={e => updateRow(row.id, 'phone', e.target.value)}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={labelClass} htmlFor={`email-${row.id}`}>Email</label>
                      <input
                        id={`email-${row.id}`}
                        type="email"
                        className={inputClass}
                        value={row.email}
                        onChange={e => updateRow(row.id, 'email', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ))}

              <button
                onClick={() => setRows(prev => [...prev, makeStation()])}
                className="w-full py-3 rounded-lg border border-dashed border-theme-surface-border text-theme-text-secondary hover:border-red-500/40 hover:text-theme-text-primary transition-colors inline-flex items-center justify-center gap-2 mobile-touch-target"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                Add Another Station
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
              Skip — one station only
            </button>
          </div>

          <div className="flex items-center justify-between mt-6">
            <BackButton to="/onboarding/start" />
            <ResetProgressButton />
          </div>

          <ProgressIndicator step="stations" className="mt-6 pt-6 border-t border-theme-nav-border" />
        </div>
      </main>

      <AutoSaveNotification showTimestamp lastSaved={lastSaved} className="mb-4" />
    </div>
  );
};

export default StationSetup;
