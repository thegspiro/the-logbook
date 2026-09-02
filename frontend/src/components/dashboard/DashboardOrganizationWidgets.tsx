import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { dashboardService } from '../../services/api';
import type { MainDashboardWidgets, WidgetPeriod } from '../../services/communicationsServices';
import { formatCurrencyWhole } from '../../utils/currencyFormatting';

const periods: Array<{ value: WidgetPeriod; label: string }> = [
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
  { value: 'rolling_30', label: 'Rolling 30 days' },
];
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
export default function DashboardOrganizationWidgets() {
  const [period, setPeriod] = useState<WidgetPeriod>('month');
  const [data, setData] = useState<MainDashboardWidgets | null>(null);
  useEffect(() => {
    let live = true;
    if (typeof dashboardService.getWidgets !== 'function')
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
  }, [period]);
  if (!data || (!data.finance && !data.fundraising && !data.community)) return null;
  const f = data.finance,
    g = data.fundraising,
    c = data.community;
  const campaignPct =
    g && Number(g.campaign_goal) > 0 ? Math.round((Number(g.campaign_raised) / Number(g.campaign_goal)) * 100) : 0;
  const activeApps = g ? Object.values(g.application_stages).reduce((sum, count) => sum + count, 0) : 0;
  const budgeted = Number(f?.budgeted ?? 0);
  const spent = Number(f?.spent ?? 0);
  const encumbered = Number(f?.encumbered ?? 0);
  return (
    <section aria-labelledby="dashboard-widgets-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="dashboard-widgets-title" className="text-theme-text-primary font-bold">
            Department pulse
          </h2>
          <p className="text-theme-text-muted text-sm">Authorized operational summaries; select a reporting period.</p>
        </div>
        <label className="text-theme-text-secondary text-sm">
          Period{' '}
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as WidgetPeriod)}
            className="form-input ml-2 min-h-11 w-auto"
            aria-label="Dashboard widget period"
          >
            {periods.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {f && (
          <>
            <Card
              title="Dues"
              value={formatCurrencyWhole(f.dues_paid)}
              detail={`${formatCurrencyWhole(f.dues_due)} due · ${f.overdue_dues} overdue`}
              to={`/finance?period=${period}#dues`}
              period={data.period_label}
            />
            <Card
              title="Cash flow"
              value={formatCurrencyWhole(f.net_cash_flow)}
              detail={`${formatCurrencyWhole(f.cash_in)} in · ${formatCurrencyWhole(f.cash_out)} out`}
              to={`/finance?period=${period}#cash-flow`}
              period={data.period_label}
            />
            <Card
              title="Budget threshold"
              value={`${budgeted > 0 ? Math.round(((spent + encumbered) / budgeted) * 100) : 0}%`}
              detail={`${formatCurrencyWhole(f.spent)} spent · ${formatCurrencyWhole(f.encumbered)} committed`}
              to={`/finance?period=${period}#budget-health`}
              period={data.period_label}
            />
          </>
        )}
        {g && (
          <>
            <Card
              title="Grant deadlines"
              value={String(g.grant_deadlines_30_days)}
              detail="Due in the next 30 days"
              to={`/grants?period=${period}#deadlines`}
              period={data.period_label}
            />
            <Card
              title="Application stages"
              value={String(activeApps)}
              detail="Applications across the pipeline"
              to={`/grants?period=${period}#pipeline`}
              period={data.period_label}
            />
            <Card
              title="Campaign progress"
              value={`${campaignPct}%`}
              detail={`${formatCurrencyWhole(g.campaign_raised)} of ${formatCurrencyWhole(g.campaign_goal)}`}
              to={`/grants?period=${period}#campaigns`}
              period={data.period_label}
            />
          </>
        )}
        {c && (
          <>
            <Card
              title="Community engagement"
              value={String(c.public_events)}
              detail={`${c.member_attendees + c.external_attendees} attendees at public events`}
              to={`/events/admin?tab=community&period=${period}`}
              period={data.period_label}
            />
            <Card
              title="Public requests"
              value={String(c.pending_public_requests)}
              detail="Pending outreach requests"
              to={`/events/admin?tab=requests&period=${period}`}
              period={data.period_label}
            />
          </>
        )}
      </div>
    </section>
  );
}
