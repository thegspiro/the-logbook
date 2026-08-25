import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Modal } from '../../../components/Modal';
import {
  OrgChartHolderSource,
  type OrgChartMemberOption,
  type OrgChartNode,
  type OrgChartPositionOption,
  type OrgChartRankOption,
} from '../types/orgChart';

/**
 * One row of the "who holds it" editor.
 *
 * `userId` empty with a typed `displayName` is a holder who has no account
 * here — a trustee, a chaplain, an auxiliary officer. Both filled is a member
 * announced differently from their roster record ("Chief Ramirez").
 */
export interface OrgChartHolderDraft {
  /** Stable only within one open of the editor; never sent to the server. */
  key: string;
  userId: string;
  displayName: string;
}

export interface OrgChartNodeDraft {
  title: string;
  /** '' means this seat sits at the top of the chart. */
  parentId: string;
  holderSource: OrgChartHolderSource;
  holders: OrgChartHolderDraft[];
  positionId: string;
  rankCode: string;
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
  positions: OrgChartPositionOption[];
  ranks: OrgChartRankOption[];
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

let holderKeySeed = 0;
const nextHolderKey = (): string => `holder-${(holderKeySeed += 1)}`;

const emptyHolder = (): OrgChartHolderDraft => ({
  key: nextHolderKey(),
  userId: '',
  displayName: '',
});

const EMPTY_DRAFT: OrgChartNodeDraft = {
  title: '',
  parentId: '',
  holderSource: OrgChartHolderSource.MANUAL,
  holders: [],
  positionId: '',
  rankCode: '',
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
 *
 * *Who* is in the seat is the one place the application's own record is
 * offered, because there it usually is the answer: a seat can follow a role or
 * a rank instead of naming people, and then tracks the roster on its own.
 */
export const OrgChartNodeModal: React.FC<OrgChartNodeModalProps> = ({
  isOpen,
  editingNode,
  defaultParentId,
  nodes,
  members,
  positions,
  ranks,
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
    if (editingNode) {
      setDraft({
        title: editingNode.title,
        parentId: editingNode.parentId ?? '',
        holderSource: editingNode.holderSource,
        // Seeded from the resolved holders, which for a manual seat are
        // exactly what was stored. A seat following a role seeds an empty list
        // rather than the roster it currently resolves to — copying those in
        // would turn "follows the Chief role" into a snapshot of it the moment
        // somebody switched the seat back to a hand-typed list.
        holders:
          editingNode.holderSource === OrgChartHolderSource.MANUAL
            ? editingNode.holders.map((holder) => ({
                key: nextHolderKey(),
                userId: holder.userId ?? '',
                // A linked member's own name is left blank so it stays correct
                // if they update their profile; only a real override is seeded.
                displayName: holder.userId ? '' : holder.name,
              }))
            : [],
        positionId: editingNode.positionId ?? '',
        rankCode: editingNode.rankCode ?? '',
        responsibility: editingNode.responsibility ?? '',
        contactEmail: editingNode.contactEmail ?? '',
        contactPhone: editingNode.contactPhone ?? '',
        isPublished: editingNode.isPublished,
      });
    } else {
      setDraft({ ...EMPTY_DRAFT, holders: [], parentId: defaultParentId ?? '' });
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

  const isManual = draft.holderSource === OrgChartHolderSource.MANUAL;

  const patchHolder = (key: string, patch: Partial<OrgChartHolderDraft>) => {
    setDraft((current) => ({
      ...current,
      holders: current.holders.map((holder) => (holder.key === key ? { ...holder, ...patch } : holder)),
    }));
  };

  const handleHolderChoice = (key: string, value: string) => {
    // Switching a row to "not a member here" clears the member link but keeps
    // whatever was typed; switching it to a member clears the override so the
    // roster name is used, which then stays correct if they edit their profile.
    if (value === EXTERNAL_HOLDER) {
      patchHolder(key, { userId: '' });
      return;
    }
    patchHolder(key, { userId: value, displayName: '' });
  };

  const handleSave = async () => {
    if (!draft.title.trim()) {
      setValidationError('Give the position a title.');
      return;
    }
    if (draft.holderSource === OrgChartHolderSource.POSITION && !draft.positionId) {
      setValidationError('Choose the role this position follows.');
      return;
    }
    if (draft.holderSource === OrgChartHolderSource.RANK && !draft.rankCode) {
      setValidationError('Choose the rank this position follows.');
      return;
    }
    const holders = isManual
      ? draft.holders
          .map((holder) => ({ ...holder, displayName: holder.displayName.trim() }))
          // A row naming nobody is somebody who pressed "Add a person" and
          // changed their mind; dropped rather than refused, because refusing
          // would make the admin hunt for the empty row to get their save
          // through.
          .filter((holder) => holder.userId || holder.displayName)
      : [];
    setValidationError(null);
    await onSave({
      ...draft,
      title: draft.title.trim(),
      holders,
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
          <label className="form-label" htmlFor="org-node-source">
            Who holds it
          </label>
          <select
            id="org-node-source"
            className="form-input"
            value={draft.holderSource}
            onChange={(e) => setDraft({ ...draft, holderSource: e.target.value as OrgChartHolderSource })}
          >
            <option value={OrgChartHolderSource.MANUAL}>People I list here</option>
            <option value={OrgChartHolderSource.POSITION}>Whoever holds a role in this application</option>
            <option value={OrgChartHolderSource.RANK}>Whoever carries an operational rank</option>
          </select>
          <p className="text-theme-text-muted mt-2 text-xs">
            A position that follows a role or a rank updates itself: change who holds the role on the members screen and
            this box changes with it, so an election is one edit rather than two.
          </p>
        </div>

        {draft.holderSource === OrgChartHolderSource.POSITION ? (
          <div>
            <label className="form-label" htmlFor="org-node-position">
              Which role
            </label>
            <select
              id="org-node-position"
              className="form-input"
              value={draft.positionId}
              onChange={(e) => setDraft({ ...draft, positionId: e.target.value })}
            >
              <option value="">Choose a role…</option>
              {positions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} ({option.holderCount} {option.holderCount === 1 ? 'member' : 'members'})
                </option>
              ))}
            </select>
            <p className="text-theme-text-muted mt-2 text-xs">
              The member count is today&rsquo;s. A role nobody holds shows the position as vacant, which is accurate —
              but worth knowing before you save rather than after.
            </p>
          </div>
        ) : null}

        {draft.holderSource === OrgChartHolderSource.RANK ? (
          <div>
            <label className="form-label" htmlFor="org-node-rank">
              Which rank
            </label>
            <select
              id="org-node-rank"
              className="form-input"
              value={draft.rankCode}
              onChange={(e) => setDraft({ ...draft, rankCode: e.target.value })}
            >
              <option value="">Choose a rank…</option>
              {ranks.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name} ({option.holderCount} {option.holderCount === 1 ? 'member' : 'members'})
                </option>
              ))}
            </select>
            <p className="text-theme-text-muted mt-2 text-xs">
              Every member carrying this rank is listed, so this suits a box like &ldquo;Captains&rdquo; better than one
              naming a single officer.
            </p>
          </div>
        ) : null}

        {isManual ? (
          <fieldset className="border-theme-surface-border space-y-3 rounded-lg border p-3">
            <legend className="form-label px-1">People in this position</legend>
            {draft.holders.length === 0 ? (
              <p className="text-theme-text-muted text-xs">
                Nobody yet. A vacant position still appears on the chart, so members can see it exists and that nobody
                is in it.
              </p>
            ) : null}

            {draft.holders.map((holder, index) => {
              const isExternal = !holder.userId;
              const linkedMember = sortedMembers.find((m) => m.id === holder.userId);
              return (
                <div key={holder.key} className="border-theme-surface-border space-y-2 rounded-md border p-3">
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <label className="form-label-sm" htmlFor={`org-node-holder-${holder.key}`}>
                        Person {index + 1}
                      </label>
                      <select
                        id={`org-node-holder-${holder.key}`}
                        className="form-input-sm"
                        value={holder.userId || EXTERNAL_HOLDER}
                        onChange={(e) => handleHolderChoice(holder.key, e.target.value)}
                      >
                        <option value={EXTERNAL_HOLDER}>Someone who is not a member here</option>
                        {sortedMembers.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          holders: current.holders.filter((h) => h.key !== holder.key),
                        }))
                      }
                      aria-label={`Remove person ${index + 1}`}
                      title="Remove this person"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div>
                    <label className="form-label-sm" htmlFor={`org-node-holder-name-${holder.key}`}>
                      {isExternal ? 'Their name' : 'Show this name instead (optional)'}
                    </label>
                    <input
                      id={`org-node-holder-name-${holder.key}`}
                      className="form-input-sm"
                      value={holder.displayName}
                      onChange={(e) => patchHolder(holder.key, { displayName: e.target.value })}
                      placeholder={isExternal ? 'e.g. Rev. J. Alvarez' : linkedMember?.name}
                    />
                    {isExternal ? null : (
                      <p className="text-theme-text-muted mt-1 text-xs">
                        Leave blank to use {linkedMember?.name ?? 'their'} own name, which then stays correct if they
                        update their profile.
                      </p>
                    )}
                  </div>
                </div>
              );
            })}

            <button
              type="button"
              className="btn-secondary btn-sm flex items-center gap-2"
              onClick={() => setDraft((current) => ({ ...current, holders: [...current.holders, emptyHolder()] }))}
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Add a person
            </button>
            <p className="text-theme-text-muted text-xs">
              Add as many as the position really holds. Trustees, co-chairs and a pair of assistant chiefs belong in one
              box with one area of responsibility, not in several boxes side by side.
            </p>
          </fieldset>
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
          These are the position&rsquo;s published details and are shown to every member. Nothing is copied from a
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
