/**
 * Recompute cards.scrape_priority.
 *
 * The column existed but was only ever 1 or 10 ("Rare Holo" got 10), and the
 * backfill ignored it in favour of set id — i.e. release order. The result was
 * a scraper permanently stuck in 1999-2003 with no modern set priced at all.
 *
 * Priority answers one question: if the run is cut short, which cards do we
 * most regret not having? Scoring reflects what drives traffic and revenue:
 * chase rarities, sets people are actively opening, and iconic vintage.
 *
 * Usage:
 *   npx tsx src/scripts/set-scrape-priority.ts --dry-run
 *   npx tsx src/scripts/set-scrape-priority.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

const DRY_RUN = process.argv.includes('--dry-run');
const sqlClient = neon(process.env.DATABASE_URL!);

/**
 * Score expression. Kept as one SQL statement so 58k rows update in a single
 * round trip rather than row-by-row from the client.
 */
const SCORE = `
  (
    -- Chase rarities carry most of the search volume and dollar value.
    CASE
      WHEN c.rarity ILIKE '%secret%'        THEN 60
      WHEN c.rarity ILIKE '%illustration%'  THEN 55
      WHEN c.rarity ILIKE '%hyper%'         THEN 50
      WHEN c.rarity ILIKE '%ultra%'         THEN 45
      WHEN c.rarity ILIKE '%special%'       THEN 40
      WHEN c.rarity ILIKE '%holo%'          THEN 35
      WHEN c.rarity ILIKE '%rare%'          THEN 25
      WHEN c.rarity ILIKE '%promo%'         THEN 20
      ELSE 0
    END
    +
    -- Sets people are actively opening and trading.
    CASE
      WHEN s.release_date >= CURRENT_DATE - INTERVAL '2 years'  THEN 45
      WHEN s.release_date >= CURRENT_DATE - INTERVAL '5 years'  THEN 30
      WHEN s.release_date >= CURRENT_DATE - INTERVAL '10 years' THEN 15
      ELSE 0
    END
    +
    -- Iconic vintage: low volume, very high value per card.
    CASE
      WHEN s.name IN ('Base','Base Set','Jungle','Fossil','Base Set 2',
                      'Team Rocket','Gym Heroes','Gym Challenge',
                      'Neo Genesis','Neo Discovery','Neo Revelation','Neo Destiny')
        THEN 35
      ELSE 0
    END
    +
    -- Nothing beats having no price at all: fill the gaps first.
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM current_prices cp WHERE cp.card_id = c.id
    ) THEN 30 ELSE 0 END
    +
    -- Reverse holos are numerous and mostly low value; deprioritise slightly.
    CASE WHEN c.variant = 'reverse_holo' THEN -10 ELSE 0 END
    +
    -- PriceCharting has no slug for these, so they can only waste a request.
    CASE WHEN c.name ~ '[\\u3000-\\u9fff\\uff00-\\uffef]'
           OR s.name ~ '[\\u3000-\\u9fff\\uff00-\\uffef]'
      THEN -500 ELSE 0 END
  )
`;

async function main() {
  console.log('=== Recomputing scrape_priority ===');
  console.log(DRY_RUN ? 'MODE: dry run\n' : 'MODE: apply\n');

  const preview = (await sqlClient.query(
    `SELECT ${SCORE} AS score, count(*) AS n
     FROM cards c JOIN sets s ON s.id = c.set_id
     GROUP BY 1 ORDER BY 1 DESC LIMIT 12`
  )) as unknown as { score: number; n: string }[];

  console.log('  Top score buckets:');
  for (const r of preview) {
    console.log(`    ${String(r.score).padStart(5)}  ${Number(r.n).toLocaleString()} cards`);
  }

  const top = (await sqlClient.query(
    `SELECT c.name, s.name AS set_name, c.rarity, ${SCORE} AS score
     FROM cards c JOIN sets s ON s.id = c.set_id
     ORDER BY score DESC, c.id LIMIT 10`
  )) as unknown as { name: string; set_name: string; rarity: string; score: number }[];

  console.log('\n  Highest-priority cards (scraped first):');
  for (const r of top) {
    console.log(`    ${String(r.score).padStart(4)}  ${r.set_name} :: ${r.name} (${r.rarity})`);
  }

  if (DRY_RUN) {
    console.log('\n  [dry run] no writes performed');
    return;
  }

  await sqlClient.query(
    `UPDATE cards c SET scrape_priority = ${SCORE}
     FROM sets s WHERE s.id = c.set_id`
  );

  const after = (await sqlClient.query(
    `SELECT min(scrape_priority) lo, max(scrape_priority) hi,
            count(*) FILTER (WHERE scrape_priority < 0) negative
     FROM cards`
  )) as unknown as { lo: number; hi: number; negative: string }[];

  console.log(
    `\n  Applied. range ${after[0].lo}..${after[0].hi}, ` +
      `${Number(after[0].negative).toLocaleString()} deprioritised (non-Latin names)`
  );
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
