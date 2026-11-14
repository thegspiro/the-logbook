import React from 'react';
import { Calendar, ChevronRight, Globe, Inbox } from 'lucide-react';
import { FormStatus } from '../../constants/enums';
import { displayNameOf } from '../../utils/memberName';
import type { PublicRequestsOverviewProps, PublicRequestsPage } from './types';

interface Step {
  page: PublicRequestsPage;
  title: string;
  body: string;
  status: string;
  ready: boolean;
}

/**
 * Landing page of the Public Requests section.
 *
 * Every other page in the section configures one stage of a single flow — a
 * member of the public asks for an outreach event, the department works the
 * request, the requester is kept informed — and before this page existed those
 * stages were four unrelated tabs ("Pipeline", "Email", "Public Form",
 * "Outreach Types") among the module's general settings, with nothing saying
 * they belonged together. So this page states the flow, shows where each stage
 * stands, and holds the master switch the rest of the section sits behind.
 */
const PublicRequestsOverview: React.FC<PublicRequestsOverviewProps> = ({
  settings,
  saving,
  members,
  emailTemplates,
  eventRequestForms,
  loadingForms,
  onToggleAcceptPublicRequests,
  onUpdateLeadTime,
  onGoToPage,
  onOpenRequests,
}) => {
  const pipeline = settings.request_pipeline;
  const accepting = pipeline.accept_public_requests;
  const publishedForms = eventRequestForms.filter((f) => f.status === FormStatus.PUBLISHED).length;
  const draftForms = eventRequestForms.filter((f) => f.status === FormStatus.DRAFT).length;
  const coordinator = members.find((m) => m.id === pipeline.default_assignee_id);
  const triggersOn = Object.values(pipeline.email_triggers).filter((t) => t.enabled).length;

  const formStatus = loadingForms
    ? 'Checking…'
    : publishedForms > 0
      ? `${publishedForms} published`
      : draftForms > 0
        ? `${draftForms} in draft, not yet published`
        : 'No form yet';

  const steps: Step[] = [
    {
      page: 'form',
      title: 'Request form',
      body: 'The public page a community member fills in to ask for an event.',
      status: formStatus,
      ready: publishedForms > 0,
    },
    {
      page: 'types',
      title: 'Types & roles',
      body: 'The kinds of event a requester can pick, and the jobs members sign up for once it is scheduled.',
      status: `${settings.outreach_event_types.length} types · ${settings.outreach_roles.length} roles`,
      ready: settings.outreach_event_types.length > 0,
    },
    {
      page: 'handling',
      title: 'Handling',
      body: 'Who each new request is assigned to, and the checklist your team works through.',
      status: `${coordinator ? displayNameOf(coordinator) : 'No default coordinator'} · ${pipeline.tasks.length} checklist ${pipeline.tasks.length === 1 ? 'step' : 'steps'}`,
      ready: Boolean(coordinator) && pipeline.tasks.length > 0,
    },
    {
      page: 'emails',
      title: 'Emails',
      body: 'What the requester and your coordinators are told as the request moves along.',
      status: `${triggersOn} automatic ${triggersOn === 1 ? 'email' : 'emails'} on · ${emailTemplates.length} ${emailTemplates.length === 1 ? 'template' : 'templates'}`,
      ready: triggersOn > 0,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-theme-text-primary text-lg font-semibold">Public Event Requests</h2>
        <p className="text-theme-text-muted mt-1 text-sm">
          Let schools, businesses and residents ask your department for an outreach event — a station tour, a fire
          safety talk, an engine at a block party. Requests arrive in Community Outreach, where your team works them
          through to a scheduled event. None of these settings affect events your members create themselves.
        </p>
        <button
          type="button"
          onClick={onOpenRequests}
          className="touch-target-phone mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:underline dark:text-blue-400"
        >
          <Inbox className="h-4 w-4" aria-hidden="true" />
          Open the Requests board
        </button>
      </div>

      {/* The master switch: every other page in this section is inert while it is off. */}
      <div className="border-theme-surface-border flex items-center justify-between gap-4 rounded-lg border p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Globe className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="text-theme-text-primary text-sm font-medium">Accept Public Requests</p>
          </div>
          <p className="text-theme-text-muted mt-0.5 ml-6 text-xs">
            {accepting
              ? 'On — the public request form is open and submissions become requests.'
              : 'Off — the public request form is closed and only staff can create requests. A submission to a published form is kept, but no request is filed from it.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleAcceptPublicRequests}
          disabled={saving}
          className={`focus:ring-theme-focus-ring toggle-track-md shrink-0 ${
            accepting ? 'bg-green-500' : 'bg-theme-surface-hover'
          }`}
          role="switch"
          aria-checked={accepting}
          aria-label="Accept public event requests"
        >
          <span className={`toggle-knob-sm ${accepting ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      {/* Lead time is an intake rule, so it sits beside the switch rather than with the checklist. */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Calendar className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
          <label htmlFor="request-lead-time" className="text-theme-text-primary text-sm font-medium">
            Minimum Lead Time
          </label>
        </div>
        <p className="text-theme-text-muted mb-3 text-xs">
          How far in advance must requests be submitted? A public submission naming a date sooner than this is refused;
          one arriving through a public form is accepted and flagged as short notice for the coordinator. Set to 0 to
          accept any date.
        </p>
        <div className="flex items-center gap-3">
          <input
            id="request-lead-time"
            type="number"
            min={0}
            max={365}
            value={pipeline.min_lead_time_days}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!isNaN(val) && val >= 0 && val <= 365) {
                onUpdateLeadTime(val);
              }
            }}
            className="form-input w-20"
          />
          <span className="text-theme-text-muted text-sm">
            days ({Math.floor(pipeline.min_lead_time_days / 7)} weeks)
          </span>
        </div>
      </div>

      <div className="border-theme-surface-border border-t pt-4">
        <h3 className="text-theme-text-muted mb-1 text-xs font-semibold tracking-wider uppercase">How it works</h3>
        <p className="text-theme-text-muted mb-3 text-xs">Each step is set up on its own page.</p>
        <ol className="space-y-2">
          {steps.map((step, idx) => (
            <li key={step.page}>
              <button
                type="button"
                onClick={() => onGoToPage(step.page)}
                className="border-theme-surface-border hover:bg-theme-surface-hover flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors"
              >
                <span
                  className="bg-theme-surface-secondary text-theme-text-primary flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                  aria-hidden="true"
                >
                  {idx + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-theme-text-primary block text-sm font-medium">{step.title}</span>
                  <span className="text-theme-text-muted block text-xs">{step.body}</span>
                  <span
                    className={`mt-1 block text-xs font-medium ${
                      step.ready ? 'text-green-800 dark:text-green-400' : 'text-amber-800 dark:text-amber-400'
                    }`}
                  >
                    {step.status}
                  </span>
                </span>
                <ChevronRight className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
};

export default PublicRequestsOverview;
