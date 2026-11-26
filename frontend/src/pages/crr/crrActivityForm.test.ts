import { describe, it, expect } from 'vitest';
import type { CrrActivityType, CrrFormOptions } from '../../types/crr';
import { buildCreatePayload, initialValues, withType, type CrrActivityFormValues } from './crrActivityForm';

const TZ = 'America/New_York';

const smoke: CrrActivityType = {
  id: 't-smoke',
  code: 'smoke_alarm_install',
  name: 'Smoke alarm install',
  description: null,
  is_system: true,
  is_active: true,
  sort_order: 0,
  measures: [{ id: 'm-alarms', code: 'alarms_installed', label: 'Alarms installed', is_active: true, sort_order: 0 }],
  tag_ids: ['tag-fire'],
  admin_hours_category_id: null,
};

const options: CrrFormOptions = {
  activity_types: [smoke],
  tags: [
    { id: 'tag-fire', kind: 'risk', code: 'fire', label: 'Fire', is_system: true, is_active: true, sort_order: 0 },
  ],
  default_city: 'Falls Church',
  default_state: 'VA',
  zip_lookup_enabled: true,
  members: [{ id: 'me', name: 'Alex Rivera' }],
  retention_months: 24,
  can_view_contact: false,
};

const filled = (overrides: Partial<CrrActivityFormValues> = {}): CrrActivityFormValues => ({
  ...withType(initialValues(options, TZ, 'me', new Date('2026-11-22T17:30:00Z')), smoke, options.tags),
  ...overrides,
});

describe('initialValues', () => {
  it('starts in the department’s city, now in its timezone, with the recorder as a member', () => {
    const values = initialValues(options, TZ, 'me', new Date('2026-11-22T17:30:00Z'));
    expect(values.occurredAt).toBe('2026-11-22T12:30');
    expect([values.city, values.state]).toEqual(['Falls Church', 'VA']);
    expect(values.members).toEqual([{ userId: 'me', minutes: '60' }]);
  });

  it('lists nobody when the recorder is not among the members offered', () => {
    expect(initialValues(options, TZ, 'someone-else').members).toEqual([]);
  });
});

describe('withType', () => {
  it('takes the type’s default tags and starts its counts empty', () => {
    const values = withType({ ...initialValues(options, TZ, null), counts: { stale: '3' } }, smoke, options.tags);
    expect(values.tagIds).toEqual(['tag-fire']);
    expect(values.counts).toEqual({});
  });

  it('leaves out a default tag that is no longer offered, which would be refused', () => {
    const values = withType(
      initialValues(options, TZ, null),
      { ...smoke, tag_ids: ['tag-fire', 'tag-retired'] },
      options.tags
    );
    expect(values.tagIds).toEqual(['tag-fire']);
  });
});

describe('buildCreatePayload', () => {
  it('refuses the same member listed twice, rather than keeping one silently', () => {
    const { payload, error } = buildCreatePayload(
      filled({
        members: [
          { userId: 'me', minutes: '60' },
          { userId: 'me', minutes: '30' },
        ],
      }),
      TZ
    );
    expect(payload).toBeNull();
    expect(error).toBe('A member is listed twice. Remove one of the rows.');
  });

  it('refuses a missing type', () => {
    const { payload, error } = buildCreatePayload(filled({ activityTypeId: '' }), TZ);
    expect(payload).toBeNull();
    expect(error).toBe('Choose an activity type.');
  });

  it('sends the time as UTC and leaves blank counts out', () => {
    const { payload } = buildCreatePayload(filled({ counts: { 'm-alarms': '3', other: '' } }), TZ);
    expect(payload?.occurred_at).toBe('2026-11-22T17:30:00.000Z');
    expect(payload?.counts).toEqual({ 'm-alarms': 3 });
  });

  it('refuses a negative or fractional count', () => {
    for (const raw of ['-1', '2.5']) {
      expect(buildCreatePayload(filled({ counts: { 'm-alarms': raw } }), TZ).error).toBe(
        'Counts must be whole numbers, zero or more.'
      );
    }
  });

  it('omits blank text rather than sending empty strings', () => {
    const { payload } = buildCreatePayload(filled({ zipCode: '  ', city: '', notes: ' ' }), TZ);
    expect(payload?.zip_code).toBeUndefined();
    expect(payload?.city).toBeUndefined();
    expect(payload?.notes).toBeUndefined();
  });

  it('refuses a malformed ZIP code', () => {
    expect(buildCreatePayload(filled({ zipCode: '2204' }), TZ).error).toBe('Enter a five-digit ZIP code.');
  });

  it('drops resident details the recorder did not tick', () => {
    const { payload } = buildCreatePayload(filled({ hasResidentDetails: false, streetAddress: '12 Oak St' }), TZ);
    expect(payload?.has_resident_details).toBe(false);
    expect(payload?.street_address).toBeUndefined();
  });

  it('sends ticked resident details', () => {
    const { payload } = buildCreatePayload(filled({ hasResidentDetails: true, streetAddress: ' 12 Oak St ' }), TZ);
    expect(payload?.street_address).toBe('12 Oak St');
  });

  it('sends members with their minutes for a log entry', () => {
    const { payload } = buildCreatePayload(filled(), TZ);
    expect(payload?.members).toEqual({ me: 60 });
    expect(payload?.event_id).toBeUndefined();
  });

  it('sends no members for an activity at an event, whose attendance credits them', () => {
    const { payload } = buildCreatePayload(filled(), TZ, 'event-1');
    expect(payload?.members).toEqual({});
    expect(payload?.event_id).toBe('event-1');
  });

  it('refuses more than a day of minutes', () => {
    expect(buildCreatePayload(filled({ members: [{ userId: 'me', minutes: '2000' }] }), TZ).error).toBe(
      'Time spent must be between 0 and 1440 minutes.'
    );
  });
});
