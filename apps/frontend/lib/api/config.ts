import { apiFetch } from './client';

// Supported LLM providers
export type LLMProvider =
  | 'openai'
  | 'openai_compatible'
  | 'azure_foundry'
  | 'anthropic'
  | 'openrouter'
  | 'gemini'
  | 'deepseek'
  | 'groq'
  | 'huggingface'
  | 'ollama';

// Reasoning-effort levels supported by LiteLLM. `null` (or absent) means
// "do not send the parameter" — the default for max compatibility.
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  api_key: string;
  api_base: string | null;
  reasoning_effort: ReasoningEffort | null;
}

export interface LLMConfigUpdate {
  provider?: LLMProvider;
  model?: string;
  api_key?: string;
  api_base?: string | null;
  // Pass '' (empty string) to clear; null is ignored by the server.
  reasoning_effort?: ReasoningEffort | '' | null;
}

export interface DatabaseStats {
  total_resumes: number;
  total_jobs: number;
  total_improvements: number;
  has_master_resume: boolean;
}

export interface SystemStatus {
  status: 'ready' | 'setup_required';
  llm_configured: boolean;
  llm_healthy: boolean;
  has_master_resume: boolean;
  database_stats: DatabaseStats;
}

export interface LLMHealthCheck {
  healthy: boolean;
  provider: string;
  model: string;
  error?: string;
  error_code?: string;
  response_model?: string;
  warning?: string;
  warning_code?: string;
  test_prompt?: string;
  model_output?: string;
  reasoning_content?: string | null;
  error_detail?: string;
}

// Fetch full LLM configuration
export async function fetchLlmConfig(): Promise<LLMConfig> {
  const res = await apiFetch('/config/llm-api-key', { credentials: 'include' });

  if (!res.ok) {
    throw new Error(`Failed to load LLM config (status ${res.status}).`);
  }

  return res.json();
}

// Legacy function for backwards compatibility
export async function fetchLlmApiKey(): Promise<string> {
  const config = await fetchLlmConfig();
  return config.api_key ?? '';
}

// Fetch available models for a given provider
interface ProviderModelsResponse {
  provider: string;
  models: string[];
  free_models: string[];
}

const _modelsCache = new Map<string, ProviderModelsResponse>();
async function fetchProviderModelsResponse(provider: LLMProvider): Promise<ProviderModelsResponse> {
  const cached = _modelsCache.get(provider);
  if (cached) return cached;
  const res = await apiFetch(`/config/models/${provider}`, { credentials: 'include' });
  if (!res.ok) return { provider, models: [], free_models: [] };
  const data = (await res.json()) as ProviderModelsResponse;
  const models: string[] = data.models || [];
  _modelsCache.set(provider, { ...data, models });
  return data;
}

export async function fetchProviderModels(provider: LLMProvider): Promise<string[]> {
  const data = await fetchProviderModelsResponse(provider);
  return data.models || [];
}

// Models that are ungated / free-to-use for the provider (empty array if unknown)
export async function fetchProviderFreeModels(provider: LLMProvider): Promise<string[]> {
  const data = await fetchProviderModelsResponse(provider);
  return data.free_models || [];
}

