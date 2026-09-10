/**
 * Membership Tiers — the ladder a member climbs, and what each rung confers.
 *
 * This screen did not exist. `organization.settings["membership_tiers"]` had a
 * full API, three service methods on the frontend with no callers, and nothing
 * that rendered them — while `election_service` read the ladder in six places
 * to build the ballot electorate and a scheduled task advanced members along it
 * unattended, as `performed_by="system"`.
 *
 * So the shipped ladder — Probationary at 0 years, Active at 1, Senior at 10,
 * Life at 20, with voting switched on at Active behind a 50% meeting-attendance
 * rule and training exemption at Life — was every department's ladder unless
 * somebody made a raw settings API call. A department whose bylaws differ found
 * out at its first election, when the wrong people could or could not vote.
 *
 * The state lives in `useTierEditor`, shared with the setup wizard: this is the
 * ladder a department should state before its roster is loaded, and the same
 * screen has to be the one that maintains it afterwards.
 *
 * **A failed load is not an empty ladder**, and the distinction matters more
 * here than on the rank screen: an empty editor invites building a ladder from
 * scratch, and saving that would remove the rungs the roster is standing on.
 */

import React from 'react';
import { useTierEditor } from '../../../../hooks/useTierEditor';
import MembershipTiersSection from '../../../../components/settings/MembershipTiersSection';
import TierRefreshAlert from '../../../../components/settings/TierRefreshAlert';
import { SettingsPanelHead } from '../../../../components/settings/SettingsPanelHead';

const TiersSection: React.FC = () => {
  const editor = useTierEditor();

  return (
    <div className="space-y-6">
      <SettingsPanelHead
        title="Membership Tiers"
        description="The ladder your members progress through, and what each tier lets them do."
      />

      {editor.failed && !editor.loading ? (
        <div className="alert-danger" role="alert">
          <p className="text-theme-text-primary text-sm font-medium">The membership tiers could not be loaded.</p>
          <p className="text-theme-text-muted mt-1 text-sm">
            Nothing has changed — your tiers are not shown, not missing.
          </p>
          <button
            type="button"
            className="btn-secondary mobile-touch-target mt-3 px-4 text-sm font-medium"
            onClick={editor.retry}
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          {/* This screen drives the same hook as the setup wizard, so it has
              the same two failure states and must report both. It read only
              `failed` at first, which left a save whose read-back failed
              showing stale member counts behind a success toast. */}
          {editor.refreshFailed && (
            <TierRefreshAlert
              unconfirmedSave={editor.unconfirmedSave}
              dirty={editor.dirty}
              loading={editor.loading}
              onRefresh={editor.retry}
            />
          )}
          <MembershipTiersSection
            tiers={editor.tiers}
            autoAdvance={editor.autoAdvance}
            loading={editor.loading}
            saving={editor.saving}
            dirty={editor.dirty}
            memberCount={editor.memberCount}
            onSetAutoAdvance={editor.setAutoAdvance}
            onUpdateTier={editor.updateTier}
            onUpdateBenefits={editor.updateBenefits}
            onAddTier={editor.addTier}
            onRemoveTier={editor.removeTier}
            onMoveTier={editor.moveTier}
            onSave={() => {
              void editor.save();
            }}
            onReset={() => {
              void editor.reload();
            }}
          />
        </>
      )}
    </div>
  );
};

export default TiersSection;
