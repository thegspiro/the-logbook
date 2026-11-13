/**
 * Create or edit a suggestion box, reviewers included.
 *
 * Reviewers are the only people who read a box; people it notifies are told a
 * submission arrived and can read nothing. Saving replaces both sets, so the
 * form always sends every field it owns.
 */

import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { SUGGESTION_ANONYMITY_LABELS, SuggestionAnonymityMode } from '../../../constants/enums';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { placeApiError, useFieldErrors, type FieldErrors, type FieldSpecs } from '../../../hooks/useFieldErrors';
import { blankToNull } from '../../../utils/formValues';
import { suggestionsService } from '../services/suggestionsService';
import type { ReviewerOptions, SuggestionBoxAdmin } from '../types/suggestions';
import { type EditableQuestion, withEditorIds } from '../utils/suggestionRouting';
import IntakeQuestionsEditor from './IntakeQuestionsEditor';
import ReviewerChecklist from './ReviewerChecklist';

interface SuggestionBoxFormModalProps {
  box: SuggestionBoxAdmin | null;
  options: ReviewerOptions;
  /** Every box in the department, for the questions' routing choices. */
  boxes?: SuggestionBoxAdmin[] | undefined;
  onClose: () => void;
  onSaved: (box: SuggestionBoxAdmin) => void;
}

const ANONYMITY_MODES = Object.values(SuggestionAnonymityMode);

type BoxField = 'name' | 'description' | 'anonymityMode' | 'reviewers';

/**
 * SuggestionBoxWrite in schemas/suggestion.py (camelCase on the wire). In the
 * order they appear, so the first failing one takes focus. The reviewer error
 * sits on the group around both reviewer lists: the two answer it together.
 */
const BOX_FIELDS: FieldSpecs<BoxField> = {
  name: { id: 'box-name', label: 'Name' },
  description: { id: 'box-description', label: 'Description' },
  anonymityMode: { id: 'box-anonymity', label: 'Anonymity' },
  reviewers: {
    id: 'box-reviewers',
    label: 'Reviewers',
    apiKeys: ['reviewerPositionIds', 'reviewerMemberIds', 'isActive'],
  },
};

/**
 * The stored values a refused field is saved with on an edit. The update
 * replaces the whole box, so a refused field cannot simply be left out: it is
 * sent as the box already has it, which keeps it unchanged.
 */
const storedValues = (box: SuggestionBoxAdmin, field: BoxField): Record<string, unknown> => {
  switch (field) {
    case 'name':
      return { name: box.name };
    case 'description':
      return { description: box.description ?? null };
    case 'anonymityMode':
      return { anonymityMode: box.anonymityMode };
    case 'reviewers':
      return {
        isActive: box.isActive,
        reviewerPositionIds: box.reviewerPositions.map((p) => p.id),
        reviewerMemberIds: box.reviewerMembers.map((m) => m.id),
      };
  }
};

