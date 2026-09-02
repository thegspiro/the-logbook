import { describe, expect, it } from 'vitest';
import type { EquipmentCheckTemplate } from '../../../modules/inventory/types/equipmentCheck';
import { crewVisibleTemplates } from './equipmentCheckTemplates';

describe('crewVisibleTemplates', () => {
  it('never offers drafts as crew shift checks', () => {
    const templates = [
      { id: 'draft', name: 'Draft', isActive: false },
      { id: 'published', name: 'Published', isActive: true },
    ] as EquipmentCheckTemplate[];

    expect(crewVisibleTemplates(templates).map((template) => template.id)).toEqual(['published']);
  });
});
