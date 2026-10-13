import { describe, it, expect } from 'vitest';
import { buildUpcomingItems, daysBetween, UPCOMING_WINDOW_DAYS } from './trainingUpcoming';
import type { MyTrainingSummary, RequirementDetail } from '../types/training';

const TODAY = '2026-10-13';

const requirement = (overrides: Partial<RequirementDetail> = {}): RequirementDetail => ({
  id: 'req-1',
  name: 'Annual Training Hours',
  frequency: 'annual',
  required_hours: 72,
  completed_hours: 19.5,
  progress_percentage: 27,
  is_met: false,
  due_date: '2026-12-31',
  days_until_due: 79,
  ...overrides,
});

const summary = (overrides: Partial<MyTrainingSummary> = {}): MyTrainingSummary =>
  ({ visibility: {}, ...overrides }) as MyTrainingSummary;

describe('daysBetween', () => {
  it('counts whole calendar days, negative when the target is past', () => {
    expect(daysBetween('2026-10-13', '2026-11-01')).toBe(19);
    expect(daysBetween('2026-10-13', '2026-10-13')).toBe(0);
    expect(daysBetween('2026-10-13', '2026-10-10')).toBe(-3);
  });

  it('is not thrown by a daylight-saving change between the dates', () => {
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
    expect(daysBetween('2026-10-01', '2026-11-30')).toBe(60);
  });
});

