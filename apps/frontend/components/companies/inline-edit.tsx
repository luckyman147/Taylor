'use client';

import { useEffect, useRef, useState } from 'react';

interface InlineTextEditorProps {
  initialValue: string;
  ariaLabel: string;
  type?: 'text' | 'number';
  onCommit: (value: string) => void;
  onCancel: () => void;
}

/** Text/number cell editor: Enter or blur commits, Escape cancels. */
export function InlineTextEditor({
  initialValue,
  ariaLabel,
  type = 'text',
  onCommit,
  onCancel,
}: InlineTextEditorProps) {
  const [draft, setDraft] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = () => {
    if (cancelled.current) return;
    if (draft === initialValue) {
      onCancel();
      return;
    }
    onCommit(draft);
  };

  return (
    <input
      ref={inputRef}
      type={type}
      value={draft}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
        } else if (e.key === 'Escape') {
          cancelled.current = true;
          onCancel();
        }
      }}
      className="w-full min-w-0 rounded-md border border-primary bg-white px-2 py-1 text-sm text-ink shadow-sm outline-none ring-2 ring-primary/20"
    />
  );
}

interface InlineSelectEditorProps {
  initialValue: string;
  ariaLabel: string;
  options: { id: string; label: string }[];
  onCommit: (value: string) => void;
  onCancel: () => void;
}

/** Enum cell editor: picking an option commits, Escape cancels. */
export function InlineSelectEditor({
  initialValue,
  ariaLabel,
  options,
  onCommit,
  onCancel,
}: InlineSelectEditorProps) {
  const selectRef = useRef<HTMLSelectElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    selectRef.current?.focus();
  }, []);

  const commit = (value: string) => {
    if (cancelled.current) return;
    if (value === initialValue) {
      onCancel();
      return;
    }
    onCommit(value);
  };

  return (
    <select
      ref={selectRef}
      value={initialValue}
      aria-label={ariaLabel}
      onChange={(e) => commit(e.target.value)}
      onBlur={() => {
        if (!cancelled.current) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          cancelled.current = true;
          onCancel();
        }
      }}
      className="rounded-md border border-primary bg-white px-1.5 py-1 text-sm text-ink shadow-sm outline-none ring-2 ring-primary/20"
    >
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
