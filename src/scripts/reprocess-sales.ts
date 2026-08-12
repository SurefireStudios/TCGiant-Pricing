/**
 * Reprocess Sales — Replay the fixed grade parser and pricing engine over data
 * that was ingested with the old, broken versions.
 *
 * Why this exists:
 *   - The grade parser did not recognise "PSA MINT 9" / "CGC Gem Mint 10" style
 *     titles, so thousands of graded sales were stored as UNGRADED.
 *   - SGC was not a known grading company at all.
 *   - Scraped titles kept their HTML entities ("NM-MT&#43;9"), which both hid
 *     grades from the parser and rendered as entity text on the site.
 *   - current_prices.market_price was pinned to the scraped baseline, so the
 *     pricing engine's output was never visible.
 *
 * Usage:
 *   npx tsx src/scripts/reprocess-sales.ts --dry-run   # report only, no writes
 *   npx tsx src/scripts/reprocess-sales.ts             # apply
 *   npx tsx src/scripts/reprocess-sales.ts --phase=1   # titles/grades only
 *   npx tsx src/scripts/reprocess-sales.ts --phase=2   # prices only
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema';
import { parseGrade, canonicalGradingCompany } from '../lib/grade-parser';
import { decodeHtmlEntities } from '../lib/html-entities';
import {
  computePrice,
  detectOutliers,
  type Sale as PricingSale,
} from '../lib/pricing-engine';

const READ_BATCH = 5000;
const WRITE_BATCH = 500;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const phaseArg = args.find((a) => a.startsWith('--phase='));
const PHASE = phaseArg ? parseInt(phaseArg.split('=')[1], 10) : 0; // 0 = both

/** Minimum non-outlier sales before we trust our computed price. Mirrors price-updater. */
const MIN_SAMPLES_TO_TRUST = 3;

const sqlClient = neon(process.env.DATABASE_URL!);
const db = drizzle(sqlClient, { schema });

