import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';
import { Pagination } from './Pagination';

const ControlledPagination: React.FC<{ onPageChange?: (page: number) => void }> = ({ onPageChange }) => {
  const [page, setPage] = useState(1);
  return (
    <Pagination
      currentPage={page}
      totalItems={30}
      pageSize={10}
      onPageChange={(next) => {
        onPageChange?.(next);
        setPage(next);
      }}
    />
  );
};

describe('Pagination edge buttons', () => {
  it('keeps focus on Next when it reaches the last page', async () => {
    const user = userEvent.setup();
    render(<ControlledPagination />);

    const next = screen.getByRole('button', { name: 'Next page' });
    next.focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}');

    expect(screen.getByRole('button', { name: '3' })).toHaveAttribute('aria-current', 'page');
    expect(next).toHaveAttribute('aria-disabled', 'true');
    expect(next).not.toBeDisabled();
    expect(next).toHaveFocus();
  });

  it('ignores a press on an edge button that has nowhere to go', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<ControlledPagination onPageChange={onPageChange} />);

    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    await user.click(screen.getByRole('button', { name: 'First page' }));

    expect(onPageChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'First page' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Last page' })).toHaveAttribute('aria-disabled', 'false');
  });
});
