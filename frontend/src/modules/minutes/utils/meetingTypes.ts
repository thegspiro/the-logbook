import type { MeetingType } from '../types/minutes';

export const MEETING_TYPE_OPTIONS: { value: MeetingType; label: string }[] = [
  { value: 'business', label: 'Business meeting' },
  { value: 'special', label: 'Special meeting' },
  { value: 'committee', label: 'Committee meeting' },
  { value: 'board', label: 'Board meeting' },
  { value: 'trustee', label: 'Trustee meeting' },
  { value: 'executive', label: 'Executive meeting' },
  { value: 'annual', label: 'Annual meeting' },
  { value: 'other', label: 'Other' },
];
