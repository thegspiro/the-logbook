/**
 * Inventory Administration
 *
 * The launching point for whoever runs the department's stock — gear, PPE,
 * uniforms and EMS supplies, which are one catalog on the backend partitioned
 * by `InventoryCategory.item_type`, plus the store the uniforms are bought
 * through.
 *
 * This is the hub's Overview: the record-level "Needs attention" queue, the
 * setup prompt and the three supply lines, with Headline Metrics beside it at
 * `?tab=settings`. Everything else is reached through the area cards and page
 * strip `InventoryAdminLayout` draws above it — the same header the hub's other
 * pages are drawn inside, so the officer is never sent off to a page that has
 * forgotten where it came from.
 */

import React from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowRight, AlertTriangle, Package, Sparkles } from 'lucide-react';
import { EmptyState } from '../../../components/ux';
import { AdminMetricsSettings } from '../../../components/admin';
import { InventoryAdminLayout } from '../components/InventoryAdminLayout';
import { useInventoryAdminShell } from '../components/inventoryAdminShell';
import type { AttentionRow } from '../hooks/useInventoryAdminData';
import type { InventoryHubCard, InventoryHubTone } from './inventoryHubCards';

const NeedsAttention: React.FC<{
  rows: AttentionRow[];
  loading: boolean;
  failedSources: string[];
  onRetry: () => void;
}> = ({ rows, loading, failedSources, onRetry }) => (
  <section aria-labelledby="inventory-needs-attention" className="card mb-8 overflow-hidden">
    <div className="border-theme-surface-border flex items-center gap-2 border-b px-4 py-3 sm:px-5">
      <AlertTriangle className="h-5 w-5 text-red-600" aria-hidden="true" />
      <h2 id="inventory-needs-attention" className="text-theme-text-primary font-semibold">
        Needs attention
      </h2>
      {!loading && (
        <span
          className="rounded-full bg-red-800 px-2 py-0.5 text-xs font-bold text-white"
          aria-label={`${rows.length} work items awaiting action`}
        >
          {rows.length}
        </span>
      )}
      <span className="text-theme-text-muted ml-auto text-xs">Work awaiting a decision or action</span>
    </div>
    {failedSources.length > 0 && (
      <div
        className="border-theme-alert-warning-border bg-theme-alert-warning-bg text-theme-alert-warning-text flex items-center gap-2 border-b px-4 py-3 text-sm"
        role="alert"
      >
        <span className="flex-1">
          Some inventory services did not respond ({failedSources.join(', ')}). This queue may be incomplete.
        </span>
        <button type="button" className="touch:min-h-11 touch:min-w-11 font-semibold underline" onClick={onRetry}>
          Retry
        </button>
      </div>
    )}
    {loading ? (
      <p className="text-theme-text-muted px-5 py-6 text-sm" role="status">
        Loading actionable work…
      </p>
    ) : rows.length === 0 && failedSources.length === 0 ? (
      <p className="text-theme-text-muted px-5 py-6 text-sm">
        Nothing needs attention. All inventory work is up to date.
      </p>
    ) : (
      <ul className="divide-theme-surface-border divide-y">
        {rows.map((row) => (
          <li
            key={row.key}
            className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_auto_auto] sm:items-center sm:px-5"
          >
            <span className="text-theme-text-primary font-semibold">{row.subject}</span>
            <span className="text-theme-text-secondary text-sm">{row.party}</span>
            <span className="text-theme-text-muted text-sm">{row.when}</span>
            <span
              className={`w-fit rounded-full px-2 py-1 text-xs font-semibold ${row.severity === 'Critical' ? 'bg-red-500/15 text-red-700 dark:text-red-300' : row.severity === 'High' ? 'bg-orange-500/15 text-orange-800 dark:text-orange-300' : 'bg-yellow-500/15 text-yellow-800 dark:text-yellow-300'}`}
            >
              {row.severity}
            </span>
            <Link to={row.href} className="btn-secondary min-h-[36px] text-sm font-semibold">
              {row.action}
            </Link>
          </li>
        ))}
      </ul>
    )}
  </section>
);

/**
 * Icon tints, spelled out as whole class strings.
 *
 * Tailwind scans source for complete class names, so these cannot be built
 * from the tone at runtime — `bg-${tone}-500/10` compiles to nothing. Keeping
 * the literals in one map is also what lets the registry carry a tone name
 * instead of a class string it has no business knowing.
 */
const TONE_CLASSES: Record<InventoryHubTone, string> = {
  blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  orange: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
  cyan: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400',
  yellow: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  green: 'bg-green-500/10 text-green-700 dark:text-green-400',
  red: 'bg-red-500/10 text-red-700 dark:text-red-400',
  indigo: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  sky: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  emerald: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  slate: 'bg-theme-surface-secondary text-theme-text-muted group-hover:text-theme-text-primary',
};

/** Live figures the registry cannot carry, attached to a supply-line card by its id. */
interface CardStat {
  /** Large number on a supply-line card. */
  stat?: number | undefined;
  statLabel?: string | undefined;
}

