import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  askCareerQuestion,
  createCertification,
  createSkill,
  deleteCertification,
  deleteSkill,
  getCareerInsights,
  getCareerMemory,
  getProfile,
  getSkillRoi,
  seedProfileFromMaster,
  updateCertification,
  updateProfile,
  updateSkill,
} from '@/lib/api/profile';

/**
 * Career-profile API client contracts: the wrappers must hit the right
 * method/URL, send the right payloads, and surface backend detail messages.
 */

function responseFrom(error: string): Response {
  return new Response(JSON.stringify({ detail: error }), { status: 409 });
}

describe('profile API client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const lastCall = () => {
    const [url, options] = fetchMock.mock.calls.at(-1)!;
    return { url: String(url), options: options as RequestInit };
  };

  it('getProfile GETs /profile', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ profile: {}, skills: [], certifications: [] }), {
        status: 200,
      })
    );
    const res = await getProfile();
    expect(String(lastCall().url)).toContain('/profile');
    expect(res.skills).toEqual([]);
  });

  it('updateProfile PUTs the payload to /profile', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ name: 'Jane' }), { status: 200 }));
    await updateProfile({ name: 'Jane', target_roles: ['ML Engineer'] });
    const { url, options } = lastCall();
    expect(url).toContain('/profile');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(String(options.body))).toEqual({
      name: 'Jane',
      target_roles: ['ML Engineer'],
    });
  });

  it('seedProfileFromMaster POSTs to /profile/seed-from-master', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ name: 'Jane' }), { status: 200 }));
    await seedProfileFromMaster();
    const { url, options } = lastCall();
    expect(url).toContain('/profile/seed-from-master');
    expect(options.method).toBe('POST');
  });

  it('createSkill POSTs the payload to /profile/skills', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ skill_id: 's1' }), { status: 201 }));
    await createSkill({ name: 'Python', proficiency: 5 });
    const { url, options } = lastCall();
    expect(url).toContain('/profile/skills');
    expect(options.method).toBe('POST');
    expect(JSON.parse(String(options.body))).toEqual({ name: 'Python', proficiency: 5 });
  });

  it('updateSkill PATCHes /profile/skills/{id}', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ skill_id: 's1' }), { status: 200 }));
    await updateSkill('s1', { proficiency: 3 });
    const { url, options } = lastCall();
    expect(url).toContain('/profile/skills/s1');
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(String(options.body))).toEqual({ proficiency: 3 });
  });

  it('deleteSkill DELETEs /profile/skills/{id}', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ affected: 1 }), { status: 200 }));
    await deleteSkill('s1');
    const { url, options } = lastCall();
    expect(url).toContain('/profile/skills/s1');
    expect(options.method).toBe('DELETE');
  });

  it('createCertification POSTs to /profile/certifications', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ certification_id: 'c1' }), { status: 201 })
    );
    await createCertification({ name: 'AWS SA', issuer: 'Amazon' });
    const { url, options } = lastCall();
    expect(url).toContain('/profile/certifications');
    expect(options.method).toBe('POST');
    expect(JSON.parse(String(options.body))).toEqual({ name: 'AWS SA', issuer: 'Amazon' });
  });

  it('updateCertification PATCHes /profile/certifications/{id}', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ certification_id: 'c1' }), { status: 200 })
    );
    await updateCertification('c1', { url: 'https://x' });
    const { url, options } = lastCall();
    expect(url).toContain('/profile/certifications/c1');
    expect(options.method).toBe('PATCH');
  });

  it('deleteCertification DELETEs /profile/certifications/{id}', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ affected: 1 }), { status: 200 }));
    await deleteCertification('c1');
    const { url, options } = lastCall();
    expect(url).toContain('/profile/certifications/c1');
    expect(options.method).toBe('DELETE');
  });

  it('getCareerMemory GETs /profile/memory', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ funnel: {} }), { status: 200 }));
    const res = await getCareerMemory();
    expect(String(lastCall().url)).toContain('/profile/memory');
    expect(res.funnel).toEqual({});
  });

  it('askCareerQuestion POSTs question + history to /profile/ask', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ answer: '**Learn ML**' }), { status: 200 })
    );
    const res = await askCareerQuestion({
      question: 'What next?',
      history: [{ role: 'user', content: 'hi' }],
    });
    const { url, options } = lastCall();
    expect(url).toContain('/profile/ask');
    expect(options.method).toBe('POST');
    expect(JSON.parse(String(options.body))).toEqual({
      question: 'What next?',
      history: [{ role: 'user', content: 'hi' }],
    });
    expect(res.answer).toBe('**Learn ML**');
  });

  it('getCareerInsights GETs /profile/insights', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ stats: {}, narrative: null }), { status: 200 })
    );
    const res = await getCareerInsights();
    expect(String(lastCall().url)).toContain('/profile/insights');
    expect(res.narrative).toBeNull();
  });

  it('getSkillRoi POSTs to /profile/skill-roi with the include_advice flag', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ results: [], note: null }), { status: 200 })
    );
    await getSkillRoi({ include_advice: true });
    const { url, options } = lastCall();
    expect(url).toContain('/profile/skill-roi');
    expect(options.method).toBe('POST');
    expect(JSON.parse(String(options.body))).toEqual({ include_advice: true });
  });

  it('surfaces the backend detail message on errors', async () => {
    fetchMock.mockResolvedValue(responseFrom('A skill with this name already exists.'));
    await expect(createSkill({ name: 'Python' })).rejects.toThrow(
      'A skill with this name already exists.'
    );
  });
});
