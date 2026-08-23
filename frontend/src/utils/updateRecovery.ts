/**
 * Escalating recovery for a device that will not move onto a new build.
 *
 * `useAppUpdate` detects a deployment by comparing `/version.json` against the
 * build id baked into the running bundle, and `reloadForNewVersion` applies it
 * by swapping the service worker and reloading. That is the happy path, and it
 * is the only path this app had: when the reload did *not* land on the new
 * build, nothing noticed. The next check saw the same mismatch, reloaded again,
 * and the device sat in that loop indefinitely — visibly reloading itself,
 * never updating. The only way out was the member clearing site data by hand,
 * which is exactly the report this module exists to answer.
 *
 * A reload can fail to take for reasons the page cannot see or fix: a service
 * worker whose module factory aborted (see `inlinePushWorkerPlugin` in
 * vite.config.ts for the case that prompted this), an install that never got
 * past `waiting`, a precache holding an index.html that no longer matches the
 * assets on the server. What they share is that the old worker keeps control
 * and keeps serving its old shell, so a *plain* reload can never succeed no
 * matter how many times it runs.
 *
 * So attempts are counted per target build, and each one tries something
 * strictly stronger than the last:
 *
 *   1. `reload`  — swap the worker and reload. Fixes the ordinary case.
 *   2. `purge`   — additionally delete every Cache Storage entry first. The old
 *                  worker stays in control, but with an empty precache it has
 *                  nothing stale to serve: workbox falls through to the network
 *                  and the reload lands on the deployed build. This is the same
 *                  thing the member was doing manually.
 *   3. exhausted — stop. Two failed attempts mean the problem is not one more
 *                  reload away, and an app that reloads itself forever is worse
 *                  than one that admits it is stuck. The banner switches to
 *                  pointing at Settings → App → Force refresh.
 *
 * The ladder deliberately stops short of unregistering the service worker. That
 * would be the more thorough nuke, but a push subscription belongs to the
 * registration and nothing re-subscribes automatically — silently dropping
 * callout notifications to fix a stale build is the wrong trade on a fire
 * department's phone. `forceAppRefresh` makes the same call for the same
 * reason; the difference is that this ladder runs unattended, so it has less
 * license, not more.
 */

import { canReachServer, purgeAppCaches } from './forceAppRefresh';
import { reloadForNewVersion } from './serviceWorkerUpdate';

/** What an update attempt did, in increasing order of severity. */
export type UpdateRemedy = 'reload' | 'purge' | 'exhausted';

/** Remedy applied on attempt N, by index. Past the end, we are out of ideas. */
const REMEDIES = ['reload', 'purge'] as const;

const STORAGE_KEY = 'logbook:update-attempts';

/**
 * Forget an in-flight escalation after a day. Without this, a device that hit
 * the ladder months ago and was fixed some other way would start its next
 * genuine update one or two rungs up, purging caches for a deployment that a
 * plain reload would have applied. A day is comfortably longer than any real
 * detect-reload-verify cycle, which completes in seconds.
 */
const ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;

interface AttemptRecord {
  /** Server build the device has been trying, and failing, to reach. */
  buildId: string;
  /** Number of attempts already made at that build. */
  attempts: number;
  /** When the most recent attempt was made. */
  at: number;
}

/**
 * Read the stored record, or null when there is none, it is unreadable, or it
 * has aged out.
 *
 * Storage can throw outright (private mode, blocked site data), and the value
 * is whatever was last written to a key any script on the origin can edit — so
 * every field is checked rather than trusted. A malformed record is treated as
 * absent, which starts the ladder from the bottom: the safe direction.
 */
function readRecord(): AttemptRecord | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const { buildId, attempts, at } = parsed as Partial<AttemptRecord>;
    if (typeof buildId !== 'string' || typeof attempts !== 'number' || typeof at !== 'number') return null;
    if (!Number.isFinite(attempts) || attempts < 0) return null;
    if (Date.now() - at > ATTEMPT_TTL_MS) return null;

    return { buildId, attempts, at };
  } catch {
    return null;
  }
}

/**
 * The remedy the next attempt at `targetBuildId` should use.
 *
 * Counting is per build: a device that struggled with one deployment gets a
 * clean slate at the next, because whatever was wrong may well have been fixed
 * by the very build it is now being offered.
 */
export function nextRemedy(targetBuildId: string): UpdateRemedy {
  const record = readRecord();
  const attempts = record?.buildId === targetBuildId ? record.attempts : 0;
  return REMEDIES[attempts] ?? 'exhausted';
}

/** Count one attempt at moving this device onto `targetBuildId`. */
export function recordUpdateAttempt(targetBuildId: string): void {
  const record = readRecord();
  const attempts = record?.buildId === targetBuildId ? record.attempts + 1 : 1;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ buildId: targetBuildId, attempts, at: Date.now() }));
  } catch {
    // Storage unavailable. Every attempt then reads as the first, so the device
    // retries the plain reload rather than escalating — no worse than the
    // behaviour before this module existed, and it still never loops silently:
    // the banner stays up and Force refresh is still there.
  }
}

/**
 * Clear the escalation state. Called once the running build matches the server,
 * which is the only proof that an update actually took.
 */
export function clearUpdateAttempts(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

/**
 * Apply a detected update, escalating if earlier attempts at the same build did
 * not stick. Returns the remedy used — `'exhausted'` means nothing was done and
 * the caller should stop offering an automatic retry.
 *
 * `targetBuildId` is the build id the server reported. It is optional only
 * because a caller may not have one to hand; without it there is nothing to
 * count attempts against, so the plain reload is all that can be offered.
 */
export async function applyAppUpdate(targetBuildId?: string): Promise<UpdateRemedy> {
  if (!targetBuildId) {
    await reloadForNewVersion();
    return 'reload';
  }

  const remedy = nextRemedy(targetBuildId);
  if (remedy === 'exhausted') return 'exhausted';

  if (remedy === 'purge') {
    // The precache is the app's only offline copy and workbox only heals it by
    // fetching, so purging out of contact would leave the device with no
    // working app and no way to get one — the failure forceAppRefresh guards
    // against for the same reason. Detection proved the server was reachable
    // at the time, but the member may tap "Reload now" long afterwards, and a
    // member whose app looks broken is disproportionately likely to be out of
    // signal. Fall back to the plain reload and leave the attempt uncounted, so
    // the purge is still waiting when there is a connection to do it safely.
    if (!(await canReachServer())) {
      await reloadForNewVersion();
      return 'reload';
    }
    await purgeAppCaches();
  }

  recordUpdateAttempt(targetBuildId);
  await reloadForNewVersion();
  return remedy;
}
