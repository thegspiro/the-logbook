import { useCallback, useState } from 'react';
import type { BallotItem } from '../../types/election';
import { emptyChoice, type ItemChoice } from './ballotChoices';

/**
 * Selection state for a ballot: one `ItemChoice` per item, every item
 * starting on Abstain. Shared by the emailed ballot and the in-app tab so a
 * selection behaves identically on both.
 */
export const useBallotChoices = () => {
  const [choices, setChoices] = useState<Record<string, ItemChoice>>({});

  const resetChoices = useCallback((items: BallotItem[]) => {
    const initial: Record<string, ItemChoice> = {};
    for (const item of items) {
      initial[item.id] = emptyChoice();
    }
    setChoices(initial);
  }, []);

  const updateChoice = useCallback((itemId: string, choice: string, writeInName?: string) => {
    // Picking any single-selection option clears multi-select / rank state
    setChoices((prev) => ({
      ...prev,
      [itemId]: {
        choice,
        write_in_name: writeInName !== undefined ? writeInName : prev[itemId]?.write_in_name || '',
        candidate_ids: [],
        ranks: {},
      },
    }));
  }, []);

  const updateWriteInName = useCallback((itemId: string, name: string) => {
    setChoices((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] ?? emptyChoice()),
        write_in_name: name,
      },
    }));
  }, []);

  /** Toggle a candidate in an approval / multi-vote item's checkbox list. */
  const toggleCandidate = useCallback((itemId: string, candidateId: string, maxSelections: number | null) => {
    setChoices((prev) => {
      const current = prev[itemId] ?? emptyChoice();
      const selected = current.candidate_ids.includes(candidateId)
        ? current.candidate_ids.filter((id) => id !== candidateId)
        : maxSelections !== null && current.candidate_ids.length >= maxSelections
          ? current.candidate_ids // at the cap — ignore (box is disabled anyway)
          : [...current.candidate_ids, candidateId];
      return {
        ...prev,
        [itemId]: { ...current, choice: '', candidate_ids: selected, ranks: {} },
      };
    });
  }, []);

  /** Assign a rank to a candidate; a rank held by another candidate is freed. */
  const setCandidateRank = useCallback((itemId: string, candidateId: string, rank: number | null) => {
    setChoices((prev) => {
      const current = prev[itemId] ?? emptyChoice();
      const ranks: Record<string, number> = {};
      for (const [cid, r] of Object.entries(current.ranks)) {
        if (cid !== candidateId && r !== rank) ranks[cid] = r;
      }
      if (rank !== null) ranks[candidateId] = rank;
      return {
        ...prev,
        [itemId]: { ...current, choice: '', candidate_ids: [], ranks },
      };
    });
  }, []);

  return { choices, resetChoices, updateChoice, updateWriteInName, toggleCandidate, setCandidateRank };
};
