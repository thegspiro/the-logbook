import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../stores/authStore';
import { getFormsRoutes } from './routes';

vi.mock('../../pages/FormsPage', () => ({
  default: () => <div>Forms administration</div>,
}));

describe('forms routes', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      user: { permissions: [] } as never,
    });
  });

  const renderFormsRoute = () =>
    render(
      <MemoryRouter initialEntries={['/forms']}>
        <Routes>{getFormsRoutes()}</Routes>
      </MemoryRouter>
    );

  it('denies a regular member with only forms.view', () => {
    useAuthStore.setState({ user: { permissions: ['forms.view'] } as never });

    renderFormsRoute();

    expect(screen.getByRole('heading', { name: 'Access Denied' })).toBeInTheDocument();
    expect(screen.queryByText('Forms administration')).not.toBeInTheDocument();
  });

  it('allows a member with forms.manage', async () => {
    useAuthStore.setState({ user: { permissions: ['forms.manage'] } as never });

    renderFormsRoute();

    expect(await screen.findByText('Forms administration')).toBeInTheDocument();
  });
});
