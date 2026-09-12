/**
 * Chat Command Center API client.
 *
 * Persistent threads, two-phase tool calling, confirm/cancel, memory.
 */

import { BACKEND_URL, apiDelete, apiFetch, apiPatch, apiPost } from './client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThreadSummary {
  thread_id: string;
  title: string;
  mode: string;
  skills: string[];
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
  model_info: { provider: string; model: string } | null;
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
// Agent Event types (SSE streaming)
// ---------------------------------------------------------------------------

export type AgentStatus =
  | 'thinking'
  | 'planning'
  | 'discovering_tools'
  | 'generating_workflow'
  | 'executing'
  | 'tool_running'
  | 'tool_completed'
  | 'evaluating'
  | 'recovering'
  | 'retrieving_context'
  | 'generating_answer'
  | 'completed'
  | 'failed'
  | 'paused';

export type ToolExecStatus = 'running' | 'success' | 'failed' | 'cached' | 'skipped';

export interface AgentStatusEvent {
  type: 'agent_status';
  status: AgentStatus;
  message: string;
}

export interface ToolExecutionEvent {
  type: 'tool_execution';
  tool: string;
  status: ToolExecStatus;
  duration_ms?: number;
  message?: string;
  iteration?: number;
}

export interface RecoveryEvent {
  type: 'recovery';
  attempt: number;
  message: string;
}

export interface TurnCompleteEvent {
  type: 'turn_complete';
  data: TurnResponse;
}

export interface WorkflowEvent {
  type: 'workflow';
  status: 'generating' | 'executing' | 'completed';
  step_count: number;
  message: string;
}

export interface StepEvent {
  type: 'step';
  step_id: string;
  tool: string;
  status: 'running' | 'success' | 'failed' | 'skipped' | 'timeout';
  duration_ms?: number;
  error?: string;
}

export type AgentEvent =
  | AgentStatusEvent
  | ToolExecutionEvent
  | RecoveryEvent
  | TurnCompleteEvent
  | WorkflowEvent
  | StepEvent;

export interface ThreadMessage {
  message_id: string;
  thread_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  envelope: {
    cards?: ToolCard[];
    actions?: Action[];
    stats?: Record<string, unknown> | null;
    pending_action?: PendingAction | null;
    followups?: string[];
    sources?: string[];
  } | null;
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
  skills: string[] = [],
): Promise<ThreadSummary> {
  const res = await apiPost('/chat/threads', { mode, title, skills }, 30_000);
  return asJson<ThreadSummary>(res, 'Failed to create thread');
}

export async function updateThread(
  threadId: string,
  patch: { title?: string; mode?: string; skills?: string[] },
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
// Resume content
// ---------------------------------------------------------------------------

export async function getResumeContent(
  resumeId: string,
): Promise<{ resume_id: string; filename: string; content: string }> {
  const res = await apiFetch(`/resumes/${resumeId}/content`, {
    credentials: 'include',
  });
  return asJson(res, 'Failed to load resume content');
}

// ---------------------------------------------------------------------------
// Thread messages
// ---------------------------------------------------------------------------

export async function getThreadMessages(
  threadId: string,
): Promise<ThreadMessage[]> {
  const res = await apiFetch(`/chat/threads/${threadId}/messages`, {
    credentials: 'include',
  });
  return asJson<ThreadMessage[]>(res, 'Failed to load messages');
}

// ---------------------------------------------------------------------------
// Turn (send message)
// ---------------------------------------------------------------------------

export async function sendTurn(
  threadId: string,
  message: string,
  resumeId?: string,
): Promise<TurnResponse> {
  const res = await apiPost(
    `/chat/threads/${threadId}/turn`,
    { message, resume_id: resumeId || null },
    300_000, // LLM timeout
  );
  return asJson<TurnResponse>(res, 'Failed to send message');
}

// ---------------------------------------------------------------------------
// Streaming turn (SSE)
// ---------------------------------------------------------------------------

export interface StreamCallbacks {
  onEvent: (event: AgentEvent) => void;
  onComplete: (response: TurnResponse) => void;
  onError: (error: Error) => void;
}

/**
 * Send a message with SSE streaming. Returns an AbortController so the
 * caller can pause/cancel the request.
 */
export async function sendTurnStream(
  threadId: string,
  message: string,
  resumeId: string | undefined,
  callbacks: StreamCallbacks,
): Promise<AbortController> {
  const controller = new AbortController();

  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/chat/threads/${threadId}/turn/stream?stream=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, resume_id: resumeId || null }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Stream request failed: ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          return controller;
        }

        try {
          const event = JSON.parse(data) as AgentEvent;
          if (event.type === 'turn_complete') {
            callbacks.onComplete((event as TurnCompleteEvent).data);
          } else {
            callbacks.onEvent(event);
          }
        } catch {
          // skip malformed events
        }
      }
    }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      // User cancelled — no error
      return controller;
    }
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
  }

  return controller;
}

// ---------------------------------------------------------------------------
// Confirm / Cancel
// ---------------------------------------------------------------------------

export async function confirmAction(token: string, threadId: string): Promise<ConfirmResponse> {
  const res = await apiPost('/chat/confirm', { token, thread_id: threadId }, 120_000);
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

// ---------------------------------------------------------------------------
// Save Job from Chat
// ---------------------------------------------------------------------------

export async function saveJobFromChat(params: {
  title: string;
  company: string;
  location?: string;
  url?: string;
  resume_id?: string;
}): Promise<{ application_id: string; message: string }> {
  const res = await apiPost('/applications/save-job', params, 10_000);
  return asJson(res, 'Failed to save job');
}
