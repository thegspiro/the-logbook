/**
 * Pipeline refresh integrity
 *
 * The prospective-members screen draws its stat header and its applicant list
 * from two separate requests. A mutation that refreshes only the list leaves
 * the header describing the pipeline as it was beforehand, and the result is
 * not a subtle inconsistency — it reads as lost applicants. Converting the
 * last two active applicants left "Total Active: 2" standing over an empty
 * table with "Converted: 0" next to it, because `ConversionModal` called
 * `fetchApplicants` and nothing else.
 *
 * That was one call site out of roughly ten getting it wrong, which is a
 * counting problem rather than a reasoning one: every other mutation had
 * remembered to pair a `fetchPipelineStats` by hand. `refreshPipelineView`
 * now does both halves, and this walks the module to check that the only
 * remaining bare `fetchApplicants` callers are the ones that genuinely want
 * rows alone.
 *
 * A caller that paged, rather than changed anything, belongs in ALLOWED with
 * a line saying why.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Call sites permitted to refresh the rows without the counts, and how many
 * each file is allowed. Paging changes which applicants are on screen; it
 * cannot change how many there are, so the header is already correct and a
 * second request would be waste.
 *
 * Counted rather than named per file so a new bare call added beside the
 * allowed one still fails — a file-wide exemption is how this class of bug
 * hides.
 */
const ALLOWED = new Map<string, number>([
  // Table pagination: `onPageChange` on PipelineTable. Nothing else.
  ['pages/ProspectiveMembersPage.tsx', 1],
]);

/**
 * The store owns both fetches and is where `refreshPipelineView` composes
 * them, so it necessarily names `fetchApplicants`.
 */
const STORE = 'store/prospectiveMembersStore.ts';

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    found.push(full);
  }
  return found;
}

describe('pipeline refresh integrity', () => {
  it('routes post-mutation refreshes through refreshPipelineView', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(MODULE_ROOT)) {
      const relative = path.relative(MODULE_ROOT, file).split(path.sep).join('/');
      if (relative === STORE) continue;

      const source = fs.readFileSync(file, 'utf8');
      // Strip comments so prose naming the old function does not trip this.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const calls = code.match(/\bfetchApplicants\s*\(/g)?.length ?? 0;
      const budget = ALLOWED.get(relative) ?? 0;
      if (calls > budget) {
        offenders.push(`${relative} (${calls} bare calls, ${budget} allowed)`);
      }
    }

    expect(offenders, 'call refreshPipelineView() so the header cannot go stale').toEqual([]);
  });

  it('keeps the conversion path refreshing both halves', () => {
    // The reported regression, pinned by name: this is the call site that was
    // wrong, and the one whose symptom was mistaken for missing applicants.
    const source = fs.readFileSync(path.join(MODULE_ROOT, 'components/ConversionModal.tsx'), 'utf8');
    expect(source).toContain('refreshPipelineView()');
  });
});
