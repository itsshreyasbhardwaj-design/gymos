import 'server-only';

/**
 * In-memory rate limit for unauthenticated public endpoints.
 *
 * Deliberately simple: it protects a single local/single-instance deployment from a
 * runaway client hammering a CPU-bound endpoint. It is NOT a distributed rate limit and
 * resets on restart — a multi-instance deployment needs a shared store (see SECURITY.md).
 */
const WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkPublicRateLimit(key: string, limit: number): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    // Opportunistic cleanup so the map cannot grow without bound.
    if (buckets.size > 5_000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return { allowed: true, retryAfter: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}
