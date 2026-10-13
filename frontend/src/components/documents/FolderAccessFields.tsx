/**
 * Who may open a document folder — shared by the Create Folder and Manage
 * folder dialogs, so a restricted folder is never created open and then
 * closed afterwards.
 *
 * Owner decision 27 (docs/FILE_STORAGE_HARDENING.md): a folder opens to the
 * organization, to leadership (the document managers), or to specific
 * positions, and may also require a permission — any one of those chosen
 * admits. A built-in folder keeps its module rights (decision 19), shown here
 * read-only; it can only be narrowed further. The server enforces all of this
 * and refuses settings that would shut the editor out of the folder.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { documentsService, roleService } from '../../services/api';
import type { FolderRoleOption } from '../../services/documentsService';
import type { PermissionCategory } from '../../types/role';
import { folderAccessIncomplete, type FolderAccess, type FolderAccessValue } from './folderAccess';

const ACCESS_OPTIONS: ReadonlyArray<readonly [FolderAccess, string, string]> = [
  ['organization', 'Organization', 'Every member who can open Documents.'],
  ['leadership', 'Leadership', 'Officers who manage the department’s documents.'],
  ['roles', 'Specific positions', 'Only members holding one of the positions you choose.'],
];

interface FolderAccessFieldsProps {
  value: FolderAccessValue;
  onChange: (value: FolderAccessValue) => void;
  /** A built-in folder's module rights, shown read-only; omit for a custom folder. */
  moduleRights?: string[] | null | undefined;
  /** Prefix for element ids, so two instances never share one. */
  idPrefix: string;
}

