import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { dashboardService } from '../../services/api';
import type {
  DashboardPulseResponse,
  MainDashboardWidgets,
  PulseCardId,
  PulseCardPreference,
  WidgetPeriod,
} from '../../services/communicationsServices';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useAuthStore } from '../../stores/authStore';
import { formatCurrencyWhole } from '../../utils/currencyFormatting';
import DashboardPulseCustomizer, { type PulseSaveScope } from './DashboardPulseCustomizer';

const periods: Array<{ value: WidgetPeriod; label: string }> = [
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
  { value: 'rolling_30', label: 'Rolling 30 days' },
];

const BUILT_IN_TITLES: Record<PulseCardId, string> = {
  dues: 'Dues',
  cash_flow: 'Cash flow',
  budget_threshold: 'Budget threshold',
  grant_deadlines: 'Grant deadlines',
  application_stages: 'Application stages',
  campaign_progress: 'Campaign progress',
  community_engagement: 'Community engagement',
  public_requests: 'Public requests',
};

interface CardContent {
  value: string;
  detail: string;
  to: string;
}

function Card({
  title,
  value,
  detail,
  to,
  period,
}: {
  title: string;
  value: string;
  detail: string;
  to: string;
  period: string;
}) {
  return (
    <Link to={to} className="card block p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-theme-text-primary text-sm font-semibold">{title}</h3>
        <span className="bg-theme-surface-secondary text-theme-text-muted rounded px-2 py-1 text-[11px]">{period}</span>
      </div>
      <p className="text-theme-text-primary mt-3 text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-theme-text-muted mt-1 text-xs">{detail}</p>
    </Link>
  );
}

/**
 * The cards the server returned data for, keyed by id. A block it returned as
 * null — no permission, or the department switched the module off — yields no
 * card, whatever a saved layout says.
 */
function availableCards(data: MainDashboardWidgets, period: WidgetPeriod): Partial<Record<PulseCardId, CardContent>> {
  const f = data.finance;
  const g = data.fundraising;
  const c = data.community;
  const cards: Partial<Record<PulseCardId, CardContent>> = {};
  if (f) {
    const budgeted = Number(f.budgeted ?? 0);
    const spent = Number(f.spent ?? 0);
    const encumbered = Number(f.encumbered ?? 0);
    cards.dues = {
      value: formatCurrencyWhole(f.dues_paid),
      detail: `${formatCurrencyWhole(f.dues_due)} due · ${f.overdue_dues} overdue`,
      to: `/finance?period=${period}#dues`,
    };
    cards.cash_flow = {
      value: formatCurrencyWhole(f.net_cash_flow),
      detail: `${formatCurrencyWhole(f.cash_in)} in · ${formatCurrencyWhole(f.cash_out)} out`,
      to: `/finance?period=${period}#cash-flow`,
    };
    cards.budget_threshold = {
      value: `${budgeted > 0 ? Math.round(((spent + encumbered) / budgeted) * 100) : 0}%`,
      detail: `${formatCurrencyWhole(f.spent)} spent · ${formatCurrencyWhole(f.encumbered)} committed`,
      to: `/finance?period=${period}#budget-health`,
    };
  }
  if (g) {
    const campaignPct =
      Number(g.campaign_goal) > 0 ? Math.round((Number(g.campaign_raised) / Number(g.campaign_goal)) * 100) : 0;
    const activeApps = Object.values(g.application_stages).reduce((sum, count) => sum + count, 0);
    cards.grant_deadlines = {
      value: String(g.grant_deadlines_30_days),
      detail: 'Due in the next 30 days',
      to: `/grants?period=${period}#deadlines`,
    };
    cards.application_stages = {
      value: String(activeApps),
      detail: 'Applications across the pipeline',
      to: `/grants?period=${period}#pipeline`,
    };
    cards.campaign_progress = {
      value: `${campaignPct}%`,
      detail: `${formatCurrencyWhole(g.campaign_raised)} of ${formatCurrencyWhole(g.campaign_goal)}`,
      to: `/grants?period=${period}#campaigns`,
    };
  }
  if (c) {
    cards.community_engagement = {
      value: String(c.public_events),
      detail: `${c.member_attendees + c.external_attendees} attendees at public events`,
      to: `/events/admin?tab=community&period=${period}`,
    };
    cards.public_requests = {
      value: String(c.pending_public_requests),
      detail: 'Pending outreach requests',
      to: `/events/admin?tab=requests&period=${period}`,
    };
  }
  return cards;
}

