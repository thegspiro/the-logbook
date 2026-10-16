/**
 * The key a section is known by from outline to minutes.
 *
 * A key is derived from the title when the section is first added and never
 * changes afterwards, so renaming a section ("Chief's Report" to "Chief’s
 * Report and Communications") does not detach it from the text already written
 * under it in past minutes. It must match the server's rule: lowercase letters,
 * digits and underscores, unique within the outline.
 */

export function slugKey(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return slug || 'section';
}

export function uniqueKey(title: string, taken: ReadonlySet<string>): string {
  const base = slugKey(title);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}
