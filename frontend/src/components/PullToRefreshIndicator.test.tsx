import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PullToRefreshIndicator } from './PullToRefreshIndicator';

describe('PullToRefreshIndicator', () => {
  it('renders nothing when idle', () => {
    const { container } = render(
      <PullToRefreshIndicator pulling={false} refreshing={false} pullDistance={0} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders when pulling', () => {
    render(
      <PullToRefreshIndicator pulling={true} refreshing={false} pullDistance={40} />
    );
    expect(screen.getByLabelText('Pull to refresh')).toBeInTheDocument();
  });

  it('shows refreshing label when refreshing', () => {
    render(
      <PullToRefreshIndicator pulling={false} refreshing={true} pullDistance={0} />
    );
    expect(screen.getByLabelText('Refreshing')).toBeInTheDocument();
  });

  it('caps arrow rotation at progress=1', () => {
    const { container } = render(
      <PullToRefreshIndicator pulling={true} refreshing={false} pullDistance={80} threshold={80} />
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    // At progress=1, rotation should be 180deg
    expect(svg?.style.transform).toBe('rotate(180deg)');
  });

  it('shows spinner icon when refreshing', () => {
    const { container } = render(
      <PullToRefreshIndicator pulling={false} refreshing={true} pullDistance={0} />
    );
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });
});
