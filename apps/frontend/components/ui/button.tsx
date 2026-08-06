import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Swiss International Style Button Component
 *
 * Design Principles:
 * - Hard shadows (no blur) that create depth
 * - Square corners (rounded-lg) - Brutalist aesthetic
 * - High contrast black borders
 * - Hover: translate + shadow removal creates "press" effect
 * - Clear semantic variants for different actions
 */

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Visual variant determining color and purpose:
   * - `default`: Hyper Blue (#1D4ED8) - Primary actions (save, submit, create)
   * - `destructive`: Alert Red (#DC2626) - Destructive actions (delete, remove)
   * - `success`: Signal Green (#15803D) - Positive actions (download, confirm, complete)
   * - `warning`: Alert Orange (#F97316) - Caution actions (reset, clear, undo)
   * - `outline`: Transparent + black border - Secondary actions (cancel, back)
   * - `secondary`: Panel Grey (#E5E5E0) - Tertiary actions
   * - `ghost`: No background - Subtle actions (icon buttons, navigation)
   * - `link`: Text only with underline - Inline links
   */
  variant?:
    'default' | 'destructive' | 'success' | 'warning' | 'outline' | 'secondary' | 'ghost' | 'link';
  /**
   * Button size:
   * - `default`: Standard button (h-10)
   * - `sm`: Small button (h-8)
   * - `lg`: Large button (h-12)
   * - `icon`: Square icon button (h-9 w-9)
   */
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    // Base styles applied to ALL buttons
    // Swiss Design: clean, functional, high contrast
    const baseStyles = cn(
      // Layout & Typography
      'relative inline-flex items-center justify-center gap-2',
      'whitespace-nowrap text-sm font-medium  uppercase tracking-wide',
      // Transitions — only the properties that actually change on hover/active.
      'transition-[background-color,border-color] duration-100 ease-out',
      // Focus state - navy ring
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
      // Disabled state
      'disabled:pointer-events-none disabled:opacity-50',
      // SVG icon sizing
      "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
      // Executive: square corners
      'rounded-lg'
    );

    // Hit-area expansion for icon-only buttons. Many call sites override
    // size="icon" with smaller h-X w-X classes for dense toolbars (h-8 w-8,
    // h-7 w-7, etc.) — those visible sizes are under WCAG 2.5.8's 44×44 target
    // size minimum. The ::before pseudo-element extends the touch area by 6px
    // on each side without affecting visible layout, so a 32×32 button gets a
    // 44×44 touch target. For h-7 and smaller, the touch area still falls
    // short — those need an additional inline override at the call site
    // (e.g. before:-inset-[10px]).
    const iconHitArea = "before:absolute before:-inset-1.5 before:content-['']";

    // Variant styles - each has distinct purpose and color
    const variants = {
      // PRIMARY - Navy (#1E3A5F)
      // Use for: Save, Submit, Create, Primary CTA
      default: cn(
        'bg-primary text-primary-foreground',
        'border border-primary',
        'hover:bg-[#17304f]'
      ),

      // DESTRUCTIVE - Alert Red (#DC2626)
      // Use for: Delete, Remove, Destroy, Dangerous actions
      destructive: cn(
        'bg-destructive text-destructive-foreground',
        'border border-destructive',
        'hover:bg-[#b91c1c]'
      ),

      // SUCCESS - Signal Green (#15803D)
      // Use for: Download, Confirm, Complete, Positive actions
      success: cn('bg-success text-white', 'border border-success', 'hover:bg-[#166534]'),

      // WARNING - Amber (#D97706)
      // Use for: Reset, Clear, Undo, Caution actions
      warning: cn('bg-warning text-white', 'border border-warning', 'hover:bg-[#b45309]'),

      // OUTLINE - White with hairline border
      // Use for: Cancel, Back, Secondary actions, Navigation
      outline: cn(
        'bg-white text-ink',
        'border border-[#c9c5bc]',
        'hover:bg-paper-tint hover:border-ink'
      ),

      // SECONDARY - Hairline Grey Panel
      // Use for: Less prominent actions, Toolbar buttons
      secondary: cn('bg-secondary text-ink', 'border border-[#d9d5cc]', 'hover:bg-[#e2dfd8]'),

      // GHOST - No background, minimal styling
      // Use for: Icon buttons, Subtle navigation, Toolbars
      ghost: cn('bg-transparent text-ink', 'border-none shadow-none', 'hover:bg-paper-tint'),

      // LINK - Text only with underline
      // Use for: Inline links, Text navigation
      link: cn(
        'bg-transparent text-primary',
        'border-none shadow-none',
        'underline-offset-4 hover:underline',
        'p-0 h-auto'
      ),
    };

    // Size styles. Icon variant is 44×44px to meet WCAG 2.2 AA target size
    // (success criterion 2.5.8). Call sites that override the visible size
    // with smaller h-X w-X classes get the touch-area expansion via the
    // iconHitArea overlay above.
    const sizes = {
      default: 'h-10 px-6 py-2',
      sm: 'h-8 px-4 py-1 text-xs',
      lg: 'h-12 px-8 py-3 text-base',
      icon: cn('h-11 w-11 p-0', iconHitArea),
    };

    const variantClass = variants[variant];
    const sizeClass = sizes[size];

    return (
      <button ref={ref} className={cn(baseStyles, variantClass, sizeClass, className)} {...props} />
    );
  }
);
Button.displayName = 'Button';

export { Button };
