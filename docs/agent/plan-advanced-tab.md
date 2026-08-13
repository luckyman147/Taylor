# Plan: Advanced tab — 6 collapsible sections

## Decisions (locked)
- Keep old controls (Base/HeaderSize, Heights & Paddings) — new ones added alongside
- Text weights: `light | regular | bold | extralight` (300/400/700/200)
- Borders: toggle + thickness pt (width 0 = hidden; colors stay per-template)
- List separator applies to **education** + **skills** joins only
- Transform defaults preserve current look (section titles UPPERCASE, others as-written)
- i18n: all 7 locales (en, es, fr, ja, ko, pt-BR, zh) with real translations

## 1. Types — `apps/frontend/lib/types/template-settings.ts`
```ts
type BulletMarker = '*' | '-' | '>>' | '->';
type ListSeparator = '*' | '-' | ',' | '|';
type TextWeightOption = 'light' | 'regular' | 'bold' | 'extralight';
type TextTransformOption = 'uppercase' | 'as-written' | 'capitalize';
type TextStyleTarget = 'bodyCopy' | 'primaryHeading' | 'secondaryHeading' | 'sectionTitle' | 'fullName' | 'minorCopy';

interface AdvancedSettings {
  bulletMarker: BulletMarker;
  listSeparator: ListSeparator;
  textSizes: Record<TextStyleTarget, number>;        // pt
  textWeights: Record<TextStyleTarget, TextWeightOption>;
  textTransforms: Record<TextStyleTarget, TextTransformOption>;
  verticalSpacing: {                                 // pt
    betweenSections: number; titlesContent: number; primarySecondaryHeadings: number;
    contentBlocks: number; listItems: number;
  };
  borders: {                                         // { enabled, thickness(pt) }
    aboveHeader: BorderSetting; belowHeader: BorderSetting; sectionTitles: BorderSetting;
  };
}
```
- Add `advanced` to `TemplateSettings` + `DEFAULT_TEMPLATE_SETTINGS` + deep-merge in `normalizeTemplateSettings`
- Defaults = current look: body 10.5pt, fullName 21pt/700, primaryHeading 12pt, secondaryHeading 10.5pt/700, sectionTitle 12.5pt/700/uppercase, minorCopy 8pt; spacing betweenSections 12pt, titlesContent 4pt, primarySecondary 3pt, contentBlocks 4pt, listItems 2pt; borders enabled + thickness 1pt above/below header, 1pt sectionTitles; marker `•`, separator `,`

## 2. CSS vars — `settingsToCssVars()` same file
- `--bullet-marker`, `--list-separator` (raw)
- `--size-{full-name|primary-heading|secondary-heading|section-title|body-copy|minor-copy}` (pt)
- `--weight-{target}` (numeric), `--transform-{target}` (uppercase|none|capitalize)
- `--vspace-{between-sections|titles-content|primary-secondary|content-blocks|list-items}` (pt)
- `--border-{above-header|below-header|section-titles}-w` (pt, `0` when toggled off)

## 3. Rendering — `styles/_base.module.css` + 7 template modules
- Swap `calc(var(--font-size-base) * X)` → named vars:
  - `.resume-name` → size/weight/transform full-name
  - `.resume-title` → primary-heading; `.resume-item-title/.subtitle` → secondary-heading
  - `.resume-section-title(-sm)`, modern `section-title-accent(-sm)`, vivid/clean/latex titles → section-title
  - body/text-sm/text-xs/meta/pills → body-copy / minor-copy
- Gaps: `.resume-section` margin → `--vspace-between-sections`; section-title margin-bottom → `--vspace-titles-content`; `.resume-items`/stack → `--vspace-content-blocks`; `.resume-list`/rows → `--vspace-list-items`; header inner + title→subtitle → `--vspace-primary-secondary`
- Borders: only `border-*-width` reads `--border-*-w`; add to `.resume-header` (above+below) and all section-title classes (color/style per-template unchanged)

## 4. Marker & separator
- `DescriptionList` (description-list.tsx:20): marker via CSS `::before { content: var(--bullet-marker) }` — no prop threading; remove vivid's hardcoded `➜` (keep its arrow class)
- `listSeparator` prop: resume-component → 7 templates → `resume-skills.tsx` joins + education row joins; languages/awards/custom-stringList unchanged

## 5. UI — `apps/frontend/components/builder/formatting-controls.tsx` Advanced tab
6 CollapsibleGroups (existing Options subheading moves into group 1):
1. Advanced Styles — marker picker (`* - >> ->`), separator picker (`* - , |`), Options (compact mode, contact icons)
2. Text Sizes — 6 pt steppers
3. Text Weights — 6 segmented (light/regular/bold/extralight)
4. Text Transformations — 6 segmented (all caps / as written / title caps)
5. Vertical Spacing — 5 pt steppers
6. Borders — 3 × toggle + pt stepper
Keep existing Text Sizes group (Base/HeaderSize + effective output) untouched.

## 6. PDF chain (+25 params)
- `lib/api/resume.ts` `getResumePdfUrl` (line 227): +25 `params.set(...)`
- `apps/backend/app/routers/resumes.py` `download_resume_pdf` (line 1613): 25 new `Query` params with regex `pattern`s, docstring, print-URL `params` f-string
- `apps/frontend/app/print/resumes/[id]/page.tsx`: extend searchParams type, parse via `parseEnum`/`parseBoolean`/new `parsePt`
- Update `docs/agent/apis/front-end-apis.md`

## 7. i18n — `apps/frontend/messages/{en,es,fr,ja,ko,pt-BR,zh}.json`
Keys: `builder.designGroups.{textWeights,textTransformations,verticalSpacing,borders}`, `builder.formatting.advanced.*` (6 element names, 5 spacing rows, 3 border rows, marker/separator/weight/transform option labels). Parity test guards all 7.

## 8. Verification
- `npm run lint` + `tsc --noEmit` + `npm test` (apps/frontend)
- `uv run pytest` (apps/backend)
- Visual: all 7 templates at defaults render identical to today