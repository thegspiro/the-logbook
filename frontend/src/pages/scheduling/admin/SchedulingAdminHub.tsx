/**
 * Scheduling Administration
 *
 * Everything an officer administers about the schedule, in the Administration
 * section beside Training Admin and Inventory Admin. Before this existed the
 * settings, templates, patterns, reports, platoons and the position roster were
 * reachable only from a row of cards on the member-facing `/scheduling` page —
 * so an administrator had to open the schedule to find the settings, and the
 * Administration section, which is where the rest of the product puts this,
 * had no scheduling entry at all.
 *
 * One grant runs the whole area: `scheduling.manage`, on this route, on every
 * page behind it, and on the nav rows that offer it.
 *
 * The body is a card grid rather than tabs: the pages behind it are separate
 * screens, not views of one, and the grid is the shape Inventory Administration
 * already established for that.
 */

import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CalendarClock } from 'lucide-react';
import { AdminHubFrame, AdminMetricsSettings, type AdminHubTab } from '../../../components/admin';
import { useAuthStore } from '../../../stores/authStore';
import { useEnabledModules } from '../../../hooks/useEnabledModules';
import { EmptyState } from '../../../components/ux/EmptyState';
import {
  SCHEDULING_HUB_CARDS,
  SCHEDULING_HUB_SECTIONS,
  type SchedulingHubCard,
  type SchedulingHubSection,
  type SchedulingHubTone,
} from './schedulingHubCards';

const TONE_CLASSES: Record<SchedulingHubTone, string> = {
  blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  orange: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  cyan: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  green: 'bg-green-500/10 text-green-600 dark:text-green-400',
  indigo: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  slate: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
};

const NavCard: React.FC<{ card: SchedulingHubCard }> = ({ card }) => (
  <Link
    to={card.path}
    className="card-secondary hover:bg-theme-surface-hover active:bg-theme-surface-hover group flex items-center gap-3 p-3 sm:items-start sm:gap-4 sm:p-4"
  >
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors sm:h-10 sm:w-10 ${TONE_CLASSES[card.tone]}`}
    >
      <card.icon className="h-5 w-5" aria-hidden="true" />
    </div>
    <div className="min-w-0 flex-1">
      <h3 className="text-theme-text-primary text-sm font-semibold">{card.label}</h3>
      <p className="text-theme-text-muted mt-0.5 hidden text-xs sm:block">{card.description}</p>
    </div>
  </Link>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <h2 className="text-theme-text-muted mb-3 text-xs font-semibold tracking-wider uppercase">{title}</h2>
    {children}
  </div>
);

type AdminTab = 'overview' | 'settings';

/** Settings is always last — the frame's rule, on every module. */
const TABS: AdminHubTab<AdminTab>[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'settings', label: 'Settings' },
];
const OVERVIEW_ONLY_TABS: AdminHubTab<AdminTab>[] = [{ id: 'overview', label: 'Overview' }];

const SchedulingAdminHub: React.FC = () => {
  const checkPermission = useAuthStore((s) => s.checkPermission);
  const { isModuleOn, isLoading: modulesLoading } = useEnabledModules();
  const canManage = checkPermission('scheduling.manage');

  // Every card resolves its own gate here rather than inheriting the page's.
  // Two cards point into Inventory, whose grants `scheduling.manage` does not
  // imply — `checkPermission` is exact match plus module wildcard — so a card
  // nobody filtered is a link to Access Denied for the officer this page is
  // built for.
  const visibleCards = useMemo(
    () =>
      // Nothing until the module flags are known — see the hook's own comment.
      modulesLoading
        ? []
        : SCHEDULING_HUB_CARDS.filter((card) => {
            if (card.requiresModule && !isModuleOn(card.requiresModule)) return false;
            if (card.anyPermission) return card.anyPermission.some((permission) => checkPermission(permission));
            return card.permission ? checkPermission(card.permission) : true;
          }),
    [checkPermission, isModuleOn, modulesLoading]
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as AdminTab | null;
  // Settings edits the scheduling headline metrics; both its read and its write
  // require `scheduling.manage`, which this route now also requires. Kept
  // guarded rather than simplified away: `?tab=settings` reaches this panel
  // whether or not the tab is drawn, so the refusal belongs on the URL and not
  // only on the control — and that stays true however the route's gate moves.
  const activeTab: AdminTab = tabParam === 'settings' && canManage ? 'settings' : 'overview';
  const tabs = canManage ? TABS : OVERVIEW_ONLY_TABS;
  const [frameToken, setFrameToken] = useState(0);

  const sections = SCHEDULING_HUB_SECTIONS.map((section: SchedulingHubSection) => ({
    section,
    cards: visibleCards.filter((card) => card.section === section),
  })).filter((group) => group.cards.length > 0);

  return (
    <AdminHubFrame<AdminTab>
      moduleKey="scheduling"
      // `/admin-hub/scheduling/summary` resolves the module to
      // `scheduling.manage`, and so does this route, so today every viewer who
      // reaches here holds it. Kept as a guard rather than dropped: the frame's
      // own docstring is that a hub admitting more than one kind of
      // administrator must not make this request for the others, and a guard
      // removed because the current gate happens to make it redundant is a
      // guard that has to be rediscovered when the gate next widens.
      summary={canManage}
      title="Scheduling Administration"
      description="Shifts, the crews that fill them, and what needs a decision today"
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(tab) => setSearchParams(tab === 'overview' ? {} : { tab })}
      refreshToken={frameToken}
    >
      {activeTab === 'settings' ? (
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <AdminMetricsSettings
            moduleKey="scheduling"
            moduleLabel="Scheduling"
            permission="scheduling.manage"
            onSaved={() => setFrameToken((token) => token + 1)}
          />
        </div>
      ) : (
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
          {/* Reachable when the department has the Scheduling module switched
              off: the module gate is a usability gate, not access control, so
              this route still opens and every card filters itself away. A
              header over an empty page reads as a failure to load, so say
              plainly that there is nothing here rather than showing one. */}
          {!modulesLoading && sections.length === 0 && (
            <EmptyState
              icon={CalendarClock}
              title="Nothing here for your role"
              description="Your permissions do not open any of this page's tools, or the modules they belong to are switched off for your department. An administrator can review this under Settings → Modules."
            />
          )}

          {/* A landmark, because that is what the grid is: every card is a link
              to another screen, and the page's other links — the trail above it
              — are a different journey. Named so a screen reader user can jump
              to the tools rather than tabbing the trail first. */}
          <nav className="space-y-8" aria-label="Scheduling administration tools">
            {sections.map(({ section, cards }) => (
              <Section key={section} title={section}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {cards.map((card) => (
                    <NavCard key={card.id} card={card} />
                  ))}
                </div>
              </Section>
            ))}
          </nav>
        </div>
      )}
    </AdminHubFrame>
  );
};

export default SchedulingAdminHub;
