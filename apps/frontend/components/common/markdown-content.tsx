'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { renderMarkdownHtml, MARKDOWN_BODY_CLASSES } from '@/lib/utils/markdown';

// Renders in the client bundle (used from interpolated previews). The
// markdown → sanitized HTML conversion is isomorphic (shared with the print
// pages via lib/utils/markdown), mirroring the existing HTML sanitizer.

interface MarkdownContentProps {
  /** Raw markdown to render */
  content: string;
  /** Additional class names */
  className?: string;
}

/**
 * Renders markdown content (headings, bold, italics, lists, links) with XSS
 * protection via DOMPurify. Style is tuned to the Taylor design system.
 */
export const MarkdownContent: React.FC<MarkdownContentProps> = ({ content, className }) => {
  if (!content || !content.trim()) {
    return null;
  }

  const cleanHtml = renderMarkdownHtml(content);

  return (
    <div
      className={cn(...MARKDOWN_BODY_CLASSES, className)}
      dangerouslySetInnerHTML={{ __html: cleanHtml }}
    />
  );
};

export default MarkdownContent;
