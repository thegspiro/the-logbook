/**
 * Suggestion box administration (`suggestions.manage`).
 *
 * Configures boxes and their reviewers only. Reading a box's submissions is
 * the reviewers' alone, which is what lets a complaints box exist in a
 * department whose administrators might be its subject.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Lightbulb, Pencil, Plus } from 'lucide-react';
import { Breadcrumbs, EmptyState, SkeletonPage } from '../../../components/ux';
import { SUGGESTION_ANONYMITY_LABELS } from '../../../constants/enums';
import SuggestionBoxFormModal from '../components/SuggestionBoxFormModal';
import { suggestionsService } from '../services/suggestionsService';
import type { ReviewerOptions, SuggestionBoxAdmin } from '../types/suggestions';

const SuggestionBoxesAdminPage: React.FC = () => {
  const [boxes, setBoxes] = useState<SuggestionBoxAdmin[]>([]);
  const [options, setOptions] = useState<ReviewerOptions>({ positions: [], members: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SuggestionBoxAdmin | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

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
      return exists ? current.map((b) => (b.id === saved.id ? saved : b)) : [...current, saved];
    });
    setIsFormOpen(false);
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

      {boxes.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="No suggestion boxes"
          description="Create a box and choose who reviews it."
        />
      ) : (
        <ul className="space-y-3">
          {boxes.map((box) => (
            <li key={box.id} className="card flex flex-wrap items-start justify-between gap-3">
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
                  {box.followUpEnabled ? 'Follow-up allowed' : 'One-way'}
                </p>
                <p className="text-theme-text-muted text-xs">
                  Reviewers:{' '}
                  {[...box.reviewerPositions, ...box.reviewerMembers].map((r) => r.name).join(', ') || 'none'}
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-sm"
                onClick={() => openForm(box)}
                aria-label={`Edit ${box.name}`}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Edit
              </button>
            </li>
          ))}
        </ul>
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
