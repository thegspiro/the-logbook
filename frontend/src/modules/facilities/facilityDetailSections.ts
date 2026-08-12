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

export const FACILITY_DETAIL_SECTIONS: {
  id: FacilitySectionId;
  label: string;
  icon: React.ElementType;
}[] = [
  { id: 'overview', label: 'Overview', icon: Info },
  { id: 'rooms', label: 'Rooms', icon: DoorOpen },
  { id: 'systems', label: 'Building Systems', icon: Settings },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench },
  { id: 'inspections', label: 'Inspections', icon: ClipboardCheck },
  { id: 'utilities', label: 'Utilities', icon: Zap },
  { id: 'contacts', label: 'Emergency Contacts', icon: Users },
  { id: 'access-keys', label: 'Access Keys', icon: KeyRound },
  { id: 'shutoffs', label: 'Shutoff Locations', icon: OctagonAlert },
  { id: 'capital-projects', label: 'Capital Projects', icon: Landmark },
  { id: 'insurance', label: 'Insurance', icon: Shield },
  { id: 'occupants', label: 'Occupants', icon: UserRound },
  { id: 'compliance', label: 'Compliance', icon: ShieldCheck },
];
