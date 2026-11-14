/**
 * A stored file's MIME type as a member reads it: "PDF", "Word", "Text".
 *
 * The documents list printed the raw type in capitals ("APPLICATION/PDF",
 * and for a Word file "APPLICATION/VND.OPENXMLFORMATS-OFFICEDOCUMENT…"). The
 * named entries cover every type the documents upload accepts and the HTML
 * the app files itself; anything else falls back to its family so an
 * unfamiliar type still reads as a word rather than a MIME string.
 */
const LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/msword': 'Word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.ms-excel': 'Excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.ms-powerpoint': 'PowerPoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
  'text/plain': 'Text',
  'text/csv': 'CSV',
  'text/html': 'Web page',
  'image/jpeg': 'JPEG image',
  'image/png': 'PNG image',
  'image/gif': 'GIF image',
  'image/webp': 'WebP image',
  'application/zip': 'ZIP',
  'application/x-zip-compressed': 'ZIP',
};

const FAMILIES: Record<string, string> = {
  image: 'Image',
  text: 'Text',
  audio: 'Audio',
  video: 'Video',
};

export function fileTypeLabel(mimeType: string | null | undefined): string | undefined {
  // Parameters ("text/plain; charset=utf-8") and case do not change the type.
  const type = (mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!type) return undefined;
  const named = LABELS[type];
  if (named) return named;
  const family = type.split('/')[0] ?? '';
  return FAMILIES[family] ?? 'File';
}
