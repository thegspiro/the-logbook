/**
 * Choices for an approval step's named approver.
 *
 * Each list comes from an endpoint with its own permission gate — positions
 * need positions.view or roles.view, members need users.view, members.view or
 * members.manage — and finance.configure_approvals implies none of them. A list
 * that fails to load is `null`, and the step form falls back to a text field
 * for that approver type rather than offering an empty picker.
 */

import { useEffect, useState } from 'react';
import { roleService, userService } from '../../../services/api';

export interface ApproverOption {
  value: string;
  label: string;
}

export interface ApproverOptions {
  positions: ApproverOption[] | null;
  permissions: ApproverOption[] | null;
  users: ApproverOption[] | null;
}

const byLabel = (a: ApproverOption, b: ApproverOption) => a.label.localeCompare(b.label);

export function useApproverOptions(): ApproverOptions {
  const [options, setOptions] = useState<ApproverOptions>({ positions: null, permissions: null, users: null });

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([roleService.getRoles(), roleService.getPermissions(), userService.getUsers()]).then(
      ([roles, permissions, users]) => {
        if (cancelled) return;
        setOptions({
          // approver_value holds a position's slug, per FINANCE_MODULE.md.
          positions:
            roles.status === 'fulfilled'
              ? roles.value.map((r) => ({ value: r.slug, label: r.name })).sort(byLabel)
              : null,
          permissions:
            permissions.status === 'fulfilled'
              ? permissions.value.map((p) => ({ value: p.name, label: p.name })).sort(byLabel)
              : null,
          users:
            users.status === 'fulfilled'
              ? users.value
                  .map((u) => ({
                    value: u.id,
                    label: u.full_name || [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.username,
                  }))
                  .sort(byLabel)
              : null,
        });
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return options;
}
