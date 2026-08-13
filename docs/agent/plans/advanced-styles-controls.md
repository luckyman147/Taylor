# Advanced Styles Controls — Implementation Plan

**Status:** In progress — Phase 1–2 done, Phase 3–6 remaining
**Scope:** Frontend builder (Advanced tab) + rendering + PDF export chain + i18n

## Goal

Add an "Advanced" section nav with 6 collapsible groups to the resume builder:

1. **Advanced Styles** — bullet markers (`*`, `-`, `>>`, `->`) and list separators (`*`, `-`, `,`, `|`)
2. **Text Sizes** (pt) — Body Copy, Primary Heading, Secondary Heading, Section Titles, Full Name, Minor Copy
3. **Text Weights** — same 6 targets (light / regular / bold / extralight)
4. **Text Transformations** — same 6 targets (all caps / as written / title caps)
5. **Vertical Spacing** (pt) — Between Sections, Titles & Content, Primary & Secondary Headings, Content Blocks, List Items
6. **Borders** — Above Header, Below Header, Section Titles (toggle + thickness pt)

Existing "Options" (compact mode, contact icons) stay inside group 1.

## Locked Decisions

- Old controls (Base/Headers size selectors, Heights & Paddings steppers) stay untouched; new controls are additive.
- Text weights include **Regular (400)** in addition to light (300), bold (700), extralight (200).
- Borders use **toggle + thickness (pt)** model; toggled off = width 0.
- List separator applies to **education and skills** joins only.
- Transformation defaults **preserve the current look** (section titles uppercase; everything else as written).
- i18n: translated in **all 7 locale files** (en, es, fr, ja, ko, pt-BR, zh).

## Progress

| # | Phase | Status |
|---|---|---|
| 1 | Types & defaults + CSS-var emission | ✅ Done |
| 2 | Rendering — `_base.module.css` + 7 template modules | ✅ Done |
| 3 | Bullet marker & list separator plumbing | ⬜ Remaining |
| 4 | UI — Advanced tab groups 3–6 (Weights, Transforms, Spacing, Borders) | ⬜ Partial (groups 1–2 done) |
| 5 | PDF export chain (+25 params) | ⬜ Remaining |
| 6 | i18n — 7 locales | ⬜ Partial (only group titles 1–2) |
| 7 | Verification | ⬜ Remaining |

---

## 1. Types & defaults — `apps/frontend/lib/types/template-settings.ts` ✅ DONE

Implemented:

- `BulletMarker`, `ListSeparator`, `TextWeightOption`, `TextTransformOption`, `TextStyleTarget`, `BorderSetting`, `AdvancedSettings` (line 98)
- `DEFAULT_ADVANCED_SETTINGS` (line 136): sizes 21/12/10.5/12.5/10.5/8pt; weights 700,400,700,700,400,400; transforms section-title `uppercase`, others `none`; spacing 12/3/3/3/2pt; borders above/below header disabled(`0`), section titles 1pt; marker `•`, separator `,`
- `TemplateSettings.advanced` + deep-merge in `normalizeTemplateSettings` (lines 239–269)
- `settingsToCssVars()` emits all vars (lines 405–470): `--size-*`, `--weight-*`, `--transform-*`, `--vspace-*`, `--border-*-w`

## 2. Rendering — CSS modules ✅ DONE

`_base.module.css` defines defaults at lines 14–47 and consumes them everywhere; all 7 template modules already reference the vars:

- Sizes/weights/transforms: `--size-full-name|primary-heading|secondary-heading|section-title|body-copy|minor-copy`, weights `200/300/400/700` via `TEXT_WEIGHT_MAP`, transforms `uppercase|none|capitalize`
- Spacing: `--vspace-{between-sections|titles-content|primary-secondary|content-blocks|list-items}`
- Borders: `--border-{above-header|below-header|section-titles}-w`; per-template color/style kept (e.g. `border-bottom: var(--border-section-titles-w) solid var(--resume-accent-primary)` in modern/latex)

Note: base defaults use `--border-above-header-w: 0` / `--border-below-header-w: 0` — templates that had a header rule today may need a per-template default if previous look had one.

## 3. Bullet marker & separator threading ⬜ REMAINING

- **Marker:** replace `DescriptionList`'s literal marker text (`description-list.tsx:20–35`, render at line 32–36 — currently a prop string `marker = '•'` inside a `<span>`) with CSS `content: var(--bullet-marker)` on the marker span. Emit `--bullet-marker` in `settingsToCssVars()` (add to types phase output — not yet emitted).
- Remove vivid's hardcoded `marker="➜"` (resume-vivid.tsx:156); keep its `styles.arrow` class for color.
- **Separator:** thread prop `listSeparator: ListSeparator` from `resume-component.tsx` → 7 templates →
  - skills joins in `resume-skills.tsx` (all layouts: comma/columns/line joins)
  - education entry row inline joins (dates/location/degree/institution)
