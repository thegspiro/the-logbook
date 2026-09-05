import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { adminHubService } from '../../services/adminHubService';
import { getErrorMessage } from '../../utils/errorHandling';
import type { AdminHubSummary } from '../../types/adminHub';
import AdminAttentionQueue from './AdminAttentionQueue';
import AdminMetricsRow from './AdminMetricsRow';
import { Breadcrumbs, type BreadcrumbItem } from '../ux/Breadcrumbs';

/**
 * The shared administration-page frame.
 *
 * Header, four metrics, "Needs attention" queue, tab bar, body — in that order,
 * in the same place, on every admin page. An officer who works across Members,
 * Training and Inventory learns the page once; what changes module to module is
 * the content of the queue, and that is the only part they have to read
 * carefully.
 *
 * On a phone the queue moves above the metrics, because it is the only thing
 * worth a phone visit. Both live in one flex column so the swap is a CSS
 * `order`, not a second render path that could drift from the first.
 *
 * A caller supplies its own tab bar through `tabs` (the standard underline bar,
 * URL-synced by the caller) or `nav` for a module whose navigation is already
 * something else. Neither is required — Inventory's body is a card grid.
 */

export interface AdminHubTab<K extends string = string> {
  id: K;
  label: string;
}

export interface AdminHubAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  /** Spins the icon while the action's own work is in flight. */
  busy?: boolean | undefined;
}

interface AdminHubFrameProps<K extends string> {
  /** Module key the summary endpoint is keyed on. */
  moduleKey: string;
  /**
   * Whether to ask for the headline summary at all. Default true.
   *
   * `/admin-hub/{module}/summary` resolves the module to its manage grant, so
   * for a hub that admits more than one kind of administrator the request is a
   * guaranteed 404 for everyone but the manager -- and the frame reports that
   * as a failed summary with a Retry that repeats it. Pass false rather than
   * showing an error for a figure the viewer was never entitled to.
   */
  summary?: boolean;
  title: string;
  description: string;
  /** Small caps line above the title. */
  eyebrow?: string;
  /**
   * Overrides the trail above the eyebrow. Omit and it is generated from the
   * URL, which is what every hub wants: a hub's own path names its module and
   * itself, and `breadcrumbRoutes.ts` supplies the labels and decides which
   * crumbs this viewer may follow.
   *
   * Pass items only where the URL does not describe the hierarchy — a hub whose
   * route is a redirect target under another module's tree, say.
   */
  breadcrumbs?: BreadcrumbItem[] | undefined;
  /** Icon-only secondary actions, rendered before the primary. */
  actions?: AdminHubAction[];
  /** The single red action. */
  primaryAction?: AdminHubAction | undefined;
  /**
   * Anything else that belongs beside the actions — a HelpLink, say. Kept
   * separate from `actions` so the "never two red buttons" rule stays a rule
   * about buttons the frame itself renders.
   */
  headerAside?: React.ReactNode;

  tabs?: AdminHubTab<K>[] | undefined;
  activeTab?: K | undefined;
  onTabChange?: ((tab: K) => void) | undefined;
  /** Replaces the standard tab bar for a module with its own navigation. */
  nav?: React.ReactNode;

  /**
   * Change this to make the frame refetch — a page that resolves an exception
   * in its own body passes a counter so the queue reflects the work.
   */
  refreshToken?: number | string | undefined;
  /** A module with a richer, record-level queue in its body can hide the aggregate queue. */
  showAttentionQueue?: boolean | undefined;

  children: React.ReactNode;
}

