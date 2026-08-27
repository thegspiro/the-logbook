/**
 * Testing checklist state
 *
 * The run lives on the server (`/api/v1/testing-checklist`), one row per
 * tester per page. It began in localStorage and moved for one reason: a
 * checklist of permission gates is only meaningful across accounts. The method
 * is to sign in as a firefighter, then a lieutenant, then a chief and confirm
 * each is refused what they should be — evidence that is worthless if it is
 * scattered over three browsers. The IT manager (`settings.manage`) reads
 * every tester's marks; everyone else reads their own.
 *
 * Marks are applied optimistically and reverted if the save fails, so a lost
 * write is visible immediately rather than discovered at the end of a run.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  testingChecklistService,
  type TestingAccessExpectation,
  type TestingCheckEntry,
  type TestingCheckStatus,
  type TestingRun,
} from './services/api';
import { getCurrentBuildId } from '../../utils/appVersion';
import { getErrorMessage, toAppError } from '../../utils/errorHandling';
import { ALL_TEST_PAGES, TESTING_GROUPS } from './testingRegistry';

/**
 * The grant that opens every tester's marks.
 *
 * Mirrors `SEE_ALL_TESTERS_PERMISSION` on the endpoint — the server is what
 * enforces it; this only decides whether the screen asks for the shared run.
 */
export const SEE_ALL_TESTERS_PERMISSION = 'settings.manage';

/**
 * The department switched the module off.
 *
 * Worth telling apart from any other failed load. The frontend's `isModuleOn`
 * is permissive for an organization that has never configured its modules,
 * while the server always resolves the declared defaults — so an unconfigured
 * department reaches this screen and the API refuses it. "Could not load the
 * testing run" would send an administrator looking for a broken server; the
 * answer is a switch under Settings → Modules.
 */
const MODULE_DISABLED_CODE = 'LB-ORG-002';

export const TEST_STATUSES = ['untested', 'pass', 'fail', 'blocked'] as const;
export type TestStatus = TestingCheckStatus;

export interface TestResult {
  status: TestStatus;
  /** The build this mark was made against; absent in development. */
  buildId?: string;
  /** What the screen predicted when the mark was made. */
  expectedAccess?: TestingAccessExpectation;
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

/** Another tester's mark on a page, as shown beside your own. */
export interface OtherTesterMark {
  userId: string;
  testerName: string;
  testedAs: string[];
  status: TestStatus;
  note?: string;
  checkedAt?: string;
  buildId?: string;
  expectedAccess?: TestingAccessExpectation;
}

// Notes and sample ids are typed, not clicked: saving each keystroke would put
// a request on the wire per character. A status is saved immediately.
const TEXT_SAVE_DELAY_MS = 600;

const toResult = (entry: TestingCheckEntry): TestResult => ({
  status: entry.status,
  ...(entry.buildId ? { buildId: entry.buildId } : {}),
  ...(entry.expectedAccess ? { expectedAccess: entry.expectedAccess } : {}),
  ...(entry.note ? { note: entry.note } : {}),
  ...(entry.params ? { params: entry.params } : {}),
  ...(entry.checkedAt ? { checkedAt: entry.checkedAt } : {}),
  ...(entry.userName ? { checkedBy: entry.userName } : {}),
});

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

export interface UseTestingChecklistOptions {
  /** Ask for every tester's marks. The server enforces the grant. */
  includeAllTesters?: boolean;
  /**
   * What the screen predicts this account will meet on a page, recorded
   * alongside the result so "it opened for somebody it should have refused"
   * is visible rather than reading as an ordinary pass.
   */
  expectationFor?: (path: string) => TestingAccessExpectation | undefined;
}

export interface UseTestingChecklist {
  results: ChecklistState;
  /** The run being read: the current one unless an earlier one was picked. */
  run: TestingRun | null;
  /** Every run the department has kept, newest first. */
  runs: TestingRun[];
  /** True while an archived run is on screen — it is a record, not a board. */
  isViewingArchivedRun: boolean;
  /** The build this browser is running; absent in development. */
  currentBuildId: string | undefined;
  /** Marks made against an earlier build, and so worth checking again. */
  staleCount: number;
  /** Read an earlier run; pass null to come back to the current one. */
  viewRun: (runId: string | null) => void;
  /** Open a new run, retiring the current one. Needs settings.manage. */
  startRun: (label: string) => Promise<void>;
  /** Other testers' marks, by route path. Empty unless the run is shared. */
  otherMarks: Record<string, OtherTesterMark[]>;
  summary: ChecklistSummary;
  /** Pages carrying a mark from anyone, when the shared run is loaded. */
  coveredByAnyone: number;
  testerCount: number;
  isLoading: boolean;
  /** Set when the run could not be loaded; marks made now will not save. */
  loadError: string | null;
  /** True when that failure was the department having the module switched off. */
  isModuleDisabled: boolean;
  reload: () => Promise<void>;
  /** Marking the status a second time with the same value clears it. */
  setStatus: (path: string, status: TestStatus) => void;
  setNote: (path: string, note: string) => void;
  setParam: (path: string, param: string, value: string) => void;
  clearAll: (scope?: 'mine' | 'all') => Promise<void>;
  /** The whole run as Markdown, for pasting into an issue or a hand-off. */
  toMarkdown: (context: { testedBy?: string; formatTimestamp: (iso: string) => string }) => string;
}

export const useTestingChecklist = ({
  includeAllTesters = false,
  expectationFor,
}: UseTestingChecklistOptions = {}): UseTestingChecklist => {
  const [results, setResults] = useState<ChecklistState>({});
  const [otherMarks, setOtherMarks] = useState<Record<string, OtherTesterMark[]>>({});
  const [testerCount, setTesterCount] = useState(0);
  const [run, setRun] = useState<TestingRun | null>(null);
  const [runs, setRuns] = useState<TestingRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isModuleDisabled, setIsModuleDisabled] = useState(false);

