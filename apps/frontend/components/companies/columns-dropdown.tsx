'use client';

import React, { useEffect, useRef, useState } from 'react';
import Columns3 from 'lucide-react/dist/esm/icons/columns-3';

export interface ColumnToggleOption {
  id: string;
  label: string;
}

interface ColumnsDropdownProps {
  options: ColumnToggleOption[];
  visible: Record<string, boolean>;
  onChange: (id: string, checked: boolean) => void;
  label: string;
  ariaLabel: string;
}

/** Multi-select popover for showing/hiding table columns. */
export function ColumnsDropdown({
  options,
  visible,
  onChange,
  label,
  ariaLabel,
}: ColumnsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = React.useId();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-label={ariaLabel}
        className={`flex h-10 items-center justify-between gap-2 rounded-lg border bg-white px-3 text-sm font-semibold text-ink transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary/20 ${
          isOpen ? 'border-primary' : 'border-[#c9c5bc] hover:border-primary'
        }`}
      >
        <Columns3 className="h-4 w-4 text-ink-soft" />
        {label}
      </button>

      {isOpen && (
        <div
          id={menuId}
          role="menu"
          aria-label={ariaLabel}
          className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-[#e6e3dc] bg-white p-1.5 shadow-sw-lg"
        >
          <div className="max-h-72 overflow-y-auto">
            {options.map((option) => {
              const checked = Boolean(visible[option.id]);
              return (
                <label
                  key={option.id}
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors duration-150 hover:bg-paper-tint"
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => onChange(option.id, e.target.checked)}
                    className="h-4 w-4 shrink-0 accent-primary"
                  />
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
