/**
 * Applies migration 0004 (sales.source) statement by statement.
 *
 * drizzle-kit runs a migration file as one transaction, and this one rewrites
 * ~770k rows across four UPDATEs plus a DELETE and an index build — more than
 * the Neon HTTP driver will hold open, so it timed out and rolled back. Each
 * statement is independently safe and idempotent, so running them separately
 * is fine; the journal row is written at the end so drizzle-kit stays in sync.
 *
 * Usage: npx tsx src/scripts/apply-source-column.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';

const sqlClient = neon(process.env.DATABASE_URL!);

/**
 * Ordered so the space-freeing DELETE happens before the big rewrites, and the
 * ~660k-row UPDATE is batched.
 *
 * Postgres updates a row by writing a new version and leaving the old one dead,
 * so a single UPDATE over the whole table momentarily needs a second copy of
 * it. On a 512 MB Neon project holding a 353 MB `sales` table, that overruns
 * the cap and the statement fails. Batching plus a VACUUM between batches keeps
 * the dead tuples bounded and lets the space be reused.
 */
const STEPS: [string, string][] = [
  ['add column', `ALTER TABLE sales ADD COLUMN IF NOT EXISTS source varchar(40)`],
  [
    'tag eBay Browse rows (asking prices)',
    `UPDATE sales SET source = 'ebay:browse-active'
     WHERE source IS NULL AND ebay_url LIKE '%ebay.com%'`,
  ],
  [
    'delete asking-price rows',
    `DELETE FROM sales WHERE source = 'ebay:browse-active'`,
  ],
  ['reclaim', `VACUUM sales`],
  [
    'tag PriceCharting/TCGplayer rows',
    `UPDATE sales SET source = 'pricecharting:tcgplayer'
     WHERE source IS NULL AND ebay_item_id LIKE 'tcgplayer-%'`,
  ],
];

const FINAL_STEPS: [string, string][] = [
  [
    'tag PriceCharting/auction-house rows',
    `UPDATE sales SET source = 'pricecharting:auction' WHERE source IS NULL`,
  ],
  ['index source', `CREATE INDEX IF NOT EXISTS sales_source_idx ON sales USING btree (source)`],
  ['reclaim', `VACUUM sales`],
];

/** Rows per batch for the large PriceCharting/eBay rewrite. */
const BATCH = 40_000;

async function tagPriceChartingEbayInBatches() {
  const [{ lo, hi }] = (await sqlClient.query(
    `SELECT coalesce(min(id),0) lo, coalesce(max(id),0) hi FROM sales`
  )) as unknown as { lo: number; hi: number }[];

  let from = Number(lo);
  const to = Number(hi);
  let done = 0;

  while (from <= to) {
    const upper = from + BATCH;
    await sqlClient.query(
      `UPDATE sales SET source = 'pricecharting:ebay'
       WHERE id >= $1 AND id < $2 AND source IS NULL AND ebay_item_id LIKE 'ebay-%'`,
      [from, upper]
    );
    // Reclaim as we go, otherwise dead tuples accumulate to a full table copy.
    await sqlClient.query(`VACUUM sales`);

    done += BATCH;
    from = upper;
    process.stdout.write(
      `\r  tag PriceCharting/eBay rows (batched)   ${Math.min(done, to).toLocaleString()}/${to.toLocaleString()} ids   `
    );
  }
  console.log('');
}

async function main() {
  console.log('=== Applying sales.source (migration 0004) ===\n');

  for (const [label, statement] of STEPS) {
    const t0 = Date.now();
    process.stdout.write(`  ${label.padEnd(40)}`);
    await sqlClient.query(statement);
    console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  await tagPriceChartingEbayInBatches();

  for (const [label, statement] of FINAL_STEPS) {
    const t0 = Date.now();
    process.stdout.write(`  ${label.padEnd(40)}`);
    await sqlClient.query(statement);
    console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  // Record the migration so drizzle-kit does not try to replay it.
  const content = readFileSync('src/db/migrations/0004_sticky_network.sql', 'utf8');
  const hash = createHash('sha256').update(content).digest('hex');
  const existing = (await sqlClient.query(
    `SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1`,
    [hash]
  )) as unknown as unknown[];

  if (existing.length === 0) {
    await sqlClient.query(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
      [hash, Date.now()]
    );
    console.log('\n  journal updated');
  }

  console.log('\n  Result:');
  console.table(await sqlClient.query(`SELECT source, count(*) FROM sales GROUP BY 1 ORDER BY 2 DESC`));
}

main().catch((err) => {
  console.error('Failed:', err.message ?? err);
  process.exit(1);
});
