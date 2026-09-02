/**
 * One page on the testing home screen.
 *
 * The box itself is the link to the page under test; the marks sit below it so
 * a tester can open, look, come back and record without hunting for a control.
 * Links open in a new tab on purpose — the run is held in this tab and
 * navigating away then using Back would lose whichever note was half-typed.
 */

import React from 'react';
import { ExternalLink, CornerDownRight, History, Lock, PowerOff, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { TestPageEntry } from '../testingRegistry';
import { buildTestUrl, routeParams } from '../testingRegistry';
import type { PageAccess } from '../pageAccess';
import { describeGate } from '../pageAccess';
import type { OtherTesterMark, TestResult, TestStatus } from '../useTestingChecklist';
import { GATE_VERDICT_LABELS, gateVerdict, isGateMismatch, needsGateConfirmation } from '../gateVerdict';

interface TestPageCardProps {
  page: TestPageEntry;
  result: TestResult | undefined;
  /** What other testers found here. Only populated on the shared run. */
  otherMarks?: OtherTesterMark[] | undefined;
  access: PageAccess;
  /** The build this browser runs, so a mark from an older one can say so. */
  currentBuildId?: string | undefined;
  /** An archived run is a record: it renders, but it does not take marks. */
  readOnly?: boolean | undefined;
  /** Carries the keyboard focus ring; p/f/b mark whichever card has it. */
  isFocused?: boolean | undefined;
  onFocus?: ((path: string) => void) | undefined;
  onStatus: (path: string, status: TestStatus) => void;
  onNote: (path: string, note: string) => void;
  onParam: (path: string, param: string, value: string) => void;
}

/** Fills are the -800 tier: white on -600 is AA for large text only. */
const STATUS_BUTTONS: { status: Exclude<TestStatus, 'untested'>; label: string; active: string }[] = [
  { status: 'pass', label: 'Pass', active: 'bg-green-800 text-white' },
  { status: 'fail', label: 'Fail', active: 'bg-red-800 text-white' },
  { status: 'blocked', label: 'Blocked', active: 'bg-amber-800 text-white' },
];

/** A gate defect outranks the result colour: it is the louder finding. */
const MISMATCH_EDGE = 'border-red-800';

const STATUS_EDGE: Record<TestStatus, string> = {
  untested: 'border-theme-surface-border',
  pass: 'border-green-800',
  fail: 'border-red-800',
  blocked: 'border-amber-800',
};

/**
 * Memoized: the screen holds every route in the application at once, and
 * without this a keystroke in one note re-renders all two hundred boxes —
 * which is slow enough on a laptop to drop characters. The parent keeps the
 * handlers stable and takes the path as an argument for the same reason.
 */
const OTHER_MARK_STYLE: Record<TestStatus, string> = {
  untested: 'bg-theme-surface-secondary text-theme-text-secondary',
  pass: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  fail: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  blocked: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
};

const TestPageCardComponent: React.FC<TestPageCardProps> = ({
  page,
  result,
  otherMarks,
  access,
  currentBuildId,
  readOnly = false,
  isFocused = false,
  onFocus,
  onStatus,
  onNote,
  onParam,
}) => {
  const status = result?.status ?? 'untested';
  const verdict = gateVerdict({
    status,
    ...(result?.expectedAccess ? { expectedAccess: result.expectedAccess } : {}),
  });
  // Only a mark that carries a build can be stale: development bundles carry
  // none, and an absent stamp is not evidence of age.
  const isStale =
    status !== 'untested' && Boolean(currentBuildId) && Boolean(result?.buildId) && result?.buildId !== currentBuildId;
  const cardRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (isFocused) cardRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isFocused]);
  const params = routeParams(page.path);
  const url = buildTestUrl(page.path, result?.params ?? {});
  const gate = describeGate(page);

  return (
    // A named group rather than a bare div: the screen is two hundred boxes of
    // identical shape, so each one has to carry the name of the page it is for.
    <div
      ref={cardRef}
      role="group"
      aria-label={page.label}
      onClickCapture={() => onFocus?.(page.path)}
      className={`card flex flex-col gap-3 border-l-4 p-4 ${
        isGateMismatch(verdict) ? MISMATCH_EDGE : STATUS_EDGE[status]
      } ${isFocused ? 'ring-theme-focus-ring ring-2' : ''}`}
    >
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="group hover:bg-theme-surface-hover -m-1 flex items-start gap-2 rounded-md p-1 transition-colors"
        >
          <div className="min-w-0 flex-1">
            <p className="text-theme-text-primary font-semibold group-hover:underline">{page.label}</p>
            <p className="text-theme-text-secondary truncate font-mono text-xs">{url}</p>
          </div>
          <ExternalLink className="text-theme-text-muted mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        </a>
      ) : (
        <div className="-m-1 p-1">
          <p className="text-theme-text-primary font-semibold">{page.label}</p>
          <p className="text-theme-text-secondary truncate font-mono text-xs">{page.path}</p>
        </div>
      )}

      {page.note && <p className="text-theme-text-secondary text-xs">{page.note}</p>}

      {isStale && (
        <p className="text-theme-text-secondary inline-flex items-center gap-1 text-xs">
          <History className="h-3 w-3" aria-hidden="true" />
          Marked against an earlier build — worth checking again.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {page.isPublic && <span className="badge bg-theme-surface-secondary text-theme-text-secondary">public</span>}
        {page.redirectsTo && (
          <span className="badge bg-theme-surface-secondary text-theme-text-secondary inline-flex gap-1">
            <CornerDownRight className="h-3 w-3" aria-hidden="true" />
            {page.redirectsTo}
          </span>
        )}
        {gate && (
          <span
            className={`badge inline-flex gap-1 font-mono ${
              access.kind === 'denied'
                ? 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400'
                : 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400'
            }`}
          >
            <Lock className="h-3 w-3" aria-hidden="true" />
            {gate}
          </span>
        )}
        {page.module && (
          <span
            className={`badge inline-flex gap-1 ${
              access.kind === 'module-off'
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'
                : 'bg-theme-surface-secondary text-theme-text-secondary'
            }`}
          >
            {access.kind === 'module-off' && <PowerOff className="h-3 w-3" aria-hidden="true" />}
            module: {page.module}
          </span>
        )}
      </div>

      {access.kind === 'denied' && (
        <p className="text-xs text-red-800 dark:text-red-400">
          Your account is missing {access.missing.length > 1 ? 'all of' : ''}{' '}
          <span className="font-mono">{access.missing.join(', ')}</span> — this page should refuse with Access Denied.
        </p>
      )}
      {access.kind === 'module-off' && (
        <p className="text-xs text-amber-800 dark:text-amber-300">
          The <span className="font-mono">{access.module}</span> module is switched off for this department — the page
          should say so rather than render.
        </p>
      )}

      {params.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {params.map((param) => (
            <label key={param} className="flex-1 basis-32 text-xs">
              <span className="form-label-sm font-mono">:{param}</span>
              <input
                className="form-input-sm"
                value={result?.params?.[param] ?? ''}
                onChange={(event) => onParam(page.path, param, event.target.value)}
                placeholder="paste an id"
                aria-label={`Sample ${param} for ${page.label}`}
                // Every other control on a read-only card is disabled; this one
                // was not, and it writes through the same path they do.
                disabled={readOnly}
              />
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="segmented-group inline-flex gap-1" role="group" aria-label={`Result for ${page.label}`}>
          {STATUS_BUTTONS.map((button) => (
            <button
              key={button.status}
              type="button"
              aria-pressed={status === button.status}
              disabled={readOnly}
              onClick={() => onStatus(page.path, button.status)}
              className={`mobile-touch-target rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                status === button.status ? button.active : 'text-theme-text-secondary hover:bg-theme-surface-hover'
              }`}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>

      {isGateMismatch(verdict) && (
        <p className="inline-flex items-start gap-1.5 text-xs font-semibold text-red-800 dark:text-red-400">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {GATE_VERDICT_LABELS[verdict]} — worth reporting as a permissions defect.
        </p>
      )}
      {needsGateConfirmation(verdict) && (
        <p className="inline-flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {GATE_VERDICT_LABELS[verdict]} — was it refused, or could you not reach it? Say which in the note.
        </p>
      )}
      {verdict === 'refusal-verified' && (
        <p className="inline-flex items-center gap-1.5 text-xs text-green-800 dark:text-green-400">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {GATE_VERDICT_LABELS[verdict]}.
        </p>
      )}

      <input
        className="form-input-sm"
        value={result?.note ?? ''}
        onChange={(event) => onNote(page.path, event.target.value)}
        disabled={readOnly}
        placeholder="Note — what broke, or what still needs proving"
        aria-label={`Note for ${page.label}`}
      />

      {(otherMarks?.length ?? 0) > 0 && (
        <div className="border-theme-surface-border border-t pt-2">
          <p className="text-theme-text-muted mb-1.5 text-xs">Other testers</p>
          <ul className="flex flex-wrap gap-1.5">
            {(otherMarks ?? []).map((mark) => (
              <li key={mark.markId}>
                {/* The seat is the point: the same page tested by a chief and
                    by a firefighter are two different observations. */}
                <span
                  className={`badge gap-1 ${OTHER_MARK_STYLE[mark.status]}`}
                  title={mark.note ? `${mark.testerName}: ${mark.note}` : mark.testerName}
                >
                  {mark.testerName}
                  {mark.testedAs.length > 0 && <span className="opacity-75">({mark.testedAs.join(', ')})</span>}
                  <span className="font-semibold">{mark.status === 'untested' ? 'not tested' : mark.status}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export const TestPageCard = React.memo(TestPageCardComponent);
