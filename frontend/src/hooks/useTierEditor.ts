import { useCallback, useEffect, useRef, useState } from 'react';
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
  // Distinct from `failed`, and deliberately so. `failed` means the ladder on
  // screen cannot be trusted, and the section replaces the editor with a panel.
  // This one means the write landed but the read back did not, so the ladder is
  // right and the member counts beside it may not be — a warning to show above
  // a working editor, never a reason to take the editor away or to block the
  // step.
  const [refreshFailed, setRefreshFailed] = useState(false);
  // Whether a PUT has been accepted since the last read that confirmed it. It
  // is what lets the warning say "your tiers were saved" only when they were —
  // a re-read that fails for any other reason gets the plainer wording.
  const [unconfirmedSave, setUnconfirmedSave] = useState(false);
  // `fetchConfig` is deliberately identity-stable (it is a mount-effect
  // dependency), so it cannot close over `config`. This is how its catch knows
  // whether there is already a ladder worth keeping on screen.
  const configRef = useRef<MembershipTierConfig | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  /** Resolves true when the ladder was read, false when the read failed. */
  const fetchConfig = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    try {
      const data = await memberStatusService.getTierConfig();
      // A ladder is only meaningful in order, and `sort_order` is what the
      // backend advances along — not array position.
      const loaded = {
        ...data,
        tiers: [...(data.tiers ?? [])].sort((a, b) => a.sort_order - b.sort_order),
      };
      configRef.current = loaded;
      setConfig(loaded);
      setFailed(false);
      setRefreshFailed(false);
      setUnconfirmedSave(false);
      // A ladder the backend synthesized rather than read is *proposed*, not in
      // effect: `MembershipTierService._load_tiers` still sees nothing stored,
      // so advancement does not run and no benefit applies. Opening dirty is
      // what makes Save the obvious next action instead of leaving a department
      // looking at settings no reader honours.
      setDirty(data.is_saved === false);
      return true;
    } catch {
      // A failed load is not an empty ladder. Rendering "no tiers configured"
      // would tell a department it has no membership structure because a
      // request failed, and inviting them to build one from scratch here would
      // then remove the rungs their members are standing on.
      //
      // But that panel replaces the editor and says nothing has changed, which
      // is only true when there is nothing on screen to lose. Once a ladder has
      // been read — or stored by a save whose read-back failed — a later failed
      // read is a stale screen, not an absent one, and taking the ladder away
      // to say so is the worse of the two reports. Every retry after a failed
      // post-save refresh lands here.
      if (configRef.current) {
        setRefreshFailed(true);
      } else {
        setFailed(true);
      }
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // The ladder on screen is one the backend synthesized, not one it stored:
  // `MembershipTierService._load_tiers` still reads nothing, so nothing
  // advances and no benefit applies. It is why the editor opens dirty — and
  // why Discard cannot resolve that: reloading re-proposes the same defaults
  // and sets `dirty` straight back, so a step guarding on `dirty` would name an
  // action that provably does not satisfy it. Only Save does.
  const neverSaved = config?.is_saved === false;

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
      // Both are reports about the roster and about storage, not config.
      const { member_counts: _counts, is_saved: _isSaved, ...payload } = config;
      await memberStatusService.updateTierConfig(payload);
      // Cleared here rather than left to the refresh below. `fetchConfig`
      // swallows its own failure, so a read that fails after an accepted PUT
      // leaves `dirty` true — and the section has by then swapped its Save
      // button for the failure panel, so the step's Continue guard goes on
      // refusing an edit the administrator has no control left to save. The
      // write was accepted; the ladder on screen is the stored one.
      setDirty(false);
      // Recorded before the refresh is attempted, so a read that fails knows a
      // write was accepted and the warning can say so.
      configRef.current = { ...config, is_saved: true };
      setUnconfirmedSave(true);
      toast.success('Membership tiers saved');
      if (!(await fetchConfig())) {
        // Reported as its own state rather than through `failed`. That panel
        // says "could not be loaded — nothing has changed", which after an
        // accepted PUT is untrue and takes away the editor showing the ladder
        // that was just stored. Discarding the error instead would be worse
        // again: the member counts on screen and any server-side normalisation
        // are unconfirmed, and only the success toast would say anything.
        setConfig((prev) => (prev ? { ...prev, is_saved: true } : prev));
      }
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
    refreshFailed,
    unconfirmedSave,
    neverSaved,
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
