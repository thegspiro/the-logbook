import React from 'react';
import {
  Clock,
  Truck,
  PartyPopper,
  Flag,
  Trophy,
  Megaphone,
  Zap,
  Home,
  ShieldCheck,
  Heart,
  Bike,
} from 'lucide-react';

export type TemplateCategory = 'standard' | 'specialty' | 'event';

export const TEMPLATE_CATEGORIES: { value: TemplateCategory; label: string; icon: React.ElementType; description: string }[] = [
  { value: 'standard', label: 'Standard', icon: Clock, description: 'Regular day, night, or rotating shifts' },
  { value: 'specialty', label: 'Specialty Vehicle', icon: Truck, description: 'Templates for specialty apparatus (Hazmat, Tower, etc.)' },
  { value: 'event', label: 'Event / Special', icon: PartyPopper, description: 'Parades, SantaMobile, community events, details' },
];

export const FALLBACK_APPARATUS_TYPES = [
  'engine', 'ladder', 'ambulance', 'rescue', 'tanker', 'brush',
  'tower', 'hazmat', 'boat', 'chief', 'utility',
];

export type EventType = 'parade' | 'sporting' | 'community' | 'racing' | 'open_house' | 'detail' | 'other';

export const EVENT_TYPES: { value: EventType; label: string; icon: React.ElementType; description: string }[] = [
  { value: 'parade', label: 'Parade', icon: Flag, description: 'Parades, processions, SantaMobile' },
  { value: 'sporting', label: 'Sporting Event', icon: Trophy, description: 'School games, tournaments, athletic events' },
  { value: 'community', label: 'Community Event', icon: Megaphone, description: 'Festivals, block parties, fundraisers' },
  { value: 'racing', label: 'Racing Event', icon: Zap, description: 'Marathons, triathlons, car/bike races' },
  { value: 'open_house', label: 'Open House', icon: Home, description: 'Station tours, Fire Prevention Week' },
  { value: 'detail', label: 'Detail / Standby', icon: ShieldCheck, description: 'Standby coverage, fire watch, inspections' },
  { value: 'other', label: 'Other', icon: PartyPopper, description: 'Any other special event' },
];

export interface ResourceUnit {
  type: string;
  label: string;
  quantity: number;
  positions: string[];
}

export const RESOURCE_TYPE_OPTIONS: { value: string; label: string; icon: React.ElementType; defaultPositions: string[]; defaultQty: number }[] = [
  { value: 'engine', label: 'Engine', icon: Truck, defaultPositions: ['officer', 'driver', 'firefighter', 'firefighter'], defaultQty: 1 },
  { value: 'ambulance', label: 'Ambulance', icon: Truck, defaultPositions: ['driver', 'ems', 'ems'], defaultQty: 1 },
  { value: 'ladder', label: 'Ladder / Tower', icon: Truck, defaultPositions: ['officer', 'driver', 'firefighter', 'firefighter'], defaultQty: 1 },
  { value: 'rescue', label: 'Rescue', icon: Truck, defaultPositions: ['officer', 'driver', 'firefighter'], defaultQty: 1 },
  { value: 'first_aid_station', label: 'First Aid Station', icon: Heart, defaultPositions: ['ems', 'ems'], defaultQty: 1 },
  { value: 'bicycle_team', label: 'Bicycle Team', icon: Bike, defaultPositions: ['ems', 'ems'], defaultQty: 1 },
  { value: 'command_post', label: 'Command Post', icon: ShieldCheck, defaultPositions: ['officer', 'captain'], defaultQty: 1 },
  { value: 'rehab_station', label: 'Rehab Station', icon: Heart, defaultPositions: ['ems', 'firefighter'], defaultQty: 1 },
  { value: 'utility_vehicle', label: 'Utility / Support', icon: Truck, defaultPositions: ['driver'], defaultQty: 1 },
  { value: 'tanker', label: 'Tanker', icon: Truck, defaultPositions: ['driver', 'firefighter'], defaultQty: 1 },
  { value: 'hazmat', label: 'HazMat Unit', icon: Truck, defaultPositions: ['officer', 'driver', 'firefighter', 'firefighter'], defaultQty: 1 },
  { value: 'chief_vehicle', label: 'Chief / Battalion', icon: Truck, defaultPositions: ['officer'], defaultQty: 1 },
  { value: 'boat', label: 'Boat', icon: Truck, defaultPositions: ['officer', 'driver'], defaultQty: 1 },
];

