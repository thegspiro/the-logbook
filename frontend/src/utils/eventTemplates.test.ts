import { describe, it, expect } from 'vitest';
import type { EventTemplate } from '../types/event';
import { DEFAULT_TRAINING_DETAILS } from '../components/training-event/trainingDetailsModel';
import { templateToInitialTraining } from './eventTemplates';

const template = (patch: Partial<EventTemplate> = {}): EventTemplate => ({
  id: 't1',
  organization_id: 'org',
  name: 'Monthly Drill',
  event_type: 'training',
  requires_rsvp: false,
  is_mandatory: false,
  allow_guests: false,
  require_checkout: false,
  send_reminders: true,
  reminder_target: 'going',
  reminder_schedule: [24],
  is_active: true,
  created_at: '',
  updated_at: '',
  ...patch,
});

const DETAILS = {
  course_mode: 'oneoff' as const,
  course_id: null,
  course_name: 'Rope Rescue',
  course_code: 'RR-1',
  training_type: 'refresher',
  credit_hours: 2.5,
  credit_hours_source: 'manual' as const,
  instructor_id: 'm-1',
  instructor: 'Owen Kittredge',
  issues_certification: true,
  certification_number_prefix: 'RR-',
  issuing_agency: 'State Academy',
  expiration_months: 12,
};

describe('templateToInitialTraining', () => {
  it('maps every carried field and leaves the rest at their defaults', () => {
    expect(templateToInitialTraining(template({ training_details: DETAILS }))).toEqual({
      ...DEFAULT_TRAINING_DETAILS,
      course_mode: 'oneoff',
      course_name: 'Rope Rescue',
      course_code: 'RR-1',
      training_type: 'refresher',
      credit_hours: '2.5',
      credit_hours_source: 'manual',
      instructor_id: 'm-1',
      instructor: 'Owen Kittredge',
      issues_certification: true,
      certification_number_prefix: 'RR-',
      issuing_agency: 'State Academy',
      expiration_months: '12',
    });
  });

  it('has nothing to fill for a template saved without training details', () => {
    expect(templateToInitialTraining(template({ training_details: null }))).toBeUndefined();
    expect(templateToInitialTraining(template())).toBeUndefined();
  });

  it('has nothing to fill for any type but Training', () => {
    expect(
      templateToInitialTraining(template({ event_type: 'business_meeting', training_details: DETAILS }))
    ).toBeUndefined();
  });
});
