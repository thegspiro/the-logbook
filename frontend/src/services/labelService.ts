/**
 * Generic, cross-module label service. Backed by the shared backend endpoints
 * (/label-preset/{module}, /labels/generate), so any module's print page can
 * read/save its per-position printer preset and generate a label PDF.
 */

import api from './apiClient';

/**
 * What the label carries. Code 128 is the default and what the scan lookup has
 * always read; QR fits a long identifier on small square stock, where a Code
 * 128 wide enough to hold one physically does not.
 */
export const Symbology = {
  CODE128: 'code128',
  QR: 'qr',
} as const;
export type Symbology = (typeof Symbology)[keyof typeof Symbology];

export interface LabelPresetResponse {
  preset: string | null;
  custom_width?: number | null;
  custom_height?: number | null;
  symbology?: Symbology | null;
  position_id?: string | null;
  module?: string;
}

export interface GenerateLabelsOptions {
  label_format: string;
  custom_width?: number;
  custom_height?: number;
  auto_rotate?: boolean;
  extra_lines?: string[];
  symbology?: Symbology;
}

export interface LabelPreviewItem {
  name: string;
  barcode_value: string;
  subtitle?: string | null;
}

export const labelService = {
  async preview(module: string, ids: string[]): Promise<{ items: LabelPreviewItem[] }> {
    const res = await api.post<{ items: LabelPreviewItem[] }>('/labels/preview', {
      module,
      ids,
    });
    return res.data;
  },

  async getPreset(module: string): Promise<LabelPresetResponse> {
    const res = await api.get<LabelPresetResponse>(`/label-preset/${module}`);
    return res.data;
  },

  async setPreset(
    module: string,
    data: { preset: string; custom_width?: number; custom_height?: number; symbology?: Symbology }
  ): Promise<LabelPresetResponse> {
    const res = await api.put<LabelPresetResponse>(`/label-preset/${module}`, data);
    return res.data;
  },

  async generate(
    module: string,
    ids: string[],
    opts: GenerateLabelsOptions
  ): Promise<{ blob: Blob; autoPopulated: number }> {
    const res = await api.post<Blob>('/labels/generate', { module, ids, ...opts }, { responseType: 'blob' });
    const auto = parseInt((res.headers?.['x-barcodes-auto-populated'] as string) ?? '0', 10);
    return { blob: res.data, autoPopulated: isNaN(auto) ? 0 : auto };
  },
};

/**
 * The command language a printer speaks.
 *
 * ZPL covers Zebra and the many printers that ship a ZPL emulation mode
 * (TSC, Godex, Honeywell, Citizen, SATO). ESC/POS covers receipt-class
 * thermal printers, several of which take linerless label media.
 */
export const PrinterLanguage = {
  ZPL: 'zpl',
  ESCPOS: 'escpos',
} as const;
export type PrinterLanguage = (typeof PrinterLanguage)[keyof typeof PrinterLanguage];

/** Receipt stock is sold by paper width; there is no label length. */
export const ESCPOS_PAPER_SIZES = [
  { id: 'escpos_80mm', name: '80mm roll (3.1")' },
  { id: 'escpos_58mm', name: '58mm roll (2.3")' },
] as const;

/**
 * A network label printer registered for the organization. Printing to one
 * sends the printer's own command language (ZPL) rather than a PDF, so no
 * print dialog is involved and nothing can rescale the barcode.
 */
export interface LabelPrinterConfig {
  id: string;
  name: string;
  location: string | null;
  host: string;
  port: number;
  language: PrinterLanguage;
  dpi: number;
  label_format: string;
  custom_width: number | null;
  custom_height: number | null;
  darkness: number | null;
  is_default: boolean;
  is_active: boolean;
}

export interface LabelPrinterCreatePayload {
  name: string;
  host: string;
  port: number;
  language: PrinterLanguage;
  dpi: number;
  label_format: string;
  location?: string | undefined;
  custom_width?: number | undefined;
  custom_height?: number | undefined;
  darkness?: number | undefined;
  is_default?: boolean | undefined;
}

