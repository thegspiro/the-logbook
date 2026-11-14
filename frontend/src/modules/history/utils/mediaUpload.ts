/**
 * The upload limits the server enforces, checked in the browser first so a
 * file that would be refused is not sent at all. The server still decides.
 */

export const MAX_FILES = 25;
const MB = 1024 * 1024;
// TIFF is refused, as everywhere else on the platform: scans are converted to
// JPEG or PNG before upload (owner decision).
export const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
export const AV_EXTENSIONS = ['.mp3', '.m4a', '.wav', '.flac', '.mp4', '.webm'];

export const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
};

/** Why *file* would be refused, or null when it may be sent. */
export const precheck = (file: File): string | null => {
  const ext = extensionOf(file.name);
  if (PHOTO_EXTENSIONS.includes(ext)) {
    return file.size > 20 * MB ? 'Over the 20 MB limit for photos' : null;
  }
  if (AV_EXTENSIONS.includes(ext)) {
    return file.size > 55 * MB ? 'Over the 55 MB limit for audio and video' : null;
  }
  return 'Not an accepted type';
};