export function AdminHubFrame<K extends string>({
  moduleKey,
  summary: wantsSummary = true,
  title,
  description,
  eyebrow = 'Administration',
  breadcrumbs,
  actions = [],
  primaryAction,
  headerAside,
  tabs,
  activeTab,
  onTabChange,
  nav,
  refreshToken,
  showAttentionQueue = true,
  children,
}: AdminHubFrameProps<K>) {
  const [summary, setSummary] = useState<AdminHubSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const load = useCallback(async () => {
    if (!wantsSummary) {
      setSummary(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setSummary(await adminHubService.getSummary(moduleKey));
      setError(null);
    } catch (err: unknown) {
      // The frame is a summary of the work, not the work. A failed summary
      // leaves a quiet line and the tab body below it still usable.
      setSummary(null);
      setError(getErrorMessage(err, 'Could not load this page’s summary.'));
    } finally {
      setLoading(false);
    }
  }, [moduleKey, wantsSummary]);

  useEffect(() => {
    void load();
    // refreshToken is a deliberate re-run trigger, not a value load() reads.
  }, [load, refreshToken]);

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!tabs || !activeTab || !onTabChange) return;
    const ids = tabs.map((tab) => tab.id);
    const current = ids.indexOf(activeTab);
    let next: number | undefined;
    if (event.key === 'ArrowRight') next = (current + 1) % ids.length;
    if (event.key === 'ArrowLeft') next = (current - 1 + ids.length) % ids.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = ids.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    const nextId = ids[next];
    if (nextId === undefined) return;
    onTabChange(nextId);
    tabRefs.current[nextId]?.focus();
  };

  return (
    <div>
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 pt-6 sm:px-6 sm:pt-8 lg:px-8">
        {/* 0 — Trail. Above the eyebrow, because it says where the page sits
            rather than what kind of page it is. Rendered by the frame so all
            six hubs carry one without each remembering to; `mb-0` because the
            frame's own flex gap already spaces it. */}
        <Breadcrumbs items={breadcrumbs} className="mb-0" />

        {/* 1 — Header. Icon actions and a single red primary; never two reds. */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-theme-text-muted text-[11px] font-bold tracking-[0.16em] uppercase">{eyebrow}</p>
            <h1 className="text-theme-text-primary mt-0.5 text-2xl font-bold">{title}</h1>
            <p className="text-theme-text-muted mt-1 text-sm">{description}</p>
          </div>

          {(actions.length > 0 || primaryAction || headerAside) && (
            <div className="flex shrink-0 items-center gap-2">
              {actions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  onClick={action.onClick}
                  aria-label={action.label}
                  title={action.label}
                  className="btn-icon border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover focus:ring-theme-focus-ring border transition-colors focus:ring-2 focus:outline-hidden"
                >
                  <action.icon className={`h-4.5 w-4.5 ${action.busy ? 'animate-spin' : ''}`} aria-hidden="true" />
                </button>
              ))}
              {primaryAction && (
                <button
                  type="button"
                  onClick={primaryAction.onClick}
                  className="btn-primary flex items-center gap-2 text-sm font-semibold"
                >
                  <primaryAction.icon className="h-4 w-4" aria-hidden="true" />
                  <span>{primaryAction.label}</span>
                </button>
              )}
              {headerAside}
            </div>
          )}
        </div>

        {/* 2 & 3 — Metrics and queue. Source order is the desktop order; the
            phone swaps them, because the queue is the only thing worth a phone
            visit and four metric cards would push it under the fold. */}
        <div className="flex flex-col gap-4">
          <AdminMetricsRow
            metrics={summary?.metrics ?? []}
            loading={loading && summary === null}
            className="order-2 sm:order-1"
          />
          {summary && showAttentionQueue && (
            <AdminAttentionQueue items={summary.attention} moduleLabel={title} className="order-1 sm:order-2" />
          )}
          {error && !loading && (
            <p className="text-theme-text-muted order-1 text-xs sm:order-2" role="status">
              {error}{' '}
              <button
                type="button"
                onClick={() => void load()}
                className="text-theme-accent-red font-semibold underline"
              >
                Try again
              </button>
            </p>
          )}
        </div>

        {/* 4 — Tab bar. Underline tabs, red-500 active border, Settings last;
            scrolls horizontally on a phone rather than wrapping. */}
        {tabs && activeTab && onTabChange && (
          <div className="border-theme-surface-border border-b">
            <div className="tab-scroll border-b-0" role="tablist" aria-label={`${title} tabs`}>
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    ref={(node) => {
                      tabRefs.current[tab.id] = node;
                    }}
                    role="tab"
                    type="button"
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => onTabChange(tab.id)}
                    onKeyDown={handleTabKeyDown}
                    className={`focus:ring-theme-focus-ring border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors focus:ring-2 focus:outline-hidden ${
                      isActive
                        ? 'text-theme-text-primary border-red-500'
                        : 'text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border border-transparent'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {nav}
      </div>

      {/* 5 — Body. Free: table, form, calendar, card grid — the module's own. */}
      {children}
    </div>
  );
}

export default AdminHubFrame;
