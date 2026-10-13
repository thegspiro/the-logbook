import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DASHBOARD_WIDGETS, dashboardWidget } from './widgetRegistry';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const collectSourceFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
};

/** Every widget id a non-test source file reads through `dashboardWidget('…')`. */
const readIds = (): Set<string> => {
  const ids = new Set<string>();
  for (const file of collectSourceFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/dashboardWidget\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      ids.add(match[1] ?? '');
    }
  }
  return ids;
};

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

  // DASH-1: `wired` is only honest if it tracks the real readers. A screen that
  // starts reading an entry must flip it, and an entry left marked wired after
  // its reader is removed fails here too.
  it('marks exactly the entries a screen reads as wired', () => {
    const wired = new Set(DASHBOARD_WIDGETS.filter(({ wired: isWired }) => isWired).map(({ id }) => id));
    expect(wired).toEqual(readIds());
  });

  it('never marks a widget wired whose aggregate endpoint was not built', () => {
    for (const widget of DASHBOARD_WIDGETS.filter(({ wired: isWired }) => isWired)) {
      expect(widget.aggregateEndpoint).toBe('mounted');
    }
  });

  it('records the five aggregate endpoints that do not exist', () => {
    expect(
      DASHBOARD_WIDGETS.filter(({ aggregateEndpoint }) => aggregateEndpoint === 'not-built')
        .map(({ id }) => id)
        .sort()
    ).toEqual(['admin-hours', 'communications', 'meeting-governance', 'membership-status', 'onboarding-completion']);
  });
});
