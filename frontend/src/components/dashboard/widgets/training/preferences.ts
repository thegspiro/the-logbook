import { TRAINING_WIDGET_METADATA, type TrainingWidgetId } from './metadata';
const PREFERENCE_KEY = 'training-officer-dashboard.widgets.v1';
const defaults = Object.fromEntries(Object.keys(TRAINING_WIDGET_METADATA).map((id) => [id, true])) as Record<
  TrainingWidgetId,
  boolean
>;
/** Training-officer choices remain separate from the member-facing main dashboard. */
export const loadTrainingWidgetPreferences = (): Record<TrainingWidgetId, boolean> => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(PREFERENCE_KEY) ?? '{}');
    return { ...defaults, ...(typeof saved === 'object' && saved !== null ? saved : {}) };
  } catch {
    return defaults;
  }
};
export const saveTrainingWidgetPreferences = (value: Record<TrainingWidgetId, boolean>) =>
  localStorage.setItem(PREFERENCE_KEY, JSON.stringify(value));
