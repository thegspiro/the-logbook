import type { Role } from '../types/role';
import { PositionKind } from '../constants/enums';

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

type KindAware = Pick<Role, 'mirrors_rank' | 'kind'>;

/** Whether a position is a committee rather than an office. */
export const isCommittee = (position: KindAware): boolean => position.kind === PositionKind.COMMITTEE;

/**
 * A member's positions as the profile and the roster show them: offices and
 * committees apart, with the rank mirrors and the platform's own `member`
 * position (held by everyone) left out of both. A position with no `kind`
 * -- a row from before the column existed -- is an office.
 */
export const groupPositionsByKind = <T extends KindAware & Pick<Role, 'slug'>>(
  positions: readonly T[]
): { offices: T[]; committees: T[] } => {
  const shown = withoutRankMirrors(positions).filter((p) => p.kind !== PositionKind.SYSTEM || p.slug !== 'member');
  return {
    offices: shown.filter((p) => !isCommittee(p)),
    committees: shown.filter(isCommittee),
  };
};
