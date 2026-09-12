'use client';

import React, { useCallback } from 'react';
import { Bold, Italic, Link } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MarkdownToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

function wrapSelection(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string
): { value: string; selectionStart: number; selectionEnd: number } | null {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  if (start === end) return null; // No selection

  const text = textarea.value;
  const selected = text.slice(start, end);

  // Check if already wrapped — toggle off
  const prefix = text.slice(start - before.length, start);
  const suffix = text.slice(end, end + after.length);
  if (prefix === before && suffix === after) {
    const newText = text.slice(0, start - before.length) + selected + text.slice(end + after.length);
    return {
      value: newText,
      selectionStart: start - before.length,
      selectionEnd: end - before.length,
    };
  }

  // Wrap selection
  const newText = text.slice(0, start) + before + selected + after + text.slice(end);
  return {
    value: newText,
    selectionStart: start + before.length,
    selectionEnd: end + before.length,
  };
}

export function MarkdownToolbar({ textareaRef, value, onChange, className }: MarkdownToolbarProps) {
  const handleFormat = useCallback(
    (before: string, after: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const result = wrapSelection(textarea, before, after);
      if (!result) return;

      onChange(result.value);

      // Restore selection after React re-renders
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
      });
    },
    [textareaRef, onChange]
  );

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      <button
        type="button"
        onClick={() => handleFormat('**', '**')}
        className="flex h-6 w-6 items-center justify-center rounded text-steel-grey transition-colors hover:bg-primary/10 hover:text-primary"
        title="Bold (select text first)"
      >
        <Bold className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => handleFormat('*', '*')}
        className="flex h-6 w-6 items-center justify-center rounded text-steel-grey transition-colors hover:bg-primary/10 hover:text-primary"
        title="Italic (select text first)"
      >
        <Italic className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => {
          const textarea = textareaRef.current;
          if (!textarea) return;
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const selected = textarea.value.slice(start, end);
          if (selected) {
            handleFormat('[', '](url)');
          }
        }}
        className="flex h-6 w-6 items-center justify-center rounded text-steel-grey transition-colors hover:bg-primary/10 hover:text-primary"
        title="Link (select text first)"
      >
        <Link className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
