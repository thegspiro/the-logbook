import { describe, it, expect } from 'vitest';
import { compareMilestones, describeItems, describeRecipients, describeTrigger } from './milestoneSummary';

describe('milestoneSummary', () => {
  it('names one item plainly and several by how they combine', () => {
    expect(describeItems([], 'all')).toBe('');
    expect(describeItems(['CPR'], 'any')).toBe('CPR');
    expect(describeItems(['CPR', 'EVOC', 'Pump Ops'], 'all')).toBe('all of CPR, EVOC and Pump Ops');
    expect(describeItems(['CPR', 'EVOC'], 'any')).toBe('any of CPR or EVOC');
  });

  it('joins a percentage and items with "and"', () => {
    expect(describeTrigger({ completion_percentage_threshold: 49.6 }, [])).toBe('At 50% complete');
    expect(describeTrigger({ completion_percentage_threshold: null }, ['CPR'])).toBe('After completing CPR');
    expect(describeTrigger({ completion_percentage_threshold: 0, item_match_mode: 'all' }, ['CPR', 'EVOC'])).toBe(
      'At 0% complete and after completing all of CPR and EVOC'
    );
    expect(describeTrigger({ completion_percentage_threshold: null }, [])).toBe(
      'No trigger set — this milestone is never reached'
    );
  });

  it('lists who is told, or says nobody is', () => {
    const base = { id: 'm', program_id: 'p', name: 'M', created_at: '' };
    expect(describeRecipients({ ...base })).toBe('Tells the member');
    expect(
      describeRecipients({
        ...base,
        notify_member: false,
        notify_positions: [{ id: 'p1', name: 'Chief' }],
        notify_users: [{ id: 'u1', name: null }],
      })
    ).toBe('Tells Chief, a former member');
    expect(describeRecipients({ ...base, notify_member: false })).toBe('Nobody is told');
  });

  it('orders percentage milestones first, then item-only ones', () => {
    const sorted = [
      { completion_percentage_threshold: null },
      { completion_percentage_threshold: 75 },
      { completion_percentage_threshold: 25 },
    ].sort(compareMilestones);
    expect(sorted.map((m) => m.completion_percentage_threshold)).toEqual([25, 75, null]);
  });
});
