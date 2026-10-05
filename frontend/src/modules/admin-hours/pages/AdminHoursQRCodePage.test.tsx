import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

const mockGetQRData = vi.fn();
vi.mock('../services/api', () => ({
  adminHoursCategoryService: {
    getQRData: (...args: unknown[]) => mockGetQRData(...args) as unknown,
  },
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <div data-testid="qr-code" data-value={value} />,
}));

import AdminHoursQRCodePage from './AdminHoursQRCodePage';
import { useAuthStore } from '../../../stores/authStore';

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/admin-hours/categories/cat-9/qr-code']}>
      <Routes>
        <Route path="/admin-hours/categories/:categoryId/qr-code" element={<AdminHoursQRCodePage />} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  mockGetQRData.mockReset();
  mockGetQRData.mockResolvedValue({
    categoryId: 'cat-9',
    categoryName: 'Station Maintenance',
    categoryDescription: null,
    categoryColor: '#2563eb',
    organizationName: 'Oakville FD',
  });
});

afterEach(() => {
  useAuthStore.setState({ user: null });
});

describe('AdminHoursQRCodePage NFC', () => {
  it('tells a member a tag clocks them in or out, and offers no tag writer', async () => {
    useAuthStore.setState({ user: { permissions: ['admin_hours.view'] } as never });
    renderPage();

    expect(await screen.findByText(/Tap it with your phone to clock in or out/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Set up an NFC tag/ })).not.toBeInTheDocument();
  });

  it('offers an admin hours manager the tag writer, closed', async () => {
    useAuthStore.setState({ user: { permissions: ['admin_hours.manage'] } as never });
    renderPage();

    const trigger = await screen.findByRole('button', { name: /Set up an NFC tag/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
