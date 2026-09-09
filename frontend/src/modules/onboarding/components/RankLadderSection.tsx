import React, { useEffect, useState } from 'react';
import { Info, Shield } from 'lucide-react';
import toast from 'react-hot-toast';
import RanksSettingsSection from '../../../components/settings/RanksSettingsSection';
import { useRankEditor } from '../../../hooks/useRankEditor';
import { userService } from '../../../services/api';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';

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
interface RankLadderSectionProps {
  /**
   * Told whenever a rank add or edit is typed but not yet saved.
   *
   * Unlike the ladder's other actions, which each write on their own, Add Rank
   * and Edit Rank hold their value in a local form until the nested Add/Save
   * button is pressed. Pressing the *step's* Continue instead unmounts this
   * section and discards it — the same silent loss the membership ladder's
   * guard exists to prevent, one section over. The step guards its Continue on
   * this.
   */
  onPendingChange?: (pending: boolean) => void;
}

const RankLadderSection: React.FC<RankLadderSectionProps> = ({ onPendingChange }) => {
  const editor = useRankEditor({ allowCodeEdit: false });

  // A form is pending only once something has been typed into it: opening Add
  // Rank and thinking better of it is not unsaved work, and blocking Continue
  // on an empty box would be a guard nobody could satisfy without noticing the
  // box was open at all.
  const rankFormPending =
    (editor.addingRank || editor.editingRank !== null) && editor.rankForm.display_name.trim().length > 0;

  useEffect(() => {
    onPendingChange?.(rankFormPending);
  }, [rankFormPending, onPendingChange]);

  // The System Owner's own rank. They are a real signed-in account by this
  // step — created two steps earlier — so this writes straight through the
  // ordinary profile endpoint, which validates the code against the
  // department's ladder and enforces the permission-grant ceiling. Doing it
  // here rather than on the account step is deliberate: the ladder has to
  // exist, and be the department's own, before there is a right answer.
  const currentUser = useAuthStore((state) => state.user);
  const loadUser = useAuthStore((state) => state.loadUser);
  const [ownRank, setOwnRank] = useState('');
  const [savingOwnRank, setSavingOwnRank] = useState(false);

  useEffect(() => {
    setOwnRank(currentUser?.rank ?? '');
  }, [currentUser?.rank]);

  const saveOwnRank = async (rank: string) => {
    if (!currentUser) return;
    const previous = ownRank;
    setOwnRank(rank);
    setSavingOwnRank(true);
    try {
      await userService.updateUserProfile(currentUser.id, { rank });
      await loadUser();
      toast.success(rank ? 'Your rank was set' : 'Your rank was cleared');
    } catch (err: unknown) {
      setOwnRank(previous);
      toast.error(getErrorMessage(err, 'Failed to set your rank'));
    } finally {
      setSavingOwnRank(false);
    }
  };

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
              Most access comes from a position &mdash; but the built-in ranks carry some too
            </p>
            <p className="text-theme-text-secondary text-sm">
              A rank says where somebody sits in the department and which shift seats they can fill, and the positions
              you choose below are where the bulk of what a member can <em>do</em> comes from. The built-in ranks are
              the exception: each carries a set of default permissions of its own, which a member holding that rank
              keeps whatever position they have. So restricting a position does not restrict a chief. A rank you add
              yourself carries none, and is marked <strong>No default permissions</strong> to say so &mdash; give those
              members a position too.
            </p>
          </div>
        </div>
      </div>

      {editor.failed && !editor.ranksLoading ? (
        <div className="alert-danger" role="alert">
          <p className="text-theme-text-primary text-sm font-medium">The rank ladder could not be loaded.</p>
          <p className="text-theme-text-muted mt-1 text-sm">
            Nothing has changed — your ranks are not shown, not missing. You can carry on and set the ladder up later
            under Members → Settings → Operational Ranks.
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
      )}

      {currentUser && (
        <div className="border-theme-surface-border mt-6 border-t pt-4">
          <label htmlFor="system-owner-rank" className="text-theme-text-primary block text-sm font-medium">
            Your rank
          </label>
          <p className="text-theme-text-muted mt-1 mb-2 text-xs">
            Optional, and separate from your System Owner position — that keeps its full access either way.
          </p>
          <select
            id="system-owner-rank"
            value={ownRank}
            disabled={savingOwnRank}
            onChange={(e) => {
              void saveOwnRank(e.target.value);
            }}
            className="form-input max-w-xs"
          >
            <option value="">No rank</option>
            {editor.ranks.map((rank) => (
              <option key={rank.id} value={rank.rank_code}>
                {rank.display_name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};

export default RankLadderSection;
