'use client';

import { X, FileText, FileCode, File } from 'lucide-react';

interface FileViewerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  filename: string;
  content: string;
}

const EXT_ICONS: Record<string, typeof FileText> = {
  pdf: FileText,
  doc: FileCode,
  docx: FileCode,
  md: FileText,
  txt: File,
};

const EXT_COLORS: Record<string, string> = {
  pdf: 'text-red-500',
  doc: 'text-blue-500',
  docx: 'text-blue-500',
  md: 'text-gray-600',
  txt: 'text-gray-500',
};

function getExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
}

export function FileViewerDialog({ isOpen, onClose, filename, content }: FileViewerDialogProps) {
  if (!isOpen) return null;

  const ext = getExtension(filename);
  const Icon = EXT_ICONS[ext] || File;
  const colorClass = EXT_COLORS[ext] || 'text-gray-500';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Side dialog */}
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-2xl flex-col border-l border-[#e6e3dc] bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[#e6e3dc] px-5 py-4">
          <Icon className={`h-5 w-5 ${colorClass}`} />
          <span className="flex-1 truncate text-sm font-medium text-ink">{filename}</span>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-muted hover:bg-[#f0ece4] hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">
            {content}
          </pre>
        </div>
      </div>
    </>
  );
}
