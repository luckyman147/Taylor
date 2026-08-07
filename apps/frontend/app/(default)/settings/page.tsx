'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  fetchLlmConfig,
  updateLlmConfig,
  testLlmConnection,
  fetchFeatureConfig,
  updateFeatureConfig,
  fetchPromptConfig,
  updatePromptConfig,
  clearAllApiKeys,
  resetDatabase,
  PROVIDER_INFO,
  fetchFeaturePrompts,
  updateFeaturePrompts,
  FeaturePromptsError,
  fetchApiKeyStatus,
  updateApiKeys,
  deleteApiKey,
  llmProviderToKeyProvider,
  API_KEY_PROVIDER_INFO,
  type LLMConfigUpdate,
  type LLMProvider,
  type LLMHealthCheck,
  type PromptOption,
  type ReasoningEffort,
  type FeaturePromptsUpdate,
  type ApiKeyProviderStatus,
  type ApiKeyProvider,
} from '@/lib/api/config';
import { API_URL } from '@/lib/api/client';
import { getVersionString } from '@/lib/config/version';
import { cn } from '@/lib/utils';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { useStatusCache } from '@/lib/context/status-cache';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dropdown } from '@/components/ui/dropdown';
import {
  Save,
  Key,
  Database,
  Activity,
  Loader2,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Server,
  FileText,
  Briefcase,
  Sparkles,
  Clock,
  Settings2,
  Globe,
  Trash2,
  AlertTriangle,
  Github,
} from 'lucide-react';
import { useLanguage } from '@/lib/context/language-context';
import { useTranslations } from '@/lib/i18n';
import type { SupportedLanguage } from '@/lib/api/config';
import type { Locale } from '@/i18n/config';

type Status = 'idle' | 'loading' | 'saving' | 'saved' | 'error' | 'testing';

const PROVIDERS: LLMProvider[] = [
  'openai',
  'openai_compatible',
  'azure_foundry',
  'anthropic',
  'openrouter',
  'gemini',
  'deepseek',
  'groq',
  'ollama',
];

const SEGMENTED_BUTTON_BASE =
  'rounded-full border px-3 py-2 text-xs font-semibold uppercase transition-all duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50';
const SEGMENTED_BUTTON_ACTIVE = 'border-primary bg-primary text-white shadow-sw-xs';
const SEGMENTED_BUTTON_INACTIVE =
  'border-[#e6e3dc] bg-white text-ink hover:border-primary hover:text-primary';

