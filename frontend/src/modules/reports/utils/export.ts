/**
 * Report Export Utilities
 *
 * Client-side CSV and PDF generation for report data.
 */

/** Safely convert any unknown value to a display string. */
export const toStr = (v: unknown, fallback = ''): string => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return fallback;
  }
};

/** Safely convert any value to a string for CSV output. */
const toCsvValue = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') {
    // Escape double-quotes and wrap in quotes if it contains commas, newlines, or quotes
    if (v.includes(',') || v.includes('\n') || v.includes('"')) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `"${v.join('; ')}"`;
  try {
    return `"${JSON.stringify(v).replace(/"/g, '""')}"`;
  } catch {
    return '';
  }
};

/**
 * Generate CSV content from an array of flat objects.
 *
 * @param rows    Array of objects to export
 * @param columns Optional column definitions [{key, header}]. When omitted,
 *                columns are inferred from the first row's keys.
 */
export function generateCsv(
  rows: Array<Record<string, unknown>>,
  columns?: Array<{ key: string; header: string }>
): string {
  if (rows.length === 0) return '';

  const cols =
    columns ??
    Object.keys(rows[0] ?? {}).map((key) => ({
      key,
      header: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    }));

  const header = cols.map((c) => toCsvValue(c.header)).join(',');
  const body = rows.map((row) => cols.map((c) => toCsvValue(row[c.key])).join(',')).join('\n');

  return `${header}\n${body}`;
}

/**
 * Download a string as a file in the browser.
 */
export function downloadFile(content: string | Blob, filename: string, mimeType = 'text/csv'): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export report data as CSV and trigger download.
 */
export function exportReportAsCsv(
  reportTitle: string,
  rows: Array<Record<string, unknown>>,
  columns?: Array<{ key: string; header: string }>
): void {
  const csv = generateCsv(rows, columns);
  const filename = `${reportTitle.replace(/\s+/g, '_').toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv`;
  downloadFile(csv, filename, 'text/csv;charset=utf-8;');
}

/**
 * Export report data as a simple printable HTML page (for PDF via browser print).
 * Opens a new window with the formatted report and triggers print dialog.
 */
export function exportReportAsPrintablePdf(
  reportTitle: string,
  rows: Array<Record<string, unknown>>,
  columns?: Array<{ key: string; header: string }>,
  summaryHtml?: string
): void {
  const cols =
    columns ??
    Object.keys(rows[0] ?? {}).map((key) => ({
      key,
      header: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    }));

  const headerRow = cols
    .map(
      (c) =>
        `<th style="padding:6px 10px;border:1px solid #ddd;background:#f5f5f5;text-align:left;font-size:12px;">${c.header}</th>`
    )
    .join('');
  const bodyRows = rows
    .map(
      (row) =>
        `<tr>${cols.map((c) => `<td style="padding:4px 10px;border:1px solid #eee;font-size:11px;">${toStr(row[c.key])}</td>`).join('')}</tr>`
    )
    .join('');

  const html = `<!DOCTYPE html>
<html><head><title>${reportTitle}</title>
<style>
  @media print { body { margin: 0.5in; } @page { size: landscape; } }
  body { font-family: Arial, sans-serif; color: #333; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .meta { font-size: 11px; color: #666; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; }
</style></head><body>
<h1>${reportTitle}</h1>
<div class="meta">Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</div>
${summaryHtml ? `<div style="margin-bottom:16px">${summaryHtml}</div>` : ''}
<table><thead><tr>${headerRow}</tr></thead><tbody>${bodyRows}</tbody></table>
</body></html>`;

  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 300);
  }
}
