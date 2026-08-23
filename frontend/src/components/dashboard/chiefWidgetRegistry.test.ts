import { describe, expect, it } from 'vitest';
import { canViewChiefDashboard, CHIEF_WIDGET_REGISTRY } from './chiefWidgetRegistry';

describe('chief widget registry', () => {
  it('does not treat settings.manage as blanket dashboard access', () => {
    expect(CHIEF_WIDGET_REGISTRY.flatMap((widget) => widget.requiredAnyPermission)).not.toContain('settings.manage');
    expect(canViewChiefDashboard((permission) => permission === 'settings.manage')).toBe(false);
  });

  it('permits a leader with one underlying management permission', () => {
    expect(canViewChiefDashboard((permission) => permission === 'notifications.manage')).toBe(true);
  });
});