- Languages/awards/certifications joins keep current behavior.
- Emit `--list-separator` raw var.

## 4. UI — `formatting-controls.tsx` Advanced tab ⬜ PARTIAL

Done: nav tab `advanced` (line 460), group 1 **Advanced Styles** with `Options` subheading moved inside (lines 752–767), group 2 **Text Sizes** (line 770).

Remaining — add 4 `CollapsibleGroup`s reusing the pt-stepper pattern (like `SpacingStepper`):

3. **Text Weights** — 6 segmented pickers (light / regular / bold / extralight) per target
4. **Text Transformations** — 6 segmented pickers (all caps / as written / title caps)
5. **Vertical Spacing** — 5 pt steppers (Between Sections, Titles & Content, Primary & Secondary Headings, Content Blocks, List Items)
6. **Borders** — 3 rows, each toggle switch + pt thickness stepper (Above Header, Below Header, Section Titles)

Handlers mirror existing `handle*Change` patterns; partial updates passed through `normalizeTemplateSettings` for safe defaults. Keep old Text Sizes / Controls groups untouched.

## 5. PDF export chain (settings parity) ⬜ REMAINING

- `apps/frontend/lib/api/resume.ts` — `getResumePdfUrl` (line 227): +25 `params.set(...)` entries after line 263 for all advanced settings.
- `apps/backend/app/routers/resumes.py` — `download_resume_pdf` (line 1613): 25 new `Query` params with regex `pattern`s (`^(\*|-|>>|->)$`, `^(light|regular|bold|extralight)$`, `^(all-caps|as-written|title-caps)$`, pt numbers with `ge`/`le` limits), docstring lines, and forwarding in the `params` f-string.
- `apps/frontend/app/print/resumes/[id]/page.tsx`: extend `searchParams` type; parse all 25 into `settings.advanced` via existing `parseEnum`/`parseBoolean` + new `parsePt` helper (clamped). `padding`/spacing defaults unchanged.
- Update `docs/agent/apis/front-end-apis.md` to document the new query params.

## 6. i18n — `apps/frontend/messages/{en,es,fr,ja,ko,pt-BR,zh}.json` ⬜ PARTIAL

Done: `builder.designGroups.advancedStyles` + `builder.designGroups.textSizes` in all 7 locales (line ~540).

Remaining keys:

- `builder.designGroups.{textWeights,textTransformations,verticalSpacing,borders}`
- `builder.formatting.advanced.*` — 6 element names (Body Copy, Primary Heading, Secondary Heading, Section Titles, Full Name, Minor Copy), 5 spacing rows, 3 border rows, marker/separator/weight/transform option labels

All 7 locales get real translations; `tests/i18n-locale-parity.test.ts` enforces parity (`type Messages = typeof en` — every locale must match en.json structurally).

## 7. Verification

1. `npm run lint` (apps/frontend)
2. `npx tsc --noEmit` (apps/frontend)
3. `npm test` (vitest — includes locale parity, template tests, API tests)
4. `cd apps/backend && uv run pytest`
5. Visual spot-check: all 7 templates with **default** settings render identical to today (defaults computed from current pixel metrics).
6. Spot-check each control changes the live preview and matches the exported PDF.

## Files touched

- `apps/frontend/lib/types/template-settings.ts` ✅
- `apps/frontend/components/resume/description-list.tsx` ⬜
- `apps/frontend/components/resume/resume-skills.tsx` ⬜
- `apps/frontend/components/dashboard/resume-component.tsx` (props) ⬜
- 7 template components (`resume-{single-column,two-column,modern,modern-two-column,latex,clean,vivid}.tsx`) + `dynamic-resume-section.tsx` ⬜
- 8 CSS modules (`_base.module.css` + 7 template modules) ✅
- `apps/frontend/components/builder/formatting-controls.tsx` ⬜ (groups 1–2 done)
- `apps/frontend/lib/api/resume.ts` ⬜
- `apps/backend/app/routers/resumes.py` ⬜
- `apps/frontend/app/print/resumes/[id]/page.tsx` ⬜
- 7 locale files under `apps/frontend/messages/` ⬜ (2 keys done per file)
- `docs/agent/apis/front-end-apis.md` ⬜