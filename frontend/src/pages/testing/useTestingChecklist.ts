/**
 * Testing checklist state
 *
 * Per-page pass/fail marks, notes and sample record ids for the `/testing`
 * screen, held in this browser's localStorage.
 *
 * Deliberately not stored on the server. A tester works through a build on one
 * machine and wants the marks to survive a refresh, not to be published to the
 * department — and a shared server-side checklist would need a table, an
 * endpoint and a permission of its own before it recorded anything. Export the
 * Markdown when the run needs to leave the browser.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ALL_TEST_PAGES, TESTING_GROUPS } from './testingRegistry';

export const TEST_STATUSES = ['untested', 'pass', 'fail', 'blocked'] as const;
export type TestStatus = (typeof TEST_STATUSES)[number];

export interface TestResult {
  status: TestStatus;
  /** What went wrong, or what still needs proving. */
  note?: string;
  /** Sample record ids for a route with `:params`, keyed by parameter name. */
  params?: Record<string, string>;
  /** When the status was last changed, ISO-8601 UTC. */
  checkedAt?: string;
  /** Who was signed in when it was marked — the export needs to say. */
  checkedBy?: string;
}

export type ChecklistState = Record<string, TestResult>;

export const STORAGE_KEY = 'logbook.testing-checklist.v1';

/**
 * Reads the saved run.
 *
 * Every access is guarded: localStorage throws outright in a browser set to
 * block site data, and a checklist that cannot be saved must still open.
 */
const loadState = (): ChecklistState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as ChecklistState;
  } catch {
    return {};
  }
};

const saveState = (state: ChecklistState): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Private window or blocked site data — the run just does not persist. */
  }
};

export interface ChecklistSummary {
  total: number;
  pass: number;
  fail: number;
  blocked: number;
  untested: number;
  /** Share of pages carrying any mark at all, 0–1. */
  progress: number;
}

const summarize = (state: ChecklistState, total: number): ChecklistSummary => {
  let pass = 0;
  let fail = 0;
  let blocked = 0;
  for (const page of ALL_TEST_PAGES) {
    const status = state[page.path]?.status;
    if (status === 'pass') pass += 1;
    else if (status === 'fail') fail += 1;
    else if (status === 'blocked') blocked += 1;
  }
  const checked = pass + fail + blocked;
  return {
    total,
    pass,
    fail,
    blocked,
    untested: total - checked,
    progress: total === 0 ? 0 : checked / total,
  };
};

export interface UseTestingChecklist {
  results: ChecklistState;
  summary: ChecklistSummary;
  /** Marking the status a second time with the same value clears it. */
  setStatus: (path: string, status: TestStatus, checkedBy?: string) => void;
  setNote: (path: string, note: string) => void;
  setParam: (path: string, param: string, value: string) => void;
  clearAll: () => void;
  /** The whole run as Markdown, for pasting into an issue or a hand-off. */
  toMarkdown: (context: { department?: string; testedBy?: string; formatTimestamp: (iso: string) => string }) => string;
}

export const useTestingChecklist = (): UseTestingChecklist => {
  const [results, setResults] = useState<ChecklistState>(loadState);

  useEffect(() => {
    saveState(results);
  }, [results]);

  const update = useCallback((path: string, change: (previous: TestResult) => TestResult) => {
    setResults((previous) => ({
      ...previous,
      [path]: change(previous[path] ?? { status: 'untested' }),
    }));
  }, []);

  const setStatus = useCallback(
    (path: string, status: TestStatus, checkedBy?: string) => {
      update(path, (previous) => {
        // Tapping the mark that is already set is how a mis-click is undone;
        // without it the only way back to "untested" is clearing the run.
        const next: TestStatus = previous.status === status ? 'untested' : status;
        return {
          ...previous,
          status: next,
          ...(next === 'untested' ? {} : { checkedAt: new Date().toISOString() }),
          ...(next === 'untested' || !checkedBy ? {} : { checkedBy }),
        };
      });
    },
    [update]
  );

  const setNote = useCallback(
    (path: string, note: string) => {
      update(path, (previous) => ({ ...previous, note }));
    },
    [update]
  );

  const setParam = useCallback(
    (path: string, param: string, value: string) => {
      update(path, (previous) => ({
        ...previous,
        params: { ...(previous.params ?? {}), [param]: value },
      }));
    },
    [update]
  );

  const clearAll = useCallback(() => {
    setResults({});
  }, []);

  const summary = useMemo(() => summarize(results, ALL_TEST_PAGES.length), [results]);

  const toMarkdown = useCallback<UseTestingChecklist['toMarkdown']>(
    ({ department, testedBy, formatTimestamp }) => {
      const mark: Record<TestStatus, string> = {
        pass: '[x] PASS',
        fail: '[ ] FAIL',
        blocked: '[ ] BLOCKED',
        untested: '[ ] not tested',
      };
      const lines: string[] = ['# The Logbook — page testing run', ''];
      if (department) lines.push(`- Department: ${department}`);
      if (testedBy) lines.push(`- Tested by: ${testedBy}`);
      lines.push(
        `- Result: ${summary.pass} passed, ${summary.fail} failed, ${summary.blocked} blocked, ${summary.untested} not tested (${summary.total} pages)`,
        ''
      );

      for (const group of TESTING_GROUPS) {
        lines.push(`## ${group.label}`, '');
        for (const page of group.pages) {
          const result = results[page.path];
          const status = result?.status ?? 'untested';
          const when = result?.checkedAt ? ` — ${formatTimestamp(result.checkedAt)}` : '';
          const by = result?.checkedBy ? ` by ${result.checkedBy}` : '';
          lines.push(`- ${mark[status]} \`${page.path}\` ${page.label}${when}${by}`);
          if (result?.note?.trim()) lines.push(`  - ${result.note.trim()}`);
        }
        lines.push('');
      }
      return lines.join('\n');
    },
    [results, summary]
  );

  return { results, summary, setStatus, setNote, setParam, clearAll, toMarkdown };
};
