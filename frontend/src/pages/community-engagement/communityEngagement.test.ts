import { describe, it, expect } from 'vitest';
import type { CommunityEventReach, CommunityReachTotals } from '../../services/api';
import {
  bucketLabel,
  changeFor,
  csvRows,
  describeChange,
  expectedText,
  niceMax,
  parseCommunityPeriod,
  reachText,
  topTypes,
  turnoutPercent,
} from './communityEngagement';

const totals = (overrides: Partial<CommunityReachTotals> = {}): CommunityReachTotals => ({
  events_held: 0,
  people_reached: 0,
  signed_in: 0,
  estimated: 0,
  member_hours: 0,
  members_involved: 0,
  requests_received: 0,
  requests_completed: 0,
  ...overrides,
});

const row = (overrides: Partial<CommunityEventReach> = {}): CommunityEventReach => ({
  event_id: 'e1',
  title: 'Fire prevention assembly',
  start_datetime: '2026-11-04T15:00:00Z',
  type_label: 'School Visit',
  organization_name: 'Oakville Elementary',
  request_id: 'r1',
  signed_in: 0,
  expected: 120,
  people_reached: 120,
  reach_is_estimate: true,
  crew: 4,
  member_hours: 10,
  ...overrides,
});

describe('parseCommunityPeriod', () => {
  it('reads the periods this screen offers and defaults to this year', () => {
    expect(parseCommunityPeriod('quarter')).toBe('quarter');
    expect(parseCommunityPeriod('all')).toBe('all');
    expect(parseCommunityPeriod(null)).toBe('year');
    expect(parseCommunityPeriod('fortnight')).toBe('year');
  });

  it("maps the dashboard card's rolling 30 days to the month", () => {
    expect(parseCommunityPeriod('rolling_30')).toBe('month');
  });
});

describe('describeChange', () => {
  it('gives a percentage where there was something to compare with', () => {
    expect(describeChange(131, 100)).toEqual({ direction: 'up', text: '+31%' });
    expect(describeChange(94, 100)).toEqual({ direction: 'down', text: '−6%' });
    expect(describeChange(5, 5)).toEqual({ direction: 'flat', text: 'no change' });
  });

  it('gives the plain difference against a zero, and nothing with no comparison', () => {
    expect(describeChange(4, 0)).toEqual({ direction: 'up', text: '+4' });
    expect(describeChange(4, null)).toBeNull();
  });

  it('compares the named figure of two periods', () => {
    expect(changeFor(totals({ member_hours: 12 }), totals({ member_hours: 8 }), 'member_hours')?.text).toBe('+50%');
    expect(changeFor(totals(), null, 'events_held')).toBeNull();
  });
});

describe('topTypes', () => {
  it('keeps the three largest and folds the rest into Other', () => {
    const slices = topTypes([
      { label: 'Station Tour', events: 5, people_reached: 520 },
      { label: 'CPR', events: 2, people_reached: 40 },
      { label: 'School Visit', events: 6, people_reached: 860 },
      { label: 'Fundraiser', events: 1, people_reached: 300 },
      { label: 'Open House', events: 1, people_reached: 410 },
    ]);
    expect(slices.map((s) => [s.label, s.people_reached, s.other])).toEqual([
      ['School Visit', 860, false],
      ['Station Tour', 520, false],
      ['Open House', 410, false],
      ['Other', 340, true],
    ]);
    expect(slices[3]?.events).toBe(3);
  });

  it('does not make an Other of a single leftover type', () => {
    const slices = topTypes([
      { label: 'A', events: 1, people_reached: 4 },
      { label: 'B', events: 1, people_reached: 3 },
      { label: 'C', events: 1, people_reached: 2 },
      { label: 'D', events: 1, people_reached: 1 },
    ]);
    expect(slices.map((s) => s.label)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('labels', () => {
  it('names a month bucket without shifting it a day', () => {
    expect(bucketLabel('2026-09')).toBe('Sep');
    expect(bucketLabel('2026-09', true)).toBe('September 2026');
    expect(bucketLabel('2024')).toBe('2024');
  });

  it('says whether reach was signed in or estimated, and the expectation beside a count', () => {
    expect(reachText(row())).toBe('~120 est.');
    expect(expectedText(row())).toBeNull();
    const counted = row({ signed_in: 25, expected: 30, people_reached: 25, reach_is_estimate: false });
    expect(reachText(counted)).toBe('25 signed in');
    expect(expectedText(counted)).toBe('of ~30 expected');
    expect(reachText(row({ expected: null, people_reached: 0, reach_is_estimate: false }))).toBe('—');
  });

  it('reports turnout only against an expectation', () => {
    expect(turnoutPercent(412, 480)).toBe(86);
    expect(turnoutPercent(4, 0)).toBeNull();
  });
});

describe('niceMax', () => {
  it('rounds the axis top up to a readable value', () => {
    expect(niceMax(380)).toBe(500);
    expect(niceMax(120)).toBe(200);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(0)).toBe(4);
  });
});

describe('csvRows', () => {
  it('exports the table with reach split into what was counted and what was expected', () => {
    const [header, first] = csvRows([row()], 'America/New_York');
    expect(header).toContain('Reach is an estimate');
    expect(first).toEqual([
      '11/04/2026',
      'Fire prevention assembly',
      'Oakville Elementary',
      'School Visit',
      0,
      120,
      120,
      'yes',
      4,
      10,
    ]);
  });
});
