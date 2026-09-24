/**
 * Target Role Picker
 *
 * One control, three surfaces: the add-applicant form, the drawer's contact
 * editor, and the conversion dialog. The role an applicant is being brought in
 * to hold is decided during the pipeline and applied by the transfer, so every
 * screen that shows it can also set it — a read-only display was how the field
 * ended up with three readers and no producer.
 *
 * Positions are org-scoped by the API. The backend re-validates the chosen id
 * against the caller's organization before storing it (XC-1), so this list is
 * a convenience, not the check.
 */

import React, { useEffect, useState } from 'react';
import { roleService } from '../../../services/api';
import type { Role } from '../../../types/role';

interface TargetRolePickerProps {
  /** Selected position id, or '' for none. */
  value: string;
  onChange: (roleId: string) => void;
  /** Rendered above the control; omitted where a caller supplies its own. */
  label?: string | undefined;
  /** Help text under the control. */
  hint?: string | undefined;
  disabled?: boolean | undefined;
  id?: string | undefined;
}

const TargetRolePicker: React.FC<TargetRolePickerProps> = ({
  value,
  onChange,
  label = 'Target Role',
  hint,
  disabled = false,
  id = 'target-role',
}) => {
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const loaded = await roleService.getRoles();
        if (!cancelled) setRoles(loaded);
      } catch {
        // A failed lookup must not block the form it sits in: the role is
        // optional everywhere it appears, and the rest of the dialog still
        // saves. Say so rather than rendering an empty picker that looks
        // like a department with no positions.
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      {label && (
        <label htmlFor={id} className="form-label">
          {label}
        </label>
      )}
      <select
        id={id}
        className="form-input"
        value={value}
        disabled={disabled || isLoading || failed}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">
          {isLoading ? 'Loading positions…' : failed ? 'Positions unavailable' : 'No specific role'}
        </option>
        {roles.map((role) => (
          <option key={role.id} value={role.id}>
            {role.name}
          </option>
        ))}
      </select>
      {failed ? (
        <p className="text-theme-text-muted mt-1 text-xs">
          Positions could not be loaded. The applicant can be saved without one and it can be set later.
        </p>
      ) : (
        hint && <p className="text-theme-text-muted mt-1 text-xs">{hint}</p>
      )}
    </div>
  );
};

export default TargetRolePicker;
