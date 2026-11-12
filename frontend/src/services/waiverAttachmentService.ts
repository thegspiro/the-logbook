/**
 * waiverAttachmentService — documents filed with an attendance waiver request.
 *
 * A department's waiver policy decides whether a member may, or must, file a
 * document (a doctor's note) with a request to be excused. The backend checks
 * every rule; the constants here only let a form say so before the upload.
 *
 * Every route sits under `/training/waivers/`, which `UNCACHEABLE_PREFIXES`
 * already keeps out of the response cache, and the download is sent
 * `Cache-Control: no-store`. Responses are snake_case (training module).
 */

import api from './apiClient';
import { saveBlob } from '../utils/saveBlob';

const BASE = '/training/waivers/requests';

/** Owner decisions, 2026-11-10. Mirrors `MAX_ATTACHMENTS` / `MAX_ATTACHMENT_BYTES`. */
export const WAIVER_ATTACHMENT_MAX_COUNT = 3;
export const WAIVER_ATTACHMENT_MAX_MB = 10;
export const WAIVER_ATTACHMENT_MAX_BYTES = WAIVER_ATTACHMENT_MAX_MB * 1024 * 1024;

/**
 * What the file picker offers. HEIC is listed by extension as well as type:
 * browsers other than Safari report an iPhone photo with an empty type.
 */
export const WAIVER_ATTACHMENT_ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif';
export const WAIVER_ATTACHMENT_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.heic', '.heif'] as const;
export const WAIVER_ATTACHMENT_TYPES_LABEL = 'PDF, JPEG, PNG or HEIC';

export const WaiverAttachmentMode = {
  OFF: 'off',
  OPTIONAL: 'optional',
  REQUIRED: 'required',
} as const;
export type WaiverAttachmentMode = (typeof WaiverAttachmentMode)[keyof typeof WaiverAttachmentMode];

/** One filed document. `filename` is the neutral download name, never the uploader's. */
export interface WaiverAttachment {
  id: string;
  ordinal: number;
  filename: string;
  mime_type: string;
  file_size: number;
  uploaded_at: string;
}

/** The fields of a submission besides its files. */
export interface WaiverSubmitWithAttachments {
  event_id: string;
  category?: string | undefined;
  reason?: string | undefined;
}

function filesForm(files: readonly File[], fields: Record<string, string | undefined> = {}): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    // Omit blanks rather than send "" (pitfall #1): the backend treats an
    // absent category or reason as not given.
    if (value) form.append(key, value);
  }
  for (const file of files) form.append('files', file);
  return form;
}

const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' } };

export const waiverAttachmentService = {
  /**
   * Ask to be excused, filing documents with the request in one call. The
   * request and its documents are saved together or not at all. Resolves to
   * the request as the backend returns it.
   */
  async submitWithAttachments<T = unknown>(body: WaiverSubmitWithAttachments, files: readonly File[]): Promise<T> {
    const response = await api.post<T>(
      `${BASE}/with-attachments`,
      filesForm(files, { event_id: body.event_id, category: body.category, reason: body.reason }),
      MULTIPART
    );
    return response.data;
  },

  /** File more documents with the caller's own pending request. */
  async addAttachments<T = unknown>(requestId: string, files: readonly File[]): Promise<T> {
    const response = await api.post<T>(
      `${BASE}/${encodeURIComponent(requestId)}/attachments`,
      filesForm(files),
      MULTIPART
    );
    return response.data;
  },

  /** Fetch one document through the authenticated client and save it under its neutral name. */
  async downloadAttachment(requestId: string, attachment: WaiverAttachment): Promise<void> {
    const response = await api.get<Blob>(
      `${BASE}/${encodeURIComponent(requestId)}/attachments/${encodeURIComponent(attachment.id)}`,
      { responseType: 'blob' }
    );
    saveBlob(response.data, attachment.filename);
  },
};

/** Why a chosen file would be refused, or null when it is acceptable. */
export function waiverAttachmentProblem(file: File): string | null {
  const name = file.name.toLowerCase();
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  if (!(WAIVER_ATTACHMENT_EXTENSIONS as readonly string[]).includes(extension)) {
    return `${file.name} is not a ${WAIVER_ATTACHMENT_TYPES_LABEL} file.`;
  }
  if (file.size > WAIVER_ATTACHMENT_MAX_BYTES) {
    return `${file.name} is larger than ${WAIVER_ATTACHMENT_MAX_MB} MB.`;
  }
  if (file.size === 0) {
    return `${file.name} is empty.`;
  }
  return null;
}

/** Every reason the chosen files would be refused, the count included. */
export function waiverSelectionProblems(files: readonly File[], alreadyFiled: number): string[] {
  const problems = files.map(waiverAttachmentProblem).filter((p): p is string => p !== null);
  const room = WAIVER_ATTACHMENT_MAX_COUNT - alreadyFiled;
  if (files.length > room) {
    const extra = files.length - room;
    problems.push(
      `A request can hold at most ${WAIVER_ATTACHMENT_MAX_COUNT} documents. Remove ${extra} ${extra === 1 ? 'file' : 'files'}.`
    );
  }
  return problems;
}
