import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';

// Mock the lazy-loaded component
vi.mock('../../../components/ChargeManagementPanel', () => ({
  default: () => <div data-testid="charge-panel">ChargeManagementPanel</div>,
}));

import ChargesPage from './ChargesPage';

describe('ChargesPage', () => {
  it('renders page title and subtitle', () => {
    renderWithRouter(<ChargesPage />);
    expect(screen.getByText('Charge Management')).toBeInTheDocument();
    expect(screen.getByText('Cost recovery for lost or damaged items')).toBeInTheDocument();
  });

  it('titles itself under the admin header and leaves the way back to it', () => {
    renderWithRouter(<ChargesPage />);
    // A level-2 heading with no back link of its own: InventoryAdminLayout
    // draws the page's header, trail and area cards around it.
    expect(screen.getByRole('heading', { level: 2, name: 'Charge Management' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Back to Admin/ })).not.toBeInTheDocument();
  });

  it('renders the ChargeManagementPanel component', async () => {
    renderWithRouter(<ChargesPage />);
    expect(await screen.findByTestId('charge-panel')).toBeInTheDocument();
  });
});
