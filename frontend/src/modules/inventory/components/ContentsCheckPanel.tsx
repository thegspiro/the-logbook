/**
 * Check a container's contents: scan its label, then everything inside, and
 * see what is missing and what does not belong.
 *
 * A bag, box or bin is a storage area, so "what should be in it" is every
 * active item filed on that area or on an area nested inside it (a pocket in a
 * bag). Nothing is written while checking. The one change on offer is filing
 * the stray items here, through the same put-away the Put away panel uses.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { inventoryService } from '../../../services/api';
import type { InventoryItem, StorageAreaResponse } from '../types';
import { getStatusLabel } from '../types';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatNumber } from '../../../utils/dateFormatting';
import { MAX_LABEL_BATCH } from '../utils/labelPrintQuery';
import { containerAreaIds } from '../utils/containerAreas';
import { ScanCodeField } from './ScanCodeField';

interface Stray {
  id: string;
  name: string;
  areaId: string | null;
}

interface ContentsCheckPanelProps {
  areas: StorageAreaResponse[];
  /** The area already in view, if any; scanning a container label replaces it. */
  initialArea: StorageAreaResponse | null;
  pathOf: (area: StorageAreaResponse) => string;
  /** Called after strays were filed here, so the page can refresh. */
  onFiled: (area: StorageAreaResponse) => void;
  onClose: () => void;
}

