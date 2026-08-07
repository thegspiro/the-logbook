import React, { useMemo } from 'react';
import { useNavigate } from 'react-router';
import {
  PartyPopper,
  CheckCircle2,
  Users,
  MapPin,
  FileText,
  Calendar,
  ArrowRight,
  LayoutDashboard,
} from 'lucide-react';
import { OnboardingHeader } from '../components';
import { useOnboardingStore } from '../store';
import { getUserFacingModules } from '../config';

/**
 * Final onboarding screen.
 *
 * The wizard used to hand off straight to /dashboard, which for a brand-new
 * department is an empty page — no members, no stations, no apparatus, no
 * events. This screen closes the wizard by naming what was configured and
 * pointing at the department setup checklist, which is where the remaining
 * work actually lives.
 */
const SetupComplete: React.FC = () => {
  const navigate = useNavigate();
  const departmentName = useOnboardingStore(state => state.departmentName);
  const logoPreview = useOnboardingStore(state => state.logoData);
  const moduleStatuses = useOnboardingStore(state => state.moduleStatuses);
  const positionsConfig = useOnboardingStore(state => state.positionsConfig);
  const emailPlatform = useOnboardingStore(state => state.emailPlatform);
  const authPlatform = useOnboardingStore(state => state.authPlatform);
  const fileStoragePlatform = useOnboardingStore(state => state.fileStoragePlatform);
  const itTeamMembers = useOnboardingStore(state => state.itTeamMembers);

  const modules = useMemo(() => getUserFacingModules(), []);

  const enabledModuleNames = useMemo(
    () =>
      modules
        .filter(m => moduleStatuses[m.id] === 'enabled')
        .map(m => m.name),
    [modules, moduleStatuses]
  );

  const positionCount = positionsConfig ? Object.keys(positionsConfig).length : 0;
  const itContactCount = itTeamMembers.filter(m => m.name.trim() && m.email.trim()).length;

  const summary: Array<{ label: string; value: string }> = [
    { label: 'Modules enabled', value: String(enabledModuleNames.length) },
    { label: 'Positions defined', value: String(positionCount) },
    { label: 'Sign-in method', value: AUTH_LABELS[authPlatform ?? ''] || 'Username & password' },
    { label: 'Email platform', value: EMAIL_LABELS[emailPlatform ?? ''] || 'Not configured' },
    { label: 'File storage', value: STORAGE_LABELS[fileStoragePlatform ?? ''] || 'Local storage' },
    { label: 'IT contacts', value: String(itContactCount) },
  ];

  return (
    <div className="min-h-screen bg-linear-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to flex flex-col safe-top">
      <OnboardingHeader
        departmentName={departmentName || 'Your Department'}
        logoPreview={logoPreview}
        subtitle="Setup Complete"
      />

      <main className="flex-1 flex items-start justify-center p-4 py-10">
        <div className="max-w-3xl w-full space-y-8">
          {/* Confirmation */}
          <div className="text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
              <PartyPopper className="w-8 h-8 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            </div>
            <h2 className="text-3xl font-bold text-theme-text-primary">
              {departmentName ? `${departmentName} is set up` : 'Your department is set up'}
            </h2>
            <p className="text-theme-text-secondary mt-2 max-w-xl mx-auto">
              The application is configured and your administrator account is active. A few
              things still need your department&apos;s real data before members can use it.
            </p>
          </div>

          {/* What was configured */}
          <section className="card p-6" aria-labelledby="setup-summary-heading">
            <h3 id="setup-summary-heading" className="text-sm font-semibold text-theme-text-primary mb-4">
              What you configured
            </h3>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {summary.map(entry => (
                <div key={entry.label}>
                  <dt className="text-xs text-theme-text-muted">{entry.label}</dt>
                  <dd className="text-sm font-semibold text-theme-text-primary mt-0.5">
                    {entry.value}
                  </dd>
                </div>
              ))}
            </dl>
            {enabledModuleNames.length > 0 && (
              <p className="text-xs text-theme-text-muted mt-4 pt-4 border-t border-theme-surface-border">
                <CheckCircle2 className="w-3.5 h-3.5 inline-block mr-1 text-emerald-500" aria-hidden="true" />
                {enabledModuleNames.join(', ')}
              </p>
            )}
          </section>

          {/* What is left */}
          <section className="card p-6" aria-labelledby="next-steps-heading">
            <h3 id="next-steps-heading" className="text-sm font-semibold text-theme-text-primary mb-1">
              What&apos;s left
            </h3>
            <p className="text-xs text-theme-text-muted mb-4">
              Department Setup tracks these for you and marks each one done as the data lands.
            </p>
            <ul className="space-y-3">
              {NEXT_STEPS.map(step => (
                <li key={step.title} className="flex items-start gap-3">
                  <span className="w-8 h-8 rounded-lg bg-red-500/10 text-red-500 flex items-center justify-center shrink-0">
                    {step.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-theme-text-primary">{step.title}</p>
                    <p className="text-xs text-theme-text-muted">{step.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => void navigate('/setup')}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              Go to Department Setup
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              onClick={() => void navigate('/dashboard')}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover transition-colors mobile-touch-target"
            >
              <LayoutDashboard className="w-4 h-4" aria-hidden="true" />
              Skip to Dashboard
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

const NEXT_STEPS: Array<{ title: string; description: string; icon: React.ReactNode }> = [
  {
    title: 'Add your roster and get members signed in',
    description: 'Import members or add them manually, then send their logins.',
    icon: <Users className="w-4 h-4" aria-hidden="true" />,
  },
  {
    title: 'Add your stations and apparatus',
    description: 'Needed for event check-in, scheduling, and shift staffing.',
    icon: <MapPin className="w-4 h-4" aria-hidden="true" />,
  },
  {
    title: 'Upload SOPs and policies',
    description: 'Give members one place to find department documents.',
    icon: <FileText className="w-4 h-4" aria-hidden="true" />,
  },
  {
    title: 'Schedule your first event',
    description: 'A drill or business meeting members can RSVP to.',
    icon: <Calendar className="w-4 h-4" aria-hidden="true" />,
  },
];

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
