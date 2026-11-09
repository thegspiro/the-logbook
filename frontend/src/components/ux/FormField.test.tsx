import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormField } from './FormField';
import { ErrorSummary } from './ErrorSummary';

describe('FormField', () => {
  it('labels the control and announces it as required when it shows the asterisk', () => {
    render(
      <FormField label="First name" required>
        {(field) => <input {...field} />}
      </FormField>
    );
    const input = screen.getByLabelText(/First name/);
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).not.toHaveAttribute('required');
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true');
  });

  it('marks nothing on an optional field', () => {
    render(<FormField label="Middle name">{(field) => <input {...field} />}</FormField>);
    expect(screen.getByLabelText('Middle name')).not.toHaveAttribute('aria-required');
    expect(screen.queryByText('*')).not.toBeInTheDocument();
  });

  it('ties the error to the control and marks it invalid', () => {
    render(
      <FormField label="Email" error="Enter a valid email address" hint="Where the welcome email goes">
        {(field) => <input {...field} />}
      </FormField>
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a valid email address Where the welcome email goes');
  });

  it('is not invalid without an error', () => {
    render(<FormField label="Email">{(field) => <input {...field} />}</FormField>);
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-describedby');
  });

  it('passes maxLength and shows a counter only near the limit', () => {
    const { rerender } = render(
      <FormField label="Title" maxLength={100} count={10}>
        {(field) => <input {...field} />}
      </FormField>
    );
    expect(screen.getByLabelText('Title')).toHaveAttribute('maxlength', '100');
    expect(screen.queryByText('10 / 100')).not.toBeInTheDocument();
    rerender(
      <FormField label="Title" maxLength={100} count={85}>
        {(field) => <input {...field} />}
      </FormField>
    );
    expect(screen.getByText('85 / 100')).toBeInTheDocument();
  });

  it('keeps a caller’s fixed id', () => {
    render(
      <FormField label="Course" id="course-name">
        {(field) => <input {...field} />}
      </FormField>
    );
    expect(screen.getByLabelText('Course')).toHaveAttribute('id', 'course-name');
  });

  it('writes "(optional)" in brackets, as the rest of the app does', () => {
    render(
      <FormField label="Notes" optional>
        {(field) => <input {...field} />}
      </FormField>
    );
    expect(screen.getByText('(optional)')).toBeInTheDocument();
  });

  it("takes a page's own label style and still ties the label to its control", () => {
    render(
      <FormField label="Badge number" labelClassName="page-label">
        {(field) => <input {...field} />}
      </FormField>
    );
    const input = screen.getByRole('textbox', { name: 'Badge number' });
    expect(screen.getByText('Badge number')).toHaveClass('page-label');
    expect(screen.getByText('Badge number')).not.toHaveClass('form-label');
    expect(input).toBeInTheDocument();
  });

  it('shows no error for a null one', () => {
    render(
      <FormField label="Name" error={null}>
        {(field) => <input {...field} />}
      </FormField>
    );
    expect(screen.getByRole('textbox', { name: 'Name' })).not.toHaveAttribute('aria-invalid');
  });
});

describe('FormField with a fixed id', () => {
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

  it('gives two summaries on one page their own accessible names', () => {
    render(
      <>
        <ErrorSummary items={items} title="Shift" />
        <ErrorSummary items={items} title="Report" />
      </>
    );

    expect(screen.getByRole('alert', { name: 'Shift' })).toBeInTheDocument();
    expect(screen.getByRole('alert', { name: 'Report' })).toBeInTheDocument();
  });

  it('shows a message that belongs to no field', () => {
    render(<ErrorSummary items={[]} formError="The server is busy." />);
    expect(screen.getByRole('alert')).toHaveTextContent('The server is busy.');
  });
});
