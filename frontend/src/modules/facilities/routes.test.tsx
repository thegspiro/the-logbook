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

import { FACILITIES_ACCESS_PERMISSIONS, getFacilitiesRoutes } from './routes';

describe('getFacilitiesRoutes', () => {
  it('defines facility workspace access for authorized readers and managers', () => {
    expect(FACILITIES_ACCESS_PERMISSIONS).toEqual(['facilities.view', 'facilities.manage']);
  });

  it('restricts the bulk QR code directory to managers and apparatus viewers', async () => {
    capturedAnyPermissions.length = 0;
    render(
      <MemoryRouter initialEntries={['/locations/qr-codes']}>
        <Routes>{getFacilitiesRoutes()}</Routes>
      </MemoryRouter>
    );

    expect(await screen.findByTestId('room-qr-codes-page')).toBeInTheDocument();
    // apparatus.view is admitted for the apparatus shift check-in cards only —
    // room kiosk codes are redacted server-side for non-managers, so those
    // cards never render for apparatus-only viewers.
    expect(capturedAnyPermissions).toContainEqual(['locations.manage', 'facilities.manage', 'apparatus.view']);
  });
});
