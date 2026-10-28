/**
 * Response headers, asserted against the real Next config.
 *
 * This exists because a header set in `next.config.ts` overrides one set in a route
 * handler, which is exactly how `microphone=()` silently made the voice recorder
 * impossible after it shipped. These assertions tie each value to the feature that
 * depends on it, so changing one has to be deliberate.
 */
import { describe, it, expect } from 'vitest';
import config from '../../next.config';

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

async function rules(): Promise<HeaderRule[]> {
  const fn = config.headers;
  if (!fn) throw new Error('next.config.ts defines no headers()');
  return (await fn()) as HeaderRule[];
}

function valueOf(rule: HeaderRule, key: string): string | undefined {
  return rule.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
}

describe('the media handler rule', () => {
  it('comes before the catch-all, so its stricter values win', async () => {
    const all = await rules();
    const mediaIndex = all.findIndex((r) => r.source.includes('api/media'));
    expect(mediaIndex).toBe(0);
    expect(all.length).toBeGreaterThan(1);
  });

  it('sends no referrer, so an opaque file id never leaks onward', async () => {
    const media = (await rules())[0]!;
    expect(valueOf(media, 'Referrer-Policy')).toBe('no-referrer');
  });

  it('denies camera, microphone and location on a media response', async () => {
    const media = (await rules())[0]!;
    expect(valueOf(media, 'Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
  });

  it('keeps nosniff and frame denial', async () => {
    const media = (await rules())[0]!;
    expect(valueOf(media, 'X-Content-Type-Options')).toBe('nosniff');
    expect(valueOf(media, 'X-Frame-Options')).toBe('DENY');
  });
});

describe('the application rule', () => {
  it('excludes the media path, so the two rules cannot both apply', async () => {
    const app = (await rules())[1]!;
    expect(app.source).toMatch(/\(\?!api/);
  });

  it('allows the microphone to the same origin, which the voice recorder needs', async () => {
    const app = (await rules())[1]!;
    const policy = valueOf(app, 'Permissions-Policy') ?? '';
    expect(policy).toContain('microphone=(self)');
    // The regression that prompted this test.
    expect(policy).not.toContain('microphone=()');
  });

  it('allows the camera to the same origin, for photo capture', async () => {
    const policy = valueOf((await rules())[1]!, 'Permissions-Policy') ?? '';
    expect(policy).toContain('camera=(self)');
  });

  it('grants geolocation to nobody, because nothing in GymOS uses it', async () => {
    const policy = valueOf((await rules())[1]!, 'Permissions-Policy') ?? '';
    expect(policy).toContain('geolocation=()');
  });

  it('keeps nosniff, frame denial and a referrer policy', async () => {
    const app = (await rules())[1]!;
    expect(valueOf(app, 'X-Content-Type-Options')).toBe('nosniff');
    expect(valueOf(app, 'X-Frame-Options')).toBe('DENY');
    expect(valueOf(app, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });
});
