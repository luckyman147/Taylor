'use client';

import { useEffect, useState } from 'react';
import { Cpu } from 'lucide-react';
import { fetchLlmConfig, PROVIDER_INFO, type LLMProvider } from '@/lib/api/config';

interface ModelInfo {
  provider: LLMProvider;
  model: string;
}

export function ModelBadge() {
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);

  useEffect(() => {
    fetchLlmConfig()
      .then((config) => setModelInfo({ provider: config.provider, model: config.model }))
      .catch(() => {});
  }, []);

  if (!modelInfo) return null;

  const providerName = PROVIDER_INFO[modelInfo.provider]?.name || modelInfo.provider;
  const shortModel = modelInfo.model.split('/').pop() || modelInfo.model;

  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-[#e6e3dc] bg-[#faf9f7] px-2.5 py-1 text-[11px] text-ink-muted">
      <Cpu className="h-3 w-3" />
      <span className="font-medium">{providerName}</span>
      <span className="text-ink-muted/50">·</span>
      <span>{shortModel}</span>
    </div>
  );
}
