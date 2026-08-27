/**
 * Testing home
 *
 * Every page the application declares, as a box you can open, with somewhere
 * to record what you found. The companion to TESTING_CHECKLIST.md: that
 * document says what to try on a screen, this says which screens exist, who is
 * meant to be able to open them, and which ones this run has already covered.
 *
 * The route carries no permission gate — deliberately. Its second job is
 * proving the gates on everything else, and that is done by signing in as a
 * firefighter, a lieutenant and a chief in turn and checking that the boxes
 * this screen marks "should refuse" actually refuse. A page that only an
 * administrator could open could not be used for that.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ClipboardCheck,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  FileText,
  History,
  Printer,
  RotateCcw,
  Search,
  ShieldAlert,
  Table,
  ShieldCheck,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Link } from 'react-router';
import { useAuthStore } from '../../../stores/authStore';
import { useEnabledModules } from '../../../hooks/useEnabledModules';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useTimezone } from '../../../hooks/useTimezone';
import { useKeyboardShortcuts } from '../../../hooks/useKeyboardShortcuts';
import { formatDateTime } from '../../../utils/dateFormatting';
import { ALL_TEST_PAGES, TESTING_GROUPS } from '../testingRegistry';
import type { TestPageEntry } from '../testingRegistry';
import { evaluatePageAccess } from '../pageAccess';
import type { PageAccess } from '../pageAccess';
import { SEE_ALL_TESTERS_PERMISSION, useTestingChecklist } from '../useTestingChecklist';
import type { TestStatus } from '../useTestingChecklist';
import { TestPageCard } from '../components/TestPageCard';
import { PromptDialog } from '../../../components/ux';
import { buildPermissionMatrixCsv, buildRunCsv, runFileName } from '../exportRun';
import { downloadCsv } from '../../../utils/csv';
import { formatDate } from '../../../utils/dateFormatting';

type StatusFilter = 'all' | TestStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'untested', label: 'Not tested' },
  { value: 'pass', label: 'Passed' },
  { value: 'fail', label: 'Failed' },
  { value: 'blocked', label: 'Blocked' },
];

export const TestingChecklistPage: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const hasRole = useAuthStore((state) => state.hasRole);
  const { isModuleOn, enabledModules } = useEnabledModules();
  const { confirm } = useConfirm();
  const tz = useTimezone();
  // The IT manager reads every tester's marks — that is what makes signing in
  // as each position in turn a usable method rather than three separate runs
  // nobody can compare. Everybody else reads their own.
  const canSeeAllTesters = checkPermission(SEE_ALL_TESTERS_PERMISSION);

  const accessFor = useMemo(() => {
    const context = { checkPermission, hasRole, isModuleOn };
    const map = new Map<string, PageAccess>();
    for (const group of TESTING_GROUPS) {
      for (const page of group.pages) map.set(page.path, evaluatePageAccess(page, context));
    }
    return map;
    // `isModuleOn` closes over the loaded module set, so the answers have to be
    // recomputed once that request lands — not only when the user changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, enabledModules]);

  // What the screen predicts this account will meet, recorded with each mark so
  // a page that opens for somebody it should refuse can be told from a pass.
  const expectationFor = useCallback((path: string) => accessFor.get(path)?.kind, [accessFor]);
  const {
    results,
    run,
    runs,
    isViewingArchivedRun,
    currentBuildId,
    staleCount,
    gateTally,
    mismatchedPaths,
    viewRun,
    startRun,
    otherMarks,
    summary,
    coveredByAnyone,
    testerCount,
    isLoading,
    loadError,
    isModuleDisabled,
    reload,
    setStatus,
    setNote,
    setParam,
    clearAll,
    toMarkdown,
  } = useTestingChecklist({ includeAllTesters: canSeeAllTesters, expectationFor });

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [onlyOpenable, setOnlyOpenable] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [showPermissions, setShowPermissions] = useState(false);
  const [startingRun, setStartingRun] = useState(false);
  const [staleOnly, setStaleOnly] = useState(false);
  const [mismatchesOnly, setMismatchesOnly] = useState(false);

  // Keyboard marking. The focused page is held by path rather than by index
  // so filtering or expanding a group cannot silently move the focus ring
  // onto a different page than the one the tester is looking at.
  const [focusedPath, setFocusedPath] = useState<string | null>(null);

  const matches = (page: TestPageEntry): boolean => {
    const term = search.trim().toLowerCase();
    if (term && !page.label.toLowerCase().includes(term) && !page.path.toLowerCase().includes(term)) return false;
    if (statusFilter !== 'all' && (results[page.path]?.status ?? 'untested') !== statusFilter) return false;
    if (onlyOpenable) {
      const access = accessFor.get(page.path);
      if (access && (access.kind === 'denied' || access.kind === 'module-off')) return false;
    }
    if (mismatchesOnly && !mismatchedPaths.has(page.path)) return false;
    if (staleOnly) {
      const result = results[page.path];
      if (!result || result.status === 'untested') return false;
      if (!currentBuildId || !result.buildId || result.buildId === currentBuildId) return false;
    }
    return true;
  };

  const visibleGroups = TESTING_GROUPS.map((group) => ({ ...group, visible: group.pages.filter(matches) })).filter(
    (group) => group.visible.length > 0
  );

  // Searching or filtering opens whatever still matches: a tester who types a
  // path and sees only collapsed headings would reasonably conclude the page
  // is not in the list.
  const isFiltering = search.trim() !== '' || statusFilter !== 'all';
  const isGroupOpen = (id: string) => isFiltering || expanded.includes(id);

  // Only what is actually on screen: j/k must not walk into a collapsed group.
  const visiblePaths = visibleGroups.flatMap((group) =>
    isGroupOpen(group.id) ? group.visible.map((page) => page.path) : []
  );

  const moveFocus = (step: number) => {
    if (visiblePaths.length === 0) return;
    const at = focusedPath ? visiblePaths.indexOf(focusedPath) : -1;
    const next = at === -1 ? 0 : (at + step + visiblePaths.length) % visiblePaths.length;
    setFocusedPath(visiblePaths[next] ?? null);
  };

  /** The next page in registry order that carries no mark, opening its group. */
  const jumpToNextUntested = () => {
    const start = focusedPath ? ALL_TEST_PAGES.findIndex((page) => page.path === focusedPath) + 1 : 0;
    const ordered = [...ALL_TEST_PAGES.slice(start), ...ALL_TEST_PAGES.slice(0, start)];
    const next = ordered.find((page) => (results[page.path]?.status ?? 'untested') === 'untested');
    if (!next) {
      toast.success('Every page carries a mark');
      return;
    }
    setExpanded((previous) => (previous.includes(next.groupId) ? previous : [...previous, next.groupId]));
    setFocusedPath(next.path);
  };

  const markFocused = (status: TestStatus) => {
    if (!focusedPath || isViewingArchivedRun) return;
    setStatus(focusedPath, status);
  };

  useKeyboardShortcuts([
    { key: 'j', handler: () => moveFocus(1), description: 'Next page' },
    { key: 'k', handler: () => moveFocus(-1), description: 'Previous page' },
    { key: 'n', handler: jumpToNextUntested, description: 'Jump to the next untested page' },
    { key: 'p', handler: () => markFocused('pass'), description: 'Mark the focused page as passing' },
    { key: 'f', handler: () => markFocused('fail'), description: 'Mark the focused page as failing' },
    { key: 'b', handler: () => markFocused('blocked'), description: 'Mark the focused page as blocked' },
  ]);

  const openableCount = useMemo(
    () => [...accessFor.values()].filter((access) => access.kind === 'open' || access.kind === 'allowed').length,
    [accessFor]
  );

  const markdown = () =>
    toMarkdown({
      ...(user?.full_name || user?.username ? { testedBy: user.full_name || user.username } : {}),
      formatTimestamp: (iso) => formatDateTime(iso, tz),
    });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdown());
      toast.success('Run copied as Markdown');
    } catch {
      toast.error('Could not reach the clipboard — use Download instead');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([markdown()], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'logbook-testing-run.md';
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportContext = () => ({
    run,
    results,
    otherMarks,
    viewerName: user?.full_name || user?.username || 'you',
    viewerPositions: user?.positions ?? [],
    formatTimestamp: (iso: string) => formatDateTime(iso, tz),
  });

  const handleExportCsv = () => {
    downloadCsv(buildRunCsv(exportContext()), runFileName(run, 'run', 'csv'));
    toast.success('Run exported as CSV');
  };

  const handleExportMatrix = () => {
    downloadCsv(buildPermissionMatrixCsv(exportContext()), runFileName(run, 'permissions', 'csv'));
    toast.success('Permission matrix exported');
  };

  const handleClear = async () => {
    const confirmed = await confirm({
      title: 'Clear your testing run?',
      message: `${summary.pass + summary.fail + summary.blocked} of your marks, and their notes, will be deleted for everyone. Other testers' marks are left alone. Copy the Markdown first if you need the record.`,
      confirmLabel: 'Delete my marks',
      cancelLabel: 'Keep them',
      variant: 'danger',
    });
    if (confirmed) await clearAll('mine');
  };

  const handleClearEveryone = async () => {
    const confirmed = await confirm({
      title: "Clear every tester's run?",
      message: `All ${testerCount} tester${testerCount === 1 ? "'s" : "s'"} marks and notes will be deleted for the whole department. This cannot be undone, and it is recorded in the audit log.`,
      confirmLabel: 'Delete every mark',
      cancelLabel: 'Keep them',
      variant: 'danger',
    });
    if (confirmed) await clearAll('all');
  };

  const toggleGroup = (id: string) =>
    setExpanded((previous) => (previous.includes(id) ? previous.filter((entry) => entry !== id) : [...previous, id]));

  const percent = Math.round(summary.progress * 100);

  const suggestedRunLabel = `Run ${(runs[0]?.sequence ?? 0) + 1} · ${formatDate(new Date().toISOString(), tz)}`;

  return (
    <div className="page-container page-stack px-4 py-6 sm:px-6 lg:px-8">
      <header className="page-stack">
        <div className="flex items-start gap-3">
          <ClipboardCheck className="text-theme-text-muted mt-1 h-7 w-7 shrink-0" aria-hidden="true" />
          <div>
            <h1 className="text-theme-text-primary text-2xl font-bold">Testing home</h1>
            <p className="text-theme-text-secondary mt-1 text-sm">
              Every page in the application, in one place. Open a box to test the page, then mark what you found — the
              run is saved for the department, so testing from another account, another machine or another day continues
              the same list. The steps for each area are in <span className="font-mono">TESTING_CHECKLIST.md</span>;
              this tracks which screens have been walked.
            </p>
          </div>
        </div>

        <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-theme-text-primary font-semibold">
              {run ? run.label : 'No run started yet'}
              {isViewingArchivedRun && (
                <span className="badge bg-theme-surface-secondary text-theme-text-secondary ml-2">archived</span>
              )}
            </p>
            <p className="text-theme-text-secondary text-sm">
              {run
                ? `Run ${run.sequence}, started ${formatDate(run.startedAt, tz)}${
                    run.startedByName ? ` by ${run.startedByName}` : ''
                  }${run.buildId ? ` · build ${run.buildId.slice(0, 8)}` : ''}`
                : 'The first mark you make opens one.'}
            </p>
            {isViewingArchivedRun && (
              <p className="text-theme-text-secondary mt-1 text-xs">
                This is the record of an earlier pass — marking is disabled. Switch back to the current run to test.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {runs.length > 1 && (
              <label className="text-sm">
                <span className="sr-only">Testing run</span>
                <select
                  className="form-input-sm w-auto"
                  value={run?.id ?? ''}
                  onChange={(event) => viewRun(event.target.value === runs[0]?.id ? null : event.target.value)}
                >
                  {runs.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                      {entry.isCurrent ? ' (current)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {isViewingArchivedRun && (
              <button type="button" className="btn-secondary btn-sm" onClick={() => viewRun(null)}>
                Back to the current run
              </button>
            )}
            {canSeeAllTesters && (
              <button type="button" className="btn-secondary btn-sm" onClick={() => setStartingRun(true)}>
                Start a new run
              </button>
            )}
          </div>
        </div>

        <div className="card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-theme-text-primary font-semibold">
              {summary.total - summary.untested} of {summary.total} pages checked{canSeeAllTesters ? ' by you' : ''}
              {isLoading && (
                <span className="text-theme-text-secondary ml-2 text-sm font-normal" role="status">
                  loading the saved run…
                </span>
              )}
            </p>
            <p className="text-theme-text-secondary text-sm">
              <span className="font-semibold text-green-800 dark:text-green-400">{summary.pass} passed</span> ·{' '}
              <span className="font-semibold text-red-800 dark:text-red-400">{summary.fail} failed</span> ·{' '}
              <span className="font-semibold text-amber-800 dark:text-amber-300">{summary.blocked} blocked</span> ·{' '}
              {summary.untested} to go
            </p>
          </div>
          <div
            className="bg-theme-surface-secondary mt-3 h-2 w-full overflow-hidden rounded-full"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Testing progress"
          >
            <div
              className="h-full rounded-full bg-red-800 transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
          {(gateTally.verified > 0 || gateTally.mismatches > 0) && (
            <p className="mt-2 text-sm">
              <ShieldCheck className="mr-1 inline h-4 w-4 align-text-bottom" aria-hidden="true" />
              <span className="text-theme-text-secondary">
                {gateTally.verified} gate {gateTally.verified === 1 ? 'refusal' : 'refusals'} verified
              </span>
              {gateTally.mismatches > 0 && (
                <>
                  {' · '}
                  <span className="font-semibold text-red-800 dark:text-red-400">
                    {gateTally.mismatches} gate {gateTally.mismatches === 1 ? 'mismatch' : 'mismatches'}
                  </span>
                </>
              )}
            </p>
          )}

          {staleCount > 0 && (
            <p className="text-theme-text-secondary mt-2 text-sm">
              {staleCount} {staleCount === 1 ? 'mark was' : 'marks were'} made against an earlier build of the app.
            </p>
          )}
          {canSeeAllTesters && (
            <p className="text-theme-text-secondary mt-2 text-sm">
              <Users className="mr-1 inline h-4 w-4 align-text-bottom" aria-hidden="true" />
              Across {testerCount === 0 ? 'no testers' : `${testerCount} tester${testerCount === 1 ? '' : 's'}`},{' '}
              {coveredByAnyone} of {summary.total} pages have been checked by somebody.
            </p>
          )}
        </div>

        {isModuleDisabled ? (
          <div className="alert-warning flex flex-wrap items-center justify-between gap-3 rounded-lg p-4 text-sm">
            <span>
              The Testing Checklist module is switched off for this department, so nothing can be recorded. An
              administrator turns it on under Settings → Modules.
            </span>
            {checkPermission('settings.manage') && (
              <Link to="/settings?tab=modules" className="btn-secondary btn-sm">
                Open module settings
              </Link>
            )}
          </div>
        ) : (
          loadError && (
            <div className="alert-danger flex flex-wrap items-center justify-between gap-3 rounded-lg p-4 text-sm">
              <span>{loadError} — marks made now will not be saved. Check the connection, then reload the run.</span>
              <button type="button" className="btn-secondary btn-sm" onClick={() => void reload()}>
                Reload the run
              </button>
            </div>
          )
        )}

        <div className="card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-theme-text-primary inline-flex items-center gap-2 font-semibold">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Signed in as {user?.full_name || user?.username || 'nobody'}
              </p>
              <p className="text-theme-text-secondary mt-1 text-sm">
                {user?.positions?.length ? user.positions.join(', ') : 'no positions'} ·{' '}
                {user?.permissions?.length ?? 0} permissions · this account can open {openableCount} of {summary.total}{' '}
                pages
                {enabledModules === null && ' · module settings not loaded, so no page is shown as switched off'}
              </p>
              <p className="text-theme-text-secondary mt-1 text-xs">
                To check the gates, sign in as each position in turn: a box marked in red should refuse with Access
                Denied, and one marked green should open. Your marks are filed under this account —{' '}
                {canSeeAllTesters
                  ? 'and every tester’s appear on the boxes below.'
                  : 'an administrator sees them alongside every other tester’s.'}
              </p>
            </div>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setShowPermissions((show) => !show)}>
              {showPermissions ? 'Hide' : 'Show'} permissions
            </button>
          </div>
          {showPermissions && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(user?.permissions ?? []).length === 0 && (
                <p className="text-theme-text-secondary text-sm">This account holds no permissions.</p>
              )}
              {(user?.permissions ?? []).map((permission) => (
                <span key={permission} className="badge bg-theme-surface-secondary text-theme-text-secondary font-mono">
                  {permission}
                </span>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <label className="relative min-w-48 flex-1">
          <Search
            className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            className="form-input pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search pages or paths"
            aria-label="Search pages"
          />
        </label>

        <div className="segmented-group hscroll inline-flex gap-1" role="group" aria-label="Filter by result">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={statusFilter === filter.value}
              onClick={() => setStatusFilter(filter.value)}
              className={`rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
                statusFilter === filter.value
                  ? 'bg-red-800 text-white'
                  : 'text-theme-text-secondary hover:bg-theme-surface-hover'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          aria-pressed={onlyOpenable}
          onClick={() => setOnlyOpenable((only) => !only)}
          className={`btn-sm inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
            onlyOpenable
              ? 'border-red-800 bg-red-800 text-white'
              : 'border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
          }`}
        >
          <Eye className="h-4 w-4" aria-hidden="true" />
          Only pages I can open
        </button>

        <button
          type="button"
          className="btn-secondary btn-sm inline-flex items-center gap-1.5"
          onClick={() => setExpanded(expanded.length > 0 ? [] : TESTING_GROUPS.map((group) => group.id))}
        >
          {expanded.length > 0 ? (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          )}
          {expanded.length > 0 ? 'Collapse all' : 'Expand all'}
        </button>

        {gateTally.mismatches > 0 && (
          <button
            type="button"
            aria-pressed={mismatchesOnly}
            onClick={() => setMismatchesOnly((only) => !only)}
            className={`btn-sm inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              mismatchesOnly
                ? 'border-red-800 bg-red-800 text-white'
                : 'border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
            }`}
          >
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            Gate mismatches ({gateTally.mismatches})
          </button>
        )}

        {staleCount > 0 && (
          <button
            type="button"
            aria-pressed={staleOnly}
            onClick={() => setStaleOnly((only) => !only)}
            className={`btn-sm inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              staleOnly
                ? 'border-red-800 bg-red-800 text-white'
                : 'border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
            }`}
          >
            <History className="h-4 w-4" aria-hidden="true" />
            Needs re-test ({staleCount})
          </button>
        )}

        <a
          href={`/testing/report/print${run && !run.isCurrent ? `?run=${run.id}` : ''}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary btn-sm inline-flex items-center gap-1.5"
        >
          <Printer className="h-4 w-4" aria-hidden="true" />
          Report
        </a>

        <button
          type="button"
          className="btn-secondary btn-sm inline-flex items-center gap-1.5"
          onClick={handleExportCsv}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          CSV
        </button>
        {canSeeAllTesters && testerCount > 1 && (
          <button
            type="button"
            className="btn-secondary btn-sm inline-flex items-center gap-1.5"
            onClick={handleExportMatrix}
          >
            <Table className="h-4 w-4" aria-hidden="true" />
            Permission matrix
          </button>
        )}

        <button
          type="button"
          className="btn-secondary btn-sm inline-flex items-center gap-1.5"
          onClick={() => void handleCopy()}
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
          Copy Markdown
        </button>
        <button
          type="button"
          className="btn-secondary btn-sm inline-flex items-center gap-1.5"
          onClick={handleDownload}
        >
          <FileText className="h-4 w-4" aria-hidden="true" />
          Markdown
        </button>
        <button
          type="button"
          className="btn-secondary btn-sm inline-flex items-center gap-1.5"
          onClick={() => void handleClear()}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Clear my marks
        </button>

        {canSeeAllTesters && (
          <button
            type="button"
            className="btn-secondary btn-sm inline-flex items-center gap-1.5"
            onClick={() => void handleClearEveryone()}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Clear everyone
          </button>
        )}
      </div>

      <PromptDialog
        isOpen={startingRun}
        onClose={() => setStartingRun(false)}
        onSubmit={(label) => {
          setStartingRun(false);
          void startRun(label);
        }}
        title="Start a new testing run"
        message="Everyone's board goes back to nothing. The run on screen now keeps every mark and stays readable from the picker."
        label="What is this run for?"
        placeholder="Pre-launch, build 1.4"
        defaultValue={suggestedRunLabel}
        confirmLabel="Start the run"
        minLength={1}
      />

      <p className="text-theme-text-muted -mt-2 text-xs">
        Keyboard: <kbd>j</kbd>/<kbd>k</kbd> move between boxes · <kbd>p</kbd>/<kbd>f</kbd>/<kbd>b</kbd> mark the focused
        one pass, fail or blocked · <kbd>n</kbd> jump to the next page with no mark.
      </p>

      {visibleGroups.length === 0 && (
        <p className="text-theme-text-secondary card p-6 text-center text-sm">
          No page matches this filter. Clear the search or choose All.
        </p>
      )}

      {visibleGroups.map((group) => {
        const isOpen = isGroupOpen(group.id);
        const statuses = group.pages.map((page) => results[page.path]?.status ?? 'untested');
        const checked = statuses.filter((status) => status !== 'untested').length;
        const failed = statuses.filter((status) => status === 'fail').length;
        return (
          <section key={group.id} aria-labelledby={`group-${group.id}`}>
            <button
              type="button"
              onClick={() => toggleGroup(group.id)}
              aria-expanded={isOpen}
              className="hover:bg-theme-surface-hover -mx-2 flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors"
            >
              {isOpen ? (
                <ChevronDown className="text-theme-text-muted mt-1 h-5 w-5 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronRight className="text-theme-text-muted mt-1 h-5 w-5 shrink-0" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <h2 id={`group-${group.id}`} className="text-theme-text-primary text-lg font-semibold">
                  {group.label}{' '}
                  <span className="text-theme-text-secondary text-sm font-normal">
                    ({checked}/{group.pages.length})
                  </span>
                  {failed > 0 && (
                    <span className="badge ml-2 bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400">
                      {failed} failed
                    </span>
                  )}
                </h2>
                <p className="text-theme-text-secondary text-sm">{group.description}</p>
                {group.checklistSection && (
                  <p className="text-theme-text-muted text-xs">
                    Steps: TESTING_CHECKLIST.md § {group.checklistSection}
                  </p>
                )}
              </div>
            </button>

            {isOpen && (
              <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {group.visible.map((page) => (
                  <TestPageCard
                    key={page.path}
                    page={page}
                    result={results[page.path]}
                    otherMarks={otherMarks[page.path]}
                    access={accessFor.get(page.path) ?? { kind: 'open' }}
                    currentBuildId={currentBuildId}
                    isFocused={focusedPath === page.path}
                    onFocus={setFocusedPath}
                    readOnly={isViewingArchivedRun}
                    onStatus={setStatus}
                    onNote={setNote}
                    onParam={setParam}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
};

export default TestingChecklistPage;
