/**
 * EVOC Levels — the driver certification ladder.
 *
 * `EvocLevelsSettingsSection` already owned its own fetching and state, so this
 * is only the heading and the route's claim on it.
 *
 * The heading lives here rather than in that component, for the reason its
 * sibling's does: it carried its own `<h3>` because the global settings page
 * mounted it bare, so after the move the title rendered twice — and dropping the
 * wrapper's instead would leave the `<h3>` with no `<h2>` above it, a
 * heading-order jump. This route is exempt from the mobile ratchet, which is why
 * the accessibility pass caught that on the rank ladder and not here.
 *
 * **Its grant is `apparatus.manage`, not `members.manage`.** The levels are
 * served by the apparatus API, and completing a level's training program
 * auto-creates operator records on every apparatus requiring that level or
 * lower. The section sits here because an officer looking for "who may drive
 * what" looks at the roster, but the endpoint's answer is the apparatus one and
 * `membersSettingsSections.ts` records it as such — a members officer without
 * the apparatus grant is never offered this section rather than being offered
 * one that 403s on every write.
 */

import React from 'react';
import EvocLevelsSettingsSection from '../../../../components/settings/EvocLevelsSettingsSection';
import { SettingsPanelHead } from '../../../../components/settings/SettingsPanelHead';

const EvocSection: React.FC = () => (
  <div className="space-y-6">
    <SettingsPanelHead title="EVOC Levels" description="Driver certification ladder and certifying programs." />
    <EvocLevelsSettingsSection />
  </div>
);

export default EvocSection;
