/**
 * Create or edit a suggestion box, reviewers included.
 *
 * Reviewers are the only people who read a box. Saving replaces the whole
 * reviewer set, so the form always sends every field it owns.
 */

import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { SUGGESTION_ANONYMITY_LABELS, SuggestionAnonymityMode } from '../../../constants/enums';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull } from '../../../utils/formValues';
import { suggestionsService } from '../services/suggestionsService';
import type { ReviewerOptions, ReviewerRef, SuggestionBoxAdmin } from '../types/suggestions';

interface SuggestionBoxFormModalProps {
  box: SuggestionBoxAdmin | null;
  options: ReviewerOptions;
  onClose: () => void;
  onSaved: (box: SuggestionBoxAdmin) => void;
}

const ANONYMITY_MODES = Object.values(SuggestionAnonymityMode);

interface ReviewerChecklistProps {
  legend: string;
  items: ReviewerRef[];
  selected: string[];
  onToggle: (id: string) => void;
  filter?: string;
}

const ReviewerChecklist: React.FC<ReviewerChecklistProps> = ({ legend, items, selected, onToggle, filter = '' }) => {
  const needle = filter.trim().toLowerCase();
  const visible = needle ? items.filter((item) => item.name.toLowerCase().includes(needle)) : items;
  return (
    <fieldset>
      <legend className="form-label">{legend}</legend>
      <div className="border-theme-surface-border max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
        {visible.length === 0 ? (
          <p className="text-theme-text-muted text-sm">None found.</p>
        ) : (
          visible.map((item) => (
            <label
              key={item.id}
              className="text-theme-text-primary flex items-center gap-2 text-sm max-md:min-h-[44px]"
            >
              <input
                type="checkbox"
                className="form-checkbox"
                checked={selected.includes(item.id)}
                onChange={() => onToggle(item.id)}
              />
              {item.name}
            </label>
          ))
        )}
      </div>
    </fieldset>
  );
};

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

const SuggestionBoxFormModal: React.FC<SuggestionBoxFormModalProps> = ({ box, options, onClose, onSaved }) => {
  const [name, setName] = useState(box?.name ?? '');
  const [description, setDescription] = useState(box?.description ?? '');
  const [anonymityMode, setAnonymityMode] = useState<SuggestionAnonymityMode>(
    box?.anonymityMode ?? SuggestionAnonymityMode.ALLOWED
  );
  const [followUpEnabled, setFollowUpEnabled] = useState(box?.followUpEnabled ?? false);
  const [isActive, setIsActive] = useState(box?.isActive ?? true);
  const [positionIds, setPositionIds] = useState<string[]>(box?.reviewerPositions.map((p) => p.id) ?? []);
  const [memberIds, setMemberIds] = useState<string[]>(box?.reviewerMembers.map((m) => m.id) ?? []);
  const [memberFilter, setMemberFilter] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const hasReviewers = positionIds.length + memberIds.length > 0;
  // A reviewer removed from the org since the box was saved still needs to be
  // un-checkable, so keep them in the list.
  const memberItems = useMemo(() => {
    const known = new Set(options.members.map((m) => m.id));
    const missing = (box?.reviewerMembers ?? []).filter((m) => !known.has(m.id));
    return [...options.members, ...missing];
  }, [options.members, box]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isActive && !hasReviewers) {
      toast.error('Choose at least one reviewer, or save the box as inactive.');
      return;
    }
    setIsSaving(true);
    const payload = {
      name: name.trim(),
      description: blankToNull(description),
      anonymityMode,
      followUpEnabled,
      isActive,
      reviewerPositionIds: positionIds,
      reviewerMemberIds: memberIds,
    };
    try {
      const saved = box
        ? await suggestionsService.updateBox(box.id, payload)
        : await suggestionsService.createBox(payload);
      toast.success(box ? 'Suggestion box updated' : 'Suggestion box created');
      onSaved(saved);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Unable to save the suggestion box.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={box ? 'Edit suggestion box' : 'New suggestion box'} size="lg">
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div className="modal-body space-y-4">
          <div>
            <label htmlFor="box-name" className="form-label">
              Name
            </label>
            <input
              id="box-name"
              className="form-input"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Training ideas"
              required
            />
          </div>
          <div>
            <label htmlFor="box-description" className="form-label">
              Description <span className="text-theme-text-muted font-normal">(shown to members)</span>
            </label>
            <textarea
              id="box-description"
              className="form-input"
              rows={2}
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="box-anonymity" className="form-label">
              Anonymity
            </label>
            <select
              id="box-anonymity"
              className="form-input"
              value={anonymityMode}
              onChange={(e) => setAnonymityMode(e.target.value as SuggestionAnonymityMode)}
            >
              {ANONYMITY_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {SUGGESTION_ANONYMITY_LABELS[mode] ?? mode}
                </option>
              ))}
            </select>
            <p className="text-theme-text-muted mt-1 text-xs">
              Anonymous submissions store no record of who sent them — reviewers cannot find out, and neither can an
              administrator.
            </p>
          </div>
          <label className="text-theme-text-primary flex items-start gap-2 text-sm max-md:min-h-[44px]">
            <input
              type="checkbox"
              className="form-checkbox mt-0.5"
              checked={followUpEnabled}
              onChange={(e) => setFollowUpEnabled(e.target.checked)}
            />
            <span>
              Allow follow-up
              <span className="text-theme-text-muted block text-xs">
                Reviewers and the submitter can exchange replies, and the submitter sees the disposition. Off makes the
                box one-way. Anonymous submitters follow up with a private key.
              </span>
            </span>
          </label>
          <label className="text-theme-text-primary flex items-center gap-2 text-sm max-md:min-h-[44px]">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Accepting submissions
          </label>

          <div className="alert-info text-sm">
            <p className="text-theme-text-primary">
              Only reviewers can read this box&apos;s submissions and set their disposition. They are emailed when
              something new arrives. Managing boxes does not by itself let you read them.
            </p>
          </div>
          <ReviewerChecklist
            legend="Reviewer positions"
            items={options.positions}
            selected={positionIds}
            onToggle={(id) => setPositionIds((current) => toggle(current, id))}
          />
          <div>
            <label htmlFor="box-member-filter" className="form-label">
              Find members
            </label>
            <input
              id="box-member-filter"
              className="form-input mb-2"
              value={memberFilter}
              onChange={(e) => setMemberFilter(e.target.value)}
              placeholder="Filter by name"
            />
            <ReviewerChecklist
              legend="Reviewer members"
              items={memberItems}
              selected={memberIds}
              onToggle={(id) => setMemberIds((current) => toggle(current, id))}
              filter={memberFilter}
            />
          </div>
        </div>

        <div className="border-theme-surface-border flex justify-end gap-2 border-t px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="mobile-touch-target border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary rounded-md border px-4 py-2 text-sm font-medium"
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={isSaving || !name.trim()}>
            {isSaving ? 'Saving…' : 'Save box'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default SuggestionBoxFormModal;
