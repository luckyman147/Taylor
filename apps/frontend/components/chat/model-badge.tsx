'use client';

import { useEffect, useRef, useState } from 'react';
import { Cpu, ChevronDown, Check, Loader2 } from 'lucide-react';
import { fetchLlmConfig, updateLlmConfig, PROVIDER_INFO, type LLMProvider } from '@/lib/api/config';

interface ModelInfo {
  provider: LLMProvider;
  model: string;
}

export function ModelBadge() {
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchLlmConfig()
      .then((config) => setModelInfo({ provider: config.provider, model: config.model }))
      .catch(() => {});
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleSwitch = async (provider: LLMProvider) => {
    if (provider === modelInfo?.provider) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    try {
      const info = PROVIDER_INFO[provider];
      const config = await updateLlmConfig({
        provider,
        model: info.defaultModel,
      });
      setModelInfo({ provider: config.provider, model: config.model });
      setOpen(false);
    } catch {
      // silently fail
    } finally {
      setSwitching(false);
    }
  };

  if (!modelInfo) return null;

  const providerName = PROVIDER_INFO[modelInfo.provider]?.name || modelInfo.provider;
  const shortModel = modelInfo.model.split('/').pop() || modelInfo.model;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#e6e3dc] bg-[#faf9f7] px-2.5 py-1 text-[11px] text-ink-muted transition-colors hover:border-[#d1cec7] hover:text-ink-soft"
      >
        <Cpu className="h-3 w-3" />
        <span className="font-medium">{providerName}</span>
        <span className="text-ink-muted/50">·</span>
        <span>{shortModel}</span>
        <ChevronDown className="h-3 w-3 text-ink-muted" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full right-0 z-50 mb-2 w-56 rounded-xl border border-[#e6e3dc] bg-white py-1.5 shadow-lg">
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-muted">
              Switch Model
            </div>
            {Object.entries(PROVIDER_INFO).map(([key, info]) => {
              const provider = key as LLMProvider;
              const isActive = provider === modelInfo.provider;
              return (
                <button
                  key={key}
                  onClick={() => void handleSwitch(provider)}
                  disabled={switching}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-primary/5 text-primary font-medium'
                      : 'text-ink hover:bg-[#faf9f7]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span>{info.name}</span>
                    {info.requiresKey && (
                      <span className="text-[10px] text-ink-muted">API key</span>
                    )}
                  </div>
                  {isActive && <Check className="h-3.5 w-3.5" />}
                  {switching && isActive && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
