import React, { useState } from "react";
import { Plus, X, Pencil } from "lucide-react";

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
}

const EditableTagList: React.FC<EditableTagListProps> = ({
  items,
  onItemsChange,
  placeholder = "Add item...",
  defaultSuggestions,
  suggestionsLabel,
  tagColorClass = "bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20",
  getTagClassName,
  getTagTitle,
}) => {
  const [newValue, setNewValue] = useState("");
  const [editing, setEditing] = useState<EditingState | null>(null);

  const addItem = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || items.includes(trimmed)) return;
    onItemsChange([...items, trimmed]);
    setNewValue("");
  };

  const removeItem = (index: number) => {
    onItemsChange(items.filter((_, i) => i !== index));
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
      <div className="flex flex-wrap gap-1.5 mb-2">
        {items.map((item, i) => {
          if (editing?.index === i) {
            return (
              <input
                key={i}
                autoFocus
                type="text"
                value={editing.value}
                onChange={(e) =>
                  setEditing({ ...editing, value: e.target.value })
                }
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    (e.target as HTMLInputElement).blur();
                  }
                  if (e.key === "Escape") {
                    setEditing(null);
                  }
                }}
                className="px-2.5 py-1 rounded-full text-xs font-medium border-2 border-violet-500 bg-theme-surface text-theme-text-primary w-48 focus:outline-hidden"
              />
            );
          }

          const className = getTagClassName
            ? getTagClassName(item)
            : tagColorClass;
          const title = getTagTitle ? getTagTitle(item) : undefined;

          return (
            <span
              key={i}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${className}`}
              title={title}
            >
              {item}
              <button
                type="button"
                onClick={() => setEditing({ index: i, value: item })}
                className="hover:text-violet-500"
                title="Edit"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => removeItem(i)}
                className="hover:text-red-500"
              >
                <X className="w-3 h-3" />
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
            if (e.key === "Enter") {
              e.preventDefault();
              addItem(newValue);
            }
          }}
          placeholder={placeholder}
          className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-theme-surface-border bg-theme-surface text-theme-text-primary focus:ring-2 focus:ring-violet-500"
        />
        <button
          type="button"
          onClick={() => addItem(newValue)}
          disabled={!newValue.trim()}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-theme-surface-hover text-theme-text-secondary hover:bg-theme-surface-secondary disabled:opacity-40 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {defaultSuggestions &&
        defaultSuggestions.length > 0 &&
        items.length === 0 && (
          <button
            type="button"
            onClick={() => onItemsChange([...defaultSuggestions])}
            className="mt-2 text-xs text-violet-600 dark:text-violet-400 hover:underline"
          >
            {suggestionsLabel ||
              `Copy from defaults (${defaultSuggestions.length} items)`}
          </button>
        )}
    </div>
  );
};

export default EditableTagList;
