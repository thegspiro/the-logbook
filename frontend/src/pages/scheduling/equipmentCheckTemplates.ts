import type { EquipmentCheckTemplate } from '../../modules/scheduling/types/equipmentCheck';

export function crewVisibleTemplates(templates: EquipmentCheckTemplate[]): EquipmentCheckTemplate[] {
  return templates.filter((template) => template.isActive);
}