export default function DashboardOrganizationWidgets() {
  const { confirm } = useConfirm();
  const canSetDepartmentDefault = useAuthStore((state) => state.checkPermission('settings.manage'));
  const [period, setPeriod] = useState<WidgetPeriod>('month');
  const [data, setData] = useState<MainDashboardWidgets | null>(null);
  const [pulse, setPulse] = useState<DashboardPulseResponse | null>(null);
  // The widgets wait for the layout so a saved period is the first one fetched
  // rather than a second request after a Month one.
  const [layoutSettled, setLayoutSettled] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    if (typeof dashboardService.getPulseLayout !== 'function') {
      setLayoutSettled(true);
      return () => {
        live = false;
      };
    }
    dashboardService
      .getPulseLayout()
      .then((v) => {
        if (!live) return;
        setPulse(v);
        if (v.layout.period) setPeriod(v.layout.period);
      })
      // A layout that cannot load costs the customisation, not the section.
      .catch(() => undefined)
      .finally(() => live && setLayoutSettled(true));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    if (!layoutSettled || typeof dashboardService.getWidgets !== 'function')
      return () => {
        live = false;
      };
    dashboardService
      .getWidgets(period)
      .then((v) => live && setData(v))
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [period, layoutSettled]);

  if (!data || (!data.finance && !data.fundraising && !data.community)) return null;

  const available = availableCards(data, period);
  const availableIds = new Set(Object.keys(available) as PulseCardId[]);
  const layoutCards: PulseCardPreference[] =
    pulse?.layout.cards ??
    (Object.keys(BUILT_IN_TITLES) as PulseCardId[]).map((id) => ({ id, visible: true, title: null }));
  const visibleCards = layoutCards.filter((card) => card.visible && available[card.id]);

  const apply = (response: DashboardPulseResponse) => {
    setPulse(response);
  };

  const changePeriod = (next: WidgetPeriod) => {
    setPeriod(next);
    // Resends the member's own cards, not the resolved ones: a period choice
    // must not freeze the department's current order into a personal layout.
    dashboardService
      .savePulseLayout({ period: next, cards: pulse?.personal_layout?.cards ?? [] })
      .then(apply)
      .catch(() => undefined);
  };

  const save = async (cards: PulseCardPreference[], scope: PulseSaveScope) => {
    if (
      scope === 'department' &&
      !(await confirm({
        title: 'Change the department default?',
        message: 'Every member who has not set their own layout will see these cards in this order, with these titles.',
        confirmLabel: 'Save for everyone',
        cancelLabel: 'Cancel',
      }))
    )
      return;
    setSaving(true);
    try {
      apply(
        scope === 'department'
          ? await dashboardService.saveDepartmentPulseLayout({ period: null, cards })
          : await dashboardService.savePulseLayout({ period, cards })
      );
      toast.success(scope === 'department' ? 'Department default saved' : 'Your layout was saved');
      setCustomizing(false);
    } catch {
      toast.error('Could not save the layout.');
    } finally {
      setSaving(false);
    }
  };

  const reset = async (scope: PulseSaveScope) => {
    if (
      scope === 'department' &&
      !(await confirm({
        title: 'Clear the department default?',
        message: 'Members without their own layout will see the built-in cards and order again.',
        confirmLabel: 'Clear default',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    setSaving(true);
    try {
      apply(
        scope === 'department'
          ? await dashboardService.resetDepartmentPulseLayout()
          : await dashboardService.resetPulseLayout()
      );
      toast.success(scope === 'department' ? 'Department default cleared' : 'Layout reset');
      setCustomizing(false);
    } catch {
      toast.error('Could not reset the layout.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="dashboard-widgets-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="dashboard-widgets-title" className="text-theme-text-primary font-bold">
            Department pulse
          </h2>
          <p className="text-theme-text-muted text-sm">
            Summaries for the areas you can access, over the period you choose.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-theme-text-secondary text-sm">
            Period{' '}
            <select
              value={period}
              onChange={(e) => changePeriod(e.target.value as WidgetPeriod)}
              className="form-input ml-2 min-h-11 w-auto"
              aria-label="Reporting period"
            >
              {periods.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-secondary btn-md"
            aria-expanded={customizing}
            onClick={() => setCustomizing((open) => !open)}
          >
            Customize
          </button>
        </div>
      </div>
      {customizing && (
        <DashboardPulseCustomizer
          cards={layoutCards}
          availableIds={availableIds}
          builtInTitles={BUILT_IN_TITLES}
          hasPersonalLayout={Boolean(pulse?.personal)}
          hasDepartmentDefault={Boolean(pulse?.organization_default)}
          canSetDepartmentDefault={canSetDepartmentDefault}
          isSaving={saving}
          onSave={(cards, scope) => void save(cards, scope)}
          onReset={(scope) => void reset(scope)}
          onClose={() => setCustomizing(false)}
        />
      )}
      {visibleCards.length === 0 ? (
        <p className="text-theme-text-muted text-sm">All cards are hidden. Choose Customize to show some.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {visibleCards.map((card) => {
            const content = available[card.id];
            return content ? (
              <Card
                key={card.id}
                title={card.title || BUILT_IN_TITLES[card.id]}
                value={content.value}
                detail={content.detail}
                to={content.to}
                period={data.period_label}
              />
            ) : null;
          })}
        </div>
      )}
    </section>
  );
}