interface EventTemplateStarter {
  name: string;
  eventType: EventType;
  description: string;
  duration_hours: string;
  start_time_of_day: string;
  end_time_of_day: string;
  color: string;
  resources: ResourceUnit[];
}

export const EVENT_TEMPLATE_STARTERS: EventTemplateStarter[] = [
  {
    name: 'Parade Detail',
    eventType: 'parade',
    description: 'Standard parade standby with engine and ambulance coverage',
    duration_hours: '4', start_time_of_day: '09:00', end_time_of_day: '13:00', color: '#7c3aed',
    resources: [
      { type: 'engine', label: 'Engine', quantity: 1, positions: ['officer', 'driver', 'firefighter', 'firefighter'] },
      { type: 'ambulance', label: 'Ambulance', quantity: 1, positions: ['driver', 'ems', 'ems'] },
    ],
  },
  {
    name: 'SantaMobile',
    eventType: 'parade',
    description: 'Holiday SantaMobile community event with engine escort',
    duration_hours: '5', start_time_of_day: '17:00', end_time_of_day: '22:00', color: '#dc2626',
    resources: [
      { type: 'engine', label: 'Engine (Santa)', quantity: 1, positions: ['officer', 'driver', 'firefighter', 'firefighter'] },
      { type: 'utility_vehicle', label: 'Utility / Lead', quantity: 1, positions: ['driver'] },
    ],
  },
  {
    name: 'School Sporting Event',
    eventType: 'sporting',
    description: 'High school football/soccer game standby with first aid',
    duration_hours: '4', start_time_of_day: '16:00', end_time_of_day: '20:00', color: '#2563eb',
    resources: [
      { type: 'ambulance', label: 'Ambulance', quantity: 1, positions: ['driver', 'ems', 'ems'] },
      { type: 'first_aid_station', label: 'First Aid Station', quantity: 1, positions: ['ems', 'ems'] },
    ],
  },
  {
    name: 'Marathon / Road Race',
    eventType: 'racing',
    description: 'Full marathon or road race coverage with bicycle EMS teams and aid stations',
    duration_hours: '8', start_time_of_day: '05:00', end_time_of_day: '13:00', color: '#f59e0b',
    resources: [
      { type: 'ambulance', label: 'Ambulance', quantity: 2, positions: ['driver', 'ems', 'ems'] },
      { type: 'first_aid_station', label: 'First Aid Station', quantity: 3, positions: ['ems', 'ems'] },
      { type: 'bicycle_team', label: 'Bicycle Team', quantity: 2, positions: ['ems', 'ems'] },
      { type: 'command_post', label: 'Command Post', quantity: 1, positions: ['officer', 'captain'] },
      { type: 'rehab_station', label: 'Rehab Station', quantity: 1, positions: ['ems', 'firefighter'] },
    ],
  },
  {
    name: 'Community Festival',
    eventType: 'community',
    description: 'Block party, festival, or large community gathering',
    duration_hours: '6', start_time_of_day: '10:00', end_time_of_day: '16:00', color: '#10b981',
    resources: [
      { type: 'engine', label: 'Engine', quantity: 1, positions: ['officer', 'driver', 'firefighter', 'firefighter'] },
      { type: 'ambulance', label: 'Ambulance', quantity: 1, positions: ['driver', 'ems', 'ems'] },
      { type: 'first_aid_station', label: 'First Aid Station', quantity: 1, positions: ['ems', 'ems'] },
    ],
  },
  {
    name: 'Open House',
    eventType: 'open_house',
    description: 'Station open house, Fire Prevention Week, public tours',
    duration_hours: '4', start_time_of_day: '10:00', end_time_of_day: '14:00', color: '#ef4444',
    resources: [
      { type: 'engine', label: 'Engine (Demo)', quantity: 1, positions: ['officer', 'driver', 'firefighter', 'firefighter'] },
    ],
  },
  {
    name: 'Triathlon',
    eventType: 'racing',
    description: 'Triathlon coverage with water and land EMS teams',
    duration_hours: '8', start_time_of_day: '06:00', end_time_of_day: '14:00', color: '#f59e0b',
    resources: [
      { type: 'ambulance', label: 'Ambulance', quantity: 2, positions: ['driver', 'ems', 'ems'] },
      { type: 'first_aid_station', label: 'First Aid Station', quantity: 2, positions: ['ems', 'ems'] },
      { type: 'bicycle_team', label: 'Bicycle Team', quantity: 1, positions: ['ems', 'ems'] },
      { type: 'boat', label: 'Boat (Water Rescue)', quantity: 1, positions: ['officer', 'driver'] },
      { type: 'command_post', label: 'Command Post', quantity: 1, positions: ['officer', 'captain'] },
    ],
  },
];

