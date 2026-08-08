/**
 * Platoon Roster Panel
 *
 * Manager tool to assign members to duty platoons in one place. Platoon is a
 * per-member attribute (User.platoon); shift pattern generation pulls current
 * membership from here, so this is the single source of truth for who is on
 * which platoon. Saving requires the members.manage permission.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Search, Save, Users } from 'lucide-react';
import { userService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { UserStatus } from '../../../constants/enums';

interface RosterRow {
  id: string;
  name: string;
  platoon: string;
}

const BASE_PLATOONS = ['A', 'B', 'C', 'D'];

const selectCls =
  'bg-theme-input-bg border border-theme-input-border rounded-lg px-2.5 py-1.5 text-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-violet-500';

export const PlatoonRosterPanel: React.FC = () => {
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const users = await userService.getUsers();
      const mapped: RosterRow[] = users
        .filter((u) => u.status === UserStatus.ACTIVE)
        .map((u) => ({
          id: String(u.id),
          name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || String(u.email || u.id),
          platoon: u.platoon || '',
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setRows(mapped);
      setOriginal(Object.fromEntries(mapped.map((r) => [r.id, r.platoon])));
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load members'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setPlatoon = (id: string, platoon: string) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, platoon } : r)));

  const changed = useMemo(() => rows.filter((r) => r.platoon !== (original[r.id] ?? '')), [rows, original]);

  // Platoon options: A–D plus any custom values already in use.
  const platoonOptions = useMemo(
    () => Array.from(new Set([...BASE_PLATOONS, ...rows.map((r) => r.platoon).filter(Boolean)])),
    [rows]
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    rows.forEach((r) => {
      if (r.platoon) c[r.platoon] = (c[r.platoon] || 0) + 1;
    });
    return c;
  }, [rows]);

  const filtered = useMemo(
    () => rows.filter((r) => r.name.toLowerCase().includes(search.toLowerCase())),
    [rows, search]
  );

  const handleSave = async () => {
    if (changed.length === 0) return;
    setSaving(true);
    let ok = 0;
    let failed = 0;
    for (const row of changed) {
      try {
        // Send the value directly: an empty string clears the platoon.
        await userService.updateUserProfile(row.id, { platoon: row.platoon });
        ok++;
      } catch {
        failed++;
      }
    }
    if (ok > 0) toast.success(`Updated ${ok} member${ok === 1 ? '' : 's'}`);
    if (failed > 0) toast.error(`${failed} update${failed === 1 ? '' : 's'} failed`);
    await load();
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
        <span className="sr-only">Loading members…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-theme-text-primary flex items-center gap-1.5 text-sm font-semibold">
          <Users className="h-4 w-4" /> Platoon Roster
        </h3>
        <p className="text-theme-text-muted mt-1 text-xs">
          Assign each member to a duty platoon. Shift rotations staff their shifts from these assignments, so changes
          flow into future generated shifts automatically.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {platoonOptions.map((p) => (
          <span
            key={p}
            className="text-theme-text-secondary rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[11px]"
          >
            Platoon {p}: {counts[p] || 0}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members…"
            className="bg-theme-input-bg border-theme-input-border text-theme-text-primary placeholder-theme-text-muted w-full rounded-lg border py-2 pr-3 pl-9 text-sm focus:ring-2 focus:ring-violet-500 focus:outline-hidden"
          />
        </div>
        <button
          onClick={() => {
            void handleSave();
          }}
          disabled={saving || changed.length === 0}
          className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save{changed.length > 0 ? ` (${changed.length})` : ''}
        </button>
      </div>

      <div className="max-h-[28rem] space-y-1.5 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <p className="text-theme-text-muted py-6 text-center text-sm">No members found.</p>
        ) : (
          filtered.map((row) => {
            const isChanged = row.platoon !== (original[row.id] ?? '');
            return (
              <div
                key={row.id}
                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                  isChanged ? 'border-violet-500/40 bg-violet-500/5' : 'border-theme-surface-border'
                }`}
              >
                <span className="text-theme-text-primary truncate text-sm">{row.name}</span>
                <select
                  value={row.platoon}
                  onChange={(e) => setPlatoon(row.id, e.target.value)}
                  className={selectCls}
                  aria-label={`Platoon for ${row.name}`}
                >
                  <option value="">Unassigned</option>
                  {platoonOptions.map((p) => (
                    <option key={p} value={p}>
                      Platoon {p}
                    </option>
                  ))}
                </select>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
