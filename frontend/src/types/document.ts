/**
 * Document Module Type Definitions
 */

export type DocumentType = 'uploaded' | 'generated';

export interface DocumentFolder {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description?: string;
  parent_folder_id?: string;
  sort_order: number;
  is_system: boolean;
  icon?: string;
  color?: string;
  document_count: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentItem {
  id: string;
  organization_id: string;
  folder_id: string;
  title: string;
  description?: string;
  document_type: DocumentType;
  file_path?: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  content_html?: string;
  source_type?: string;
  source_id?: string;
  tags?: string[];
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentListItem {
  id: string;
  folder_id: string;
  title: string;
  description?: string;
  document_type: DocumentType;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  source_type?: string;
  tags?: string[];
  created_by?: string;
  created_at: string;
}

export interface FolderCreate {
  name: string;
  slug: string;
  description?: string;
  parent_folder_id?: string;
  sort_order?: number;
  icon?: string;
  color?: string;
}
