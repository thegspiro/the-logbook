import React, { useEffect, useMemo, useState } from 'react';
import { Link2, Plus, Trash2, Users } from 'lucide-react';

import { Modal } from '../../../components/Modal';
import { linkValueOf, type OrgChartLinkOption, type OrgChartMemberOption, type OrgChartNode } from '../types/orgChart';

/**
 * One row of the "anyone else?" list.
 *
 * `userId` empty with a typed `displayName` is somebody who has no account
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
  /** `position:<id>`, `rank:<code>`, or '' for a seat that names its own people. */
  linkValue: string;
  holders: OrgChartHolderDraft[];
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
  roles: OrgChartLinkOption[];
  ranks: OrgChartLinkOption[];
  isSaving: boolean;
  onCancel: () => void;
  onSave: (draft: OrgChartNodeDraft) => Promise<void>;
}

/**
 * Sentinel for "this person has no account here".
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
  linkValue: '',
  holders: [],
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

/** "John Doe", "John Doe and Jane Roe", "John Doe, Jane Roe and 2 others". */
const nameList = (names: string[]): string => {
  if (names.length <= 2) return names.join(' and ');
  const [first, second, ...rest] = names;
  return `${first}, ${second} and ${rest.length} ${rest.length === 1 ? 'other' : 'others'}`;
};

/**
 * Editor for one seat on the organizational chart.
 *
 * Asks which role the box is *first*, and answers on the spot: pick "Chief"
 * and the editor says who holds the Chief role in this application, before
 * anything is saved. That confirmation is the point of linking — an officer
 * who cannot see the link land has no reason to trust that the box will keep
 * itself current, and will go on maintaining the name by hand.
 *
 * The link assists; it does not decide. The title is free text (prefilled from
 * the role, because that is nearly always what the box is called), the
 * reporting line is whatever leadership picks, and a linked seat can still
 * list people of its own. A department can put its Fundraising Committee Chair
 * under the President and its IT Manager under the Chief, neither of which any
 * role in the application would tell you.
 */
