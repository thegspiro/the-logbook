import React, { useEffect, useMemo, useState } from 'react';

import { Modal } from '../../../components/Modal';
import type { OrgChartMemberOption, OrgChartNode } from '../types/orgChart';

export interface OrgChartNodeDraft {
  title: string;
  /** '' means this seat sits at the top of the chart. */
  parentId: string;
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
  /** Pre-selected parent when the editor was opened from a seat's "add report". */
  defaultParentId?: string | undefined;
  /** The whole chart, for the "Reports to" list. */
  nodes: OrgChartNode[];
  members: OrgChartMemberOption[];
  isSaving: boolean;
  onCancel: () => void;
  onSave: (draft: OrgChartNodeDraft) => Promise<void>;
}

/**
 * Sentinel for "held by somebody who has no account here".
 *
 * A first-class option rather than a blank-plus-override, because departments
 * routinely put people on the chart who will never log in — a board member, a
 * chaplain, a mutual-aid liaison, an auxiliary president. Expressing that as
 * "leave the picker empty and fill in a field labelled *instead*" reads as a
 * workaround for a case that is entirely normal.
 */
const EXTERNAL_HOLDER = '__external__';

const EMPTY_DRAFT: OrgChartNodeDraft = {
  title: '',
  parentId: '',
  userId: '',
  displayName: '',
  responsibility: '',
  contactEmail: '',
  contactPhone: '',
  isPublished: true,
};

/**
 * Every seat at or beneath `rootId`.
 *
 * Used to keep a seat out of its own "Reports to" list: the server refuses a
 * move that would make a position report to one of its own subordinates, and
 * offering the choice only to reject it is a worse answer than not offering it.
 */
const descendantsOf = (nodes: OrgChartNode[], rootId: string): Set<string> => {
  const childrenOf = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    childrenOf.set(node.parentId, [...(childrenOf.get(node.parentId) ?? []), node.id]);
  }
  const found = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const current = queue.shift() as string;
    for (const child of childrenOf.get(current) ?? []) {
      if (found.has(child)) continue;
      found.add(child);
      queue.push(child);
    }
  }
  return found;
};

/**
 * Editor for one seat on the organizational chart.
 *
 * Two things this screen deliberately does not borrow from the application's
 * own model of the department: the title is free text rather than a Position,
 * and the reporting line is whatever leadership picks rather than anything
 * derived from permissions. A department can put its Fundraising Committee
 * Chair under the President and its IT Manager under the Chief, neither of
 * which any Position row would tell you.
 */
