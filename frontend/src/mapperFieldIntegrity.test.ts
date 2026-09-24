/**
 * Mapper field integrity
 *
 * `prospective-members` is the one module that remaps every backend response
 * into a differently-shaped frontend type before anything sees it. That layer
 * can drop a field silently, and on 2026-09-24 it was found to have done:
 * `mapElectionPackageResponse` copied `election_id` and left `election_title`,
 * `election_status` and `election_end_date` behind, so the applicant drawer's
 * `election_id && election_title` guard was permanently false and no election
 * package in any outcome state ever named the ballot that decided it.
 *
 * The reason it survived is the reason this file exists. A guard that renders
 * nothing raises no exception, logs no warning and fails no test — the panel
 * looks complete because nothing in it is visibly wrong. It was found by
 * reading a rendered panel against a seeded vote, which is not a thing CI does.
 *
 * So the check is the defect's own shape: a field the frontend type declares,
 * a component reads, and no mapper ever assigns. Anything matching that is
 * either a dropped field or a reader with no producer, and both are bugs.
 *
 * This is a ratchet, not a clean sweep. The fields already in that state on the
 * day it was written are listed in KNOWN_GAPS with what is wrong with each; see
 * `docs/KNOWN_LIMITATIONS.md` for why they are recorded rather than fixed.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const MODULE = path.join(SRC, 'modules/prospective-members');

/** The frontend types a mapper in `services/api.ts` is responsible for filling. */
const MAPPED_TYPES = [
  'Applicant',
  'ApplicantListItem',
  'ElectionPackage',
  'Pipeline',
  'PipelineListItem',
  'PipelineStage',
  'PipelineStats',
  'ApplicantDocument',
];

/**
 * Declared, read, and never assigned — on the day this was written.
 *
 * Every one of these is a reader with no producer rather than a dropped field:
 * `prospective_members` has no column for any of them and no schema serialises
 * them, so the mapper has nothing to carry. Closing them means either adding
 * the columns or deleting the readers, which is an owner decision recorded in
 * docs/KNOWN_LIMITATIONS.md ("Seven Drawer Fields Have Readers and No
 * Producer"). Do not add to this list to make a build pass: a NEW entry here is
 * a field somebody wired up against data that does not exist.
 */
const KNOWN_GAPS = new Set([
  // Read by ConversionModal, which sends target_role_id on every conversion.
  // It is always undefined, so convertToMember never sets role_ids.
  'Applicant.target_role_id',
  'Applicant.target_role_name',
  'ApplicantListItem.target_role_name',
  'ElectionPackage.target_role_name',
  // Read by the drawer's status lines and the applicant table's columns, which
  // render nothing and "—" respectively for every applicant.
  'Applicant.deactivated_at',
  'Applicant.deactivated_reason',
  'Applicant.reactivated_at',
  'Applicant.withdrawn_at',
  'Applicant.withdrawal_reason',
  'ApplicantListItem.deactivated_at',
  'ApplicantListItem.withdrawn_at',
  'ApplicantListItem.withdrawal_reason',
]);

const typesSource = fs.readFileSync(path.join(MODULE, 'types/index.ts'), 'utf8');
const apiSource = fs.readFileSync(path.join(MODULE, 'services/api.ts'), 'utf8');

/**
 * Field names declared directly on `interface <name>`, with nested object
 * literals stripped so a nested key cannot pass for one of the interface's own.
 */
const declaredFields = (name: string): string[] => {
  const opening = new RegExp(`^export interface ${name}\\b[^{]*\\{`, 'm').exec(typesSource);
  if (!opening) return [];

  let index = opening.index + opening[0].length;
  const bodyStart = index;
  let depth = 1;
  while (depth > 0 && index < typesSource.length) {
    const char = typesSource[index];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    index += 1;
  }

  let nesting = 0;
  const flattened = [...typesSource.slice(bodyStart, index - 1)]
    .filter((char) => {
      if (char === '{') {
        nesting += 1;
        return false;
      }
      if (char === '}') {
        nesting -= 1;
        return false;
      }
      return nesting === 0;
    })
    .join('');

  return [...flattened.matchAll(/^\s*(\w+)\??\s*:/gm)].map((match) => match[1] ?? '');
};

/** Every key assigned in api.ts — the mappers build plain object literals. */
const assignedKeys = new Set([...apiSource.matchAll(/^\s*(\w+)\s*:/gm)].map((match) => match[1] ?? ''));

const collectFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
};

/**
 * Everything the module's components, pages and stores render or branch on.
 * The services directory is excluded: an assignment inside a mapper is not a
 * reader, and counting it would make every dropped field look consumed.
 */
const readerSource = collectFiles(MODULE)
  .filter((file) => !file.startsWith(path.join(MODULE, 'services')))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');

describe('mapper field integrity', () => {
  it('reads the module it checks', () => {
    expect(declaredFields('Applicant').length).toBeGreaterThan(10);
    expect(assignedKeys.size).toBeGreaterThan(50);
    expect(readerSource.length).toBeGreaterThan(10_000);
  });

  it('assigns every mapped-type field that something reads', () => {
    const unfilled: string[] = [];

    for (const type of MAPPED_TYPES) {
      const fields = declaredFields(type);
      expect(fields.length, `${type} was not found in types/index.ts`).toBeGreaterThan(0);

      for (const field of fields) {
        if (assignedKeys.has(field)) continue;
        // Only a field something actually renders or branches on is a defect;
        // an unread declaration costs nothing and has nowhere to show up.
        if (!new RegExp(`\\.${field}\\b`).test(readerSource)) continue;
        const id = `${type}.${field}`;
        if (!KNOWN_GAPS.has(id)) unfilled.push(id);
      }
    }

    expect(
      unfilled,
      'These fields are declared on a mapped type and read by a component, but no mapper in ' +
        'modules/prospective-members/services/api.ts assigns them — so they are undefined at ' +
        'runtime and whatever reads them renders nothing, silently. Either carry the field ' +
        'through the mapper (if the backend sends it) or remove the field and its readers (if ' +
        'nothing produces it). Do not add it to KNOWN_GAPS to get a green build.'
    ).toEqual([]);
  });

  it('keeps KNOWN_GAPS honest', () => {
    // A gap that has been closed should leave this list, or the list stops
    // describing the code and starts excusing it.
    const stale = [...KNOWN_GAPS].filter((id) => {
      const field = id.split('.')[1] ?? '';
      return assignedKeys.has(field);
    });

    expect(stale, 'These fields are assigned now — remove them from KNOWN_GAPS.').toEqual([]);
  });
});
