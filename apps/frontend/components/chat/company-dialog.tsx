'use client';

import { useState } from 'react';
import { X, Building2 } from 'lucide-react';
import { createCompany } from '@/lib/api/companies';

interface CompanyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialData: { name: string; website?: string };
  onCreated?: () => void;
}

export function CompanyDialog({ isOpen, onClose, initialData, onCreated }: CompanyDialogProps) {
  const [name, setName] = useState(initialData.name);
  const [website, setWebsite] = useState(initialData.website || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await createCompany({
        name: name.trim(),
        website: website.trim() || undefined,
      });
      onCreated?.();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Failed to add company');
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
            <Building2 className="h-4 w-4 text-purple-500" />
            <h2 className="text-sm font-semibold">Add Company</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">Name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border border-[#e6e3dc] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">Website</label>
            <input value={website} onChange={(e) => setWebsite(e.target.value)} type="url" className="w-full rounded-md border border-[#e6e3dc] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          {error && <div className="text-xs text-red-500">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#e6e3dc] p-4">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-gray-100">Cancel</button>
          <button onClick={handleSave} disabled={saving || !name.trim()} className="rounded-md bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Add Company'}
          </button>
        </div>
      </div>
    </div>
  );
}