// Update LLM configuration
export async function updateLlmConfig(config: LLMConfigUpdate): Promise<LLMConfig> {
  const res = await apiFetch('/config/llm-api-key', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(config),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to update LLM config (status ${res.status}).`);
  }

  return res.json();
}

// Legacy function for backwards compatibility
export async function updateLlmApiKey(value: string): Promise<string> {
  const config = await updateLlmConfig({ api_key: value });
  return config.api_key ?? '';
}

// Test LLM connection with optional config (for pre-save testing)
export async function testLlmConnection(config?: LLMConfigUpdate): Promise<LLMHealthCheck> {
  const options: RequestInit = {
    method: 'POST',
    credentials: 'include',
  };

  // If config provided, send it in the request body
  if (config) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(config);
  }

  const res = await apiFetch('/config/llm-test', options);

  if (!res.ok) {
    throw new Error(`Failed to test LLM connection (status ${res.status}).`);
  }

  return res.json();
}

// Fetch system status
export async function fetchSystemStatus(): Promise<SystemStatus> {
  const res = await apiFetch('/status', { credentials: 'include' });

  if (!res.ok) {
    throw new Error(`Failed to fetch system status (status ${res.status}).`);
  }

  return res.json();
}

// Provider display names and default models
export const PROVIDER_INFO: Record<
  LLMProvider,
  {
    name: string;
    defaultModel: string;
    requiresKey: boolean;
    requiresBaseUrl?: boolean;
    baseUrlLabel?: string;
    baseUrlPlaceholder?: string;
    baseUrlDescription?: string;
  }
> = {
  openai: { name: 'OpenAI', defaultModel: 'gpt-5-nano-2025-08-07', requiresKey: true },
  // OpenAI-compatible: llama.cpp, vLLM, LM Studio, and other servers that expose
  // the OpenAI Chat Completions API. Key is optional (most local servers don't
  // require auth); backend passes a sentinel when blank.
  openai_compatible: {
    name: 'OpenAI-Compatible (Local)',
    defaultModel: 'custom-model',
    requiresKey: false,
  },
  azure_foundry: {
    name: 'Azure AI Foundry',
    defaultModel: 'mistral-large-latest',
    requiresKey: true,
    requiresBaseUrl: true,
    baseUrlLabel: 'Azure AI Foundry endpoint',
    baseUrlPlaceholder: 'https://<resource>.services.ai.azure.com/openai/v1/responses',
    baseUrlDescription:
      'Paste the endpoint from Foundry. GPT deployments can use the service root or /openai/v1/responses; Azure AI Inference models can use the /models endpoint.',
  },
  anthropic: { name: 'Anthropic', defaultModel: 'claude-haiku-4-5-20251001', requiresKey: true },
  openrouter: {
    name: 'OpenRouter',
    defaultModel: 'deepseek/deepseek-chat',
    requiresKey: true,
  },
  gemini: { name: 'Google Gemini', defaultModel: 'gemini-2.0-flash-lite', requiresKey: true },
  deepseek: { name: 'DeepSeek', defaultModel: 'deepseek-chat', requiresKey: true },
  groq: { name: 'Groq', defaultModel: 'llama-3.3-70b-versatile', requiresKey: true },
  huggingface: {
    name: 'Hugging Face',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    requiresKey: true,
    requiresBaseUrl: false,
  },
  ollama: { name: 'Ollama (Local)', defaultModel: 'gemma3:4b', requiresKey: false },
};

// Models available per provider (for the dropdown)
export const PROVIDER_MODELS: Record<LLMProvider, string[]> = {
  openai: [
    'gpt-5-nano-2025-08-07',
    'gpt-5-mini-2025-08-07',
    'gpt-5-2025-08-07',
    'gpt-4o-2024-11-20',
    'gpt-4o-mini-2024-07-18',
    'gpt-4-turbo-2024-04-09',
    'o3-mini-2025-01-31',
    'o3-2025-04-16',
    'o4-mini-2025-04-16',
  ],
  openai_compatible: [],
  azure_foundry: [
    'gpt-4o-2024-11-20',
    'gpt-4o-mini-2024-07-18',
    'gpt-4-turbo-2024-04-09',
    'mistral-large-latest',
    'mistral-small-latest',
    'Phi-4',
    'DeepSeek-R1',
  ],
  anthropic: [
    'claude-sonnet-4-20250514',
    'claude-haiku-4-5-20251001',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
  ],
  openrouter: [
    'deepseek/deepseek-chat',
    'deepseek/deepseek-r1',
    'anthropic/claude-sonnet-4',
    'anthropic/claude-haiku-4-5',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'google/gemini-2.5-flash',
    'google/gemini-2.5-pro',
    'meta-llama/llama-3.3-70b-instruct',
    'qwen/qwen-2.5-72b-instruct',
  ],
  gemini: [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-3.1-pro-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
  ],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  groq: [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'llama-3.1-70b-versatile',
    'llama-3.2-90b-text-preview',
    'gemma2-9b-it',
    'mixtral-8x7b-32768',
    'qwen-qwq-32b',
  ],
  huggingface: [
    'meta-llama/Llama-3.3-70B-Instruct',
    'meta-llama/Llama-3.1-8B-Instruct',
    'meta-llama/Llama-3.2-3B-Instruct',
    'Qwen/Qwen2.5-72B-Instruct',
    'Qwen/Qwen2.5-32B-Instruct',
    'Qwen/Qwen2.5-14B-Instruct',
    'Qwen/Qwen2.5-7B-Instruct',
    'Qwen/QwQ-32B',
    'microsoft/Phi-4',
    'microsoft/Phi-3.5-mini-instruct',
    'mistralai/Mistral-7B-Instruct-v0.3',
    'mistralai/Mistral-7B-v0.3',
    'HuggingFaceH4/zephyr-7b-beta',
    'allenai/OLMo-2-7B-free',
    'allenai/Llama-3.1-Tulu-3-8B',
    'deepseek-ai/DeepSeek-R1',
    'google/gemma-2-27b-it',
    'CohereForAI/c4ai-command-r-plus',
  ],
  ollama: [
    'gemma3:4b',
    'gemma3:12b',
    'gemma3:27b',
    'llama3.3:8b',
    'llama3.3:70b',
    'llama3.2:3b',
    'llama3.1:8b',
    'llama3.1:70b',
    'qwen3:8b',
    'qwen3:32b',
    'mistral:7b',
    'deepseek-r1:8b',
    'deepseek-r1:32b',
    'phi4:14b',
    'codellama:13b',
  ],
};

// Feature configuration types
export interface FeatureConfig {
  enable_cover_letter: boolean;
  enable_outreach_message: boolean;
  enable_interview_prep: boolean;
}

export interface FeatureConfigUpdate {
  enable_cover_letter?: boolean;
  enable_outreach_message?: boolean;
  enable_interview_prep?: boolean;
}

// Fetch feature configuration
export async function fetchFeatureConfig(): Promise<FeatureConfig> {
  const res = await apiFetch('/config/features', { credentials: 'include' });

  if (!res.ok) {
    throw new Error(`Failed to load feature config (status ${res.status}).`);
  }

  return res.json();
}

// Update feature configuration
export async function updateFeatureConfig(config: FeatureConfigUpdate): Promise<FeatureConfig> {
  const res = await apiFetch('/config/features', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(config),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to update feature config (status ${res.status}).`);
  }

  return res.json();
}

