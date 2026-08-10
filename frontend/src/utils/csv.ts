/**
 * RFC 4180 CSV parsing.
 *
 * Written because three separate screens reached for `line.split(',')`, and a
 * supply catalog is exactly the data that breaks it: "Gauze Pads, 4x4 Sterile"
 * is one field with a comma in it, and splitting on commas silently shifts
 * every column after it by one. The import then succeeds — with the item name
 * truncated to "Gauze Pads" and the quantity read out of the wrong column.
 *
 * Handles quoted fields, escaped quotes (`""`), embedded commas and newlines,
 * and both CRLF and LF line endings.
 */

/**
 * Split CSV text into rows of fields.
 *
 * Blank lines are dropped — trailing newlines are near-universal in exported
 * files and an empty final row is never meaningful.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;

  const endField = () => {
    // Unquoted fields get trimmed (spreadsheets pad columns); a quoted field
    // is taken verbatim, because the quotes are how the author says the
    // whitespace is deliberate.
    row.push(fieldWasQuoted ? field : field.trim());
    field = '';
    fieldWasQuoted = false;
  };

  const endRow = () => {
    endField();
    if (row.some((f) => f !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.trim() === '') {
      inQuotes = true;
      fieldWasQuoted = true;
      field = '';
    } else if (char === ',') {
      endField();
    } else if (char === '\n') {
      endRow();
    } else if (char === '\r') {
      // Swallowed; the \n that follows ends the row.
    } else {
      field += char;
    }
  }

  // A file with no trailing newline still has a last row to emit.
  if (field !== '' || row.length > 0) endRow();

  return rows;
}

/**
 * Parse into objects keyed by a normalized header name.
 *
 * Headers are lowercased with non-alphanumerics collapsed to a single space,
 * so "Item Type", "item_type" and "ITEM TYPE" all resolve to the same key —
 * the same tolerance a person expects when they hand-edit a template.
 */
export function parseCsvRecords(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const raw = parseCsv(text);
  const headerRow = raw[0];
  if (!headerRow) return { headers: [], rows: [] };

  const headers = headerRow.map(normalizeHeader);
  const rows = raw.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, idx) => {
      if (header) record[header] = cells[idx] ?? '';
    });
    return record;
  });

  return { headers, rows };
}

export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Read a value under any of several accepted header spellings.
 *
 * Import formats accumulate aliases as departments hand files around; a lookup
 * that only knows one spelling turns a working file into a support ticket.
 */
export function csvValue(record: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    const value = record[normalizeHeader(name)];
    if (value !== undefined && value !== '') return value;
  }
  return '';
}
