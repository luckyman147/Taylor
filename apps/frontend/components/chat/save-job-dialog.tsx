'use client';

import { useState } from 'react';
import { X, Bookmark } from 'lucide-react';
import { saveJobFromChat } from '@/lib/api/chat';

interface SaveJobDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialData: { title: string; company: string; location?: string; url?: string };
  threadId?: string;
  onSaved?: () => void;
}

export function SaveJobDialog({ isOpen, onClose, initialData, threadId, onSaved }: SaveJobDialogProps) {
  const [title, setTitle] = useState(initialData.title);
  const [company, setCompany] = useState(initialData.company);
  const [location, setLocation] = useState(initialData.location || '');
  const [url, setUrl] = useState(initialData.url || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!title.trim() || !company.trim()) return;
    setSaving(true);
    setError('');
    try {
      await saveJobFromChat({
        title: title.trim(),
        company: company.trim(),
        location: location.trim() || undefined,
        url: url.trim() || undefined,
      }, threadId);
      onSaved?.();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Failed to save job');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative mx-4 w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#e6e3dc] p-4">
          <div className="flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-semibold">Save Job</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">Job Title *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-md border border-[#e6e3dc] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">Company *</label>
            <input value={company} onChange={(e) => setCompany(e.target.value)} className="w-full rounded-md border border-[#e6e3dc] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">Location</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} className="w-full rounded-md border border-[#e6e3dc] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">URL</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} type="url" className="w-full rounded-md border border-[#e6e3dc] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
          {error && <div className="text-xs text-red-500">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#e6e3dc] p-4">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-gray-100">Cancel</button>
          <button onClick={handleSave} disabled={saving || !title.trim() || !company.trim()} className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Job'}
          </button>
        </div>
      </div>
    </div>
  );
}
