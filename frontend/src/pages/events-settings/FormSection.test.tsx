import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FormSection from './FormSection';
import type { EventRequestFormSummary } from './types';

const onNavigateToForms = vi.fn();

const draft: EventRequestFormSummary = {
  id: 'f-draft',
  name: 'Community Event Request',
  status: 'draft',
  is_public: false,
};

const renderSection = (forms: EventRequestFormSummary[]) =>
  render(
    <FormSection
      generatingForm={false}
      onGenerateForm={vi.fn()}
      onNavigateToForms={onNavigateToForms}
      eventRequestForms={forms}
      loadingForms={false}
    />
  );

/**
 * W22-5: a draft form's notice told the officer to "Go to Forms to edit and
 * publish" in plain text, so the one action it named had to be found
 * elsewhere on the page.
 */
describe('FormSection — a draft form', () => {
  beforeEach(() => {
    onNavigateToForms.mockReset();
  });

  it('makes "Go to Forms to edit and publish" a control that opens Forms', async () => {
    const user = userEvent.setup();
    renderSection([draft]);

    const goToForms = screen.getByRole('button', {
      name: 'Go to Forms to edit and publish Community Event Request',
    });
    await user.click(goToForms);

    expect(onNavigateToForms).toHaveBeenCalledTimes(1);
  });

  it('names each draft in its own control when there are several', () => {
    renderSection([draft, { ...draft, id: 'f-two', name: 'Station Tour Request' }]);

    expect(
      screen.getByRole('button', { name: 'Go to Forms to edit and publish Station Tour Request' })
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Go to Forms to edit and publish / })).toHaveLength(2);
  });
});
