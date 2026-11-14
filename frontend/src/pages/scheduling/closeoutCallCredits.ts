import type { MemberCallCredit } from '../../modules/scheduling/types';

/**
 * The server's ceiling on per-member call credits in one close-out
 * (`MAX_MEMBER_CALL_CREDITS` in `backend/app/schemas/scheduling.py`, SCH-19).
 */
export const MAX_MEMBER_CALL_CREDITS = 100;

/**
 * The credits a close-out sends, kept under the server's cap.
 *
 * A crew that fits sends every member, as the wizard always has. A larger one
 * (an event shift with a big turnout) sends only the members adjusted below the
 * apparatus count: the server credits anyone left out with that count, so the
 * result is the same and the request stays under the cap. More adjusted members
 * than the cap allows is refused here with a reason, rather than as a 422.
 */
export function boundMemberCallCredits(
  credits: MemberCallCredit[],
  total: number
): { credits: MemberCallCredit[]; error: string | null } {
  if (credits.length <= MAX_MEMBER_CALL_CREDITS) return { credits, error: null };
  const adjusted = credits.filter((c) => c.call_count !== total);
  if (adjusted.length <= MAX_MEMBER_CALL_CREDITS) return { credits: adjusted, error: null };
  return {
    credits: [],
    error:
      `A close-out can adjust the call credit of at most ${MAX_MEMBER_CALL_CREDITS} members. ` +
      `${adjusted.length} are adjusted; credit the rest with the full count.`,
  };
}
