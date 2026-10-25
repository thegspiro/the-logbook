import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';

vi.mock('../../../components/ReturnRequestsPanel', () => ({
  default: () => <div data-testid="return-panel">ReturnRequestsPanel</div>,
}));

import ReturnRequestsPage from './ReturnRequestsPage';

describe('ReturnRequestsPage', () => {
  it('renders page title and subtitle', () => {
    renderWithRouter(<ReturnRequestsPage />);
    expect(screen.getByText('Return Requests')).toBeInTheDocument();
    expect(screen.getByText('Review and process member return requests')).toBeInTheDocument();
  });

  it('titles itself under the admin header and leaves the way back to it', () => {
    renderWithRouter(<ReturnRequestsPage />);
    // A level-2 heading with no back link of its own: InventoryAdminLayout
    // draws the page's header, trail and area cards around it.
    expect(screen.getByRole('heading', { level: 2, name: 'Return Requests' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Back to Admin/ })).not.toBeInTheDocument();
  });

  it('renders the ReturnRequestsPanel component', async () => {
    renderWithRouter(<ReturnRequestsPage />);
    expect(await screen.findByTestId('return-panel')).toBeInTheDocument();
  });
});
