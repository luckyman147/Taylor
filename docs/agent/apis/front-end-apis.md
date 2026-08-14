# Frontend API Client

> API client layer for Resume Matcher frontend.

## Base Client (`lib/api/client.ts`)

```typescript
export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
export const API_BASE = `${API_URL}/api/v1`;

export async function apiFetch(endpoint: string, options?: RequestInit);
export async function apiPost<T>(endpoint: string, body: T);
export async function apiPatch<T>(endpoint: string, body: T);
export async function apiPut<T>(endpoint: string, body: T);
export async function apiDelete(endpoint: string);
export function getUploadUrl(): string;
```

## Resume Operations (`lib/api/resume.ts`)

```typescript
// Job descriptions
uploadJobDescriptions(descriptions: string[], resumeId: string) → job_id

// Resume improvement
improveResume(resumeId: string, jobId: string) → ImprovedResult

// CRUD
fetchResume(resumeId: string) → ResumeResponse['data']
fetchResumeList(includeMaster?: boolean) → ResumeListItem[]
updateResume(resumeId: string, data: ResumeData) → ResumeResponse['data']
deleteResume(resumeId: string) → void

// PDF
downloadResumePdf(resumeId: string, settings?: TemplateSettings) → Blob
downloadCoverLetterPdf(resumeId: string, pageSize?: string) → Blob

// Content updates
updateCoverLetter(resumeId: string, content: string) → void
updateOutreachMessage(resumeId: string, content: string) → void

// On-demand generated content
generateInterviewPrep(resumeId: string) → InterviewPrepData
```

`getResumePdfUrl` (used by `downloadResumePdf`) forwards the full
`TemplateSettings` as query params to `GET /api/v1/resumes/{id}/pdf`, including
the `advanced` block (`settingsToCssVars` parity):

- `bulletMarker` (`•|*|-|>>|->`), `listSeparator` (`*|-|,|\|`)
- `sizeFullName|PrimaryHeading|SecondaryHeading|SectionTitle|BodyCopy|MinorCopy` (pt)
- `weightFullName|PrimaryHeading|SecondaryHeading|SectionTitle|BodyCopy|MinorCopy`
  (`light|regular|bold|extralight`)
- `transformFullName|PrimaryHeading|SecondaryHeading|SectionTitle|BodyCopy|MinorCopy`
  (`uppercase|as-written|capitalize`)
- `vspaceBetweenSections|TitlesContent|PrimarySecondary|ContentBlocks|ListItems` (pt)
- `borderAboveHeader|BelowHeader|SectionTitles` (pt; `0` = hidden)

The print page (`app/print/resumes/[id]/page.tsx`) parses all of them back into
`settings.advanced` via `parseEnum`/`parsePt`-style helpers.

## Resume Wizard (`lib/api/resume-wizard.ts`)

```typescript
postResumeWizardTurn(payload: ResumeWizardTurnRequest) → ResumeWizardTurnResponse
finalizeResumeWizard(state: ResumeWizardState) → ResumeWizardFinalizeResponse
createInitialResumeWizardState() → ResumeWizardState
```

Backend endpoints:

- `POST /api/v1/resume-wizard/turn` — one adaptive turn. `action` is `start | answer | skip | back | review`. `answer`/`skip` run one AI call that updates `resume_data`, returns the next `current_question`, `inferred_skills`, and an `is_complete` flag; `back`/`review`/`start` are deterministic (no LLM). The full `ResumeWizardState` round-trips in the request and response.
- `POST /api/v1/resume-wizard/finalize` — creates the single master resume from the draft (`processing_status: "ready"`), or `409` if a master already exists.

The wizard is an AI-led, one-question-at-a-time flow that builds a general master resume; it does not require a job description and does not replace the upload parser. Question and content text are produced in the configured **content language**; static UI chrome uses the `resumeWizard.*` i18n keys.

## Application Tracker (`lib/api/tracker.ts`)

```typescript
// Kanban board (7 status columns: saved | applied | no_response |
// response | interview | accepted | rejected)
listApplications() → ApplicationListResponse        // { columns: Record<status, Application[]> }
createApplication(payload: ManualApplicationCreate) → Application   // manual add from a pasted JD
getApplicationDetail(id: string) → ApplicationDetail               // embedded JD + applied resume (resume null if deleted)
updateApplication(id: string, payload: ApplicationUpdate) → Application   // status/position/notes/company/role/applied_at/rejection_reason/interview_rounds

// Bulk
bulkUpdateStatus(applicationIds: string[], status: ApplicationStatus) → ApplicationActionResponse
deleteApplication(id: string) → void
bulkDeleteApplications(applicationIds: string[]) → ApplicationActionResponse
```

## Career Profile (`lib/api/profile.ts`)

