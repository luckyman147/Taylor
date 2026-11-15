import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listContacts, type Contact } from '@/lib/api/contacts';
import { listCompanies, type Company } from '@/lib/api/companies';
import { fetchResumeList, type ResumeListItem } from '@/lib/api/resume';

export interface MentionItem {
  type: 'company' | 'contact' | 'resume';
  name: string;
  subtitle?: string;
  id: string;
}

interface UseMentionPopoverProps {
  query: string;
  onSelect: (name: string) => void;
  onClose: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

const MAX_PER_GROUP = 5;

export function useMentionPopover({
  query,
  onSelect,
  onClose,
  textareaRef,
}: UseMentionPopoverProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [resumes, setResumes] = useState<ResumeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    Promise.allSettled([
      listContacts()
        .then((r) => setContacts(r.contacts))
        .catch(() => {}),
      listCompanies()
        .then((r) => setCompanies(r.companies))
        .catch(() => {}),
      fetchResumeList(true)
        .then((r) => setResumes(r))
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const items = useMemo(() => {
    const q = query.toLowerCase();
    const result: MentionItem[] = [];

    for (const c of companies) {
      if (c.name.toLowerCase().includes(q)) {
        result.push({
          type: 'company',
          name: c.name,
          subtitle: c.status || undefined,
          id: c.company_id,
        });
      }
    }
    for (const c of contacts) {
      if (c.name.toLowerCase().includes(q)) {
        result.push({
          type: 'contact',
          name: c.name,
          subtitle: c.company || undefined,
          id: c.contact_id,
        });
      }
    }
    for (const r of resumes) {
      const label = r.title || r.filename || 'Untitled';
      if (label.toLowerCase().includes(q)) {
        result.push({
          type: 'resume',
          name: label,
          subtitle: r.is_master ? 'master' : undefined,
          id: r.resume_id,
        });
      }
    }
    return result;
  }, [query, contacts, companies, resumes]);

  const groups = useMemo(() => {
    const map = new Map<string, MentionItem[]>();
    for (const item of items) {
      const existing = map.get(item.type) || [];
      if (existing.length < MAX_PER_GROUP) {
        existing.push(item);
        map.set(item.type, existing);
      }
    }
    return map;
  }, [items]);

  useEffect(() => {
    setActiveIndex(0);
  }, [items.length, query]);

  const flatItems = useMemo(() => Array.from(groups.values()).flat(), [groups]);

  const handleSelect = useCallback((name: string) => onSelect(name), [onSelect]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % (flatItems.length || 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + flatItems.length) % (flatItems.length || 1));
      } else if (e.key === 'Enter' && flatItems.length > 0) {
        e.preventDefault();
        handleSelect(flatItems[activeIndex]?.name ?? '');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    textarea.addEventListener('keydown', handler);
    return () => textarea.removeEventListener('keydown', handler);
  }, [flatItems, activeIndex, handleSelect, onClose, textareaRef]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  return { loading, items, groups, flatItems, activeIndex, setActiveIndex, handleSelect, listRef };
}
