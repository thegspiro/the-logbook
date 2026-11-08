import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { EventRequestListItem, PipelineTaskConfig } from '../../types/event';
import {
  awaitingReplyTooLong,
  dateUrgency,
  groupRequests,
  matchesScope,
  matchesSearch,
  nextStep,
  receivedAge,
  requestDate,
  taskProgress,
} from './requestInbox';

const TZ = 'America/New_York';
// Noon in New York on Sunday 8 November 2026.
const NOW = new Date('2026-11-08T17:00:00Z');

const TASKS: PipelineTaskConfig[] = [
  { id: 'review', label: 'Review Request', description: '' },
  { id: 'approve', label: 'Chief Approval', description: '' },
  { id: 'confirm', label: 'Confirm Date', description: '' },
];

const done = { completed: true, completed_by: 'u1', completed_at: '2026-11-05T12:00:00Z' };

const req = (overrides: Partial<EventRequestListItem> = {}): EventRequestListItem => ({
  id: 'r',
  contact_name: 'Tom Becker',
  contact_email: 'tom@example.test',
  organization_name: 'Maple Street HOA',
  outreach_type: 'block_party',
  status: 'in_progress',
  date_flexibility: 'specific_dates',
  created_at: '2026-11-02T15:00:00Z',
  ...overrides,
});

