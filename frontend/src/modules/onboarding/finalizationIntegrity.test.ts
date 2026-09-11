/**
 * Exactly one onboarding page finalizes setup, and it is the last step's.
 *
 * `completeOnboarding` latches the install: `complete_onboarding` refuses a
 * second call, and every remaining `/session/*` step is rejected afterwards by
 * the post-completion replay guards that protect a provisioned org. So calling
 * it from anywhere but the final step does not merely finish early — it leaves
 * the rest of the wizard unable to save anything, while still walking the
 * operator through those screens.
 *
 * The call sat on Module Selection because that step happened to be last.
 * When the order changed it had to move, and nothing would have said so: the
 * page tests mock the client, and a half-finalized setup still renders. This
 * pins the call to whatever page the final step's route points at, so the next
 * reorder either moves it too or fails here.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ONBOARDING_STEPS } from './config/steps';

const MODULE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const PAGES_DIR = path.join(MODULE_DIR, 'pages');

/** Route path -> page source file, read off the module's own route table. */
const routeToPageFile = (): Map<string, string> => {
  const routes = fs.readFileSync(path.join(MODULE_DIR, 'routes.tsx'), 'utf8');
  const index = fs.readFileSync(path.join(PAGES_DIR, 'index.ts'), 'utf8');

  // `export { default as SystemOwnerCreation } from './AdminUserCreation';`
  const exportToFile = new Map<string, string>();
  for (const [, exported, file] of index.matchAll(/export \{ default as (\w+) \} from '\.\/(\w+)'/g)) {
    if (exported && file) exportToFile.set(exported, `${file}.tsx`);
  }

  // `<Route path="/onboarding/start" element={<OrganizationSetup />} />`
  const map = new Map<string, string>();
  for (const [, routePath, element] of routes.matchAll(/<Route path="([^"]+)" element=\{<(\w+) \/>\}/g)) {
    const file = element ? exportToFile.get(element) : undefined;
    if (routePath && file) map.set(routePath, file);
  }
  return map;
};

/** Narrowing outside a test body — see config/steps.test.ts for why. */
const lastStep = (): (typeof ONBOARDING_STEPS)[number] => {
  const step = ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1];
  if (!step) throw new Error('ONBOARDING_STEPS is empty');
  return step;
};

const pageFiles = (): string[] => fs.readdirSync(PAGES_DIR).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'));

const callsComplete = (file: string): boolean =>
  /\bcompleteOnboarding\s*\(/.test(fs.readFileSync(path.join(PAGES_DIR, file), 'utf8'));

describe('onboarding finalization', () => {
  it('is called from exactly one page', () => {
    const finalizers = pageFiles().filter(callsComplete);
    expect(finalizers).toHaveLength(1);
  });

  it('is called from the page the last step routes to', () => {
    const last = lastStep();
    const lastPage = routeToPageFile().get(last.path);

    expect(lastPage, `no route renders ${last.path}`).toBeDefined();
    expect(pageFiles().filter(callsComplete)).toEqual([lastPage]);
  });

  it('maps every declared step to a route', () => {
    // A step whose path no route renders is a dead end in the flow.
    const routes = routeToPageFile();
    for (const step of ONBOARDING_STEPS) {
      expect(routes.get(step.path), `${step.key} -> ${step.path}`).toBeDefined();
    }
  });
});
