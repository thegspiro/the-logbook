import { describe, expect, it } from 'vitest';
import { DASHBOARD_WIDGETS, dashboardWidget } from './widgetRegistry';

describe('dashboard widget registry', () => {
  it('registers each operational workflow once', () => {
    expect(new Set(DASHBOARD_WIDGETS.map(({ id }) => id)).size).toBe(8);
  });

  it('makes setup conditional rather than permanently defaulting it on', () => {
    expect(dashboardWidget('department-setup')).toMatchObject({
      permission: 'settings.manage',
      defaultEnabled: 'while-incomplete',
      queuePath: '/setup',
    });
  });

  it('links workflow summaries to filtered queues', () => {
    for (const widget of DASHBOARD_WIDGETS.filter(({ id }) => id !== 'department-setup')) {
      expect(widget.queuePath).toContain('?');
    }
  });
});
