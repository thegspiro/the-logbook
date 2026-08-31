import type { EquipmentCheckTemplate } from '../../../modules/inventory/types/equipmentCheck';

export function crewVisibleTemplates(templates: EquipmentCheckTemplate[]): EquipmentCheckTemplate[] {
  return templates.filter((template) => template.isActive);
}
