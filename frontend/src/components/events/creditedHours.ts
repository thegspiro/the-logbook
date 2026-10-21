/**
 * Why an event's hours line says "up to" rather than naming a figure.
 *
 * Shared by the list card and the event page so the two cannot explain the
 * same number differently: credited_hours is the *scheduled* duration under
 * the org's hour mappings, while what lands on a member's record is their
 * attended time, settled at check-out.
 */
export const CREDITED_HOURS_BASIS =
  "Based on the event's scheduled length. The hours credited to your record are your attended time, settled when you check out.";
