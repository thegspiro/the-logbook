/**
 * Generic, cross-module label service. Backed by the shared backend endpoints
 * (/label-preset/{module}, /labels/generate), so any module's print page can
 * read/save its per-position printer preset and generate a label PDF.
 */

import api from './apiClient';

export interface LabelPresetResponse {
  preset: string | null;
  custom_width?: number | null;
  custom_height?: number | null;
  position_id?: string | null;
  module?: string;
}

export interface GenerateLabelsOptions {
  label_format: string;
  custom_width?: number;
  custom_height?: number;
  auto_rotate?: boolean;
  extra_lines?: string[];
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
    data: { preset: string; custom_width?: number; custom_height?: number }
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
}

export interface PrintLabelsResult {
  printer_id: string;
  printer_name: string;
  labels_sent: number;
  auto_populated: number;
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

  async test(id: string): Promise<{ printer_id: string; printer_name: string }> {
    const res = await api.post<{ printer_id: string; printer_name: string }>(`/label-printers/${id}/test`);
    return res.data;
  },

  async print(module: string, ids: string[], opts: PrintLabelsOptions = {}): Promise<PrintLabelsResult> {
    const res = await api.post<PrintLabelsResult>('/labels/print', { module, ids, ...opts });
    return res.data;
  },
};
