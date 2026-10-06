/**
 * CR80 member ID card printing (/member-id-cards).
 *
 * The PDF is one card side per page at exactly 3.375 x 2.125 in, which is what
 * every ID card printer's ordinary driver accepts; the department's chosen
 * layout is stored server-side so every officer prints the same card.
 */

import api from './apiClient';
import type { IdCardOrientation, IdCardSides } from '../constants/enums';
import type { Symbology } from './labelService';

export interface IdCardLayout {
  orientation: IdCardOrientation;
  sides: IdCardSides;
  symbology: Symbology;
}

export const memberIdCardService = {
  async getLayout(): Promise<IdCardLayout> {
    const res = await api.get<IdCardLayout>('/member-id-cards/layout');
    return res.data;
  },

  async saveLayout(layout: IdCardLayout): Promise<IdCardLayout> {
    const res = await api.put<IdCardLayout>('/member-id-cards/layout', layout);
    return res.data;
  },

  async generatePdf(userIds: string[], layout: IdCardLayout): Promise<Blob> {
    const res = await api.post<Blob>(
      '/member-id-cards/pdf',
      { user_ids: userIds, ...layout },
      { responseType: 'blob' }
    );
    return res.data;
  },
};
