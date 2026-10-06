import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';
import { ApparatusTypeBadge } from './ApparatusTypeBadge';
import type { ApparatusStatus, ApparatusType } from '../types';

const status: ApparatusStatus = {
  id: 'status-1',
  organizationId: 'org-1',
  name: 'In Service',
  code: 'in_service',
  description: null,
  isSystem: true,
  defaultStatus: 'in_service',
  isAvailable: true,
  isOperational: true,
  requiresReason: false,
  isArchivedStatus: false,
  color: '#22C55E',
  icon: null,
  sortOrder: 1,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const type: ApparatusType = {
  id: 'type-1',
  organizationId: 'org-1',
  name: 'Brush/Wildland',
  code: 'brush',
  description: null,
  category: 'fire',
  isSystem: true,
  defaultType: null,
  icon: null,
  color: '#22C55E',
  sortOrder: 1,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

// A stored colour is chosen to look right as a tint; painted straight onto the
// text, green-500 measured 2.2:1 on white. The badge must hand the colour to
// text-data-color, which darkens it, rather than use it as the text colour.
describe('badges coloured by a stored value', () => {
  it('status badge reads its colour through text-data-color', () => {
    render(<StatusBadge status={status} />);
    const badge = screen.getByText('IN SERVICE');
    expect(badge).toHaveClass('text-data-color');
    expect(badge.style.getPropertyValue('--data-color')).toBe('#22C55E');
    expect(badge.style.color).toBe('');
  });

  it('type badge reads its colour through text-data-color', () => {
    render(<ApparatusTypeBadge type={type} />);
    const badge = screen.getByText('Brush/Wildland');
    expect(badge).toHaveClass('text-data-color');
    expect(badge.style.getPropertyValue('--data-color')).toBe('#22C55E');
    expect(badge.style.color).toBe('');
  });
});
