/**
 * MedicalImportExportModal — spreadsheet in and out of the medical domain.
 *
 * Export comes in two files because an officer reaches for them for different
 * jobs: the supply list (one row per item, with reorder points and ready-lot
 * totals) for ordering, and the lot list (one row per lot, shelf and truck) for an expiry
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
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { useFieldErrors, type FieldSpecs } from '../../../hooks/useFieldErrors';

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

// The upload is sent as multipart `file`, so a refusal of it reports that key.
const IMPORT_FIELDS: FieldSpecs<'file'> = {
  file: { id: 'medical-import-file', label: 'CSV file to import' },
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
  const importErrors = useFieldErrors(IMPORT_FIELDS);

  const filtered = Boolean(
    filters.search ||
    filters.category_id ||
    filters.low_stock ||
    filters.uncounted ||
    filters.location_id ||
    filters.storage_area_id
  );

  // A chosen file that has not been imported is the one thing here that
  // closing would lose; Done, Escape and the X ask first (forms review F-6).
  const handleClose = useDiscardGuard({
    isDirty: file !== null,
    message: 'The chosen file has not been imported yet.',
    onClose: () => {
      if (result && (result.imported > 0 || result.lots_added > 0 || result.categories_created.length > 0))
        onImported();
      onClose();
    },
  });

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
    importErrors.clear();
    if (selected && !selected.name.toLowerCase().endsWith('.csv')) {
      // Said on the file field rather than in a toast (forms review F-3).
      importErrors.setError('file', `${selected.name} is not a CSV file. Choose a .csv file.`);
      setFile(null);
      event.target.value = '';
      return;
    }
    setFile(selected);
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    importErrors.setFormError(null);
    // Import is not greyed out until a file is chosen; pressing it says what
    // is missing instead (forms review F-3).
    if (!file) {
      importErrors.setErrors({ file: 'Choose a CSV file to import.' });
      importErrors.focusFirst({ file: 'Choose a CSV file to import.' });
      return;
    }
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
      // On the file field when the refusal names it, otherwise in the form,
      // not a toast that goes away with the reason.
      importErrors.focusFirst(importErrors.setFromApiError(err, 'Failed to import supplies'));
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
              ? 'The supply list uses the filters on the page, with what the trucks carry and each next expiry.'
              : 'The supply list has one row per item, with what the trucks carry and each next expiry. The lot list has one row per lot, on the shelves and the apparatus, soonest expiry first.'}
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

          <form noValidate onSubmit={(e) => void handleImport(e)} className="space-y-2">
            {importErrors.formError && (
              <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
                {importErrors.formError}
              </p>
            )}
            <div className="flex flex-wrap items-end gap-2">
              {/* min-w-0 and w-full let the field shrink: a file control's
                  intrinsic width is about 250px plus its label, which made the
                  field 377px wide in a 320px viewport. */}
              <FormField
                id={IMPORT_FIELDS.file.id}
                label="CSV file to import"
                error={importErrors.errors.file}
                className="w-full min-w-0 sm:w-auto sm:flex-1"
              >
                {(field) => (
                  <input
                    {...field}
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleFileChange}
                    className="text-theme-text-primary w-full min-w-0 text-sm"
                  />
                )}
              </FormField>
              <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={busy !== null}>
                <Upload className="h-4 w-4" aria-hidden="true" />
                {busy === 'import' ? 'Importing…' : 'Import'}
              </button>
            </div>
          </form>

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
