import { describe, it, expect } from 'vitest';
import { buildPermissionMatrixCsv, buildRunCsv, flattenRun, runFileName } from './exportRun';
import type { RunExportContext } from './exportRun';

const context = (overrides: Partial<RunExportContext> = {}): RunExportContext => ({
  run: {
    id: 'run-1',
    sequence: 1,
    label: 'Pre-launch',
    buildId: 'build-1',
    startedAt: '2026-08-27T09:00:00Z',
    startedById: 'u1',
    startedByName: 'Ivy Manager',
    isCurrent: true,
  },
  results: {},
  otherMarks: {},
  viewerId: 'u1',
  viewerName: 'Ivy Manager',
  viewerPositions: ['System Owner'],
  formatTimestamp: () => 'Aug 27, 2026, 9:00 AM',
  ...overrides,
});

const rowsOf = (csv: string) => csv.split('\r\n').map((line) => line.split(','));

describe('flattenRun', () => {
  it('lists a page nobody has marked, so the gaps are visible too', () => {
    const rows = flattenRun(context());

    expect(rows.length).toBeGreaterThan(200);
    expect(rows.every((row) => row.status === 'untested')).toBe(true);
  });

  it('gives each tester their own row on a page', () => {
    const rows = flattenRun(
      context({
        results: { '/events/admin': { status: 'pass', expectedAccess: 'allowed' } },
        otherMarks: {
          '/events/admin': [
            {
              userId: 'u2',
              testerName: 'Firefighter Jones',
              testedAs: ['firefighter'],
              status: 'blocked',
              expectedAccess: 'denied',
            },
          ],
        },
      })
    );

    const forPage = rows.filter((row) => row.page.path === '/events/admin');
    expect(forPage.map((row) => [row.testerName, row.status])).toEqual([
      ['Ivy Manager', 'pass'],
      ['Firefighter Jones', 'blocked'],
    ]);
  });
});

describe('buildRunCsv', () => {
  it('names the columns a reader needs', () => {
    const [header] = rowsOf(buildRunCsv(context()));

    expect(header).toEqual([
      'Run',
      'Area',
      'Page',
      'Route',
      'Gate',
      'Module',
      'Expected',
      'Result',
      'Gate verdict',
      'Note',
      'Tester',
      'Positions',
      'Build',
      'Marked at',
    ]);
  });

  it('spells out a gate that did not behave', () => {
    const csv = buildRunCsv(
      context({
        results: {
          '/events/admin': { status: 'pass', expectedAccess: 'denied', checkedAt: '2026-08-27T12:00:00Z' },
        },
      })
    );

    const row = rowsOf(csv).find((cells) => cells[3] === '/events/admin');
    expect(row).toBeDefined();
    expect(row?.[8]).toBe('Opened when it should have refused');
    expect(row?.[10]).toBe('Ivy Manager');
  });

  it('neutralizes a note that would otherwise execute in Excel', () => {
    const csv = buildRunCsv(context({ results: { '/dashboard': { status: 'fail', note: '=cmd|calc' } } }));

    expect(csv).toContain("'=cmd|calc");
    expect(csv).not.toContain(',=cmd|calc');
  });
});

describe('buildPermissionMatrixCsv', () => {
  it('puts one column per tester and leaves unmarked pages out', () => {
    const csv = buildPermissionMatrixCsv(
      context({
        results: { '/events/admin': { status: 'pass', expectedAccess: 'denied' } },
        otherMarks: {
          '/events/admin': [
            {
              userId: 'u2',
              testerName: 'Firefighter Jones',
              testedAs: ['firefighter'],
              status: 'blocked',
              expectedAccess: 'denied',
            },
          ],
        },
      })
    );

    const rows = rowsOf(csv);
    expect(rows[0]).toEqual([
      'Area',
      'Page',
      'Route',
      'Gate',
      'Firefighter Jones (firefighter)',
      'Ivy Manager (System Owner)',
    ]);
    // Exactly one page row: nothing else was marked.
    expect(rows).toHaveLength(2);
    expect(rows[1]?.slice(4)).toEqual(['blocked', 'pass (mismatch)']);
  });
});

describe('the matrix keys columns by account', () => {
  it('keeps two testers who share a display name apart', () => {
    // Names are not unique; keying columns by name collapsed them into one and
    // dropped one account's mark on every page they both tested.
    const csv = buildPermissionMatrixCsv(
      context({
        results: { '/events/admin': { status: 'pass' } },
        otherMarks: {
          '/events/admin': [{ userId: 'u2', testerName: 'Ivy Manager', testedAs: ['firefighter'], status: 'blocked' }],
        },
        viewerId: 'u1',
        viewerName: 'Ivy Manager',
        viewerPositions: ['System Owner'],
      })
    );

    const rows = csv.split('\r\n').map((line) => line.split(','));
    expect(rows[0]).toHaveLength(6);
    expect(rows[1]?.slice(4)).toEqual(['pass', 'blocked']);
  });

  it('attributes a mark to the seat held when it was made', () => {
    const csv = buildRunCsv(
      context({
        results: { '/dashboard': { status: 'pass', testedAs: ['Lieutenant'] } },
        viewerPositions: ['Captain'],
      })
    );

    const row = csv
      .split('\r\n')
      .map((line) => line.split(','))
      .find((cells) => cells[3] === '/dashboard');
    expect(row?.[11]).toBe('Lieutenant');
  });
});

describe('runFileName', () => {
  it('dates the file from the run, not from today', () => {
    expect(runFileName(context().run, 'run', 'csv')).toBe('logbook-testing-run-2026-08-27.csv');
  });
});
