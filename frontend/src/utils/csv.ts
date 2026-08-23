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

/**
 * Escape a string for a quoted CSV cell and prevent spreadsheet formula
 * execution. Formula markers are checked after leading whitespace/control
 * characters so they cannot be used to bypass the neutralization.
 */
export function escapeCsvCell(value: string): string {
  // A leading tab or carriage return is itself a trigger — some importers strip
  // it and act on what follows — so the raw first character is checked before
  // whitespace is skipped. Skipping first would let "\tformula" through.
  const first = value[0];
  const leadingControl = first === '\t' || first === '\r';

  // ...and the first character that is not whitespace is checked as well, so a
  // cell like " =cmd" cannot smuggle a formula past on a leading space.
  let contentStart = 0;
  while (contentStart < value.length && value.charCodeAt(contentStart) <= 0x20) {
    contentStart += 1;
  }
  // `''.includes('')` is true, so the `?? ''` fallback this replaced prefixed an
  // apostrophe onto every empty and whitespace-only cell — a column of stray
  // quotes in each export that had a blank in it.
  const trigger = value[contentStart];
  const isFormula = leadingControl || (trigger !== undefined && '=+@-'.includes(trigger));
  const safeValue = isFormula ? `'${value}` : value;

  // Quote only where RFC 4180 requires it. The member-import error report is
  // meant to be corrected and re-uploaded by a person, and quoting every cell
  // makes that file markedly harder to read and edit by hand.
  return /[",\r\n]/.test(safeValue) ? `"${safeValue.replace(/"/g, '""')}"` : safeValue;
}

/**
 * What a CSV cell may hold. Deliberately not `unknown`: `String(someObject)`
 * yields "[object Object]" in a column an officer then has to interpret, and
 * the type is the only place that can be caught.
 */
export type CsvValue = string | number | boolean | null | undefined;

/**
 * A full CSV document from a header row plus data rows, every cell neutralized
 * by `escapeCsvCell` above.
 *
 * CRLF line endings, per RFC 4180 — Excel on Windows is the most common
 * consumer of these files and a bare LF leaves it reading multi-line cells
 * wrongly.
 */
export function buildCsv(rows: readonly (readonly CsvValue[])[]): string {
  return rows.map((row) => row.map((cell) => escapeCsvCell(cell == null ? '' : String(cell))).join(',')).join('\r\n');
}

/** Hand a built CSV to the browser as a download. */
export function downloadCsv(contents: string, filename: string): void {
  const blob = new Blob([contents], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
