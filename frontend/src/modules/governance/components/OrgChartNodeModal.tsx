import React, { useEffect, useMemo, useState } from 'react';

import { Modal } from '../../../components/Modal';
import type { OrgChartMemberOption, OrgChartNode } from '../types/orgChart';

export interface OrgChartNodeDraft {
  title: string;
  userId: string;
  displayName: string;
  responsibility: string;
  contactEmail: string;
  contactPhone: string;
  isPublished: boolean;
}

interface OrgChartNodeModalProps {
  isOpen: boolean;
  /** Set when editing; absent when adding a position. */
  editingNode?: OrgChartNode | undefined;
  /** The seat the new position will report to, for the explanatory copy. */
  parentTitle?: string | undefined;
  members: OrgChartMemberOption[];
  isSaving: boolean;
  onCancel: () => void;
  onSave: (draft: OrgChartNodeDraft) => Promise<void>;
}

const EMPTY_DRAFT: OrgChartNodeDraft = {
  title: '',
  userId: '',
  displayName: '',
  responsibility: '',
  contactEmail: '',
  contactPhone: '',
  isPublished: true,
};

/**
 * Editor for one seat on the organizational chart.
 *
 * The title is the department's real one ("Fire Chief", "Training Committee
 * Chair"), not an application role — the two hierarchies disagree often enough
 * that the copy here says so, because an admin who assumes the chart is
 * generated from positions will not understand why it stays empty.
 */
export const OrgChartNodeModal: React.FC<OrgChartNodeModalProps> = ({
  isOpen,
  editingNode,
  parentTitle,
  members,
  isSaving,
  onCancel,
  onSave,
}) => {
  const [draft, setDraft] = useState<OrgChartNodeDraft>(EMPTY_DRAFT);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Reseed on every open: a name typed for one seat must not be filed against
  // the next one the admin opens.
  useEffect(() => {
    if (!isOpen) return;
    setValidationError(null);
    setDraft(
      editingNode
        ? {
            title: editingNode.title,
            userId: editingNode.userId ?? '',
            // Seeded from the stored override, not the resolved holder name —
            // seeding from the resolved one would turn every linked member's
            // name into a typed override the moment Save was pressed.
            displayName: editingNode.displayName ?? '',
            responsibility: editingNode.responsibility ?? '',
            contactEmail: editingNode.contactEmail ?? '',
            contactPhone: editingNode.contactPhone ?? '',
            isPublished: editingNode.isPublished,
          }
        : EMPTY_DRAFT
    );
  }, [isOpen, editingNode]);

  const sortedMembers = useMemo(() => [...members].sort((a, b) => a.name.localeCompare(b.name)), [members]);

  const handleSave = async () => {
    if (!draft.title.trim()) {
      setValidationError('Give the position a title.');
      return;
    }
    setValidationError(null);
    await onSave({
      ...draft,
      title: draft.title.trim(),
      displayName: draft.displayName.trim(),
      responsibility: draft.responsibility.trim(),
      contactEmail: draft.contactEmail.trim(),
      contactPhone: draft.contactPhone.trim(),
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={editingNode ? `Edit ${editingNode.title}` : 'Add a position'}
      size="lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-icon px-4" onClick={onCancel} disabled={isSaving}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save position'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {!editingNode && parentTitle ? (
          <p className="alert-info text-sm">This position will report to {parentTitle}.</p>
        ) : null}

        <div>
          <label className="form-label" htmlFor="org-node-title">
            Position title
          </label>
          <input
            id="org-node-title"
            className="form-input"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="e.g. Training Officer"
          />
          <p className="text-theme-text-muted mt-2 text-xs">
            The department&rsquo;s real title, as members would say it. This chart is maintained by hand and is not tied
            to anyone&rsquo;s application role or permissions.
          </p>
        </div>

        <div>
          <label className="form-label" htmlFor="org-node-member">
            Who holds it
          </label>
          <select
            id="org-node-member"
            className="form-input"
            value={draft.userId}
            onChange={(e) => setDraft({ ...draft, userId: e.target.value })}
          >
            <option value="">Vacant, or someone without a login</option>
            {sortedMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="form-label" htmlFor="org-node-display-name">
            Show this name instead (optional)
          </label>
          <input
            id="org-node-display-name"
            className="form-input"
            value={draft.displayName}
            onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
            placeholder="e.g. Chaplain J. Alvarez"
          />
          <p className="text-theme-text-muted mt-2 text-xs">
            For a holder with no account — a board member, a mutual-aid liaison — or to announce a linked member
            differently. Leave blank to use the member&rsquo;s own name.
          </p>
        </div>

        <div>
          <label className="form-label" htmlFor="org-node-responsibility">
            What is this position in charge of?
          </label>
          <textarea
            id="org-node-responsibility"
            className="form-input min-h-24"
            value={draft.responsibility}
            onChange={(e) => setDraft({ ...draft, responsibility: e.target.value })}
            placeholder="e.g. Drill scheduling, certification tracking, and the annual training plan."
          />
          <p className="text-theme-text-muted mt-2 text-xs">
            This is the line a member reads when they are trying to work out who to ask. Say it the way you would say it
            to a probationary member.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="form-label" htmlFor="org-node-email">
              Contact email (optional)
            </label>
            <input
              id="org-node-email"
              type="email"
              className="form-input"
              value={draft.contactEmail}
              onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value })}
              placeholder="e.g. training@department.org"
            />
          </div>
          <div>
            <label className="form-label" htmlFor="org-node-phone">
              Contact phone (optional)
            </label>
            <input
              id="org-node-phone"
              className="form-input"
              value={draft.contactPhone}
              onChange={(e) => setDraft({ ...draft, contactPhone: e.target.value })}
              placeholder="e.g. 555-0142 ext. 3"
            />
          </div>
        </div>
        <p className="text-theme-text-muted text-xs">
          These are the position&rsquo;s published details and are shown to every member. Nothing is copied from the
          holder&rsquo;s own profile — their personal email and phone stay governed by the department&rsquo;s contact
          visibility setting.
        </p>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="form-checkbox mt-0.5"
            checked={draft.isPublished}
            onChange={(e) => setDraft({ ...draft, isPublished: e.target.checked })}
          />
          <span className="text-theme-text-secondary text-sm">
            Show this position to the membership.
            <span className="text-theme-text-muted block text-xs">
              Turn it off to build out a reorganisation first. Hidden positions hide everyone reporting to them too.
            </span>
          </span>
        </label>

        {validationError ? (
          <p className="alert-error text-sm" role="alert">
            {validationError}
          </p>
        ) : null}
      </div>
    </Modal>
  );
};
