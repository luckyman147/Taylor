/**
 * Deterministic job deduplication — mirrors the TAYLOR mobile engine (no AI).
 *
 * Tier 1: canonical URL match.
 * Tier 2: SHA-256 fingerprint of `company | title | location`.
 * Tier 3: Jaccard token similarity against a candidate pool built from
 *         company and title-token indexes — never a full scan.
 */

export interface KnownJob {
  url?: string | null;
  web_url?: string | null;
  title?: string | null;
  company?: string | null;
  location?: string | null;
}

export type DupKind = 'new' | 'dup_url' | 'dup_fingerprint' | 'similar';

export interface ClassifiedJob {
  job: KnownJob;
  kind: DupKind;
  matched?: KnownJob;
  score: number;
}

export const SIMILARITY_THRESHOLD = 0.7;

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'ref',
  'ref_src',
  'ref_url',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'trk',
  'spm',
]);

/** Strip tracking params and normalize scheme/host/trailing slash. */
export function canonicalUrl(raw: string | null | undefined): string {
  if (!raw) return '';
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return raw.trim().toLowerCase();
  }
  url.searchParams.forEach((_v, key) => {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  });
  url.hash = '';
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const query = url.searchParams.toString();
  return `${url.protocol}//${url.host.toLowerCase()}${path}${query ? `?${query}` : ''}`;
}

/** Lowercase, collapse whitespace, drop punctuation noise. */
export function normalizeField(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(value: string | null | undefined): string[] {
  return normalizeField(value).split(' ').filter(Boolean);
}

/** Hex SHA-256 of `normalize(company) | normalize(title) | normalize(location)`. */
export async function fingerprint(
  company: string | null | undefined,
  title: string | null | undefined,
  location: string | null | undefined
): Promise<string> {
  const payload = [normalizeField(company), normalizeField(title), normalizeField(location)].join(
    '|'
  );
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const intersection = a.filter((t) => setB.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Index over known jobs for candidate-limited duplicate checks.
 * Build once per result set; never scans the whole pool per job.
 */
export class DedupIndex {
  private readonly byUrl = new Map<string, KnownJob>();
  private readonly byFingerprint = new Map<string, KnownJob>();
  private readonly byCompany = new Map<string, KnownJob[]>();
  private readonly byTitleToken = new Map<string, KnownJob[]>();

  constructor(
    private readonly jobs: KnownJob[],
    fingerprints: Map<string, string>
  ) {
    for (const job of jobs) {
      const url = canonicalUrl(job.url) || canonicalUrl(job.web_url);
      if (url) this.byUrl.set(url, job);
      const fp = fingerprints.get(jobKey(job));
      if (fp) this.byFingerprint.set(fp, job);
      const company = normalizeField(job.company);
      if (company) this.addTo(this.byCompany, company, job);
      for (const token of tokenize(job.title)) {
        this.addTo(this.byTitleToken, token, job);
      }
    }
  }

  private addTo(map: Map<string, KnownJob[]>, key: string, job: KnownJob): void {
    const list = map.get(key);
    if (list) {
      if (!list.includes(job)) list.push(job);
    } else {
      map.set(key, [job]);
    }
  }

  /** Exact tier-1/tier-2 checks plus a candidate-limited similarity probe. */
  classify(
    job: KnownJob,
    fp: string,
    fingerprintCandidates: KnownJob[]
  ): { kind: DupKind; matched?: KnownJob; score: number } {
    const url = canonicalUrl(job.url) || canonicalUrl(job.web_url);
    if (url) {
      const matched = this.byUrl.get(url);
      if (matched) return { kind: 'dup_url', matched, score: 1 };
    }
    const matchedFp =
      this.byFingerprint.get(fp) ??
      fingerprintCandidates.find((k) => this.byFingerprint.get(jobKey(k)) === fp);
    if (matchedFp) return { kind: 'dup_fingerprint', matched: matchedFp, score: 1 };

    let best: KnownJob | null = null;
    let bestScore = 0;
    for (const candidate of this.candidatesFor(job)) {
      if (candidate === job) continue;
      const score = jaccardSimilarity(tokenize(job.title), tokenize(candidate.title));
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (best && bestScore >= SIMILARITY_THRESHOLD) {
      return { kind: 'similar', matched: best, score: bestScore };
    }
    return { kind: 'new', score: 0 };
  }

  /** Candidate pool from company index + title-token index (deduped). */
  private candidatesFor(job: KnownJob): KnownJob[] {
    const seen = new Set<KnownJob>();
    const pool: KnownJob[] = [];
    const push = (candidate: KnownJob) => {
      if (!seen.has(candidate)) {
        seen.add(candidate);
        pool.push(candidate);
      }
    };
    const company = normalizeField(job.company);
    if (company) (this.byCompany.get(company) ?? []).forEach(push);
    for (const token of tokenize(job.title)) {
      (this.byTitleToken.get(token) ?? []).forEach(push);
    }
    return pool;
  }
}

function jobKey(job: KnownJob): string {
  return [
    normalizeField(job.company),
    normalizeField(job.title),
    normalizeField(job.location),
  ].join('|');
}

/**
 * Classify each result against the known set.
 * `fingerprints` maps the known jobs to precomputed SHA-256 strings.
 */
export async function classifyJobs(
  results: KnownJob[],
  knownJobs: KnownJob[],
  fingerprints?: Map<string, string>
): Promise<ClassifiedJob[]> {
  const fpMap =
    fingerprints ??
    new Map<string, string>(
      await Promise.all(
        knownJobs.map(
          async (job) =>
            [jobKey(job), await fingerprint(job.company, job.title, job.location)] as const
        )
      )
    );
  const index = new DedupIndex(knownJobs, fpMap);
  const classified: ClassifiedJob[] = [];
  for (const job of results) {
    const fp = await fingerprint(job.company, job.title, job.location);
    const fingerprintCandidates = knownJobs.filter(
      (k) => normalizeField(k.company) === normalizeField(job.company)
    );
    const verdict = index.classify(job, fp, fingerprintCandidates);
    classified.push({ job, kind: verdict.kind, matched: verdict.matched, score: verdict.score });
  }
  return classified;
}

/** Build a fingerprint map for known jobs (precompute once per refresh). */
export async function buildFingerprintMap(jobs: KnownJob[]): Promise<Map<string, string>> {
  return new Map<string, string>(
    await Promise.all(
      jobs.map(
        async (job) =>
          [jobKey(job), await fingerprint(job.company, job.title, job.location)] as const
      )
    )
  );
}
