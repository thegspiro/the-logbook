import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { memberStatusService } from '../services/api';
import type { MembershipTier, MembershipTierBenefits, MembershipTierConfig } from '../types/user';

/** A tier as the editor holds it while being edited. */
export type TierDraft = MembershipTier;

const DEFAULT_BENEFITS: MembershipTierBenefits = {
  voting_eligible: true,
  can_hold_office: true,
  voting_requires_meeting_attendance: false,
  voting_min_attendance_pct: 0,
  voting_attendance_period_months: 12,
  training_exempt: false,
};

/**
 * The membership tier ladder, and the state behind editing it.
 *
 * This ladder decides who is in the ballot electorate, who may hold office,
 * whether a member has to meet a meeting-attendance threshold to vote, and
 * whether they are exempt from training — and a scheduled task advances members
 * along it unattended. Until this hook existed it had a full API, three service
 * methods on this side with no callers, and no screen anywhere: a department
 * whose bylaws differed from the shipped Probationary/Active/Senior/Life ladder
 * found out at its first election.
 *
 * Edits are held locally and saved as one config, because that is what the
 * endpoint takes: the whole ladder in one PUT. A per-rung save would make a
 * half-applied ladder reachable, which is the state that quietly changes who
 * can vote.
 */
export function useTierEditor() {
  const [config, setConfig] = useState<MembershipTierConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await memberStatusService.getTierConfig();
      // A ladder is only meaningful in order, and `sort_order` is what the
      // backend advances along — not array position.
      setConfig({
        ...data,
        tiers: [...(data.tiers ?? [])].sort((a, b) => a.sort_order - b.sort_order),
      });
      setFailed(false);
      setDirty(false);
    } catch {
      // A failed load is not an empty ladder. Rendering "no tiers configured"
      // would tell a department it has no membership structure because a
      // request failed, and inviting them to build one from scratch here would
      // then remove the rungs their members are standing on.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const memberCount = useCallback((tierId: string) => config?.member_counts?.[tierId] ?? 0, [config]);

  const setAutoAdvance = useCallback((autoAdvance: boolean) => {
    setConfig((prev) => (prev ? { ...prev, auto_advance: autoAdvance } : prev));
    setDirty(true);
  }, []);

  const updateTier = useCallback((tierId: string, changes: Partial<TierDraft>) => {
    setConfig((prev) =>
      prev ? { ...prev, tiers: prev.tiers.map((t) => (t.id === tierId ? { ...t, ...changes } : t)) } : prev
    );
    setDirty(true);
  }, []);

  const updateBenefits = useCallback((tierId: string, changes: Partial<MembershipTierBenefits>) => {
    setConfig((prev) =>
      prev
        ? {
            ...prev,
            tiers: prev.tiers.map((t) => (t.id === tierId ? { ...t, benefits: { ...t.benefits, ...changes } } : t)),
          }
        : prev
    );
    setDirty(true);
  }, []);

  const addTier = useCallback(
    (name: string) => {
      if (!config) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      // The id is derived once, on creation, and never edited afterwards. It is
      // what `User.membership_type` stores and nothing cascades a change to it,
      // so an editable id is a rename that silently empties a rung.
      const id = trimmed
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
      if (!id) {
        toast.error('That name has no letters or numbers to build an identifier from');
        return;
      }
      // Checked here rather than inside the updater: a state updater must be
      // pure, and React is free to call it twice or not when it likes — so a
      // toast raised in one is a refusal the officer may never see.
      if (config.tiers.some((t) => t.id === id)) {
        toast.error(`A tier with the identifier "${id}" already exists`);
        return;
      }
      const nextOrder = config.tiers.reduce((max, t) => Math.max(max, t.sort_order), -1) + 1;
      setConfig((prev) =>
        prev
          ? {
              ...prev,
              tiers: [
                ...prev.tiers,
                { id, name: trimmed, years_required: 0, sort_order: nextOrder, benefits: { ...DEFAULT_BENEFITS } },
              ],
            }
          : prev
      );
      setDirty(true);
    },
    [config]
  );

  const removeTier = useCallback(
    (tierId: string) => {
      const held = memberCount(tierId);
      if (held > 0) {
        // The backend refuses this too, and says the same thing. Caught here as
        // well so the answer arrives before the rest of an edit is discarded.
        toast.error(
          `${held} ${held === 1 ? 'member holds' : 'members hold'} this tier. Move them to another tier first.`
        );
        return;
      }
      setConfig((prev) => (prev ? { ...prev, tiers: prev.tiers.filter((t) => t.id !== tierId) } : prev));
      setDirty(true);
    },
    [memberCount]
  );

  const moveTier = useCallback((index: number, direction: 'up' | 'down') => {
    setConfig((prev) => {
      if (!prev) return prev;
      const swapIndex = direction === 'up' ? index - 1 : index + 1;
      if (swapIndex < 0 || swapIndex >= prev.tiers.length) return prev;
      const tiers = [...prev.tiers];
      const a = tiers[index];
      const b = tiers[swapIndex];
      if (a === undefined || b === undefined) return prev;
      [tiers[index], tiers[swapIndex]] = [b, a];
      // Renumber from the new order: sort_order is the progression the backend
      // climbs, so leaving the old numbers behind would reorder the list on
      // screen and change nothing about who advances to what.
      return { ...prev, tiers: tiers.map((t, i) => ({ ...t, sort_order: i })) };
    });
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    try {
      const { member_counts: _counts, ...payload } = config;
      await memberStatusService.updateTierConfig(payload);
      toast.success('Membership tiers saved');
      await fetchConfig();
    } catch (err: unknown) {
      // The backend names the tier and how many members hold it when it
      // refuses a removal. A generic message would leave an officer with no
      // idea which rung is the problem.
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || 'Failed to save membership tiers');
    } finally {
      setSaving(false);
    }
  }, [config, fetchConfig]);

  return {
    config,
    tiers: config?.tiers ?? [],
    autoAdvance: config?.auto_advance ?? true,
    loading,
    failed,
    retry,
    saving,
    dirty,
    memberCount,
    setAutoAdvance,
    updateTier,
    updateBenefits,
    addTier,
    removeTier,
    moveTier,
    save,
    reload: fetchConfig,
  };
}