// Language configuration types
export type SupportedLanguage = 'en' | 'es' | 'zh' | 'ja' | 'pt' | 'fr' | 'ko';

export interface LanguageConfig {
  ui_language: SupportedLanguage;
  content_language: SupportedLanguage;
  supported_languages: SupportedLanguage[];
}

export interface LanguageConfigUpdate {
  ui_language?: SupportedLanguage;
  content_language?: SupportedLanguage;
}

// Fetch language configuration
export async function fetchLanguageConfig(): Promise<LanguageConfig> {
  const res = await apiFetch('/config/language', { credentials: 'include' });

  if (!res.ok) {
    throw new Error(`Failed to load language config (status ${res.status}).`);
  }

  return res.json();
}

// Update language configuration
export async function updateLanguageConfig(update: LanguageConfigUpdate): Promise<LanguageConfig> {
  const res = await apiFetch('/config/language', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(update),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to update language config (status ${res.status}).`);
  }

  return res.json();
}

export interface PromptOption {
  id: string;
  label: string;
  description: string;
}

export interface PromptConfig {
  default_prompt_id: string;
  prompt_options: PromptOption[];
}

export interface PromptConfigUpdate {
  default_prompt_id?: string;
}

// Fetch prompt configuration
export async function fetchPromptConfig(): Promise<PromptConfig> {
  const res = await apiFetch('/config/prompts', { credentials: 'include' });

  if (!res.ok) {
    throw new Error(`Failed to load prompt config (status ${res.status}).`);
  }

  return res.json();
}

// Update prompt configuration
export async function updatePromptConfig(update: PromptConfigUpdate): Promise<PromptConfig> {
  const res = await apiFetch('/config/prompts', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(update),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to update prompt config (status ${res.status}).`);
  }

  return res.json();
}

// Custom feature prompts (cover letter, cold outreach)
export interface FeaturePrompts {
  cover_letter_prompt: string;
  outreach_message_prompt: string;
  outreach_email_prompt: string;
  cover_letter_default: string;
  outreach_message_default: string;
  outreach_email_default: string;
}

export interface FeaturePromptsUpdate {
  cover_letter_prompt?: string;
  outreach_message_prompt?: string;
  outreach_email_prompt?: string;
}

// 422 response shape when the user submits a prompt missing required
// placeholders. The backend lists each missing token so the UI can point
// users at exactly what's absent.
export interface FeaturePromptsValidationError {
  code: 'missing_placeholders';
  field: 'cover_letter_prompt' | 'outreach_message_prompt' | 'outreach_email_prompt';
  missing: string[];
}

export class FeaturePromptsError extends Error {
  detail: FeaturePromptsValidationError;

  constructor(detail: FeaturePromptsValidationError) {
    super(`Invalid ${detail.field}: missing ${detail.missing.join(', ')}`);
    this.name = 'FeaturePromptsError';
    this.detail = detail;
  }
}

export async function fetchFeaturePrompts(): Promise<FeaturePrompts> {
  const res = await apiFetch('/config/feature-prompts', { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`Failed to load feature prompts (status ${res.status}).`);
  }
  return res.json();
}

