import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CrrActivityType, CrrCatalogue } from '../../types/crr';

const getCatalogue = vi.fn();
const createType = vi.fn();
const updateType = vi.fn();
const deleteType = vi.fn();
const setTypeTags = vi.fn();
const updateSettings = vi.fn();
vi.mock('../../services/crrServices', () => ({
  crrService: {
    getCatalogue: (...args: unknown[]) => getCatalogue(...args) as unknown,
    createType: (...args: unknown[]) => createType(...args) as unknown,
    updateType: (...args: unknown[]) => updateType(...args) as unknown,
    deleteType: (...args: unknown[]) => deleteType(...args) as unknown,
    setTypeTags: (...args: unknown[]) => setTypeTags(...args) as unknown,
    updateSettings: (...args: unknown[]) => updateSettings(...args) as unknown,
  },
}));

import { renderWithRouter } from '../../test/utils';
import CrrCatalogueSection from './CrrCatalogueSection';

const smoke: CrrActivityType = {
  id: 't-smoke',
  code: 'smoke_alarm_install',
  name: 'Smoke alarm install',
  description: "Smoke alarms installed in a resident's home.",
  is_system: true,
  is_active: true,
  sort_order: 0,
  measures: [{ id: 'm-1', code: 'alarms_installed', label: 'Alarms installed', is_active: true, sort_order: 0 }],
  tag_ids: ['tag-fire'],
  admin_hours_category_id: null,
};

const knox: CrrActivityType = {
  id: 't-knox',
  code: 'knox_box_check',
  name: 'Knox box check',
  description: null,
  is_system: false,
  is_active: true,
  sort_order: 1,
  measures: [],
  tag_ids: [],
  admin_hours_category_id: null,
};

const catalogue = (): CrrCatalogue => ({
  activity_types: [structuredClone(smoke), structuredClone(knox)],
  tags: [
    { id: 'tag-fire', kind: 'risk', code: 'fire', label: 'Fire', is_system: true, is_active: true, sort_order: 0 },
    {
      id: 'tag-older',
      kind: 'population',
      code: 'older_adults',
      label: 'Older adults',
      is_system: true,
      is_active: true,
      sort_order: 0,
    },
  ],
  admin_hours_categories: [{ id: 'cat-outreach', name: 'Outreach' }],
  resident_details_retention_months: 24,
});

const card = (name: string) => screen.findByRole('listitem', { name });

