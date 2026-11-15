'use client';

import React, { useState } from 'react';
import { GripVertical } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface TagInputProps {
  id?: string;
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  /** Optional suggestions shown while typing; filtered client-side. */
  suggestions?: string[];
  sortable?: boolean;
  dragLabel?: string;
}

function splitInput(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function SortableTag({
  id,
  tag,
  dragLabel,
  onRemove,
}: {
  id: number;
  tag: string;
  dragLabel: string;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <span
      ref={setNodeRef}
      style={style}
      className="inline-flex items-center gap-1 rounded-full border border-[#e6e3dc] bg-secondary px-2 py-0.5 text-xs font-medium text-ink"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={dragLabel}
        title={dragLabel}
        className="touch-none cursor-grab text-ink-soft transition-colors hover:text-primary active:cursor-grabbing"
      >
        <GripVertical className="h-3 w-3" />
      </button>
      {tag}
      <button
        type="button"
        aria-label={`Remove ${tag}`}
        onClick={onRemove}
        className="text-ink-soft transition-colors hover:text-destructive"
      >
        ✕
      </button>
    </span>
  );
}

function SortableTags({
  value,
  dragLabel,
  onChange,
}: {
  value: string[];
  dragLabel: string;
  onChange: (tags: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = Number(active.id);
    const newIndex = Number(over.id);

    if (
      !Number.isInteger(oldIndex) ||
      !Number.isInteger(newIndex) ||
      oldIndex < 0 ||
      newIndex < 0 ||
      oldIndex >= value.length ||
      newIndex >= value.length
    ) {
      return;
    }

    onChange(arrayMove(value, oldIndex, newIndex));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={value.map((_, index) => index)} strategy={rectSortingStrategy}>
        {value.map((tag, index) => (
          <SortableTag
            key={`${tag}-${index}`}
            id={index}
            tag={tag}
            dragLabel={dragLabel}
            onRemove={() => onChange(value.filter((_, i) => i !== index))}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

/**
 * Chip-style multi-select input. Enter / comma / paste-with-commas adds tags,
 * Backspace on an empty input removes the last chip, ✕ removes a chip.
 * When `suggestions` are provided, a dropdown appears while typing: ArrowUp /
 * ArrowDown move the highlight, Enter accepts the highlighted suggestion.
 */
export function TagInput({
  id,
  value,
  onChange,
  placeholder,
  suggestions = [],
  sortable = false,
  dragLabel = 'Drag to reorder',
}: TagInputProps) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);

  const filtered = suggestions
    .filter(
      (item) =>
        item.trim().length > 0 &&
        item.toLowerCase().includes(draft.trim().toLowerCase()) &&
        !value.some((tag) => tag.toLowerCase() === item.toLowerCase())
    )
    .slice(0, 8);

  const addTags = (raw: string) => {
    const next = splitInput(raw);
    if (next.length === 0) return;
    const existing = new Set(value.map((tag) => tag.toLowerCase()));
    const merged = [...value];
    for (const tag of next) {
      if (!existing.has(tag.toLowerCase())) {
        merged.push(tag);
        existing.add(tag.toLowerCase());
      }
    }
    onChange(merged);
    setDraft('');
    setHighlighted(-1);
  };

  const removeTag = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const acceptSuggestion = (item: string) => {
    addTags(item);
    setOpen(false);
  };

  return (
    <div className="relative flex h-auto min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border border-[#c9c5bc] bg-white px-3 py-1.5 focus-within:ring-1 focus-within:ring-primary">
      {sortable ? (
        <SortableTags value={value} dragLabel={dragLabel} onChange={onChange} />
      ) : (
        value.map((tag, index) => (
          <span
            key={`${tag}-${index}`}
            className="inline-flex items-center gap-1 rounded-full border border-[#e6e3dc] bg-secondary px-2 py-0.5 text-xs font-medium text-ink"
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => removeTag(index)}
              className="text-ink-soft transition-colors hover:text-destructive"
            >
              ✕
            </button>
          </span>
        ))
      )}
      <input
        id={id}
        type="text"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setOpen(true);
          setHighlighted(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && filtered.length > 0) {
            e.preventDefault();
            setOpen(true);
            setHighlighted((prev) => (prev + 1) % filtered.length);
          } else if (e.key === 'ArrowUp' && filtered.length > 0) {
            e.preventDefault();
            setHighlighted((prev) => (prev <= 0 ? filtered.length - 1 : prev - 1));
          } else if (e.key === 'Enter') {
            if (highlighted >= 0 && filtered[highlighted]) {
              e.preventDefault();
              acceptSuggestion(filtered[highlighted]);
            } else {
              e.preventDefault();
              addTags(draft);
            }
          } else if (e.key === ',') {
            e.preventDefault();
            addTags(draft);
          } else if (e.key === 'Escape') {
            setOpen(false);
          } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
            removeTag(value.length - 1);
          }
        }}
        onBlur={() => {
          addTags(draft);
          setOpen(false);
          setHighlighted(-1);
        }}
        onPaste={(e) => {
          e.preventDefault();
          addTags(e.clipboardData.getData('text'));
        }}
        placeholder={value.length === 0 ? placeholder : ''}
        className="min-w-[80px] flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-steel-grey"
      />
      {open && draft.trim() !== '' && filtered.length > 0 && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border border-[#e6e3dc] bg-white shadow-sw-md"
        >
          {filtered.map((item, index) => (
            <button
              key={item}
              type="button"
              role="option"
              aria-selected={index === highlighted}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => acceptSuggestion(item)}
              className={`block w-full px-3 py-2 text-left text-sm text-ink transition-colors ${
                index === highlighted ? 'bg-secondary' : 'hover:bg-paper-tint'
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
