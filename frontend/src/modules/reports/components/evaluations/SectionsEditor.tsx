/**
 * The "Sections & items" tab of the template builder.
 */

import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Star, Trash2 } from 'lucide-react';
import { useConfirm } from '../../../../contexts/ConfirmContext';
import type {
  BuilderOptions,
  EvaluationDataSource,
  TemplateDefinition,
  TemplateItem,
  TemplateSection,
} from '../../types/evaluations';
import { allItemKeys, moveItem, newItem, newSection, replaceAt, weightTotal } from '../../utils/evaluationTemplate';
import { ItemEditor } from './ItemEditor';

interface SectionsEditorProps {
  definition: TemplateDefinition;
  dataSources: EvaluationDataSource[];
  ranks: BuilderOptions['ranks'];
  onChange: (definition: TemplateDefinition) => void;
}

export const SectionsEditor: React.FC<SectionsEditorProps> = ({ definition, dataSources, ranks, onChange }) => {
  const { confirm } = useConfirm();
  const [selected, setSelected] = useState(0);
  const sections = definition.sections;
  const current = sections[Math.min(selected, sections.length - 1)];
  const currentIndex = current ? sections.indexOf(current) : -1;
  const total = weightTotal(definition);

  const setSections = (next: TemplateSection[]) => onChange({ ...definition, sections: next });

  const setSection = (section: TemplateSection) => setSections(replaceAt(sections, currentIndex, section));

  const addSection = () => {
    const section = newSection(
      'New section',
      sections.map((s) => s.key)
    );
    setSections([...sections, section]);
    setSelected(sections.length);
  };

  const removeSection = async () => {
    if (!current) return;
    if (current.items.length > 0) {
      const ok = await confirm({
        title: 'Remove this section?',
        message: `"${current.title}" and its ${current.items.length} item${current.items.length === 1 ? '' : 's'} will be removed from this draft.`,
        confirmLabel: 'Remove section',
        cancelLabel: 'Keep it',
        variant: 'danger',
      });
      if (!ok) return;
    }
    setSections(sections.filter((_, i) => i !== currentIndex));
    setSelected(Math.max(0, currentIndex - 1));
  };

  const moveSection = (to: number) => {
    setSections(moveItem(sections, currentIndex, to));
    setSelected(Math.max(0, Math.min(to, sections.length - 1)));
  };

  const setItems = (items: TemplateItem[]) => {
    if (current) setSection({ ...current, items });
  };

  const addItem = () => {
    if (!current) return;
    setItems([...current.items, newItem('New item', allItemKeys(definition))]);
  };

  const toggleRank = (code: string) => {
    const has = definition.officer_ranks.includes(code);
    onChange({
      ...definition,
      officer_ranks: has ? definition.officer_ranks.filter((r) => r !== code) : [...definition.officer_ranks, code],
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <nav aria-label="Template sections" className="card h-fit p-2">
          <ul className="space-y-1">
            {sections.map((section, index) => (
              <li key={section.key}>
                <button
                  type="button"
                  aria-current={index === currentIndex ? 'true' : undefined}
                  onClick={() => setSelected(index)}
                  className={`${
                    index === currentIndex ? 'settings-nav-item-active' : 'settings-nav-item'
                  } touch:min-h-11 flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm`}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{section.title || 'Untitled section'}</span>
                    <span className="text-theme-text-muted block text-xs">
                      {section.items.length} item{section.items.length === 1 ? '' : 's'}
                    </span>
                  </span>
                  {section.officer_only && (
                    <Star className="h-4 w-4 shrink-0 text-amber-700" aria-label="Officers only" />
                  )}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn-secondary btn-sm mt-2 w-full" onClick={addSection}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add section
          </button>
        </nav>

        {current ? (
          <div className="space-y-4">
            <div className="card space-y-4 p-4 sm:p-6">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-48 flex-1">
                  <label htmlFor="section-title" className="form-label">
                    Section title
                  </label>
                  <input
                    id="section-title"
                    className="form-input"
                    maxLength={150}
                    value={current.title}
                    onChange={(e) => setSection({ ...current, title: e.target.value })}
                  />
                </div>
                <div className="flex gap-1 self-end">
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label="Move section up"
                    disabled={currentIndex === 0}
                    onClick={() => moveSection(currentIndex - 1)}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label="Move section down"
                    disabled={currentIndex === sections.length - 1}
                    onClick={() => moveSection(currentIndex + 1)}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label="Remove section"
                    onClick={() => void removeSection()}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="section-description" className="form-label">
                  Description <span className="text-theme-text-muted font-normal">(optional)</span>
                </label>
                <textarea
                  id="section-description"
                  className="form-input"
                  rows={2}
                  maxLength={1000}
                  value={current.description ?? ''}
                  onChange={(e) => setSection({ ...current, description: e.target.value || null })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={current.officer_only}
                  onChange={(e) => setSection({ ...current, officer_only: e.target.checked })}
                />
                <span className="text-theme-text-secondary">Officers only — added for the ranks chosen below</span>
              </label>
            </div>

            {current.items.map((item, index) => (
              <ItemEditor
                key={item.key}
                item={item}
                index={index}
                count={current.items.length}
                dataSources={dataSources}
                onChange={(next) => setItems(replaceAt(current.items, index, next))}
                onRemove={() => setItems(current.items.filter((_, i) => i !== index))}
                onMove={(to) => setItems(moveItem(current.items, index, to))}
              />
            ))}
            <button type="button" className="btn-secondary inline-flex items-center gap-2 text-sm" onClick={addItem}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add item
            </button>
          </div>
        ) : (
          <div className="card text-theme-text-secondary p-6 text-sm">
            Add a section to start building the form — for example Training, Emergency response, Teamwork &amp; conduct,
            and Goals.
          </div>
        )}
      </div>

      <div className="card grid gap-6 p-4 sm:p-6 md:grid-cols-2">
        <div>
          <label htmlFor="overall-mode" className="form-label">
            Overall rating
          </label>
          <select
            id="overall-mode"
            className="form-input"
            value={definition.overall_mode}
            onChange={(e) =>
              onChange({ ...definition, overall_mode: e.target.value as TemplateDefinition['overall_mode'] })
            }
          >
            <option value="weighted">Calculated from item weights</option>
            <option value="evaluator">Chosen by the evaluator</option>
            <option value="none">No overall rating</option>
          </select>
          {definition.overall_mode === 'weighted' && (
            <p
              className={`mt-1 text-xs ${total === 100 ? 'text-theme-text-muted' : 'text-amber-800 dark:text-amber-300'}`}
              role="status"
            >
              Weights add up to {total}% — they must total 100% to publish.
            </p>
          )}
        </div>
        <fieldset>
          <legend className="form-label">Ranks that receive officer-only sections</legend>
          {ranks.length === 0 ? (
            <p className="text-theme-text-muted text-sm">Your department has no ranks set up.</p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {ranks.map((rank) => (
                <label key={rank.rank_code} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={definition.officer_ranks.includes(rank.rank_code)}
                    onChange={() => toggleRank(rank.rank_code)}
                  />
                  <span className="text-theme-text-secondary">
                    {rank.display_name}
                    {rank.is_active ? '' : ' (inactive)'}
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      </div>
    </div>
  );
};
