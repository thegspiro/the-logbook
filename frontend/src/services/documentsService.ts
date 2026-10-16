/**
 * documentsService — extracted from services/api.ts
 */

import api from './apiClient';
import type { DocumentFolder, DocumentRecord, DocumentsSummary } from './formsServices';

/** A position a folder can be restricted to; `allowed_roles` holds its `id`. */
export interface FolderRoleOption {
  id: string;
  slug: string;
  name: string;
}

export const documentsService = {
  async getFolders(params?: {
    parent_id?: string;
    skip?: number;
    limit?: number;
  }): Promise<{ folders: DocumentFolder[]; total: number; skip: number; limit: number }> {
    const response = await api.get<{ folders: DocumentFolder[]; total: number; skip: number; limit: number }>(
      '/documents/folders',
      { params }
    );
    return response.data;
  },

  async createFolder(data: {
    name: string;
    description?: string | undefined;
    color?: string | undefined;
    icon?: string | undefined;
    parent_id?: string | undefined;
    visibility?: 'organization' | 'leadership' | undefined;
    allowed_roles?: string[] | null | undefined;
    required_permissions?: string[] | null | undefined;
    /** Confirms a folder only full administrators could open (LB-DOC-001). */
    confirm_admin_only?: boolean | undefined;
  }): Promise<DocumentFolder> {
    const response = await api.post<DocumentFolder>('/documents/folders', data);
    return response.data;
  },

  /**
   * Update payload: an omitted key is left alone, `null` clears it
   * (`description`, `allowed_roles`, `required_permissions`, `parent_id` —
   * null moves to the top level).
   */
  async updateFolder(
    folderId: string,
    data: Partial<{
      name: string;
      description: string | null;
      color: string;
      parent_id: string | null;
      visibility: 'organization' | 'leadership';
      allowed_roles: string[] | null;
      required_permissions: string[] | null;
      confirm_admin_only: boolean;
    }>
  ): Promise<DocumentFolder> {
    const response = await api.patch<DocumentFolder>(`/documents/folders/${folderId}`, data);
    return response.data;
  },

  /** Positions a folder can be restricted to (documents.manage). A folder stores their ids. */
  async getFolderRoleOptions(): Promise<FolderRoleOption[]> {
    const response = await api.get<FolderRoleOption[]>('/documents/folders/role-options');
    return response.data;
  },

  /**
   * Folders nobody but full administrators can open now and nobody has
   * confirmed are meant that way (decision 30). Empty for anyone but a full
   * administrator.
   */
  async getAdminOnlyFolders(): Promise<DocumentFolder[]> {
    const response = await api.get<DocumentFolder[]>('/documents/folders/admin-only');
    return response.data;
  },

  /** Confirm a folder is meant for full administrators alone; it stops being listed. */
  async confirmAdminOnlyFolder(folderId: string): Promise<DocumentFolder> {
    const response = await api.post<DocumentFolder>(`/documents/folders/${folderId}/confirm-admin-only`);
    return response.data;
  },

  async deleteFolder(folderId: string): Promise<void> {
    await api.delete(`/documents/folders/${folderId}`);
  },

  async getDocuments(params?: {
    folder_id?: string;
    skip?: number;
    limit?: number;
    search?: string;
    status?: string;
  }): Promise<{ documents: DocumentRecord[]; total: number; skip: number; limit: number }> {
    const response = await api.get<{ documents: DocumentRecord[]; total: number; skip: number; limit: number }>(
      '/documents',
      { params }
    );
    return response.data;
  },

  async uploadDocument(formData: FormData): Promise<DocumentRecord> {
    const response = await api.post<DocumentRecord>('/documents/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async downloadDocument(documentId: string): Promise<Blob> {
    const response = await api.get<Blob>(`/documents/${documentId}/download`, {
      responseType: 'blob',
    });
    return response.data;
  },

  async deleteDocument(documentId: string): Promise<void> {
    await api.delete(`/documents/${documentId}`);
  },

  async getSummary(): Promise<DocumentsSummary> {
    const response = await api.get<DocumentsSummary>('/documents/stats/summary');
    return response.data;
  },
};

// ============================================
// Meetings (Minutes) Service
// ============================================

/** A Documents-library file linked from an agenda item. */
export interface AgendaDocument {
  id: string;
  name: string;
}

/** One item of a meeting's agenda; it becomes a section of the meeting's minutes. */
export interface AgendaItem {
  /** Stable across edits; the minutes section made from this item is `agenda-<key>`. */
  key: string;
  title: string;
  presenter: string;
  notes: string;
  needs_motion: boolean;
  motion_text: string;
  documents: AgendaDocument[];
}

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
  agenda_items?: AgendaItem[];
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
