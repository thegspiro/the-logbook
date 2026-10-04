/**
 * Asked on every save of an existing training requirement: does this change
 * reach everyone, or only members who join from a given date?
 *
 * "New members only" keeps the requirement as it stands for the existing
 * roster and creates a copy carrying the change for new members, so a chief
 * can raise the standard without turning the department non-compliant
 * overnight. A three-way choice (cancel, everyone, new members) with a date,
 * which is why this is not `useConfirm()` — a confirm's false cannot tell
 * "everyone" from "cancel".
 */

import React, { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { RequirementChangeScope } from '@/constants/enums';

export interface ChangeScopeDialogProps {
  isOpen: boolean;
  /** Today in the department's timezone, YYYY-MM-DD; the default effective date. */
  today: string;
  /**
   * Why "new members only" is unavailable, or null when it is offered. Shown in
   * place of the option so the chief knows what to do instead.
   */
  newMembersUnavailableReason: string | null;
  onCancel: () => void;
  onChoose: (scope: RequirementChangeScope, effectiveDate?: string) => void;
}

export const ChangeScopeDialog: React.FC<ChangeScopeDialogProps> = ({
  isOpen,
  today,
  newMembersUnavailableReason,
  onCancel,
  onChoose,
}) => {
  const [scope, setScope] = useState<RequirementChangeScope>(RequirementChangeScope.EVERYONE);
  const [effectiveDate, setEffectiveDate] = useState(today);

  // Reset on each open: a choice made for one save must not carry into the next.
  useEffect(() => {
    if (isOpen) {
      setScope(RequirementChangeScope.EVERYONE);
      setEffectiveDate(today);
    }
  }, [isOpen, today]);

  const newMembers = scope === RequirementChangeScope.NEW_MEMBERS_ONLY;
  const missingDate = newMembers && !effectiveDate;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title="Who does this change apply to?"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 transition-colors"
          >
            Keep editing
          </button>
          <button
            type="button"
            disabled={missingDate}
            onClick={() => onChoose(scope, newMembers ? effectiveDate : undefined)}
            className="btn-primary font-medium disabled:opacity-50"
          >
            {newMembers ? 'Save for new members' : 'Save for everyone'}
          </button>
        </div>
      }
    >
      <div className="modal-body space-y-3" role="radiogroup" aria-label="Who the change applies to">
        <label className="border-theme-surface-border flex cursor-pointer items-start gap-3 rounded-lg border p-3">
          <input
            type="radio"
            name="change-scope"
            className="mt-1"
            checked={scope === RequirementChangeScope.EVERYONE}
            onChange={() => setScope(RequirementChangeScope.EVERYONE)}
          />
          <span>
            <span className="text-theme-text-primary block font-medium">Everyone</span>
            <span className="text-theme-text-muted block text-sm">
              Update this requirement for every member it applies to, starting now.
            </span>
          </span>
        </label>

        {newMembersUnavailableReason ? (
          <p className="text-theme-text-muted border-theme-surface-border rounded-lg border border-dashed p-3 text-sm">
            {newMembersUnavailableReason}
          </p>
        ) : (
          <label className="border-theme-surface-border flex cursor-pointer items-start gap-3 rounded-lg border p-3">
            <input
              type="radio"
              name="change-scope"
              className="mt-1"
              checked={newMembers}
              onChange={() => setScope(RequirementChangeScope.NEW_MEMBERS_ONLY)}
            />
            <span className="flex-1">
              <span className="text-theme-text-primary block font-medium">New members only</span>
              <span className="text-theme-text-muted block text-sm">
                Members who joined before the date below stay on the current standard. A copy of this requirement with
                your changes applies to everyone who joins on or after it.
              </span>
            </span>
          </label>
        )}

        {newMembers && (
          <div>
            <label htmlFor="change-scope-date" className="form-label">
              New standard applies to members who joined on or after
            </label>
            <input
              id="change-scope-date"
              type="date"
              className="form-input"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              aria-invalid={missingDate}
            />
            <p className="text-theme-text-muted mt-1 text-xs">
              A member&rsquo;s join date is their hire date, or the date their account was created if no hire date is
              recorded. Both requirements stay on the list and can be edited separately.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
};