  // Keyed by route path so a second keystroke on one page replaces its pending
  // save rather than queueing another, and typing in two notes still saves
  // both.
  const textTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const resultsRef = useRef<ChecklistState>({});
  resultsRef.current = results;
  // Held in a ref so `save` stays stable: the prediction depends on the
  // signed-in account and the loaded module set, and rebuilding every callback
  // each time those settle would re-render all two hundred cards.
  const expectationRef = useRef(expectationFor);
  expectationRef.current = expectationFor;

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const loaded = await testingChecklistService.getRun(includeAllTesters, selectedRunId ?? undefined);
      const mine: ChecklistState = {};
      const others: Record<string, OtherTesterMark[]> = {};
      for (const entry of loaded.entries) {
        if (entry.isMine) {
          mine[entry.routePath] = toResult(entry);
          continue;
        }
        (others[entry.routePath] ??= []).push({
          userId: entry.userId,
          testerName: entry.userName || 'another tester',
          testedAs: entry.testedAs ?? [],
          status: entry.status,
          ...(entry.note ? { note: entry.note } : {}),
          ...(entry.checkedAt ? { checkedAt: entry.checkedAt } : {}),
          ...(entry.buildId ? { buildId: entry.buildId } : {}),
          ...(entry.expectedAccess ? { expectedAccess: entry.expectedAccess } : {}),
        });
      }
      setResults(mine);
      setOtherMarks(others);
      setRun(loaded.run ?? null);
      setRuns(loaded.runs);
      setTesterCount(loaded.testerCount);
      setLoadError(null);
      setIsModuleDisabled(false);
    } catch (err: unknown) {
      setIsModuleDisabled(toAppError(err).code === MODULE_DISABLED_CODE);
      setLoadError(getErrorMessage(err, 'Could not load the testing run'));
    } finally {
      setIsLoading(false);
    }
  }, [includeAllTesters, selectedRunId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timers = textTimers.current;
    return () => {
      for (const timer of Object.values(timers)) clearTimeout(timer);
    };
  }, []);

  /** Persist one page's row, putting the previous state back if it fails. */
  const save = useCallback(async (path: string, previous: TestResult | undefined) => {
    const current = resultsRef.current[path];
    try {
      await testingChecklistService.saveEntry({
        routePath: path,
        status: current?.status ?? 'untested',
        note: current?.note?.trim() || null,
        params: current?.params ?? null,
        buildId: getCurrentBuildId() ?? null,
        expectedAccess: expectationRef.current?.(path) ?? current?.expectedAccess ?? null,
      });
    } catch (err: unknown) {
      // Reverted rather than left on screen: a mark that looks recorded and is
      // not turns into a page nobody tests.
      setResults((state) => {
        const next = { ...state };
        if (previous) next[path] = previous;
        else delete next[path];
        return next;
      });
      toast.error(getErrorMessage(err, 'Could not save that mark'));
    }
  }, []);

  const update = useCallback(
    (path: string, change: (previous: TestResult) => TestResult, debounce: boolean) => {
      const previous = resultsRef.current[path];
      const next = change(previous ?? { status: 'untested' });
      setResults((state) => ({ ...state, [path]: next }));
      resultsRef.current = { ...resultsRef.current, [path]: next };

      const pending = textTimers.current[path];
      if (pending) clearTimeout(pending);
      if (debounce) {
        textTimers.current[path] = setTimeout(() => {
          delete textTimers.current[path];
          void save(path, previous);
        }, TEXT_SAVE_DELAY_MS);
      } else {
        void save(path, previous);
      }
    },
    [save]
  );

  const setStatus = useCallback(
    (path: string, status: TestStatus) => {
      update(
        path,
        (previous) => {
          // Tapping the mark that is already set is how a mis-click is undone;
          // without it the only way back to "untested" is clearing the run.
          const next: TestStatus = previous.status === status ? 'untested' : status;
          return {
            ...previous,
            status: next,
            ...(next === 'untested' ? {} : { checkedAt: new Date().toISOString() }),
          };
        },
        false
      );
    },
    [update]
  );

  const setNote = useCallback(
    (path: string, note: string) => {
      update(path, (previous) => ({ ...previous, note }), true);
    },
    [update]
  );

  const setParam = useCallback(
    (path: string, param: string, value: string) => {
      update(path, (previous) => ({ ...previous, params: { ...(previous.params ?? {}), [param]: value } }), true);
    },
    [update]
  );

  const clearAll = useCallback(
    async (scope: 'mine' | 'all' = 'mine') => {
      try {
        await testingChecklistService.clearRun(scope);
        await load();
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not clear the run'));
      }
    },
    [load]
  );

  const viewRun = useCallback((runId: string | null) => {
    setSelectedRunId(runId);
  }, []);

  const startRun = useCallback(
    async (label: string) => {
      try {
        await testingChecklistService.startRun(label, getCurrentBuildId());
        // Back to the current run: the one just opened is where marks land.
        setSelectedRunId(null);
        await load();
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not start the run'));
      }
    },
    [load]
  );

  const summary = useMemo(() => summarize(results, ALL_TEST_PAGES.length), [results]);

  const currentBuildId = getCurrentBuildId();
  const staleCount = useMemo(() => {
    if (!currentBuildId) return 0;
    return Object.values(results).filter(
      (result) => result.status !== 'untested' && result.buildId && result.buildId !== currentBuildId
    ).length;
  }, [results, currentBuildId]);

  const coveredByAnyone = useMemo(
    () =>
      ALL_TEST_PAGES.filter(
        (page) =>
          (results[page.path]?.status ?? 'untested') !== 'untested' ||
          (otherMarks[page.path] ?? []).some((mark) => mark.status !== 'untested')
      ).length,
    [results, otherMarks]
  );

  const toMarkdown = useCallback<UseTestingChecklist['toMarkdown']>(
    ({ testedBy, formatTimestamp }) => {
      const mark: Record<TestStatus, string> = {
        pass: '[x] PASS',
        fail: '[ ] FAIL',
        blocked: '[ ] BLOCKED',
        untested: '[ ] not tested',
      };
      const lines: string[] = ['# The Logbook — page testing run', ''];
      if (testedBy) lines.push(`- Tested by: ${testedBy}`);
      lines.push(
        `- Your result: ${summary.pass} passed, ${summary.fail} failed, ${summary.blocked} blocked, ${summary.untested} not tested (${summary.total} pages)`
      );
      if (includeAllTesters) {
        lines.push(
          `- Across ${testerCount} tester${testerCount === 1 ? '' : 's'}: ${coveredByAnyone} of ${summary.total} pages covered`
        );
      }
      lines.push('');

      for (const group of TESTING_GROUPS) {
        lines.push(`## ${group.label}`, '');
        for (const page of group.pages) {
          const result = results[page.path];
          const status = result?.status ?? 'untested';
          const when = result?.checkedAt ? ` — ${formatTimestamp(result.checkedAt)}` : '';
          lines.push(`- ${mark[status]} \`${page.path}\` ${page.label}${when}`);
          if (result?.note?.trim()) lines.push(`  - ${result.note.trim()}`);
          for (const other of otherMarks[page.path] ?? []) {
            const seat = other.testedAs.length > 0 ? ` (${other.testedAs.join(', ')})` : '';
            lines.push(`  - ${other.testerName}${seat}: ${other.status}${other.note ? ` — ${other.note}` : ''}`);
          }
        }
        lines.push('');
      }
      return lines.join('\n');
    },
    [results, otherMarks, summary, testerCount, coveredByAnyone, includeAllTesters]
  );

  return {
    results,
    run,
    runs,
    isViewingArchivedRun: run !== null && !run.isCurrent,
    currentBuildId,
    staleCount,
    viewRun,
    startRun,
    otherMarks,
    summary,
    coveredByAnyone,
    testerCount,
    isLoading,
    loadError,
    isModuleDisabled,
    reload: load,
    setStatus,
    setNote,
    setParam,
    clearAll,
    toMarkdown,
  };
};