const SuggestionBoxFormModal: React.FC<SuggestionBoxFormModalProps> = ({
  box,
  options,
  boxes = [],
  onClose,
  onSaved,
}) => {
  const [name, setName] = useState(box?.name ?? '');
  const [description, setDescription] = useState(box?.description ?? '');
  const [anonymityMode, setAnonymityMode] = useState<SuggestionAnonymityMode>(
    box?.anonymityMode ?? SuggestionAnonymityMode.ALLOWED
  );
  const [followUpEnabled, setFollowUpEnabled] = useState(box?.followUpEnabled ?? false);
  const [isActive, setIsActive] = useState(box?.isActive ?? true);
  const [publicBoardEnabled, setPublicBoardEnabled] = useState(box?.publicBoardEnabled ?? false);
  const [positionIds, setPositionIds] = useState<string[]>(box?.reviewerPositions.map((p) => p.id) ?? []);
  const [memberIds, setMemberIds] = useState<string[]>(box?.reviewerMembers.map((m) => m.id) ?? []);
  const [memberFilter, setMemberFilter] = useState('');
  const [watcherPositionIds, setWatcherPositionIds] = useState<string[]>(box?.watcherPositions.map((p) => p.id) ?? []);
  const [watcherMemberIds, setWatcherMemberIds] = useState<string[]>(box?.watcherMembers.map((m) => m.id) ?? []);
  const [watcherFilter, setWatcherFilter] = useState('');
  const [questions, setQuestions] = useState<EditableQuestion[]>(() => withEditorIds(box?.intakeQuestions));
  const [isSaving, setIsSaving] = useState(false);
  const fieldErrors = useFieldErrors(BOX_FIELDS);
  const errors = fieldErrors.errors;
  const [savedExcept, setSavedExcept] = useState(false);
  const clearError = (field: BoxField) => fieldErrors.setError(field, null);

  // Everything the form would save, as text, so closing can tell whether it
  // would lose anything. The filters are search boxes, not part of the box.
  const values = JSON.stringify([
    name,
    description,
    anonymityMode,
    followUpEnabled,
    isActive,
    publicBoardEnabled,
    positionIds,
    memberIds,
    watcherPositionIds,
    watcherMemberIds,
    questions,
  ]);
  const [initialValues] = useState(values);
  // Called here rather than given to Modal so Cancel asks too.
  const requestClose = useDiscardGuard({ isDirty: values !== initialValues, onClose });
  const routeTargets = useMemo(() => boxes.filter((b) => b.id !== box?.id), [boxes, box]);

  const hasReviewers = positionIds.length + memberIds.length > 0;
  // A reviewer removed from the org since the box was saved still needs to be
  // un-checkable, so keep them in the list.
  const memberItems = useMemo(() => {
    const known = new Set(options.members.map((m) => m.id));
    const missing = (box?.reviewerMembers ?? []).filter((m) => !known.has(m.id));
    return [...options.members, ...missing];
  }, [options.members, box]);
  const watcherItems = useMemo(() => {
    const known = new Set(options.members.map((m) => m.id));
    const missing = (box?.watcherMembers ?? []).filter((m) => !known.has(m.id));
    return [...options.members, ...missing];
  }, [options.members, box]);

  const showErrors = (next: FieldErrors<BoxField>) => {
    fieldErrors.setErrors(next);
    fieldErrors.focusFirst(next);
  };

  /**
   * A new box is created only once nothing is refused. An edit is a single save
   * (owner rule of 2026-11-05): a refused field is sent as stored so the box keeps
   * that value, the rest is saved, and the dialog stays open with it flagged.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let refused: FieldErrors<BoxField> = {};
    if (!name.trim()) refused.name = 'Enter a name for the box.';
    if (isActive && !hasReviewers) refused.reviewers = 'Choose at least one reviewer, or save the box as inactive.';
    if (!box && Object.keys(refused).length > 0) {
      showErrors(refused);
      return;
    }
    const payload = {
      name: name.trim(),
      description: blankToNull(description),
      anonymityMode,
      followUpEnabled,
      isActive,
      reviewerPositionIds: positionIds,
      reviewerMemberIds: memberIds,
      watcherPositionIds,
      watcherMemberIds,
      publicBoardEnabled,
      intakeQuestions: questions.map((q) => ({
        ...q,
        label: q.label.trim(),
        helpText: blankToNull(q.helpText ?? ''),
        options: q.options.map((o) => ({ ...o, label: o.label.trim() })),
      })),
    };
    const keepingStored = (stored: SuggestionBoxAdmin): typeof payload => {
      let next: typeof payload = payload;
      for (const field of Object.keys(refused) as BoxField[]) next = { ...next, ...storedValues(stored, field) };
      return next;
    };
    setIsSaving(true);
    fieldErrors.setFormError(null);
    setSavedExcept(false);
    try {
      if (box) {
        let saved: SuggestionBoxAdmin;
        try {
          saved = await suggestionsService.updateBox(box.id, keepingStored(box));
        } catch (err: unknown) {
          const mapped = placeApiError(BOX_FIELDS, err);
          if (!mapped || Object.keys(mapped.fieldErrors).length === 0 || mapped.unmatched.length > 0) throw err;
          refused = { ...refused, ...mapped.fieldErrors };
          saved = await suggestionsService.updateBox(box.id, keepingStored(box));
        }
        if (Object.keys(refused).length > 0) {
          showErrors(refused);
          setSavedExcept(true);
          return;
        }
        toast.success('Suggestion box updated');
        onSaved(saved);
      } else {
        const saved = await suggestionsService.createBox(payload);
        toast.success('Suggestion box created');
        onSaved(saved);
      }
    } catch (err: unknown) {
      const mapped = placeApiError(BOX_FIELDS, err);
      if (mapped) {
        showErrors({ ...refused, ...mapped.fieldErrors });
        fieldErrors.setFormError(mapped.unmatched.length ? mapped.unmatched.join(' ') : null);
      } else {
        // Said in the dialog, not in a toast behind it.
        fieldErrors.setFromApiError(err, 'Unable to save the suggestion box.');
        fieldErrors.setErrors(refused);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title={box ? 'Edit suggestion box' : 'New suggestion box'}
      size="lg"
      noValidate
      onSubmit={(e) => void handleSubmit(e)}
      footer={
        <>
          <button type="submit" className="btn-primary" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save box'}
          </button>
          <button
            type="button"
            onClick={requestClose}
            className="mobile-touch-target border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary rounded-md border px-4 py-2 text-sm font-medium"
          >
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {savedExcept && (
          <p role="status" className="alert-warning text-theme-text-primary text-sm">
            Saved, except the field flagged below, which keeps its stored value. Fix it and save again.
          </p>
        )}
        {fieldErrors.formError && (
          <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
            {fieldErrors.formError}
          </p>
        )}
        <FormField
          label="Name"
          required
          id={BOX_FIELDS.name.id}
          error={errors.name}
          maxLength={100}
          count={name.length}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clearError('name');
              }}
              placeholder="e.g. Training ideas"
            />
          )}
        </FormField>
        <FormField
          label={
            <>
              Description <span className="text-theme-text-muted font-normal">(shown to members)</span>
            </>
          }
          id={BOX_FIELDS.description.id}
          error={errors.description}
          maxLength={2000}
          count={description.length}
        >
          {(field) => (
            <textarea
              {...field}
              className="form-input"
              rows={2}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                clearError('description');
              }}
            />
          )}
        </FormField>
        {/* Right after the name: what a member is asked shapes everything
            below it, and at the foot of a long modal it went unfound. */}
        <IntakeQuestionsEditor
          questions={questions}
          onChange={setQuestions}
          routeTargets={routeTargets}
          anonymityMode={anonymityMode}
        />
        <FormField
          label="Anonymity"
          id={BOX_FIELDS.anonymityMode.id}
          error={errors.anonymityMode}
          hint="Anonymous submissions store no record of who sent them — reviewers cannot find out, and neither can an administrator."
        >
          {(field) => (
            <select
              {...field}
              className="form-input"
              value={anonymityMode}
              onChange={(e) => {
                setAnonymityMode(e.target.value as SuggestionAnonymityMode);
                clearError('anonymityMode');
              }}
            >
              {ANONYMITY_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {SUGGESTION_ANONYMITY_LABELS[mode] ?? mode}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <label className="text-theme-text-primary touch:min-h-[44px] flex items-start gap-2 text-sm">
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
        <label className="text-theme-text-primary touch:min-h-[44px] flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={isActive}
            onChange={(e) => {
              setIsActive(e.target.checked);
              clearError('reviewers');
            }}
          />
          Accepting submissions
        </label>
        <label className="text-theme-text-primary touch:min-h-[44px] flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="form-checkbox mt-0.5"
            checked={publicBoardEnabled}
            onChange={(e) => setPublicBoardEnabled(e.target.checked)}
          />
          <span>
            Public idea board
            <span className="text-theme-text-muted block text-xs">
              Reviewers can publish a rewritten copy of a submission for every member to see and vote on. Nothing is
              published automatically, and the original submission, its screenshots and its author are never shown.
            </span>
          </span>
        </label>

        <div className="alert-info text-sm">
          <p className="text-theme-text-primary">
            Only reviewers can read this box&apos;s submissions and set their disposition. They get a notification and
            an email when something new arrives. Managing boxes does not by itself let you read them.
          </p>
        </div>
        {/* Focus target for the reviewer error: the two checklists below
            answer it together, so neither one is "the" field. */}
        <div
          id={BOX_FIELDS.reviewers.id}
          role="group"
          aria-label="Reviewers"
          tabIndex={-1}
          aria-describedby={errors.reviewers ? `${BOX_FIELDS.reviewers.id}-error` : undefined}
          className="space-y-4 focus:outline-none"
        >
          {errors.reviewers && (
            <p id={`${BOX_FIELDS.reviewers.id}-error`} className={`text-sm ${FIELD_ERROR_CLASS}`}>
              {errors.reviewers}
            </p>
          )}
          <ReviewerChecklist
            legend="Reviewer positions"
            items={options.positions}
            selected={positionIds}
            onChange={(next) => {
              setPositionIds(next);
              clearError('reviewers');
            }}
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
              onChange={(next) => {
                setMemberIds(next);
                clearError('reviewers');
              }}
              filter={memberFilter}
            />
          </div>
        </div>

        <section aria-labelledby="box-watchers-heading" className="border-theme-surface-border space-y-4 border-t pt-4">
          <div>
            <h3 id="box-watchers-heading" className="text-theme-text-primary text-sm font-semibold">
              Also notify
            </h3>
            <p className="text-theme-text-muted mt-1 text-xs">
              These people are told when a submission arrives but cannot read it: the notice says only which box
              received something. Anyone who is also a reviewer gets the reviewer&apos;s notice instead.
            </p>
          </div>
          <ReviewerChecklist
            legend="Notified positions"
            items={options.positions}
            selected={watcherPositionIds}
            onChange={setWatcherPositionIds}
          />
          <div>
            <label htmlFor="box-watcher-filter" className="form-label">
              Find members to notify
            </label>
            <input
              id="box-watcher-filter"
              className="form-input mb-2"
              value={watcherFilter}
              onChange={(e) => setWatcherFilter(e.target.value)}
              placeholder="Filter by name"
            />
            <ReviewerChecklist
              legend="Notified members"
              items={watcherItems}
              selected={watcherMemberIds}
              onChange={setWatcherMemberIds}
              filter={watcherFilter}
            />
          </div>
        </section>
      </div>
    </Modal>
  );
};

export default SuggestionBoxFormModal;
