'use client';

import { useState } from 'react';
import { X, Mail, Building2, Briefcase, MapPin, User, UserPlus, Bookmark, FileText } from 'lucide-react';

interface EmailEntities {
  company?: string;
  contacts?: Array<{ name: string; email?: string }>;
  job_title?: string;
  job_description?: string;
  match_percentage?: string;
  is_job_alert?: boolean;
  location?: string;
}

interface EmailData {
  uid: string;
  subject: string;
  sender: string;
  date: string;
  snippet: string;
  body: string;
  entities?: EmailEntities;
}

interface EmailBodyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  email: EmailData | null;
  onAddContact?: (data: { name: string; email?: string; company?: string }) => void;
  onAddCompany?: (data: { name: string; website?: string }) => void;
  onSaveJob?: (data: { title: string; company: string; location?: string; url?: string }) => void;
  onTailorResume?: (data: { job_description: string; company: string; role: string }) => void;
}

export function EmailBodyDialog({ isOpen, onClose, email, onAddContact, onAddCompany, onSaveJob, onTailorResume }: EmailBodyDialogProps) {
  if (!isOpen || !email) return null;

  const entities = email.entities;
  const hasEntities = entities && (entities.company || entities.contacts?.length || entities.job_title);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative mx-4 max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#e6e3dc] p-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-ink-muted shrink-0" />
              <h2 className="text-sm font-semibold truncate">{email.subject || '(no subject)'}</h2>
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-ink-soft">
              <span>From: {email.sender}</span>
              <span>{email.date}</span>
            </div>
          </div>
          <button onClick={onClose} className="ml-3 rounded-md p-1 hover:bg-gray-100 transition-colors">
            <X className="h-4 w-4 text-ink-muted" />
          </button>
        </div>

        {/* Entities sidebar */}
        {hasEntities && (
          <div className="border-b border-[#e6e3dc] bg-[#faf9f7] p-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-2">Extracted Data</div>
            <div className="space-y-1.5">
              {entities.company && (
                <div className="flex items-center gap-1.5 text-xs">
                  <Building2 className="h-3 w-3 text-purple-500" />
                  <span className="font-medium">{entities.company}</span>
                </div>
              )}
              {entities.job_title && (
                <div className="flex items-center gap-1.5 text-xs">
                  <Briefcase className="h-3 w-3 text-amber-500" />
                  <span>{entities.job_title}</span>
                </div>
              )}
              {entities.location && (
                <div className="flex items-center gap-1.5 text-xs">
                  <MapPin className="h-3 w-3 text-ink-muted" />
                  <span>{entities.location}</span>
                </div>
              )}
              {entities.match_percentage && (
                <div className="text-xs font-bold text-green-600">{entities.match_percentage} match</div>
              )}
              {entities.contacts && entities.contacts.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs">
                  <User className="h-3 w-3 text-blue-500" />
                  <span>{entities.contacts.map(c => `${c.name}${c.email ? ` (${c.email})` : ''}`).join(', ')}</span>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {entities.contacts && entities.contacts.length > 0 && onAddContact && (
                <button
                  onClick={() => onAddContact({ name: entities.contacts![0].name, email: entities.contacts![0].email, company: entities.company })}
                  className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-[10px] font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  <UserPlus className="h-3 w-3" />
                  Add Contact
                </button>
              )}
              {entities.company && onAddCompany && (
                <button
                  onClick={() => onAddCompany({ name: entities.company! })}
                  className="inline-flex items-center gap-1 rounded-md bg-purple-50 px-2 py-1 text-[10px] font-medium text-purple-700 hover:bg-purple-100 transition-colors"
                >
                  <Building2 className="h-3 w-3" />
                  Add Company
                </button>
              )}
              {entities.job_title && entities.company && onSaveJob && (
                <button
                  onClick={() => onSaveJob({ title: entities.job_title!, company: entities.company!, location: entities.location })}
                  className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 hover:bg-amber-100 transition-colors"
                >
                  <Bookmark className="h-3 w-3" />
                  Save Job
                </button>
              )}
              {entities.job_description && entities.company && onTailorResume && (
                <button
                  onClick={() => onTailorResume({ job_description: entities.job_description!, company: entities.company!, role: entities.job_title || '' })}
                  className="inline-flex items-center gap-1 rounded-md bg-green-50 px-2 py-1 text-[10px] font-medium text-green-700 hover:bg-green-100 transition-colors"
                >
                  <FileText className="h-3 w-3" />
                  Tailor Resume
                </button>
              )}
            </div>
          </div>
        )}

        {/* Email body */}
        <div className="overflow-y-auto p-4" style={{ maxHeight: 'calc(85vh - 200px)' }}>
          <pre className="whitespace-pre-wrap text-sm text-ink leading-relaxed font-sans">{email.body || email.snippet || 'No content available.'}</pre>
        </div>
      </div>
    </div>
  );
}
