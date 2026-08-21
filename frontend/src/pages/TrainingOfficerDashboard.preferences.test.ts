import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadTrainingWidgetPreferences,
  saveTrainingWidgetPreferences,
} from '../components/dashboard/widgets/training/preferences';

describe('training dashboard preferences', () => {
  beforeEach(() => localStorage.clear());
  it('persists page-specific widget choices without using main-dashboard preferences', () => {
    const preferences = loadTrainingWidgetPreferences();
    preferences['pending-validation'] = false;
    saveTrainingWidgetPreferences(preferences);
    expect(loadTrainingWidgetPreferences()['pending-validation']).toBe(false);
    expect(localStorage.getItem('dashboard.widgets')).toBeNull();
  });
});
