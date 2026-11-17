/**
 * In-memory fixed-window rate limiter (best effort on serverless: per instance).
 * Limit per window comes from SYNC_RATE_LIMIT_PER_MIN (default 30).
 */
const WINDOW_MS = 60_000;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function rateLimitPerMinute(): number {
  const n = Number(process.env.SYNC_RATE_LIMIT_PER_MIN);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets (0 when allowed). */
  retryAfter: number;
}

export function checkRateLimit(key: string, now: number = Date.now()): RateLimitResult {
  // opportunistic cleanup so the map cannot grow without bound
  if (buckets.size > 1000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, b);
  }
  if (b.count >= rateLimitPerMinute()) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  b.count += 1;
  return { allowed: true, retryAfter: 0 };
}

/** Test helper. */
export function resetRateLimit(): void {
  buckets.clear();
}

/** Best-effort client IP from proxy headers. */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}
