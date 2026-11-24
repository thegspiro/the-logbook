import { describe, it, expect } from 'vitest';
import type { CommunityEventReach, CommunityReachTotals } from '../../services/api';
import {
  allTypesIn,
  bucketLabel,
  changeFor,
  csvRows,
  describeChange,
  expectedText,
  feedbackText,
  niceMax,
  parseCommunityPeriod,
  periodRangeText,
  reachText,
  topTypes,
  typeGroups,
  turnoutPercent,
} from './communityEngagement';

const totals = (overrides: Partial<CommunityReachTotals> = {}): CommunityReachTotals => ({
  events_held: 0,
  people_reached: 0,
  counted: 0,
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
  headcount: null,
  counted: null,
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
      { group: 'request', label: 'Station Tour', events: 5, people_reached: 520 },
      { group: 'request', label: 'CPR', events: 2, people_reached: 40 },
      { group: 'request', label: 'School Visit', events: 6, people_reached: 860 },
      { group: 'request', label: 'Fundraiser', events: 1, people_reached: 300 },
      { group: 'request', label: 'Open House', events: 1, people_reached: 410 },
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
      { group: 'request', label: 'A', events: 1, people_reached: 4 },
      { group: 'request', label: 'B', events: 1, people_reached: 3 },
      { group: 'request', label: 'C', events: 1, people_reached: 2 },
      { group: 'request', label: 'D', events: 1, people_reached: 1 },
    ]);
    expect(slices.map((s) => s.label)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('keeps public requests and department events in their own groups', () => {
    const groups = typeGroups([
      { group: 'department', label: 'Public Education', events: 2, people_reached: 300 },
      { group: 'request', label: 'School Visit', events: 3, people_reached: 240 },
      { group: 'request', label: 'Station Tour', events: 1, people_reached: 14 },
    ]);
    expect(groups.map((g) => [g.title, g.slices.map((t) => t.label)])).toEqual([
      ['Public requests', ['School Visit', 'Station Tour']],
      ['Department events', ['Public Education']],
    ]);
    expect(typeGroups([{ group: 'department', label: 'Social', events: 1, people_reached: 5 }])).toHaveLength(1);
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
    const signedIn = row({ signed_in: 25, counted: 25, expected: 30, people_reached: 25, reach_is_estimate: false });
    expect(reachText(signedIn)).toBe('25 signed in');
    expect(expectedText(signedIn)).toBe('of ~30 expected');
    expect(reachText(row({ expected: null, people_reached: 0, reach_is_estimate: false }))).toBe('—');
  });

  it('reads a headcount as counted, ahead of the sign-ins it replaced', () => {
    const room = row({ headcount: 140, signed_in: 3, counted: 140, people_reached: 140, reach_is_estimate: false });
    expect(reachText(room)).toBe('140 counted');
    expect(expectedText(room)).toBe('of ~120 expected');
    // A count of nobody is still a count: it says what happened, not "—".
    const empty = row({ headcount: 0, counted: 0, people_reached: 0, reach_is_estimate: false });
    expect(reachText(empty)).toBe('0 counted');
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
      '',
      0,
      120,
      120,
      'yes',
      4,
      10,
      '',
      '',
      '',
    ]);
  });

  it('exports what was recorded when the event closed', () => {
    const [header, first] = csvRows(
      [
        row({
          materials: [
            { item: 'Smoke alarms', quantity: 12 },
            { item: 'Flyers', quantity: 100 },
          ],
          photos: 'not_consented',
          outcome_note: 'Follow up with the principal',
        }),
      ],
      'America/New_York'
    );
    expect(header?.slice(-3)).toEqual(['Materials handed out', 'Photos', 'Outcome']);
    expect(first?.slice(-3)).toEqual([
      '12 Smoke alarms; 100 Flyers',
      'Without consent',
      'Follow up with the principal',
    ]);
  });
});

describe('periodRangeText', () => {
  it("names the span in the department's calendar", () => {
    expect(periodRangeText('2026-01-01T05:00:00Z', '2026-11-20T17:00:00Z', 'America/New_York')).toBe(
      'January 1, 2026 – November 20, 2026'
    );
  });

  it('has no start for all time', () => {
    expect(periodRangeText(null, '2026-11-20T17:00:00Z', 'America/New_York')).toBe('Through November 20, 2026');
  });

  it("reads a midnight-UTC boundary as the department's own day", () => {
    // 04:30 UTC on Jan 1 is still December 31 in New York.
    expect(periodRangeText('2026-01-01T04:30:00Z', '2026-01-02T12:00:00Z', 'America/New_York')).toBe(
      'December 31, 2025 – January 2, 2026'
    );
  });
});

describe('allTypesIn', () => {
  it('keeps every type of one group, largest reach first', () => {
    const types = [
      { group: 'request' as const, label: 'CPR', events: 2, people_reached: 40 },
      { group: 'department' as const, label: 'Public Education', events: 4, people_reached: 670 },
      { group: 'request' as const, label: 'School Visit', events: 6, people_reached: 860 },
      { group: 'request' as const, label: 'Fundraiser', events: 1, people_reached: 40 },
      { group: 'request' as const, label: 'Block Party', events: 3, people_reached: 40 },
    ];
    expect(allTypesIn(types, 'request').map((t) => t.label)).toEqual([
      'School Visit',
      'Block Party',
      'CPR',
      'Fundraiser',
    ]);
    expect(allTypesIn(types, 'department').map((t) => t.label)).toEqual(['Public Education']);
  });
});

describe('feedbackText', () => {
  it("words the backend's average against the rating scale", () => {
    expect(feedbackText(totals({ feedback_responses: 12, average_rating: 4.6 }), 5)).toBe(
      '4.6 out of 5, from 12 responses'
    );
    expect(feedbackText(totals({ feedback_responses: 1, average_rating: 3 }), null)).toBe('3, from 1 response');
  });

  it('counts responses without a rating, and says nothing when nobody answered', () => {
    expect(feedbackText(totals({ feedback_responses: 3, average_rating: null }), 5)).toBe('3 responses');
    expect(feedbackText(totals(), 5)).toBeNull();
  });
});
