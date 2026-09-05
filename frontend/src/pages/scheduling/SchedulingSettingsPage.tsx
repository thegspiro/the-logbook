/**
 * Scheduling Settings Page
 *
 * One department-wide scheduling settings section. The section is a route, not
 * a tab: `/scheduling/admin/settings/general` and its five siblings each mount
 * this page with their own `section`, so a settings screen can be linked to,
 * bookmarked and reached with the back button. Selecting a section navigates.
 *
 * ShiftSettingsPanel renders the section's content; the section list and the
 * page chrome belong here.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { ShiftSettingsPanel } from '../../modules/scheduling/components/ShiftSettingsPanel';
import {
  SCHEDULING_SETTINGS_SECTIONS,
  settingsPathFor,
} from '../../modules/scheduling/components/schedulingSettingsSections';
import type { SettingsTab } from '../../modules/scheduling/components/schedulingSettingsSections';
import { SettingsLayout } from '../../components/settings/SettingsLayout';
import { useSchedulingStore } from '../../modules/scheduling/store/schedulingStore';

interface SchedulingSettingsPageProps {
  /** Which section this route mounts. */
  section: SettingsTab;
}

const SchedulingSettingsPage: React.FC<SchedulingSettingsPageProps> = ({ section }) => {
  const navigate = useNavigate();
  const {
    templates: backendTemplates,
    apparatus: apparatusList,
    templatesLoaded,
    loadInitialData,
  } = useSchedulingStore();
  const platoonsEnabled = useSchedulingStore((s) => s.platoonsEnabled);

  const handleSectionChange = useCallback(
    (tab: SettingsTab) => {
      void navigate(settingsPathFor(tab));
    },
    [navigate]
  );

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
  // API a beat after mount, so redirecting off /settings/platoons would bounce
  // the user out of the section they asked for, before the setting that permits
  // it has even loaded. Falling back for this render instead lets the section
  // appear once the flag resolves.
  const visibleSection = sections.some((s) => s.key === section) ? section : 'general';

  return (
    <div className="min-h-screen">
      <SettingsLayout<SettingsTab>
        sections={sections}
        activeSection={visibleSection}
        onSectionChange={handleSectionChange}
        navLabel="Scheduling settings sections"
        // Names the page, not the module: the module header said "Shift
        // Scheduling" on a screen whose subject is its settings.
        title="Scheduling Settings"
        subtitle="Department-wide scheduling defaults"
        onBack={() => void navigate('/scheduling/admin')}
        backLabel="Back to scheduling administration"
        // Six section routes sit three levels down, so the trail is the only
        // thing on the page that says so. The "Settings" crumb between the hub
        // and the section is a link: `/scheduling/admin/settings` redirects to
        // the General section rather than falling through to the dashboard.
        showBreadcrumbs
      >
        {!templatesLoaded ? (
          <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
            <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
          </div>
        ) : (
          <ShiftSettingsPanel
            templates={backendTemplates}
            apparatusList={apparatusList}
            onNavigateToTemplates={() => void navigate('/scheduling/admin/templates')}
            activeTab={visibleSection}
            onTabChange={handleSectionChange}
          />
        )}
      </SettingsLayout>
    </div>
  );
};

export default SchedulingSettingsPage;
