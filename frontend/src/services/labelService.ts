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
  async preview(
    module: string,
    ids: string[],
  ): Promise<{ items: LabelPreviewItem[] }> {
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
    data: { preset: string; custom_width?: number; custom_height?: number },
  ): Promise<LabelPresetResponse> {
    const res = await api.put<LabelPresetResponse>(`/label-preset/${module}`, data);
    return res.data;
  },

  async generate(
    module: string,
    ids: string[],
    opts: GenerateLabelsOptions,
  ): Promise<{ blob: Blob; autoPopulated: number }> {
    const res = await api.post<Blob>(
      '/labels/generate',
      { module, ids, ...opts },
      { responseType: 'blob' },
    );
    const auto = parseInt(
      (res.headers?.['x-barcodes-auto-populated'] as string) ?? '0',
      10,
    );
    return { blob: res.data, autoPopulated: isNaN(auto) ? 0 : auto };
  },
};
