import {
  Ambulance,
  Archive,
  Biohazard,
  Car,
  CheckCircle,
  Clock,
  DollarSign,
  Droplet,
  MoreHorizontal,
  Radio,
  Shield,
  Ship,
  Trash2,
  TreePine,
  Truck,
  Users,
  Wrench,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

const iconMap: Record<string, LucideIcon> = {
  'ambulance': Ambulance,
  'archive': Archive,
  'biohazard': Biohazard,
  'car': Car,
  'check-circle': CheckCircle,
  'clock': Clock,
  'dollar-sign': DollarSign,
  'droplet': Droplet,
  'fire-truck': Truck,
  'ladder': Truck,
  'more-horizontal': MoreHorizontal,
  'radio': Radio,
  'shield': Shield,
  'ship': Ship,
  'trash-2': Trash2,
  'tree': TreePine,
  'truck': Truck,
  'users': Users,
  'wrench': Wrench,
  'x-circle': XCircle,
};

export function getApparatusIcon(name: string): LucideIcon | null {
  return iconMap[name] ?? null;
}