describe('buildUpcomingItems', () => {
  it('lists an unmet requirement with the server days and a soon urgency inside 90 days', () => {
    const items = buildUpcomingItems(summary({ requirements_detail: [requirement()] }), TODAY);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'requirement', date: '2026-12-31', days: 79, urgency: 'soon' });
    expect(items[0]?.detail).toBe('19.5/72 hrs complete');
  });

  it('marks a lapsed requirement overdue and sorts it first', () => {
    const items = buildUpcomingItems(
      summary({
        requirements_detail: [
          requirement({ id: 'a', name: 'Later', days_until_due: 120, due_date: '2027-02-10' }),
          requirement({ id: 'b', name: 'Late', days_until_due: -5, due_date: '2026-10-08' }),
        ],
      }),
      TODAY
    );
    expect(items.map((i) => i.title)).toEqual(['Late', 'Later']);
    expect(items[0]?.urgency).toBe('overdue');
    expect(items[1]?.urgency).toBe('later');
  });

  it('leaves out anything beyond the look-ahead window', () => {
    const items = buildUpcomingItems(
      summary({
        requirements_detail: [requirement({ days_until_due: UPCOMING_WINDOW_DAYS + 1 })],
        certifications: [
          {
            id: 'c1',
            course_name: 'CPR/BLS Certification',
            expiration_date: '2027-08-21',
            is_expired: false,
            days_until_expiry: 312,
          },
        ],
      }),
      TODAY
    );
    expect(items).toEqual([]);
  });

  it('does not list a met requirement, but does announce the next early-credit window', () => {
    const items = buildUpcomingItems(
      summary({
        requirements_detail: [
          requirement({ id: 'met', name: 'HIPAA', is_met: true, next_window_opens: '2026-11-01' }),
          requirement({ id: 'done', name: 'CPR', is_met: true }),
        ],
      }),
      TODAY
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'window', title: 'HIPAA', days: 19, date: '2026-11-01' });
  });

  it('uses the catch-up deadline for a requirement still inside its catch-up period', () => {
    const items = buildUpcomingItems(
      summary({
        requirements_detail: [
          requirement({ catch_up_deadline: '2026-11-30', due_date: '2026-11-30', days_until_due: 48 }),
        ],
      }),
      TODAY
    );
    expect(items[0]).toMatchObject({ date: '2026-11-30', days: 48 });
  });

  it('reads a renewed certification once, from its newest record', () => {
    const items = buildUpcomingItems(
      summary({
        certifications: [
          {
            id: 'old',
            course_name: 'CPR/BLS',
            expiration_date: '2025-08-21',
            is_expired: true,
            days_until_expiry: -418,
          },
          {
            id: 'new',
            course_name: 'CPR/BLS',
            expiration_date: '2026-12-01',
            is_expired: false,
            days_until_expiry: 49,
          },
        ],
      }),
      TODAY
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: 'cert-new', urgency: 'soon' });
  });

  it('shows a lapsed certification as overdue', () => {
    const items = buildUpcomingItems(
      summary({
        certifications: [
          { id: 'c', course_name: 'EMT-B', expiration_date: '2026-09-01', is_expired: true, days_until_expiry: -42 },
        ],
      }),
      TODAY
    );
    expect(items[0]).toMatchObject({ urgency: 'overdue', detail: 'Certification expired' });
  });

  it('folds a certification requirement into the certification row of the same name', () => {
    const items = buildUpcomingItems(
      summary({
        requirements_detail: [
          requirement({
            id: 'cpr',
            name: 'CPR/BLS Certification',
            is_met: false,
            due_date: '2026-11-01',
            days_until_due: 19,
          }),
        ],
        certifications: [
          {
            id: 'c',
            course_name: 'cpr/bls certification',
            expiration_date: '2026-11-01',
            is_expired: false,
            days_until_expiry: 19,
          },
        ],
      }),
      TODAY
    );
    expect(items.map((i) => i.kind)).toEqual(['certification']);
  });

  it('is empty when the server withheld both lists', () => {
    expect(buildUpcomingItems(summary(), TODAY)).toEqual([]);
  });

  describe('an hours requirement with no deadline', () => {
    const rolling = (overrides: Partial<RequirementDetail> = {}): RequirementDetail =>
      requirement({
        id: 'hours',
        name: 'Annual Training Hours',
        due_date: null,
        days_until_due: null,
        required_hours: 72,
        completed_hours: 19.5,
        monthly_hours: [
          { month: '2025-11', hours: 2 },
          { month: '2026-10', hours: 17.5 },
        ],
        ...overrides,
      });

    it('is listed with the hours still to earn, and no date', () => {
      const items = buildUpcomingItems(summary({ requirements_detail: [rolling()] }), TODAY);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        kind: 'shortfall',
        title: 'Annual Training Hours',
        date: null,
        days: null,
        hoursShort: 52.5,
        urgency: 'soon',
      });
      expect(items[0]?.detail).toBe('19.5/72 hrs · counting Nov 2025 – Oct 2026');
    });

    it('sorts after every dated item', () => {
      const items = buildUpcomingItems(
        summary({
          requirements_detail: [
            rolling(),
            requirement({ id: 'late', name: 'Late', days_until_due: 150, due_date: '2027-03-12' }),
            requirement({ id: 'sooner', name: 'Sooner', days_until_due: 10, due_date: '2026-10-23' }),
          ],
        }),
        TODAY
      );
      expect(items.map((i) => i.title)).toEqual(['Sooner', 'Late', 'Annual Training Hours']);
    });

    it('is not listed once the requirement is met', () => {
      const items = buildUpcomingItems(
        summary({ requirements_detail: [rolling({ is_met: true, completed_hours: 72 })] }),
        TODAY
      );
      expect(items).toEqual([]);
    });

    it('is not listed when it has no monthly breakdown, as with a one-time requirement', () => {
      const items = buildUpcomingItems(summary({ requirements_detail: [rolling({ monthly_hours: null })] }), TODAY);
      expect(items).toEqual([]);
    });

    it('never shows a negative shortfall', () => {
      const items = buildUpcomingItems(
        summary({ requirements_detail: [rolling({ completed_hours: 80, required_hours: 72 })] }),
        TODAY
      );
      expect(items[0]?.hoursShort).toBe(0);
    });

    it('keeps a calendar-year hours requirement on its due date', () => {
      const items = buildUpcomingItems(
        summary({
          requirements_detail: [rolling({ due_date: '2026-12-31', days_until_due: 79 })],
        }),
        TODAY
      );
      expect(items[0]).toMatchObject({ kind: 'requirement', days: 79 });
    });
  });
});
