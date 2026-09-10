/**
 * Operational Ranks — the department's rank ladder and which shift positions
 * each rung may fill.
 *
 * The ladder lived on the global settings screen, where its state, its six
 * handlers and its loader were threaded through `SettingsPage` alongside email
 * credentials and storage providers. That is why this file exists rather than a
 * `<RanksSettingsSection {...fifteenProps} />` at a new address: a section that
 * cannot be moved without moving fifteen props is a section that is not really
 * its own screen. `RanksSettingsSection` stays exactly as it was — it renders,
 * and this owns what it renders.
 *
 * The heading lives here, not in `RanksSettingsSection`. That component carried
 * its own `<h3>` because the global settings page mounted it bare; keeping both
 * showed the title twice, and keeping only the `<h3>` left it with no `<h2>`
 * above it, which the accessibility pass counts as a heading-order jump. One
 * `SettingsPanelHead`, at the level every other section uses.
 *
 * **A failed load is not an empty ladder.** The version this replaces caught the
 * load error into `/* empty state shown *\/`, so an unreachable API rendered
 * "No ranks configured yet" — a department being told it has no rank structure
 * because a request failed. Every rung it does have is still in the database,
 * and members still hold them.
 *
 * That has two layers, and only fixing the outer one leaves the bug intact:
 * a *malformed* response never reaches the catch at all, because
 * `ranksService.getRanks` funnels it through `asArray` and hands back `[]`.
 * This reads through `getRankLadder`, which does not.
 *
 * The state and the six handlers now live in `useRankEditor`, because the setup
 * wizard renders this same editor while a department describes the ladder it
 * already uses — and it is the ladder that arrives on day one, so it must be
 * the same code that maintains it afterwards. This screen keeps what is its
 * own: the heading, and the failure state above.
 */

import React from 'react';
import { useRankEditor } from '../../../../hooks/useRankEditor';
import { useAuthStore } from '../../../../stores/authStore';
import RanksSettingsSection from '../../../../components/settings/RanksSettingsSection';
import { SettingsPanelHead } from '../../../../components/settings/SettingsPanelHead';

const RanksSection: React.FC = () => {
  const editor = useRankEditor();
  const checkPermission = useAuthStore((state) => state.checkPermission);

  // Not the grant this section stands on. A rank's sort_order is read by the
  // inventory rule as a predicate — a lower number is treated as more senior —
  // so placing a rank decides who sees restricted stock, and ordering kept
  // `settings.manage` when the ladder's contents moved to `members.manage`.
  // The controls have to follow the endpoint: offered to an officer it refuses,
  // every click moved the row optimistically, failed, and snapped back.
  const canReorder = checkPermission('settings.manage');

  return (
    <div className="space-y-6">
      <SettingsPanelHead
        title="Operational Ranks"
        description="Customize rank and position choices for your department. Higher ranks appear first."
      />

      {editor.failed && !editor.ranksLoading ? (
        <div className="alert-danger" role="alert">
          <p className="text-theme-text-primary text-sm font-medium">The rank ladder could not be loaded.</p>
          <p className="text-theme-text-muted mt-1 text-sm">
            Nothing has changed — the ranks below are not shown, not missing.
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
        <RanksSettingsSection
          ranks={editor.ranks}
          ranksLoading={editor.ranksLoading}
          editingRank={editor.editingRank}
          addingRank={editor.addingRank}
          rankForm={editor.rankForm}
          rankSaving={editor.rankSaving}
          deletingRankId={editor.deletingRankId}
          editingPositionsRankId={editor.editingPositionsRankId}
          rankValidationIssues={editor.rankValidationIssues}
          seatOptions={editor.seatOptions}
          onSetEditingRank={editor.setEditingRank}
          onSetAddingRank={editor.setAddingRank}
          onSetRankForm={editor.setRankForm}
          onSetEditingPositionsRankId={editor.setEditingPositionsRankId}
          onAddRank={() => {
            void editor.handleAddRank();
          }}
          onUpdateRank={() => {
            void editor.handleUpdateRank();
          }}
          onDeleteRank={(id) => {
            void editor.handleDeleteRank(id);
          }}
          onMoveRank={(index, direction) => {
            void editor.handleMoveRank(index, direction);
          }}
          canReorder={canReorder}
          onToggleEligiblePosition={(rank, pos) => {
            void editor.handleToggleEligiblePosition(rank, pos);
          }}
        />
      )}
    </div>
  );
};

export default RanksSection;
