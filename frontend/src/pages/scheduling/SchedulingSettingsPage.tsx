/**
 * Scheduling Settings Page
 *
 * Standalone admin page for scheduling settings.
 * Wraps the existing ShiftSettingsPanel component with page chrome and back navigation.
 */

import React from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Settings, Loader2 } from 'lucide-react';
import { ShiftSettingsPanel } from '../../modules/scheduling/components/ShiftSettingsPanel';
import type { SettingsTab } from '../../modules/scheduling/components/ShiftSettingsPanel';
import { useSchedulingStore } from '../../modules/scheduling/store/schedulingStore';

const VALID_TABS: SettingsTab[] = [
  'general',
  'apparatus',
  'platoons',
  'eligibility',
  'notifications',
  'equipment',
  'shift-reports',
];

const SchedulingSettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') || '';
  const defaultTab = (VALID_TABS as string[]).includes(tabParam) ? (tabParam as SettingsTab) : undefined;
  const {
    templates: backendTemplates,
    apparatus: apparatusList,
    templatesLoaded,
    loadInitialData,
  } = useSchedulingStore();

  React.useEffect(() => {
    if (!templatesLoaded) {
      void loadInitialData();
    }
  }, [templatesLoaded, loadInitialData]);

  return (
    <div className="bg-theme-bg min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={() => void navigate('/scheduling')}
            className="hover:bg-theme-surface-hover text-theme-text-muted rounded-lg p-1.5"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-violet-500" />
            <h1 className="text-theme-text-primary text-xl font-bold">Scheduling Settings</h1>
          </div>
        </div>
        {!templatesLoaded ? (
          <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
            <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
          </div>
        ) : (
          <ShiftSettingsPanel
            templates={backendTemplates}
            apparatusList={apparatusList}
            onNavigateToTemplates={() => void navigate('/scheduling/templates')}
            defaultTab={defaultTab}
          />
        )}
      </div>
    </div>
  );
};

export default SchedulingSettingsPage;
