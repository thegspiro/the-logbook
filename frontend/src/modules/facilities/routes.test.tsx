import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Routes } from 'react-router';

vi.mock('../../pages/RoomQRCodesPage', () => ({
  default: () => <div data-testid="room-qr-codes-page">Room QR codes</div>,
}));
vi.mock('./pages/FacilitiesSettingsPage', () => ({
  default: () => <div>Facility Settings</div>,
}));

const capturedAnyPermissions: string[][] = [];
const capturedPermissions: string[] = [];
let grantedPermissions: string[] = [];
vi.mock('../../components/ProtectedRoute', () => ({
  ProtectedRoute: ({
    children,
    requiredAnyPermission,
    requiredPermission,
  }: {
    children: React.ReactNode;
    requiredAnyPermission?: string[];
    requiredPermission?: string;
  }) => {
    if (requiredAnyPermission) capturedAnyPermissions.push(requiredAnyPermission);
    if (requiredPermission) capturedPermissions.push(requiredPermission);
    if (requiredPermission && !grantedPermissions.includes(requiredPermission)) return <div>Access Denied</div>;
    return <>{children}</>;
  },
}));

import { getFacilitiesRoutes } from './routes';

describe('getFacilitiesRoutes', () => {
  it.each([
    ['read-only leader', ['facilities.view'], false],
    ['regular member', [], false],
    ['facilities manager', ['facilities.manage'], true],
    ['management-level leader', ['facilities.manage', 'settings.manage'], true],
  ])('makes settings access appropriate for a %s', async (_profile, permissions, allowed) => {
    grantedPermissions = permissions;
    capturedPermissions.length = 0;
    render(
      <MemoryRouter initialEntries={['/facilities/settings']}>
        <Routes>{getFacilitiesRoutes()}</Routes>
      </MemoryRouter>
    );
    if (allowed) expect(await screen.findByText('Facility Settings')).toBeInTheDocument();
    else expect(await screen.findByText('Access Denied')).toBeInTheDocument();
    expect(capturedPermissions).toContain('facilities.manage');
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
