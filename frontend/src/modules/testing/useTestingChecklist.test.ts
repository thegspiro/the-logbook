import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { TestingCheckEntry, TestingCheckUpsert, TestingChecklistRun, TestingRun } from './services/api';

const mockGetRun = vi.fn<(includeAll?: boolean, runId?: string) => Promise<TestingChecklistRun>>();
const mockStartRun = vi.fn<(label: string, buildId?: string) => Promise<TestingRun>>();
const mockSaveEntry = vi.fn<(payload: TestingCheckUpsert) => Promise<TestingCheckEntry>>();
const mockClearRun = vi.fn<(scope?: 'mine' | 'all') => Promise<number>>();

vi.mock('./services/api', () => ({
  testingChecklistService: {
    getRun: (includeAll?: boolean, runId?: string) => mockGetRun(includeAll, runId),
    startRun: (label: string, buildId?: string) => mockStartRun(label, buildId),
    saveEntry: (payload: TestingCheckUpsert) => mockSaveEntry(payload),
    clearRun: (scope?: 'mine' | 'all') => mockClearRun(scope),
  },
}));

const mockToastError = vi.fn<(message: string) => void>();
vi.mock('react-hot-toast', () => ({
  default: {
    error: (message: string) => {
      mockToastError(message);
    },
    success: vi.fn(),
  },
}));

// Import AFTER the mocks
import { useTestingChecklist } from './useTestingChecklist';

const entry = (overrides: Partial<TestingCheckEntry> = {}): TestingCheckEntry => ({
  id: 'e1',
  routePath: '/dashboard',
  status: 'pass',
  note: null,
  params: null,
  checkedAt: '2026-08-27T12:00:00Z',
  userId: 'u1',
  userName: 'Firefighter Jones',
  testedAs: ['firefighter'],
  isMine: true,
  ...overrides,
});

const makeRun = (overrides: Partial<TestingRun> = {}): TestingRun => ({
  id: 'run-1',
  sequence: 1,
  label: 'Run of 2026-08-27',
  buildId: null,
  startedAt: '2026-08-27T09:00:00Z',
  startedById: 'u1',
  startedByName: 'Firefighter Jones',
  isCurrent: true,
  ...overrides,
});

const run = (entries: TestingCheckEntry[], overrides: Partial<TestingChecklistRun> = {}): TestingChecklistRun => ({
  entries,
  run: makeRun(),
  runs: [makeRun()],
  includesAllTesters: false,
  testerCount: new Set(entries.map((e) => e.userId)).size,
  ...overrides,
});

const loaded = async () => {
  const hook = renderHook(() => useTestingChecklist({}));
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hook;
};

