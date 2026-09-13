'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, ExternalLink } from 'lucide-react';

interface OAuthConnectButtonProps {
  serverId: string;
  serverName: string;
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

export function OAuthConnectButton({
  serverId,
  serverName,
  onSuccess,
  onError,
}: OAuthConnectButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    try {
      setLoading(true);

      // Build redirect URI (current page + callback path)
      const redirectUri = `${window.location.origin}/settings/mcp/callback`;

      // Get authorization URL
      const res = await fetch(`/api/v1/mcp/servers/${serverId}/oauth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirect_uri: redirectUri }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to get authorization URL');
      }

      const { authorization_url, state } = await res.json();

      // Store state in sessionStorage for callback verification
      sessionStorage.setItem(`oauth_state_${serverId}`, state);
      sessionStorage.setItem(`oauth_redirect_${serverId}`, redirectUri);

      // Open authorization URL in a popup
      const width = 600;
      const height = 700;
      const left = (window.innerWidth - width) / 2;
      const top = (window.innerHeight - height) / 2;

      const popup = window.open(
        authorization_url,
        `oauth_${serverId}`,
        `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
      );

      if (!popup) {
        throw new Error('Popup blocked. Please allow popups for this site.');
      }

      // Listen for the popup to close (callback will have completed)
      const checkInterval = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkInterval);
          // Check if tokens were stored (callback sets a flag)
          const completed = sessionStorage.getItem(`oauth_completed_${serverId}`);
          sessionStorage.removeItem(`oauth_completed_${serverId}`);
          sessionStorage.removeItem(`oauth_state_${serverId}`);
          sessionStorage.removeItem(`oauth_redirect_${serverId}`);

          if (completed === 'true') {
            onSuccess?.();
          }
        }
      }, 500);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'OAuth connection failed';
      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void handleConnect()}
      disabled={loading}
    >
      {loading ? (
        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
      ) : (
        <ExternalLink className="mr-1.5 h-3 w-3" />
      )}
      Connect {serverName}
    </Button>
  );
}
