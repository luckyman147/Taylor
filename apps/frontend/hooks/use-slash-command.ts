import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchMCPTools, type MCPTool } from '@/lib/api/mcp';

export interface SlashCommand {
  name: string;
  description: string;
  source: 'builtin' | 'mcp';
  mcpServer?: string;
  group: string;
}

interface UseSlashCommandProps {
  query: string;
  onSelect: (toolName: string) => void;
  onClose: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

const BUILTIN_TOOLS: SlashCommand[] = [
  { name: 'get_career_summary', description: 'Career profile summary', source: 'builtin', group: 'Profile' },
  { name: 'compare_resumes', description: 'Side-by-side resume comparison', source: 'builtin', group: 'Profile' },
  { name: 'get_ats_audit', description: 'Resume ATS audit', source: 'builtin', group: 'Profile' },
  { name: 'get_resume_for_audit', description: 'Load resume for analysis', source: 'builtin', group: 'Profile' },
  { name: 'get_evidence', description: 'Skill evidence counters', source: 'builtin', group: 'Skills' },
  { name: 'get_skill_suggestions', description: 'Skill gap analysis', source: 'builtin', group: 'Skills' },
  { name: 'get_skill_roi', description: 'Skill ROI analysis', source: 'builtin', group: 'Skills' },
  { name: 'get_market_position', description: 'Market position analysis', source: 'builtin', group: 'Skills' },
  { name: 'create_skill', description: 'Add skill to profile', source: 'builtin', group: 'Skills' },
  { name: 'search_mcp_jobs', description: 'Search jobs across all sources', source: 'builtin', group: 'Jobs' },
  { name: 'list_mcp_sources', description: 'List job sources & status', source: 'builtin', group: 'Jobs' },
  { name: 'get_job_verdict', description: 'Job quality verdict', source: 'builtin', group: 'Jobs' },
  { name: 'get_applications', description: 'Job applications list', source: 'builtin', group: 'Applications' },
  { name: 'get_rejections', description: 'Rejected applications', source: 'builtin', group: 'Applications' },
  { name: 'get_funnel_stats', description: 'Application funnel stats', source: 'builtin', group: 'Applications' },
  { name: 'create_application', description: 'Add job application', source: 'builtin', group: 'Applications' },
  { name: 'update_application_status', description: 'Update application status', source: 'builtin', group: 'Applications' },
  { name: 'get_contacts', description: 'Networking contacts', source: 'builtin', group: 'Contacts' },
  { name: 'get_companies', description: 'Tracked companies', source: 'builtin', group: 'Contacts' },
  { name: 'create_contact', description: 'Add contact', source: 'builtin', group: 'Contacts' },
  { name: 'create_company', description: 'Add company', source: 'builtin', group: 'Contacts' },
  { name: 'create_followup', description: 'Set follow-up date', source: 'builtin', group: 'Contacts' },
  { name: 'fetch_emails', description: 'Fetch unread Gmail', source: 'builtin', group: 'Email' },
  { name: 'search_emails', description: 'Search Gmail', source: 'builtin', group: 'Email' },
  { name: 'search_sent_emails', description: 'Search sent emails', source: 'builtin', group: 'Email' },
  { name: 'search_entity_emails', description: 'Search emails for company/contact', source: 'builtin', group: 'Email' },
  { name: 'web_search', description: 'General web search', source: 'builtin', group: 'Research' },
];

const GROUP_ORDER = ['Jobs', 'Profile', 'Skills', 'Applications', 'Contacts', 'Email', 'Research', 'MCP'];

export function useSlashCommand({
  query,
  onSelect,
  onClose,
  textareaRef,
}: UseSlashCommandProps) {
  const [mcpTools, setMcpTools] = useState<SlashCommand[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    fetchMCPTools()
      .then((tools: MCPTool[]) => {
        const mapped: SlashCommand[] = tools.map((t) => ({
          name: t.name,
          description: t.description,
          source: 'mcp' as const,
          mcpServer: t.server_name,
          group: 'MCP',
        }));
        setMcpTools(mapped);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const allTools = useMemo(() => [...BUILTIN_TOOLS, ...mcpTools], [mcpTools]);

  const items = useMemo(() => {
    const q = query.toLowerCase();
    return allTools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.group.toLowerCase().includes(q)
    );
  }, [query, allTools]);

  const groups = useMemo(() => {
    const map = new Map<string, SlashCommand[]>();
    for (const item of items) {
      const existing = map.get(item.group) || [];
      existing.push(item);
      map.set(item.group, existing);
    }
    const sorted = new Map<string, SlashCommand[]>();
    for (const g of GROUP_ORDER) {
      if (map.has(g)) sorted.set(g, map.get(g)!);
    }
    for (const [g, v] of map) {
      if (!sorted.has(g)) sorted.set(g, v);
    }
    return sorted;
  }, [items]);

  const flatItems = useMemo(() => Array.from(groups.values()).flat(), [groups]);

  useEffect(() => {
    setActiveIndex(0);
  }, [items.length, query]);

  const handleSelect = useCallback(
    (name: string) => onSelect(name),
    [onSelect]
  );

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

  return {
    loading,
    items,
    groups,
    flatItems,
    activeIndex,
    setActiveIndex,
    handleSelect,
    listRef,
  };
}
