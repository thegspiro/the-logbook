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
  RotateCcw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../stores/authStore';
import { useEnabledModules } from '../../hooks/useEnabledModules';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDateTime } from '../../utils/dateFormatting';
import { TESTING_GROUPS } from './testingRegistry';
import type { TestPageEntry } from './testingRegistry';
import { evaluatePageAccess } from './pageAccess';
import type { PageAccess } from './pageAccess';
import { useTestingChecklist } from './useTestingChecklist';
import type { TestStatus } from './useTestingChecklist';
import { TestPageCard } from './TestPageCard';

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
  const { results, summary, setStatus, setNote, setParam, clearAll, toMarkdown } = useTestingChecklist();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [onlyOpenable, setOnlyOpenable] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [showPermissions, setShowPermissions] = useState(false);

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

  const matches = (page: TestPageEntry): boolean => {
    const term = search.trim().toLowerCase();
    if (term && !page.label.toLowerCase().includes(term) && !page.path.toLowerCase().includes(term)) return false;
    if (statusFilter !== 'all' && (results[page.path]?.status ?? 'untested') !== statusFilter) return false;
    if (onlyOpenable) {
      const access = accessFor.get(page.path);
      if (access && (access.kind === 'denied' || access.kind === 'module-off')) return false;
    }
    return true;
  };

  const visibleGroups = TESTING_GROUPS.map((group) => ({ ...group, visible: group.pages.filter(matches) })).filter(
    (group) => group.visible.length > 0
  );

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

  const handleClear = async () => {
    const confirmed = await confirm({
      title: 'Clear this testing run?',
      message: `${summary.pass + summary.fail + summary.blocked} marks and every note will be removed from this browser. Copy the Markdown first if you need the record.`,
      confirmLabel: 'Clear the run',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (confirmed) clearAll();
  };

  const toggleGroup = (id: string) =>
    setExpanded((previous) => (previous.includes(id) ? previous.filter((entry) => entry !== id) : [...previous, id]));

  // Searching or filtering opens whatever still matches: a tester who types a
  // path and sees only collapsed headings would reasonably conclude the page
  // is not in the list.
  const isFiltering = search.trim() !== '' || statusFilter !== 'all';

  // Stable across renders so the memoized cards only re-render when their own
  // result changes — see TestPageCard.
  const username = user?.username;
  const handleStatus = useCallback(
    (path: string, status: TestStatus) => setStatus(path, status, username),
    [setStatus, username]
  );

  const percent = Math.round(summary.progress * 100);

  return (
    <div className="page-container page-stack px-4 py-6 sm:px-6 lg:px-8">
      <header className="page-stack">
        <div className="flex items-start gap-3">
          <ClipboardCheck className="text-theme-text-muted mt-1 h-7 w-7 shrink-0" aria-hidden="true" />
          <div>
            <h1 className="text-theme-text-primary text-2xl font-bold">Testing home</h1>
            <p className="text-theme-text-secondary mt-1 text-sm">
              Every page in the application, in one place. Open a box to test the page, then mark what you found — the
              run is saved in this browser. The steps for each area are in{' '}
              <span className="font-mono">TESTING_CHECKLIST.md</span>; this tracks which screens have been walked.
            </p>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-theme-text-primary font-semibold">
              {summary.total - summary.untested} of {summary.total} pages checked
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
        </div>

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
                Denied, and one marked green should open.
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
          <Download className="h-4 w-4" aria-hidden="true" />
          Download
        </button>
        <button
          type="button"
          className="btn-secondary btn-sm inline-flex items-center gap-1.5"
          onClick={() => void handleClear()}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Clear run
        </button>
      </div>

      {visibleGroups.length === 0 && (
        <p className="text-theme-text-secondary card p-6 text-center text-sm">
          No page matches this filter. Clear the search or choose All.
        </p>
      )}

      {visibleGroups.map((group) => {
        const isOpen = isFiltering || expanded.includes(group.id);
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
                    access={accessFor.get(page.path) ?? { kind: 'open' }}
                    onStatus={handleStatus}
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
