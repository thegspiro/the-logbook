import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../stores/authStore';
import { getReportsRoutes } from './routes';

vi.mock('./pages/ReportsPage', () => ({
  default: () => <div>Reports content</div>,
}));

describe('reports routes', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      user: { permissions: [] } as never,
    });
  });

  const renderReportsRoute = () =>
    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>{getReportsRoutes()}</Routes>
      </MemoryRouter>
    );

  it('denies a regular member without reports.view', () => {
    renderReportsRoute();

    expect(screen.getByRole('heading', { name: 'Access Denied' })).toBeInTheDocument();
    expect(screen.queryByText('Reports content')).not.toBeInTheDocument();
  });

  it('allows a member with reports.view', async () => {
    useAuthStore.setState({ user: { permissions: ['reports.view'] } as never });

    renderReportsRoute();

    expect(await screen.findByText('Reports content')).toBeInTheDocument();
  });
});
