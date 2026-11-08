/**
 * Role Management Page
 *
 * Administrative page for creating and managing custom roles and their permissions.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { DialogPanel } from '../components/ux/DialogPanel';
import { roleService } from '../services/api';
import type { Role, PermissionCategory } from '../types/role';
import { getErrorMessage } from '../utils/errorHandling';
import { mirrorsRank } from '../utils/positions';
import { PositionKind } from '../constants/enums';
import { useConfirm } from '../contexts/ConfirmContext';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { AdminPageHeader } from '../components/admin/AdminPageHeader';
import { FormField } from '../components/ux/FormField';
import { useDiscardGuard } from '../hooks/useDiscardGuard';
import { mapServerFieldErrors, type ServerFieldSpec } from '../utils/serverFieldErrors';

type RoleField = 'name' | 'description' | 'priority';

// RoleCreate / RoleUpdate (backend/app/schemas/role.py): only the name has a
// max_length; priority is ge=0 le=100.
const ROLE_FIELDS: Record<RoleField, ServerFieldSpec> = {
  name: { label: 'Role name', maxLength: 100 },
  description: { label: 'Description' },
  priority: { label: 'Priority' },
};
const ROLE_FIELD_IDS: Record<RoleField, string> = {
  name: 'role-name',
  description: 'role-description',
  priority: 'role-priority',
};

interface RoleForm {
  name: string;
  description: string;
  permissions: string[];
  priority: number;
  kind: 'office' | 'committee';
}

const sameRoleForm = (a: RoleForm, b: RoleForm) =>
  a.name === b.name &&
  a.description === b.description &&
  a.priority === b.priority &&
  a.kind === b.kind &&
  [...a.permissions].sort().join('|') === [...b.permissions].sort().join('|');

export const RoleManagementPage: React.FC = () => {
  const { confirm } = useConfirm();
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissionCategories, setPermissionCategories] = useState<PermissionCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { busy, run } = useSubmitGuard();
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const roleModalRef = useFocusTrap<HTMLDivElement>(showCreateModal);

  // W05-5: the server refuses a new or renamed position that reuses a name,
  // but positions that already shared one were left as they are. Mark them, so
  // an administrator can see which pair is which and rename one apart. Same
  // comparison as the server: trimmed, case-insensitive.
  const sharedNameKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of roles) {
      const key = r.name.trim().toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([key]) => key));
  }, [roles]);

  // Form state
  const emptyForm: RoleForm = { name: '', description: '', permissions: [], priority: 50, kind: PositionKind.OFFICE };
  const [formData, setFormData] = useState<RoleForm>(emptyForm);
  const [initialForm, setInitialForm] = useState<RoleForm>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RoleField, string | undefined>>>({});

  useEffect(() => {
    void fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [rolesData, permsData] = await Promise.all([
        roleService.getRoles(),
        roleService.getPermissionsByCategory(),
      ]);

      setRoles(rolesData);
      setPermissionCategories(permsData);
    } catch (_err) {
      setError('Could not load roles and permissions. Check your connection and refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  const openRoleDialog = (role: Role | null, form: RoleForm) => {
    setFormData(form);
    setInitialForm(form);
    setFieldErrors({});
    setEditingRole(role);
    setError(null);
    setShowCreateModal(true);
  };

  const handleCreate = () => openRoleDialog(null, emptyForm);

  const handleEdit = (role: Role) =>
    openRoleDialog(role, {
      name: role.name,
      description: role.description || '',
      permissions: role.permissions,
      priority: role.priority,
      kind: role.kind === PositionKind.COMMITTEE ? PositionKind.COMMITTEE : PositionKind.OFFICE,
    });

  // Escape and Cancel ask before a changed role is discarded (forms review F-6).
  const requestCloseRole = useDiscardGuard({
    isDirty: showCreateModal && !sameRoleForm(formData, initialForm),
    onClose: () => setShowCreateModal(false),
  });

  const showFieldErrors = (errors: Partial<Record<RoleField, string | undefined>>) => {
    setFieldErrors(errors);
    const first = (Object.keys(ROLE_FIELD_IDS) as RoleField[]).find((f) => errors[f]);
    if (first) document.getElementById(ROLE_FIELD_IDS[first])?.focus();
  };

  const clearFieldError = (field: RoleField) => setFieldErrors((prev) => ({ ...prev, [field]: undefined }));

  // ORU-7c: the baseline `member` position is held by every member, so a
  // permission change to it is an organization-wide grant (or revocation) in
  // one click. It is allowed — that is how a capability is rolled out — but
  // never without saying how many people it reaches. The server's grant
  // ceiling still applies; this is a guard against a slip, not a permission.
  const confirmBaselineGrantChange = async (role: Role): Promise<boolean> => {
    if (role.slug !== 'member') return true;
    const before = new Set(role.permissions);
    const after = new Set(formData.permissions);
    const added = formData.permissions.filter((p) => !before.has(p));
    const removed = role.permissions.filter((p) => !after.has(p));
    if (added.length === 0 && removed.length === 0) return true;

    const holders =
      role.user_count === undefined
        ? 'every member'
        : `every member (${role.user_count} ${role.user_count === 1 ? 'member' : 'members'})`;
    const changes = [
      added.length > 0 ? `grants ${added.join(', ')}` : '',
      removed.length > 0 ? `removes ${removed.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join(' and ');
    return confirm({
      title: `Change permissions for ${holders}`,
      message: `"${role.name}" is the position every member holds. Saving ${changes} for ${holders} at once.`,
      confirmLabel: role.user_count === undefined ? 'Apply to every member' : `Apply to ${role.user_count} members`,
      cancelLabel: 'Keep editing',
      variant: 'warning',
    });
  };

  const handleSubmit = () =>
    run(async () => {
      try {
        setError(null);
        setFieldErrors({});
        // Checked here so the reason is ours rather than the server's
        // "name: Value is too short" (workflow review W05).
        const name = formData.name.trim();
        if (!name) {
          showFieldErrors({ name: 'Give the role a name.' });
          return;
        }

        if (editingRole && !(await confirmBaselineGrantChange(editingRole))) {
          return;
        }

        let refused: Partial<Record<RoleField, string>> = {};
        if (editingRole) {
          // Update existing role
          const update = {
            name: name !== editingRole.name ? name : undefined,
            description: formData.description !== editingRole.description ? formData.description : undefined,
            permissions: formData.permissions,
            priority: formData.priority !== editingRole.priority ? formData.priority : undefined,
            // The platform's own positions keep their kind; the server refuses
            // a change there, so none is sent.
            kind: !editingRole.is_system && formData.kind !== editingRole.kind ? formData.kind : undefined,
          };
          try {
            await roleService.updateRole(editingRole.id, update);
          } catch (err: unknown) {
            // Single-save rule (owner, 2026-11-05): a value the role cannot
            // hold is left out, the rest is written, and the field stays
            // flagged with the server's reason until it is fixed.
            const mapped = mapServerFieldErrors(err, ROLE_FIELDS);
            const keys = mapped ? (Object.keys(mapped.fieldErrors) as RoleField[]) : [];
            if (!mapped || keys.length === 0 || mapped.unmatched.length > 0) throw err;
            refused = mapped.fieldErrors;
            const rest = { ...update };
            for (const key of keys) rest[key] = undefined;
            await roleService.updateRole(editingRole.id, rest);
          }
        } else {
          // Create new role. A refusal lands on its field and nothing is
          // created until it is fixed.
          try {
            await roleService.createRole({ ...formData, name });
          } catch (err: unknown) {
            const mapped = mapServerFieldErrors(err, ROLE_FIELDS);
            if (!mapped || Object.keys(mapped.fieldErrors).length === 0 || mapped.unmatched.length > 0) throw err;
            showFieldErrors(mapped.fieldErrors);
            return;
          }
        }

        await fetchData();
        if (Object.keys(refused).length > 0) {
          setError('The role was saved, except the field marked below. Fix it and save again.');
          showFieldErrors(refused);
          return;
        }
        setShowCreateModal(false);
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Could not save the role. Check the details and try again.'));
      }
    });

  const handleDelete = async (role: Role) => {
    if (
      !(await confirm({
        title: 'Delete role',
        message:
          role.user_count === undefined
            ? `Delete the role "${role.name}"? Members assigned to it will lose its permissions.`
            : role.user_count === 0
              ? `Delete the role "${role.name}"? No members hold it.`
              : `Delete the role "${role.name}"? ${role.user_count} ${role.user_count === 1 ? 'member holds' : 'members hold'} it and will lose its permissions.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    ) {
      return;
    }

    try {
      setError(null);
      await roleService.deleteRole(role.id);
      await fetchData();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not delete the role. Try again.'));
    }
  };

  const handleTogglePermission = (permission: string) => {
    setFormData((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(permission)
        ? prev.permissions.filter((p) => p !== permission)
        : [...prev.permissions, permission],
    }));
  };

  const handleToggleCategory = (category: PermissionCategory) => {
    const categoryPermissions = category.permissions.map((p) => p.name);
    const allSelected = categoryPermissions.every((p) => formData.permissions.includes(p));

    setFormData((prev) => ({
      ...prev,
      permissions: allSelected
        ? prev.permissions.filter((p) => !categoryPermissions.includes(p))
        : [...new Set([...prev.permissions, ...categoryPermissions])],
    }));
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <div data-page-main className="mx-auto max-w-7xl">
          <div className="flex h-64 items-center justify-center">
            <div className="text-theme-text-muted" role="status" aria-live="polite">
              Loading...
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div data-page-main className="mx-auto max-w-7xl">
        <AdminPageHeader
          title="Role Management"
          description="Create custom roles and choose what each role can do"
          className="mb-6"
          actions={
            <button
              onClick={handleCreate}
              className="btn-primary inline-flex shrink-0 items-center rounded-md text-sm font-medium"
            >
              Create Custom Role
            </button>
          }
        />

        {/* While the dialog is open its own copy of the error is the one the
            user can see; this one would sit behind the overlay. */}
        {error && !showCreateModal && (
          <div
            role="alert"
            className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10"
          >
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="bg-theme-surface overflow-hidden shadow-sm backdrop-blur-xs sm:rounded-lg">
          <ul className="divide-theme-surface-border divide-y">
            {roles.map((role) => (
              <li key={role.id} className="px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-theme-text-primary text-lg font-medium">{role.name}</h3>
                      {role.is_system && (
                        <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-500/20 dark:text-blue-400">
                          System Role
                        </span>
                      )}
                      {sharedNameKeys.has(role.name.trim().toLowerCase()) && (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-500/20 dark:text-amber-300">
                          Same name as another position
                        </span>
                      )}
                      {mirrorsRank(role) && (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-500/20 dark:text-amber-300">
                          Mirrors a rank
                        </span>
                      )}
                      {role.kind === PositionKind.COMMITTEE && (
                        <span className="inline-flex items-center rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-medium text-teal-900 dark:bg-teal-500/20 dark:text-teal-300">
                          Committee
                        </span>
                      )}
                      <span className="text-theme-text-muted text-sm">Priority: {role.priority}</span>
                    </div>
                    {mirrorsRank(role) && (
                      <p className="text-theme-text-muted mt-1 text-xs">
                        Carries the {role.name} rank&rsquo;s access, which members get from their Rank field. It is not
                        offered where positions are assigned; edit its permissions here.
                      </p>
                    )}
                    {sharedNameKeys.has(role.name.trim().toLowerCase()) && (
                      <p className="text-theme-text-muted mt-1 text-xs">
                        Internal name <code>{role.slug}</code>. Rename one of these so they can be told apart where
                        positions are assigned.
                      </p>
                    )}
                    {role.description && <p className="text-theme-text-muted mt-1 text-sm">{role.description}</p>}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {role.permissions.slice(0, 5).map((perm) => (
                        <span
                          key={perm}
                          className="bg-theme-surface text-theme-text-secondary inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium"
                        >
                          {perm}
                        </span>
                      ))}
                      {role.permissions.length > 5 && (
                        <span className="text-theme-text-muted text-xs">+{role.permissions.length - 5} more</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(role)}
                      className="touch-target-phone text-sm font-medium text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      Edit
                    </button>
                    {!role.is_system && (
                      <button
                        onClick={() => {
                          void handleDelete(role);
                        }}
                        className="touch-target-phone text-sm font-medium text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Create/Edit Role Modal */}
        {showCreateModal && (
          <div
            ref={roleModalRef}
            className="modal-overlay z-50 flex items-center justify-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="role-modal-title"
          >
            <DialogPanel
              onClose={requestCloseRole}
              className="mx-4 flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden"
            >
              <form
                noValidate
                className="flex min-h-0 flex-1 flex-col"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSubmit();
                }}
              >
                <div className="border-theme-surface-border shrink-0 border-b px-6 py-4">
                  <h3 id="role-modal-title" className="text-theme-text-primary text-lg font-medium">
                    {editingRole ? `Edit Role: ${editingRole.name}` : 'Create New Role'}
                  </h3>
                </div>

                <div
                  className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-4"
                  data-testid="role-modal-scroll-area"
                >
                  {error && (
                    <div
                      role="alert"
                      className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10"
                    >
                      <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
                    </div>
                  )}

                  {editingRole?.is_system && (
                    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-500/30 dark:bg-yellow-500/10">
                      <p className="text-sm text-yellow-800 dark:text-yellow-400">
                        {editingRole.slug === 'member'
                          ? 'This is the regular-member system role. Its display name may be customized; the internal “member” slug remains unchanged.'
                          : 'This is a system role. Only the description and permissions can be modified.'}
                      </p>
                    </div>
                  )}

                  <FormField
                    label="Role Name"
                    required
                    id={ROLE_FIELD_IDS.name}
                    error={fieldErrors.name}
                    maxLength={ROLE_FIELDS.name.maxLength}
                    count={formData.name.length}
                  >
                    {(field) => (
                      <input
                        {...field}
                        type="text"
                        autoComplete="off"
                        value={formData.name}
                        onChange={(e) => {
                          setFormData({ ...formData, name: e.target.value });
                          clearFieldError('name');
                        }}
                        disabled={editingRole?.is_system && editingRole.slug !== 'member'}
                        className="form-input"
                      />
                    )}
                  </FormField>

                  <FormField label="Description" id={ROLE_FIELD_IDS.description} error={fieldErrors.description}>
                    {(field) => (
                      <textarea
                        {...field}
                        value={formData.description}
                        onChange={(e) => {
                          setFormData({ ...formData, description: e.target.value });
                          clearFieldError('description');
                        }}
                        rows={2}
                        className="form-input"
                      />
                    )}
                  </FormField>

                  {!editingRole?.is_system && (
                    <fieldset>
                      <legend className="text-theme-text-secondary block text-sm font-medium">Kind</legend>
                      <div className="mt-1 flex flex-wrap gap-4">
                        {(
                          [
                            [
                              PositionKind.OFFICE,
                              'Office',
                              'A job with permissions, such as Treasurer or Training Officer',
                            ],
                            [
                              PositionKind.COMMITTEE,
                              'Committee',
                              'A group a member serves on, shown apart from their offices',
                            ],
                          ] as const
                        ).map(([value, label, help]) => (
                          <label key={value} className="flex items-start gap-2">
                            <input
                              type="radio"
                              name="role-kind"
                              value={value}
                              checked={formData.kind === value}
                              onChange={() => setFormData({ ...formData, kind: value })}
                              className="form-checkbox mt-0.5"
                            />
                            <span className="text-theme-text-secondary text-sm">
                              {label}
                              <span className="text-theme-text-muted block text-xs">{help}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}

                  {!editingRole?.is_system && (
                    <FormField
                      label="Priority (0-100)"
                      id={ROLE_FIELD_IDS.priority}
                      error={fieldErrors.priority}
                      // Priority orders lists and picks a member's main position
                      // (label_service, inventory_service); no permission check
                      // reads it, so it must not be described as authority
                      // (workflow review W05).
                      hint="Sets the order roles are listed in, and which of a member's roles counts as their main one. It grants no permissions."
                    >
                      {(field) => (
                        <input
                          {...field}
                          type="number"
                          min="0"
                          max="100"
                          value={formData.priority}
                          onChange={(e) => {
                            setFormData({ ...formData, priority: parseInt(e.target.value) || 0 });
                            clearFieldError('priority');
                          }}
                          className="form-input w-32"
                        />
                      )}
                    </FormField>
                  )}

                  <div role="group" aria-labelledby="role-permissions-label">
                    <p id="role-permissions-label" className="text-theme-text-secondary mb-3 block text-sm font-medium">
                      Permissions
                    </p>
                    <div className="space-y-4">
                      {permissionCategories.map((category) => {
                        const categoryPermissions = category.permissions.map((p) => p.name);
                        const allSelected = categoryPermissions.every((p) => formData.permissions.includes(p));
                        const someSelected = categoryPermissions.some((p) => formData.permissions.includes(p));

                        return (
                          <div key={category.category} className="border-theme-surface-border rounded-lg border p-4">
                            <label className="mb-2 flex cursor-pointer items-center">
                              <input
                                type="checkbox"
                                checked={allSelected}
                                ref={(input) => {
                                  if (input) input.indeterminate = someSelected && !allSelected;
                                }}
                                onChange={() => handleToggleCategory(category)}
                                className="form-checkbox border-theme-surface-border"
                              />
                              <span className="text-theme-text-primary ml-2 text-sm font-medium uppercase">
                                {category.category.replace(/_/g, ' ')}
                              </span>
                            </label>
                            <div className="ml-6 space-y-1">
                              {category.permissions.map((perm) => (
                                <label key={perm.name} className="flex cursor-pointer items-start">
                                  <input
                                    type="checkbox"
                                    checked={formData.permissions.includes(perm.name)}
                                    onChange={() => handleTogglePermission(perm.name)}
                                    className="form-checkbox border-theme-surface-border mt-0.5"
                                  />
                                  <div className="ml-2">
                                    <div className="text-theme-text-primary text-sm">{perm.name}</div>
                                    <div className="text-theme-text-muted text-xs">{perm.description}</div>
                                  </div>
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div
                  className="bg-theme-surface-modal border-theme-surface-border flex shrink-0 justify-end gap-3 border-t px-6 py-4 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]"
                  data-testid="role-modal-actions"
                >
                  <button
                    type="button"
                    onClick={requestCloseRole}
                    className="btn-secondary text-theme-text-secondary text-sm font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="btn-info rounded-md text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {editingRole ? 'Save Changes' : 'Create Role'}
                  </button>
                </div>
              </form>
            </DialogPanel>
          </div>
        )}
      </div>
    </div>
  );
};

export default RoleManagementPage;
