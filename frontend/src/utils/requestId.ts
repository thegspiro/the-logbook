/**
 * A random id for one request, repeated on every resend of it so the server
 * can tell a resend from a new request.
 *
 * `crypto.randomUUID` exists only in a secure context, and a department may
 * serve the app over plain HTTP on its own network (an Unraid box at the
 * station); `crypto.getRandomValues` works in either, so it is the fallback.
 * Either way the result is 32+ characters of letters, digits and hyphens,
 * which is what the server's `client_request_id` accepts.
 */
export function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
