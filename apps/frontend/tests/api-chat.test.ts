import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listThreads,
  createThread,
  updateThread,
  deleteThread,
  sendTurn,
  confirmAction,
  cancelAction,
  saveMemory,
  dismissMemory,
} from '@/lib/api/chat';

describe('chat API client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('listThreads', () => {
    it('calls GET /api/v1/chat/threads', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }),
      );
      await listThreads();
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/chat/threads',
        expect.objectContaining({ signal: expect.anything() }),
      );
    });
  });

  describe('createThread', () => {
    it('sends mode in POST body', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ thread_id: '1', mode: 'coach', title: 'New Chat' }),
          { status: 200 },
        ),
      );
      const result = await createThread('coach');
      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ mode: 'coach', title: undefined });
      expect(result.thread_id).toBe('1');
    });
  });

  describe('updateThread', () => {
    it('sends PATCH with mode', async () => {
      await updateThread('t1', { mode: 'recruiter' });
      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body)).toEqual({ mode: 'recruiter' });
    });
  });

  describe('deleteThread', () => {
    it('sends DELETE', async () => {
      await deleteThread('t1');
      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe('DELETE');
    });
  });

  describe('sendTurn', () => {
    it('sends message with long timeout', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            assistant_content: 'Hello!',
            cards: [],
            actions: [],
            stats: null,
            pending_action: null,
            memory_candidates: [],
            followups: [],
            sources: [],
          }),
          { status: 200 },
        ),
      );
      const result = await sendTurn('t1', 'Hi');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/v1/chat/threads/t1/turn');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ message: 'Hi' });
      expect(result.assistant_content).toBe('Hello!');
    });
  });

  describe('confirmAction', () => {
    it('sends token in POST body', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, message: 'Done', result_card: null }),
          { status: 200 },
        ),
      );
      const result = await confirmAction('abc123', 'thread-456');
      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({ token: 'abc123', thread_id: 'thread-456' });
      expect(result.ok).toBe(true);
    });
  });

  describe('cancelAction', () => {
    it('sends token in POST body', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, message: 'Cancelled' }),
          { status: 200 },
        ),
      );
      const result = await cancelAction('abc123');
      expect(result.ok).toBe(true);
    });
  });

  describe('saveMemory', () => {
    it('sends statement and source_thread_id', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, saved: [] }),
          { status: 200 },
        ),
      );
      await saveMemory('I like remote work', 't1');
      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({
        statement: 'I like remote work',
        source_thread_id: 't1',
      });
    });
  });

  describe('dismissMemory', () => {
    it('sends DELETE with memory id', async () => {
      await dismissMemory('mem1');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/v1/chat/memory/mem1');
      expect(init.method).toBe('DELETE');
    });
  });

  describe('error handling', () => {
    it('throws on non-OK response with detail', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ detail: 'Thread not found' }),
          { status: 404 },
        ),
      );
      await expect(listThreads()).rejects.toThrow('Thread not found');
    });

    it('throws on non-OK response without detail', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response('{}', { status: 500 }),
      );
      await expect(listThreads()).rejects.toThrow(/status 500/);
    });
  });
});
