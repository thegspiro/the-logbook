import type { AttendeeEntry } from '../types/minutes';

/** Members on the roll who can make a motion, each name once. */
export const motionMakers = (attendees: AttendeeEntry[]): string[] => {
  const names: string[] = [];
  for (const a of attendees) {
    const here = a.status ? ['present', 'late', 'left_early'].includes(a.status) : a.present;
    const name = a.name.trim();
    if (here && name && !names.includes(name)) names.push(name);
  }
  return names;
};
