/**
 * documentsService — extracted from services/api.ts
 */

import api from './apiClient';
import type { DocumentFolder, DocumentRecord, DocumentsSummary } from './formsServices';

export const documentsService = {
  async getFolders(parentId?: string): Promise<{ folders: DocumentFolder[]; total: number }> {
    const params: Record<string, string> = {};
    if (parentId) params.parent_id = parentId;
    const response = await api.get<{ folders: DocumentFolder[]; total: number }>('/documents/folders', { params });
    return response.data;
  },

  async createFolder(data: { name: string; description?: string; color?: string; icon?: string; parent_id?: string }): Promise<DocumentFolder> {
    const response = await api.post<DocumentFolder>('/documents/folders', data);
    return response.data;
  },

  async updateFolder(folderId: string, data: Partial<{ name: string; description: string; color: string }>): Promise<DocumentFolder> {
    const response = await api.patch<DocumentFolder>(`/documents/folders/${folderId}`, data);
    return response.data;
  },

  async deleteFolder(folderId: string): Promise<void> {
    await api.delete(`/documents/folders/${folderId}`);
  },

  async getDocuments(params?: { folder_id?: string; search?: string; skip?: number; limit?: number }): Promise<{ documents: DocumentRecord[]; total: number; skip: number; limit: number }> {
    const response = await api.get<{ documents: DocumentRecord[]; total: number; skip: number; limit: number }>('/documents', { params });
    return response.data;
  },

  async uploadDocument(formData: FormData): Promise<DocumentRecord> {
    const response = await api.post<DocumentRecord>('/documents/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async getDocument(documentId: string): Promise<DocumentRecord> {
    const response = await api.get<DocumentRecord>(`/documents/${documentId}`);
    return response.data;
  },

  async updateDocument(documentId: string, data: Partial<{ name: string; description: string; folder_id: string; tags: string; status: string }>): Promise<DocumentRecord> {
    const response = await api.patch<DocumentRecord>(`/documents/${documentId}`, data);
    return response.data;
  },

  async deleteDocument(documentId: string): Promise<void> {
    await api.delete(`/documents/${documentId}`);
  },

  async getSummary(): Promise<DocumentsSummary> {
    const response = await api.get<DocumentsSummary>('/documents/stats/summary');
    return response.data;
  },

  async getMyFolder(): Promise<DocumentFolder> {
    const response = await api.get<DocumentFolder>('/documents/my-folder');
    return response.data;
  },
};

// ============================================
// Meetings (Minutes) Service
// ============================================

export interface MeetingRecord {
  id: string;
  organization_id: string;
  title: string;
  meeting_type: string;
  meeting_date: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  called_by?: string;
  status: string;
  agenda?: string;
  notes?: string;
  motions?: string;
  approved_by?: string;
  approved_at?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  creator_name?: string;
  attendee_count: number;
  action_item_count: number;
  attendees?: MeetingAttendee[];
  action_items?: MeetingActionItem[];
}

export interface MeetingAttendee {
  id: string;
  meeting_id: string;
  user_id: string;
  present: boolean;
  excused: boolean;
  user_name?: string;
  created_at: string;
}

export interface MeetingActionItem {
  id: string;
  meeting_id: string;
  organization_id: string;
  description: string;
  assigned_to?: string;
  assignee_name?: string;
  due_date?: string;
  status: string;
  priority: number;
  completed_at?: string;
  completion_notes?: string;
  created_at: string;
  updated_at: string;
}

export interface MeetingsSummary {
  total_meetings: number;
  meetings_this_month: number;
  open_action_items: number;
  pending_approval: number;
}
