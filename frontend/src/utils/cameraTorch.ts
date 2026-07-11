/**
 * Flashlight (camera torch) helpers for the raw-MediaStream scanning path.
 *
 * The Web API capability is named `torch` (MediaTrackConstraintSet); the user
 * facing term throughout the app is "Flashlight". `torch` is not in the
 * standard TypeScript DOM types, so a narrow cast is required.
 */

interface TorchCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
}

/** True when the given video track exposes a controllable flashlight. */
export function trackSupportsFlashlight(track: MediaStreamTrack | null | undefined): boolean {
  if (!track || typeof track.getCapabilities !== 'function') return false;
  try {
    return (track.getCapabilities() as TorchCapabilities).torch === true;
  } catch {
    return false;
  }
}

/** Turn the flashlight on or off for the given video track. */
export async function setTrackFlashlight(track: MediaStreamTrack, on: boolean): Promise<void> {
  await track.applyConstraints({
    advanced: [{ torch: on }],
  } as unknown as MediaTrackConstraints);
}