export const OrgChartNodeModal: React.FC<OrgChartNodeModalProps> = ({
  isOpen,
  editingNode,
  defaultParentId,
  nodes,
  members,
  isSaving,
  onCancel,
  onSave,
}) => {
  const [draft, setDraft] = useState<OrgChartNodeDraft>(EMPTY_DRAFT);
  /** '', a member id, or EXTERNAL_HOLDER. */
  const [holderChoice, setHolderChoice] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  // Reseed on every open: a name typed for one seat must not be filed against
  // the next one the admin opens.
  useEffect(() => {
    if (!isOpen) return;
    setValidationError(null);
    if (editingNode) {
      setDraft({
        title: editingNode.title,
        parentId: editingNode.parentId ?? '',
        userId: editingNode.userId ?? '',
        // Seeded from the stored override, not the resolved holder name —
        // seeding from the resolved one would turn every linked member's name
        // into a typed override the moment Save was pressed.
        displayName: editingNode.displayName ?? '',
        responsibility: editingNode.responsibility ?? '',
        contactEmail: editingNode.contactEmail ?? '',
        contactPhone: editingNode.contactPhone ?? '',
        isPublished: editingNode.isPublished,
      });
      setHolderChoice(editingNode.userId ? editingNode.userId : editingNode.displayName ? EXTERNAL_HOLDER : '');
    } else {
      setDraft({ ...EMPTY_DRAFT, parentId: defaultParentId ?? '' });
      setHolderChoice('');
    }
  }, [isOpen, editingNode, defaultParentId]);

  const sortedMembers = useMemo(() => [...members].sort((a, b) => a.name.localeCompare(b.name)), [members]);

  /** Seats this one may report to: everything except itself and its own reports. */
  const parentOptions = useMemo(() => {
    const excluded = editingNode ? descendantsOf(nodes, editingNode.id) : new Set<string>();
    return nodes
      .filter((node) => !excluded.has(node.id))
      .map((node) => ({ id: node.id, label: `${'— '.repeat(node.depth)}${node.title}` }));
  }, [nodes, editingNode]);

  const isExternal = holderChoice === EXTERNAL_HOLDER;
  const linkedMember = sortedMembers.find((m) => m.id === holderChoice);

  const handleHolderChange = (value: string) => {
    setHolderChoice(value);
    setDraft((current) => ({
      ...current,
      userId: value === EXTERNAL_HOLDER || value === '' ? '' : value,
      // A holder cleared to vacant should not keep the previous holder's name
      // sitting in a hidden field, waiting to be republished on the next save.
      displayName: value === '' ? '' : current.displayName,
    }));
  };

  const handleSave = async () => {
    if (!draft.title.trim()) {
      setValidationError('Give the position a title.');
      return;
    }
    if (isExternal && !draft.displayName.trim()) {
      setValidationError('Enter the name of the person who holds this position.');
      return;
    }
    setValidationError(null);
    await onSave({
      ...draft,
      title: draft.title.trim(),
      userId: isExternal ? '' : draft.userId,
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
            The department&rsquo;s real title, as members would say it. It does not have to match a position or role
            that exists in this application — put down &ldquo;Fundraising Committee Chair&rdquo; or &ldquo;Station 2
            House Captain&rdquo; even if nothing in the software is called that.
          </p>
        </div>

        <div>
          <label className="form-label" htmlFor="org-node-parent">
            Reports to
          </label>
          <select
            id="org-node-parent"
            className="form-input"
            value={draft.parentId}
            onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}
          >
            <option value="">Top of the chart — reports to nobody</option>
            {parentOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="text-theme-text-muted mt-2 text-xs">
            Your department&rsquo;s real reporting line, which need not match anything in the application. A position
            cannot be listed under one of its own subordinates, so those are left out of this list.
          </p>
        </div>

        <div>
          <label className="form-label" htmlFor="org-node-holder">
            Who holds it
          </label>
          <select
            id="org-node-holder"
            className="form-input"
            value={holderChoice}
            onChange={(e) => handleHolderChange(e.target.value)}
          >
            <option value="">Vacant — nobody holds this right now</option>
            <option value={EXTERNAL_HOLDER}>Someone who is not a member here</option>
            {sortedMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          {!isExternal && !linkedMember ? (
            <p className="text-theme-text-muted mt-2 text-xs">
              A vacant seat still appears on the chart, so members can see the position exists and that nobody is in it.
            </p>
          ) : null}
        </div>

        {isExternal ? (
          <div>
            <label className="form-label" htmlFor="org-node-display-name">
              Their name
            </label>
            <input
              id="org-node-display-name"
              className="form-input"
              value={draft.displayName}
              onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
              placeholder="e.g. Rev. J. Alvarez"
            />
            <p className="text-theme-text-muted mt-2 text-xs">
              For a holder with no account here — a board member, a chaplain, an auxiliary officer, a mutual-aid
              liaison. They appear on the chart exactly like anyone else.
            </p>
          </div>
        ) : linkedMember ? (
          <div>
            <label className="form-label" htmlFor="org-node-display-name">
              Show this name instead (optional)
            </label>
            <input
              id="org-node-display-name"
              className="form-input"
              value={draft.displayName}
              onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
              placeholder={linkedMember.name}
            />
            <p className="text-theme-text-muted mt-2 text-xs">
              Leave blank to use {linkedMember.name}&rsquo;s own name, which then stays correct if they update their
              profile.
            </p>
          </div>
        ) : null}

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
