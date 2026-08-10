/**
 * Scheduling Settings Page
 *
 * Admin page for department-wide scheduling settings. Owns the section
 * navigation (via the shared SettingsLayout) and the section's URL mirror;
 * ShiftSettingsPanel renders the active section's content.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { ShiftSettingsPanel } from '../../modules/scheduling/components/ShiftSettingsPanel';
import { SCHEDULING_SETTINGS_SECTIONS } from '../../modules/scheduling/components/schedulingSettingsSections';
import type { SettingsTab } from '../../modules/scheduling/components/schedulingSettingsSections';
import { SettingsLayout } from '../../components/settings/SettingsLayout';
import { useSchedulingStore } from '../../modules/scheduling/store/schedulingStore';

const isSettingsTab = (value: string | null): value is SettingsTab =>
  value !== null && SCHEDULING_SETTINGS_SECTIONS.some((s) => s.key === value);

const SchedulingSettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    templates: backendTemplates,
    apparatus: apparatusList,
    templatesLoaded,
    loadInitialData,
  } = useSchedulingStore();
  const platoonsEnabled = useSchedulingStore((s) => s.platoonsEnabled);

  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<SettingsTab>(isSettingsTab(tabParam) ? tabParam : 'general');

  // Selecting a section writes it to the URL, so a settings screen can be
  // linked to, refreshed, and reached with the back button.
  const handleTabChange = useCallback(
    (tab: SettingsTab) => {
      setActiveTab(tab);
      const next = new URLSearchParams(searchParams);
      if (tab === 'general') {
        next.delete('tab');
      } else {
        next.set('tab', tab);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  useEffect(() => {
    const param = searchParams.get('tab');
    if (isSettingsTab(param)) {
      setActiveTab(param);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!templatesLoaded) {
      void loadInitialData();
    }
  }, [templatesLoaded, loadInitialData]);

  // Platoons is only a section once the department has turned platoon
  // scheduling on; the General section holds the toggle that reveals it.
  const sections = useMemo(
    () => SCHEDULING_SETTINGS_SECTIONS.filter((s) => s.key !== 'platoons' || platoonsEnabled),
    [platoonsEnabled]
  );

  // Derived rather than corrected in state: platoonsEnabled arrives from the
  // API a beat after mount, so resetting activeTab on a ?tab=platoons deep link
  // would bounce the user off the section they asked for, before the setting
  // that permits it has even loaded. Falling back for this render instead lets
  // the section appear once the flag resolves.
  const visibleTab = sections.some((s) => s.key === activeTab) ? activeTab : 'general';

  const header = (
    <div className="mb-8 flex items-start gap-3">
      <button
        onClick={() => void navigate('/scheduling')}
        className="hover:bg-theme-surface-hover text-theme-text-muted mt-1 rounded-lg p-1.5"
        aria-label="Back to scheduling"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <div>
        <h1 className="text-theme-text-primary text-2xl font-bold">Scheduling Settings</h1>
        <p className="text-theme-text-muted mt-1 text-sm">Configure department-wide defaults for shift scheduling.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      <SettingsLayout
        sections={sections}
        activeSection={visibleTab}
        onSectionChange={handleTabChange}
        navLabel="Scheduling settings sections"
        header={header}
      >
        {!templatesLoaded ? (
          <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
            <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
          </div>
        ) : (
          <ShiftSettingsPanel
            templates={backendTemplates}
            apparatusList={apparatusList}
            onNavigateToTemplates={() => void navigate('/scheduling/templates')}
            activeTab={visibleTab}
            onTabChange={handleTabChange}
          />
        )}
      </SettingsLayout>
    </div>
  );
};

export default SchedulingSettingsPage;
