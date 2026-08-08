import React, { useState } from 'react';
import { Plus, X, Pencil, ChevronUp, ChevronDown } from 'lucide-react';

interface EditingState {
  index: number;
  value: string;
}

interface EditableTagListProps {
  items: string[];
  onItemsChange: (items: string[]) => void;
  placeholder?: string;
  defaultSuggestions?: string[];
  suggestionsLabel?: string;
  tagColorClass?: string;
  getTagClassName?: (item: string) => string;
  getTagTitle?: (item: string) => string;
  reorderable?: boolean;
}

const EditableTagList: React.FC<EditableTagListProps> = ({
  items,
  onItemsChange,
  placeholder = 'Add item...',
  defaultSuggestions,
  suggestionsLabel,
  tagColorClass = 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20',
  getTagClassName,
  getTagTitle,
  reorderable = false,
}) => {
  const [newValue, setNewValue] = useState('');
  const [editing, setEditing] = useState<EditingState | null>(null);

  const addItem = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || items.includes(trimmed)) return;
    onItemsChange([...items, trimmed]);
    setNewValue('');
  };

  const removeItem = (index: number) => {
    onItemsChange(items.filter((_, i) => i !== index));
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const updated = [...items];
    const temp = updated[index] ?? '';
    updated[index] = updated[target] ?? '';
    updated[target] = temp;
    onItemsChange(updated);
  };

  const commitEdit = () => {
    if (!editing) return;
    const trimmed = editing.value.trim();
    if (trimmed) {
      const updated = [...items];
      updated[editing.index] = trimmed;
      onItemsChange(updated);
    }
    setEditing(null);
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {items.map((item, i) => {
          if (editing?.index === i) {
            return (
              <input
                key={i}
                autoFocus
                type="text"
                value={editing.value}
                onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    (e.target as HTMLInputElement).blur();
                  }
                  if (e.key === 'Escape') {
                    setEditing(null);
                  }
                }}
                className="bg-theme-surface text-theme-text-primary w-48 rounded-full border-2 border-violet-500 px-2.5 py-1 text-xs font-medium focus:outline-hidden"
              />
            );
          }

          const className = getTagClassName ? getTagClassName(item) : tagColorClass;
          const title = getTagTitle ? getTagTitle(item) : undefined;

          return (
            <span
              key={i}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${className}`}
              title={title}
            >
              {item}
              {reorderable && (
                <>
                  <button
                    type="button"
                    onClick={() => moveItem(i, -1)}
                    disabled={i === 0}
                    className="hover:text-violet-500 disabled:opacity-30"
                    title="Move up"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveItem(i, 1)}
                    disabled={i === items.length - 1}
                    className="hover:text-violet-500 disabled:opacity-30"
                    title="Move down"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setEditing({ index: i, value: item })}
                className="hover:text-violet-500"
                title="Edit"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button type="button" onClick={() => removeItem(i)} className="hover:text-red-500">
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addItem(newValue);
            }
          }}
          placeholder={placeholder}
          className="border-theme-surface-border bg-theme-surface text-theme-text-primary flex-1 rounded-lg border px-3 py-1.5 text-sm focus:ring-2 focus:ring-violet-500"
        />
        <button
          type="button"
          onClick={() => addItem(newValue)}
          disabled={!newValue.trim()}
          className="bg-theme-surface-hover text-theme-text-secondary hover:bg-theme-surface-secondary inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm transition-colors disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>

      {defaultSuggestions && defaultSuggestions.length > 0 && items.length === 0 && (
        <button
          type="button"
          onClick={() => onItemsChange([...defaultSuggestions])}
          className="mt-2 text-xs text-violet-600 hover:underline dark:text-violet-400"
        >
          {suggestionsLabel || `Copy from defaults (${defaultSuggestions.length} items)`}
        </button>
      )}
    </div>
  );
};

export default EditableTagList;
