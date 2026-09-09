/**
 * Members Settings — Contact Visibility and Membership IDs, in the module they
 * belong to.
 *
 * Both lived under a **Members** heading in the global settings page, beside
 * Email, Storage and Authentication: platform choices an administrator makes
 * once. These are neither. They are decisions about the roster, made by whoever
 * runs the roster, and every other thing that person does is under
 * `/members/admin`.
 *
 * **A section can be visible and still be refused.** Every route under
 * `/members/admin` stands on `members.manage`, but neither endpoint here accepts
 * it — see `membersSettingsSections.ts`. So the nav lists only the sections the
 * signed-in officer's grants actually admit, rather than showing both and
 * letting the save fail: a toggle that flips and then silently reverts is worse
 * than a section that was never offered, and this is the same defect that took
 * six rounds to settle on the scheduling close-out queue.
 */

import React from 'react';
import { Navigate, useNavigate } from 'react-router';
import { SettingsLayout } from '../../../../components/settings/SettingsLayout';
import { useAuthStore } from '../../../../stores/authStore';
import { useSettingsAutosave } from '../../../../hooks/useSettingsAutosave';
import { MEMBERS_SETTINGS_SECTIONS, type MembersSettingsTab, membersSettingsPathFor } from './membersSettingsSections';
import ContactVisibilitySection from './ContactVisibilitySection';
import MembershipIdSection from './MembershipIdSection';
import RanksSection from './RanksSection';
import EvocSection from './EvocSection';

interface MembersSettingsPageProps {
  /** Which section this route mounts. */
  section: MembersSettingsTab;
}

const MembersSettingsPage: React.FC<MembersSettingsPageProps> = ({ section }) => {
  const navigate = useNavigate();
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const { saveState, save, saveDebounced, retry } = useSettingsAutosave();

  // The hook's `save` returns a promise the sections have no use for, and
  // handing a promise-returning function to an `onChange` is the shape ESLint
  // flags — rightly, since a rejection there would go unhandled. The hook
  // already reports failure through `saveState`, so the promise is discarded
  // here rather than at each of the eight call sites.
  const saveVoid = (saver: () => Promise<unknown>): void => {
    void save(saver);
  };
  const saveDebouncedVoid = (key: string, saver: () => Promise<unknown>): void => {
    saveDebounced(key, saver);
  };

  const sections = MEMBERS_SETTINGS_SECTIONS.filter((entry) =>
    entry.permissions.some((permission) => checkPermission(permission))
  );

  // The route named a section this officer cannot save. Rendering it anyway
  // would offer controls the server refuses; falling through to the dashboard
  // would be the worst kind of broken link. The first section they *can* open is
  // the honest destination, and when they can open none the layout below says so
  // rather than showing an empty nav.
  const openable = sections.some((entry) => entry.key === section);
  const fallback = sections[0]?.key;

  // Redirected rather than rendered in place. Falling back silently left the
  // address bar and the breadcrumb naming EVOC while Operational Ranks was on
  // screen — and the hub lists every section unconditionally, so clicking "EVOC
  // Levels" without the apparatus grant landed exactly there. The URL has to
  // name what is being shown.
  if (openable === false && fallback) {
    return <Navigate to={membersSettingsPathFor(fallback)} replace />;
  }

  const visibleSection = openable ? section : fallback;

  if (!visibleSection) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-theme-text-primary text-lg font-semibold">Members Settings</h1>
        <p className="text-theme-text-muted mt-2 text-sm">
          These settings are changed by whoever administers the department&rsquo;s settings. Your account manages the
          roster but does not hold that grant.
        </p>
        <button
          type="button"
          className="btn-secondary mobile-touch-target mt-6 px-4 text-sm font-medium"
          onClick={() => void navigate('/members/admin')}
        >
          Back to members administration
        </button>
      </div>
    );
  }

  const handleSectionChange = (key: MembersSettingsTab) => {
    void navigate(membersSettingsPathFor(key));
  };

  // A switch rather than a ternary chain: `MembersSettingsTab` is exhaustive
  // here, so a section added to the manifest without a body is a compile error
  // rather than a page that silently renders contact visibility under someone
  // else's heading.
  const renderSection = () => {
    switch (visibleSection) {
      case 'ids':
        return <MembershipIdSection save={saveVoid} saveDebounced={saveDebouncedVoid} />;
      case 'ranks':
        return <RanksSection />;
      case 'evoc':
        return <EvocSection />;
      case 'visibility':
        return <ContactVisibilitySection save={saveVoid} />;
    }
  };

  return (
    <SettingsLayout<MembersSettingsTab>
      sections={sections}
      activeSection={visibleSection}
      onSectionChange={handleSectionChange}
      navLabel="Members settings sections"
      title="Members Settings"
      subtitle="What members see of each other, how they are numbered, and the ranks they hold"
      saveState={saveState}
      onRetrySave={retry}
      onBack={() => void navigate('/members/admin')}
      backLabel="Back to members administration"
      showBreadcrumbs
    >
      {renderSection()}
    </SettingsLayout>
  );
};

export default MembersSettingsPage;
