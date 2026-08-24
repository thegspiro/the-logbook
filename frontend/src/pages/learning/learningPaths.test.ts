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
