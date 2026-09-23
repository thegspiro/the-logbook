/**
 * Choose a batch of inventory labels by filter rather than by ticking rows.
 *
 * Shown by the print page when it is opened with nothing selected — from the
 * setup page, a bookmark, or the sidebar — which used to be a dead end reading
 * "No items specified". The match count is fetched live so the quartermaster
 * sees how many labels a choice produces, and that it fits in one batch,
 * before committing to it.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { inventoryService, locationsService } from '../../../services/api';
import type { Location } from '../../../services/api';
import type { InventoryCategory, StorageAreaResponse } from '../types';
import { formatNumber } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { MAX_LABEL_BATCH } from '../utils/labelPrintQuery';
import type { LabelFilterParams } from '../utils/labelPrintQuery';

/** Mirrors the items list's own sentinel for "filed under no location". */
const UNASSIGNED_LOCATION = 'unassigned';

interface LabelScopePickerProps {
  onChoose: (filters: LabelFilterParams) => void;
}

/** "Engine 1 › Compartment L1" — a compartment name alone repeats across rigs. */
function storageAreaPaths(areas: StorageAreaResponse[]): Map<string, string> {
  const byId = new Map(areas.map((a) => [a.id, a]));
  const paths = new Map<string, string>();
  for (const area of areas) {
    const parts: string[] = [];
    const seen = new Set<string>();
    let cur: StorageAreaResponse | undefined = area;
    // `seen` bounds the walk: parent_id is client-visible data, and a cycle in
    // it must not hang the page.
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(cur.label || cur.name);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    paths.set(area.id, parts.join(' › '));
  }
  return paths;
}

export const LabelScopePicker: React.FC<LabelScopePickerProps> = ({ onChoose }) => {
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [areas, setAreas] = useState<StorageAreaResponse[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [areaId, setAreaId] = useState('');
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [countError, setCountError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Each list only narrows the choice, so one failing leaves the others
      // (and "every item") usable rather than blanking the picker.
      const [c, l, a] = await Promise.allSettled([
        inventoryService.getCategories(),
        locationsService.getLocations(),
        inventoryService.getStorageAreas({ flat: true }),
      ]);
      if (cancelled) return;
      if (c.status === 'fulfilled') setCategories(c.value);
      if (l.status === 'fulfilled') setLocations(l.value);
      if (a.status === 'fulfilled') setAreas(a.value);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filters = useMemo<LabelFilterParams>(
    () => ({
      category_id: categoryId || undefined,
      location_id: locationId && locationId !== UNASSIGNED_LOCATION ? locationId : undefined,
      unassigned_location: locationId === UNASSIGNED_LOCATION ? true : undefined,
      storage_area_id: areaId || undefined,
    }),
    [categoryId, locationId, areaId]
  );

  useEffect(() => {
    let cancelled = false;
    setMatchCount(null);
    setCountError(null);
    inventoryService
      .getItems({ ...filters, skip: 0, limit: 1 })
      .then((res) => {
        if (!cancelled) setMatchCount(res.total ?? 0);
      })
      .catch((err: unknown) => {
        if (!cancelled) setCountError(getErrorMessage(err, 'Could not count matching items'));
      });
    return () => {
      cancelled = true;
    };
  }, [filters]);

  const paths = useMemo(() => storageAreaPaths(areas), [areas]);
  // A storage area belongs to one location, so once a location is chosen only
  // its areas can match anything.
  const visibleAreas = useMemo(() => {
    const scoped =
      locationId && locationId !== UNASSIGNED_LOCATION ? areas.filter((a) => a.location_id === locationId) : areas;
    return [...scoped].sort((x, y) => (paths.get(x.id) ?? '').localeCompare(paths.get(y.id) ?? ''));
  }, [areas, locationId, paths]);

  const tooMany = matchCount !== null && matchCount > MAX_LABEL_BATCH;
  const canContinue = matchCount !== null && matchCount > 0 && !tooMany;

  return (
    <div className="mx-auto max-w-lg p-4 sm:p-6">
      <Link
        to="/inventory"
        className="text-theme-text-muted hover:text-theme-text-secondary mb-4 flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Inventory
      </Link>
      <div className="card p-4 sm:p-6">
        <h1 className="text-theme-text-primary mb-1 text-lg font-semibold">Print barcode labels</h1>
        <p className="text-theme-text-secondary mb-4 text-sm">
          Choose which items to label. Leave everything on &ldquo;All&rdquo; to print every active item. To pick
          individual items, tick them on the inventory list instead.
        </p>

        <div className="space-y-3">
          <div>
            <label htmlFor="label-scope-category" className="form-label">
              Category
            </label>
            <select
              id="label-scope-category"
              className="form-input"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="label-scope-location" className="form-label">
              Location
            </label>
            <select
              id="label-scope-location"
              className="form-input"
              value={locationId}
              onChange={(e) => {
                setLocationId(e.target.value);
                // An area from the previous location can never match the new one.
                setAreaId('');
              }}
            >
              <option value="">All locations</option>
              <option value={UNASSIGNED_LOCATION}>Unassigned</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          {visibleAreas.length > 0 && locationId !== UNASSIGNED_LOCATION && (
            <div>
              <label htmlFor="label-scope-area" className="form-label">
                Storage area
              </label>
              <select
                id="label-scope-area"
                className="form-input"
                value={areaId}
                onChange={(e) => setAreaId(e.target.value)}
              >
                <option value="">All storage areas</option>
                {visibleAreas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {paths.get(a.id) ?? a.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="mt-4 text-sm" aria-live="polite">
          {countError ? (
            <p className="text-red-700 dark:text-red-400">{countError}</p>
          ) : matchCount === null ? (
            <p className="text-theme-text-muted inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Counting items…
            </p>
          ) : matchCount === 0 ? (
            <p className="text-theme-text-secondary">No active items match.</p>
          ) : tooMany ? (
            <p className="text-amber-800 dark:text-amber-300">
              {formatNumber(matchCount)} items match. One batch holds at most {formatNumber(MAX_LABEL_BATCH)} — narrow
              it by category, location or storage area.
            </p>
          ) : (
            <p className="text-theme-text-secondary">
              {formatNumber(matchCount)} {matchCount === 1 ? 'item matches' : 'items match'}.
            </p>
          )}
        </div>

        <button
          type="button"
          className="btn-primary btn-md mt-4 inline-flex w-full items-center justify-center gap-2 sm:w-auto"
          disabled={!canContinue}
          onClick={() => onChoose(filters)}
        >
          <Printer className="h-4 w-4" />
          {matchCount !== null && canContinue
            ? `Prepare ${formatNumber(matchCount)} ${matchCount === 1 ? 'label' : 'labels'}`
            : 'Prepare labels'}
        </button>
      </div>
    </div>
  );
};

export default LabelScopePicker;
