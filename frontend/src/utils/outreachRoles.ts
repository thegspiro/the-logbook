/**
 * Outreach role presets: the roles an event of a request type usually needs
 * (owner decision, 2026-11-20), kept on each type in Event settings.
 */
import type { OutreachEventTypeConfig, OutreachRole, StaffingRoleNeed } from '../types/event';

/** "2 × Tour Guide, 1 × Greeter (optional)", naming a role removed from settings by its value. */
export const describePreset = (preset: StaffingRoleNeed[] | undefined, roles: OutreachRole[]): string =>
  (preset ?? [])
    .map(
      (need) =>
        `${need.count} × ${roles.find((r) => r.value === need.role)?.label ?? need.role}${
          need.essential === false ? ' (optional)' : ''
        }`
    )
    .join(', ');

/**
 * The roles a new signup sheet starts from: the type's preset, keeping only
 * roles still configured, or else one of the first configured role.
 */
export const initialRoleNeeds = (
  types: OutreachEventTypeConfig[],
  typeValue: string | null | undefined,
  roles: OutreachRole[]
): StaffingRoleNeed[] => {
  const preset = (types.find((t) => t.value === typeValue)?.default_roles ?? []).filter((need) =>
    roles.some((r) => r.value === need.role)
  );
  if (preset.length > 0) return preset.map((need) => ({ ...need }));
  return roles[0] ? [{ role: roles[0].value, count: 1 }] : [];
};
