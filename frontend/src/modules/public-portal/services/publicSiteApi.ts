/**
 * Public Website API Service
 *
 * The settings of the website this installation publishes for the
 * department's community.
 */

import { createApiClient } from '../../../utils/createApiClient';
import type { PublicSiteSettings, PublicSiteSettingsUpdate } from '../types/publicSite';

const api = createApiClient('/api/v1/public-site');

export const getPublicSiteSettings = async (): Promise<PublicSiteSettings> => {
  const response = await api.get<PublicSiteSettings>('/settings');
  return response.data;
};

export const updatePublicSiteSettings = async (values: PublicSiteSettingsUpdate): Promise<PublicSiteSettings> => {
  const response = await api.put<PublicSiteSettings>('/settings', values);
  return response.data;
};
