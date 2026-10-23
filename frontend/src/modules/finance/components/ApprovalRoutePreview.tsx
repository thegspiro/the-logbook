/**
 * Who a request would wait on if it were submitted now.
 *
 * Shown while a member raises a purchase request, expense report or check
 * request, and on a draft beside its Submit button. Everything here is the
 * server's answer (`GET /finance/approval-chains/route-preview`), from the same
 * resolver submission uses, so the route shown is the route the request takes
 * (CLAUDE.md pitfall #29): which chain, who each step waits on, which steps
 * the amount auto-approves and whether a second approver is needed.
 */

import React, { useEffect, useState } from 'react';
import { Bell, CheckCircle, Route, Users } from 'lucide-react';
import { approvalChainService } from '../services/api';
import { ApprovalStepType, type ApprovalEntityType, type ApprovalRoutePreview as RoutePreview } from '../types';

/** Long enough that typing an amount asks once, not once per keystroke. */
const DEBOUNCE_MS = 400;

/** The panel sits inside request forms, so an answer that is not a route
 * (a proxy's error page, an older server) must read as "could not be loaded"
 * rather than throw and take the member's half-filled form down with it. */
const isRoute = (value: unknown): value is RoutePreview =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as RoutePreview).manual === 'boolean' &&
  Array.isArray((value as RoutePreview).steps);

interface ApprovalRoutePreviewProps {
  entityType: ApprovalEntityType;
  amount: number;
  /** The budget line chosen, which can select a category's own chain. */
  budgetId?: string | undefined;
}

export const ApprovalRoutePreview: React.FC<ApprovalRoutePreviewProps> = ({ entityType, amount, budgetId }) => {
  const [route, setRoute] = useState<RoutePreview | null>(null);
  const [failed, setFailed] = useState(false);
  const ready = Number.isFinite(amount) && amount > 0;

  useEffect(() => {
    if (!ready) {
      setRoute(null);
      return undefined;
    }
    // A slower answer for an earlier amount must not replace a later one.
    let current = true;
    const timer = setTimeout(() => {
      approvalChainService
        .routePreview({ entityType, amount: amount.toFixed(2), budgetId })
        .then((next: unknown) => {
          if (!current) return;
          if (!isRoute(next)) throw new Error('Not an approval route');
          setRoute(next);
          setFailed(false);
        })
        .catch(() => {
          if (!current) return;
          // A route shown for an earlier amount is not this amount's route.
          setRoute(null);
          setFailed(true);
        });
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [entityType, amount, budgetId, ready]);

  if (!ready) return null;

  return (
    <section
      aria-labelledby="approval-route-heading"
      aria-live="polite"
      className="border-theme-surface-border rounded-lg border p-4"
    >
      <h3 id="approval-route-heading" className="text-theme-text-primary flex items-center gap-2 text-sm font-semibold">
        <Route className="h-4 w-4" aria-hidden="true" />
        Who will approve this
      </h3>
      {failed ? (
        <p className="text-theme-text-secondary mt-2 text-sm">
          The approval route could not be loaded. It is decided when you submit.
        </p>
      ) : !route ? (
        <p className="text-theme-text-secondary mt-2 text-sm">Checking the approval route…</p>
      ) : (
        <>
          {route.manual ? (
            <p className="text-theme-text-secondary mt-2 text-sm">
              No approval chain applies, so a finance approver decides it by hand.
            </p>
          ) : (
            <>
              <p className="text-theme-text-secondary mt-1 text-xs">{route.chainName}</p>
              <ol className="mt-2 space-y-1.5">
                {route.steps.map((step) => (
                  <li
                    key={`${String(step.stepOrder)}-${step.name}`}
                    className="text-theme-text-primary flex items-start gap-2 text-sm"
                  >
                    {step.stepType === ApprovalStepType.NOTIFICATION ? (
                      <Bell className="text-theme-text-secondary mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    ) : step.autoApproved ? (
                      <CheckCircle
                        className="mt-0.5 h-4 w-4 shrink-0 text-green-700 dark:text-green-400"
                        aria-hidden="true"
                      />
                    ) : (
                      <Users className="text-theme-text-secondary mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    )}
                    <span>
                      <span className="font-medium">{step.name}</span>
                      <span className="text-theme-text-secondary">
                        {step.stepType === ApprovalStepType.NOTIFICATION
                          ? ' — notified, nothing to approve'
                          : step.autoApproved
                            ? ' — approved automatically at this amount'
                            : ` — waits on ${step.assigneeLabel ?? 'any finance approver'}`}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
          {route.secondApproverRequired && (
            <p className="text-theme-text-secondary mt-2 text-sm">
              At this amount it also needs a second, different approver.
            </p>
          )}
        </>
      )}
    </section>
  );
};
