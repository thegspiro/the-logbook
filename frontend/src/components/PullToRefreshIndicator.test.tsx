import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PullToRefreshIndicator } from './PullToRefreshIndicator';

describe('PullToRefreshIndicator', () => {
  it('renders nothing when idle', () => {
    render(
      <PullToRefreshIndicator pulling={false} refreshing={false} pullDistance={0} />
    );
    expect(screen.queryByLabelText('Pull to refresh')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Refreshing')).not.toBeInTheDocument();
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
    render(
      <PullToRefreshIndicator pulling={true} refreshing={false} pullDistance={80} threshold={80} />
    );
    const arrow = screen.getByTestId('pull-arrow');
    expect(arrow).toBeInTheDocument();
    // At progress=1, rotation should be 180deg
    expect(arrow.style.transform).toBe('rotate(180deg)');
  });

  it('shows spinner icon when refreshing', () => {
    render(
      <PullToRefreshIndicator pulling={false} refreshing={true} pullDistance={0} />
    );
    const indicator = screen.getByLabelText('Refreshing');
    expect(indicator).toBeInTheDocument();
  });
});
