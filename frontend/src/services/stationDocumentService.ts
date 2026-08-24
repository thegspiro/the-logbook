/**
 * Printable station documents — a shift roster, an apparatus check sheet.
 *
 * Separate from the label path: these are read off paper and carried round a
 * truck, not stuck to something. They print on a receipt printer, which is why
 * the printers themselves come from `labelPrinterService` — same devices, same
 * registration, different thing rendered onto them.
 */

import api from './apiClient';

export const StationDocument = {
  SHIFT_ROSTER: 'shift_roster',
  APPARATUS_CHECK_SHEET: 'apparatus_check_sheet',
} as const;
export type StationDocument = (typeof StationDocument)[keyof typeof StationDocument];

export interface DocumentRow {
  left: string;
  right: string | null;
  emphasis: boolean;
  checkbox: boolean;
  indent: number;
}

export interface DocumentSection {
  heading: string | null;
  rows: DocumentRow[];
}

export interface StationDocumentPreview {
  title: string;
  subtitle: string | null;
  footer: string | null;
  sections: DocumentSection[];
}

export interface StationDocumentPrintResult {
  printer_id: string;
  printer_name: string;
  document: StationDocument;
  title: string;
  /** What the printer said about itself once the job was away. */
  printer_errors: string[];
  printer_warnings: string[];
  status_known: boolean;
}

export const stationDocumentService = {
  /**
   * The document exactly as it will print. The server builds it once and both
   * the preview and the printer read that same structure, so what someone
   * checks on screen is what comes off the roll.
   */
  async preview(document: StationDocument, recordId: string): Promise<StationDocumentPreview> {
    const res = await api.post<StationDocumentPreview>('/station-documents/preview', {
      document,
      record_id: recordId,
    });
    return res.data;
  },

  async print(document: StationDocument, recordId: string, printerId?: string): Promise<StationDocumentPrintResult> {
    const res = await api.post<StationDocumentPrintResult>('/station-documents/print', {
      document,
      record_id: recordId,
      ...(printerId ? { printer_id: printerId } : {}),
    });
    return res.data;
  },
};
