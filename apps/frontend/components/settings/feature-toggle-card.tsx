'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

/**
 * FeatureToggleCard — a single settings feature presented as a card.
 *
 * Header row: icon tile + label + description + switch (pill markup
 * mirrors ToggleSwitch for visual consistency). When the feature is
 * enabled and `children` are provided, an editor region unfolds below
 * the header inside the same card — one cohesive unit instead of the
 * toggle living in a grid cell next to a free-floating editor.
 */

export interface FeatureToggleCardProps {
  icon: LucideIcon;
  label: string;
  description?: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export function FeatureToggleCard({
  icon: Icon,
  label,
  description,
  checked,
  onToggle,
  disabled = false,
  children,
  className,
}: FeatureToggleCardProps) {
  const labelId = React.useId();

  return (
    <div className={cn('rounded-2xl border border-[#e6e3dc] bg-white shadow-sw-xs', className)}>
      <div className="flex items-start gap-3 p-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </span>
        <div className="min-w-0 flex-1">
          <div id={labelId} className="text-sm font-bold text-ink">
            {label}
          </div>
          {description && <p className="mt-0.5 text-xs text-steel-grey">{description}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={labelId}
          disabled={disabled}
          onClick={() => onToggle(!checked)}
          className={cn(
            'relative mt-0.5 inline-flex h-6 w-12 shrink-0 cursor-pointer items-center rounded-full',
            'border border-[#c9c5bc] transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed',
            checked ? 'bg-primary' : 'bg-paper-tint'
          )}
        >
          <span
            className={cn(
              'pointer-events-none block h-4 w-4 rounded-full border border-[#c9c5bc] bg-white',
              'transition-transform duration-200',
              checked ? 'translate-x-6' : 'translate-x-1'
            )}
          />
        </button>
      </div>

      {checked && children && <div className="border-t border-paper-tint p-4">{children}</div>}
    </div>
  );
}
