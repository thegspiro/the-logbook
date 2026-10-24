/**
 * NFC Tag Register — `/inventory/admin/nfc/tags`.
 *
 * Every NFC tag the department has stuck on something, in one list: tags on
 * items, on storage areas and on equipment-check compartments. The
 * quartermaster marks tags lost or found (one at a time or a selection), moves
 * a tag that was linked to the wrong target, unlinks one so it can be reused,
 * and downloads the register as a CSV.
 *
 * Compartment tags are here too, by the owner's decision: the quartermaster
 * keeps the register of every tag, though a checklist builder still links them
 * from the checklist. A checklist manager without `inventory.manage` opens the
 * same page limited to compartment tags; the server applies that limit, and
 * this page only stops offering what it would refuse. Items without a tag are
 * on the Tag Items in Bulk page.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ArrowRightLeft, Download, Loader2, Nfc, Search, Tags, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { inventoryService } from '../../../services/api';
import { useTimezone } from '../../../hooks/useTimezone';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useAuthStore } from '../../../stores/authStore';
import { Breadcrumbs } from '../../../components/ux';
import { EmptyState } from '../../../components/ux/EmptyState';
import { Pagination } from '../../../components/ux/Pagination';
import { InventoryNfcTagKind, InventoryNfcTagStatus } from '../../../constants/enums';
import { formatDateTime, getTodayLocalDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useInventoryNfcEnabled } from '../hooks/useInventoryNfcEnabled';
import { MoveNfcTagDialog } from '../components/MoveNfcTagDialog';
import type { InventoryNfcRegisterFilters, InventoryNfcRegisterTag } from '../types/nfc';

const PAGE_SIZE = 50;

const KIND_LABELS: Record<InventoryNfcTagKind, string> = {
  item: 'Item',
  storage_area: 'Storage area',
  compartment: 'Compartment',
};

const LOST_BADGE = 'badge bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100';

const TargetName: React.FC<{ tag: InventoryNfcRegisterTag }> = ({ tag }) => {
  const name = tag.target_name ?? 'Unknown';
  if (tag.kind === InventoryNfcTagKind.ITEM && tag.item_id) {
    return (
      <Link to={`/inventory/items/${tag.item_id}`} className="text-theme-text-primary font-medium hover:underline">
        {name}
      </Link>
    );
  }
  return <span className="text-theme-text-primary font-medium">{name}</span>;
};

export const InventoryNfcRegisterPage: React.FC = () => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const { enabled, loading: loadingSwitch } = useInventoryNfcEnabled();
  const checkPermission = useAuthStore((s) => s.checkPermission);
  const seesEveryKind = checkPermission('inventory.manage');

  const [kind, setKind] = useState<InventoryNfcTagKind | ''>('');
  const [status, setStatus] = useState<InventoryNfcTagStatus | ''>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [tags, setTags] = useState<InventoryNfcRegisterTag[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [moving, setMoving] = useState<InventoryNfcRegisterTag | null>(null);
  // A filter change reloads the old page and then page 1; only the latest
  // request's answer may reach the table.
  const requestSeq = useRef(0);

  const filters = useCallback(
    (): InventoryNfcRegisterFilters => ({
      kind: seesEveryKind ? kind || undefined : InventoryNfcTagKind.COMPARTMENT,
      status: status || undefined,
      search: search.trim() || undefined,
    }),
    [kind, status, search, seesEveryKind]
  );

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [kind, status, search]);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const data = await inventoryService.getNfcRegister(filters(), PAGE_SIZE, (page - 1) * PAGE_SIZE);
      if (seq !== requestSeq.current) return;
      setTags(data.items);
      setTotal(data.total);
    } catch (err: unknown) {
      if (seq !== requestSeq.current) return;
      setError(getErrorMessage(err, 'Could not load the tag register.'));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  const allVisibleSelected = tags.length > 0 && tags.every((t) => selected.has(t.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) tags.forEach((t) => next.delete(t.id));
      else tags.forEach((t) => next.add(t.id));
      return next;
    });

  const applyStatus = async (ids: string[], next: InventoryNfcTagStatus) => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const result = await inventoryService.bulkUpdateNfcTagStatus(ids, next);
      const verb = next === InventoryNfcTagStatus.LOST ? 'marked lost' : 'back in service';
      if (result.updated.length > 0) {
        toast.success(result.updated.length === 1 ? `1 tag ${verb}` : `${result.updated.length} tags ${verb}`);
      }
      if (result.failed.length > 0) {
        toast.error(
          result.failed.length === 1
            ? '1 tag was not changed; it may have been unlinked.'
            : `${result.failed.length} tags were not changed; they may have been unlinked.`
        );
      }
      setSelected(new Set());
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not update these tags.'));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (tag: InventoryNfcRegisterTag) => {
    const ok = await confirm({
      title: 'Unlink this NFC tag?',
      message: `Tapping tag …${tag.uid_preview} will no longer find ${tag.target_name ?? 'what it was linked to'}. The tag itself is not erased, and can be linked again elsewhere.`,
      confirmLabel: 'Unlink tag',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    try {
      await inventoryService.unlinkNfcTag(tag.id);
      toast.success('Tag unlinked');
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(tag.id);
        return next;
      });
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not unlink the tag.'));
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await inventoryService.exportNfcRegister(filters());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `inventory-nfc-tags-${getTodayLocalDate(tz)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('CSV exported');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not export the register.'));
    } finally {
      setExporting(false);
    }
  };

  if (loadingSwitch) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-label="Loading" />
      </div>
    );
  }

  const selectedIds = Array.from(selected);
  const filtered = Boolean(kind || status || search.trim());

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6">
      <Breadcrumbs />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
            <Nfc className="h-5 w-5" aria-hidden="true" /> NFC Tag Register
          </h1>
          <p className="text-theme-text-secondary mt-1 text-sm">
            {seesEveryKind
              ? 'Every NFC tag on an item, a storage area or a checklist compartment.'
              : 'Every NFC tag on a checklist compartment. Item and shelf tags are the quartermaster’s.'}{' '}
            Mark tags lost or found, move one linked to the wrong place, or unlink one to reuse it.
          </p>
        </div>
        {enabled && seesEveryKind && (
          <Link to="/inventory/admin/nfc/enroll" className="btn-secondary btn-auto inline-flex items-center gap-2">
            <Tags className="h-4 w-4" aria-hidden="true" /> Tag items in bulk
          </Link>
        )}
      </header>

      {!enabled ? (
        <div className="alert-warning" role="status">
          NFC tag tracking is turned off for your department. An administrator can turn it on under{' '}
          <Link to="/inventory/admin/nfc" className="underline">
            NFC Tags
          </Link>{' '}
          first.
        </div>
      ) : (
        <>
          <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {seesEveryKind && (
              <div>
                <label htmlFor="nfc-register-kind" className="form-label">
                  Tagged
                </label>
                <select
                  id="nfc-register-kind"
                  className="form-input"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as InventoryNfcTagKind | '')}
                >
                  <option value="">Everything</option>
                  <option value={InventoryNfcTagKind.ITEM}>Items</option>
                  <option value={InventoryNfcTagKind.STORAGE_AREA}>Storage areas</option>
                  <option value={InventoryNfcTagKind.COMPARTMENT}>Compartments</option>
                </select>
              </div>
            )}
            <div>
              <label htmlFor="nfc-register-status" className="form-label">
                Status
              </label>
              <select
                id="nfc-register-status"
                className="form-input"
                value={status}
                onChange={(e) => setStatus(e.target.value as InventoryNfcTagStatus | '')}
              >
                <option value="">Active and lost</option>
                <option value={InventoryNfcTagStatus.ACTIVE}>Active</option>
                <option value={InventoryNfcTagStatus.LOST}>Lost</option>
              </select>
            </div>
            <form
              className="flex gap-2 lg:col-span-2"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(searchInput);
              }}
            >
              <div className="flex-1">
                <label htmlFor="nfc-register-search" className="form-label">
                  Search
                </label>
                <input
                  id="nfc-register-search"
                  className="form-input"
                  placeholder="Item, shelf, checklist or label"
                  value={searchInput}
                  maxLength={100}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              <button type="submit" className="btn-secondary btn-auto self-end" aria-label="Search tags">
                <Search className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn-secondary btn-auto inline-flex items-center gap-2 self-end"
                onClick={() => void exportCsv()}
                disabled={exporting || loading || total === 0}
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="h-4 w-4" aria-hidden="true" />
                )}
                CSV
              </button>
            </form>
          </div>

          {selected.size > 0 && (
            <div
              className="card flex flex-wrap items-center gap-2 p-3"
              role="region"
              aria-label="Actions for selected tags"
            >
              <span className="text-theme-text-primary mr-2 text-sm font-medium">{selected.size} selected</span>
              <button
                type="button"
                className="btn-secondary btn-auto"
                disabled={busy}
                onClick={() => void applyStatus(selectedIds, InventoryNfcTagStatus.LOST)}
              >
                Mark lost
              </button>
              <button
                type="button"
                className="btn-secondary btn-auto"
                disabled={busy}
                onClick={() => void applyStatus(selectedIds, InventoryNfcTagStatus.ACTIVE)}
              >
                Mark found
              </button>
              <button
                type="button"
                className="text-theme-text-secondary ml-auto text-sm underline"
                onClick={() => setSelected(new Set())}
              >
                Clear selection
              </button>
            </div>
          )}

          {error && (
            <div className="alert-danger flex items-start gap-2" role="alert">
              <AlertTriangle className="text-theme-alert-danger-icon mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p className="text-theme-alert-danger-text text-sm">{error}</p>
            </div>
          )}

          {!loading && !error && tags.length === 0 && (
            <div className="card p-4">
              <EmptyState
                headingLevel={2}
                icon={Nfc}
                title={filtered ? 'No tags match these filters' : 'No NFC tags linked yet'}
                description={
                  filtered
                    ? 'Clear the search or choose a different kind or status.'
                    : 'Link tags from an item, a storage area or a checklist compartment, or tag items in bulk.'
                }
              />
            </div>
          )}

          {tags.length > 0 && (
            <div className="card overflow-hidden">
              <table className="rwd-table w-full text-sm">
                <thead>
                  <tr className="text-theme-text-secondary text-left">
                    <th className="w-10 p-3">
                      <input
                        type="checkbox"
                        className="form-checkbox"
                        aria-label="Select every tag shown"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                      />
                    </th>
                    <th className="p-3">Tagged</th>
                    <th className="p-3">Tag</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Last tapped</th>
                    <th className="p-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-theme-surface-border divide-y">
                  {tags.map((tag) => {
                    const lost = tag.status === InventoryNfcTagStatus.LOST;
                    return (
                      <tr key={tag.id}>
                        <td className="p-3" data-label="Select">
                          <input
                            type="checkbox"
                            className="form-checkbox"
                            aria-label={`Select tag ending ${tag.uid_preview}`}
                            checked={selected.has(tag.id)}
                            onChange={() => toggle(tag.id)}
                          />
                        </td>
                        <td className="p-3" data-label="Tagged">
                          <TargetName tag={tag} />
                          <div className="text-theme-text-secondary text-xs">
                            {[KIND_LABELS[tag.kind], tag.template_name].filter(Boolean).join(' · ')}
                          </div>
                        </td>
                        <td className="p-3" data-label="Tag">
                          <span className="text-theme-text-primary">{tag.label || 'Unlabelled tag'}</span>{' '}
                          <span className="text-theme-text-secondary font-mono">…{tag.uid_preview}</span>
                          <div className="text-theme-text-secondary text-xs">
                            Linked {formatDateTime(tag.linked_at, tz)}
                            {tag.linked_by_name ? ` by ${tag.linked_by_name}` : ''}
                          </div>
                        </td>
                        <td className="p-3" data-label="Status">
                          {lost ? (
                            <span className={LOST_BADGE}>Lost</span>
                          ) : (
                            <span className="text-theme-text-primary">Active</span>
                          )}
                        </td>
                        <td className="text-theme-text-primary p-3" data-label="Last tapped">
                          {tag.last_scanned_at
                            ? formatDateTime(tag.last_scanned_at, tz)
                            : tag.kind === InventoryNfcTagKind.ITEM
                              ? 'Never'
                              : 'Not recorded'}
                        </td>
                        <td className="p-3" data-label="Actions">
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              aria-label={`${lost ? 'Mark found' : 'Mark lost'}: tag …${tag.uid_preview}`}
                              disabled={busy}
                              onClick={() =>
                                void applyStatus(
                                  [tag.id],
                                  lost ? InventoryNfcTagStatus.ACTIVE : InventoryNfcTagStatus.LOST
                                )
                              }
                            >
                              {lost ? 'Mark found' : 'Mark lost'}
                            </button>
                            <button
                              type="button"
                              className="btn-secondary btn-sm inline-flex items-center gap-1"
                              aria-label={`Move tag …${tag.uid_preview}`}
                              onClick={() => setMoving(tag)}
                            >
                              <ArrowRightLeft className="h-4 w-4" aria-hidden="true" /> Move
                            </button>
                            <button
                              type="button"
                              className="btn-secondary btn-sm inline-flex items-center gap-1"
                              aria-label={`Unlink tag …${tag.uid_preview}`}
                              onClick={() => void unlink(tag)}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" /> Unlink
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {total > PAGE_SIZE && (
            <Pagination currentPage={page} totalItems={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
          )}
          <p className="text-theme-text-secondary text-xs">
            Last tapped is recorded for item tags only: a tap on a shelf or compartment tag moves or opens something
            without naming the tag.
          </p>
        </>
      )}

      <MoveNfcTagDialog
        tag={moving}
        onClose={() => setMoving(null)}
        onMoved={() => {
          setMoving(null);
          void load();
        }}
      />
    </div>
  );
};

export default InventoryNfcRegisterPage;