describe('useTestingChecklist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRun.mockResolvedValue(run([]));
    mockSaveEntry.mockResolvedValue(entry());
    mockClearRun.mockResolvedValue(1);
    mockStartRun.mockResolvedValue(makeRun({ id: 'run-2', sequence: 2, label: 'Second pass' }));
  });

  it('loads the saved run', async () => {
    mockGetRun.mockResolvedValue(run([entry({ routePath: '/events', status: 'fail', note: 'roster empty' })]));

    const { result } = await loaded();

    expect(result.current.results['/events']).toMatchObject({ status: 'fail', note: 'roster empty' });
    expect(result.current.summary.fail).toBe(1);
  });

  it('asks for its own run unless the caller can read every tester', async () => {
    await loaded();
    expect(mockGetRun).toHaveBeenCalledWith(false, undefined);

    const shared = renderHook(() => useTestingChecklist({ includeAllTesters: true }));
    await waitFor(() => expect(shared.result.current.isLoading).toBe(false));
    expect(mockGetRun).toHaveBeenCalledWith(true, undefined);
  });

  it('files another tester’s mark separately from your own', async () => {
    mockGetRun.mockResolvedValue(
      run(
        [
          entry({ id: 'mine', routePath: '/events', status: 'pass', isMine: true }),
          entry({
            id: 'theirs',
            routePath: '/events',
            status: 'blocked',
            isMine: false,
            userId: 'u2',
            userName: 'The Chief',
            testedAs: ['chief'],
            note: 'refused',
          }),
        ],
        { includesAllTesters: true, testerCount: 2 }
      )
    );

    const { result } = await loaded();

    expect(result.current.results['/events']?.status).toBe('pass');
    expect(result.current.otherMarks['/events']).toEqual([
      {
        // The entry's own id, carried so the list has a key that survives the
        // tester's account being deleted (userId is then null).
        markId: 'theirs',
        userId: 'u2',
        testerName: 'The Chief',
        testedAs: ['chief'],
        status: 'blocked',
        note: 'refused',
        checkedAt: '2026-08-27T12:00:00Z',
      },
    ]);
    expect(result.current.testerCount).toBe(2);
  });

  it('counts a page as covered when any tester has marked it', async () => {
    mockGetRun.mockResolvedValue(
      run([entry({ routePath: '/events', status: 'fail', isMine: false, userId: 'u2' })], {
        includesAllTesters: true,
        testerCount: 1,
      })
    );

    const { result } = await loaded();

    expect(result.current.summary.fail).toBe(0);
    expect(result.current.coveredByAnyone).toBe(1);
  });

  it('saves a mark against the page', async () => {
    const { result } = await loaded();

    act(() => result.current.setStatus('/dashboard', 'pass'));

    expect(result.current.results['/dashboard']?.status).toBe('pass');
    await waitFor(() =>
      expect(mockSaveEntry).toHaveBeenCalledWith({
        routePath: '/dashboard',
        status: 'pass',
        note: null,
        params: null,
        // No build is stamped into a development bundle, and an absent stamp
        // must not read as "made against an old build".
        buildId: null,
        expectedAccess: null,
      })
    );
  });

  it('clears the mark when the same result is chosen twice', async () => {
    const { result } = await loaded();

    act(() => result.current.setStatus('/dashboard', 'fail'));
    act(() => result.current.setStatus('/dashboard', 'fail'));

    expect(result.current.results['/dashboard']?.status).toBe('untested');
    await waitFor(() =>
      expect(mockSaveEntry).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'untested' }))
    );
  });

  it('puts the previous mark back when the save fails', async () => {
    mockGetRun.mockResolvedValue(run([entry({ routePath: '/dashboard', status: 'pass' })]));
    mockSaveEntry.mockRejectedValue(new Error('offline'));
    const { result } = await loaded();

    act(() => result.current.setStatus('/dashboard', 'fail'));

    await waitFor(() => expect(result.current.results['/dashboard']?.status).toBe('pass'));
    expect(mockToastError).toHaveBeenCalled();
  });

  it('waits for a pause before saving a note', async () => {
    vi.useFakeTimers();
    try {
      const hook = renderHook(() => useTestingChecklist({}));
      await vi.waitFor(() => expect(hook.result.current.isLoading).toBe(false));

      act(() => hook.result.current.setNote('/dashboard', 'r'));
      act(() => hook.result.current.setNote('/dashboard', 'roster empty'));
      expect(mockSaveEntry).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(mockSaveEntry).toHaveBeenCalledTimes(1);
      expect(mockSaveEntry).toHaveBeenCalledWith(expect.objectContaining({ note: 'roster empty' }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends an emptied note as an explicit clear', async () => {
    vi.useFakeTimers();
    try {
      mockGetRun.mockResolvedValue(run([entry({ routePath: '/dashboard', note: 'was broken' })]));
      const hook = renderHook(() => useTestingChecklist({}));
      await vi.waitFor(() => expect(hook.result.current.isLoading).toBe(false));

      act(() => hook.result.current.setNote('/dashboard', ''));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(mockSaveEntry).toHaveBeenCalledWith(expect.objectContaining({ note: null }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps sample ids with the page', async () => {
    vi.useFakeTimers();
    try {
      const hook = renderHook(() => useTestingChecklist({}));
      await vi.waitFor(() => expect(hook.result.current.isLoading).toBe(false));

      act(() => hook.result.current.setParam('/events/:id', 'id', 'evt-7'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(hook.result.current.results['/events/:id']?.params).toEqual({ id: 'evt-7' });
      expect(mockSaveEntry).toHaveBeenCalledWith(expect.objectContaining({ params: { id: 'evt-7' } }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads the run it was given, and the history beside it', async () => {
    const archived = makeRun({ id: 'run-0', sequence: 0, label: 'First pass', isCurrent: false });
    mockGetRun.mockResolvedValue(run([], { runs: [makeRun(), archived] }));

    const { result } = await loaded();

    expect(result.current.run?.label).toBe('Run of 2026-08-27');
    expect(result.current.runs.map((entry) => entry.label)).toEqual(['Run of 2026-08-27', 'First pass']);
    expect(result.current.isViewingArchivedRun).toBe(false);
  });

  it('knows an archived run is a record rather than a board', async () => {
    const archived = makeRun({ id: 'run-0', label: 'First pass', isCurrent: false });
    mockGetRun.mockResolvedValue(run([], { run: archived, runs: [makeRun(), archived] }));

    const { result } = await loaded();

    expect(result.current.isViewingArchivedRun).toBe(true);
  });

  it('re-reads when an earlier run is picked', async () => {
    const { result } = await loaded();

    act(() => result.current.viewRun('run-0'));

    await waitFor(() => expect(mockGetRun).toHaveBeenLastCalledWith(false, 'run-0'));
  });

  it('starts a run and comes back to it', async () => {
    const { result } = await loaded();

    await act(async () => {
      await result.current.startRun('Pre-launch');
    });

    expect(mockStartRun).toHaveBeenCalledWith('Pre-launch', undefined);
    // Reloaded, and looking at the current run rather than whatever was picked.
    await waitFor(() => expect(mockGetRun).toHaveBeenLastCalledWith(false, undefined));
  });

  it('flags marks made against an earlier build', async () => {
    vi.stubGlobal('__BUILD_ID__', 'build-now');
    try {
      mockGetRun.mockResolvedValue(
        run([
          entry({ routePath: '/dashboard', status: 'pass', buildId: 'build-old' }),
          entry({ id: 'e2', routePath: '/events', status: 'pass', buildId: 'build-now' }),
          entry({ id: 'e3', routePath: '/training', status: 'pass', buildId: null }),
        ])
      );

      const { result } = await loaded();

      // Only the one that actually names an older build: an absent stamp is
      // not evidence of age.
      expect(result.current.staleCount).toBe(1);
      expect(result.current.currentBuildId).toBe('build-now');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('records what the screen predicted alongside the result', async () => {
    const { result } = renderHook(() =>
      useTestingChecklist({ expectationFor: (path) => (path === '/events/admin' ? 'denied' : 'open') })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setStatus('/events/admin', 'blocked'));

    await waitFor(() =>
      expect(mockSaveEntry).toHaveBeenCalledWith(expect.objectContaining({ expectedAccess: 'denied' }))
    );
  });

  it('ignores a run response that has been overtaken', async () => {
    // Picking an archived run starts a second request while the first is in
    // flight; the current run's late answer must not overwrite it.
    let releaseFirst: (value: TestingChecklistRun) => void = () => {};
    mockGetRun.mockImplementationOnce(() => new Promise<TestingChecklistRun>((resolve) => (releaseFirst = resolve)));
    const archived = makeRun({ id: 'run-0', label: 'First pass', isCurrent: false });
    mockGetRun.mockResolvedValueOnce(run([], { run: archived, runs: [makeRun(), archived] }));

    const { result } = renderHook(() => useTestingChecklist({}));
    act(() => result.current.viewRun('run-0'));
    await waitFor(() => expect(result.current.run?.id).toBe('run-0'));

    // The overtaken request answers late with the current run.
    act(() => releaseFirst(run([], { run: makeRun(), runs: [makeRun(), archived] })));
    await waitFor(() => expect(mockGetRun).toHaveBeenCalledTimes(2));

    expect(result.current.run?.id).toBe('run-0');
  });

  it('sends a pending note before moving to another run', async () => {
    vi.useFakeTimers();
    try {
      const hook = renderHook(() => useTestingChecklist({}));
      await vi.waitFor(() => expect(hook.result.current.isLoading).toBe(false));
      act(() => hook.result.current.setNote('/dashboard', 'half typed'));
      expect(mockSaveEntry).not.toHaveBeenCalled();

      act(() => hook.result.current.viewRun('run-0'));

      // Flushed with what was typed, in the run it was typed in — the save
      // endpoint only ever writes to the current run.
      expect(mockSaveEntry).toHaveBeenCalledWith(
        expect.objectContaining({ routePath: '/dashboard', note: 'half typed' })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends what was typed, not what loaded afterwards', async () => {
    vi.useFakeTimers();
    try {
      const hook = renderHook(() => useTestingChecklist({}));
      await vi.waitFor(() => expect(hook.result.current.isLoading).toBe(false));
      act(() => hook.result.current.setStatus('/dashboard', 'fail'));
      mockSaveEntry.mockClear();
      act(() => hook.result.current.setNote('/dashboard', 'roster empty'));

      // A reload lands while the note is still pending.
      mockGetRun.mockResolvedValue(run([entry({ routePath: '/dashboard', status: 'pass', note: 'something else' })]));
      await act(async () => {
        await hook.result.current.reload();
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(mockSaveEntry).toHaveBeenCalledWith(expect.objectContaining({ status: 'fail', note: 'roster empty' }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops the timestamp when a mark is taken back', async () => {
    mockGetRun.mockResolvedValue(run([entry({ routePath: '/dashboard', status: 'pass' })]));
    const { result } = await loaded();
    expect(result.current.results['/dashboard']?.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    act(() => result.current.setStatus('/dashboard', 'pass'));

    expect(result.current.results['/dashboard']?.status).toBe('untested');
    expect(result.current.results['/dashboard']?.checkedAt).toBeUndefined();
  });

  it('keeps the seats the server recorded for a mark', async () => {
    mockGetRun.mockResolvedValue(run([entry({ routePath: '/dashboard', testedAs: ['Lieutenant'] })]));

    const { result } = await loaded();

    expect(result.current.results['/dashboard']?.testedAs).toEqual(['Lieutenant']);
  });

  it('credits an archived run to the build it was tested on', async () => {
    vi.stubGlobal('__BUILD_ID__', 'build-now');
    try {
      const archived = makeRun({ id: 'run-0', label: 'First pass', isCurrent: false, buildId: 'build-then' });
      mockGetRun.mockResolvedValue(run([], { run: archived, runs: [makeRun(), archived] }));
      const { result } = await loaded();

      const markdown = result.current.toMarkdown({ formatTimestamp: () => 'then' });

      expect(markdown).toContain('- Build under test: build-then');
      expect(markdown).not.toContain('build-now');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports a run it could not load, and does not pretend it is empty', async () => {
    mockGetRun.mockRejectedValue(new Error('network down'));

    const { result } = await loaded();

    expect(result.current.loadError).toMatch(/network down|Could not load/);
    expect(result.current.isModuleDisabled).toBe(false);
  });

  it('tells a switched-off module apart from a broken server', async () => {
    // The department turned the module off; the answer is a switch, not a
    // reload. Shaped like an axios error so toAppError reads the code.
    mockGetRun.mockRejectedValue({
      response: { status: 403, statusText: 'Forbidden', data: { detail: 'not enabled', code: 'LB-ORG-002' } },
    });

    const { result } = await loaded();

    expect(result.current.isModuleDisabled).toBe(true);
  });

  it('clears only the caller’s marks by default', async () => {
    const { result } = await loaded();

    await act(async () => {
      await result.current.clearAll();
    });

    expect(mockClearRun).toHaveBeenCalledWith('mine');
    expect(mockGetRun).toHaveBeenCalledTimes(2);
  });

  it('can clear the whole department', async () => {
    const { result } = await loaded();

    await act(async () => {
      await result.current.clearAll('all');
    });

    expect(mockClearRun).toHaveBeenCalledWith('all');
  });

  it('exports the run as Markdown, naming who found what', async () => {
    mockGetRun.mockResolvedValue(
      run(
        [
          entry({ routePath: '/dashboard', status: 'fail', note: 'widgets never load' }),
          entry({
            id: 'theirs',
            routePath: '/dashboard',
            status: 'pass',
            isMine: false,
            userId: 'u2',
            userName: 'The Chief',
            testedAs: ['chief'],
          }),
        ],
        { includesAllTesters: true, testerCount: 2 }
      )
    );
    const hook = renderHook(() => useTestingChecklist({ includeAllTesters: true }));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));

    const markdown = hook.result.current.toMarkdown({
      testedBy: 'Chief Spiro',
      formatTimestamp: () => 'Aug 27, 2026, 9:00 AM',
    });

    expect(markdown).toContain('- Tested by: Chief Spiro');
    expect(markdown).toContain('[ ] FAIL `/dashboard` Dashboard — Aug 27, 2026, 9:00 AM');
    expect(markdown).toContain('  - widgets never load');
    expect(markdown).toContain('  - The Chief (chief): pass');
    expect(markdown).toContain('- Across 2 testers: 1 of');
  });
});