function pct(n: number, total: number): string {
  return total === 0 ? '0%' : `${((n / total) * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Phase 0 — collapse duplicate price rows onto canonical keys
// ---------------------------------------------------------------------------

/** Conditions where the grading company is genuinely part of the price identity. */
const COMPANY_SPECIFIC = `('PSA_10','CGC_10','BGS_10','SGC_10','TAG_10')`;

async function collapseDuplicateRows() {
  console.log('\n=== Phase 0: collapsing duplicate price rows ===\n');

  const before = (await sqlClient.query(
    `SELECT count(*) n FROM (SELECT card_id, condition FROM current_prices GROUP BY 1,2 HAVING count(*) > 1) t`
  )) as unknown as { n: string }[];
  console.log(`  card+condition pairs with duplicate rows: ${Number(before[0].n).toLocaleString()}`);

  if (DRY_RUN) {
    const detail = (await sqlClient.query(
      `SELECT grading_company, count(*) n FROM current_prices
       WHERE condition NOT IN ${COMPANY_SPECIFIC} AND grading_company <> 'UNGRADED'
       GROUP BY 1 ORDER BY 2 DESC`
    )) as unknown as { grading_company: string; n: string }[];
    console.log('  rows that would be removed (non-10 grades split by company):');
    for (const d of detail) console.log(`    ${d.grading_company.padEnd(10)} ${Number(d.n).toLocaleString()}`);
    console.log('  [dry run] no writes performed');
    return;
  }

  // 1. The old scraper wrote every non-PSA_10 baseline under 'UNGRADED', which is
  //    the wrong key for CGC_10 / BGS_10 / SGC_10 / TAG_10. Move those baselines
  //    onto the row that actually represents them before anything is deleted.
  const moved = await sqlClient.query(
    `UPDATE current_prices AS target
       SET baseline_price  = src.baseline_price,
           baseline_source = src.baseline_source
     FROM current_prices AS src
     WHERE src.card_id = target.card_id
       AND src.condition = target.condition
       AND src.grading_company = 'UNGRADED'
       AND target.condition IN ${COMPANY_SPECIFIC}
       AND target.grading_company <> 'UNGRADED'
       AND target.baseline_price IS NULL
       AND src.baseline_price IS NOT NULL`
  );
  console.log(`  baselines relocated to company-specific rows: ${(moved as any).rowCount ?? '?'}`);

  // 2. Drop the now-redundant 'UNGRADED' rows for company-specific conditions.
  const delA = await sqlClient.query(
    `DELETE FROM current_prices WHERE condition IN ${COMPANY_SPECIFIC} AND grading_company = 'UNGRADED'`
  );
  console.log(`  removed UNGRADED rows for *_10 conditions:    ${(delA as any).rowCount ?? '?'}`);

  // 3. Drop the per-company splits of company-agnostic grades. Genuine
  //    PriceCharting baselines for these always landed on the 'UNGRADED' row,
  //    so nothing real is lost; phase 2 recomputes the surviving row from the
  //    full set of sales across all graders.
  const delB = await sqlClient.query(
    `DELETE FROM current_prices WHERE condition NOT IN ${COMPANY_SPECIFIC} AND grading_company <> 'UNGRADED'`
  );
  console.log(`  removed per-company splits of plain grades:   ${(delB as any).rowCount ?? '?'}`);

  // 4. Be honest about provenance. Migration 0001 copied every existing
  //    market_price into baseline_price and labelled it 'pricecharting', but
  //    only the rows the PC scraper actually wrote are true baselines — the
  //    rest were stale values left by the old pipeline. We cannot tell them
  //    apart retroactively, so mark them unverified and let the next scrape
  //    pass overwrite them with correctly attributed values.
  const relabelled = await sqlClient.query(
    `UPDATE current_prices SET baseline_source = 'legacy-unverified'
     WHERE baseline_price IS NOT NULL AND baseline_source = 'pricecharting'`
  );
  console.log(`  baselines relabelled as unverified:           ${(relabelled as any).rowCount ?? '?'}`);

  const after = (await sqlClient.query(
    `SELECT count(*) n FROM (SELECT card_id, condition FROM current_prices GROUP BY 1,2 HAVING count(*) > 1) t`
  )) as unknown as { n: string }[];
  console.log(`\n  duplicate pairs remaining: ${Number(after[0].n).toLocaleString()}`);
}

// ---------------------------------------------------------------------------
// Phase 3 — drop sales whose title names a different variant
// ---------------------------------------------------------------------------

async function dropVariantMismatches() {
  console.log('\n=== Phase 3: removing variant-mismatched sales ===\n');

  let lastId = 0;
  let scanned = 0;
  const doomed: number[] = [];
  const byVariant = new Map<string, number>();

  for (;;) {
    const rows = (await sqlClient.query(
      `SELECT s.id, s.ebay_title, c.variant
       FROM sales s JOIN cards c ON c.id = s.card_id
       WHERE s.id > $1 ORDER BY s.id LIMIT $2`,
      [lastId, READ_BATCH]
    )) as unknown as { id: number; ebay_title: string | null; variant: string }[];

    if (rows.length === 0) break;

    for (const row of rows) {
      lastId = row.id;
      scanned++;

      const parsed = parseGrade(row.ebay_title ?? '').variant;
      // 'unlimited' is parseVariant's default for "no marker found", so it is
      // not evidence of anything. Only an explicit, contradicting claim counts.
      if (parsed === 'unlimited' || parsed === row.variant) continue;

      doomed.push(row.id);
      const key = `${row.variant} <- ${parsed}`;
      byVariant.set(key, (byVariant.get(key) ?? 0) + 1);
    }
    process.stdout.write(`\r  scanned ${scanned.toLocaleString()} · mismatched ${doomed.length.toLocaleString()}   `);
  }

  console.log(`\n\n  Sales scanned:  ${scanned.toLocaleString()}`);
  console.log(`  Mismatched:     ${doomed.length.toLocaleString()} (${pct(doomed.length, scanned)})`);
  for (const [k, v] of [...byVariant.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`    ${k.padEnd(30)} ${v.toLocaleString()}`);
  }

  if (DRY_RUN) {
    console.log('\n  [dry run] no writes performed');
    return;
  }

  for (let i = 0; i < doomed.length; i += WRITE_BATCH) {
    const chunk = doomed.slice(i, i + WRITE_BATCH);
    await sqlClient.query(`DELETE FROM sales WHERE id = ANY($1::int[])`, [chunk]);
    process.stdout.write(`\r  deleting ${Math.min(i + WRITE_BATCH, doomed.length).toLocaleString()}/${doomed.length.toLocaleString()}   `);
  }
  console.log('');
  await sqlClient.query(`VACUUM sales`);
}

// ---------------------------------------------------------------------------
// Phase 1 — re-parse titles and grades
// ---------------------------------------------------------------------------

interface SaleRow {
  id: number;
  ebay_title: string | null;
  condition: string;
  grading_company: string;
  grade_value: string | null;
  grade_confidence: string | null;
}

async function reparseGrades() {
  console.log('\n=== Phase 1: re-parsing titles and grades ===\n');

  let lastId = 0;
  let scanned = 0;
  let titlesDecoded = 0;
  let conditionChanged = 0;
  let companyChanged = 0;
  const movements = new Map<string, number>();
  const pending: {
    id: number;
    title: string;
    condition: string;
    company: string;
    grade: string | null;
    confidence: string;
  }[] = [];

  const flush = async () => {
    if (pending.length === 0 || DRY_RUN) {
      pending.length = 0;
      return;
    }
    for (let i = 0; i < pending.length; i += WRITE_BATCH) {
      const chunk = pending.slice(i, i + WRITE_BATCH);
      // One statement per chunk: the Neon HTTP driver costs a full round trip
      // per statement, so row-at-a-time updates would dominate the runtime.
      await sqlClient.query(
        `UPDATE sales AS s SET
           ebay_title      = v.title,
           condition       = v.condition::card_condition,
           grading_company = v.company::grading_company,
           grade_value     = v.grade::numeric,
           grade_confidence= v.confidence
         FROM (
           SELECT * FROM unnest(
             $1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[]
           ) AS t(id, title, condition, company, grade, confidence)
         ) AS v
         WHERE s.id = v.id`,
        [
          chunk.map((c) => c.id),
          chunk.map((c) => c.title),
          chunk.map((c) => c.condition),
          chunk.map((c) => c.company),
          chunk.map((c) => c.grade),
          chunk.map((c) => c.confidence),
        ]
      );
    }
    pending.length = 0;
  };

  for (;;) {
    const rows = (await sqlClient.query(
      `SELECT id, ebay_title, condition, grading_company, grade_value, grade_confidence
       FROM sales WHERE id > $1 ORDER BY id LIMIT $2`,
      [lastId, READ_BATCH]
    )) as unknown as SaleRow[];

    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;
      lastId = row.id;

      const original = row.ebay_title ?? '';
      const decoded = decodeHtmlEntities(original).replace(/\s+/g, ' ').trim();
      if (decoded !== original) titlesDecoded++;

      const parsed = parseGrade(decoded);

      const condChanged = parsed.condition !== row.condition;
      const coChanged = parsed.gradingCompany !== row.grading_company;

      if (!condChanged && !coChanged && decoded === original) continue;

      if (condChanged) {
        conditionChanged++;
        const key = `${row.condition} -> ${parsed.condition}`;
        movements.set(key, (movements.get(key) || 0) + 1);
      }
      if (coChanged) companyChanged++;

      pending.push({
        id: row.id,
        title: decoded,
        condition: parsed.condition,
        company: parsed.gradingCompany,
        grade: parsed.gradeValue !== null ? String(parsed.gradeValue) : null,
        confidence: parsed.confidence,
      });
    }

    await flush();
    process.stdout.write(
      `\r  scanned ${scanned.toLocaleString()} · reclassified ${conditionChanged.toLocaleString()} · titles fixed ${titlesDecoded.toLocaleString()}   `
    );
  }

  await flush();

  console.log(`\n\n  Sales scanned:         ${scanned.toLocaleString()}`);
  console.log(`  Titles entity-decoded: ${titlesDecoded.toLocaleString()} (${pct(titlesDecoded, scanned)})`);
  console.log(`  Condition changed:     ${conditionChanged.toLocaleString()} (${pct(conditionChanged, scanned)})`);
  console.log(`  Grading co. changed:   ${companyChanged.toLocaleString()} (${pct(companyChanged, scanned)})`);

  const top = [...movements.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (top.length > 0) {
    console.log('\n  Largest reclassifications:');
    for (const [move, count] of top) {
      console.log(`    ${move.padEnd(28)} ${count.toLocaleString()}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — recompute outliers and prices
// ---------------------------------------------------------------------------

interface PriceSaleRow {
  id: number;
  card_id: number;
  condition: string;
  grading_company: string;
  sale_price: number;
  sale_date: string;
  is_outlier: boolean;
}

async function recomputePrices() {
  console.log('\n=== Phase 2: recomputing outliers and prices ===\n');

  // Pull every sale once and group in memory. The per-card/per-combo query loop
  // in price-updater costs dozens of round trips per card, which is far too
  // slow for a full-table pass.
  const groups = new Map<string, PriceSaleRow[]>();
  let lastId = 0;
  let loaded = 0;

  for (;;) {
    const rows = (await sqlClient.query(
      `SELECT id, card_id, condition, grading_company, sale_price, sale_date, is_outlier
       FROM sales WHERE id > $1 ORDER BY id LIMIT $2`,
      [lastId, READ_BATCH]
    )) as unknown as PriceSaleRow[];

    if (rows.length === 0) break;

    for (const r of rows) {
      lastId = r.id;
      loaded++;
      // Group on the canonical company so every grader's Grade 9 sales feed a
      // single price. Only the *_10 conditions stay split by company.
      const canonical = canonicalGradingCompany(r.condition, r.grading_company);
      const key = `${r.card_id}|${r.condition}|${canonical}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(r);
      else groups.set(key, [r]);
    }
    process.stdout.write(`\r  loaded ${loaded.toLocaleString()} sales into ${groups.size.toLocaleString()} groups   `);
  }
  console.log('');

  // Baselines, so we know when to fall back rather than show a thin computed price.
  const baselineRows = (await sqlClient.query(
    `SELECT card_id, condition, grading_company, baseline_price FROM current_prices`
  )) as unknown as {
    card_id: number;
    condition: string;
    grading_company: string;
    baseline_price: number | null;
  }[];

  const baselines = new Map<string, number | null>();
  for (const b of baselineRows) {
    baselines.set(`${b.card_id}|${b.condition}|${b.grading_company}`, b.baseline_price);
  }

  const priceUpserts: {
    cardId: number;
    condition: string;
    gradingCompany: string;
    marketPrice: number;
    medianPrice: number;
    priceSource: string;
    saleCount: number;
    lastSaleDate: Date;
  }[] = [];

  const outlierFlips: { id: number; isOutlier: boolean }[] = [];
  let computed = 0;
  let usedBaseline = 0;
  let skipped = 0;

  for (const [key, rows] of groups) {
    // Newest first — the pricing engine's recency weighting depends on it.
    rows.sort((a, b) => new Date(b.sale_date).getTime() - new Date(a.sale_date).getTime());

    const window = rows.slice(0, 50);
    const pricingSales: PricingSale[] = window.map((r) => ({
      id: String(r.id),
      price: r.sale_price,
      saleDate: new Date(r.sale_date),
    }));

    const result = computePrice(pricingSales);
    if (!result) {
      skipped++;
      continue;
    }

    // Recompute outlier flags over the same window the price used.
    const outlierIdx = detectOutliers(window.map((r) => r.sale_price));
    for (let i = 0; i < window.length; i++) {
      const shouldBe = outlierIdx.has(i);
      if (shouldBe !== window[i].is_outlier) {
        outlierFlips.push({ id: window[i].id, isOutlier: shouldBe });
      }
    }

    const [cardIdStr, condition, gradingCompany] = key.split('|');
    const baseline = baselines.get(key) ?? null;
    const trust = result.saleCount >= MIN_SAMPLES_TO_TRUST;

    if (trust) computed++;
    else if (baseline) usedBaseline++;

    priceUpserts.push({
      cardId: parseInt(cardIdStr, 10),
      condition,
      gradingCompany,
      marketPrice: trust ? result.marketPrice : (baseline ?? result.marketPrice),
      medianPrice: result.medianPrice,
      priceSource: trust ? 'computed' : baseline ? 'baseline' : 'computed',
      saleCount: result.saleCount,
      lastSaleDate: new Date(window[0].sale_date),
    });
  }

  console.log(`\n  Groups with a price:  ${priceUpserts.length.toLocaleString()}`);
  console.log(`    from our engine:    ${computed.toLocaleString()}`);
  console.log(`    from baseline:      ${usedBaseline.toLocaleString()}`);
  console.log(`  Groups skipped:       ${skipped.toLocaleString()} (no credible sales)`);
  console.log(`  Outlier flags to flip:${outlierFlips.length.toLocaleString()}`);

  if (DRY_RUN) {
    console.log('\n  [dry run] no writes performed');
    return;
  }

  // Write outlier flags.
  for (let i = 0; i < outlierFlips.length; i += WRITE_BATCH) {
    const chunk = outlierFlips.slice(i, i + WRITE_BATCH);
    await sqlClient.query(
      `UPDATE sales AS s SET is_outlier = v.flag
       FROM (SELECT * FROM unnest($1::int[], $2::bool[]) AS t(id, flag)) AS v
       WHERE s.id = v.id`,
      [chunk.map((c) => c.id), chunk.map((c) => c.isOutlier)]
    );
    process.stdout.write(`\r  writing outlier flags ${Math.min(i + WRITE_BATCH, outlierFlips.length).toLocaleString()}/${outlierFlips.length.toLocaleString()}   `);
  }
  console.log('');

  // Write prices.
  for (let i = 0; i < priceUpserts.length; i += WRITE_BATCH) {
    const chunk = priceUpserts.slice(i, i + WRITE_BATCH);
    await db
      .insert(schema.currentPrices)
      .values(
        chunk.map((c) => ({
          cardId: c.cardId,
          condition: c.condition as typeof schema.cardConditionEnum.enumValues[number],
          gradingCompany: c.gradingCompany as typeof schema.gradingCompanyEnum.enumValues[number],
          marketPrice: c.marketPrice,
          medianPrice: c.medianPrice,
          priceSource: c.priceSource,
          saleCount: c.saleCount,
          lastSaleDate: c.lastSaleDate,
          updatedAt: new Date(),
        }))
      )
      .onConflictDoUpdate({
        target: [
          schema.currentPrices.cardId,
          schema.currentPrices.condition,
          schema.currentPrices.gradingCompany,
        ],
        set: {
          marketPrice: sql`excluded.market_price`,
          medianPrice: sql`excluded.median_price`,
          priceSource: sql`excluded.price_source`,
          saleCount: sql`excluded.sale_count`,
          lastSaleDate: sql`excluded.last_sale_date`,
          updatedAt: new Date(),
        },
      });
    process.stdout.write(`\r  writing prices ${Math.min(i + WRITE_BATCH, priceUpserts.length).toLocaleString()}/${priceUpserts.length.toLocaleString()}   `);
  }
  console.log('');
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('=== TCGiant Sales Reprocessor ===');
  console.log(DRY_RUN ? 'MODE: dry run (no writes)' : 'MODE: apply');

  const start = Date.now();

  if (PHASE === 0) await collapseDuplicateRows();
  if (PHASE === 0 || PHASE === 3) await dropVariantMismatches();
  if (PHASE === 0 || PHASE === 1) await reparseGrades();
  if (PHASE === 0 || PHASE === 2) await recomputePrices();

  console.log(`\nDone in ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error('\nReprocess failed:', err);
  process.exit(1);
});
