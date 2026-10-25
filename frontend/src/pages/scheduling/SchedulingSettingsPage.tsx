/**
 * Scheduling Settings Page
 *
 * One department-wide scheduling settings section. The section is a route, not
 * a tab: `/scheduling/admin/settings/general` and its five siblings each mount
 * this page with their own `section`, so a settings screen can be linked to,
 * bookmarked and reached with the back button. Selecting a section navigates.
 *
 * ShiftSettingsPanel renders the section's content. The section list and the
 * page chrome are the Scheduling Administration header
 * (`SchedulingAdminLayout`) every one of these routes is drawn inside.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { ShiftSettingsPanel } from '../../modules/scheduling/components/ShiftSettingsPanel';
import {
  SCHEDULING_SETTINGS_SECTIONS,
  settingsPathFor,
} from '../../modules/scheduling/components/schedulingSettingsSections';
import type { SettingsTab } from '../../modules/scheduling/components/schedulingSettingsSections';
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
  const settingsLoaded = useSchedulingStore((s) => s.settingsLoaded);
  const location = useLocation();
  const arrivedForPlatoons = (location.state as { platoonsOff?: boolean } | null)?.platoonsOff === true;

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

  // Once the setting has loaded and says platoons are off, the fallback above
  // is the answer rather than a holding state, so the URL follows it. Left on
  // /settings/platoons, the breadcrumb named a section the page was not
  // showing and nothing said why. Replace, not push: the platoons URL is not
  // somewhere the back button should return to.
  useEffect(() => {
    if (section === 'platoons' && settingsLoaded && !platoonsEnabled) {
      void navigate(settingsPathFor('general'), { replace: true, state: { platoonsOff: true } });
    }
  }, [section, settingsLoaded, platoonsEnabled, navigate]);

  const sectionLabel = sections.find((s) => s.key === visibleSection)?.label ?? 'General';

  // No SettingsLayout here, unlike the other settings screens. Every section
  // route is drawn inside the Scheduling Administration header, whose page
  // strip is the way between sections and whose strip line names the open one;
  // the shell's own section row, title and narrower centred column drew all of
  // that a second time beneath it. The body card is what is left of the shell.
  return (
    <div className="py-6">
      {/* The header names the section visibly; this keeps it in heading
          navigation, between the header's <h1> and the panel's <h3> cards. */}
      <h2 className="sr-only">Scheduling settings: {sectionLabel}</h2>
      <div data-page-main className="card p-3 sm:p-6">
        {!templatesLoaded ? (
          <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
            <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
          </div>
        ) : (
          <>
            {visibleSection === 'general' && arrivedForPlatoons && !platoonsEnabled && (
              <div className="alert-info mb-4" role="status">
                <p className="text-sm">
                  Platoon scheduling is turned off, so there are no platoon settings yet. Turn on platoon scheduling
                  below and Platoon Rosters appears among the Settings pages above.
                </p>
              </div>
            )}
            <ShiftSettingsPanel
              templates={backendTemplates}
              apparatusList={apparatusList}
              onNavigateToTemplates={() => void navigate('/scheduling/admin/planning/templates')}
              activeTab={visibleSection}
              onTabChange={handleSectionChange}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default SchedulingSettingsPage;
