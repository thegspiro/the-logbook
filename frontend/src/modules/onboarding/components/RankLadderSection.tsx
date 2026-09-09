import React from 'react';
import { Info, Shield } from 'lucide-react';
import RanksSettingsSection from '../../../components/settings/RanksSettingsSection';
import { useRankEditor } from '../../../hooks/useRankEditor';

/**
 * The department's rank ladder, edited during setup.
 *
 * Ranks used to be seeded lazily — the first time anyone loaded the rank list
 * after setup — and `seed_defaults` only ever fires into an empty table, so
 * whatever it wrote on day one was what the department lived with. A service
 * that calls its Engineer a Driver/Operator, runs Battalion Chiefs, or splits
 * Firefighter I from II found the imposed ladder later, in Settings, usually
 * after members had already been assigned to it.
 *
 * Loading this step seeds the agency-appropriate defaults and then lets the
 * department say what it actually uses, before anyone holds a rank.
 *
 * It renders the same editor as Settings, driven by the same hook, with one
 * difference: rank codes are not editable here. A code is the runtime key the
 * backend resolves default permissions against, so changing a seeded one
 * silently stops that rank conferring anything — and setup is the worst place
 * for that to happen, because there is no "before" to notice the change
 * against.
 */
const RankLadderSection: React.FC = () => {
  const editor = useRankEditor({ allowCodeEdit: false, autoLoad: true });

  return (
    <div className="card mb-6 p-6">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-800">
          <Shield className="h-5 w-5 text-white" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-theme-text-primary text-xl font-bold">Your Rank Ladder</h2>
          <p className="text-theme-text-secondary text-sm">
            These are the ranks your members hold. We have started you with the ones most departments use — rename them
            to match what yours calls them, reorder them, remove any you do not have, and add your own.
          </p>
        </div>
      </div>

      <div className="alert-info mb-4">
        <div className="flex items-start">
          <Info className="text-theme-alert-info-icon mt-0.5 mr-3 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-theme-alert-info-title mb-1 font-semibold">
              Ranks describe standing, positions grant access
            </p>
            <p className="text-theme-text-secondary text-sm">
              A rank says where somebody sits in the department and which shift seats they can fill. What they can{' '}
              <em>do</em> in the app comes from their position, which you choose below. A rank you add yourself is
              marked <strong>No default permissions</strong> for exactly that reason — give those members a position
              too.
            </p>
          </div>
        </div>
      </div>

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
        allowCodeEdit={false}
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
        onDeleteRank={(rankId) => {
          void editor.handleDeleteRank(rankId);
        }}
        onMoveRank={(index, direction) => {
          void editor.handleMoveRank(index, direction);
        }}
        onToggleEligiblePosition={(rank, position) => {
          void editor.handleToggleEligiblePosition(rank, position);
        }}
      />
    </div>
  );
};

export default RankLadderSection;
