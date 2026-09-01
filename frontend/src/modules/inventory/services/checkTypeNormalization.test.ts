import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();

vi.mock('../../../utils/createApiClient', () => ({
  createApiClient: () => ({
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }),
}));

import { equipmentCheckService } from './equipmentCheckApi';

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The check form compares `item.checkType` against the four canonical values
 * directly and its control switch ends in `default: passFailButtons`. So a
 * response carrying the older spellings does not fail, it degrades: every
 * count, level and expiry item renders the pass/fail control, the crew answers
 * Pass on a row meant to record a number, and nothing is stored.
 *
 * `pass_fail` is the part that hides it — that one lands on the right control
 * by accident, so most of a form still looks correct.
 *
 * A backend serving the previous release is the normal state of a rolling
 * deploy, and is how this was found: a backend process left running across an
 * upgrade rendered every counted item on a medic's supply check as pass/fail.
 */
const legacyTemplate = () => ({
  id: 'tpl-1',
  name: 'Medic 3 Supply Check',
  compartments: [
    {
      id: 'c1',
      name: 'Drug Bag',
      items: [
        { id: 'i1', name: 'Naloxone 4mg Nasal', checkType: 'quantity' },
        { id: 'i2', name: 'Controlled substance seal intact', checkType: 'pass_fail' },
        { id: 'i3', name: 'O2 cylinder', checkType: 'reading' },
        { id: 'i4', name: 'AED pads', checkType: 'date_lot' },
      ],
    },
  ],
});

const typesOf = (template: { compartments: { items: { checkType: string }[] }[] }) =>
  template.compartments.flatMap((c) => c.items.map((i) => i.checkType));

describe('check type normalization at the read boundary', () => {
  it('canonicalizes legacy spellings on a fetched template', async () => {
    mockGet.mockResolvedValueOnce({ data: legacyTemplate() });

    const template = await equipmentCheckService.getEquipmentCheckTemplate('tpl-1');

    expect(typesOf(template)).toEqual(['count', 'function', 'level', 'expiry']);
  });

  it('canonicalizes them in the list response too', async () => {
    mockGet.mockResolvedValueOnce({ data: [legacyTemplate()] });

    const templates = await equipmentCheckService.getEquipmentCheckTemplates();
    const [first] = templates;

    expect(first).toBeDefined();
    expect(typesOf(first ?? { compartments: [] })).toEqual(['count', 'function', 'level', 'expiry']);
  });

  it('leaves canonical values alone', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        id: 'tpl-2',
        name: 'Engine Daily Check',
        compartments: [
          {
            id: 'c1',
            name: 'Cab',
            items: [
              { id: 'i1', name: 'Gauze', checkType: 'count' },
              { id: 'i2', name: 'Siren', checkType: 'function' },
              // Structural rows are not checks and must survive untouched:
              // normalizing them to `function` would put answer buttons under
              // a section heading.
              { id: 'i3', name: 'Safety Equipment', checkType: 'header' },
              { id: 'i4', name: 'Read this first', checkType: 'text' },
            ],
          },
        ],
      },
    });

    const template = await equipmentCheckService.getEquipmentCheckTemplate('tpl-2');

    expect(typesOf(template)).toEqual(['count', 'function', 'header', 'text']);
  });

  it('does not choke on a template with no compartments', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 'tpl-3', name: 'Empty' } });

    await expect(equipmentCheckService.getEquipmentCheckTemplate('tpl-3')).resolves.toMatchObject({
      id: 'tpl-3',
    });
  });
});
