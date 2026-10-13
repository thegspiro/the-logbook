import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SortableHeader, type SortDirection } from './SortableHeader';

const renderInTable = (currentSort: string | null, currentDirection: SortDirection, onSort = vi.fn()) =>
  render(
    <table>
      <thead>
        <tr>
          <th scope="col">
            <SortableHeader
              label="Name"
              field="name"
              currentSort={currentSort}
              currentDirection={currentDirection}
              onSort={onSort}
            />
          </th>
        </tr>
      </thead>
    </table>
  );

describe('SortableHeader', () => {
  it('reports the sort on the column header, not the button', () => {
    renderInTable('name', 'asc');
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('button', { name: 'Name' })).not.toHaveAttribute('aria-sort');
  });

  it('reports an unsorted column as none, including an active field with no direction', () => {
    const { rerender } = renderInTable(null, null);
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'none');

    rerender(
      <table>
        <thead>
          <tr>
            <th scope="col">
              <SortableHeader label="Name" field="name" currentSort="name" currentDirection={null} onSort={vi.fn()} />
            </th>
          </tr>
        </thead>
      </table>
    );
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'none');
  });

  it('cycles the sort from the keyboard', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    renderInTable(null, null, onSort);

    await user.tab();
    await user.keyboard('{Enter}');
    expect(onSort).toHaveBeenCalledWith('name', 'asc');
  });
});
