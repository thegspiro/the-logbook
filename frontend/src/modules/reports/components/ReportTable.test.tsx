import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportTable } from './ReportTable';

const columns = [
  { key: 'name', header: 'Name' },
  { key: 'value', header: 'Value', align: 'right' as const },
];

describe('ReportTable', () => {
  it('renders empty message when no rows', () => {
    render(<ReportTable rows={[]} columns={columns} />);
    expect(screen.getByText('No data found.')).toBeInTheDocument();
  });

  it('renders custom empty message', () => {
    render(<ReportTable rows={[]} columns={columns} emptyMessage="Nothing here." />);
    expect(screen.getByText('Nothing here.')).toBeInTheDocument();
  });

  it('renders table with data', () => {
    const rows = [
      { name: 'Alice', value: 10 },
      { name: 'Bob', value: 20 },
    ];
    render(<ReportTable rows={rows} columns={columns} />);

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it('renders column headers', () => {
    const rows = [{ name: 'Alice', value: 10 }];
    render(<ReportTable rows={rows} columns={columns} />);

    // By role: the card-mode Sort by control lists the same labels as options.
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Value' })).toBeInTheDocument();
  });

  it('shows row count', () => {
    const rows = [{ name: 'Alice', value: 10 }];
    render(<ReportTable rows={rows} columns={columns} />);

    expect(screen.getByText(/1–1 of 1 rows/)).toBeInTheDocument();
  });

  it('sorts by column when clicked', async () => {
    const user = userEvent.setup();
    const rows = [
      { name: 'Charlie', value: 30 },
      { name: 'Alice', value: 10 },
      { name: 'Bob', value: 20 },
    ];
    render(<ReportTable rows={rows} columns={columns} />);

    // Click Name header to sort
    await user.click(screen.getByRole('button', { name: 'Name' }));

    const cells = screen.getAllByRole('cell');
    // After asc sort, first name cell should be Alice
    expect(cells[0]?.textContent).toBe('Alice');
  });

  describe('sorting from the keyboard', () => {
    const rows = [
      { name: 'Charlie', value: 30 },
      { name: 'Alice', value: 10 },
      { name: 'Bob', value: 20 },
    ];
    const firstName = () => screen.getAllByRole('cell')[0]?.textContent;

    it('reaches a header with Tab and sorts it with Enter, then Space', async () => {
      const user = userEvent.setup();
      render(<ReportTable rows={rows} columns={columns} />);
      const nameHeader = screen.getByRole('columnheader', { name: 'Name' });

      // jsdom applies no stylesheet, so the card-mode Sort by select, hidden
      // at a desktop width in a browser, is in the tab order here: region,
      // select, then the header (the direction button is disabled until a
      // column is chosen).
      await user.tab();
      await user.tab();
      await user.tab();
      expect(screen.getByRole('button', { name: 'Name' })).toHaveFocus();

      await user.keyboard('{Enter}');
      expect(firstName()).toBe('Alice');
      expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');

      await user.keyboard(' ');
      expect(firstName()).toBe('Charlie');
      expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
    });

    it('returns to the report order on a third press', async () => {
      const user = userEvent.setup();
      render(<ReportTable rows={rows} columns={columns} />);
      const button = screen.getByRole('button', { name: 'Name' });

      await user.click(button);
      await user.click(button);
      await user.click(button);
      expect(firstName()).toBe('Charlie');
      expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'none');
    });

    it('gives an unsortable column no button', () => {
      render(
        <ReportTable
          rows={rows}
          columns={[
            { key: 'name', header: 'Name', sortable: false },
            { key: 'value', header: 'Value', align: 'right' },
          ]}
        />
      );
      expect(screen.queryByRole('button', { name: 'Name' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Value' })).toBeInTheDocument();
    });
  });

  it('paginates rows', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      name: `Item ${i}`,
      value: i,
    }));
    render(<ReportTable rows={rows} columns={columns} pageSize={10} />);

    expect(screen.getByText(/1–10 of 30 rows/)).toBeInTheDocument();
    expect(screen.getByText('Item 0')).toBeInTheDocument();
    // Item 15 should not be on page 1
    expect(screen.queryByText('Item 15')).not.toBeInTheDocument();
  });

  it('uses custom render function', () => {
    const customColumns = [
      {
        key: 'name',
        header: 'Name',
        render: (v: unknown) => `**${String(v)}**`,
      },
    ];
    const rows = [{ name: 'Test' }];
    render(<ReportTable rows={rows} columns={customColumns} />);
    expect(screen.getByText('**Test**')).toBeInTheDocument();
  });
});
