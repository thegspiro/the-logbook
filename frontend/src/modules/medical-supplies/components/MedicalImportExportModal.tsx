/**
 * MedicalImportExportModal — spreadsheet in and out of the medical domain.
 *
 * Export comes in two files because an officer reaches for them for different
 * jobs: the supply list (one row per item, with reorder points and ready-lot
 * totals) for ordering, and the lot list (one row per dated lot) for an expiry
 * audit. Import creates supplies and records stock lots; it never edits a
 * supply already on file, only adds lots to one.
 *
 * Every route behind this is pinned to the medical domain server-side, so a
 * row the import accepts always lands on this page — an unknown category is
 * created as a medical one rather than leaving the item filed as gear.
 */

import React, { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle, Download, FileText, Upload } from 'lucide-react';
import { medicalSuppliesService } from '../../../services/medicalSuppliesService';
import type { MedicalExportFilters, MedicalImportResult } from '../../../services/medicalSuppliesService';
import { getErrorMessage } from '../../../utils/errorHandling';
import { getTodayLocalDate } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { Modal } from '../../../components/Modal';

interface MedicalImportExportModalProps {
  onClose: () => void;
  /** Called on close when the import wrote anything, so the page can reload. */
  onImported: () => void;
  /** The page's own list filters, so the supply export matches the list on screen. */
  filters: MedicalExportFilters;
}

const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const importSummary = (result: MedicalImportResult) =>
  `${plural(result.imported, 'supply', 'supplies')} created, ${plural(result.lots_added, 'lot', 'lots')} added`;

const secondaryButton =
  'mobile-touch-target border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50';

export const MedicalImportExportModal: React.FC<MedicalImportExportModalProps> = ({ onClose, onImported, filters }) => {
  const tz = useTimezone();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'items' | 'lots' | 'template' | 'import' | null>(null);
  const [result, setResult] = useState<MedicalImportResult | null>(null);

  const filtered = Boolean(filters.search || filters.category_id);

  const handleClose = () => {
    if (result && (result.imported > 0 || result.lots_added > 0 || result.categories_created.length > 0)) onImported();
    onClose();
  };

  const runDownload = async (
    kind: 'items' | 'lots' | 'template',
    fetchBlob: () => Promise<Blob>,
    filename: string,
    failure: string
  ) => {
    setBusy(kind);
    try {
      saveBlob(await fetchBlob(), filename);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, failure));
    } finally {
      setBusy(null);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    setResult(null);
    if (selected && !selected.name.toLowerCase().endsWith('.csv')) {
      toast.error('Choose a .csv file');
      setFile(null);
      event.target.value = '';
      return;
    }
    setFile(selected);
  };

  const handleImport = async () => {
    if (!file) return;
    setBusy('import');
    try {
      const imported = await medicalSuppliesService.importItemsCsv(file);
      setResult(imported);
      if (imported.imported > 0 || imported.lots_added > 0) {
        toast.success(importSummary(imported));
      }
      if (imported.failed > 0) {
        toast.error(`${imported.failed} row${imported.failed === 1 ? '' : 's'} could not be imported`);
      }
      // Cleared so the same file cannot be imported twice by a second tap:
      // every row creates a new supply, so a repeat would duplicate them all.
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to import supplies'));
    } finally {
      setBusy(null);
    }
  };

  const today = getTodayLocalDate(tz);

  return (
    <Modal
      isOpen
      onClose={handleClose}
      title="Import / export supplies"
      size="lg"
      footer={
        <button type="button" onClick={handleClose} className={secondaryButton}>
          Done
        </button>
      }
    >
      <div className="space-y-6">
        <section aria-labelledby="medical-export-heading" className="space-y-2">
          <h3 id="medical-export-heading" className="text-theme-text-primary text-sm font-semibold">
            Export
          </h3>
          <p className="text-theme-text-muted text-sm">
            {filtered
              ? 'The supply list uses the search and category filter on the page.'
              : 'The supply list has one row per item. The lot list has one row per dated lot, soonest expiry first.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={secondaryButton}
              disabled={busy !== null}
              onClick={() =>
                void runDownload(
                  'items',
                  () => medicalSuppliesService.exportItemsCsv(filters),
                  `medical-supplies-${today}.csv`,
                  'Export failed'
                )
              }
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {busy === 'items' ? 'Exporting…' : 'Export supply list'}
            </button>
            <button
              type="button"
              className={secondaryButton}
              disabled={busy !== null}
              onClick={() =>
                void runDownload(
                  'lots',
                  () => medicalSuppliesService.exportLotsCsv(),
                  `medical-supply-lots-${today}.csv`,
                  'Export failed'
                )
              }
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {busy === 'lots' ? 'Exporting…' : 'Export lot list'}
            </button>
          </div>
        </section>

        <section aria-labelledby="medical-import-heading" className="space-y-3">
          <h3 id="medical-import-heading" className="text-theme-text-primary text-sm font-semibold">
            Import
          </h3>
          <p className="text-theme-text-muted text-sm">
            Each row adds a new supply. Name and Category are required, and a category that does not exist yet is
            created as a medical supply category. To record stock with a lot, fill Lot Number, Expiration Date or
            Received Date (YYYY-MM-DD): the row&apos;s Quantity becomes that lot. A row with lot columns whose Name
            matches a supply already on file adds the lot to it instead, and changes nothing else about it. Put Yes in
            Kept on Apparatus Only for equipment with no stock-room spare; such a row takes no lot columns.
          </p>
          <button
            type="button"
            className={secondaryButton}
            disabled={busy !== null}
            onClick={() =>
              void runDownload(
                'template',
                () => medicalSuppliesService.downloadImportTemplate(),
                'medical-supplies-import-template.csv',
                'Failed to download the template'
              )
            }
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            Download template
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="medical-import-file" className="form-label sr-only">
              CSV file to import
            </label>
            <input
              id="medical-import-file"
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="text-theme-text-primary text-sm"
            />
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2"
              disabled={!file || busy !== null}
              onClick={() => void handleImport()}
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              {busy === 'import' ? 'Importing…' : 'Import'}
            </button>
          </div>

          {result && (
            <div className="border-theme-surface-border space-y-2 rounded-md border p-3 text-sm" role="status">
              <p className="text-theme-text-primary flex items-center gap-2 font-medium">
                <CheckCircle className="h-4 w-4" aria-hidden="true" />
                {result.total_rows} row{result.total_rows === 1 ? '' : 's'}: {importSummary(result)}
                {result.failed > 0 ? `, ${result.failed} failed` : ''}
              </p>
              {result.warnings.length > 0 && (
                <ul className="text-theme-text-secondary list-disc space-y-1 pl-5">
                  {result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
              {result.errors.length > 0 && (
                <ul className="text-theme-text-secondary list-disc space-y-1 pl-5" aria-label="Rows that failed">
                  {result.errors.map((error, index) => (
                    <li key={`${error.row}-${index}`}>
                      Row {error.row}: {error.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
};
