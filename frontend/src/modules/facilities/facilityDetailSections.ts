import {
  ClipboardCheck,
  DoorOpen,
  Info,
  KeyRound,
  Landmark,
  OctagonAlert,
  Settings,
  Shield,
  ShieldCheck,
  UserRound,
  Users,
  Wrench,
  Zap,
} from 'lucide-react';

export type FacilitySectionId =
  | 'overview'
  | 'rooms'
  | 'systems'
  | 'maintenance'
  | 'inspections'
  | 'utilities'
  | 'contacts'
  | 'access-keys'
  | 'shutoffs'
  | 'capital-projects'
  | 'insurance'
  | 'occupants'
  | 'compliance';

export interface FacilityDetailSection {
  id: FacilitySectionId;
  label: string;
  icon: React.ElementType;
  /**
   * Sensitive sections carry door/alarm codes, account numbers, budgets, and
   * lease terms. The backend gates their reads behind facilities.edit/manage,
   * so showing them to a facilities.view-only member would only render 403
   * errors — and the data is restricted on purpose.
   */
  sensitive?: boolean;
}

export const FACILITY_DETAIL_SECTIONS: FacilityDetailSection[] = [
  { id: 'overview', label: 'Overview', icon: Info },
  { id: 'rooms', label: 'Rooms', icon: DoorOpen },
  { id: 'systems', label: 'Building Systems', icon: Settings },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench },
  { id: 'inspections', label: 'Inspections', icon: ClipboardCheck },
  { id: 'utilities', label: 'Utilities', icon: Zap, sensitive: true },
  { id: 'contacts', label: 'Emergency Contacts', icon: Users },
  { id: 'access-keys', label: 'Access Keys', icon: KeyRound, sensitive: true },
  { id: 'shutoffs', label: 'Shutoff Locations', icon: OctagonAlert },
  { id: 'capital-projects', label: 'Capital Projects', icon: Landmark, sensitive: true },
  { id: 'insurance', label: 'Insurance', icon: Shield, sensitive: true },
  { id: 'occupants', label: 'Occupants', icon: UserRound, sensitive: true },
  { id: 'compliance', label: 'Compliance', icon: ShieldCheck },
];

export const getVisibleFacilitySections = (canViewSensitive: boolean): FacilityDetailSection[] =>
  FACILITY_DETAIL_SECTIONS.filter((section) => !section.sensitive || canViewSensitive);
