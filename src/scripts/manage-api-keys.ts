/**
 * API key administration.
 *
 * Keys are stored as SHA-256 hashes, so the raw key is shown exactly once at
 * creation and cannot be recovered afterwards — losing it means issuing a new
 * one.
 *
 * Usage:
 *   npx tsx src/scripts/manage-api-keys.ts list
 *   npx tsx src/scripts/manage-api-keys.ts create --email you@example.com --tier pro --name "TCGiant Gacha"
 *   npx tsx src/scripts/manage-api-keys.ts revoke --prefix tcg_1a2b
 *   npx tsx src/scripts/manage-api-keys.ts usage --prefix tcg_1a2b
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { desc, eq, gte, and } from 'drizzle-orm';
import * as schema from '../db/schema';
import { generateApiKey, hashApiKey } from '../lib/api-auth';

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

const args = process.argv.slice(2);
const command = args[0];
const argValue = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 ? args[i + 1] : undefined;
};

/** Default limits per tier. Chosen to be generous — see the audit's §5.4. */
const TIER_LIMITS: Record<string, { perMinute: number; perDay: number }> = {
  // PriceCharting gates API access behind $49/mo. A usable free tier is the
  // fastest route to developers building on us.
  free: { perMinute: 30, perDay: 1_000 },
  basic: { perMinute: 120, perDay: 20_000 },
  pro: { perMinute: 600, perDay: 200_000 },
  internal: { perMinute: 10_000, perDay: 10_000_000 },
};

async function list() {
  const keys = await db.select().from(schema.apiKeys).orderBy(desc(schema.apiKeys.createdAt));

  if (keys.length === 0) {
    console.log('No API keys issued yet.');
    return;
  }

  console.log(`${keys.length} key(s):\n`);
  for (const k of keys) {
    console.log(
      `  ${k.keyPrefix.padEnd(10)} ${(k.isActive ? 'active' : 'REVOKED').padEnd(8)} ` +
        `${k.tier.padEnd(9)} ${String(k.requestCount).padStart(8)} reqs  ` +
        `${k.userEmail ?? '-'}${k.userName ? ` (${k.userName})` : ''}`
    );
  }
}

async function create() {
  const email = argValue('email');
  const tier = (argValue('tier') ?? 'free') as keyof typeof TIER_LIMITS;
  const name = argValue('name') ?? null;

  if (!email) {
    console.error('--email is required');
    process.exit(1);
  }
  if (!TIER_LIMITS[tier]) {
    console.error(`Unknown tier "${tier}". One of: ${Object.keys(TIER_LIMITS).join(', ')}`);
    process.exit(1);
  }

  const key = generateApiKey();
  const limits = TIER_LIMITS[tier];

  await db.insert(schema.apiKeys).values({
    keyHash: hashApiKey(key),
    keyPrefix: key.slice(0, 8),
    userEmail: email,
    userName: name,
    tier: tier as typeof schema.apiTierEnum.enumValues[number],
    rateLimitPerMinute: limits.perMinute,
    rateLimitPerDay: limits.perDay,
    isActive: true,
  });

  console.log('\n  API key created. This is the only time it will be shown:\n');
  console.log(`    ${key}\n`);
  console.log(`  tier   ${tier}`);
  console.log(`  limits ${limits.perMinute}/min, ${limits.perDay}/day`);
  console.log(`  owner  ${email}${name ? ` (${name})` : ''}\n`);
}

async function revoke() {
  const prefix = argValue('prefix');
  if (!prefix) {
    console.error('--prefix is required (see `list`)');
    process.exit(1);
  }

  const updated = await db
    .update(schema.apiKeys)
    .set({ isActive: false })
    .where(eq(schema.apiKeys.keyPrefix, prefix))
    .returning({ prefix: schema.apiKeys.keyPrefix });

  console.log(updated.length > 0 ? `Revoked ${prefix}` : `No key found with prefix ${prefix}`);
}

async function usage() {
  const prefix = argValue('prefix');
  if (!prefix) {
    console.error('--prefix is required');
    process.exit(1);
  }

  const [key] = await db
    .select()
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.keyPrefix, prefix))
    .limit(1);

  if (!key) {
    console.log(`No key found with prefix ${prefix}`);
    return;
  }

  const since = new Date(Date.now() - 7 * 86_400_000);
  const windows = await db
    .select()
    .from(schema.apiUsage)
    .where(and(eq(schema.apiUsage.apiKeyId, key.id), gte(schema.apiUsage.windowStart, since)))
    .orderBy(desc(schema.apiUsage.windowStart))
    .limit(20);

  console.log(`\n  ${key.keyPrefix} · ${key.tier} · ${key.requestCount} lifetime requests`);
  console.log(`  limits: ${key.rateLimitPerMinute}/min, ${key.rateLimitPerDay}/day\n`);

  if (windows.length === 0) {
    console.log('  No usage in the last 7 days.');
    return;
  }
  for (const w of windows) {
    const limit = w.windowKind === 'minute' ? key.rateLimitPerMinute : key.rateLimitPerDay;
    console.log(
      `    ${w.windowKind.padEnd(7)} ${w.windowStart.toISOString()}  ${String(w.count).padStart(7)} / ${limit}`
    );
  }
}

async function main() {
  switch (command) {
    case 'list':
      return list();
    case 'create':
      return create();
    case 'revoke':
      return revoke();
    case 'usage':
      return usage();
    default:
      console.log('Commands: list | create | revoke | usage');
      console.log('  create --email <e> [--tier free|basic|pro|internal] [--name <n>]');
      console.log('  revoke --prefix <p>');
      console.log('  usage  --prefix <p>');
  }
}

main().catch((err) => {
  console.error('Failed:', err.message ?? err);
  process.exit(1);
});
