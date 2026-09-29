import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findLearningPath, learningPaths, stepKey } from './learningPaths';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const collectSourceFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'e2e') found.push(...collectSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
};

const declaredRoutes = new Set<string>();
for (const file of collectSourceFiles(SRC)) {
  for (const match of fs
    .readFileSync(file, 'utf8')
    .matchAll(/<Route\s[^>]*?path=(?:"([^"]+)"|'([^']+)'|\{"([^"]+)"\})/gs)) {
    declaredRoutes.add(match[1] ?? match[2] ?? match[3] ?? '');
  }
}

const matchers = [...declaredRoutes]
  .filter((routePath) => routePath !== '*')
  .map((routePath) => new RegExp(`^${routePath.replace(/\*/g, '.*').replace(/:[^/]+/g, '[^/]+')}$`));

describe('learning path content', () => {
  it('collected the router it is meant to check against', () => {
    // A silent zero-match sweep would pass every assertion below while
    // checking nothing at all.
    expect(declaredRoutes.size).toBeGreaterThan(100);
  });

  it('sends every step to a route that exists', () => {
    const dead = learningPaths.flatMap((learningPath) =>
      learningPath.steps
        .filter((step) => {
          const target = step.path.split(/[?#]/)[0] || '/';
          return !matchers.some((matcher) => matcher.test(target));
        })
        .map((step) => `${learningPath.id}.${step.id} -> ${step.path}`)
    );

    expect(dead, 'these lesson links drop the member on the dashboard instead').toEqual([]);
  });

  it('keeps step keys unique so progress cannot collide', () => {
    const keys = learningPaths.flatMap((learningPath) =>
      learningPath.steps.map((step) => stepKey(learningPath.id, step.id))
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every step the teaching content the lesson page renders', () => {
    for (const learningPath of learningPaths) {
      expect(learningPath.steps.length).toBeGreaterThan(0);
      for (const step of learningPath.steps) {
        expect(step.why, `${learningPath.id}.${step.id} why`).not.toHaveLength(0);
        expect(step.success, `${learningPath.id}.${step.id} success`).not.toHaveLength(0);
        expect(step.how.length, `${learningPath.id}.${step.id} how`).toBeGreaterThan(0);
      }
    }
  });

  // The lessons promise to name controls "exactly as they appear on screen",
  // and a renamed button leaves a member hunting for something that is not
  // there. Each pair ties a label a lesson quotes to the source that renders
  // it, so renaming either side without the other fails here.
  it('quotes controls by the names their screens actually render', () => {
    const quoted: [step: string, label: string, source: string][] = [
      ['getting-started.dashboard', 'Next 30 Days', 'pages/Dashboard.tsx'],
      ['getting-started.notifications', 'My Notifications', 'pages/NotificationsPage.tsx'],
      ['mobile.push', 'Push Notifications on This Device', 'pages/UserSettingsPage.tsx'],
      ['scheduling.my-shifts', 'Confirm', 'pages/scheduling/MyShiftsTab.tsx'],
      ['scheduling.open-shifts', 'Sign Up', 'pages/scheduling/OpenShiftsTab.tsx'],
      ['gear.sizes', 'My Sizes', 'modules/inventory/pages/MyEquipmentPage.tsx'],
      ['gear.request', 'Request Equipment', 'modules/inventory/pages/MyEquipmentPage.tsx'],
      ['gear.request', 'My Requests', 'modules/inventory/pages/MyEquipmentPage.tsx'],
    ];
    for (const [key, label, source] of quoted) {
      const [pathId = '', stepId = ''] = key.split('.');
      const step = findLearningPath(pathId)?.steps.find((candidate) => candidate.id === stepId);
      expect(step?.how.join(' '), `${key} names ${label}`).toContain(label);
      expect(fs.readFileSync(path.join(SRC, source), 'utf8'), `${source} renders ${label}`).toContain(label);
    }
  });

  it('always offers at least one path, whatever modules are off', () => {
    // Getting Started and the phone lesson carry no module key. If that ever
    // changes, an org with every optional module disabled gets an empty
    // Learning Center and a divide-by-zero progress bar.
    expect(learningPaths.filter((learningPath) => !learningPath.module).length).toBeGreaterThan(0);
  });

  it('resolves a known path and rejects an unknown one', () => {
    expect(findLearningPath('getting-started')?.title).toBe('Getting Started');
    expect(findLearningPath('nope')).toBeUndefined();
    expect(findLearningPath(undefined)).toBeUndefined();
  });
});
