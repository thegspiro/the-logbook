/**
 * The run as an artifact somebody can file.
 *
 * Built on the client, deliberately. The page label, the area it belongs to
 * and the gate its route declares live in `testingRegistry.ts` and only there —
 * that is what keeps the registry honest against the router — so a server-built
 * CSV could emit route paths and nothing a reader would recognise. Every row
 * here comes from data the API already served to this account under the
 * permission check it enforces; nothing is derived that the server withheld.
 *
 * Cells go through `buildCsv`, which owns the formula-injection rule: a tester
 * note beginning `=` is text in a spreadsheet, not a command.
 */

import { buildCsv, type CsvValue } from '../../utils/csv';
import { describeGate } from './pageAccess';
import { TESTING_GROUPS, type TestGroupEntry, type TestPageEntry } from './testingRegistry';
import { GATE_VERDICT_LABELS, gateVerdict } from './gateVerdict';
import type { OtherTesterMark, TestResult, TestStatus } from './useTestingChecklist';
import type { TestingRun } from './services/api';

export interface RunExportContext {
  run: TestingRun | null;
  results: Record<string, TestResult>;
  otherMarks: Record<string, OtherTesterMark[]>;
  /** Who is signed in — their own marks carry no tester name from the server. */
  viewerName: string;
  viewerPositions: string[];
  /** Formats an ISO timestamp in the department's timezone. */
  formatTimestamp: (iso: string) => string;
}

/** One tester's mark on one page, flattened for a row-per-observation export. */
interface FlatMark {
  group: TestGroupEntry;
  page: TestPageEntry;
  testerName: string;
  testedAs: string[];
  status: TestStatus;
  note?: string | undefined;
  buildId?: string | undefined;
  expectedAccess?: TestResult['expectedAccess'];
  checkedAt?: string | undefined;
}

/**
 * Every mark in the run, in registry order.
 *
 * Untested pages are included with no tester: a report that lists only what
 * was looked at cannot show what was missed, which is half of what a coverage
 * report is for.
 */
export const flattenRun = (context: RunExportContext): FlatMark[] => {
  const rows: FlatMark[] = [];
  for (const group of TESTING_GROUPS) {
    for (const page of group.pages) {
      const mine = context.results[page.path];
      const others = context.otherMarks[page.path] ?? [];
      if (!mine && others.length === 0) {
        rows.push({ group, page, testerName: '', testedAs: [], status: 'untested' });
        continue;
      }
      if (mine) {
        rows.push({
          group,
          page,
          testerName: context.viewerName,
          testedAs: context.viewerPositions,
          status: mine.status,
          note: mine.note,
          buildId: mine.buildId,
          expectedAccess: mine.expectedAccess,
          checkedAt: mine.checkedAt,
        });
      }
      for (const other of others) {
        rows.push({
          group,
          page,
          testerName: other.testerName,
          testedAs: other.testedAs,
          status: other.status,
          note: other.note,
          buildId: other.buildId,
          expectedAccess: other.expectedAccess,
          checkedAt: other.checkedAt,
        });
      }
    }
  }
  return rows;
};

export const RUN_CSV_COLUMNS = [
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
] as const;

export const buildRunCsv = (context: RunExportContext): string => {
  const rows: CsvValue[][] = [[...RUN_CSV_COLUMNS]];
  for (const mark of flattenRun(context)) {
    const verdict = gateVerdict({
      status: mark.status,
      ...(mark.expectedAccess ? { expectedAccess: mark.expectedAccess } : {}),
    });
    rows.push([
      context.run?.label ?? '',
      mark.group.label,
      mark.page.label,
      mark.page.path,
      describeGate(mark.page),
      mark.page.module ?? '',
      mark.expectedAccess ?? '',
      mark.status,
      verdict === 'none' ? '' : GATE_VERDICT_LABELS[verdict],
      mark.note ?? '',
      mark.testerName,
      mark.testedAs.join(', '),
      mark.buildId ?? '',
      mark.checkedAt ? context.formatTimestamp(mark.checkedAt) : '',
    ]);
  }
  return buildCsv(rows);
};

/**
 * Page against tester, which is the table the whole exercise produces.
 *
 * One column per account that recorded anything, so "the chief could open it
 * and the firefighter could not" is one line to read rather than two runs to
 * compare. Pages nobody has marked are left out — in a 223-row grid they are
 * noise, and the coverage counts already say how many there are.
 */
export const buildPermissionMatrixCsv = (context: RunExportContext): string => {
  const marks = flattenRun(context).filter((mark) => mark.status !== 'untested');
  const testers = [...new Set(marks.map((mark) => mark.testerName))].filter(Boolean).sort();
  const seatOf = new Map<string, string[]>();
  for (const mark of marks) seatOf.set(mark.testerName, mark.testedAs);

  const header: CsvValue[] = [
    'Area',
    'Page',
    'Route',
    'Gate',
    ...testers.map((tester) => {
      const seats = seatOf.get(tester) ?? [];
      return seats.length > 0 ? `${tester} (${seats.join(', ')})` : tester;
    }),
  ];

  const byPage = new Map<string, FlatMark[]>();
  for (const mark of marks) {
    const existing = byPage.get(mark.page.path);
    if (existing) existing.push(mark);
    else byPage.set(mark.page.path, [mark]);
  }

  const rows: CsvValue[][] = [header];
  for (const group of TESTING_GROUPS) {
    for (const page of group.pages) {
      const pageMarks = byPage.get(page.path);
      if (!pageMarks) continue;
      rows.push([
        group.label,
        page.label,
        page.path,
        describeGate(page),
        ...testers.map((tester) => {
          const mark = pageMarks.find((entry) => entry.testerName === tester);
          if (!mark) return '—';
          const verdict = gateVerdict({
            status: mark.status,
            ...(mark.expectedAccess ? { expectedAccess: mark.expectedAccess } : {}),
          });
          return verdict === 'opened-when-refused' || verdict === 'refused-when-allowed'
            ? `${mark.status} (mismatch)`
            : mark.status;
        }),
      ]);
    }
  }
  return buildCsv(rows);
};

/** `logbook-testing-run-2026-08-27.csv` — the date is the run's, not today's. */
export const runFileName = (run: TestingRun | null, suffix: string, extension: string): string => {
  const stamp = (run?.startedAt ?? new Date().toISOString()).slice(0, 10);
  return `logbook-testing-${suffix}-${stamp}.${extension}`;
};
