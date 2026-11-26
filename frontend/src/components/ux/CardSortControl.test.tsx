import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardSortControl } from './CardSortControl';
import type { SortDirection } from './SortableHeader';

const options = [
  { field: 'name', label: 'Name' },
  { field: 'hours', label: 'Hours' },
];

const onSort = vi.fn<(field: string, direction: SortDirection) => void>();

function renderControl(currentSort: string | null, currentDirection: SortDirection) {
  return render(
    <CardSortControl
      options={options}
      currentSort={currentSort}
      currentDirection={currentDirection}
      onSort={onSort}
      tier="wide"
    />
  );
}

describe('CardSortControl', () => {
  beforeEach(() => {
    onSort.mockReset();
  });

  it('labels the select and lists the default order and every column', () => {
    renderControl(null, null);
    const select = screen.getByRole('combobox', { name: 'Sort by' });
    expect(select).toHaveValue('');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Default order', 'Name', 'Hours']);
  });

  it('leaves out the default order for a table that is always sorted', () => {
    render(
      <CardSortControl
        options={options}
        currentSort="hours"
        currentDirection="asc"
        onSort={onSort}
        allowDefault={false}
      />
    );
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Name', 'Hours']);
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('hours');
  });

  it('sorts ascending by a column picked with nothing sorted yet', async () => {
    const user = userEvent.setup();
    renderControl(null, null);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'hours');
    expect(onSort).toHaveBeenCalledWith('hours', 'asc');
  });

  it('keeps the chosen direction when another column is picked', async () => {
    const user = userEvent.setup();
    renderControl('hours', 'desc');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'name');
    expect(onSort).toHaveBeenCalledWith('name', 'desc');
  });

  it('clears the sort when the default order is picked', async () => {
    const user = userEvent.setup();
    renderControl('hours', 'asc');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), '');
    expect(onSort).toHaveBeenCalledWith('hours', null);
  });

  it('reverses the direction from the button', async () => {
    const user = userEvent.setup();
    renderControl('hours', 'asc');
    await user.click(screen.getByRole('button', { name: 'Sort descending' }));
    expect(onSort).toHaveBeenCalledWith('hours', 'desc');
  });

  it('offers ascending once the order is descending', () => {
    renderControl('hours', 'desc');
    expect(screen.getByRole('button', { name: 'Sort ascending' })).toBeEnabled();
  });

  it('disables the direction button until a column is chosen', () => {
    renderControl(null, null);
    expect(screen.getByRole('button', { name: 'Sort descending' })).toBeDisabled();
  });
});
