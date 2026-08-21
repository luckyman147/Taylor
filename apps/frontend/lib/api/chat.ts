/**
 * Chat Command Center API client.
 *
 * Persistent threads, two-phase tool calling, confirm/cancel, memory.
 */

import { apiDelete, apiFetch, apiPatch, apiPost } from './client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThreadSummary {
  thread_id: string;
  title: string;
  mode: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_preview: string;
}

export interface TurnRequest {
  message: string;
}

export interface PendingAction {
  token: string;
  tool: string;
  summary: string;
}

export interface MemoryCandidate {
  statement: string;
}

export interface TurnResponse {
  assistant_content: string;
  cards: ToolCard[];
  actions: Action[];
  stats: Record<string, unknown> | null;
  pending_action: PendingAction | null;
  memory_candidates: MemoryCandidate[];
  followups: string[];
  sources: string[];
}

export interface ToolCard {
  kind: string;
  data: Record<string, unknown>;
}

export interface Action {
  kind: string;
  label: string;
  href?: string;
  copy_text?: string;
}

export interface ConfirmResponse {
  ok: boolean;
  message: string;
  result_card: ToolCard | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractDetail(data: unknown): string | null {
  if (data && typeof data === 'object' && 'detail' in data) {
    const d = (data as { detail: unknown }).detail;
    return typeof d === 'string' ? d : null;
  }
  return null;
}

async function asJson<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(extractDetail(data) || `${fallback} (status ${res.status}).`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Thread CRUD
// ---------------------------------------------------------------------------

export async function listThreads(): Promise<ThreadSummary[]> {
  const res = await apiFetch('/chat/threads', { credentials: 'include' });
  return asJson<ThreadSummary[]>(res, 'Failed to load threads');
}

export async function createThread(
  mode: string = 'ask',
  title?: string,
): Promise<ThreadSummary> {
  const res = await apiPost('/chat/threads', { mode, title }, 30_000);
  return asJson<ThreadSummary>(res, 'Failed to create thread');
}

export async function updateThread(
  threadId: string,
  patch: { title?: string; mode?: string },
): Promise<void> {
  const res = await apiPatch(`/chat/threads/${threadId}`, patch);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(extractDetail(data) || 'Failed to update thread');
  }
}

export async function deleteThread(threadId: string): Promise<void> {
  const res = await apiDelete(`/chat/threads/${threadId}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(extractDetail(data) || 'Failed to delete thread');
  }
}

// ---------------------------------------------------------------------------
// Turn (send message)
// ---------------------------------------------------------------------------

export async function sendTurn(
  threadId: string,
  message: string,
): Promise<TurnResponse> {
  const res = await apiPost(
    `/chat/threads/${threadId}/turn`,
    { message },
    300_000, // LLM timeout
  );
  return asJson<TurnResponse>(res, 'Failed to send message');
}

// ---------------------------------------------------------------------------
// Confirm / Cancel
// ---------------------------------------------------------------------------

export async function confirmAction(token: string): Promise<ConfirmResponse> {
  const res = await apiPost('/chat/confirm', { token }, 60_000);
  return asJson<ConfirmResponse>(res, 'Failed to confirm action');
}

export async function cancelAction(
  token: string,
): Promise<{ ok: boolean; message: string }> {
  const res = await apiPost('/chat/cancel', { token }, 10_000);
  return asJson<{ ok: boolean; message: string }>(res, 'Failed to cancel action');
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export async function saveMemory(
  statement: string,
  sourceThreadId: string,
): Promise<{ ok: boolean; saved: MemoryCandidate[] }> {
  const res = await apiPost(
    '/chat/memory/save',
    { statement, source_thread_id: sourceThreadId },
  );
  return asJson<{ ok: boolean; saved: MemoryCandidate[] }>(
    res,
    'Failed to save memory',
  );
}

export async function dismissMemory(
  memoryId: string,
): Promise<void> {
  const res = await apiDelete(`/chat/memory/${memoryId}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(extractDetail(data) || 'Failed to dismiss memory');
  }
}
