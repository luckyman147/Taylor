'use client';

import { FileText, FileCode, File, Eye } from 'lucide-react';

interface FileCardProps {
  filename: string;
  content?: string;
  resumeId?: string;
  onView?: (filename: string, content: string) => void;
}

const EXT_ICONS: Record<string, typeof FileText> = {
  pdf: FileText,
  doc: FileCode,
  docx: FileCode,
  md: FileText,
  txt: File,
};

const EXT_COLORS: Record<string, string> = {
  pdf: 'text-red-500 bg-red-50',
  doc: 'text-blue-500 bg-blue-50',
  docx: 'text-blue-500 bg-blue-50',
  md: 'text-gray-600 bg-gray-50',
  txt: 'text-gray-500 bg-gray-50',
};

const EXT_LABELS: Record<string, string> = {
  pdf: 'PDF',
  doc: 'DOC',
  docx: 'DOCX',
  md: 'Markdown',
  txt: 'Text',
};

function getExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
}

export function FileCard({ filename, content, resumeId, onView }: FileCardProps) {
  const ext = getExtension(filename);
  const Icon = EXT_ICONS[ext] || File;
  const colorClass = EXT_COLORS[ext] || 'text-gray-500 bg-gray-50';
  const label = EXT_LABELS[ext] || ext.toUpperCase();

  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#e6e3dc] bg-white p-3">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${colorClass}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{filename}</div>
        <div className="text-xs text-ink-muted">{label} document</div>
      </div>
      {content && onView && (
        <button
          onClick={() => onView(filename, content)}
          className="flex items-center gap-1.5 rounded-lg border border-[#e6e3dc] px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-[#f0ece4]"
        >
          <Eye className="h-3.5 w-3.5" />
          View
        </button>
      )}
    </div>
  );
}
