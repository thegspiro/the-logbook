/**
 * Platoon Management Page
 *
 * Department-wide view of every platoon and its members, with a bulk-assign
 * tool to move members between platoons (or clear their assignment). Platoon
 * membership is a per-member attribute; this page is the manager's roster view
 * on top of it.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import { ArrowLeft, Users, Loader2, ShieldAlert } from 'lucide-react';
import { schedulingService, type PlatoonOverview } from '../../modules/scheduling/services/api';
import { getErrorMessage } from '../../utils/errorHandling';

// Standard platoon labels offered in the assign dropdown, merged with any
// platoons already present in the org.
const STANDARD_PLATOONS = ['A', 'B', 'C', 'D'];

const SchedulingPlatoonsPage: React.FC = () => {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<PlatoonOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<string>('A');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await schedulingService.getPlatoonOverview();
      setOverview(data);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load platoons'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const platoonOptions = useMemo(() => {
    const present = (overview?.groups || []).map((g) => g.platoon).filter((p): p is string => !!p);
    return Array.from(new Set([...STANDARD_PLATOONS, ...present])).sort((a, b) =>
      a.toUpperCase().localeCompare(b.toUpperCase())
    );
  }, [overview]);

  const toggle = (userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const assign = async (platoon: string | null) => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      const res = await schedulingService.bulkAssignPlatoon([...selected], platoon);
      toast.success(
        platoon
          ? `Assigned ${res.updated} member${res.updated === 1 ? '' : 's'} to ${platoon}`
          : `Cleared platoon for ${res.updated} member${res.updated === 1 ? '' : 's'}`
      );
      setSelected(new Set());
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update platoons'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-theme-bg min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={() => void navigate('/scheduling')}
            className="hover:bg-theme-surface-hover text-theme-text-muted rounded-lg p-1.5"
            aria-label="Back to scheduling"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-violet-500" />
            <h1 className="text-theme-text-primary text-xl font-bold">Platoon Management</h1>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
            <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
          </div>
        ) : !overview ? null : (
          <>
            {!overview.platoons_enabled && (
              <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="text-sm text-amber-700 dark:text-amber-400">
                  Platoon scheduling is turned off for your department. You can still assign members here, but platoon
                  features won't appear until you enable it in{' '}
                  <button
                    onClick={() => void navigate('/scheduling/settings?tab=platoons')}
                    className="font-medium underline"
                  >
                    Scheduling Settings
                  </button>
                  .
                </div>
              </div>
            )}

            {/* Bulk-assign toolbar */}
            <div className="bg-theme-surface border-theme-surface-border mb-6 flex flex-wrap items-center gap-3 rounded-lg border p-4">
              <span className="text-theme-text-secondary text-sm">{selected.size} selected</span>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                disabled={saving || selected.size === 0}
                className="bg-theme-input-bg border-theme-input-border text-theme-text-primary rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:outline-hidden disabled:opacity-50"
              >
                {platoonOptions.map((p) => (
                  <option key={p} value={p}>
                    Platoon {p}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void assign(target)}
                disabled={saving || selected.size === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Assign to platoon
              </button>
              <button
                onClick={() => void assign(null)}
                disabled={saving || selected.size === 0}
                className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
              >
                Clear platoon
              </button>
            </div>

            {/* Platoon group cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {overview.groups.map((group) => {
                const key = group.platoon ?? '__unassigned__';
                return (
                  <div
                    key={key}
                    className="bg-theme-surface border-theme-surface-border overflow-hidden rounded-lg border"
                  >
                    <div className="border-theme-surface-border flex items-center justify-between border-b px-4 py-3">
                      <h2 className="text-theme-text-primary font-semibold">
                        {group.platoon ? `Platoon ${group.platoon}` : 'Unassigned'}
                      </h2>
                      <span className="text-theme-text-muted text-xs">
                        {group.member_count} member{group.member_count === 1 ? '' : 's'}
                      </span>
                    </div>
                    {group.members.length === 0 ? (
                      <p className="text-theme-text-muted px-4 py-6 text-center text-sm">No members</p>
                    ) : (
                      <ul className="divide-theme-surface-border divide-y">
                        {group.members.map((m) => (
                          <li key={m.user_id}>
                            <label className="hover:bg-theme-surface-hover flex cursor-pointer items-center gap-3 px-4 py-2.5">
                              <input
                                type="checkbox"
                                checked={selected.has(m.user_id)}
                                onChange={() => toggle(m.user_id)}
                                className="form-checkbox border-theme-surface-border"
                              />
                              <span className="text-theme-text-primary text-sm">{m.user_name}</span>
                              {m.rank && <span className="text-theme-text-muted ml-auto text-xs">{m.rank}</span>}
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default SchedulingPlatoonsPage;