describe('requestInbox', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('requestDate', () => {
    it('uses the confirmed date once there is one', () => {
      expect(
        requestDate(req({ event_date: '2026-11-11T23:00:00Z', preferred_date_start: '2026-11-20T18:00:00Z' }))
      ).toBe('2026-11-11T23:00:00Z');
    });

    it('uses the requested date only when the requester named one', () => {
      expect(requestDate(req({ preferred_date_start: '2026-11-20T18:00:00Z' }))).toBe('2026-11-20T18:00:00Z');
      expect(
        requestDate(req({ date_flexibility: 'general_timeframe', preferred_date_start: '2026-11-20T18:00:00Z' }))
      ).toBeNull();
    });
  });

  describe('dateUrgency', () => {
    it('counts calendar days in the department timezone', () => {
      // 22:00 UTC on the 13th is 17:00 on the 13th in New York: five days out.
      expect(dateUrgency(req({ preferred_date_start: '2026-11-13T22:00:00Z' }), TZ)).toEqual({
        days: 5,
        label: 'in 5 days',
        urgent: true,
      });
    });

    it('is not urgent beyond a week', () => {
      expect(dateUrgency(req({ preferred_date_start: '2026-11-17T18:00:00Z' }), TZ)).toEqual({
        days: 9,
        label: 'in 9 days',
        urgent: false,
      });
    });

    it('says today, tomorrow and a past date plainly', () => {
      expect(dateUrgency(req({ preferred_date_start: '2026-11-08T23:00:00Z' }), TZ)?.label).toBe('today');
      expect(dateUrgency(req({ preferred_date_start: '2026-11-09T18:00:00Z' }), TZ)?.label).toBe('tomorrow');
      expect(dateUrgency(req({ preferred_date_start: '2026-11-05T18:00:00Z' }), TZ)?.label).toBe('3 days ago');
    });

    it('has nothing to say about a closed request or one with no date', () => {
      expect(dateUrgency(req({ status: 'completed', event_date: '2026-11-09T18:00:00Z' }), TZ)).toBeNull();
      expect(dateUrgency(req({ date_flexibility: 'flexible' }), TZ)).toBeNull();
    });
  });

  describe('receivedAge', () => {
    it('reads in days, then weeks, then months', () => {
      expect(receivedAge('2026-11-08T14:00:00Z', TZ)).toBe('today');
      expect(receivedAge('2026-11-07T14:00:00Z', TZ)).toBe('yesterday');
      expect(receivedAge('2026-11-02T14:00:00Z', TZ)).toBe('6 days ago');
      expect(receivedAge('2026-10-19T14:00:00Z', TZ)).toBe('2 weeks ago');
      expect(receivedAge('2026-08-20T14:00:00Z', TZ)).toBe('2 months ago');
    });
  });

  describe('awaitingReplyTooLong', () => {
    it('calls out a new request left two days without a start', () => {
      expect(awaitingReplyTooLong(req({ status: 'submitted', created_at: '2026-11-06T14:00:00Z' }), TZ)).toBe(true);
      expect(awaitingReplyTooLong(req({ status: 'submitted', created_at: '2026-11-07T14:00:00Z' }), TZ)).toBe(false);
      expect(awaitingReplyTooLong(req({ status: 'in_progress', created_at: '2026-10-01T14:00:00Z' }), TZ)).toBe(false);
    });
  });

  describe('taskProgress', () => {
    it('counts only the tasks the department still configures', () => {
      const r = req({ task_completions: { review: done, retired: done } });
      expect(taskProgress(r, TASKS)).toEqual({ done: 1, total: 3 });
    });
  });

  describe('nextStep', () => {
    it('asks for a coordinator, then a reply, on a new request', () => {
      expect(nextStep(req({ status: 'submitted' }), TASKS)).toBe('Assign a coordinator');
      expect(nextStep(req({ status: 'submitted', assigned_to: 'u1' }), TASKS)).toBe(
        'Reply to the requester and start work'
      );
    });

    it('names the first open checklist step, then scheduling', () => {
      expect(nextStep(req({ task_completions: { review: done } }), TASKS)).toBe('Chief Approval');
      expect(nextStep(req({ task_completions: { review: done, approve: done, confirm: done } }), TASKS)).toBe(
        'Schedule the event'
      );
    });

    it('asks for volunteers until the sheet is full', () => {
      expect(nextStep(req({ status: 'scheduled' }), TASKS)).toBe('Open volunteer signups');
      expect(nextStep(req({ status: 'scheduled', staffing_slots_filled: 4, staffing_slots_total: 6 }), TASKS)).toBe(
        'Find 2 more volunteers'
      );
      expect(nextStep(req({ status: 'scheduled', staffing_slots_filled: 5, staffing_slots_total: 6 }), TASKS)).toBe(
        'Find 1 more volunteer'
      );
      expect(
        nextStep(req({ status: 'scheduled', staffing_slots_filled: 6, staffing_slots_total: 6 }), TASKS)
      ).toBeNull();
    });

    it('has nothing left on a closed request', () => {
      expect(nextStep(req({ status: 'declined' }), TASKS)).toBeNull();
    });
  });

  describe('matchesScope', () => {
    it('separates my requests from unassigned ones', () => {
      const mine = req({ assigned_to: 'me' });
      const theirs = req({ assigned_to: 'them' });
      const nobody = req({});
      expect([mine, theirs, nobody].filter((r) => matchesScope(r, 'mine', 'me'))).toEqual([mine]);
      expect([mine, theirs, nobody].filter((r) => matchesScope(r, 'unassigned', 'me'))).toEqual([nobody]);
      expect([mine, theirs, nobody].filter((r) => matchesScope(r, 'all', 'me'))).toHaveLength(3);
    });

    it('shows nothing as mine before the signed-in member is known', () => {
      expect(matchesScope(req({ assigned_to: 'me' }), 'mine', undefined)).toBe(false);
    });
  });

  describe('matchesSearch', () => {
    it('matches requester, organization, type and coordinator without regard to case', () => {
      const r = req({ assignee_name: 'Lt. Sarah Chen' });
      expect(matchesSearch(r, 'maple', 'Block Party')).toBe(true);
      expect(matchesSearch(r, 'BECKER', 'Block Party')).toBe(true);
      expect(matchesSearch(r, 'block', 'Block Party')).toBe(true);
      expect(matchesSearch(r, 'chen', 'Block Party')).toBe(true);
      expect(matchesSearch(r, 'library', 'Block Party')).toBe(false);
      expect(matchesSearch(r, '   ', 'Block Party')).toBe(true);
    });
  });

  describe('groupRequests', () => {
    it('puts each status in its group and the most pressing first', () => {
      const grouped = groupRequests([
        req({ id: 'new-recent', status: 'submitted', created_at: '2026-11-08T12:00:00Z' }),
        req({ id: 'new-old', status: 'submitted', created_at: '2026-11-05T12:00:00Z' }),
        req({ id: 'work-later', preferred_date_start: '2026-11-20T18:00:00Z' }),
        req({ id: 'work-soon', preferred_date_start: '2026-11-13T18:00:00Z' }),
        req({ id: 'work-undated', date_flexibility: 'flexible' }),
        req({ id: 'done', status: 'completed' }),
        req({ id: 'off', status: 'cancelled' }),
      ]);
      expect(grouped.reply.map((r) => r.id)).toEqual(['new-old', 'new-recent']);
      expect(grouped.working.map((r) => r.id)).toEqual(['work-soon', 'work-later', 'work-undated']);
      expect(grouped.closed.map((r) => r.id).sort()).toEqual(['done', 'off']);
      expect(grouped.scheduled).toEqual([]);
    });
  });
});
