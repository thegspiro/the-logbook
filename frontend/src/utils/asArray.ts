/**
 * Guarantees the array return type a service method declares.
 *
 * `api.get<T[]>(...)` *asserts* the wire format rather than verifying it, so a
 * response body that is not an array flows straight into callers that
 * immediately spread, `.map`, `.filter` or read `.length` off it. Because
 * nothing checks, a single unexpected body takes an entire page down through
 * the ErrorBoundary instead of rendering as an empty list.
 *
 * That is not hypothetical on mobile: a captive portal on station Wi-Fi or a
 * carrier interception page answers with HTTP 200 and an HTML body, and the
 * member gets a dead screen rather than an empty one.
 *
 * Wrapping at the service boundary makes the declared contract true once, for
 * every current and future caller, instead of asking ~190 call sites to defend
 * themselves individually.
 *
 * The parameter is typed `T[]` so the element type is inferred from the
 * caller's own annotation and no explicit type argument or cast is needed; the
 * runtime check is what actually does the work.
 */
export function asArray<T>(value: T[]): T[] {
  return Array.isArray(value) ? value : [];
}

/**
 * The other half of that decision: verify the array, and let a bad one fail.
 *
 * `asArray` is right wherever an empty list is a *degraded view* — a dropdown,
 * a filter, a roster the member is only reading. Rendering nothing beats a dead
 * screen there.
 *
 * It is wrong wherever an empty list is a *claim*. "No ranks configured", "no
 * membership types excluded from self-signup", "no notification rules enabled"
 * are statements about the department, shown to an officer who will act on
 * them, and a captive portal is not entitled to make any of them. Worse, the
 * screens that make such claims usually already have a considered failure path
 * — `SchedulingNotificationsPanel` explains in a comment why a failed load must
 * interrupt, because every switch reading as off makes an enabled notification
 * look disabled — and swallowing at the service boundary means that path never
 * runs. The catch is above the layer that hides the fault.
 *
 * So: `asArray` to keep a page alive, `expectArray` to keep it honest. Choosing
 * between them is the point; neither is the safe default.
 *
 * `what` names the thing in the error, because "response was not an array" from
 * a page that reads four endpoints says nothing about which one.
 */
export function expectArray<T>(value: T[], what: string): T[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`The ${what} response was not an array`);
  }
  return value;
}
