/**
 * Undo a mistaken drop (W15-3).
 *
 * The server decides whether a drop can still be undone (within a week of it)
 * and says until when; the screen shows the control only when it says yes.
 */

import api from './apiClient';

export interface UndoDropAvailability {
  available: boolean;
  available_until?: string | null | undefined;
  detail?: string | null | undefined;
}

export type UndoDropRestoreStatus = 'active' | 'probationary' | 'inactive' | 'leave';

export const undoDropService = {
  async getAvailability(userId: string): Promise<UndoDropAvailability> {
    const response = await api.get<UndoDropAvailability>(`/users/${userId}/undo-drop`);
    return response.data;
  },

  async undoDrop(
    userId: string,
    data: { restore_status: UndoDropRestoreStatus; reason?: string | undefined }
  ): Promise<{ user_id: string; previous_status: string; new_status: string }> {
    const response = await api.post<{ user_id: string; previous_status: string; new_status: string }>(
      `/users/${userId}/undo-drop`,
      data
    );
    return response.data;
  },
};