export const OrgChartNodeModal: React.FC<OrgChartNodeModalProps> = ({
  isOpen,
  editingNode,
  defaultParentId,
  nodes,
  members,
  roles,
  ranks,
  isSaving,
  onCancel,
  onSave,
}) => {
  const [draft, setDraft] = useState<OrgChartNodeDraft>(EMPTY_DRAFT);
  const [validationError, setValidationError] = useState<string | null>(null);
  /**
   * Whether the officer has typed a title of their own.
   *
   * Until they do, picking a role renames the box to match — which is what
   * somebody adding "the Chief" wants and saves them typing it twice. Once
   * they have edited it, a later role change must not overwrite their words.
   */
  const [titleTouched, setTitleTouched] = useState(false);

  // Reseed on every open: a name typed for one seat must not be filed against
  // the next one the admin opens.
  useEffect(() => {
    if (!isOpen) return;
    setValidationError(null);
    if (editingNode) {
      setDraft({
        title: editingNode.title,
        parentId: editingNode.parentId ?? '',
        linkValue: linkValueOf(editingNode),
        // Only the typed people are editable here. The linked role's holders
        // are shown as the confirmation panel and are not rows in this list —
        // seeding them in would turn a live link into a snapshot of it the
        // moment somebody pressed Save.
        holders: editingNode.holders
          .filter((holder) => !holder.fromLink)
          .map((holder) => ({
            key: nextHolderKey(),
            userId: holder.userId ?? '',
            // A member's own name is left blank so it stays correct if they
            // update their profile; only a real override is seeded.
            displayName: holder.userId ? '' : holder.name,
          })),
        responsibility: editingNode.responsibility ?? '',
        contactEmail: editingNode.contactEmail ?? '',
        contactPhone: editingNode.contactPhone ?? '',
        isPublished: editingNode.isPublished,
      });
      setTitleTouched(true);
    } else {
      setDraft({ ...EMPTY_DRAFT, holders: [], parentId: defaultParentId ?? '' });
      setTitleTouched(false);
    }
  }, [isOpen, editingNode, defaultParentId]);

  const sortedMembers = useMemo(() => [...members].sort((a, b) => a.name.localeCompare(b.name)), [members]);

  const linkOptions = useMemo(
    () => new Map([...roles, ...ranks].map((option) => [option.value, option])),
    [roles, ranks]
  );
  const chosenLink = draft.linkValue ? linkOptions.get(draft.linkValue) : undefined;

  /** Seats this one may report to: everything except itself and its own reports. */
  const parentOptions = useMemo(() => {
    const excluded = editingNode ? descendantsOf(nodes, editingNode.id) : new Set<string>();
    return nodes
      .filter((node) => !excluded.has(node.id))
      .map((node) => ({ id: node.id, label: `${'— '.repeat(node.depth)}${node.title}` }));
  }, [nodes, editingNode]);

  const handleLinkChange = (value: string) => {
    const option = value ? linkOptions.get(value) : undefined;
    setDraft((current) => ({
      ...current,
      linkValue: value,
      // Naming the box after the role it tracks is right often enough to be
      // the default and cheap enough to undo when it is not.
      title: !titleTouched && option ? option.label : current.title,
    }));
  };

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
    setValidationError(null);
    await onSave({
      ...draft,
      title: draft.title.trim(),
      holders: draft.holders
        .map((holder) => ({ ...holder, displayName: holder.displayName.trim() }))
        // A row naming nobody is somebody who pressed "Add a person" and
        // changed their mind; dropped rather than refused, because refusing
        // would make the admin hunt for the empty row to get their save through.
        .filter((holder) => holder.userId || holder.displayName),
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
          <label className="form-label" htmlFor="org-node-link">
            Which role is this?
          </label>
          <select
            id="org-node-link"
            className="form-input"
            value={draft.linkValue}
            onChange={(e) => handleLinkChange(e.target.value)}
          >
            <option value="">Not a role in this application — I&rsquo;ll name the people myself</option>
            {roles.length ? (
              <optgroup label="Roles">
                {roles.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {ranks.length ? (
              <optgroup label="Ranks">
                {ranks.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>

          {chosenLink ? (
            // The answer, immediately. An officer who cannot see the link land
            // has no reason to trust the box will keep itself current, and goes
            // on maintaining the name by hand.
            <div className="alert-info mt-2 flex items-start gap-2 text-sm" role="status">
              <Users className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {chosenLink.holders.length === 0 ? (
                  <>
                    Nobody currently holds <strong>{chosenLink.label}</strong> in this application, so this position
                    will show as vacant until somebody does.
                  </>
                ) : (
                  <>
                    <strong>{nameList(chosenLink.holders.map((h) => h.name))}</strong>{' '}
                    {chosenLink.holders.length === 1 ? 'holds' : 'hold'} {chosenLink.label} in this application. This
                    position will list {chosenLink.holders.length === 1 ? 'them' : 'them all'}, and keep up on its own
                    as that changes.
                  </>
                )}
              </span>
            </div>
          ) : (
            <p className="text-theme-text-muted mt-2 text-xs">
              Link the box to a role and it lists whoever holds that role, staying current on its own — an election
              becomes one edit rather than two. Leave it unlinked for anything the application has no name for: a
              committee, a board seat, a trustee.
            </p>
          )}
        </div>

        <div>
          <label className="form-label" htmlFor="org-node-title">
            Position title
          </label>
          <input
            id="org-node-title"
            className="form-input"
            value={draft.title}
            onChange={(e) => {
              setTitleTouched(true);
              setDraft({ ...draft, title: e.target.value });
            }}
            placeholder="e.g. Training Officer"
          />
          <p className="text-theme-text-muted mt-2 text-xs">
            What members actually call it, which need not match the role above &mdash; a box linked to the Fire Chief
            role can be titled &ldquo;Chief&rdquo;, and one linked to nothing can be titled &ldquo;Station 2 House
            Captain&rdquo;.
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
            Your department&rsquo;s real reporting line, which is never derived from anything in the application. A
            position cannot be listed under one of its own subordinates, so those are left out of this list.
          </p>
        </div>

        <fieldset className="border-theme-surface-border space-y-3 rounded-lg border p-3">
          <legend className="form-label px-1">{chosenLink ? 'Anyone else in this position' : 'Who holds it'}</legend>

          {chosenLink ? (
            <p className="text-theme-text-muted flex items-start gap-1.5 text-xs">
              <Link2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              <span>
                {chosenLink.label} holders are listed automatically and are not repeated here. Add anybody who shares
                the position without holding the role &mdash; a co-chair, an auxiliary officer, somebody with no login.
              </span>
            </p>
          ) : null}

          {draft.holders.length === 0 && !chosenLink ? (
            <p className="text-theme-text-muted text-xs">
              Nobody yet. A vacant position still appears on the chart, so members can see it exists and that nobody is
              in it.
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
          {chosenLink ? null : (
            <p className="text-theme-text-muted text-xs">
              Add as many as the position really holds. Trustees, co-chairs and a pair of assistant chiefs belong in one
              box with one area of responsibility, not in several boxes side by side.
            </p>
          )}
        </fieldset>

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
