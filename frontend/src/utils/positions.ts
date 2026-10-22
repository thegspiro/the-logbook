import type { Role } from '../types/role';

type RankMirrorAware = Pick<Role, 'mirrors_rank'>;

/**
 * Whether a position is the seeded mirror of an operational rank.
 *
 * Onboarding seeds Chief, Captain, Firefighter and the other ranks as
 * positions too, because the rank registry lends those positions its
 * permission lists. A member who holds the rank gains nothing from also
 * holding the position, and offering "Firefighter" in the position picker
 * beside "Firefighter" in the rank picker is how the same word came to appear
 * in two roster columns. The server decides which positions these are
 * (`Position.mirrors_rank`); this only reads its answer.
 */
export const mirrorsRank = (position: RankMirrorAware): boolean => position.mirrors_rank === true;

/**
 * The positions a member screen offers or displays: everything except the
 * rank mirrors. The positions settings screen does not use this — it lists
 * every position, because that is where the mirrors' stored grants are edited.
 */
export const withoutRankMirrors = <T extends RankMirrorAware>(positions: readonly T[]): T[] =>
  positions.filter((position) => !mirrorsRank(position));
