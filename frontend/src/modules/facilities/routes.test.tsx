import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Routes } from 'react-router';

vi.mock('../../pages/RoomQRCodesPage', () => ({
  default: () => <div data-testid="room-qr-codes-page">Room QR codes</div>,
}));

const capturedAnyPermissions: string[][] = [];
vi.mock('../../components/ProtectedRoute', () => ({
  ProtectedRoute: ({
    children,
    requiredAnyPermission,
  }: {
    children: React.ReactNode;
    requiredAnyPermission?: string[];
  }) => {
    if (requiredAnyPermission) capturedAnyPermissions.push(requiredAnyPermission);
    return <>{children}</>;
  },
}));

import { getFacilitiesRoutes } from './routes';

describe('getFacilitiesRoutes', () => {
  it('restricts the bulk QR code directory to location or facility managers', async () => {
    capturedAnyPermissions.length = 0;
    render(
      <MemoryRouter initialEntries={['/locations/qr-codes']}>
        <Routes>{getFacilitiesRoutes()}</Routes>
      </MemoryRouter>
    );

    expect(await screen.findByTestId('room-qr-codes-page')).toBeInTheDocument();
    expect(capturedAnyPermissions).toContainEqual(['locations.manage', 'facilities.manage']);
  });
});
