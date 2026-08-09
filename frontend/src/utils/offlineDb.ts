/**
 * Shared IndexedDB access for the offline queues.
 *
 * WHY THIS EXISTS — two failure modes this file prevents:
 *
 * 1. Version skew. `offlineQueue.ts` (equipment checks) and
 *    `shiftReportOfflineQueue.ts` (shift reports) share one database,
 *    `logbook-offline`. They previously declared their own DB_VERSION
 *    constants — 1 and 2 respectively. IndexedDB rejects any `open()` whose
 *    requested version is *lower* than the stored version, so as soon as a
 *    shift report was queued (upgrading the store to v2), every subsequent
 *    equipment-check call failed with a VersionError for the life of that
 *    browser profile. The version now lives in exactly one place.
 *
 * 2. An unsettled open request. `indexedDB.open()` fires `blocked` — and
 *    neither `success` nor `error` — when an upgrade is needed but another
 *    tab still holds the database open at the old version. A promise wired
 *    only to success/error simply never settles, hanging every caller that
 *    awaits it. Logout awaits the purge, so a hung open would leave a member
 *    signed in on a shared station: precisely the risk the purge exists to
 *    remove. Every open is therefore bounded by both a `blocked` handler and
 *    a wall-clock timeout.
 */

/**
 * Upper bound on how long a caller will wait for a database handle. IndexedDB
 * has no native timeout, and the purge path runs during logout where blocking
 * is unacceptable.
 */
const OPEN_TIMEOUT_MS = 5_000;

export const OFFLINE_DB_NAME = 'logbook-offline';
/**
 * Bump this — never a per-module copy — when adding an object store to the
 * shared database, and create the new store in `upgradeOfflineDb` below.
 */
export const OFFLINE_DB_VERSION = 2;

export const STORE_PENDING_CHECKS = 'pendingChecks';
export const STORE_PENDING_SHIFT_REPORTS = 'pendingShiftReports';

/**
 * Open an IndexedDB database with guaranteed settlement.
 *
 * Rejects (rather than hanging) on `blocked`, on `error`, and on timeout.
 */
export function openIndexedDb(name: string, version: number, upgrade: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(name, version);
    } catch (err) {
      // Private browsing and some embedded webviews throw synchronously.
      reject(err instanceof Error ? err : new Error(`IndexedDB "${name}" unavailable`));
      return;
    }

    let settled = false;

    // Declared before `timer` so the timeout callback can reach it; hoisting
    // makes that safe because it only ever runs after `timer` is assigned.
    function settle(action: () => void): boolean {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      action();
      return true;
    }

    const timer = setTimeout(() => {
      settle(() => reject(new Error(`Timed out opening IndexedDB "${name}"`)));
    }, OPEN_TIMEOUT_MS);

    request.onupgradeneeded = () => upgrade(request.result);

    request.onsuccess = () => {
      const db = request.result;
      // Another tab asking to upgrade must not be blocked by this connection.
      db.onversionchange = () => db.close();
      const accepted = settle(() => resolve(db));
      // The timeout already fired and the caller moved on — don't leak the
      // connection, and don't let it block a later upgrade.
      if (!accepted) db.close();
    };

    request.onerror = () => {
      settle(() => reject(request.error ?? new Error(`Failed to open IndexedDB "${name}"`)));
    };

    request.onblocked = () => {
      settle(() => reject(new Error(`IndexedDB "${name}" upgrade blocked by another open tab`)));
    };
  });
}

/** Create every object store the shared offline database needs. */
export function upgradeOfflineDb(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(STORE_PENDING_CHECKS)) {
    db.createObjectStore(STORE_PENDING_CHECKS, { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains(STORE_PENDING_SHIFT_REPORTS)) {
    db.createObjectStore(STORE_PENDING_SHIFT_REPORTS, { keyPath: 'id' });
  }
}

/** Open the shared offline database used by the check and report queues. */
export function openOfflineDb(): Promise<IDBDatabase> {
  return openIndexedDb(OFFLINE_DB_NAME, OFFLINE_DB_VERSION, upgradeOfflineDb);
}