```typescript
// My Profile page: career memory, skill ROI and the AI career advisor
getProfile() → ProfileBundle                // { profile, skills, certifications } (auto-creates)
updateProfile(payload: ProfileUpdate) → CareerProfile       // PUT upsert; comma-joined list fields client-side
seedProfileFromMaster() → CareerProfile     // copies name/title/contact from the master resume personalInfo

// Skills (case-insensitive name dedupe server-side → 409)
createSkill(payload: SkillCreate) → CareerSkill             // 201
updateSkill(id: string, payload: SkillUpdate) → CareerSkill // 409 on duplicate rename
deleteSkill(id: string) → void

// Certifications
createCertification(payload: CertificationCreate) → CareerCertification   // 201
updateCertification(id: string, payload: CertificationUpdate) → CareerCertification
deleteCertification(id: string) → void

// Career LLM (needs an LLM key configured; /ask → 503 otherwise)
getCareerMemory() → CareerMemory            // aggregated bundle (debug/reuse)
askCareerQuestion({ question, history }) → CareerAskResponse  // history ≤ 8 turns; Markdown answer
getCareerInsights() → CareerInsightsResponse  // { stats: FunnelStats, narrative: string|null }
getSkillRoi({ skills?, include_advice? }) → CareerRoiResponse // deterministic table + optional LLM advice
```

> Skills and certifications validate `YYYY` / `YYYY-MM` for `last_used`/`date_obtained` (422) and salaries 0–9,999,999. The ROI table is computed locally from saved scraped jobs; `advice`/`narrative` are `null` when no LLM key is configured.

## Company Tracker (`lib/api/companies.ts`)

```typescript
// Standalone company CRM (name/email/phone/address/website/size/type/linkedin/industry/founded)
listCompanies() → CompanyListResponse                  // { companies: Company[] } ordered by name
createCompany(payload: CompanyCreate) → Company        // dedupes (case-insensitive) on name server-side
getCompany(id: string) → Company
updateCompany(id: string, payload: CompanyUpdate) → Company   // partial; 409 on duplicate rename
deleteCompany(id: string) → void

// Bulk CSV / Excel (.xlsx) upload with optional column mapping
getImportHeaders(file) → CompanyImportHeaders          // { headers, detected: {field: header} }
importCompanies(file, mapping?) → CompanyImportResponse
// mapping: {field: exact column header}; only mapped fields are imported;
// without it the server auto-detects columns via aliases
// CSV export is client-side via lib/utils/csv.ts (downloadCsv with BOM + RFC 4180 escaping)
```

> Enums are stable keys, decoupled from i18n labels: `company_size` ∈ `1-10 | 11-50 | 51-200 | 201-1000 | 1000+`; `company_type` ∈ `startup | agency | enterprise | nonprofit | education | government | other`.

## Config Operations (`lib/api/config.ts`)

```typescript
fetchLlmConfig() → LLMConfig
updateLlmConfig(config: LLMConfigUpdate) → LLMConfig
testLlmConnection() → LLMHealthCheck
fetchSystemStatus() → SystemStatus

// Per-provider API keys (encrypted server-side; switching the active
// provider no longer wipes another provider's key — responses always masked)
fetchApiKeyStatus() → ApiKeyStatusResponse           // { providers: [{ provider, configured, masked_key }] }
updateApiKeys(keys: ApiKeysUpdateRequest) → ApiKeysUpdateResponse
deleteApiKey(provider: ApiKeyProvider) → void
clearAllApiKeys() → void

// Feature flags
fetchFeatureConfig() → FeatureConfig
updateFeatureConfig(config: FeatureConfigUpdate) → FeatureConfig

// Language
fetchLanguageConfig() → LanguageConfig
updateLanguageConfig(language: string) → LanguageConfig
```

> `updateLlmApiKey` (`PUT /config/llm-api-key`) no longer persists a key — keys are managed per-provider via the encrypted `/config/api-keys` endpoints above.

## Provider Info

```typescript
export const PROVIDER_INFO = {
  openai: { name: 'OpenAI', defaultModel: 'gpt-5-nano-2025-08-07', requiresKey: true },
  anthropic: { name: 'Anthropic', defaultModel: 'claude-haiku-4-5-20251001', requiresKey: true },
  openrouter: { name: 'OpenRouter', defaultModel: 'deepseek/deepseek-chat', requiresKey: true },
  gemini: { name: 'Google Gemini', defaultModel: 'gemini-3-flash-preview', requiresKey: true },
  deepseek: { name: 'DeepSeek', defaultModel: 'deepseek-chat', requiresKey: true },
  ollama: { name: 'Ollama (Local)', defaultModel: 'gemma3:4b', requiresKey: false },
};
```

## Usage

```typescript
import { fetchResume, API_BASE, PROVIDER_INFO } from '@/lib/api';
```
