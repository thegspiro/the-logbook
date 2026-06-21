/**
 * Platoon Management Page
 *
 * Department-wide view of every platoon and its members, with a bulk-assign
 * tool to move members between platoons (or clear their assignment). Platoon
 * membership is a per-member attribute; this page is the manager's roster view
 * on top of it.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Users, Loader2, ShieldAlert } from 'lucide-react';
import {
  schedulingService,
  type PlatoonOverview,
} from '../../modules/scheduling/services/api';
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
    const present = (overview?.groups || [])
      .map((g) => g.platoon)
      .filter((p): p is string => !!p);
    return Array.from(new Set([...STANDARD_PLATOONS, ...present])).sort((a, b) =>
      a.toUpperCase().localeCompare(b.toUpperCase()),
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
          : `Cleared platoon for ${res.updated} member${res.updated === 1 ? '' : 's'}`,
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
    <div className="min-h-screen bg-theme-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => void navigate('/scheduling')}
            className="p-1.5 rounded-lg hover:bg-theme-surface-hover text-theme-text-muted"
            aria-label="Back to scheduling"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-violet-500" />
            <h1 className="text-xl font-bold text-theme-text-primary">Platoon Management</h1>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
            <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
          </div>
        ) : !overview ? null : (
          <>
            {!overview.platoons_enabled && (
              <div className="mb-6 rounded-lg bg-amber-500/10 border border-amber-500/30 p-4 flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="text-sm text-amber-700 dark:text-amber-400">
                  Platoon scheduling is turned off for your department. You can still
                  assign members here, but platoon features won't appear until you
                  enable it in{' '}
                  <button
                    onClick={() => void navigate('/scheduling/settings?tab=platoons')}
                    className="underline font-medium"
                  >
                    Scheduling Settings
                  </button>
                  .
                </div>
              </div>
            )}

            {/* Bulk-assign toolbar */}
            <div className="mb-6 rounded-lg bg-theme-surface border border-theme-surface-border p-4 flex flex-wrap items-center gap-3">
              <span className="text-sm text-theme-text-secondary">
                {selected.size} selected
              </span>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                disabled={saving || selected.size === 0}
                className="bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-violet-500 disabled:opacity-50"
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
                className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />} Assign to platoon
              </button>
              <button
                onClick={() => void assign(null)}
                disabled={saving || selected.size === 0}
                className="px-4 py-2 text-sm border border-theme-surface-border text-theme-text-secondary rounded-lg hover:bg-theme-surface-hover disabled:opacity-50"
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
                    className="rounded-lg bg-theme-surface border border-theme-surface-border overflow-hidden"
                  >
                    <div className="px-4 py-3 border-b border-theme-surface-border flex items-center justify-between">
                      <h2 className="font-semibold text-theme-text-primary">
                        {group.platoon ? `Platoon ${group.platoon}` : 'Unassigned'}
                      </h2>
                      <span className="text-xs text-theme-text-muted">
                        {group.member_count} member{group.member_count === 1 ? '' : 's'}
                      </span>
                    </div>
                    {group.members.length === 0 ? (
                      <p className="px-4 py-6 text-sm text-theme-text-muted text-center">
                        No members
                      </p>
                    ) : (
                      <ul className="divide-y divide-theme-surface-border">
                        {group.members.map((m) => (
                          <li key={m.user_id}>
                            <label className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-theme-surface-hover">
                              <input
                                type="checkbox"
                                checked={selected.has(m.user_id)}
                                onChange={() => toggle(m.user_id)}
                                className="form-checkbox border-theme-surface-border"
                              />
                              <span className="text-sm text-theme-text-primary">
                                {m.user_name}
                              </span>
                              {m.rank && (
                                <span className="ml-auto text-xs text-theme-text-muted">
                                  {m.rank}
                                </span>
                              )}
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
