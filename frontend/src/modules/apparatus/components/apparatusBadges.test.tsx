/**
 * Seeded apparatus statuses and types carry Tailwind -500 colours. Used as the
 * badge's text colour they measured 1.95:1 ("In Service", green-500) and
 * 3.98:1 ("Engine", red-600) against their own tint, under the 4.5:1 AA floor
 * on every apparatus row. The colour now tints the badge and icon only.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';
import { ApparatusTypeBadge } from './ApparatusTypeBadge';
import type { ApparatusStatus, ApparatusType } from '../types';

const status: ApparatusStatus = {
  id: 's-1',
  organizationId: null,
  name: 'In Service',
  code: 'in_service',
  description: null,
  isSystem: true,
  defaultStatus: 'in_service',
  isAvailable: true,
  isOperational: true,
  requiresReason: false,
  isArchivedStatus: false,
  color: '#22c55e',
  icon: null,
  sortOrder: 1,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const type: ApparatusType = {
  id: 't-1',
  organizationId: null,
  name: 'Engine',
  code: 'engine',
  description: null,
  category: 'fire',
  isSystem: true,
  defaultType: 'engine',
  icon: null,
  color: '#dc2626',
  sortOrder: 1,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('apparatus badges with a department colour', () => {
  it('keeps the status colour off the status text', () => {
    render(<StatusBadge status={status} />);
    const badge = screen.getByText('IN SERVICE');
    expect(badge).toHaveClass('text-theme-text-primary');
    expect(badge.style.color).toBe('');
    expect(badge.style.backgroundColor).not.toBe('');
  });

  it('keeps the type colour off the type text', () => {
    render(<ApparatusTypeBadge type={type} />);
    const badge = screen.getByText('Engine');
    expect(badge).toHaveClass('text-theme-text-primary');
    expect(badge.style.color).toBe('');
    expect(badge.style.borderColor).not.toBe('');
  });
});
