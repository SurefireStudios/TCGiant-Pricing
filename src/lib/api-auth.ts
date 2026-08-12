/**
 * API Authentication
 *
 * Validates API keys passed via query param (?key=XXX) or X-Api-Key header,
 * and enforces tier-based rate limits.
 *
 * Two things here used to be placeholders and are now real:
 *
 *   1. Key validation. It accepted only INTERNAL_API_KEY and the literal
 *      string "demo"; the api_keys table was never consulted. Keys are now
 *      looked up by SHA-256 hash, so the raw key is never stored.
 *   2. Rate limiting. It used an in-process Map, which enforces nothing on
 *      serverless: each instance has its own copy and every cold start clears
 *      it. Counters now live in the database and are shared.
 */

import { NextRequest } from 'next/server';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@/db/schema';

interface ApiKeyInfo {
  tier: string;
  rateLimitPerMinute: number;
  rateLimitPerDay: number;
  keyPrefix: string;
}

export type ValidationResult =
  | { valid: true; keyInfo: ApiKeyInfo }
  | { valid: false; error: string; status: number; retryAfter?: number };

function db() {
  return drizzle(neon(process.env.DATABASE_URL!), { schema });
}

/**
 * Hash an API key using SHA-256.
 * We never store the raw key, only its hash.
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Generate a new API key.
 * Format: tcg_<40 hex chars>
 *
 * Uses crypto.randomBytes rather than Math.random, which is not a
 * cryptographically secure source and must never generate a credential.
 */
export function generateApiKey(): string {
  return `tcg_${randomBytes(20).toString('hex')}`;
}

/** Constant-time comparison, so a wrong key cannot be found byte by byte. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Extract the API key from a request.
 * Checks both query params and headers.
 */
export function extractApiKey(request: NextRequest): string | null {
  const url = new URL(request.url);
  const queryKey = url.searchParams.get('key');
  if (queryKey) return queryKey;

  const headerKey = request.headers.get('x-api-key');
  if (headerKey) return headerKey;

  return null;
}

/** Truncate a timestamp to the start of its window. */
function windowStart(kind: 'minute' | 'day', now = new Date()): Date {
  const d = new Date(now);
  d.setSeconds(0, 0);
  if (kind === 'day') {
    d.setUTCHours(0, 0, 0, 0);
  } else {
    d.setUTCSeconds(0, 0);
  }
  return d;
}

/**
 * Increment and return the request count for one window.
 * A single upsert, so this is one round trip rather than a read then a write
 * (which would also race between concurrent requests).
 */
async function bumpWindow(
  database: ReturnType<typeof db>,
  apiKeyId: number,
  kind: 'minute' | 'day'
): Promise<number> {
  const [row] = await database
    .insert(schema.apiUsage)
    .values({
      apiKeyId,
      windowKind: kind,
      windowStart: windowStart(kind),
      count: 1,
    })
    .onConflictDoUpdate({
      target: [
        schema.apiUsage.apiKeyId,
        schema.apiUsage.windowKind,
        schema.apiUsage.windowStart,
      ],
      set: { count: sql`${schema.apiUsage.count} + 1` },
    })
    .returning({ count: schema.apiUsage.count });

  return row?.count ?? 1;
}

/**
 * Validate an API key and check rate limits.
 */
export async function validateApiKey(
  request: NextRequest
): Promise<ValidationResult> {
  const key = extractApiKey(request);

  if (!key) {
    return {
      valid: false,
      error: 'API key is required. Pass it as ?key=YOUR_KEY or X-Api-Key header.',
      status: 401,
    };
  }

  // Internal key for our own apps — no limits, no database lookup.
  const internalKey = process.env.INTERNAL_API_KEY;
  if (internalKey && safeEqual(key, internalKey)) {
    return {
      valid: true,
      keyInfo: {
        tier: 'internal',
        rateLimitPerMinute: Number.MAX_SAFE_INTEGER,
        rateLimitPerDay: Number.MAX_SAFE_INTEGER,
        keyPrefix: key.slice(0, 8),
      },
    };
  }

  const database = db();
  const keyHash = hashApiKey(key);

  const [record] = await database
    .select()
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.keyHash, keyHash))
    .limit(1);

  if (!record) {
    return { valid: false, error: 'Invalid API key.', status: 403 };
  }

  if (!record.isActive) {
    return { valid: false, error: 'This API key has been revoked.', status: 403 };
  }

  // Enforce the tighter window first so a burst reports the right retry hint.
  const perMinute = await bumpWindow(database, record.id, 'minute');
  if (perMinute > record.rateLimitPerMinute) {
    return {
      valid: false,
      error: `Rate limit exceeded: ${record.rateLimitPerMinute} requests per minute.`,
      status: 429,
      retryAfter: 60,
    };
  }

  const perDay = await bumpWindow(database, record.id, 'day');
  if (perDay > record.rateLimitPerDay) {
    return {
      valid: false,
      error: `Daily quota exceeded: ${record.rateLimitPerDay} requests per day.`,
      status: 429,
      retryAfter: 3600,
    };
  }

  // Best-effort bookkeeping; never fail a valid request over it.
  void database
    .update(schema.apiKeys)
    .set({
      requestCount: sql`${schema.apiKeys.requestCount} + 1`,
      lastUsedAt: new Date(),
    })
    .where(eq(schema.apiKeys.id, record.id))
    .catch(() => {});

  return {
    valid: true,
    keyInfo: {
      tier: record.tier,
      rateLimitPerMinute: record.rateLimitPerMinute,
      rateLimitPerDay: record.rateLimitPerDay,
      keyPrefix: record.keyPrefix,
    },
  };
}

/**
 * Delete usage windows that can no longer be hit.
 * Called opportunistically by the cron job.
 */
export async function pruneUsageWindows(): Promise<number> {
  const cutoff = new Date(Date.now() - 2 * 86_400_000);
  const deleted = await db()
    .delete(schema.apiUsage)
    .where(sql`${schema.apiUsage.windowStart} < ${cutoff}`)
    .returning({ id: schema.apiUsage.id });
  return deleted.length;
}

/**
 * Create a JSON error response.
 */
export function apiError(message: string, status: number = 400, retryAfter?: number) {
  return Response.json(
    { status: 'error', 'error-message': message },
    {
      status,
      headers: retryAfter ? { 'Retry-After': String(retryAfter) } : undefined,
    }
  );
}

/**
 * Create a JSON success response.
 */
export function apiSuccess(data: Record<string, unknown>) {
  return Response.json({ status: 'success', ...data });
}
