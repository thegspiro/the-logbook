import React from 'react';
import { formatHours, formatHoursExact } from '../../../../utils/hoursFormatting';
import { AlertTriangle, Award, Calendar, CheckCircle, Clock, ClipboardCheck, FileText, Users } from 'lucide-react';
import type { TrainingDashboardSummary } from '../../../../services/trainingServices';

export { TRAINING_WIDGET_METADATA, type TrainingWidgetId } from './metadata';

const Card = ({
  title,
  icon: Icon,
  href,
  children,
}: {
  title: string;
  icon: React.ElementType;
  href: string;
  children: React.ReactNode;
}) => (
  <a href={href} className="card hover:bg-theme-surface-hover block p-6 transition-colors">
    <h3 className="text-theme-text-primary mb-4 flex items-center gap-2 font-semibold">
      <Icon className="h-5 w-5" />
      {title}
    </h3>
    {children}
  </a>
);
const Empty = ({ children }: React.PropsWithChildren) => <p className="text-theme-text-muted text-sm">{children}</p>;
const Row = ({ children }: React.PropsWithChildren) => (
  <div className="bg-theme-input-bg/50 mb-2 flex items-center justify-between rounded-sm p-3 text-sm">{children}</div>
);

// With no requirements defined every member is trivially compliant, and a 100%
// on a department that has set nothing up reads as "all current".
export const ComplianceOverviewWidget = ({ data }: { data: TrainingDashboardSummary }) =>
  data.stats.active_requirements === 0 ? (
    <Card title="Department Compliance" icon={CheckCircle} href="/training/admin?page=setup&tab=requirements">
      <div className="text-theme-text-primary text-3xl font-bold">Not set up</div>
      <p className="text-theme-text-muted text-sm">
        No training requirements exist yet, so there is nothing to measure members against. Add one under Setup →
        Requirements.
      </p>
    </Card>
  ) : (
    <Card
      title="Department Compliance"
      icon={CheckCircle}
      href="/training/admin?page=dashboard&tab=compliance&status=noncompliant"
    >
      {data.stats.compliance_percentage === null ? (
        <>
          <div className="text-theme-text-muted text-3xl font-bold">N/A</div>
          <p className="text-theme-text-muted text-sm">No active requirement applies to any tracked member.</p>
        </>
      ) : (
        <>
          <div className="text-theme-text-primary text-3xl font-bold">{data.stats.compliance_percentage}%</div>
          <p className="text-theme-text-muted text-sm">
            {/* Members nothing grades are outside the percentage, so the count is of graded members. */}
            {data.stats.compliant_members} of {data.stats.graded_members ?? data.stats.tracked_members} graded members
            {data.stats.not_applicable_members ? ` · ${data.stats.not_applicable_members} not applicable` : ''}
          </p>
        </>
      )}
    </Card>
  );
export const UpcomingExpirationsWidget = ({ data, days = 90 }: { data: TrainingDashboardSummary; days?: number }) => (
  <Card
    title="Upcoming Expirations"
    icon={AlertTriangle}
    href={`/training/admin?page=dashboard&tab=expiring-certs&days=${days}`}
  >
    {data.expirations.length ? (
      data.expirations.map((x) => (
        <Row key={x.id}>
          <span>
            {x.member_name} · {x.course_name}
          </span>
          <b>{x.days_left}d</b>
        </Row>
      ))
    ) : (
      <Empty>No certifications expire in this window.</Empty>
    )}
  </Card>
);
export const RecentCompletionsWidget = ({ data }: { data: TrainingDashboardSummary }) => (
  <Card
    title="Recent Completions"
    icon={Award}
    href="/training/admin?page=records&tab=member-status&completion_window=30"
  >
    {data.recent_completions.length ? (
      data.recent_completions.map((x) => (
        <Row key={x.id}>
          <span>
            {x.member_name} · {x.course_name}
          </span>
          <span>{x.completion_date}</span>
        </Row>
      ))
    ) : (
      <Empty>No completions in the last 30 days.</Empty>
    )}
  </Card>
);
export const TrainingHoursSummaryWidget = ({ data }: { data: TrainingDashboardSummary }) => (
  <Card
    title="Training Hours (This Year)"
    icon={Clock}
    href={`/training/admin?page=records&tab=member-status&year=${new Date().getFullYear()}`}
  >
    <div className="text-theme-text-primary text-3xl font-bold">
      {formatHours(data.stats.total_hours_this_year)} hrs
    </div>
    <p className="text-theme-text-muted text-sm">
      {formatHoursExact(data.stats.average_hours_per_member)} average per tracked member
    </p>
  </Card>
);
export const RequirementsStatusWidget = ({ data }: { data: TrainingDashboardSummary }) => (
  <Card title="Requirements Status" icon={FileText} href="/training/admin?page=setup&tab=requirements&active=true">
    {data.requirements.length ? (
      data.requirements.map((x) => (
        <Row key={x.id}>
          <span>{x.name}</span>
          <span>{x.due_date ?? 'Ongoing'}</span>
        </Row>
      ))
    ) : (
      <Empty>No active requirements.</Empty>
    )}
  </Card>
);
export const MembersNeedingInterventionWidget = ({ data }: { data: TrainingDashboardSummary }) => (
  <Card
    title="Members Needing Intervention"
    icon={Users}
    href="/training/admin?page=dashboard&tab=compliance&status=noncompliant"
  >
    {data.members_needing_intervention.length ? (
      data.members_needing_intervention.map((x) => (
        <Row key={x.member_id}>
          <span>{x.member_name}</span>
          <b>{x.unmet_count} unmet</b>
        </Row>
      ))
    ) : (
      <Empty>No members need intervention.</Empty>
    )}
  </Card>
);
export const UpcomingSessionCapacityWidget = ({ data }: { data: TrainingDashboardSummary }) => (
  <Card
    title="Upcoming Session Capacity"
    icon={Calendar}
    href="/training/admin?page=records&tab=sessions&session=upcoming"
  >
    {data.upcoming_session_capacity.length ? (
      data.upcoming_session_capacity.map((x) => (
        <Row key={x.session_id}>
          <span>{x.title}</span>
          <b>{x.remaining} open</b>
        </Row>
      ))
    ) : (
      <Empty>No capacity-limited sessions are upcoming.</Empty>
    )}
  </Card>
);
export const PendingValidationWidget = ({ data }: { data: TrainingDashboardSummary }) => (
  <Card
    title="Pending Validation"
    icon={ClipboardCheck}
    href="/training/admin?page=records&tab=submissions&validation_state=pending_review"
  >
    <div className="text-theme-text-primary text-3xl font-bold">{data.pending_validation.count}</div>
    <p className="text-theme-text-muted text-sm">Submissions awaiting review</p>
  </Card>
);
export const RequirementsAtRiskWidget = ({ data }: { data: TrainingDashboardSummary }) => (
  <Card
    title="Requirements at Risk"
    icon={AlertTriangle}
    href="/training/admin?page=dashboard&tab=compliance&risk=at_risk"
  >
    {data.requirements_at_risk.length ? (
      data.requirements_at_risk.map((x) => (
        <Row key={x.requirement_id}>
          <span>{x.name}</span>
          <b>
            {x.members_at_risk}/{x.applicable_members}
          </b>
        </Row>
      ))
    ) : (
      <Empty>No requirements are at risk.</Empty>
    )}
  </Card>
);
