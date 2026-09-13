'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

export default function OAuthCallbackPage() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Processing OAuth callback...');

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      setStatus('error');
      setMessage(`OAuth error: ${searchParams.get('error_description') || error}`);
      return;
    }

    if (!code || !state) {
      setStatus('error');
      setMessage('Missing authorization code or state');
      return;
    }

    // Find the server_id from state (stored in sessionStorage by the popup opener)
    // The state contains server_id, but we need to find which server this is for
    // We'll iterate through possible server IDs stored in sessionStorage
    const findAndComplete = async () => {
      try {
        // Try to find the server_id from sessionStorage
        let serverId: string | null = null;
        let redirectUri: string | null = null;

        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key?.startsWith('oauth_state_')) {
            const storedState = sessionStorage.getItem(key);
            if (storedState === state) {
              serverId = key.replace('oauth_state_', '');
              redirectUri = sessionStorage.getItem(`oauth_redirect_${serverId}`);
              break;
            }
          }
        }

        if (!serverId) {
          throw new Error('Could not identify server for this OAuth flow');
        }

        // Complete the OAuth flow
        const res = await fetch(`/api/v1/mcp/servers/${serverId}/oauth/callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.detail || 'Failed to complete OAuth flow');
        }

        // Mark as completed for the popup opener
        sessionStorage.setItem(`oauth_completed_${serverId}`, 'true');

        setStatus('success');
        setMessage('OAuth connection successful! You can close this window.');

        // Close the popup after a short delay
        setTimeout(() => {
          window.close();
        }, 2000);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'OAuth callback failed';
        setStatus('error');
        setMessage(msg);
      }
    };

    findAndComplete();
  }, [searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#faf9f7]">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl text-center">
        {status === 'loading' && (
          <>
            <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-ink-muted" />
            <p className="text-sm text-ink">{message}</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-emerald-500" />
            <p className="text-sm text-ink">{message}</p>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle className="mx-auto mb-4 h-12 w-12 text-red-500" />
            <p className="text-sm text-ink">{message}</p>
            <p className="mt-2 text-xs text-ink-muted">
              You can close this window and try again.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