/**
 * Update payload. Every key is optional and only sent keys are written, so a
 * field is cleared with an explicit `null` rather than by omission (CLAUDE.md
 * pitfall 1 — omitting a key on an update means "leave it alone").
 */
export interface LabelPrinterUpdatePayload {
  name?: string;
  host?: string;
  port?: number;
  language?: PrinterLanguage;
  dpi?: number;
  label_format?: string;
  location?: string | null;
  custom_width?: number | null;
  custom_height?: number | null;
  darkness?: number | null;
  is_default?: boolean;
  is_active?: boolean;
}

export interface PrintLabelsOptions {
  printer_id?: string | undefined;
  label_format?: string | undefined;
  custom_width?: number | undefined;
  custom_height?: number | undefined;
  copies?: number | undefined;
  extra_lines?: string[] | undefined;
  symbology?: Symbology | undefined;
}

export interface PrintLabelsResult {
  printer_id: string;
  printer_name: string;
  labels_sent: number;
  auto_populated: number;
  /**
   * What the printer said about itself after the job was sent. Bytes reaching
   * a socket is not a printed label — a printer that is out of stock accepts
   * the job and prints nothing, and this is how that becomes visible.
   */
  printer_errors: string[];
  printer_warnings: string[];
  status_known: boolean;
}

/** Identity and fault report from a printer, saved or not yet saved. */
export interface PrinterStatus {
  responded: boolean;
  identified: boolean;
  model: string | null;
  firmware: string | null;
  reported_dpi: number | null;
  errors: string[];
  warnings: string[];
  status_available: boolean;
}

export interface SavedPrinterStatus extends PrinterStatus {
  printer_id: string;
  printer_name: string;
  configured_dpi: number;
  language: PrinterLanguage;
}

export interface TestLabelResult {
  printer_id: string;
  printer_name: string;
  printer_errors: string[];
  printer_warnings: string[];
  status_known: boolean;
}

export const labelPrinterService = {
  async list(includeInactive = false): Promise<LabelPrinterConfig[]> {
    const res = await api.get<{ printers: LabelPrinterConfig[] }>('/label-printers', {
      params: { include_inactive: includeInactive },
    });
    return res.data.printers;
  },

  async create(payload: LabelPrinterCreatePayload): Promise<LabelPrinterConfig> {
    const res = await api.post<LabelPrinterConfig>('/label-printers', payload);
    return res.data;
  },

  async update(id: string, payload: LabelPrinterUpdatePayload): Promise<LabelPrinterConfig> {
    const res = await api.put<LabelPrinterConfig>(`/label-printers/${id}`, payload);
    return res.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/label-printers/${id}`);
  },

  async test(id: string, symbology?: Symbology): Promise<TestLabelResult> {
    const res = await api.post<TestLabelResult>(
      `/label-printers/${id}/test`,
      undefined,
      symbology ? { params: { symbology } } : undefined
    );
    return res.data;
  },

  async status(id: string): Promise<SavedPrinterStatus> {
    const res = await api.get<SavedPrinterStatus>(`/label-printers/${id}/status`);
    return res.data;
  },

  /**
   * Check an address before saving it, so setup is not save-discover-edit.
   * The language matters: the two speak different status protocols, and
   * asking in the wrong one gets no useful answer.
   */
  async probe(host: string, port: number, language: PrinterLanguage): Promise<PrinterStatus> {
    const res = await api.post<PrinterStatus>('/label-printers/probe', { host, port, language });
    return res.data;
  },

  async print(module: string, ids: string[], opts: PrintLabelsOptions = {}): Promise<PrintLabelsResult> {
    const res = await api.post<PrintLabelsResult>('/labels/print', { module, ids, ...opts });
    return res.data;
  },
};
