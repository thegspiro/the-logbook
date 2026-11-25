/**
 * The "Today in history" widget's one request. Deliberately anonymous: the
 * widget is framed on the department's own website, where nobody is signed
 * in, and its secret link is its only credential. So it uses bare axios with
 * no cookies, rather than a module client with the session and CSRF set up.
 */
import axios from 'axios';
import type { HistoryWidgetToday } from '../types';

// The public API lives at /api/public/v1, outside the /api/v1 prefix.
const PUBLIC_API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/v\d+$/, '');

export const historyWidgetService = {
  async today(token: string): Promise<HistoryWidgetToday> {
    const { data } = await axios.get<HistoryWidgetToday>(
      `${PUBLIC_API_BASE}/public/v1/history/widget/${encodeURIComponent(token)}/today`,
      { withCredentials: false }
    );
    return data;
  },
};
