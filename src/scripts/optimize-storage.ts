/**
 * Storage optimiser.
 *
 * The database sits close to Neon's project size limit, and `sales` is almost
 * all of it. This reclaims space that costs us nothing to lose:
 *
 *   1. Unused indexes. `sales` carries 131 MB of indexes against 220 MB of
 *      heap; several have essentially never been scanned.
 *   2. `sales.ebay_url` on scraped rows. It averages 74 bytes across ~763k rows
 *      (~56 MB) but has only ~5,300 distinct values, because for a
 *      PriceCharting row it is just that card's PriceCharting page — identical
 *      for every sale of the card, derivable from the card, and a link that
 *      sends our own users to a competitor. It is kept for `ebay:*` rows, where
 *      it points at a real listing and is not derivable.
 *   3. Bloat left behind by the large UPDATEs, via VACUUM.
 *
 * Usage:
 *   npx tsx src/scripts/optimize-storage.ts --dry-run
 *   npx tsx src/scripts/optimize-storage.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

const DRY_RUN = process.argv.includes('--dry-run');
const sqlClient = neon(process.env.DATABASE_URL!);

/**
 * Indexes to drop, with the reason each is safe.
 *
 * Deliberately NOT dropped:
 *   cards_name_trgm_idx  — 0 scans only because the site has no traffic yet;
 *                          it is what makes the search box viable. Keep.
 *   sales_ebay_item_id_idx — 49 MB but load-bearing: it is the dedup key for
 *                          every insert (478k scans). Keep.
 */
const DROP_INDEXES: [string, string][] = [
  ['sales_sale_date_idx', 'date range queries are always scoped by card first (20 scans)'],
  ['sales_is_outlier_idx', 'boolean column — too low-cardinality for an index to help (10 scans)'],
  ['sales_card_id_idx', 'redundant: sales_card_cond_idx is (card_id, condition) and serves card_id alone'],
  ['sales_source_idx', 'provenance is for reporting, not hot queries (4 scans)'],
  ['cards_variant_idx', 'variant is never filtered on its own (0 scans)'],
  ['cards_name_idx', 'superseded by cards_name_trgm_idx for the searches we run (15 scans)'],
];

const BATCH = 40_000;

async function dbSize(): Promise<string> {
  const [r] = (await sqlClient.query(
    `SELECT pg_size_pretty(pg_database_size(current_database())) s`
  )) as unknown as { s: string }[];
  return r.s;
}

async function main() {
  console.log('=== Storage optimiser ===');
  console.log(DRY_RUN ? 'MODE: dry run\n' : 'MODE: apply\n');
  console.log(`  size before: ${await dbSize()}\n`);

  // --- 1. Unused indexes ---------------------------------------------------
  console.log('  Indexes to drop:');
  let indexBytes = 0;
  for (const [name, reason] of DROP_INDEXES) {
    const rows = (await sqlClient.query(
      `SELECT pg_relation_size(indexrelid) b, idx_scan
       FROM pg_stat_user_indexes WHERE indexrelname = $1`,
      [name]
    )) as unknown as { b: string; idx_scan: string }[];

    if (rows.length === 0) {
      console.log(`    ${name.padEnd(26)} (already absent)`);
      continue;
    }
    indexBytes += Number(rows[0].b);
    console.log(
      `    ${name.padEnd(26)} ${(Number(rows[0].b) / 1048576).toFixed(1).padStart(6)} MB · ${rows[0].idx_scan} scans — ${reason}`
    );
    if (!DRY_RUN) await sqlClient.query(`DROP INDEX IF EXISTS ${name}`);
  }
  console.log(`    → ${(indexBytes / 1048576).toFixed(0)} MB\n`);

  // --- 2. Redundant ebay_url on scraped rows -------------------------------
  const [urlStats] = (await sqlClient.query(
    `SELECT count(*) n, coalesce(sum(pg_column_size(ebay_url)),0) b
     FROM sales WHERE ebay_url IS NOT NULL AND source LIKE 'pricecharting:%'`
  )) as unknown as { n: string; b: string }[];

  console.log(
    `  Redundant ebay_url values: ${Number(urlStats.n).toLocaleString()} rows, ` +
      `${(Number(urlStats.b) / 1048576).toFixed(0)} MB`
  );

  if (!DRY_RUN && Number(urlStats.n) > 0) {
    const [range] = (await sqlClient.query(
      `SELECT coalesce(min(id),0) lo, coalesce(max(id),0) hi FROM sales`
    )) as unknown as { lo: number; hi: number }[];

    let from = Number(range.lo);
    const to = Number(range.hi);

    // Batched: rewriting every row at once needs a second copy of the table,
    // which is what tripped the project size limit before.
    while (from <= to) {
      await sqlClient.query(
        `UPDATE sales SET ebay_url = NULL
         WHERE id >= $1 AND id < $2 AND ebay_url IS NOT NULL AND source LIKE 'pricecharting:%'`,
        [from, from + BATCH]
      );
      await sqlClient.query(`VACUUM sales`);
      from += BATCH;
      process.stdout.write(`\r    clearing ${Math.min(from, to).toLocaleString()}/${to.toLocaleString()}   `);
    }
    console.log('');
  }

  // --- 3. Reclaim ----------------------------------------------------------
  if (!DRY_RUN) {
    process.stdout.write('  vacuuming... ');
    for (const t of ['sales', 'cards', 'current_prices']) {
      await sqlClient.query(`VACUUM ANALYZE ${t}`);
    }
    console.log('done');
  }

  console.log(`\n  size after: ${await dbSize()}`);

  if (DRY_RUN) console.log('\n  [dry run] nothing was changed');
}

main().catch((err) => {
  console.error('Failed:', err.message ?? err);
  process.exit(1);
});
