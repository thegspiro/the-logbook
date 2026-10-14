import { describe, it, expect } from 'vitest';
import type { BudgetCategory } from '../types';
import { categoryPathLabel, descendantIds, groupBudgetsByCategoryTree, orderCategoryTree } from './budgetCategoryTree';

const cat = (id: string, name: string, parentCategoryId?: string, sortOrder = 0): BudgetCategory => ({
  id,
  organizationId: 'org',
  name,
  sortOrder,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...(parentCategoryId ? { parentCategoryId } : {}),
});

const rows = (categories: BudgetCategory[]) =>
  orderCategoryTree(categories).map(({ category, depth }) => `${'-'.repeat(depth)}${category.name}`);

describe('orderCategoryTree', () => {
  it('puts each sub-category beneath its parent, siblings by order then name', () => {
    expect(
      rows([
        cat('brass', 'Officer brass', 'qm'),
        cat('training', 'Training'),
        cat('boots', 'Boot reimbursement', 'qm'),
        cat('qm', 'Quartermaster'),
        cat('dress', 'Dress', 'brass'),
        cat('admin', 'Admin', undefined, 5),
      ])
    ).toEqual(['Quartermaster', '-Boot reimbursement', '-Officer brass', '--Dress', 'Training', 'Admin']);
  });

  it('draws a category whose parent is not in the list at the top level', () => {
    expect(rows([cat('brass', 'Officer brass', 'missing')])).toEqual(['Officer brass']);
  });

  it('cuts a stored cycle instead of looping', () => {
    expect(rows([cat('a', 'A', 'b'), cat('b', 'B', 'a')])).toEqual(['A', '-B']);
  });
});

describe('descendantIds', () => {
  it('finds every category beneath one, not the category itself', () => {
    const categories = [cat('qm', 'Quartermaster'), cat('brass', 'Brass', 'qm'), cat('dress', 'Dress', 'brass')];
    expect(descendantIds(categories, 'qm')).toEqual(new Set(['brass', 'dress']));
    expect(descendantIds(categories, 'dress')).toEqual(new Set());
  });
});

describe('categoryPathLabel', () => {
  it('joins the path the backend reports, falling back to the name', () => {
    expect(categoryPathLabel({ ...cat('brass', 'Officer brass'), path: ['Quartermaster', 'Officer brass'] })).toBe(
      'Quartermaster › Officer brass'
    );
    expect(categoryPathLabel(cat('training', 'Training'))).toBe('Training');
  });
});

describe('groupBudgetsByCategoryTree', () => {
  const categories = [
    cat('training', 'Training'),
    cat('qm', 'Quartermaster'),
    cat('boots', 'Boot reimbursement', 'qm'),
    cat('brass', 'Officer brass', 'qm'),
  ];

  it('groups lines under their top-level category in tree order', () => {
    const groups = groupBudgetsByCategoryTree(
      [
        { id: 'l-brass', categoryId: 'brass' },
        { id: 'l-training', categoryId: 'training' },
        { id: 'l-qm', categoryId: 'qm' },
        { id: 'l-boots', categoryId: 'boots' },
        { id: 'l-unknown', categoryId: 'gone' },
      ],
      categories
    );
    expect(groups.map((g) => [g.rootName, g.hasSubLines, g.rows.map((r) => `${r.depth}:${r.budget.id}`)])).toEqual([
      ['Quartermaster', true, ['0:l-qm', '1:l-boots', '1:l-brass']],
      ['Training', false, ['0:l-training']],
      ['Unknown', false, ['0:l-unknown']],
    ]);
  });
});
