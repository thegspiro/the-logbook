import type { CrewUnit } from '../../../types/apparatusEvent';

/** "Elf 1", "Elf 2" where a name repeats on one apparatus; "Santa" alone. */
export const seatLabels = (unit: CrewUnit): Map<string, string> => {
  const totals = new Map<string, number>();
  unit.seats.forEach((s) => totals.set(s.name, (totals.get(s.name) ?? 0) + 1));
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  unit.seats.forEach((s) => {
    const n = (seen.get(s.name) ?? 0) + 1;
    seen.set(s.name, n);
    labels.set(s.id, (totals.get(s.name) ?? 0) > 1 ? `${s.name} ${n}` : s.name);
  });
  return labels;
};
