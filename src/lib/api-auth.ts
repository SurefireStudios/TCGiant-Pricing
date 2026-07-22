/**
 * API Authentication Middleware
 *
 * Validates API keys passed via query param (?key=XXX) or X-Api-Key header.
 * Enforces tier-based rate limits. Designed to be called at the top of
 * each API route handler.
 *
 * For the MVP, we also support a special internal key set via INTERNAL_API_KEY
 * env var for our own apps to use without rate limits.
 */

import { NextRequest } from 'next/server';
import { createHash } from 'crypto';

// Rate limit tracking (in-memory for MVP, move to Redis for production)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

interface ApiKeyInfo {
  tier: string;
  rateLimitPerMinute: number;
  rateLimitPerDay: number;
  keyPrefix: string;
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
 * Format: tcg_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX (40 chars total)
 */
export function generateApiKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'tcg_';
  for (let i = 0; i < 36; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

/**
 * Extract the API key from a request.
 * Checks both query params and headers.
 */
export function extractApiKey(request: NextRequest): string | null {
  // Check query param first
  const url = new URL(request.url);
  const queryKey = url.searchParams.get('key');
  if (queryKey) return queryKey;

  // Check header
  const headerKey = request.headers.get('x-api-key');
  if (headerKey) return headerKey;

  return null;
}

/**
 * Validate an API key and check rate limits.
 * Returns the key info if valid, or an error response.
 *
 * For the MVP, we use an in-memory check against the INTERNAL_API_KEY env var.
 * In production, this will query the api_keys table.
 */
export async function validateApiKey(
  request: NextRequest
): Promise<{ valid: true; keyInfo: ApiKeyInfo } | { valid: false; error: string; status: number }> {
  const key = extractApiKey(request);

  if (!key) {
    return {
      valid: false,
      error: 'API key is required. Pass it as ?key=YOUR_KEY or X-Api-Key header.',
      status: 401,
    };
  }

  // Check internal key (no rate limits)
  const internalKey = process.env.INTERNAL_API_KEY;
  if (internalKey && key === internalKey) {
    return {
      valid: true,
      keyInfo: {
        tier: 'internal',
        rateLimitPerMinute: 999999,
        rateLimitPerDay: 999999,
        keyPrefix: key.substring(0, 8),
      },
    };
  }

  // For MVP, also allow a public demo key for testing
  if (key === 'demo') {
    // Rate limit demo key aggressively
    const rateLimited = checkRateLimit('demo', 5, 50);
    if (rateLimited) {
      return {
        valid: false,
        error: 'Rate limit exceeded. Please wait before making more requests.',
        status: 429,
      };
    }
    return {
      valid: true,
      keyInfo: {
        tier: 'free',
        rateLimitPerMinute: 5,
        rateLimitPerDay: 50,
        keyPrefix: 'demo',
      },
    };
  }

  // TODO: In production, query the api_keys table
  // const keyHash = hashApiKey(key);
  // const result = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);
  // if (!result.length || !result[0].isActive) { return error; }

  return {
    valid: false,
    error: 'Invalid API key.',
    status: 403,
  };
}

/**
 * Simple in-memory rate limiter.
 * Returns true if rate limited, false if allowed.
 */
function checkRateLimit(
  keyPrefix: string,
  maxPerMinute: number,
  _maxPerDay: number
): boolean {
  const now = Date.now();
  const key = `rate:${keyPrefix}`;
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + 60000 });
    return false;
  }

  entry.count++;
  if (entry.count > maxPerMinute) {
    return true;
  }

  return false;
}

/**
 * Create a JSON error response.
 */
export function apiError(message: string, status: number = 400) {
  return Response.json(
    { status: 'error', 'error-message': message },
    { status }
  );
}

/**
 * Create a JSON success response.
 */
export function apiSuccess(data: Record<string, unknown>) {
  return Response.json({ status: 'success', ...data });
}
