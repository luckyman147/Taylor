'use client';

import React, { useState, useRef, useEffect } from 'react';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import Check from 'lucide-react/dist/esm/icons/check';
import { useTranslations } from '@/lib/i18n';

export interface DropdownOption {
  id: string;
  label: string;
  description?: string;
}

interface DropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}

export function Dropdown({
  options,
  value,
  onChange,
  label,
  description,
  disabled = false,
  className = '',
}: DropdownProps) {
  const { t } = useTranslations();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Stable id wiring the trigger's aria-controls to the popup's id, and
  // the popup's role="menu" to its role="menuitem" children.
  const menuId = React.useId();

  const selectedOption = options.find((opt) => opt.id === value);

  // Close dropdown on outside click
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

  const handleSelect = (optionId: string) => {
    onChange(optionId);
    setIsOpen(false);
  };

  return (
    <div className={`space-y-1 ${className}`} ref={containerRef}>
      {label && (
        <label className="block text-[11px] font-bold uppercase tracking-wider text-ink-soft">
          {label}
        </label>
      )}

      {description && <p className="text-sm text-ink-soft">{description}</p>}

      <div className="relative">
        {/* Trigger Button.
            aria-haspopup="menu" matches the actual popup semantics: options
            commit on click (not select-then-activate), which is a menu
            pattern, not listbox. aria-controls wires the trigger to the
            popup id so screen readers know they're linked. */}
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-controls={isOpen ? menuId : undefined}
          aria-label={label}
          className={`flex w-full items-center justify-between rounded-xl border bg-white px-4 py-3 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:pointer-events-none disabled:opacity-50 ${
            isOpen ? 'border-primary' : 'border-[#c9c5bc] hover:border-primary'
          }`}
        >
          <div className="min-w-0 flex-1 text-left">
            {selectedOption ? (
              <div>
                <div className="truncate text-sm font-semibold text-ink">
                  {selectedOption.label}
                </div>
                {selectedOption.description && (
                  <div className="mt-0.5 truncate text-xs font-normal text-steel-grey">
                    {selectedOption.description}
                  </div>
                )}
              </div>
            ) : (
              <span className="text-sm text-steel-grey">{t('common.selectOption')}</span>
            )}
          </div>
          <ChevronDown
            className={`ml-2 h-4 w-4 shrink-0 text-ink-soft transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {/* Dropdown Menu. Uses menuitemradio (not plain menuitem) because
            this is a single-value selector, not a command menu — options
            express a mutually-exclusive selection. aria-checked on the
            selected item lets screen readers announce which option is
            currently active. A full listbox pattern would also be valid
            but needs arrow-key navigation + aria-activedescendant, which
            is tracked as a follow-up. */}
        {isOpen && (
          <div
            id={menuId}
            role="menu"
            aria-label={label}
            className="absolute left-0 right-0 top-full z-50 mt-2 rounded-xl border border-[#e6e3dc] bg-white p-1.5 shadow-sw-lg"
          >
            <div className="max-h-64 overflow-y-auto">
              {options.map((option) => {
                const selected = option.id === value;
                return (
                  <button
                    key={option.id}
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => handleSelect(option.id)}
                    className={`flex w-full items-start justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors duration-150 ${
                      selected ? 'bg-primary text-white' : 'bg-white text-ink hover:bg-paper-tint'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{option.label}</div>
                      {option.description && (
                        <div
                          className={`mt-0.5 text-xs ${selected ? 'opacity-80' : 'text-steel-grey'}`}
                        >
                          {option.description}
                        </div>
                      )}
                    </div>
                    {selected && <Check className="mt-0.5 h-4 w-4 shrink-0 text-white" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
