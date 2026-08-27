/**
 * One page on the testing home screen.
 *
 * The box itself is the link to the page under test; the marks sit below it so
 * a tester can open, look, come back and record without hunting for a control.
 * Links open in a new tab on purpose — the run is held in this tab and
 * navigating away then using Back would lose whichever note was half-typed.
 */

import React from 'react';
import { ExternalLink, CornerDownRight, Lock, PowerOff } from 'lucide-react';
import type { TestPageEntry } from './testingRegistry';
import { buildTestUrl, routeParams } from './testingRegistry';
import type { PageAccess } from './pageAccess';
import { describeGate } from './pageAccess';
import type { TestResult, TestStatus } from './useTestingChecklist';

interface TestPageCardProps {
  page: TestPageEntry;
  result: TestResult | undefined;
  access: PageAccess;
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
const TestPageCardComponent: React.FC<TestPageCardProps> = ({ page, result, access, onStatus, onNote, onParam }) => {
  const status = result?.status ?? 'untested';
  const params = routeParams(page.path);
  const url = buildTestUrl(page.path, result?.params ?? {});
  const gate = describeGate(page);

  return (
    // A named group rather than a bare div: the screen is two hundred boxes of
    // identical shape, so each one has to carry the name of the page it is for.
    <div
      role="group"
      aria-label={page.label}
      className={`card flex flex-col gap-3 border-l-4 p-4 ${STATUS_EDGE[status]}`}
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

      <input
        className="form-input-sm"
        value={result?.note ?? ''}
        onChange={(event) => onNote(page.path, event.target.value)}
        placeholder="Note — what broke, or what still needs proving"
        aria-label={`Note for ${page.label}`}
      />
    </div>
  );
};

export const TestPageCard = React.memo(TestPageCardComponent);
