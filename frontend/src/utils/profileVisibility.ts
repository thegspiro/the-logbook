/**
 * Whether the department's contact-visibility setting hides a field for
 * everyone. Only the three work fields have an organisation ceiling; personal
 * email and the mailing address answer to the member alone.
 */

import type { ContactInfoSettings, ProfileVisibilityField } from '../types/user';

export function orgHidesField(field: ProfileVisibilityField, org: ContactInfoSettings | null | undefined): boolean {
  if (!org) return false;
  switch (field) {
    case 'email':
      return !(org.enabled && org.show_email);
    case 'phone':
      return !(org.enabled && org.show_phone);
    case 'mobile':
      return !(org.enabled && org.show_mobile);
    default:
      return false;
  }
}
