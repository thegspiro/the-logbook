import React from 'react';
import { Link as RouterLink } from 'react-router';
import { TrainingDetailsFields } from '../../training/TrainingDetailsFields';
import type { EventFormModel } from '../useEventFormModel';

interface TrainingDetailsSectionProps {
  model: Pick<
    EventFormModel,
    | 'showsTrainingDetails'
    | 'canCreateTrainingSession'
    | 'submitsRollingSeries'
    | 'trainingDetails'
    | 'setTrainingDetails'
  >;
}

/** The optional training details a new Training event can carry. */
export const TrainingDetailsSection: React.FC<TrainingDetailsSectionProps> = ({ model }) => {
  const { showsTrainingDetails, canCreateTrainingSession, submitsRollingSeries, trainingDetails, setTrainingDetails } =
    model;
  if (!showsTrainingDetails) return null;
  return (
    <div
      role="group"
      aria-labelledby="training-details-heading"
      className="border-theme-surface-border space-y-4 rounded-lg border p-4"
    >
      <div>
        <h3 id="training-details-heading" className="text-theme-text-primary text-base font-semibold">
          Training details (optional)
        </h3>
        <p className="text-theme-text-secondary mt-1 text-sm">
          Attendance is credited to members&apos; training records when attendance is finalized. Without details it is
          filed under the event title as Continuing Education.
        </p>
        <p className="text-theme-text-muted mt-1 text-sm">
          {canCreateTrainingSession ? (
            <>
              Use{' '}
              <RouterLink
                to="/training/admin?page=records&tab=sessions"
                className="font-medium text-red-700 underline hover:text-red-800 dark:text-red-400"
              >
                Create Training Session
              </RouterLink>{' '}
              for instructor sign-off, certification or an assigned instructor.
            </>
          ) : (
            'For instructor sign-off, certification or an assigned instructor, a training officer uses Create Training Session instead.'
          )}
        </p>
      </div>
      {submitsRollingSeries && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          Training details can&apos;t be added to a rolling series.
        </p>
      )}
      <TrainingDetailsFields value={trainingDetails} onChange={setTrainingDetails} disabled={submitsRollingSeries} />
    </div>
  );
};
