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

  it('renders back link to admin', () => {
    renderWithRouter(<ReturnRequestsPage />);
    const backLink = screen.getByText('Back to Admin');
    expect(backLink.closest('a')).toHaveAttribute('href', '/inventory/admin');
  });

  it('renders the ReturnRequestsPanel component', async () => {
    renderWithRouter(<ReturnRequestsPage />);
    expect(await screen.findByTestId('return-panel')).toBeInTheDocument();
  });
});
