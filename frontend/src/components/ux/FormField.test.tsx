import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormField } from './FormField';

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
});