export const FolderAccessFields: React.FC<FolderAccessFieldsProps> = ({ value, onChange, moduleRights, idPrefix }) => {
  const [roleOptions, setRoleOptions] = useState<FolderRoleOption[] | null>(null);
  const [removedStale, setRemovedStale] = useState(0);
  const [categories, setCategories] = useState<PermissionCategory[] | null>(null);
  const [filter, setFilter] = useState('');
  const isSystem = moduleRights !== undefined;

  useEffect(() => {
    let cancelled = false;
    documentsService
      .getFolderRoleOptions()
      .then((options) => {
        if (!cancelled) setRoleOptions(options);
      })
      .catch(() => {
        if (!cancelled) setRoleOptions([]);
      });
    roleService
      .getPermissionsByCategory()
      .then((list) => {
        if (!cancelled) setCategories(list);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A folder can still name a position that no longer exists: one deleted
  // before folders stored ids, kept by migration 5b2e9c7d4a18 so the folder
  // stayed closed. It matches nobody, and the server refuses it on save, so it
  // is dropped here — visibly — once the department's positions are known.
  // Never while they failed to load: an empty list would drop every entry.
  useEffect(() => {
    if (!roleOptions || roleOptions.length === 0) return;
    const known = new Set(roleOptions.map((role) => role.id));
    const kept = value.roles.filter((id) => known.has(id));
    if (kept.length === value.roles.length) return;
    setRemovedStale((count) => count + value.roles.length - kept.length);
    onChange({ ...value, roles: kept });
  }, [roleOptions, value, onChange]);

  const descriptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of categories ?? []) {
      for (const permission of category.permissions) map.set(permission.name, permission.description);
    }
    return map;
  }, [categories]);

  const visibleCategories = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (categories ?? [])
      .map((category) => ({
        ...category,
        permissions: category.permissions.filter(
          (permission) =>
            !needle ||
            permission.name.toLowerCase().includes(needle) ||
            permission.description.toLowerCase().includes(needle)
        ),
      }))
      .filter((category) => category.permissions.length > 0);
  }, [categories, filter]);

  const toggle = (list: string[], item: string, on: boolean) =>
    on ? [...list, item] : list.filter((entry) => entry !== item);

  const rolesMissing = folderAccessIncomplete(value);

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-theme-text-primary mb-1 text-sm font-medium">Who can open it</legend>
        {ACCESS_OPTIONS.map(([option, label, hint]) => (
          <label key={option} className="border-theme-surface-border flex cursor-pointer gap-2 rounded-md border p-3">
            <input
              type="radio"
              name={`${idPrefix}-access`}
              checked={value.access === option}
              onChange={() => onChange({ ...value, access: option })}
              aria-labelledby={`${idPrefix}-access-${option}-label`}
              aria-describedby={`${idPrefix}-access-${option}-hint`}
            />
            <span>
              <span
                id={`${idPrefix}-access-${option}-label`}
                className="text-theme-text-primary block text-sm font-medium"
              >
                {label}
              </span>
              <span id={`${idPrefix}-access-${option}-hint`} className="text-theme-text-muted block text-xs">
                {hint}
              </span>
            </span>
          </label>
        ))}
        {value.access === 'roles' && (
          <div className="border-theme-surface-border rounded-md border p-3">
            {roleOptions === null ? (
              <p className="text-theme-text-muted text-sm">Loading positions…</p>
            ) : roleOptions.length === 0 ? (
              <p className="text-theme-text-muted text-sm">No positions could be loaded.</p>
            ) : (
              <div className="grid gap-1 sm:grid-cols-2" role="group" aria-label="Positions">
                {roleOptions.map((role) => (
                  <label key={role.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={value.roles.includes(role.id)}
                      onChange={(event) =>
                        onChange({ ...value, roles: toggle(value.roles, role.id, event.target.checked) })
                      }
                    />
                    <span className="text-theme-text-primary">{role.name}</span>
                  </label>
                ))}
              </div>
            )}
            {removedStale > 0 && (
              <p className="text-theme-text-secondary mt-2 text-xs" role="status">
                {removedStale === 1 ? 'A position' : `${removedStale} positions`} this folder listed no longer
                {removedStale === 1 ? ' exists and was' : ' exist and were'} taken off. Saving keeps it that way.
              </p>
            )}
            {rolesMissing && (
              <p className="text-theme-text-muted mt-2 text-xs" role="status">
                Choose at least one position.
              </p>
            )}
          </div>
        )}
      </fieldset>

      {isSystem ? (
        moduleRights && moduleRights.length > 0 ? (
          <div className="text-sm">
            <p className="text-theme-text-primary font-medium">Module rights</p>
            <p className="text-theme-text-muted text-xs">
              A built-in folder opens only to members holding one of these, whatever is chosen above. They can’t be
              changed here.
            </p>
            <ul className="text-theme-text-secondary mt-1 list-disc pl-5">
              {moduleRights.map((name) => (
                <li key={name}>{descriptions.get(name) ?? name}</li>
              ))}
            </ul>
          </div>
        ) : null
      ) : (
        <fieldset className="space-y-2">
          <legend className="text-theme-text-primary text-sm font-medium">Also require a permission</legend>
          <p className="text-theme-text-muted text-xs">
            Optional. When you pick any, a member also needs at least one of them — for example, Inventory management
            for the quartermaster’s files. A permission follows the member through position changes.
          </p>
          {value.permissions.length > 0 && (
            <p className="text-theme-text-secondary text-xs" role="status">
              {value.permissions.length} selected:{' '}
              {value.permissions.map((name) => descriptions.get(name) ?? name).join(', ')}
            </p>
          )}
          <input
            type="search"
            className="form-input"
            placeholder="Filter permissions"
            aria-label="Filter permissions"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <div className="border-theme-surface-border max-h-56 overflow-y-auto rounded-md border p-3">
            {categories === null ? (
              <p className="text-theme-text-muted text-sm">Loading permissions…</p>
            ) : visibleCategories.length === 0 ? (
              <p className="text-theme-text-muted text-sm">No permissions match.</p>
            ) : (
              visibleCategories.map((category) => (
                <div key={category.category} className="mb-3 last:mb-0" role="group" aria-label={category.category}>
                  <p className="text-theme-text-muted mb-1 text-xs font-semibold tracking-wide uppercase">
                    {category.category.replace(/_/g, ' ')}
                  </p>
                  {category.permissions.map((permission) => (
                    <label key={permission.name} className="flex items-start gap-2 py-0.5 text-sm">
                      <input
                        type="checkbox"
                        className="form-checkbox mt-0.5"
                        checked={value.permissions.includes(permission.name)}
                        onChange={(event) =>
                          onChange({
                            ...value,
                            permissions: toggle(value.permissions, permission.name, event.target.checked),
                          })
                        }
                      />
                      <span className="text-theme-text-primary">
                        {permission.description}
                        <span className="text-theme-text-muted block font-mono text-xs">{permission.name}</span>
                      </span>
                    </label>
                  ))}
                </div>
              ))
            )}
          </div>
        </fieldset>
      )}
    </div>
  );
};

export default FolderAccessFields;
