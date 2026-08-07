'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Tabs Component
 *
 * Segmented rounded-full pill control matching the Tracker design language.
 * The active tab gets a solid navy fill; disabled tabs sink to a muted tint.
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
    <div
      className={cn(
        'flex flex-wrap items-center gap-1 rounded-full border border-[#e6e3dc] bg-white p-1 shadow-sw-xs',
        className
      )}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const isDisabled = tab.disabled;

        return (
          <button
            key={tab.id}
            onClick={() => !isDisabled && onTabChange(tab.id)}
            disabled={isDisabled}
            className={cn(
              'rounded-full px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
              isActive && 'bg-primary text-white shadow-sw-xs',
              !isActive &&
                !isDisabled && ['bg-white text-ink-soft hover:bg-paper-tint hover:text-primary'],
              isDisabled && ['cursor-not-allowed opacity-50 text-steel-grey']
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};
