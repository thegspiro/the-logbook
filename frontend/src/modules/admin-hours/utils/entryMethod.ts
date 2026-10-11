import { ADMIN_HOURS_ENTRY_METHOD_LABELS } from '../../../constants/enums';

/**
 * The display label for an entry method. An unknown value (a method added on
 * the server before this list) still renders readably instead of vanishing.
 */
export function entryMethodLabel(method: string): string {
  return ADMIN_HOURS_ENTRY_METHOD_LABELS[method] ?? method.replace(/_/g, ' ');
}
