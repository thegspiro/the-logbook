import { CHECK_TYPE_LABELS, CheckType } from '@/modules/scheduling/types/equipmentCheck';

export interface ItemSummarySource {
  checkType: CheckType;
  isRequired: boolean;
  requiredQuantity: string;
  expectedQuantity: string;
  criticalMinimumQuantity: string;
  minLevel: string;
  levelUnit: string;
  serialNumber: string;
  lotNumber: string;
  hasExpiration: boolean;
  expirationDate: string;
}

export type ItemSummaryTone = 'neutral' | 'important' | 'problem';

export interface ItemSummaryLabel {
  text: string;
  tone: ItemSummaryTone;
}

const configuredNumber = (value: string): boolean => value.trim() !== '' && Number.isFinite(Number(value));

/**
 * The two facts that identify an item in a collapsed template row.
 *
 * Problems replace the less useful type/configuration facts so a narrow row
 * never hides work that must be completed before the template is dependable.
 */
export function formatItemSummary(item: ItemSummarySource): ItemSummaryLabel[] {
  const problems: ItemSummaryLabel[] = [];

  if (
    item.checkType === CheckType.COUNT &&
    !configuredNumber(item.expectedQuantity) &&
    !configuredNumber(item.requiredQuantity)
  ) {
    problems.push({ text: 'Needs quantity', tone: 'problem' });
  }
  if (item.checkType === CheckType.LEVEL && !configuredNumber(item.minLevel)) {
    problems.push({ text: 'Needs minimum', tone: 'problem' });
  }
  if (item.checkType === CheckType.EXPIRY && !item.serialNumber.trim() && !item.lotNumber.trim()) {
    problems.push({ text: 'Needs serial or lot', tone: 'problem' });
  }
  if (item.hasExpiration && !item.expirationDate.trim()) {
    problems.push({ text: 'Needs expiration date', tone: 'problem' });
  }
  if (
    item.checkType === CheckType.COUNT &&
    configuredNumber(item.criticalMinimumQuantity) &&
    configuredNumber(item.expectedQuantity) &&
    Number(item.criticalMinimumQuantity) >= Number(item.expectedQuantity)
  ) {
    problems.push({ text: 'Fix critical minimum', tone: 'problem' });
  }

  if (problems.length > 0) return problems.slice(0, 2);

  const labels: ItemSummaryLabel[] = [{ text: CHECK_TYPE_LABELS[item.checkType], tone: 'neutral' }];
  if (item.checkType === CheckType.COUNT) {
    if (configuredNumber(item.expectedQuantity)) {
      labels.push({ text: `Par ${item.expectedQuantity}`, tone: 'important' });
    } else if (configuredNumber(item.requiredQuantity)) {
      labels.push({ text: `Minimum ${item.requiredQuantity}`, tone: 'important' });
    }
  } else if (item.checkType === CheckType.LEVEL && configuredNumber(item.minLevel)) {
    labels.push({
      text: `Minimum ${item.minLevel}${item.levelUnit.trim() ? ` ${item.levelUnit.trim()}` : ''}`,
      tone: 'important',
    });
  } else if (item.hasExpiration) {
    labels.push({ text: 'Expiration tracked', tone: 'important' });
  } else if (item.isRequired) {
    labels.push({ text: 'Required', tone: 'important' });
  }

  return labels.slice(0, 2);
}
