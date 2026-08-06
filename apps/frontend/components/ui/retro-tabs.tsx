'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Swiss International Style Tabs Component
 *
 * Design Principles:
 * - Square corners (rounded-lg) - Brutalist aesthetic
 * - Hard shadows on active tab
 * - Black borders for high contrast
 * - Monospace uppercase text
 */

export interface Tab {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface RetroTabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

export const RetroTabs: React.FC<RetroTabsProps> = ({
  tabs,
  activeTab,
  onTabChange,
  className,
}) => {
  return (
    <div className={cn('flex gap-0 border-b border-ink', className)}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const isDisabled = tab.disabled;

        return (
          <button
            key={tab.id}
            onClick={() => !isDisabled && onTabChange(tab.id)}
            disabled={isDisabled}
            className={cn(
              'px-4 py-2  text-xs uppercase tracking-wider transition-colors',
              'border border-b-0 border-border -mb-px',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
              isActive && [
                'bg-white text-primary font-bold',
                'shadow-[inset_0_2px_0_0_rgba(30,58,95,0.35)]',
                'border-b-white',
              ],
              !isActive &&
                !isDisabled && ['bg-secondary text-ink-soft hover:bg-[#e2dfd8] hover:text-ink'],
              isDisabled && ['bg-paper-tint text-steel-grey cursor-not-allowed opacity-50']
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};
