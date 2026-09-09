import React, { useEffect } from 'react';
import { Layers } from 'lucide-react';
import MembershipTiersSection from '../../../components/settings/MembershipTiersSection';
import { useTierEditor } from '../../../hooks/useTierEditor';

/**
 * The department's membership ladder, stated during setup.
 *
 * `organization.settings["membership_tiers"]` decides who is in the ballot
 * electorate, who may stand for office, whether a member must meet a
 * meeting-attendance threshold to vote, and who is graded for training — and a
 * nightly task advances members along it as `performed_by="system"`.
 *
 * It shipped with a ladder (Probationary at 0 years, Active at 1, Senior at 10,
 * Life at 20) and no screen anywhere: not in setup, not in Settings. A
 * department whose bylaws say Active at two years, or that Life Members keep
 * their vote, or that has no Probationary rung, got the shipped answer and
 * found out at its first election.
 *
 * Setup is the right moment for it because the ladder is answerable then and
 * expensive later: once the roster is loaded and members hold rungs, a rung
 * cannot be removed without moving those members first — which is correct, and
 * is work a department should not have been given by a default it never chose.
 */
interface MembershipLadderSectionProps {
  /**
   * Told whenever the ladder has edits that are not saved yet.
   *
   * Unlike the rank editor, where every action is its own write, tier edits are
   * batched and persisted by one Save — the endpoint takes the whole ladder, and
   * a per-rung save would make a half-applied ladder reachable. That makes it
   * possible to edit the ladder, press the step's Continue, and lose the lot
   * behind a "Positions configured successfully!" toast. The step guards its
   * Continue on this.
   */
  onDirtyChange?: (dirty: boolean) => void;
}

const MembershipLadderSection: React.FC<MembershipLadderSectionProps> = ({ onDirtyChange }) => {
  const editor = useTierEditor();

  useEffect(() => {
    onDirtyChange?.(editor.dirty);
  }, [editor.dirty, onDirtyChange]);

  return (
    <div className="card mb-6 p-6">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-800">
          <Layers className="h-5 w-5 text-white" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-theme-text-primary text-xl font-bold">Your Membership Ladder</h2>
          <p className="text-theme-text-secondary text-sm">
            How a member progresses through your department, and what each stage lets them do. This is the one to check
            against your bylaws — it decides who votes.
          </p>
        </div>
      </div>

      {editor.failed && !editor.loading ? (
        <div className="alert-danger" role="alert">
          <p className="text-theme-text-primary text-sm font-medium">The membership ladder could not be loaded.</p>
          <p className="text-theme-text-muted mt-1 text-sm">
            Nothing has changed — your tiers are not shown, not missing. You can carry on and set them up later under
            Members → Settings → Membership Tiers.
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
      )}
    </div>
  );
};

export default MembershipLadderSection;
