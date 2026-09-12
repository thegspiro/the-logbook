/**
 * The member-numbering answer collected in step 1, on its way to the API.
 *
 * `organization.settings["membership_id"]` holds a counter that only numbers
 * members created after it is switched on. The wizard creates the administrator
 * account in step 2 and the IT team in step 7, so a department that answered
 * this on a members screen afterwards ended up with its first accounts holding
 * no number and the roster import starting at the number they should have had —
 * an off-by-a-few nobody notices until a badge is printed.
 *
 * Kept out of `OrganizationSetup.tsx` so a module exporting a component exports
 * only that (`react-refresh/only-export-components`), which is why
 * `positionTemplates.ts` sits beside it for the same reason.
 */

/** What the three form controls hold. `start` is free text, as typed. */
export interface MemberNumberingAnswer {
  enabled: boolean;
  prefix: string;
  start: string;
}

/** The shape `MembershipIdSettings` stores. */
export interface MembershipIdPayload {
  enabled: boolean;
  auto_generate: boolean;
  prefix: string;
  next_number: number;
}

/**
 * The block step 1 sends, or nothing.
 *
 * Undefined rather than an explicit `enabled: false` when the department does
 * not number its members: the backend leaves the shipped default alone for an
 * absent block, so a department that skipped the question and one that answered
 * "no" stay distinguishable and a later change to that default reaches the
 * first without overriding the second.
 */
export const membershipIdPayload = (answer: MemberNumberingAnswer): MembershipIdPayload | undefined => {
  if (!answer.enabled) return undefined;
  // `next_number` is `ge=1` on the backend, and the field is free text that can
  // hold '', '0' or 'abc'. Settling it here rather than letting it 422 keeps an
  // optional answer from failing the whole of step 1.
  const parsed = parseInt(answer.start, 10);
  return {
    enabled: true,
    // Auto-generation is the whole point of asking during setup: the answer
    // exists so the accounts setup creates are numbered. A department that
    // types its numbers in by hand turns this off in Members → Settings.
    auto_generate: true,
    prefix: answer.prefix.trim(),
    next_number: Number.isFinite(parsed) && parsed >= 1 ? parsed : 1,
  };
};
