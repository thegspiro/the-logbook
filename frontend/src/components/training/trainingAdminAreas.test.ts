import { describe, it, expect } from 'vitest';
import type { AdminAttentionItem } from '../../types/adminHub';
import { TRAINING_ADMIN_AREAS, attentionCountsByTab, resolveTrainingAdminLocation } from './trainingAdminAreas';

const attention = (href: string, count: number): AdminAttentionItem => ({
  key: href,
  title: 't',
  detail: '',
  actionLabel: 'Open',
  href,
  severity: 'warning',
  count,
  oldestAgeDays: null,
});

describe('TRAINING_ADMIN_AREAS', () => {
  // Older links carry only a destination id, so two areas sharing one would
  // make those links ambiguous.
  it('gives every destination an id unique across the hub', () => {
    const ids = TRAINING_ADMIN_AREAS.flatMap((area) => area.destinations.map((destination) => destination.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('describes every area and destination', () => {
    for (const area of TRAINING_ADMIN_AREAS) {
      expect(area.description).not.toBe('');
      expect(area.destinations.length).toBeGreaterThan(0);
      for (const destination of area.destinations) expect(destination.hint).not.toBe('');
    }
  });
});

describe('resolveTrainingAdminLocation', () => {
  it('honours a current area and destination', () => {
    expect(resolveTrainingAdminLocation('curriculum', 'courses')).toEqual({ area: 'curriculum', tab: 'courses' });
  });

  it('opens an area on its first destination when none is named', () => {
    expect(resolveTrainingAdminLocation('settings', null)).toEqual({ area: 'settings', tab: 'manual-entry' });
  });

  // Every one of these is a link still written somewhere: dashboard widgets,
  // onboarding steps, redirects in routes.tsx, the backend's attention queue.
  it.each([
    ['setup', 'requirements', 'curriculum'],
    ['setup', 'pipelines', 'curriculum'],
    ['setup', 'skill-evaluations', 'evaluations'],
    ['setup', 'integrations', 'settings'],
    ['setup', 'metrics', 'settings'],
    ['skills-testing', 'tests', 'evaluations'],
    ['records', 'submissions', 'records'],
    ['dashboard', 'expiring-certs', 'dashboard'],
    ['enhancements', 'reports', 'enhancements'],
  ])('sends the older ?page=%s&tab=%s to %s', (page, tab, area) => {
    expect(resolveTrainingAdminLocation(page, tab)).toEqual({ area, tab });
  });

  it('resolves a destination paired with the wrong area by the destination', () => {
    expect(resolveTrainingAdminLocation('records', 'requirements')).toEqual({
      area: 'curriculum',
      tab: 'requirements',
    });
  });

  it('resolves the flat ?tab= links that predate areas', () => {
    expect(resolveTrainingAdminLocation(null, 'tests')).toEqual({ area: 'evaluations', tab: 'tests' });
  });

  it.each([
    ['setup', 'curriculum', 'requirements'],
    ['skills-testing', 'evaluations', 'skill-evaluations'],
  ])('opens the retired ?page=%s alone on %s', (page, area, tab) => {
    expect(resolveTrainingAdminLocation(page, null)).toEqual({ area, tab });
  });

  it('falls back to the dashboard for anything unknown', () => {
    expect(resolveTrainingAdminLocation('nope', 'nope')).toEqual({ area: 'dashboard', tab: 'overview' });
    expect(resolveTrainingAdminLocation(null, null)).toEqual({ area: 'dashboard', tab: 'overview' });
  });
});

describe('attentionCountsByTab', () => {
  it('sums the queue by the destination each item links to', () => {
    expect(
      attentionCountsByTab([
        attention('/training/admin?page=records&tab=submissions', 3),
        attention('/training/admin?page=dashboard&tab=expiring-certs', 2),
        attention('/training/admin?page=dashboard&tab=expiring-certs', 1),
      ])
    ).toEqual({ submissions: 3, 'expiring-certs': 3 });
  });

  it('ignores links that name no destination of this hub', () => {
    expect(
      attentionCountsByTab([
        attention('/inventory/admin?tab=requests', 4),
        attention('/training/admin', 1),
        attention('/training/admin?page=records', 1),
        attention('/training/admin?page=records&tab=nope', 1),
      ])
    ).toEqual({});
  });
});