describe('CrrCatalogueSection', () => {
  beforeEach(() => {
    for (const mock of [getCatalogue, createType, updateType, deleteType, setTypeTags, updateSettings])
      mock.mockReset();
    getCatalogue.mockResolvedValue(catalogue());
  });

  it('shows juvenile firesetter intervention as coming soon, with nothing to press', async () => {
    renderWithRouter(<CrrCatalogueSection />);

    const comingSoon = await card('Juvenile firesetter intervention');
    expect(within(comingSoon).getByText('Coming soon')).toBeInTheDocument();
    expect(within(comingSoon).queryByRole('button')).not.toBeInTheDocument();
  });

  it('retires a built-in type and offers no delete for it', async () => {
    const user = userEvent.setup();
    updateType.mockResolvedValue({ ...smoke, is_active: false });
    renderWithRouter(<CrrCatalogueSection />);

    const smokeCard = await card('Smoke alarm install');
    expect(within(smokeCard).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    await user.click(within(smokeCard).getByRole('button', { name: 'Retire Smoke alarm install' }));

    expect(updateType).toHaveBeenCalledWith('t-smoke', { is_active: false });
    expect(await within(smokeCard).findByText('Retired')).toBeInTheDocument();
  });

  it('deletes a type the department added only after confirming', async () => {
    const user = userEvent.setup();
    deleteType.mockResolvedValue(undefined);
    renderWithRouter(<CrrCatalogueSection />);

    const knoxCard = await card('Knox box check');
    await user.click(within(knoxCard).getByRole('button', { name: 'Delete Knox box check' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(deleteType).not.toHaveBeenCalled();

    await user.click(within(knoxCard).getByRole('button', { name: 'Delete Knox box check' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(deleteType).toHaveBeenCalledWith('t-knox');
  });

  it('adds a type with the counts typed, split on commas', async () => {
    const user = userEvent.setup();
    createType.mockResolvedValue({ ...knox, id: 't-water', name: 'Water safety talk' });
    renderWithRouter(<CrrCatalogueSection />);

    await user.type(await screen.findByLabelText('Name'), 'Water safety talk');
    await user.type(screen.getByLabelText('Counts (optional)'), 'People reached, , Sessions ');
    await user.click(screen.getByRole('button', { name: 'Add activity type' }));

    expect(createType).toHaveBeenCalledWith({ name: 'Water safety talk', measures: ['People reached', 'Sessions'] });
  });

  it('sends the whole tag list when one tag is ticked', async () => {
    const user = userEvent.setup();
    setTypeTags.mockResolvedValue({ ...smoke, tag_ids: ['tag-fire', 'tag-older'] });
    renderWithRouter(<CrrCatalogueSection />);

    const smokeCard = await card('Smoke alarm install');
    await user.click(within(smokeCard).getByRole('checkbox', { name: 'Older adults' }));

    expect(setTypeTags).toHaveBeenCalledWith('t-smoke', ['tag-fire', 'tag-older']);
    expect(await within(smokeCard).findByRole('checkbox', { name: 'Older adults' })).toBeChecked();
  });

  it('shows a retired default tag so it can be removed, but offers no retired tag to add', async () => {
    const user = userEvent.setup();
    const data = catalogue();
    data.tags = data.tags.map((t) => (t.id === 'tag-fire' ? { ...t, is_active: false } : t));
    data.tags.push({
      id: 'tag-drown',
      kind: 'risk',
      code: 'drowning',
      label: 'Drowning',
      is_system: true,
      is_active: false,
      sort_order: 1,
    });
    getCatalogue.mockResolvedValue(data);
    setTypeTags.mockResolvedValue({ ...smoke, tag_ids: [] });
    renderWithRouter(<CrrCatalogueSection />);

    const smokeCard = await card('Smoke alarm install');
    const fire = within(smokeCard).getByRole('checkbox', { name: 'Fire (retired)' });
    expect(fire).toBeChecked();
    expect(within(smokeCard).queryByRole('checkbox', { name: /Drowning/ })).not.toBeInTheDocument();
    await user.click(fire);

    expect(setTypeTags).toHaveBeenCalledWith('t-smoke', []);
  });

  it('shows its load error', async () => {
    getCatalogue.mockRejectedValue(new Error('The server is down'));
    renderWithRouter(<CrrCatalogueSection />);

    expect(await screen.findByRole('alert')).toHaveTextContent('The server is down');
  });
});

describe('CrrCatalogueSection settings', () => {
  beforeEach(() => {
    for (const mock of [getCatalogue, updateType, updateSettings]) mock.mockReset();
    getCatalogue.mockResolvedValue(catalogue());
  });

  it("sets a type's Admin Hours category, and back to the mapping", async () => {
    const user = userEvent.setup();
    updateType.mockResolvedValueOnce({ ...smoke, admin_hours_category_id: 'cat-outreach' });
    updateType.mockResolvedValueOnce({ ...smoke, admin_hours_category_id: null });
    renderWithRouter(<CrrCatalogueSection />);

    const smokeCard = await card('Smoke alarm install');
    const picker = within(smokeCard).getByLabelText('Admin Hours category');
    await user.selectOptions(picker, 'cat-outreach');
    expect(updateType).toHaveBeenLastCalledWith('t-smoke', { admin_hours_category_id: 'cat-outreach' });
    await user.selectOptions(picker, '');
    expect(updateType).toHaveBeenLastCalledWith('t-smoke', { admin_hours_category_id: null });
  });

  it('says a deactivated Admin Hours category credits nothing, rather than showing the mapping', async () => {
    const data = catalogue();
    data.activity_types = data.activity_types.map((t) =>
      t.id === 't-smoke' ? { ...t, admin_hours_category_id: 'cat-gone' } : t
    );
    getCatalogue.mockResolvedValue(data);
    renderWithRouter(<CrrCatalogueSection />);

    const smokeCard = await card('Smoke alarm install');
    const picker = within(smokeCard).getByLabelText<HTMLSelectElement>('Admin Hours category');
    expect(picker.value).toBe('cat-gone');
    expect(picker.selectedOptions[0]?.textContent).toBe('A deactivated category (credits nothing)');
  });

  it('saves how long resident details are kept', async () => {
    const user = userEvent.setup();
    updateSettings.mockResolvedValue(12);
    renderWithRouter(<CrrCatalogueSection />);

    const field = await screen.findByLabelText('Keep for (months)');
    const save = within(screen.getByRole('region', { name: 'Resident details' })).getByRole('button', {
      name: 'Save',
    });
    expect(save).toBeDisabled();
    await user.clear(field);
    await user.type(field, '12');
    await user.click(save);

    expect(updateSettings).toHaveBeenCalledWith(12);
  });
});