export async function updateFeaturePrompts(update: FeaturePromptsUpdate): Promise<FeaturePrompts> {
  const res = await apiFetch('/config/feature-prompts', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(update),
  });

  if (!res.ok) {
    // Error path: body may be absent or malformed, so we tolerate parse
    // failure. A fetch body is a one-shot stream — read it once and reuse
    // for both the 422-special-case and the generic fallback.
    const errBody = (await res.json().catch(() => ({}))) as {
      detail?: FeaturePromptsValidationError | string;
    };
    if (
      res.status === 422 &&
      typeof errBody.detail === 'object' &&
      errBody.detail?.code === 'missing_placeholders'
    ) {
      throw new FeaturePromptsError(errBody.detail);
    }
    // FastAPI can return ``detail`` as a string or a structured object.
    // Stringifying an object via the ``||`` shortcut yields "[object Object]";
    // serialize explicitly.
    let message: string;
    if (typeof errBody.detail === 'string') {
      message = errBody.detail;
    } else if (errBody.detail) {
      message = JSON.stringify(errBody.detail);
    } else {
      message = `Failed to update feature prompts (status ${res.status}).`;
    }
    throw new Error(message);
  }

  // Success path: require a valid JSON body. Swallowing parse errors here
  // would let an invalid success response be returned as FeaturePrompts
  // with undefined fields — caller code would then read .cover_letter_prompt
  // and get surprising behavior. Let the parse error propagate.
  return (await res.json()) as FeaturePrompts;
}

// API Key Management types
export type ApiKeyProvider =
  | 'openai'
  | 'azure_foundry'
  | 'anthropic'
  | 'google'
  | 'openrouter'
  | 'deepseek'
  | 'groq'
  | 'huggingface'
  | 'openai_compatible'
  | 'ollama';

// Map an LLM provider (the active-provider axis) to its key-store provider
// name. Mirrors the backend `_PROVIDER_KEY_MAP` (gemini → google; the local
// providers pass through). Keys are persisted under the key-store name.
export function llmProviderToKeyProvider(provider: LLMProvider): ApiKeyProvider {
  if (provider === 'gemini') return 'google';
  if (provider === 'huggingface') return 'huggingface';
  return provider as ApiKeyProvider;
}

export interface ApiKeyProviderStatus {
  provider: ApiKeyProvider;
  configured: boolean;
  masked_key: string | null;
}

export interface ApiKeyStatusResponse {
  providers: ApiKeyProviderStatus[];
}

export interface ApiKeysUpdateRequest {
  openai?: string;
  azure_foundry?: string;
  anthropic?: string;
  google?: string;
  openrouter?: string;
  deepseek?: string;
  groq?: string;
  huggingface?: string;
  openai_compatible?: string;
  ollama?: string;
}

export interface ApiKeysUpdateResponse {
  message: string;
  updated_providers: string[];
}

// Provider display names for API keys
export const API_KEY_PROVIDER_INFO: Record<ApiKeyProvider, { name: string; description: string }> =
  {
    openai: { name: 'OpenAI', description: 'GPT-4, GPT-4o, etc.' },
    azure_foundry: { name: 'Azure AI Foundry', description: 'Azure AI Inference models' },
    anthropic: { name: 'Anthropic', description: 'Claude 3.5, Claude 4, etc.' },
    google: { name: 'Google', description: 'Gemini 1.5, Gemini 2, etc.' },
    openrouter: { name: 'OpenRouter', description: 'Access multiple providers' },
    deepseek: { name: 'DeepSeek', description: 'DeepSeek chat models' },
    groq: { name: 'Groq', description: 'Llama, Mixtral, Gemma on Groq' },
    huggingface: { name: 'Hugging Face', description: 'Open-source models via Inference API' },
    openai_compatible: { name: 'OpenAI-Compatible', description: 'Self-hosted / proxy endpoints' },
    ollama: { name: 'Ollama', description: 'Local Ollama server' },
  };

// Fetch API key status for all providers
export async function fetchApiKeyStatus(): Promise<ApiKeyStatusResponse> {
  const res = await apiFetch('/config/api-keys', { credentials: 'include' });

  if (!res.ok) {
    throw new Error(`Failed to load API key status (status ${res.status}).`);
  }

  return res.json();
}

// Update API keys for one or more providers
export async function updateApiKeys(keys: ApiKeysUpdateRequest): Promise<ApiKeysUpdateResponse> {
  const res = await apiFetch('/config/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(keys),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to update API keys (status ${res.status}).`);
  }

  return res.json();
}

// Delete API key for a specific provider
export async function deleteApiKey(provider: ApiKeyProvider): Promise<void> {
  const res = await apiFetch(`/config/api-keys/${provider}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to delete API key (status ${res.status}).`);
  }
}

// Clear all API keys
export async function clearAllApiKeys(): Promise<void> {
  const res = await apiFetch('/config/api-keys?confirm=CLEAR_ALL_KEYS', {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to clear API keys (status ${res.status}).`);
  }
}

// Reset database
export async function resetDatabase(): Promise<void> {
  const res = await apiFetch('/config/reset', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'RESET_ALL_DATA' }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to reset database (status ${res.status}).`);
  }
}
