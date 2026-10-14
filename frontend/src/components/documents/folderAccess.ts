/**
 * The value behind `FolderAccessFields`, and how it maps to and from a folder
 * (decision 27, docs/FILE_STORAGE_HARDENING.md). Kept apart from the component
 * so the dialogs that use it can import these without the component file
 * exporting non-components.
 */

import type { DocumentFolder } from '../../services/api';
import type { ConfirmOptions } from '../../contexts/ConfirmContext';
import { toAppError } from '../../utils/errorHandling';

export type FolderAccess = 'organization' | 'leadership' | 'roles';

export interface FolderAccessValue {
  access: FolderAccess;
  roles: string[];
  permissions: string[];
}

export const EMPTY_FOLDER_ACCESS: FolderAccessValue = { access: 'organization', roles: [], permissions: [] };

export const folderAccessOf = (folder: DocumentFolder): FolderAccessValue => ({
  access:
    folder.visibility === 'leadership'
      ? 'leadership'
      : folder.allowed_roles && folder.allowed_roles.length > 0
        ? 'roles'
        : 'organization',
  roles: folder.allowed_roles ?? [],
  // A built-in folder's list is its module rights, which this form shows but
  // never sends back.
  permissions: folder.is_system ? [] : (folder.required_permissions ?? []),
});

/** The fields a save sends; `null` clears, so a removed restriction persists. */
export const folderAccessPayload = (
  value: FolderAccessValue,
  { isSystem }: { isSystem: boolean }
): {
  visibility: 'organization' | 'leadership';
  allowed_roles: string[] | null;
  required_permissions?: string[] | null;
} => ({
  visibility: value.access === 'leadership' ? 'leadership' : 'organization',
  allowed_roles: value.access === 'roles' ? value.roles : null,
  ...(isSystem ? {} : { required_permissions: value.permissions.length > 0 ? value.permissions : null }),
});

export const folderAccessIncomplete = (value: FolderAccessValue): boolean =>
  value.access === 'roles' && value.roles.length === 0;

/** The same choice as a create payload: unset restrictions are omitted, not sent as null. */
export const folderAccessCreatePayload = (
  value: FolderAccessValue
): {
  visibility?: 'leadership';
  allowed_roles?: string[];
  required_permissions?: string[];
} => ({
  ...(value.access === 'leadership' ? { visibility: 'leadership' as const } : {}),
  ...(value.access === 'roles' ? { allowed_roles: value.roles } : {}),
  ...(value.permissions.length > 0 ? { required_permissions: value.permissions } : {}),
});

/**
 * LB-DOC-001: the server refused a folder that no active member but a full
 * administrator could open (decision 29). Not an error to show — a question
 * to ask, after which the save is sent again with `confirm_admin_only`.
 */
export const isAdminOnlyRefusal = (err: unknown): boolean => toAppError(err).code === 'LB-DOC-001';

export const ADMIN_ONLY_CONFIRMATION: ConfirmOptions = {
  title: 'Only full administrators could open this folder',
  message:
    'No active member holds what these settings require — a permission nobody has, a position nobody fills, or a restriction on a folder above it. Save it anyway if it is meant for administrators only.',
  confirmLabel: 'Save for administrators only',
  cancelLabel: 'Go back and change it',
  variant: 'warning',
};
