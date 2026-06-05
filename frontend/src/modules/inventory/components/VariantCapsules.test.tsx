import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VariantCapsules } from './VariantCapsules';
import type { InventoryItem } from '../types';

const makeItem = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'i-1',
  organization_id: 'org-1',
  name: 'Item',
  condition: 'good',
  status: 'available',
  tracking_type: 'individual',
  quantity: 1,
  quantity_issued: 0,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('VariantCapsules', () => {
  it('renders nothing when the item has no variant attributes', () => {
    const { container } = render(<VariantCapsules item={makeItem()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the size uppercased', () => {
    render(<VariantCapsules item={makeItem({ size: 'lg' })} />);
    expect(screen.getByText('LG')).toBeInTheDocument();
  });

  it('prefers standard_size over size', () => {
    render(<VariantCapsules item={makeItem({ standard_size: 'xl', size: 'lg' })} />);
    expect(screen.getByText('XL')).toBeInTheDocument();
    expect(screen.queryByText('LG')).not.toBeInTheDocument();
  });

  it('renders the color as-is', () => {
    render(<VariantCapsules item={makeItem({ color: 'Navy' })} />);
    expect(screen.getByText('Navy')).toBeInTheDocument();
  });

  it('formats a snake_case style into Title Case', () => {
    render(<VariantCapsules item={makeItem({ style: 'long_sleeve' })} />);
    expect(screen.getByText('Long Sleeve')).toBeInTheDocument();
  });

  it('renders size, color, and style together', () => {
    render(
      <VariantCapsules item={makeItem({ standard_size: 'm', color: 'Black', style: 'v_neck' })} />,
    );
    expect(screen.getByText('M')).toBeInTheDocument();
    expect(screen.getByText('Black')).toBeInTheDocument();
    expect(screen.getByText('V Neck')).toBeInTheDocument();
  });

  it('prefixes each capsule with its attribute name when showLabels is set', () => {
    render(
      <VariantCapsules
        item={makeItem({ standard_size: 'm', color: 'Black', style: 'v_neck' })}
        showLabels
      />,
    );
    expect(screen.getByText('Size: M')).toBeInTheDocument();
    expect(screen.getByText('Color: Black')).toBeInTheDocument();
    expect(screen.getByText('Style: V Neck')).toBeInTheDocument();
  });
});
