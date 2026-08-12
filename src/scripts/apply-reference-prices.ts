/**
 * Fill ungraded prices from third-party references.
 *
 * Most cards have no sales at all — PriceCharting simply does not carry them
 * (basic energies, reverse-holo variants of modern sets, anything it names
 * differently), and scraping the ones it does carry runs at ~1 req/s. The
 * TCGplayer reference covers essentially the whole catalogue and costs a few
 * hundred bulk requests, so it is the fastest route to a real price on a card
 * that currently shows nothing.
 *
 * Precedence for `current_prices.market_price`, highest first:
 *
 *   computed            our pricing engine, when it has enough sales
 *   reference:tcgplayer TCGplayer market price (raw cards only)
 *   baseline            the scraped PriceCharting figure
 *
 * A computed price is never overwritten — this only fills gaps and refreshes
 * rows that were already reference-sourced.
 *
 * Usage:
 *   npx tsx src/scripts/apply-reference-prices.ts --dry-run
 *   npx tsx src/scripts/apply-reference-prices.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

const DRY_RUN = process.argv.includes('--dry-run');
const sqlClient = neon(process.env.DATABASE_URL!);

/**
 * Only TCGplayer feeds market_price. Cardmarket is stored for comparison but
 * is priced in EUR for a different market, so mixing it into a USD price would
 * be wrong.
 */
const SOURCE = 'tcgplayer';

async function main() {
  console.log('=== Apply reference prices ===');
  console.log(DRY_RUN ? 'MODE: dry run\n' : 'MODE: apply\n');

  const [before] = (await sqlClient.query(
    `SELECT
       (SELECT count(DISTINCT card_id) FROM current_prices) priced_cards,
       (SELECT count(*) FROM price_references WHERE source = $1 AND price > 0) refs`,
    [SOURCE]
  )) as unknown as { priced_cards: string; refs: string }[];

  console.log(`  cards priced now:      ${Number(before.priced_cards).toLocaleString()}`);
  console.log(`  tcgplayer references:  ${Number(before.refs).toLocaleString()}`);

  // How many of those references would create a price that does not exist yet.
  const [gap] = (await sqlClient.query(
    `SELECT count(*) n FROM price_references r
     WHERE r.source = $1 AND r.price > 0
       AND NOT EXISTS (
         SELECT 1 FROM current_prices cp
         WHERE cp.card_id = r.card_id AND cp.condition = 'UNGRADED'
       )`,
    [SOURCE]
  )) as unknown as { n: string }[];

  console.log(`  new ungraded prices:   ${Number(gap.n).toLocaleString()}`);

  if (DRY_RUN) {
    const sample = (await sqlClient.query(
      `SELECT c.name, c.variant, s.name set_name, r.variant_key, r.price/100.0 usd
       FROM price_references r
       JOIN cards c ON c.id = r.card_id
       JOIN sets s ON s.id = c.set_id
       WHERE r.source = $1 AND r.price > 0
         AND NOT EXISTS (SELECT 1 FROM current_prices cp
                         WHERE cp.card_id = r.card_id AND cp.condition = 'UNGRADED')
       ORDER BY r.price DESC LIMIT 10`,
      [SOURCE]
    )) as unknown as Record<string, unknown>[];
    console.log('\n  Highest-value cards that would gain a price:');
    console.table(sample);
    console.log('\n  [dry run] nothing written');
    return;
  }

  // Insert where missing, refresh where the existing row is reference-sourced.
  // `price_source = 'computed'` rows are left alone: our own sales data always
  // wins over someone else's marketplace price.
  const t0 = Date.now();
  await sqlClient.query(
    `INSERT INTO current_prices
       (card_id, condition, grading_company, market_price, price_source, sale_count, updated_at)
     SELECT r.card_id, 'UNGRADED', 'UNGRADED', r.price, 'reference:tcgplayer', 0, now()
     FROM price_references r
     WHERE r.source = $1 AND r.price > 0
     ON CONFLICT (card_id, condition, grading_company) DO UPDATE
       SET market_price = EXCLUDED.market_price,
           price_source = EXCLUDED.price_source,
           updated_at   = now()
       WHERE current_prices.price_source <> 'computed'`,
    [SOURCE]
  );

  console.log(`\n  applied in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const [after] = (await sqlClient.query(
    `SELECT
       (SELECT count(DISTINCT card_id) FROM current_prices) priced_cards,
       (SELECT count(*) FROM cards) total_cards`
  )) as unknown as { priced_cards: string; total_cards: string }[];

  const priced = Number(after.priced_cards);
  const total = Number(after.total_cards);
  console.log(
    `  cards priced now:      ${priced.toLocaleString()} / ${total.toLocaleString()} ` +
      `(${((priced / total) * 100).toFixed(1)}%)`
  );

  console.log('\n  price_source breakdown:');
  console.table(
    await sqlClient.query(
      `SELECT price_source, count(*) rows, count(DISTINCT card_id) cards
       FROM current_prices GROUP BY 1 ORDER BY 2 DESC`
    )
  );
}

main().catch((err) => {
  console.error('Failed:', err.message ?? err);
  process.exit(1);
});
