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
