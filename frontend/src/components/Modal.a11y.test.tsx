/**
 * Accessibility tests for core UI components using vitest-axe.
 *
 * These tests render components and run axe-core to check for WCAG
 * violations (missing labels, invalid ARIA attributes, color contrast, etc.).
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Modal } from './Modal';

describe('Modal accessibility', () => {
  it('has no axe violations when open', async () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Test Modal">
        <p>Modal content</p>
      </Modal>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations with footer', async () => {
    const { container } = render(
      <Modal
        isOpen={true}
        onClose={() => {}}
        title="Test Modal"
        footer={<button>Save</button>}
      >
        <p>Modal content with footer</p>
      </Modal>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
