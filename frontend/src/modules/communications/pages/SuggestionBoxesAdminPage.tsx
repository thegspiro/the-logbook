/**
 * Suggestion box administration (`suggestions.manage`).
 *
 * Configures boxes and their reviewers only. Reading a box's submissions is
 * the reviewers' alone, which is what lets a complaints box exist in a
 * department whose administrators might be its subject.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { Lightbulb, Pencil, Plus, Trash2 } from 'lucide-react';
import { Breadcrumbs, EmptyState, SkeletonPage } from '../../../components/ux';
import { SUGGESTION_ANONYMITY_LABELS } from '../../../constants/enums';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { getErrorMessage } from '../../../utils/errorHandling';
import SuggestionBoxDeleteDialog from '../components/SuggestionBoxDeleteDialog';
import SuggestionBoxFormModal from '../components/SuggestionBoxFormModal';
import { suggestionsService } from '../services/suggestionsService';
import type { ReviewerOptions, SuggestionBoxAdmin } from '../types/suggestions';

/** The server's order: accepting boxes first, then by name. */
const sortBoxes = (boxes: SuggestionBoxAdmin[]): SuggestionBoxAdmin[] =>
  [...boxes].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name));

const SuggestionBoxesAdminPage: React.FC = () => {
  const [boxes, setBoxes] = useState<SuggestionBoxAdmin[]>([]);
  const [options, setOptions] = useState<ReviewerOptions>({ positions: [], members: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SuggestionBoxAdmin | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<SuggestionBoxAdmin | null>(null);
  const { confirm } = useConfirm();

  useEffect(() => {
    let cancelled = false;
    Promise.all([suggestionsService.listAdminBoxes(), suggestionsService.getReviewerOptions()])
      .then(([boxList, reviewerOptions]) => {
        if (cancelled) return;
        setBoxes(boxList);
        setOptions(reviewerOptions);
      })
      .catch(() => {
        if (!cancelled) setError('Unable to load suggestion boxes. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openForm = (box: SuggestionBoxAdmin | null) => {
    setEditing(box);
    setIsFormOpen(true);
  };

  const handleSaved = (saved: SuggestionBoxAdmin) => {
    setBoxes((current) => {
      const exists = current.some((b) => b.id === saved.id);
      return sortBoxes(exists ? current.map((b) => (b.id === saved.id ? saved : b)) : [...current, saved]);
    });
    setIsFormOpen(false);
  };

  const removeFromList = (boxId: string) => {
    setBoxes((current) => current.filter((b) => b.id !== boxId));
    setDeleting(null);
  };

  // An empty box loses nothing, so a plain confirmation is enough. One holding
  // submissions opens the dialog that offers archiving and asks for the name.
  const requestDelete = async (box: SuggestionBoxAdmin) => {
    if (box.submissionCount > 0) {
      setDeleting(box);
      return;
    }
    const ok = await confirm({
      title: `Delete "${box.name}"?`,
      message: 'This box has never received a submission. Its settings and reviewer list will be removed.',
      confirmLabel: 'Delete box',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    try {
      await suggestionsService.deleteBox(box.id);
      toast.success('Box deleted');
      removeFromList(box.id);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Unable to delete the box.'));
    }
  };

  if (isLoading) return <SkeletonPage />;

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'Communications' }, { label: 'Suggestion boxes' }]} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
          <Lightbulb className="h-6 w-6" aria-hidden="true" />
          Suggestion boxes
        </h1>
        <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => openForm(null)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New box
        </button>
      </div>
      <p className="text-theme-text-secondary mb-4 text-sm">
        Each box has its own reviewers, anonymity rule and follow-up setting — a training-ideas box for the training
        officer, a complaints box for compliance, an ideas box for the president. Members submit from{' '}
        <Link to="/suggestions" className="underline">
          Suggestions
        </Link>
        .
      </p>

      {error && (
        <p role="alert" className="alert-danger mb-4 text-sm">
          {error}
        </p>
      )}

      {error && boxes.length === 0 ? null : boxes.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="No suggestion boxes"
          description="Create a box and choose who reviews it."
        />
      ) : (
        <ul className="space-y-3">
          {boxes.map((box) => (
            <li key={box.id} className="card flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0 space-y-1">
                <p className="text-theme-text-primary flex flex-wrap items-center gap-2 font-semibold">
                  {box.name}
                  {!box.isActive && (
                    <span className="badge bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100">
                      Not accepting submissions
                    </span>
                  )}
                </p>
                {box.description && <p className="text-theme-text-secondary text-sm">{box.description}</p>}
                <p className="text-theme-text-muted text-xs">
                  {SUGGESTION_ANONYMITY_LABELS[box.anonymityMode] ?? box.anonymityMode} ·{' '}
                  {box.followUpEnabled ? 'Follow-up allowed' : 'One-way'} · {box.submissionCount}{' '}
                  {box.submissionCount === 1 ? 'submission' : 'submissions'}
                </p>
                <p className="text-theme-text-muted text-xs">
                  Reviewers:{' '}
                  {[...box.reviewerPositions, ...box.reviewerMembers].map((r) => r.name).join(', ') || 'none'}
                </p>
                {box.watcherPositions.length + box.watcherMembers.length > 0 && (
                  <p className="text-theme-text-muted text-xs">
                    Also notified: {[...box.watcherPositions, ...box.watcherMembers].map((r) => r.name).join(', ')}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-sm"
                  onClick={() => openForm(box)}
                  aria-label={`Edit ${box.name}`}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  Edit
                </button>
                <button
                  type="button"
                  className="mobile-touch-target border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm"
                  onClick={() => void requestDelete(box)}
                  aria-label={`Delete ${box.name}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {deleting && (
        <SuggestionBoxDeleteDialog
          box={deleting}
          onClose={() => setDeleting(null)}
          onArchived={(saved) => {
            handleSaved(saved);
            setDeleting(null);
          }}
          onDeleted={removeFromList}
        />
      )}

      {isFormOpen && (
        <SuggestionBoxFormModal
          box={editing}
          options={options}
          onClose={() => setIsFormOpen(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
};

export default SuggestionBoxesAdminPage;