export interface ShiftTemplate {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  start_time_of_day: string;
  end_time_of_day: string;
  duration_hours: number;
  color?: string;
  positions?: unknown;
  min_staffing: number;
  category?: string;
  apparatus_type?: string;
  apparatus_id?: string;
  is_default: boolean;
  is_active: boolean;
  open_to_all_members?: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface ShiftPattern {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  pattern_type: 'daily' | 'weekly' | 'platoon' | 'custom';
  template_id?: string;
  rotation_days?: number;
  days_on?: number;
  days_off?: number;
  schedule_config?: unknown;
  start_date: string;
  end_date?: string;
  assigned_members?: unknown;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export const BUILTIN_POSITION_OPTIONS: { value: string; label: string }[] = [
  { value: 'officer', label: 'Officer' },
  { value: 'driver', label: 'Driver/Operator' },
  { value: 'firefighter', label: 'Firefighter' },
  { value: 'ems', label: 'EMT' },
  { value: 'probationary', label: 'Probationary' },
  { value: 'volunteer', label: 'Volunteer' },
  { value: 'other', label: 'Other' },
];

export const getPositionOptions = (): { value: string; label: string }[] => {
  try {
    const stored = localStorage.getItem('scheduling_settings');
    if (stored) {
      const settings = JSON.parse(stored) as { customPositions?: { value: string; label: string }[] };
      const custom = settings.customPositions ?? [];
      const merged = [...BUILTIN_POSITION_OPTIONS];
      for (const cp of custom) {
        if (!merged.some(p => p.value === cp.value)) {
          merged.push(cp);
        }
      }
      return merged;
    }
  } catch { /* ignore */ }
  return BUILTIN_POSITION_OPTIONS;
};

export interface TemplateFormData {
  name: string;
  description: string;
  start_time_of_day: string;
  end_time_of_day: string;
  duration_hours: string;
  color: string;
  min_staffing: string;
  is_default: boolean;
  open_to_all_members: boolean;
  positions: PositionEntry[];
  category: TemplateCategory;
  apparatus_type: string;
  apparatus_id: string;
  event_type: EventType | '';
  resources: ResourceUnit[];
}

export interface PositionEntry {
  position: string;
  required: boolean;
}

export interface PatternFormData {
  name: string;
  description: string;
  pattern_type: 'daily' | 'weekly' | 'platoon' | 'custom';
  template_id: string;
  rotation_days: string;
  days_on: string;
  days_off: string;
  start_date: string;
  end_date: string;
}

export const PATTERN_TYPES: { value: string; label: string; description: string }[] = [
  { value: 'daily', label: 'Daily', description: 'Shifts repeat every day' },
  { value: 'weekly', label: 'Weekly', description: 'Shifts repeat on specific days of the week' },
  { value: 'platoon', label: 'Platoon', description: 'Rotating platoon schedule (e.g., 24/48, Kelly)' },
  { value: 'custom', label: 'Custom', description: 'Custom rotation pattern' },
];

export const emptyTemplateForm: TemplateFormData = {
  name: '',
  description: '',
  start_time_of_day: '08:00',
  end_time_of_day: '20:00',
  duration_hours: '12',
  color: '#dc2626',
  min_staffing: '1',
  is_default: false,
  open_to_all_members: false,
  positions: [],
  category: 'standard',
  apparatus_type: '',
  apparatus_id: '',
  event_type: '',
  resources: [],
};

export const emptyPatternForm: PatternFormData = {
  name: '',
  description: '',
  pattern_type: 'daily',
  template_id: '',
  rotation_days: '',
  days_on: '',
  days_off: '',
  start_date: '',
  end_date: '',
};
