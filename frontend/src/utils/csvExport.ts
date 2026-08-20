/**
 * Client-side CSV export.
 *
 * The frontend twin of the backend's `SafeCsvWriter` (`app/utils/csv_export.py`),
 * and it exists for the same reason: an export is opened in Excel or Google
 * Sheets, which execute any cell whose value begins with `=`, `+`, `-`, `@` or a
 * leading tab/CR as a formula. Every field these exports carry — member names,
 * event titles, form answers, notes — is typed by a member, so a member named
 * `=cmd|…` runs a formula on whichever officer opens the file.
 *
 * Quote-doubling alone does not stop this: the cell is still a formula once the
 * spreadsheet strips the quotes. The value has to stop *being* a formula.
 */

/**
 * What a cell may hold. Deliberately not `unknown`: `String(someObject)` yields
 * "[object Object]" in a column an officer then has to interpret, and the type
 * is the only place that can be caught.
 */
export type CsvValue = string | number | boolean | null | undefined;

/** Characters a spreadsheet treats as "this cell is a formula". */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/** Characters that force a cell to be quoted under RFC 4180. */
const NEEDS_QUOTING = /[",\r\n]/;

/**
 * One CSV cell: neutralized against formula execution, then quoted if needed.
 *
 * A leading apostrophe is what makes the value literal — spreadsheets read it as
 * "the rest of this cell is text" and do not display it, so the reader still
 * sees exactly what the member typed.
 */
export const escapeCsvCell = (value: CsvValue): string => {
  const text = value == null ? '' : String(value);
  const safe = FORMULA_TRIGGER.test(text) ? `'${text}` : text;
  return NEEDS_QUOTING.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/**
 * A full CSV document from a header row plus data rows.
 *
 * CRLF line endings, per RFC 4180 — Excel on Windows is the most common
 * consumer of these files and a bare LF leaves it reading multi-line cells
 * wrongly.
 */
export const buildCsv = (rows: readonly (readonly CsvValue[])[]): string =>
  rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');

/** Hand a built CSV to the browser as a download. */
export const downloadCsv = (contents: string, filename: string): void => {
  const blob = new Blob([contents], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};
