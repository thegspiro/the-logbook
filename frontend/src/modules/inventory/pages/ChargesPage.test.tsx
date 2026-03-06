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

  it('renders back link to admin', () => {
    renderWithRouter(<ChargesPage />);
    const backLink = screen.getByText('Back to Admin');
    expect(backLink.closest('a')).toHaveAttribute('href', '/inventory/admin');
  });

  it('renders the ChargeManagementPanel component', async () => {
    renderWithRouter(<ChargesPage />);
    expect(await screen.findByTestId('charge-panel')).toBeInTheDocument();
  });
});