const unwrapCodeBlock = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```\s*$/);
  if (fenced) {
    return fenced[1]?.trimEnd() || null;
  }
  return trimmed;
};

const getHealthCheckMessage = (
  t: (key: string, params?: Record<string, string | number>) => string,
  baseKey: string,
  code?: string,
  fallback?: string
): string | null => {
  if (code) {
    const key = `${baseKey}.${code}`;
    const localized = t(key);
    return localized !== key ? localized : (fallback ?? code);
  }
  return fallback ?? null;
};

export default function SettingsPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);

  // LLM Config state
  const [provider, setProvider] = useState<LLMProvider>('openai');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiBase, setApiBase] = useState('');
  const [hasStoredApiKey, setHasStoredApiKey] = useState(false);
  // Per-provider encrypted key store status (drives the saved/empty hints and
  // the provider key list). Keyed by key-store provider name.
  const [apiKeyStatuses, setApiKeyStatuses] = useState<ApiKeyProviderStatus[]>([]);
  // 'auto' is the UI sentinel for "do not send reasoning_effort". Maps to
  // empty string when persisted to the backend (so gpt-5 auto-migration
  // won't re-fire on next load). Typed tightly so invalid values can't leak
  // through the save path.
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | 'auto'>('auto');

  // Use cached system status (loaded on app start, refreshes every 30 min)
  const {
    status: systemStatus,
    isLoading: statusLoading,
    lastFetched,
    refreshStatus,
  } = useStatusCache();

  // Health check result from manual test
  const [healthCheck, setHealthCheck] = useState<LLMHealthCheck | null>(null);

  // Feature config state
  const [enableCoverLetter, setEnableCoverLetter] = useState(false);
  const [enableOutreach, setEnableOutreach] = useState(false);
  const [enableInterviewPrep, setEnableInterviewPrep] = useState(false);
  const [featureConfigLoading, setFeatureConfigLoading] = useState(false);
  const [promptConfigLoading, setPromptConfigLoading] = useState(false);
  const [promptOptions, setPromptOptions] = useState<PromptOption[]>([]);
  const [defaultPromptId, setDefaultPromptId] = useState('keywords');

  // Custom feature prompts (cover letter, cold outreach). Empty string
  // means "use default"; the backend's *_default fields give us the
  // actual default text for placeholder display.
  const [coverLetterPrompt, setCoverLetterPrompt] = useState('');
  const [outreachPrompt, setOutreachPrompt] = useState('');
  const [coverLetterDefault, setCoverLetterDefault] = useState('');
  const [outreachDefault, setOutreachDefault] = useState('');
  const [featurePromptSaving, setFeaturePromptSaving] = useState<string | null>(null);
  const [featurePromptError, setFeaturePromptError] = useState<{
    field: string;
    missing: string[];
  } | null>(null);

  // Per-provider key deletion confirm target (null = dialog closed).
  const [keyToDelete, setKeyToDelete] = useState<ApiKeyProvider | null>(null);

  // Danger Zone state
  const [showClearApiKeysDialog, setShowClearApiKeysDialog] = useState(false);
  const [showResetDatabaseDialog, setShowResetDatabaseDialog] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [successMessage, setSuccessDialogMessage] = useState({ title: '', description: '' });
  const [isResetting, setIsResetting] = useState(false);

  // Active settings section (sidebar navigation)
  const [activeSection, setActiveSection] = useState<
    'system' | 'ai' | 'content' | 'language' | 'github' | 'danger'
  >('system');

  // Language settings
  const {
    contentLanguage,
    uiLanguage,
    setContentLanguage,
    setUiLanguage,
    languageNames,
    supportedLanguages,
    isLoading: languageLoading,
  } = useLanguage();

  // Translations
  const { t } = useTranslations();
  const SETTINGS_SECTIONS = [
    { id: 'system', label: t('settings.systemStatus.title'), icon: Activity },
    { id: 'ai', label: t('settings.llmConfigurationTitle'), icon: Sparkles },
    { id: 'content', label: t('settings.contentGeneration.title'), icon: Settings2 },
    { id: 'language', label: t('settings.uiLanguage'), icon: Globe },
    { id: 'github', label: 'GitHub Repositories', icon: Github },
    { id: 'danger', label: t('settings.dangerZone'), icon: AlertTriangle },
  ] as const;
  const providerInfo = PROVIDER_INFO[provider] ?? PROVIDER_INFO['openai'];
  const fallbackPromptOptions = useMemo<PromptOption[]>(
    () => [
      {
        id: 'nudge',
        label: t('tailor.promptOptions.nudge.label'),
        description: t('tailor.promptOptions.nudge.description'),
      },
      {
        id: 'keywords',
        label: t('tailor.promptOptions.keywords.label'),
        description: t('tailor.promptOptions.keywords.description'),
      },
      {
        id: 'full',
        label: t('tailor.promptOptions.full.label'),
        description: t('tailor.promptOptions.full.description'),
      },
    ],
    [t]
  );
  const promptOptionOverrides = useMemo<Record<string, { label: string; description: string }>>(
    () => ({
      nudge: {
        label: t('tailor.promptOptions.nudge.label'),
        description: t('tailor.promptOptions.nudge.description'),
      },
      keywords: {
        label: t('tailor.promptOptions.keywords.label'),
        description: t('tailor.promptOptions.keywords.description'),
      },
      full: {
        label: t('tailor.promptOptions.full.label'),
        description: t('tailor.promptOptions.full.description'),
      },
    }),
    [t]
  );
  const localizedPromptOptions = useMemo(() => {
    const options = promptOptions.length ? promptOptions : fallbackPromptOptions;
    return options.map((option) => {
      const override = promptOptionOverrides[option.id];
      return override ? { ...option, ...override } : option;
    });
  }, [promptOptions, fallbackPromptOptions, promptOptionOverrides]);
  const healthDetailItems = useMemo(() => {
    if (!healthCheck) return [];

    return [
      {
        key: 'testPrompt',
        label: t('settings.llmConfiguration.testPromptLabel'),
        value: unwrapCodeBlock(healthCheck.test_prompt),
      },
      {
        key: 'modelOutput',
        label: t('settings.llmConfiguration.modelOutputLabel'),
        value: unwrapCodeBlock(healthCheck.model_output),
      },
      {
        key: 'reasoningContent',
        label: t('settings.llmConfiguration.reasoningContentLabel'),
        value: unwrapCodeBlock(healthCheck.reasoning_content),
      },
      {
        key: 'errorDetail',
        label: t('settings.llmConfiguration.errorDetailLabel'),
        value: unwrapCodeBlock(healthCheck.error_detail),
      },
    ].filter((item) => item.value);
  }, [healthCheck, t]);
  const healthCheckError = useMemo(() => {
    if (!healthCheck) return null;
    return getHealthCheckMessage(
      t,
      'settings.llmConfiguration.healthErrors',
      healthCheck.error_code,
      healthCheck.error
    );
  }, [healthCheck, t]);
  const healthCheckWarning = useMemo(() => {
    if (!healthCheck) return null;
    return getHealthCheckMessage(
      t,
      'settings.llmConfiguration.healthWarnings',
      healthCheck.warning_code,
      healthCheck.warning
    );
  }, [healthCheck, t]);

  // Load LLM config and feature config on mount
  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      try {
        const [llmConfig, featureConfig, promptConfig, featurePrompts, keyStatus] =
          await Promise.all([
            fetchLlmConfig().catch(() => null),
            fetchFeatureConfig().catch(() => null),
            fetchPromptConfig().catch(() => null),
            fetchFeaturePrompts().catch(() => null),
            fetchApiKeyStatus().catch(() => null),
          ]);

        if (cancelled) return;

        const statuses = keyStatus?.providers ?? [];
        setApiKeyStatuses(statuses);

        if (llmConfig) {
          const providerFromBackend = llmConfig.provider || 'openai';
          const safeProvider = PROVIDERS.includes(providerFromBackend as LLMProvider)
            ? (providerFromBackend as LLMProvider)
            : 'openai';
          setProvider(safeProvider);
          setModel(llmConfig.model || PROVIDER_INFO[safeProvider].defaultModel);
          // Whether THIS provider already has an encrypted key (per-provider,
          // not the legacy shared slot) drives the "leave blank to keep" hint.
          const keyProvider = llmProviderToKeyProvider(safeProvider);
          setHasStoredApiKey(statuses.some((s) => s.provider === keyProvider && s.configured));
          setApiKey('');
          setApiBase(llmConfig.api_base || '');
          setReasoningEffort((llmConfig.reasoning_effort as ReasoningEffort | null) ?? 'auto');

          if (providerFromBackend !== safeProvider) {
            setError(t('settings.errors.unknownProvider', { provider: providerFromBackend }));
          }
        }

        if (featureConfig) {
          setEnableCoverLetter(featureConfig.enable_cover_letter);
          setEnableOutreach(featureConfig.enable_outreach_message);
          setEnableInterviewPrep(featureConfig.enable_interview_prep);
        }

        if (promptConfig) {
          setPromptOptions(promptConfig.prompt_options || []);
          setDefaultPromptId(promptConfig.default_prompt_id || 'keywords');
        }

        if (featurePrompts) {
          setCoverLetterPrompt(featurePrompts.cover_letter_prompt);
          setOutreachPrompt(featurePrompts.outreach_message_prompt);
          setCoverLetterDefault(featurePrompts.cover_letter_default);
          setOutreachDefault(featurePrompts.outreach_message_default);
        }

        setStatus('idle');
      } catch (err) {
        console.error('Failed to load settings', err);
        if (!cancelled) {
          setError(t('settings.errors.unableToConnectBackend'));
          setStatus('error');
        }
      }
    }

    loadConfig();
    return () => {
      cancelled = true;
    };
  }, [t]);

  // Whether a given key-store provider currently has a saved key.
  const providerHasStoredKey = (p: LLMProvider): boolean => {
    const keyProvider = llmProviderToKeyProvider(p);
    return apiKeyStatuses.some((s) => s.provider === keyProvider && s.configured);
  };

  // Re-fetch the per-provider key status (after save/delete/clear).
  const refreshApiKeyStatus = async (): Promise<ApiKeyProviderStatus[]> => {
    const status = await fetchApiKeyStatus().catch(() => null);
    const statuses = status?.providers ?? [];
    setApiKeyStatuses(statuses);
    return statuses;
  };

  // Delete one provider's saved key (per-row action).
  const handleDeleteApiKey = async (keyProvider: ApiKeyProvider) => {
    try {
      await deleteApiKey(keyProvider);
      const statuses = await refreshApiKeyStatus();
      if (llmProviderToKeyProvider(provider) === keyProvider) {
        setHasStoredApiKey(false);
      }
      // Keep the local hint in sync even if the active provider differs.
      void statuses;
    } catch (err) {
      console.error('Failed to delete API key', err);
      setError((err as Error).message || t('settings.errors.unableToSaveConfiguration'));
    } finally {
      setKeyToDelete(null);
    }
  };

  // Handle provider change
  const handleProviderChange = (newProvider: LLMProvider) => {
    setProvider(newProvider);
    setModel(PROVIDER_INFO[newProvider].defaultModel);

    if (newProvider === 'azure_foundry' && provider !== 'azure_foundry') {
      setApiBase('');
    } else if (newProvider === 'ollama' && !apiBase.trim()) {
      setApiBase('http://localhost:11434');
    }
    if (newProvider === 'openai_compatible' && !apiBase.trim()) {
      // llama.cpp default; user can override for vLLM / LM Studio / etc.
      setApiBase('http://localhost:8080/v1');
    }

    // Clear the key input on switch, but drive the "has stored key" hint from
    // the per-provider store so a saved key for the new provider is recognized
    // (each provider keeps its own key — switching no longer wipes anything).
    setApiKey('');
    setHasStoredApiKey(providerHasStoredKey(newProvider));
  };

  // Save configuration
  const handleSave = async () => {
    setStatus('saving');
    setError(null);
    setHealthCheck(null);

    try {
      if (requiresApiKey && !apiKey.trim() && !hasStoredApiKey) {
        setError(t('settings.errors.apiKeyRequired'));
        setStatus('error');
        return;
      }
      if (requiresApiBase && !apiBase.trim()) {
        setError(t('settings.errors.baseUrlRequired', { provider: providerInfo.name }));
        setStatus('error');
        return;
      }

      const trimmedKey = apiKey.trim();

      // (1) Persist the key to the encrypted PER-PROVIDER store (only when the
      // user typed a new one). This is the bug fix: keys no longer ride on the
      // shared config slot, so saving one provider never wipes another's key.
      if (trimmedKey) {
        const keyProvider = llmProviderToKeyProvider(provider);
        await updateApiKeys({ [keyProvider]: trimmedKey } as Record<ApiKeyProvider, string>);
      }

      // (2) Persist non-secret LLM config — WITHOUT api_key.
      const update: LLMConfigUpdate = {
        provider,
        model: model.trim(),
        api_base: apiBase.trim() || null,
        // Map UI sentinel 'auto' → '' so the server persists an empty string
        // and the gpt-5 auto-migration won't re-fire.
        reasoning_effort: reasoningEffort === 'auto' ? '' : (reasoningEffort as ReasoningEffort),
      };
      await updateLlmConfig(update);

      // Refresh the per-provider key status + cached system status after save.
      const statuses = await refreshApiKeyStatus();
      setApiKey('');
      setHasStoredApiKey(
        statuses.some((s) => s.provider === llmProviderToKeyProvider(provider) && s.configured)
      );
      await refreshStatus();

      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (err) {
      console.error('Failed to save config', err);
      setError((err as Error).message || t('settings.errors.unableToSaveConfiguration'));
      setStatus('error');
    }
  };

  // Test connection with current form values (pre-save testing)
  const handleTestConnection = async () => {
    setStatus('testing');
    setError(null);
    setHealthCheck(null);

    try {
      if (requiresApiBase && !apiBase.trim()) {
        setHealthCheck({
          healthy: false,
          provider,
          model,
          error: t('settings.errors.baseUrlRequired', { provider: providerInfo.name }),
        });
        setStatus('idle');
        return;
      }

      // Build config from current form values
      const testConfig: LLMConfigUpdate = {
        provider,
        model: model.trim() || providerInfo.defaultModel,
        api_base: apiBase.trim() || null,
        reasoning_effort: reasoningEffort === 'auto' ? '' : (reasoningEffort as ReasoningEffort),
      };

      // Send the user-typed key if present (for any provider, required or
      // optional). If blank, omit the field so the backend falls back to
      // the stored key for that provider.
      if (apiKey.trim()) {
        testConfig.api_key = apiKey.trim();
      }

      const result = await testLlmConnection(testConfig);
      setHealthCheck(result);
      setStatus('idle');
    } catch (err) {
      console.error('Failed to test connection', err);
      setHealthCheck({ healthy: false, provider, model, error: (err as Error).message });
      setStatus('idle');
    }
  };

  // Update feature config
  const handleFeatureConfigChange = async (
    key: 'enable_cover_letter' | 'enable_outreach_message' | 'enable_interview_prep',
    value: boolean
  ) => {
    setFeatureConfigLoading(true);
    try {
      const updated = await updateFeatureConfig({ [key]: value });
      setEnableCoverLetter(updated.enable_cover_letter);
      setEnableOutreach(updated.enable_outreach_message);
      setEnableInterviewPrep(updated.enable_interview_prep);
    } catch (err) {
      console.error('Failed to update feature config', err);
      // Revert on error
      if (key === 'enable_cover_letter') {
        setEnableCoverLetter(!value);
      } else if (key === 'enable_outreach_message') {
        setEnableOutreach(!value);
      } else {
        setEnableInterviewPrep(!value);
      }
    } finally {
      setFeatureConfigLoading(false);
    }
  };

  const handleFeaturePromptSave = async (
    field: 'cover_letter_prompt' | 'outreach_message_prompt',
    value: string
  ) => {
    setFeaturePromptSaving(field);
    // Only clear the error for the field being saved; keep errors on the
    // other field visible until the user addresses them.
    setFeaturePromptError((prev) => (prev?.field === field ? null : prev));
    try {
      const update: FeaturePromptsUpdate = { [field]: value };
      const fresh = await updateFeaturePrompts(update);
      setCoverLetterPrompt(fresh.cover_letter_prompt);
      setOutreachPrompt(fresh.outreach_message_prompt);
    } catch (err) {
      if (err instanceof FeaturePromptsError) {
        setFeaturePromptError({ field: err.detail.field, missing: err.detail.missing });
      } else {
        setError((err as Error).message);
      }
    } finally {
      setFeaturePromptSaving(null);
    }
  };

  const handlePromptConfigChange = async (value: string) => {
    setPromptConfigLoading(true);
    setError(null);
    try {
      const updated = await updatePromptConfig({ default_prompt_id: value });
      setDefaultPromptId(updated.default_prompt_id);
      if (updated.prompt_options?.length) {
        setPromptOptions(updated.prompt_options);
      }
    } catch (err) {
      console.error('Failed to update prompt config', err);
      setError((err as Error).message || t('settings.errors.unableToSaveConfiguration'));
    } finally {
      setPromptConfigLoading(false);
    }
  };

  // Handle Clear API Keys
  const handleClearApiKeys = async () => {
    setIsResetting(true);
    try {
      await clearAllApiKeys();

      // The encrypted store is now empty for every provider.
      await refreshApiKeyStatus();
      // Refetch full LLM config to ensure local state is synced with backend
      const llmConfig = await fetchLlmConfig().catch(() => null);
      if (llmConfig) {
        setProvider(llmConfig.provider || 'openai');
        setModel(llmConfig.model || PROVIDER_INFO['openai'].defaultModel);
        setApiBase(llmConfig.api_base || '');
        setReasoningEffort(llmConfig.reasoning_effort ?? 'auto');
      }
      setApiKey('');
      setHasStoredApiKey(false);

      setHealthCheck(null);
      // Refresh status
      await refreshStatus();
      setError(null);
      setSuccessDialogMessage({
        title: t('common.success'),
        description: t('common.keysCleared'),
      });
      setShowSuccessDialog(true);
    } catch (err) {
      console.error('Failed to clear API keys', err);
      setError(t('settings.errors.failedToClearApiKeys'));
    } finally {
      setIsResetting(false);
      setShowClearApiKeysDialog(false);
    }
  };

  // Handle Reset Database
  const handleResetDatabase = async () => {
    setIsResetting(true);
    try {
      await resetDatabase();

      // Clear all related localStorage keys
      localStorage.removeItem('master_resume_id');
      localStorage.removeItem('resume_builder_draft');
      localStorage.removeItem('resume_builder_settings');
      localStorage.removeItem('resume_matcher_content_language');
      localStorage.removeItem('resume_matcher_ui_language');

      // Refresh status to show empty counts
      await refreshStatus();
      // Clear health check as context is lost
      setHealthCheck(null);
      setError(null);
      setSuccessDialogMessage({
        title: t('common.success'),
        description: t('common.databaseReset'),
      });
      setShowSuccessDialog(true);
    } catch (err) {
      console.error('Failed to reset database', err);
      setError(t('settings.errors.failedToResetDatabase'));
    } finally {
      setIsResetting(false);
      setShowResetDatabaseDialog(false);
    }
  };

  // Format last fetched time for display
  const formatLastFetched = () => {
    if (!lastFetched) return t('settings.systemStatus.lastFetched.never');
    const now = new Date();
    const diff = Math.floor((now.getTime() - lastFetched.getTime()) / 1000);
    if (diff < 60) return t('settings.systemStatus.lastFetched.justNow');
    if (diff < 3600)
      return t('settings.systemStatus.lastFetched.minutesAgo', { minutes: Math.floor(diff / 60) });
    return t('settings.systemStatus.lastFetched.hoursAgo', { hours: Math.floor(diff / 3600) });
  };

  const requiresApiKey = providerInfo.requiresKey ?? true;
  const requiresApiBase = providerInfo.requiresBaseUrl ?? false;
  const baseUrlLabel = providerInfo.baseUrlLabel ?? t('settings.llmConfiguration.baseUrlLabel');
  const baseUrlPlaceholder =
    providerInfo.baseUrlPlaceholder ?? t('settings.llmConfiguration.baseUrlPlaceholder');
  const baseUrlDescription =
    providerInfo.baseUrlDescription ?? t('settings.llmConfiguration.baseUrlDescription');

  return (
    <div className="flex min-h-screen flex-col items-center justify-start overflow-y-auto p-4 md:p-8">
      <div className="w-full max-w-6xl overflow-hidden rounded-2xl border border-[#e6e3dc] bg-white shadow-sw-lg">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#e6e3dc] bg-white p-6 md:p-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">{t('settings.title')}</h1>
            <p className="mt-1.5 text-xs uppercase tracking-wide text-steel-grey">
              {t('settings.subtitle')}
            </p>
          </div>
          <Link href="/dashboard">
            <Button variant="outline" size="sm" className="rounded-full">
              <ArrowLeft className="h-4 w-4" />
              {t('common.back')}
            </Button>
          </Link>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-start">
          {/* Settings sidebar navigation */}
          <aside className="w-full shrink-0 border-b border-[#e6e3dc] bg-white p-3 lg:w-56 lg:border-b-0 lg:border-r lg:p-4">
            <nav className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
              {SETTINGS_SECTIONS.map((section) => {
                const SectionIcon = section.icon;
                const active = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveSection(section.id)}
                    className={cn(
                      'flex shrink-0 items-center gap-3 rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide transition-colors lg:w-full',
                      active
                        ? 'bg-primary text-white shadow-sw-xs'
                        : 'bg-secondary/60 text-ink-soft hover:bg-secondary hover:text-ink'
                    )}
                  >
                    <SectionIcon className="h-4 w-4" />
                    {section.label}
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Settings content */}
          <div className="min-w-0 flex-1 space-y-10 p-4 md:p-8 lg:p-8">
            <div className="space-y-10">
              {/* API Key Not Configured Warning */}
              {!statusLoading && systemStatus && !systemStatus.llm_configured && (
                <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-[#fbf6e9] p-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100">
                    <AlertTriangle className="h-4 w-4 text-amber-700" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold uppercase tracking-wider text-amber-800">
                      {t('settings.setupRequired.title')}
                    </p>
                    <p className="mt-1 text-xs text-amber-700">
                      {t('settings.setupRequired.description')}
                    </p>
                  </div>
                </div>
              )}

              {/* System Status Panel */}
              {activeSection === 'system' && (
                <section className="space-y-4">
                  <div className="flex items-center justify-between border-b border-[#e6e3dc] pb-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                        <Activity className="h-4 w-4 text-primary" />
                      </span>
                      <h2 className="text-sm font-bold uppercase tracking-wide text-ink">
                        {t('settings.systemStatus.title')}
                      </h2>
                      {lastFetched && (
                        <span className="flex items-center gap-1 text-xs text-steel-grey">
                          <Clock className="h-3 w-3" />
                          {formatLastFetched()}
                        </span>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={refreshStatus}
                      disabled={statusLoading}
                      className="gap-1 rounded-full text-xs"
                    >
                      <RefreshCw className={`h-3 w-3 ${statusLoading ? 'animate-spin' : ''}`} />
                      {t('settings.systemStatus.refresh')}
                    </Button>
                  </div>

                  {statusLoading ? (
                    <div className="flex items-center justify-center rounded-2xl border border-dashed border-[#e6e3dc] p-8">
                      <Loader2 className="h-6 w-6 animate-spin text-steel-grey" />
                    </div>
                  ) : !systemStatus ? (
                    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-red-300 bg-[#fdf3f2] p-8">
                      <p className="text-xs uppercase text-red-600">
                        {t('settings.systemStatus.unableToConnect')}
                      </p>
                      <p className="text-xs text-ink-soft">
                        {t('settings.systemStatus.expectedAt', { apiUrl: API_URL })}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={refreshStatus}
                        className="gap-1 rounded-full text-xs"
                      >
                        <RefreshCw className="h-3 w-3" />
                        {t('common.retry')}
                      </Button>
                    </div>
                  ) : (
                    // @container so the status cards adapt to the section width
                    // rather than the viewport — useful when the settings page is
                    // shown alongside a sidebar or in a split view.
                    <div className="@container">
                      <div className="grid grid-cols-2 @3xl:grid-cols-4 gap-3">
                        {/* LLM Status */}
                        <div className="rounded-2xl border border-[#e6e3dc] bg-white p-4 shadow-sw-xs">
                          <div className="flex items-center gap-2 mb-2">
                            <Server className="h-4 w-4 text-steel-grey" />
                            <span className="text-xs uppercase text-steel-grey">
                              {t('settings.statusCards.llm')}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {systemStatus.llm_healthy ? (
                              <CheckCircle2 className="h-5 w-5 text-green-600" />
                            ) : (
                              <XCircle className="h-5 w-5 text-red-500" />
                            )}
                            <span className="text-sm font-bold text-ink">
                              {systemStatus.llm_healthy
                                ? t('settings.statusValues.healthy')
                                : t('settings.statusValues.offline')}
                            </span>
                          </div>
                        </div>

                        {/* Database Status */}
                        <div className="rounded-2xl border border-[#e6e3dc] bg-white p-4 shadow-sw-xs">
                          <div className="flex items-center gap-2 mb-2">
                            <Database className="h-4 w-4 text-steel-grey" />
                            <span className="text-xs uppercase text-steel-grey">
                              {t('settings.statusCards.database')}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                            <span className="text-sm font-bold text-ink">
                              {t('settings.statusValues.connected')}
                            </span>
                          </div>
                        </div>

                        {/* Resumes Count */}
                        <div className="rounded-2xl border border-[#e6e3dc] bg-white p-4 shadow-sw-xs">
                          <div className="flex items-center gap-2 mb-2">
                            <FileText className="h-4 w-4 text-steel-grey" />
                            <span className="text-xs uppercase text-steel-grey">
                              {t('settings.statusCards.resumes')}
                            </span>
                          </div>
                          <span className="text-2xl font-bold text-ink">
                            {systemStatus.database_stats.total_resumes}
                          </span>
                        </div>

                        {/* Jobs Count */}
                        <div className="rounded-2xl border border-[#e6e3dc] bg-white p-4 shadow-sw-xs">
                          <div className="flex items-center gap-2 mb-2">
                            <Briefcase className="h-4 w-4 text-steel-grey" />
                            <span className="text-xs uppercase text-steel-grey">
                              {t('settings.statusCards.jobs')}
                            </span>
                          </div>
                          <span className="text-2xl font-bold text-ink">
                            {systemStatus.database_stats.total_jobs}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Additional Stats Row */}
                  {systemStatus && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-2xl border border-[#e6e3dc] bg-white p-4 shadow-sw-xs">
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles className="h-4 w-4 text-steel-grey" />
                          <span className="text-xs uppercase text-steel-grey">
                            {t('settings.statusCards.improvements')}
                          </span>
                        </div>
                        <span className="text-2xl font-bold text-ink">
                          {systemStatus.database_stats.total_improvements}
                        </span>
                      </div>
                      <div className="rounded-2xl border border-[#e6e3dc] bg-white p-4 shadow-sw-xs">
                        <div className="flex items-center gap-2 mb-2">
                          <FileText className="h-4 w-4 text-steel-grey" />
                          <span className="text-xs uppercase text-steel-grey">
                            {t('settings.statusCards.masterResume')}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {systemStatus.has_master_resume ? (
                            <>
                              <CheckCircle2 className="h-5 w-5 text-green-600" />
                              <span className="text-sm font-bold text-ink">
                                {t('settings.statusValues.configured')}
                              </span>
                            </>
                          ) : (
                            <>
                              <XCircle className="h-5 w-5 text-amber-500" />
                              <span className="text-sm font-bold text-ink">
                                {t('settings.statusValues.notSet')}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* LLM Configuration */}
              {activeSection === 'ai' && (
                <section className="space-y-6">
                  <div className="flex items-center gap-3 border-b border-[#e6e3dc] pb-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                      <Key className="h-4 w-4 text-primary" />
                    </span>
                    <h2 className="text-sm font-bold uppercase tracking-wide text-ink">
                      {t('settings.llmConfigurationTitle')}
                    </h2>
                  </div>

                  <div className="grid gap-6 lg:grid-cols-2">
                    {/* Provider Selection */}
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase tracking-wider text-ink-soft">
                        {t('settings.providerLabel')}
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {PROVIDERS.map((p) => (
                          <button
                            key={p}
                            onClick={() => handleProviderChange(p)}
                            className={`rounded-full border px-4 py-2 text-xs font-bold uppercase transition-all ${
                              provider === p
                                ? 'border-primary bg-primary text-white shadow-sw-xs'
                                : 'border-[#e6e3dc] bg-white text-ink hover:border-primary hover:text-primary'
                            }`}
                          >
                            {PROVIDER_INFO[p].name.split(' ')[0]}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-steel-grey">
                        {t('settings.llmConfiguration.selectedProvider', {
                          provider: providerInfo.name,
                        })}
                      </p>
                    </div>

                    {/* Model Input */}
                    <div className="space-y-2">
                      <Label
                        htmlFor="model"
                        className="text-xs font-bold uppercase tracking-wider text-ink-soft"
                      >
                        {t('settings.llmConfiguration.modelLabel')}
                      </Label>
                      <Input
                        id="model"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder={providerInfo.defaultModel}
                        className="rounded-2xl border-[#e6e3dc] focus:border-primary focus:ring-primary/20"
                      />
                      <p className="text-xs text-steel-grey">
                        {t('settings.llmConfiguration.defaultModel', {
                          model: providerInfo.defaultModel,
                        })}
                      </p>
                    </div>

                    {/* API Key Input — always enabled. For providers that don't
                  require a key (Ollama, OpenAI-Compatible local servers), the
                  field is marked optional so users can STILL enter a key if
                  their deployment needs auth (e.g., a secured LM Studio or a
                  hosted OpenAI-compatible proxy). Save-time validation only
                  fails when `requiresApiKey` is true. */}
                    <div className="space-y-2">
                      <Label
                        htmlFor="apiKey"
                        className="text-xs font-bold uppercase tracking-wider text-ink-soft"
                      >
                        {t('settings.llmConfiguration.apiKeyLabel')}{' '}
                        {!requiresApiKey && (
                          <span className="text-steel-grey">
                            {t('settings.llmConfiguration.apiKeyOptional')}
                          </span>
                        )}
                      </Label>
                      <Input
                        id="apiKey"
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={
                          requiresApiKey
                            ? t('settings.llmConfiguration.apiKeyPlaceholder')
                            : t('settings.llmConfiguration.apiKeyOptionalPlaceholder')
                        }
                        className="rounded-2xl border-[#e6e3dc] bg-white focus:border-[#e6e3dc] focus:ring-primary/20"
                      />
                      {hasStoredApiKey && !apiKey && (
                        <p className="text-xs text-steel-grey">
                          {t('settings.llmConfiguration.leaveBlankToKeepExistingKey')}
                        </p>
                      )}
                    </div>

                    {/* Saved per-provider keys — each provider keeps its own encrypted
                  key, so switching providers never wipes another's. */}
                    {apiKeyStatuses.some((s) => s.configured) && (
                      <div className="space-y-2 rounded-2xl border border-[#e6e3dc] bg-secondary/40 p-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">
                          {t('settings.apiKeys.savedTitle')}
                        </p>
                        <ul className="space-y-1.5">
                          {apiKeyStatuses
                            .filter((s) => s.configured)
                            .map((s) => (
                              <li
                                key={s.provider}
                                className="flex items-center justify-between gap-2 text-sm"
                              >
                                <span className="flex items-center gap-2">
                                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                                  <span className="font-medium text-ink">
                                    {API_KEY_PROVIDER_INFO[s.provider]?.name ?? s.provider}
                                  </span>
                                  <span className="rounded-full border border-[#e6e3dc] bg-white px-2 py-0.5 text-[10px] text-steel-grey">
                                    {s.masked_key}
                                  </span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setKeyToDelete(s.provider)}
                                  className="rounded-full border border-red-400/50 bg-red-50 px-3 py-1 text-xs font-bold uppercase text-red-600 transition-colors hover:border-red-500 hover:bg-red-500 hover:text-white"
                                  aria-label={t('settings.apiKeys.deleteAria', {
                                    provider: API_KEY_PROVIDER_INFO[s.provider]?.name ?? s.provider,
                                  })}
                                >
                                  {t('common.delete')}
                                </button>
                              </li>
                            ))}
                        </ul>
                      </div>
                    )}

                    {/* API Base URL (optional, for proxies/aggregators/custom endpoints) */}
                    <div className="space-y-2">
                      <Label
                        htmlFor="apiBase"
                        className="text-xs font-bold uppercase tracking-wider text-ink-soft"
                      >
                        {baseUrlLabel}{' '}
                        {requiresApiBase && <span className="text-destructive">*</span>}
                      </Label>
                      <Input
                        id="apiBase"
                        value={apiBase}
                        onChange={(e) => setApiBase(e.target.value)}
                        placeholder={baseUrlPlaceholder}
                        className="rounded-2xl border-[#e6e3dc] bg-white focus:border-[#e6e3dc] focus:ring-primary/20"
                      />
                      <p className="text-xs text-steel-grey">{baseUrlDescription}</p>
                    </div>

                    {/* Reasoning Effort (optional, only applies to reasoning-capable models) */}
                    <div className="space-y-2">
                      <Dropdown
                        label={t('settings.llmConfiguration.reasoningEffortLabel')}
                        value={reasoningEffort}
                        onChange={(value) => setReasoningEffort(value as ReasoningEffort | 'auto')}
                        options={[
                          {
                            id: 'auto',
                            label: t('settings.llmConfiguration.reasoningEffortAuto'),
                            description: t('settings.llmConfiguration.reasoningEffortAutoDesc'),
                          },
                          {
                            id: 'minimal',
                            label: t('settings.llmConfiguration.reasoningEffortMinimal'),
                          },
                          { id: 'low', label: t('settings.llmConfiguration.reasoningEffortLow') },
                          {
                            id: 'medium',
                            label: t('settings.llmConfiguration.reasoningEffortMedium'),
                          },
                          { id: 'high', label: t('settings.llmConfiguration.reasoningEffortHigh') },
                        ]}
                      />
                      <p className="text-xs text-steel-grey">
                        {t('settings.llmConfiguration.reasoningEffortDescription')}
                      </p>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3 lg:col-span-2">
                      <Button
                        onClick={handleSave}
                        disabled={status === 'saving' || status === 'loading'}
                        className="flex-1 rounded-full"
                      >
                        {status === 'saving' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : status === 'saved' ? (
                          <>
                            <CheckCircle2 className="w-4 h-4" />
                            {t('common.success')}
                          </>
                        ) : (
                          <>
                            <Save className="w-4 h-4" />
                            {t('common.save')}
                          </>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleTestConnection}
                        disabled={status === 'testing' || status === 'saving'}
                        className="rounded-full"
                      >
                        {status === 'testing' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <Activity className="w-4 h-4" />
                            {t('settings.llmConfiguration.testConnection')}
                          </>
                        )}
                      </Button>
                    </div>

                    {/* Error Message */}
                    {error && (
                      <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 lg:col-span-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                        <p className="text-xs text-red-700 break-words">
                          {t('settings.llmConfiguration.errorPrefix', { error })}
                        </p>
                      </div>
                    )}

                    {/* Health Check Result */}
                    {healthCheck && (
                      <div
                        className={`rounded-2xl border p-5 break-words lg:col-span-2 ${
                          healthCheck.healthy
                            ? 'border-green-200 bg-green-50'
                            : 'border-red-200 bg-[#fdf3f2]'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          {healthCheck.healthy ? (
                            <CheckCircle2 className="w-5 h-5 text-green-600" />
                          ) : (
                            <XCircle className="w-5 h-5 text-red-500" />
                          )}
                          <span className="text-sm font-bold text-ink">
                            {healthCheck.healthy
                              ? t('settings.llmConfiguration.connectionSuccessful')
                              : t('settings.llmConfiguration.connectionFailed')}
                          </span>
                        </div>
                        <p className="text-xs text-ink-soft">
                          {t('settings.llmConfiguration.connectionDetails', {
                            provider: healthCheck.provider,
                            model: healthCheck.model,
                          })}
                        </p>
                        {healthCheckError && (
                          <p className="text-xs text-red-600 mt-1 break-words">
                            {healthCheckError}
                          </p>
                        )}
                        {healthCheckWarning && (
                          <p className="text-xs text-amber-700 mt-1 break-words">
                            {healthCheckWarning}
                          </p>
                        )}
                        {healthDetailItems.length > 0 && (
                          <div className="mt-3 space-y-3">
                            {healthDetailItems.map((item) =>
                              item.key === 'reasoningContent' ? (
                                <details key={item.key} className="group">
                                  <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-ink-soft hover:text-black">
                                    {item.label}
                                  </summary>
                                  <pre className="mt-1 whitespace-pre-wrap break-words rounded-xl border border-[#e6e3dc] bg-white p-3 text-xs text-ink-soft shadow-sw-xs">
                                    {item.value}
                                  </pre>
                                </details>
                              ) : (
                                <div key={item.key}>
                                  <p className="text-[10px] uppercase tracking-wider text-ink-soft">
                                    {item.label}
                                  </p>
                                  <pre className="mt-1 whitespace-pre-wrap break-words rounded-xl border border-[#e6e3dc] bg-white p-3 text-xs text-ink-soft shadow-sw-xs">
                                    {item.value}
                                  </pre>
                                </div>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Content Generation Section */}
              {activeSection === 'content' && (
                <section className="space-y-6">
                  <div className="flex items-center gap-3 border-b border-[#e6e3dc] pb-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                      <Settings2 className="h-4 w-4 text-primary" />
                    </span>
                    <h2 className="text-sm font-bold uppercase tracking-wide text-ink">
                      {t('settings.contentGeneration.title')}
                    </h2>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm text-ink-soft mb-4">
                      {t('settings.contentGeneration.description')}
                    </p>

                    <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
                      <ToggleSwitch
                        checked={enableCoverLetter}
                        onCheckedChange={(checked) => {
                          setEnableCoverLetter(checked);
                          handleFeatureConfigChange('enable_cover_letter', checked);
                        }}
                        label={t('settings.contentGeneration.coverLetter.label')}
                        description={t('settings.contentGeneration.coverLetter.description')}
                        disabled={featureConfigLoading}
                      />
                      {enableCoverLetter && (
                        <div className="pl-6 space-y-2">
                          <Label htmlFor="coverLetterPrompt">
                            {t('settings.contentGeneration.customPromptLabel')}
                          </Label>
                          <textarea
                            id="coverLetterPrompt"
                            rows={8}
                            value={coverLetterPrompt}
                            onChange={(e) => setCoverLetterPrompt(e.target.value)}
                            placeholder={coverLetterDefault}
                            className="w-full rounded-2xl border border-[#e6e3dc] bg-white p-3 text-xs break-words shadow-sw-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                          <p className="text-xs text-steel-grey ">
                            {t('settings.contentGeneration.customPromptHelp')}
                          </p>
                          {featurePromptError?.field === 'cover_letter_prompt' && (
                            <p className="text-xs text-red-600  break-words">
                              {t('settings.contentGeneration.customPromptErrorMissing', {
                                missing: featurePromptError.missing.join(', '),
                              })}
                            </p>
                          )}
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              onClick={() =>
                                handleFeaturePromptSave('cover_letter_prompt', coverLetterPrompt)
                              }
                              disabled={featurePromptSaving === 'cover_letter_prompt'}
                            >
                              {featurePromptSaving === 'cover_letter_prompt' ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                t('common.save')
                              )}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => handleFeaturePromptSave('cover_letter_prompt', '')}
                              disabled={featurePromptSaving === 'cover_letter_prompt'}
                            >
                              {t('settings.contentGeneration.customPromptResetButton')}
                            </Button>
                          </div>
                        </div>
                      )}
                      <ToggleSwitch
                        checked={enableOutreach}
                        onCheckedChange={(checked) => {
                          setEnableOutreach(checked);
                          handleFeatureConfigChange('enable_outreach_message', checked);
                        }}
                        label={t('settings.contentGeneration.outreachMessage.label')}
                        description={t('settings.contentGeneration.outreachMessage.description')}
                        disabled={featureConfigLoading}
                      />
                      {enableOutreach && (
                        <div className="pl-6 space-y-2">
                          <Label htmlFor="outreachPrompt">
                            {t('settings.contentGeneration.customPromptLabel')}
                          </Label>
                          <textarea
                            id="outreachPrompt"
                            rows={8}
                            value={outreachPrompt}
                            onChange={(e) => setOutreachPrompt(e.target.value)}
                            placeholder={outreachDefault}
                            className="w-full rounded-2xl border border-[#e6e3dc] bg-white p-3 text-xs break-words shadow-sw-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                          <p className="text-xs text-steel-grey ">
                            {t('settings.contentGeneration.customPromptHelp')}
                          </p>
                          {featurePromptError?.field === 'outreach_message_prompt' && (
                            <p className="text-xs text-red-600  break-words">
                              {t('settings.contentGeneration.customPromptErrorMissing', {
                                missing: featurePromptError.missing.join(', '),
                              })}
                            </p>
                          )}
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              onClick={() =>
                                handleFeaturePromptSave('outreach_message_prompt', outreachPrompt)
                              }
                              disabled={featurePromptSaving === 'outreach_message_prompt'}
                            >
                              {featurePromptSaving === 'outreach_message_prompt' ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                t('common.save')
                              )}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => handleFeaturePromptSave('outreach_message_prompt', '')}
                              disabled={featurePromptSaving === 'outreach_message_prompt'}
                            >
                              {t('settings.contentGeneration.customPromptResetButton')}
                            </Button>
                          </div>
                        </div>
                      )}
                      <ToggleSwitch
                        checked={enableInterviewPrep}
                        onCheckedChange={(checked) => {
                          setEnableInterviewPrep(checked);
                          handleFeatureConfigChange('enable_interview_prep', checked);
                        }}
                        label={t('settings.contentGeneration.interviewPrep.label')}
                        description={t('settings.contentGeneration.interviewPrep.description')}
                        disabled={featureConfigLoading}
                      />
                    </div>

                    <div className="pt-4 border-t border-paper-tint">
                      <Dropdown
                        options={localizedPromptOptions}
                        value={defaultPromptId}
                        onChange={handlePromptConfigChange}
                        label={t('settings.promptSettings.title')}
                        description={t('settings.promptSettings.description')}
                        disabled={promptConfigLoading}
                      />
                    </div>
                  </div>
                </section>
              )}

              {/* Language Settings Section */}
              {activeSection === 'language' && (
                <section className="space-y-6">
                  <div className="flex items-center gap-3 border-b border-[#e6e3dc] pb-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                      <Globe className="h-4 w-4 text-primary" />
                    </span>
                    <h2 className="text-sm font-bold uppercase tracking-wide text-ink">
                      {t('settings.uiLanguage')} & {t('settings.contentLanguage')}
                    </h2>
                  </div>

                  <div className="grid gap-6 lg:grid-cols-2">
                    {/* UI Language */}
                    <div className="space-y-4">
                      <div>
                        <h3 className=" text-xs font-bold uppercase tracking-wider text-ink-soft mb-2">
                          {t('settings.uiLanguage')}
                        </h3>
                        <p className="text-sm text-ink-soft mb-3">
                          {t('settings.uiLanguageDescription')}
                        </p>
                      </div>

                      <div className="space-y-2">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          {supportedLanguages.map((lang) => (
                            <button
                              key={`ui-${lang}`}
                              onClick={() => setUiLanguage(lang as Locale)}
                              disabled={languageLoading}
                              className={`px-4 py-3 text-sm ${SEGMENTED_BUTTON_BASE} ${uiLanguage === lang ? SEGMENTED_BUTTON_ACTIVE : SEGMENTED_BUTTON_INACTIVE}`}
                            >
                              {languageNames[lang]}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Content Language */}
                    <div className="space-y-4 pt-4 border-t border-paper-tint">
                      <div>
                        <h3 className=" text-xs font-bold uppercase tracking-wider text-ink-soft mb-2">
                          {t('settings.contentLanguage')}
                        </h3>
                        <p className="text-sm text-ink-soft mb-3">
                          {t('settings.contentLanguageDescription')}
                        </p>
                      </div>

                      <div className="space-y-2">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          {supportedLanguages.map((lang) => (
                            <button
                              key={`content-${lang}`}
                              onClick={() => setContentLanguage(lang as SupportedLanguage)}
                              disabled={languageLoading}
                              className={`px-4 py-3 text-sm ${SEGMENTED_BUTTON_BASE} ${contentLanguage === lang ? SEGMENTED_BUTTON_ACTIVE : SEGMENTED_BUTTON_INACTIVE}`}
                            >
                              {languageNames[lang]}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* GitHub Integration */}
              {activeSection === 'github' && (
                <section className="space-y-6">
                  <div className="flex items-center gap-3 border-b border-[#e6e3dc] pb-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                      <Github className="h-4 w-4 text-primary" />
                    </span>
                    <h2 className="text-sm font-bold uppercase tracking-wide text-ink">
                      GitHub Repositories
                    </h2>
                  </div>
                  <GitHubReposSection />
                </section>
              )}

              {/* Danger Zone */}
              {activeSection === 'danger' && (
                <section className="space-y-6">
                  <div className="flex items-center gap-3 border-b border-[#e6e3dc] pb-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-50">
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                    </span>
                    <h2 className="text-sm font-bold uppercase tracking-wide text-red-600">
                      {t('settings.dangerZone')}
                    </h2>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    {/* Clear API Keys */}
                    <div className="space-y-4 rounded-2xl border border-red-200 bg-[#fdf3f2]/50 p-5">
                      <div>
                        <h3 className="mb-1 text-sm font-bold text-red-900">
                          {t('settings.clearApiKeys')}
                        </h3>
                        <p className="text-xs text-red-700">
                          {t('settings.clearApiKeysDescription')}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        className="w-full rounded-full border-red-200 text-red-700 hover:bg-[#fdf3f2] hover:text-red-800 hover:border-red-300"
                        onClick={() => setShowClearApiKeysDialog(true)}
                        disabled={isResetting}
                      >
                        <Key className="w-4 h-4 mr-2" />
                        {t('settings.clearApiKeys')}
                      </Button>
                    </div>

                    {/* Reset Database */}
                    <div className="space-y-4 rounded-2xl border border-red-200 bg-[#fdf3f2]/50 p-5">
                      <div>
                        <h3 className="mb-1 text-sm font-bold text-red-900">
                          {t('settings.resetDatabase')}
                        </h3>
                        <p className="text-xs text-red-700">
                          {t('settings.resetDatabaseDescription')}
                        </p>
                      </div>
                      <Button
                        variant="destructive"
                        className="w-full rounded-full"
                        onClick={() => setShowResetDatabaseDialog(true)}
                        disabled={isResetting}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        {t('settings.resetDatabase')}
                      </Button>
                    </div>
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#e6e3dc] bg-secondary/60 p-4">
          <div className="flex items-center gap-2">
            <Image src="/logo.png" alt="Taylor" width={20} height={20} className="w-5 h-5" />
            <span className="text-xs text-steel-grey">{getVersionString().toUpperCase()}</span>
          </div>
          <div className="flex items-center gap-2">
            {statusLoading ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin text-steel-grey" />
                <span className="text-xs text-steel-grey">
                  {t('settings.footer.status.checking')}
                </span>
              </>
            ) : systemStatus ? (
              <>
                <span className="flex h-2 w-2 rounded-full bg-green-600" />
                <span
                  className={`text-xs font-bold ${
                    systemStatus.status === 'ready' ? 'text-green-700' : 'text-amber-600'
                  }`}
                >
                  {systemStatus.status === 'ready'
                    ? t('settings.footer.status.ready')
                    : t('settings.footer.status.setupRequired')}
                </span>
              </>
            ) : (
              <span className="text-xs text-steel-grey">{t('settings.footer.status.offline')}</span>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={keyToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setKeyToDelete(null);
        }}
        title={t('settings.apiKeys.deleteConfirmTitle')}
        description={t('settings.apiKeys.deleteConfirmDescription', {
          provider: keyToDelete ? (API_KEY_PROVIDER_INFO[keyToDelete]?.name ?? keyToDelete) : '',
        })}
        confirmLabel={t('common.delete')}
        variant="warning"
        onConfirm={() => {
          if (keyToDelete) void handleDeleteApiKey(keyToDelete);
        }}
      />

      <ConfirmDialog
        open={showClearApiKeysDialog}
        onOpenChange={setShowClearApiKeysDialog}
        title={t('confirmations.clearApiKeys')}
        description={t('confirmations.clearApiKeysDescription')}
        confirmLabel={t('common.delete')}
        variant="warning"
        onConfirm={handleClearApiKeys}
      />

      <ConfirmDialog
        open={showResetDatabaseDialog}
        onOpenChange={setShowResetDatabaseDialog}
        title={t('confirmations.resetDatabase')}
        description={t('confirmations.resetDatabaseDescription')}
        confirmLabel={t('common.reset')}
        variant="danger"
        onConfirm={handleResetDatabase}
      />

      <ConfirmDialog
        open={showSuccessDialog}
        onOpenChange={setShowSuccessDialog}
        title={successMessage.title}
        description={successMessage.description}
        confirmLabel={t('common.close')}
        showCancelButton={false}
        variant="success"
        onConfirm={() => setShowSuccessDialog(false)}
      />
    </div>
  );
}

function GitHubReposSection() {
  const [repos, setRepos] = useState<
    Array<{
      name: string;
      description: string | null;
      visibility: string;
      url: string;
      stargazer_count: number;
      languages: string[];
      topics: string[];
      readme: string;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ghUser, setGhUser] = useState<string | null>(null);
  const [ghConnected, setGhConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [showTokenInput, setShowTokenInput] = useState(false);

  const loadStatus = async () => {
    try {
      const { fetchGitHubStatus, fetchGitHubRepos } = await import('@/lib/api/mcp');
      const status = await fetchGitHubStatus();
      setGhConnected(status.authenticated);
      setGhUser(status.user);
      if (status.authenticated) {
        const res = await fetchGitHubRepos();
        setRepos(res.repos);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleConnectOAuth = async () => {
    setConnecting(true);
    setError(null);
    try {
      const { fetchGitHubAuthUrl } = await import('@/lib/api/mcp');
      const { url, error: authError } = await fetchGitHubAuthUrl();
      if (authError) {
        setError(authError);
        setShowTokenInput(true);
        setConnecting(false);
        return;
      }
      if (url) {
        window.location.href = url;
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start OAuth');
      setShowTokenInput(true);
      setConnecting(false);
    }
  };

  const handleConnectToken = async () => {
    if (!tokenInput.trim()) return;
    setConnecting(true);
    setError(null);
    try {
      const { githubCallback } = await import('@/lib/api/mcp');
      const result = await githubCallback(undefined, tokenInput.trim());
      if (result.authenticated) {
        setGhConnected(true);
        setGhUser(result.user || null);
        setShowTokenInput(false);
        const { fetchGitHubRepos } = await import('@/lib/api/mcp');
        const res = await fetchGitHubRepos();
        setRepos(res.repos);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid token');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      const { disconnectGitHub } = await import('@/lib/api/mcp');
      await disconnectGitHub();
      setGhConnected(false);
      setGhUser(null);
      setRepos([]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading GitHub status...
      </div>
    );
  }

  if (!ghConnected) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-ink-soft">
          Connect your GitHub account to view repositories and tailor resumes for open-source
          contributions.
        </p>
        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <p className="break-words">{error}</p>
          </div>
        )}
        <div className="flex gap-2">
          <Button
            onClick={handleConnectOAuth}
            disabled={connecting}
            className="rounded-full border border-[#24292f] bg-[#24292f] px-4 py-2 text-xs text-white shadow-sw-sm transition-colors hover:bg-[#1c2128]"
          >
            {connecting ? (
              <Loader2 className="w-3 h-3 animate-spin mr-2 inline" />
            ) : (
              <Github className="w-3 h-3 mr-2 inline" />
            )}
            Connect GitHub
          </Button>
          <Button
            onClick={() => setShowTokenInput(!showTokenInput)}
            variant="ghost"
            className="rounded-full px-4 py-2 text-xs"
          >
            Use Personal Access Token
          </Button>
        </div>
        {showTokenInput && (
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label className="text-xs">Personal Access Token</Label>
              <Input
                type="password"
                placeholder="ghp_xxxxxxxxxxxx"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                className="mt-1 rounded-xl"
              />
              <p className="text-[10px] text-ink-soft mt-1">
                Create at{' '}
                <a
                  href="https://github.com/settings/tokens/new?scopes=repo,user"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  github.com/settings/tokens
                </a>{' '}
                with <code>repo</code> + <code>user</code> scopes
              </p>
            </div>
            <Button
              onClick={handleConnectToken}
              disabled={connecting || !tokenInput.trim()}
              className="rounded-full px-4 py-2 text-xs"
            >
              Connect
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-xs">
            Connected as <strong>{ghUser}</strong>
          </span>
          <span className="text-xs text-ink-soft">· {repos.length} repositories</span>
        </div>
        <Button
          onClick={handleDisconnect}
          variant="ghost"
          className="rounded-full px-3 py-1 text-xs text-destructive"
        >
          Disconnect
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <p className="break-words">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 max-h-[500px] overflow-y-auto">
        {repos.map((repo, idx) => (
          <RepoCard key={repo.url} repo={repo} index={idx} />
        ))}
      </div>
    </div>
  );
}

function RepoCard({
  repo,
  index,
}: {
  repo: {
    name: string;
    description: string | null;
    visibility: string;
    url: string;
    stargazer_count: number;
    languages: string[];
    topics: string[];
    readme: string;
  };
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-2xl border border-[#e6e3dc] bg-white p-4 shadow-sw-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] text-ink-soft shrink-0">{index + 1}.</span>
          <a
            href={repo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-xs font-bold text-ink hover:underline"
          >
            {repo.name}
          </a>
        </div>
        <span
          className={`shrink-0 ml-2 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
            repo.visibility === 'PUBLIC'
              ? 'border-green-200 bg-green-50 text-green-600'
              : 'border-amber-200 bg-[#fbf6e9] text-amber-600'
          }`}
        >
          {repo.visibility}
        </span>
      </div>
      <p className="mt-2 text-xs text-ink-soft line-clamp-2">
        {repo.description || 'No description'}
      </p>
      <div className="flex flex-wrap gap-1 mt-2">
        {repo.languages.slice(0, 3).map((lang) => (
          <span
            key={lang}
            className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600"
          >
            {lang}
          </span>
        ))}
        {repo.topics.slice(0, 3).map((topic) => (
          <span
            key={topic}
            className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-600"
          >
            {topic}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2 text-[10px] text-ink-soft">
        {repo.stargazer_count > 0 && <span>⭐ {repo.stargazer_count}</span>}
        {repo.readme && (
          <button onClick={() => setExpanded(!expanded)} className="text-primary hover:underline">
            {expanded ? 'Hide README' : 'Show README'}
          </button>
        )}
      </div>
      {expanded && repo.readme && (
        <pre className="mt-2 max-h-40 overflow-y-auto overflow-x-auto whitespace-pre-wrap rounded-xl border border-[#e6e3dc] bg-secondary/30 p-3 text-[10px]">
          {repo.readme}
        </pre>
      )}
    </div>
  );
}
