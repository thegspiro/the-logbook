import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormField } from './FormField';
import { ErrorSummary } from './ErrorSummary';

describe('FormField', () => {
  it('labels the control it wraps', () => {
    render(
      <FormField id="name" label="Name">
        {(field) => <input {...field} />}
      </FormField>
    );

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('id', 'name');
  });

  it('announces a required field without letting the browser enforce it', () => {
    render(
      <FormField id="name" label="Name" required>
        {(field) => <input {...field} />}
      </FormField>
    );

    const input = screen.getByRole('textbox', { name: /^Name/ });
    expect(input).toHaveAttribute('aria-required', 'true');
    // A native `required` inside a <form> would refuse a draft save.
    expect(input).not.toHaveAttribute('required');
  });

  it('ties the error and the hint to the control, error first', () => {
    render(
      <FormField id="name" label="Name" hint="As on your ID" error="Enter a name.">
        {(field) => <input {...field} />}
      </FormField>
    );

    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'name-error name-hint');
    expect(input).toHaveAccessibleDescription('Enter a name. As on your ID');
  });

  it('carries no invalid state or description when there is neither', () => {
    render(
      <FormField id="name" label="Name">
        {(field) => <input {...field} />}
      </FormField>
    );

    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('works for a select as well as an input', () => {
    render(
      <FormField id="kind" label="Kind" error="Choose one.">
        {(field) => (
          <select {...field}>
            <option value="">Choose…</option>
          </select>
        )}
      </FormField>
    );

    expect(screen.getByRole('combobox', { name: 'Kind' })).toHaveAccessibleDescription('Choose one.');
  });
});

describe('ErrorSummary', () => {
  const items = [
    { id: 'first', label: 'First name', message: 'Enter a first name.' },
    { id: 'date', label: 'Date', message: 'Enter a date.' },
  ];

  it('renders nothing when there is nothing to report', () => {
    const { container } = render(<ErrorSummary items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists each error as a link that moves focus to its field', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ErrorSummary items={items} />
        <input id="first" aria-label="First name" />
        <input id="date" aria-label="Date" />
      </>
    );

    await user.click(screen.getByRole('link', { name: 'Date: Enter a date.' }));
    expect(screen.getByRole('textbox', { name: 'Date' })).toHaveFocus();
  });

  it('takes focus when focusKey is bumped, not on first render', () => {
    const { rerender } = render(<ErrorSummary items={items} focusKey={0} />);
    expect(screen.getByRole('alert')).not.toHaveFocus();

    rerender(<ErrorSummary items={items} focusKey={1} />);
    expect(screen.getByRole('alert')).toHaveFocus();
  });

  it('shows a message that belongs to no field', () => {
    render(<ErrorSummary items={[]} formError="The server is busy." />);
    expect(screen.getByRole('alert')).toHaveTextContent('The server is busy.');
  });
});