export const ContentsCheckPanel: React.FC<ContentsCheckPanelProps> = ({
  areas,
  initialArea,
  pathOf,
  onFiled,
  onClose,
}) => {
  const [target, setTarget] = useState<StorageAreaResponse | null>(initialArea);
  const [expected, setExpected] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [strays, setStrays] = useState<Stray[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [filing, setFiling] = useState(false);
  // The scan handler outlives renders (the camera holds it), so it reads the
  // current scans through a ref rather than the set it closed over.
  const seenRef = useRef(seen);
  seenRef.current = seen;
  const [reloadKey, setReloadKey] = useState(0);

  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void (async () => {
      try {
        const ids = containerAreaIds(target.id, areas);
        const pages = await Promise.all(
          ids.map((id) => inventoryService.getItems({ storage_area_id: id, skip: 0, limit: MAX_LABEL_BATCH }))
        );
        if (cancelled) return;
        const byId = new Map<string, InventoryItem>();
        let more = false;
        for (const page of pages) {
          for (const item of page.items) byId.set(item.id, item);
          if ((page.total ?? page.items.length) > page.items.length) more = true;
        }
        setExpected(Array.from(byId.values()));
        setTruncated(more);
      } catch (err: unknown) {
        if (!cancelled) setLoadError(getErrorMessage(err, 'Could not load what this container should hold'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target, areas, reloadKey]);

  const expectedById = useMemo(() => new Map(expected.map((item) => [item.id, item])), [expected]);

  const startOver = () => {
    setSeen(new Set());
    setStrays([]);
    setMessage(null);
  };

  const handleCode = async (code: string): Promise<boolean> => {
    const wanted = code.trim().toUpperCase();
    const container = areas.find((a) => (a.barcode ?? '').trim().toUpperCase() === wanted);
    if (container) {
      if (container.id === target?.id) {
        setMessage(null);
        return true;
      }
      if (seenRef.current.size > 0) {
        setMessage('Finish this check, or start over, before scanning another container.');
        return false;
      }
      setTarget(container);
      startOver();
      return true;
    }
    if (!target) {
      setMessage('Scan the container’s label first, then everything inside it.');
      return false;
    }
    // Until the expected contents are in, every item would read as a stray.
    if (loading || loadError) {
      setMessage('Still loading what this container should hold. Scan that again in a moment.');
      return false;
    }
    try {
      const { results } = await inventoryService.lookupByCode(code);
      const item = results[0]?.item;
      if (!item) {
        setMessage(`No item has the barcode ${code}.`);
        return false;
      }
      if (seenRef.current.has(item.id)) {
        setMessage(`${item.name} was already checked.`);
        return false;
      }
      seenRef.current = new Set(seenRef.current).add(item.id);
      setSeen(seenRef.current);
      if (!expectedById.has(item.id)) {
        setStrays((prev) => [...prev, { id: item.id, name: item.name, areaId: item.storage_area_id ?? null }]);
        setMessage(`${item.name} is not recorded as being in here.`);
        return false;
      }
      setMessage(null);
      return true;
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, `Could not look up ${code}`));
      return false;
    }
  };

  // Only items the record says are on hand can be missing. One assigned to a
  // member or out for service is somewhere else by design.
  const onHand = expected.filter((item) => item.status === 'available');
  const away = expected.filter((item) => item.status !== 'available' && !seen.has(item.id));
  const found = onHand.filter((item) => seen.has(item.id)).length;
  const missing = onHand.filter((item) => !seen.has(item.id));
  // Physically here while the record says otherwise: worth a second look.
  const contradicted = expected.filter((item) => item.status !== 'available' && seen.has(item.id));

  const fileStrays = async () => {
    if (!target || strays.length === 0) return;
    setFiling(true);
    try {
      const res = await inventoryService.putAwayItems(
        target.id,
        strays.map((s) => s.id)
      );
      if (res.moved.length > 0) {
        toast.success(`Filed ${formatNumber(res.moved.length)} on ${target.name}`);
        onFiled(target);
      }
      const refused = new Map(res.skipped.map((s) => [s.item_id, s.reason]));
      setStrays((prev) => prev.filter((s) => refused.has(s.id)));
      setMessage(res.skipped.length > 0 ? res.skipped.map((s) => `${s.name}: ${s.reason}`).join('; ') : null);
      setReloadKey((k) => k + 1);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not file the items'));
    } finally {
      setFiling(false);
    }
  };

  const areaName = (id: string | null) => {
    const area = id ? areaById.get(id) : undefined;
    return area ? pathOf(area) : 'no storage area';
  };

  return (
    <div className="card-secondary space-y-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-theme-text-primary text-sm font-semibold">Check contents</h2>
          <p className="text-theme-text-secondary text-sm" aria-live="polite">
            {target ? (
              <>
                Checking <span className="font-medium">{pathOf(target)}</span>
              </>
            ) : (
              'Scan a bag, box or bin label, then everything inside it.'
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close contents check"
          className="text-theme-text-muted hover:text-theme-text-primary rounded p-2"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <ScanCodeField
        viewportId="contents-check-scanner-viewport"
        label="Scan or type a container or item barcode"
        submitLabel="Check"
        onCode={handleCode}
      />

      {message && (
        <p role="status" className="text-sm text-red-700 dark:text-red-400">
          {message}
        </p>
      )}

      {target && loading && (
        <p className="text-theme-text-muted inline-flex items-center gap-1.5 text-sm">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading what should be in here…
        </p>
      )}
      {loadError && <p className="text-sm text-red-700 dark:text-red-400">{loadError}</p>}

      {target && !loading && !loadError && (
        <div className="space-y-2 text-sm">
          <p className="text-theme-text-primary inline-flex items-center gap-1.5 font-medium" aria-live="polite">
            <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            {formatNumber(found)} of {formatNumber(onHand.length)} found
          </p>
          {truncated && (
            <p className="text-amber-800 dark:text-amber-300">
              This container holds more than {formatNumber(MAX_LABEL_BATCH)} items in one place; only the first{' '}
              {formatNumber(MAX_LABEL_BATCH)} of those are checked.
            </p>
          )}

          {missing.length > 0 && seen.size > 0 && (
            <details open>
              <summary className="text-theme-text-primary cursor-pointer">
                Not scanned yet ({formatNumber(missing.length)})
              </summary>
              <ul className="text-theme-text-secondary mt-1 max-h-48 list-disc overflow-y-auto pl-5">
                {missing.map((item) => (
                  <li key={item.id}>
                    {item.name}
                    {item.storage_area_id && item.storage_area_id !== target.id && (
                      <span className="text-theme-text-muted"> — {areaName(item.storage_area_id)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {strays.length > 0 && (
            <div>
              <p className="text-theme-text-primary">Doesn’t belong here ({formatNumber(strays.length)})</p>
              <ul className="text-theme-text-secondary mt-1 list-disc pl-5">
                {strays.map((s) => (
                  <li key={s.id}>
                    {s.name} <span className="text-theme-text-muted">— recorded in {areaName(s.areaId)}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => void fileStrays()}
                disabled={filing}
                className="btn-secondary btn-sm mt-2 inline-flex items-center gap-1.5"
              >
                {filing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                File {strays.length === 1 ? 'it' : `these ${formatNumber(strays.length)}`} here
              </button>
            </div>
          )}

          {contradicted.length > 0 && (
            <div>
              <p className="text-theme-text-primary">Here, but the record disagrees</p>
              <ul className="mt-1 list-disc pl-5 text-amber-800 dark:text-amber-300">
                {contradicted.map((item) => (
                  <li key={item.id}>
                    {item.name}: recorded as {getStatusLabel(item.status).toLowerCase()}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {away.length > 0 && (
            <p className="text-theme-text-muted">
              Not counted:{' '}
              {away.map((item) => `${item.name} (${getStatusLabel(item.status).toLowerCase()})`).join(', ')}
            </p>
          )}

          {seen.size > 0 && (
            <button type="button" onClick={startOver} className="btn-secondary btn-sm">
              Start over
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ContentsCheckPanel;
