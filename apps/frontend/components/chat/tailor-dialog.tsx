'use client';

import { useState, useEffect } from 'react';
import { X, FileText, Loader2 } from 'lucide-react';
import { fetchResumeList } from '@/lib/api/resume';

interface TailorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialData: { job_description: string; company: string; role: string };
  onTailor?: (resumeId: string, jobDescription: string, company: string, role: string) => void;
}

interface ResumeOption {
  resume_id: string;
  title: string;
  is_master: boolean;
}

export function TailorDialog({ isOpen, onClose, initialData, onTailor }: TailorDialogProps) {
  const [resumes, setResumes] = useState<ResumeOption[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      fetchResumeList().then((data) => {
        setResumes(data);
        const master = data.find((r: ResumeOption) => r.is_master);
        if (master) setSelectedResumeId(master.resume_id);
        else if (data.length > 0) setSelectedResumeId(data[0].resume_id);
      }).finally(() => setLoading(false));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTailor = () => {
    if (!selectedResumeId) return;
    onTailor?.(selectedResumeId, initialData.job_description, initialData.company, initialData.role);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative mx-4 w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#e6e3dc] p-4">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-green-500" />
            <h2 className="text-sm font-semibold">Tailor Resume</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 p-4">
          <div className="rounded-md bg-[#faf9f7] p-3 text-xs text-ink-soft">
            <div className="font-medium text-ink">{initialData.role} at {initialData.company}</div>
            <div className="mt-1 line-clamp-3">{initialData.job_description.slice(0, 300)}...</div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">Select Resume</label>
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-ink-soft"><Loader2 className="h-3 w-3 animate-spin" /> Loading resumes...</div>
            ) : resumes.length === 0 ? (
              <div className="text-xs text-ink-soft">No resumes found. Upload one first.</div>
            ) : (
              <div className="space-y-1">
                {resumes.map((r) => (
                  <label key={r.resume_id} className="flex items-center gap-2 rounded-md border border-[#e6e3dc] p-2 cursor-pointer hover:bg-[#faf9f7]">
                    <input
                      type="radio"
                      name="resume"
                      value={r.resume_id}
                      checked={selectedResumeId === r.resume_id}
                      onChange={(e) => setSelectedResumeId(e.target.value)}
                      className="h-3 w-3"
                    />
                    <span className="text-xs">{r.title}{r.is_master ? ' (Master)' : ''}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#e6e3dc] p-4">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-gray-100">Cancel</button>
          <button onClick={handleTailor} disabled={!selectedResumeId} className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">
            Tailor Resume
          </button>
        </div>
      </div>
    </div>
  );
}
