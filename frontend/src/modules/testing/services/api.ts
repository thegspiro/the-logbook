/**
 * testingChecklistService — the shared page-testing run behind /testing.
 *
 * Writing is open to any signed-in member: the gates are proved by testing
 * from the accounts they refuse, so those accounts must be able to record what
 * they found. Reading *every* tester's marks needs `settings.manage`, which is
 * how the IT manager sees one department-wide run instead of whatever this
 * browser happens to hold.
 */

import api from '../../../services/apiClient';

export type TestingCheckStatus = 'untested' | 'pass' | 'fail' | 'blocked';

/** What the screen predicted this account would meet on a page. */
export type TestingAccessExpectation = 'open' | 'allowed' | 'denied' | 'module-off';

export interface TestingRun {
  id: string;
  /** 1, 2, 3 … per department; what orders the history picker. */
  sequence: number;
  label: string;
  buildId?: string | null;
  startedAt: string;
  startedById?: string | null;
  startedByName?: string | null;
  /** Only the newest run accepts marks; the rest are the record of a past pass. */
  isCurrent: boolean;
}

export interface TestingCheckEntry {
  id: string;
  routePath: string;
  status: TestingCheckStatus;
  note?: string | null;
  params?: Record<string, string> | null;
  checkedAt?: string | null;
  userId: string;
  /** Resolved from the users table; absent if the account has since gone. */
  userName?: string | null;
  /** The positions the tester held when the mark was made. */
  testedAs?: string[] | null;
  /** The build this mark was made against, when the bundle carried one. */
  buildId?: string | null;
  expectedAccess?: TestingAccessExpectation | null;
  isMine: boolean;
}

export interface TestingChecklistRun {
  entries: TestingCheckEntry[];
  /** The run these entries belong to; absent before the first mark. */
  run?: TestingRun | null;
  runs: TestingRun[];
  includesAllTesters: boolean;
  testerCount: number;
}

export interface TestingCheckUpsert {
  routePath: string;
  status: TestingCheckStatus;
  note?: string | null;
  params?: Record<string, string> | null;
  buildId?: string | null;
  expectedAccess?: TestingAccessExpectation | null;
}

export const testingChecklistService = {
  /**
   * The caller's run, or — with the grant — every tester's.
   *
   * `runId` reads an earlier pass; omit it for the current one.
   */
  async getRun(includeAllTesters = false, runId?: string): Promise<TestingChecklistRun> {
    const response = await api.get<TestingChecklistRun>('/testing-checklist', {
      params: { include_all_testers: includeAllTesters, ...(runId ? { run_id: runId } : {}) },
    });
    return response.data;
  },

  /** Open a new run, retiring the current one. Needs settings.manage. */
  async startRun(label: string, buildId?: string): Promise<TestingRun> {
    const response = await api.post<TestingRun>('/testing-checklist/runs', {
      label,
      buildId: buildId || null,
    });
    return response.data;
  },

  /** Record what the caller found on one page. Always writes their own row. */
  async saveEntry(payload: TestingCheckUpsert): Promise<TestingCheckEntry> {
    const response = await api.put<TestingCheckEntry>('/testing-checklist/entries', payload);
    return response.data;
  },

  /** Clear the caller's marks, or the whole department's. */
  async clearRun(scope: 'mine' | 'all' = 'mine'): Promise<number> {
    const response = await api.delete<{ deleted: number }>('/testing-checklist', {
      params: { scope },
    });
    return response.data.deleted;
  },
};
