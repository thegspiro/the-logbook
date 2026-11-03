import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithRouter } from '../../test/utils';
import { AssetWidgetRegistry } from './AssetWidgetRegistry';
import type { AssetWidgetData } from './AssetWidgetRegistry';

const tile = (overrides: Partial<AssetWidgetData>): AssetWidgetData => ({
  id: 'inventory-low-stock',
  module: 'inventory',
  title: 'Low stock',
  count: 3,
  href: '/inventory?stock=low',
  empty_state: 'All stocked.',
  severity: 'warning',
  ...overrides,
});

describe('AssetWidgetRegistry', () => {
  it('promises filtered results on a tile that counts rows needing attention', () => {
    renderWithRouter(<AssetWidgetRegistry widgets={[tile({})]} />);

    expect(screen.getByRole('button', { name: 'Low stock: 3. Open filtered results' })).toBeInTheDocument();
    expect(screen.getByText('View filtered results')).toBeInTheDocument();
  });

  // DASH-37: a total has nothing to filter, so it does not say it does.
  it('says only Open on a neutral total', () => {
    renderWithRouter(
      <AssetWidgetRegistry
        widgets={[
          tile({ id: 'inventory-summary', title: 'Inventory', count: 120, href: '/inventory', severity: 'neutral' }),
        ]}
      />
    );

    expect(screen.getByRole('button', { name: 'Inventory: 120. Open' })).toBeInTheDocument();
    expect(screen.queryByText('View filtered results')).not.toBeInTheDocument();
  });
});
