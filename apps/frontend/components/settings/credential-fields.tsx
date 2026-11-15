'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';

export type AuthType = 'none' | 'api_key' | 'bearer' | 'basic' | 'custom_headers' | 'oauth';

export interface CredentialData {
  auth_type: AuthType;
  // API Key
  header_name?: string;
  api_key?: string;
  // Bearer
  access_token?: string;
  // Basic
  username?: string;
  password?: string;
  // Custom Headers
  headers?: Record<string, string>;
  // OAuth
  authorization_url?: string;
  token_url?: string;
  client_id?: string;
  client_secret?: string;
  scopes?: string[];
}

interface CredentialFieldsProps {
  authType: AuthType;
  data: CredentialData;
  onChange: (data: CredentialData) => void;
}

export function CredentialFields({ authType, data, onChange }: CredentialFieldsProps) {
  if (authType === 'none') {
    return (
      <div className="rounded-lg bg-[#faf9f7] px-3 py-2 text-xs text-ink-muted">
        No authentication required for this server.
      </div>
    );
  }

  if (authType === 'api_key') {
    return (
      <div className="space-y-3">
        <div>
          <Label className="text-sm">Header Name</Label>
          <Input
            value={data.header_name || 'X-API-Key'}
            onChange={(e) => onChange({ ...data, header_name: e.target.value })}
            placeholder="X-API-Key"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-sm">API Key *</Label>
          <Input
            type="password"
            value={data.api_key || ''}
            onChange={(e) => onChange({ ...data, api_key: e.target.value })}
            placeholder="Enter your API key..."
            className="mt-1"
          />
        </div>
      </div>
    );
  }

  if (authType === 'bearer') {
    return (
      <div>
        <Label className="text-sm">Bearer Token *</Label>
        <Input
          type="password"
          value={data.access_token || ''}
          onChange={(e) => onChange({ ...data, access_token: e.target.value })}
          placeholder="Enter your bearer token..."
          className="mt-1"
        />
      </div>
    );
  }

  if (authType === 'basic') {
    return (
      <div className="space-y-3">
        <div>
          <Label className="text-sm">Username *</Label>
          <Input
            value={data.username || ''}
            onChange={(e) => onChange({ ...data, username: e.target.value })}
            placeholder="Enter username..."
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-sm">Password *</Label>
          <Input
            type="password"
            value={data.password || ''}
            onChange={(e) => onChange({ ...data, password: e.target.value })}
            placeholder="Enter password..."
            className="mt-1"
          />
        </div>
      </div>
    );
  }

  if (authType === 'custom_headers') {
    return (
      <CustomHeadersEditor
        headers={data.headers || {}}
        onChange={(h) => onChange({ ...data, headers: h })}
      />
    );
  }

  if (authType === 'oauth') {
    return (
      <div className="space-y-3">
        <div>
          <Label className="text-sm">Authorization URL</Label>
          <Input
            value={data.authorization_url || ''}
            onChange={(e) => onChange({ ...data, authorization_url: e.target.value })}
            placeholder="https://example.com/oauth/authorize"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-sm">Token URL *</Label>
          <Input
            value={data.token_url || ''}
            onChange={(e) => onChange({ ...data, token_url: e.target.value })}
            placeholder="https://example.com/oauth/token"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-sm">Client ID *</Label>
          <Input
            value={data.client_id || ''}
            onChange={(e) => onChange({ ...data, client_id: e.target.value })}
            placeholder="Enter client ID..."
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-sm">Client Secret</Label>
          <Input
            type="password"
            value={data.client_secret || ''}
            onChange={(e) => onChange({ ...data, client_secret: e.target.value })}
            placeholder="Enter client secret..."
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-sm">Scopes (comma-separated)</Label>
          <Input
            value={(data.scopes || []).join(', ')}
            onChange={(e) =>
              onChange({
                ...data,
                scopes: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="read, write, admin"
            className="mt-1"
          />
        </div>
      </div>
    );
  }

  return null;
}

interface CustomHeadersEditorProps {
  headers: Record<string, string>;
  onChange: (headers: Record<string, string>) => void;
}

function CustomHeadersEditor({ headers, onChange }: CustomHeadersEditorProps) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const entries = Object.entries(headers);

  const addHeader = () => {
    if (!newKey.trim()) return;
    onChange({ ...headers, [newKey.trim()]: newValue });
    setNewKey('');
    setNewValue('');
  };

  const removeHeader = (key: string) => {
    const next = { ...headers };
    delete next[key];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <Label className="text-sm">Custom Headers</Label>
      {entries.length > 0 && (
        <div className="space-y-2">
          {entries.map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <Input value={key} readOnly className="flex-1 bg-[#faf9f7] text-xs" />
              <Input
                value={value}
                readOnly
                type="password"
                className="flex-1 bg-[#faf9f7] text-xs"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeHeader(key)}
                className="h-8 w-8 p-0 text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="Header name"
          className="flex-1"
        />
        <Input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="Header value"
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addHeader}
          disabled={!newKey.trim()}
          className="h-8 w-8 p-0"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
