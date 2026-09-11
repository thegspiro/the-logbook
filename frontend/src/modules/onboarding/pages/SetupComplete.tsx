import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { PartyPopper, CheckCircle2, Circle, ArrowRight, LayoutDashboard, Loader2 } from 'lucide-react';
import { OnboardingHeader } from '../components';
import { useOnboardingStore } from '../store';
import { getUserFacingModules } from '../config';
import { organizationService } from '../../../services/api';
import type { SetupChecklistItem } from '../../../services/api';

/**
 * Final onboarding screen.
 *
 * The wizard used to hand off straight to /dashboard, which for a brand-new
 * department is an empty page — no members, no stations, no apparatus, no
 * events. This screen closes the wizard by naming what was configured and
 * pointing at the department setup checklist, which is where the remaining
 * work actually lives.
 *
 * "What's left" is read from that checklist rather than restated here. It used
 * to be a hardcoded list that named stations and apparatus as outstanding —
 * two steps the wizard had just collected — so the screen contradicted the
 * page its own button leads to. The backend already computes completion from
 * real counts (`GET /organization/setup-checklist`); this reports that
 * decision instead of re-deriving it.
 */
const SetupComplete: React.FC = () => {
  const navigate = useNavigate();
  const departmentName = useOnboardingStore((state) => state.departmentName);
  const logoPreview = useOnboardingStore((state) => state.logoData);
  const moduleStatuses = useOnboardingStore((state) => state.moduleStatuses);
  const positionsConfig = useOnboardingStore((state) => state.positionsConfig);
  const emailPlatform = useOnboardingStore((state) => state.emailPlatform);
  const authPlatform = useOnboardingStore((state) => state.authPlatform);
  const fileStoragePlatform = useOnboardingStore((state) => state.fileStoragePlatform);
  const itTeamMembers = useOnboardingStore((state) => state.itTeamMembers);

  const [remaining, setRemaining] = useState<SetupChecklistItem[] | null>(null);
  const [checklistState, setChecklistState] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    let cancelled = false;

    const loadRemaining = async () => {
      try {
        const data = await organizationService.getSetupChecklist();
        if (cancelled) return;
        // Essentials only: this screen is a send-off, not the whole checklist,
        // and the per-module items would bury the roster behind twenty rows.
        setRemaining(data.items.filter((item) => item.category === 'essential' && !item.is_complete));
        setChecklistState('ready');
      } catch {
        // Never block the send-off on it. The Department Setup button below
        // goes to the authoritative list either way.
        if (!cancelled) setChecklistState('unavailable');
      }
    };

    void loadRemaining();
    return () => {
      cancelled = true;
    };
  }, []);

  const modules = useMemo(() => getUserFacingModules(), []);

  const enabledModuleNames = useMemo(
    () => modules.filter((m) => moduleStatuses[m.id] === 'enabled').map((m) => m.name),
    [modules, moduleStatuses]
  );

  const positionCount = positionsConfig ? Object.keys(positionsConfig).length : 0;
  const itContactCount = itTeamMembers.filter((m) => m.name.trim() && m.email.trim()).length;

  const summary: Array<{ label: string; value: string }> = [
    { label: 'Modules enabled', value: String(enabledModuleNames.length) },
    { label: 'Positions defined', value: String(positionCount) },
    { label: 'Sign-in method', value: AUTH_LABELS[authPlatform ?? ''] || 'Username & password' },
    { label: 'Email platform', value: EMAIL_LABELS[emailPlatform ?? ''] || 'Not configured' },
    { label: 'File storage', value: STORAGE_LABELS[fileStoragePlatform ?? ''] || 'Local storage' },
    { label: 'IT contacts', value: String(itContactCount) },
  ];

  return (
    <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to safe-top flex min-h-screen flex-col bg-linear-to-br">
      <OnboardingHeader
        departmentName={departmentName || 'Your Department'}
        logoPreview={logoPreview}
        subtitle="Setup Complete"
      />

      <main id="main-content" tabIndex={-1} className="flex flex-1 items-start justify-center p-4 py-10">
        <div className="w-full max-w-3xl space-y-8">
          {/* Confirmation */}
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10">
              <PartyPopper className="h-8 w-8 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            </div>
            <h2 className="text-theme-text-primary text-3xl font-bold">
              {departmentName ? `${departmentName} is set up` : 'Your department is set up'}
            </h2>
            <p className="text-theme-text-secondary mx-auto mt-2 max-w-xl">
              The application is configured and your administrator account is active. A few things still need your
              department&apos;s real data before members can use it.
            </p>
          </div>

          {/* What was configured */}
          <section className="card p-6" aria-labelledby="setup-summary-heading">
            <h3 id="setup-summary-heading" className="text-theme-text-primary mb-4 text-sm font-semibold">
              What you configured
            </h3>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {summary.map((entry) => (
                <div key={entry.label}>
                  <dt className="text-theme-text-muted text-xs">{entry.label}</dt>
                  <dd className="text-theme-text-primary mt-0.5 text-sm font-semibold">{entry.value}</dd>
                </div>
              ))}
            </dl>
            {enabledModuleNames.length > 0 && (
              <p className="text-theme-text-muted border-theme-surface-border mt-4 border-t pt-4 text-xs">
                <CheckCircle2 className="mr-1 inline-block h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                {enabledModuleNames.join(', ')}
              </p>
            )}
          </section>

          {/* What is left — read from the checklist, never restated here */}
          <section className="card p-6" aria-labelledby="next-steps-heading">
            <h3 id="next-steps-heading" className="text-theme-text-primary mb-1 text-sm font-semibold">
              What&apos;s left
            </h3>
            <p className="text-theme-text-muted mb-4 text-xs">
              Department Setup tracks these for you and marks each one done as the data lands.
            </p>

            {checklistState === 'loading' && (
              <p className="text-theme-text-muted flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Checking what still needs your department&apos;s data…
              </p>
            )}

            {checklistState === 'unavailable' && (
              <p className="text-theme-text-muted text-sm">
                The remaining steps could not be loaded just now. Department Setup below has the current list.
              </p>
            )}

            {checklistState === 'ready' && remaining?.length === 0 && (
              <p className="text-theme-text-secondary flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                Every essential step is done. Department Setup has the optional ones for the modules you enabled.
              </p>
            )}

            {checklistState === 'ready' && remaining && remaining.length > 0 && (
              <ul className="space-y-3">
                {remaining.map((item) => (
                  <li key={item.key} className="flex items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-500">
                      <Circle className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => void navigate(item.path)}
                        className="text-theme-text-primary hover:text-theme-accent-red text-left text-sm font-medium underline-offset-2 hover:underline"
                      >
                        {item.title}
                      </button>
                      <p className="text-theme-text-muted text-xs">{item.description}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Actions */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => void navigate('/setup')}
              className="btn-primary flex flex-1 items-center justify-center gap-2"
            >
              Go to Department Setup
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              onClick={() => void navigate('/dashboard')}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover mobile-touch-target flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-3 transition-colors"
            >
              <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
              Skip to Dashboard
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

const AUTH_LABELS: Record<string, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
  authentik: 'Authentik',
  local: 'Username & password',
};

const EMAIL_LABELS: Record<string, string> = {
  gmail: 'Google Workspace',
  microsoft: 'Microsoft 365',
  selfhosted: 'SMTP',
  cloudflare: 'Cloudflare',
  other: 'Other',
};

const STORAGE_LABELS: Record<string, string> = {
  googledrive: 'Google Drive',
  onedrive: 'OneDrive',
  s3: 'Amazon S3',
  azure: 'Azure Blob Storage',
  gcs: 'Google Cloud Storage',
  local: 'Local storage',
  other: 'Other',
};

export default SetupComplete;
