/**
 * The paste format for adding many catalog items at once.
 *
 * One item per line; `|` separates the optional quantity and unit:
 *
 *     Gauze Pads, 4x4 Sterile | 24 | Box
 *
 * Pipe rather than comma because supply names are full of commas — "Gauze
 * Pads, 4x4 Sterile" is one name, and a comma-delimited format would cut it
 * in half on exactly the items this exists to enter.
 */

export interface ParsedBulkLine {
  name: string;
  quantity?: number | undefined;
  unitOfMeasure?: string | undefined;
}

export function parseBulkLines(text: string): ParsedBulkLine[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawName, rawQty, rawUnit] = line.split('|').map((p) => p.trim());
      const name = rawName ?? '';
      const quantity = rawQty ? Number.parseInt(rawQty, 10) : undefined;
      return {
        name,
        ...(quantity !== undefined && Number.isFinite(quantity) && quantity >= 0 ? { quantity } : {}),
        ...(rawUnit ? { unitOfMeasure: rawUnit } : {}),
      };
    })
    .filter((line) => line.name.length > 0);
}