const ProminentCard: React.FC<{ card: InventoryHubCard; stat: CardStat }> = ({ card, stat }) => (
  <Link
    to={card.path}
    className="card-secondary hover:bg-theme-surface-hover active:bg-theme-surface-hover group flex flex-col gap-3 p-4 transition-all sm:p-5"
  >
    <div className="flex items-center justify-between">
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-xl sm:h-11 sm:w-11 ${TONE_CLASSES[card.tone]}`}
      >
        <card.icon className="h-5 w-5" aria-hidden="true" />
      </div>
      {stat.stat != null && (
        <div className="text-right">
          <p className="text-theme-text-primary text-xl font-bold sm:text-2xl">{stat.stat}</p>
          {stat.statLabel && <p className="text-theme-text-muted text-[11px]">{stat.statLabel}</p>}
        </div>
      )}
    </div>
    <div>
      <h3 className="text-theme-text-primary text-sm font-semibold">{card.label}</h3>
      <p className="text-theme-text-muted mt-0.5 text-xs">{card.description}</p>
    </div>
  </Link>
);

/**
 * The Overview body. Read from the layout's shell rather than loaded here, so
 * the header's badges and this queue come from one request set.
 */
const InventoryAdminOverview: React.FC = () => {
  const shell = useInventoryAdminShell();
  const [searchParams] = useSearchParams();
  if (!shell) return null;
  const { data, visibleCards, modulesLoading, canManage, refreshFrame } = shell;
  const { summary, setupStatus, attentionRows, failedSources, medicalExpiring, loading } = data;
  const loadSummary = data.reload;

  // Headline Metrics edits the inventory headline figures; both its read and
  // its write require `inventory.manage`. `?tab=settings` reaches this page
  // whether or not the header offers the page, so the URL is refused here too,
  // not just the link hidden.
  if (searchParams.get('tab') === 'settings' && canManage) {
    return (
      <div className="mx-auto max-w-7xl py-6">
        <AdminMetricsSettings
          moduleKey="inventory"
          moduleLabel="Inventory"
          permission="inventory.manage"
          onSaved={refreshFrame}
        />
      </div>
    );
  }

  /** Live figures per supply line. Everything else about a card is static data. */
  const cardStats: Record<string, CardStat> = {
    'supply-ppe': { stat: summary?.items_by_type?.ppe, statLabel: 'items' },
    'supply-uniform': { stat: summary?.items_by_type?.uniform, statLabel: 'items' },
    'supply-medical': { stat: medicalExpiring ?? undefined, statLabel: 'expiring soon' },
  };
  const statFor = (id: string): CardStat => cardStats[id] ?? {};
  const supplyLines = visibleCards.filter((card) => card.section === 'Supply lines');

  return (
    <div className="mx-auto max-w-7xl py-6 sm:py-8">
      {/* Only for the viewer it describes. Its empty state reads "Nothing
          needs attention. All inventory work is up to date." -- a claim
          about inventory nobody asked the server about, since the batch
          behind it is raised only for `inventory.manage`. Shown to a store
          manager it sat directly above "Nothing here for your role",
          telling them in consecutive lines that everything is fine and
          that none of it is theirs. */}
      {canManage ? (
        <NeedsAttention
          rows={attentionRows}
          loading={loading}
          failedSources={failedSources}
          onRetry={() => void loadSummary()}
        />
      ) : (
        // The queue is gone for this viewer, and it was the only thing
        // rendering `failedSources`. The EMS request is raised off the card
        // being visible rather than off `inventory.manage`, so a checklist
        // or store administrator holding the medical grant still makes it
        // -- and a rejection would have vanished silently, leaving the card
        // with no figure and nothing to say why. They are entitled to the
        // number, so they are entitled to know it did not arrive.
        failedSources.length > 0 && (
          <div className="alert-warning mb-8 flex items-center gap-2 text-sm" role="alert">
            <span className="flex-1">Some figures on this page did not load ({failedSources.join(', ')}).</span>
            <button
              type="button"
              className="touch:min-h-11 touch:min-w-11 font-semibold underline"
              onClick={() => void loadSummary()}
            >
              Retry
            </button>
          </div>
        )
      )}
      {/* Setup prompt — shown until rooms, storage, categories, and items all exist.
        Without it a new quartermaster meets the item form first and fills in
        three dropdowns that have nothing in them. */}
      {setupStatus && !setupStatus.is_complete && (
        <Link
          to="/inventory/admin/setup"
          className="mb-8 flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 transition-colors hover:bg-blue-500/15 sm:p-4"
        >
          <div className="shrink-0 rounded-lg bg-blue-600 p-2">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-blue-700 dark:text-blue-300">Finish inventory setup</h3>
            <p className="text-xs text-blue-600 dark:text-blue-400">
              Still to set up:{' '}
              {[
                setupStatus.rooms === 0 ? 'rooms' : null,
                setupStatus.storage_areas === 0 ? 'storage areas' : null,
                setupStatus.categories === 0 ? 'categories' : null,
                setupStatus.items === 0 ? 'items' : null,
              ]
                .filter(Boolean)
                .join(', ')}
              . The guide walks through them in order.
            </p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
        </Link>
      )}

      {/* Every card gated away. Reachable now that the hub admits three
          different administrators: a store manager whose department has
          Storefront switched off holds a grant this route accepts and none
          that opens a card behind it. The header and an empty page read as
          a failure to load -- which is what a Retry in the banner above
          invites them to sit through -- so say plainly that there is
          nothing here for them rather than showing a page that looks
          broken. */}
      {!modulesLoading && visibleCards.length === 0 && (
        <EmptyState
          icon={Package}
          title="Nothing here for your role"
          description="Your permissions do not open any of this page's tools, or the modules they belong to are switched off for your department. An administrator can review this under Settings → Modules."
        />
      )}

      {/* Supply lines — the three stock lines a department staffs.
          Not a partition of the catalog: tools, equipment, electronics and
          consumables are real item types nobody is appointed to run, and
          they are reached through All Items below. */}
      {supplyLines.length > 0 && (
        <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {supplyLines.map((card) => (
            <ProminentCard key={card.id} card={card} stat={statFor(card.id)} />
          ))}
        </div>
      )}
    </div>
  );
};

export const InventoryAdminHub: React.FC = () => (
  <InventoryAdminLayout>
    <InventoryAdminOverview />
  </InventoryAdminLayout>
);

export default InventoryAdminHub;
