import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, and, sql } from 'drizzle-orm';
import * as schema from '../db/schema';
import { parseGrade } from './grade-parser';
import { decodeHtmlEntities } from './html-entities';

/**
 * Fold accented Latin characters to ASCII ("Flabébé" → "Flabebe", "Poké" →
 * "Poke"). Without this, every accented card name failed the ASCII guard below
 * and was skipped outright — which silently excluded Flabébé, Nidoran ♀/♂ and
 * every Poké-prefixed trainer card from pricing.
 */
function foldAccents(input: string): string {
  return input.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * True only for scripts PriceCharting genuinely has no slug for (CJK/kana).
 * Accented Latin is handled by foldAccents and must NOT land here.
 */
export function hasNonLatinScript(input: string): boolean {
  return /[　-鿿＀-￯]/.test(input);
}

/**
 * Subsets that pokemontcg.io models as their own set but PriceCharting files
 * under the parent set. Verified: Hidden Fates Shiny Vault "Ho-Oh-GX #SV50"
 * lives at /pokemon-hidden-fates/ho-oh-gx-sv50, not /pokemon-hidden-fates-shiny-vault/.
 */
const SUBSET_SUFFIX = /\s+(Trainer Gallery|Shiny Vault|Galarian Gallery)$/i;

/**
 * Every English "<Era> Black Star Promos" set is one PriceCharting console:
 * `pokemon-promo`. Verified: Charizard VSTAR #SWSH262 → /pokemon-promo/charizard-vstar-swsh262.
 */
const PROMO_SET = /black star promos$/i;

export function getPriceChartingConsole(setName: string): string {
  const isJapanese = setName.toLowerCase().includes('(japanese)');

  if (!isJapanese && PROMO_SET.test(setName.trim())) {
    return 'pokemon-promo';
  }

  let cleanName = foldAccents(setName)
    .replace(SUBSET_SUFFIX, '')
    .toLowerCase()
    .replace('(japanese)', '')
    .trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');

  if (cleanName === 'base' || cleanName === 'base-set') cleanName = 'base-set';

  if (isJapanese) {
    return `pokemon-japanese-${cleanName}`;
  }
  return `pokemon-${cleanName}`;
}

/**
 * Render the card-number suffix of a PriceCharting slug.
 *
 * The previous implementation ran parseInt over the digits only, which
 * destroyed every letter-prefixed number: "TG30" became "-30" and "SWSH098"
 * became "-98", so all 3,020 such cards 302'd to PriceCharting's search page
 * and were recorded as failures. PriceCharting keeps the prefix and its
 * zero-padding verbatim, lowercased ("-tg30", "-swsh098", "-sv50").
 *
 * Plain numeric ids do get normalised, since "001" is served as "-1".
 */
export function formatCardNumber(cardNumber: string | null): string {
  if (!cardNumber) return '';

  const trimmed = cardNumber.trim();

  // Letter-prefixed subset/promo numbering: keep as-is, lowercased.
  if (/^[A-Za-z]+[0-9]+$/.test(trimmed)) {
    return `-${trimmed.toLowerCase()}`;
  }

  // Plain digits: drop leading zeros.
  if (/^[0-9]+$/.test(trimmed)) {
    return `-${parseInt(trimmed, 10)}`;
  }

  // Anything else ("101a", "n/total"): sanitise conservatively.
  const fallback = trimmed.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return fallback ? `-${fallback}` : '';
}

export function getPriceChartingGameName(
  cardName: string,
  variant: string,
  cardNumber: string | null
): string {
  // PriceCharting KEEPS apostrophes in its slugs ("erika's-vileplume-5") and
  // DROPS periods ("lt-surge's-electabuzz-6", not "lt.-surge's-..."). Verified
  // against live URLs — stripping the apostrophe 302s to their search page.
  const cleanName = foldAccents(cardName)
    .toLowerCase()
    .replace('(japanese)', '')
    .trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s'-]/g, '')
    .replace(/\s+/g, '-');

  let pcVariant = '';
  if (variant === '1st_edition') pcVariant = '-1st-edition';
  if (variant === 'shadowless') pcVariant = '-shadowless';
  if (variant === 'reverse_holo') pcVariant = '-reverse-foil';

  return `${cleanName}${pcVariant}${formatCardNumber(cardNumber)}`;
}

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

export interface PCScrapeResult {
  success: boolean;
  url: string;
  salesInserted: number;
  pricesUpdated: number;
  /** Sales dropped because the title named a different variant. */
  variantRejects?: number;
  error?: string;
}

export async function scrapePriceChartingCard(
  db: any,
  card: {
    id: number;
    name: string;
    variant: string;
    cardNumber: string | null;
    setName: string;
  }
): Promise<PCScrapeResult> {
  // PriceCharting has no slug for CJK/kana names. Accented Latin is fine —
  // it gets folded to ASCII by the slug builders, so Flabébé and Poké Ball
  // are scraped rather than skipped.
  if (hasNonLatinScript(card.name) || hasNonLatinScript(card.setName)) {
    return {
      success: false,
      url: '',
      salesInserted: 0,
      pricesUpdated: 0,
      error: 'Skipped: non-Latin name (PriceCharting requires an English slug)',
    };
  }

  const consoleSlug = getPriceChartingConsole(card.setName);
  const gameSlug = getPriceChartingGameName(card.name, card.variant, card.cardNumber);
  // Apostrophes survive into the slug, so the path segments must be encoded.
  const url = `https://www.pricecharting.com/game/${encodeURIComponent(consoleSlug)}/${encodeURIComponent(gameSlug)}`;

  try {
    // PriceCharting rate-limits aggressively. Back off and retry rather than
    // burning the card — a 429 means "slow down", not "this card is bad".
    const MAX_ATTEMPTS = 4;
    let res: Response | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      if (res.status !== 429 && res.status < 500) break;

      if (attempt < MAX_ATTEMPTS - 1) {
        const retryAfter = parseInt(res.headers.get('retry-after') ?? '', 10);
        const backoff = Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : Math.min(30_000, 2000 * Math.pow(2, attempt)) + Math.random() * 500;
        await delay(backoff);
      }
    }

    if (!res || !res.ok) {
      return {
        success: false,
        url,
        salesInserted: 0,
        pricesUpdated: 0,
        error: `HTTP ${res?.status ?? '???'} ${res?.statusText ?? ''}`.trim(),
      };
    }

    const html = await res.text();

    // PriceCharting answers an unrecognised slug with a 302 to its search page
    // rather than a 404. Sometimes that search resolves to exactly the product
    // we wanted (apostrophes and periods in names — "Erika's Vileplume",
    // "Lt. Surge's Electabuzz" — are the common cause); sometimes it lands on a
    // results list with no price table. Fetch follows the redirect for us, so
    // the only reliable signal is whether we ended up on a product page.
    if (!/<table id="price_data"/i.test(html)) {
      return {
        success: false,
        url,
        salesInserted: 0,
        pricesUpdated: 0,
        error: 'no price table (redirected to search — slug miss)',
      };
    }

    // Guard against the search landing us on a DIFFERENT product. The h1 is
    // "<Name> [Variant] #<Number> Pokemon <Set>"; require the card number to
    // match, which is the cheapest reliable discriminator.
    if (res.url && res.url !== url && card.cardNumber) {
      const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '';
      const h1Text = decodeHtmlEntities(h1.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
      const wantNum = card.cardNumber.replace(/[^0-9]/g, '');
      const gotNum = h1Text.match(/#\s*([0-9]+)/)?.[1];
      if (wantNum && gotNum && wantNum.replace(/^0+/, '') !== gotNum.replace(/^0+/, '')) {
        return {
          success: false,
          url,
          salesInserted: 0,
          pricesUpdated: 0,
          error: `redirect resolved to wrong product (#${gotNum} != #${wantNum})`,
        };
      }
    }

    // 1. Extract Baseline Prices from #price_data table
    let pricesUpdated = 0;
    const priceRows: (typeof schema.currentPrices.$inferInsert)[] = [];
    const priceTableMatch = html.match(/<table id="price_data"[^>]*>([\s\S]*?)<\/table>/i);

    if (priceTableMatch) {
      const tableHtml = priceTableMatch[1];

      /**
       * PriceCharting's #price_data table is column-aligned across three rows:
       *
       *   row 0: <th>Ungraded</th><th>Grade 7</th>...
       *   row 1: <td id="used_price">$370.44</td>...
       *   row 2: <td class="js-show-tab">volume: 1 sale per week</td>...
       *
       * followed by a duplicate responsive block repeating some columns.
       *
       * We must zip by COLUMN INDEX within that row group, not by flattening
       * headers and prices into two separate arrays: a condition with no price
       * yields an empty cell, and a flat zip would silently shift every
       * subsequent condition by one (writing Grade 8 prices into Grade 7).
       * The cell ids are no help — they're generic video-game names
       * (used_price/complete_price/...) reused for whatever columns are shown.
       */
      const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);

      /** Cells of one row, in order, excluding the trailing "more prices" link. */
      const cellsOf = (rowHtml: string) =>
        [...rowHtml.matchAll(/<(th|td)([^>]*)>([\s\S]*?)<\/\1>/gi)]
          .filter((c) => !/more-prices-link/i.test(c[2]))
          .map((c) => c[3]);

      const headerRowIdx = rows.findIndex((r) => /<th[^>]*>/i.test(r));

      const headerMatches: string[] =
        headerRowIdx === -1
          ? []
          : cellsOf(rows[headerRowIdx]).map((c) =>
              decodeHtmlEntities(c.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
            );

      // Price row is the one immediately after the headers. Take the first
      // dollar amount in each cell — the second is the day-over-day change.
      const priceCells = headerRowIdx === -1 ? [] : cellsOf(rows[headerRowIdx + 1] ?? '');
      const priceMatches: number[] = priceCells.map((cell) => {
        const m = cell.match(/\$([0-9,]+(?:\.[0-9]{1,2})?)/);
        return m ? parseFloat(m[1].replace(/,/g, '')) : NaN;
      });

      const volumeCells = headerRowIdx === -1 ? [] : cellsOf(rows[headerRowIdx + 2] ?? '');
      const volumeMatches: (string | null)[] = volumeCells.map((cell) => {
        const text = decodeHtmlEntities(cell.replace(/<[^>]+>/g, ' '))
          .replace(/\s+/g, ' ')
          .trim()
          // Cell reads "volume: 1 sale per week"; we store just the rate, which
          // is the format the card detail page already renders.
          .replace(/^volume:\s*/i, '');
        return text.length > 0 ? text : null;
      });

      const conditionMap: Record<string, string> = {
        'Ungraded': 'UNGRADED',
        'Grade 1': 'GRADE_1',
        'Grade 2': 'GRADE_2',
        'Grade 3': 'GRADE_3',
        'Grade 4': 'GRADE_4',
        'Grade 5': 'GRADE_5',
        'Grade 6': 'GRADE_6',
        'Grade 7': 'GRADE_7',
        'Grade 8': 'GRADE_8',
        'Grade 9': 'GRADE_9',
        'Grade 9.5': 'GRADE_9_5',
        'PSA 10': 'PSA_10',
        'CGC 10': 'CGC_10',
        'BGS 10': 'BGS_10',
        'SGC 10': 'SGC_10',
        'TAG 10': 'TAG_10',
      };

      const gradingCompanyFor = (cond: string) => {
        if (cond === 'PSA_10') return 'PSA';
        if (cond === 'CGC_10') return 'CGC';
        if (cond === 'BGS_10') return 'BGS';
        if (cond === 'SGC_10') return 'SGC';
        if (cond === 'TAG_10') return 'TAG';
        return 'UNGRADED';
      };

      // Iterate the header columns. A column whose price cell was empty yields
      // NaN and is skipped below without disturbing the alignment of the rest.
      for (let i = 0; i < headerMatches.length; i++) {
        const header = headerMatches[i];
        const priceVal = priceMatches[i];
        const volText = volumeMatches[i] ?? null;

        const mappedCond = conditionMap[header];
        if (mappedCond && priceVal !== undefined && !isNaN(priceVal) && priceVal > 0) {
          priceRows.push({
            cardId: card.id,
            condition: mappedCond as any,
            gradingCompany: gradingCompanyFor(mappedCond) as any,
            // marketPrice seeds a brand-new row only; on conflict the pricing
            // engine's value is left alone (see the ON CONFLICT set below).
            marketPrice: Math.round(priceVal * 100),
            baselinePrice: Math.round(priceVal * 100),
            baselineSource: 'pricecharting',
            priceSource: 'baseline',
            volumeText: volText,
            saleCount: 0,
            updatedAt: new Date(),
          });
        }
      }

      // One statement for every condition on the card. This used to be a
      // SELECT plus an UPDATE or INSERT per condition — up to 30 sequential
      // Neon round trips per card, which dominated the backfill's runtime.
      if (priceRows.length > 0) {
        await db
          .insert(schema.currentPrices)
          .values(priceRows)
          .onConflictDoUpdate({
            target: [
              schema.currentPrices.cardId,
              schema.currentPrices.condition,
              schema.currentPrices.gradingCompany,
            ],
            set: {
              // Baseline columns only. marketPrice is owned by the pricing
              // engine — writing it here is what made our computed prices
              // invisible in the first place.
              baselinePrice: sql`excluded.baseline_price`,
              baselineSource: sql`excluded.baseline_source`,
              volumeText: sql`excluded.volume_text`,
              updatedAt: new Date(),
            },
          });
        pricesUpdated = priceRows.length;
      }
    }

    // 2. Extract Completed Sales Rows (<tr id="ebay-..." or <tr id="tcgplayer-...")
    let salesInserted = 0;
    let variantRejects = 0;
    const saleRows: (typeof schema.sales.$inferInsert)[] = [];
    const rowMatches = [...html.matchAll(/<tr id="([^"]+)">([\s\S]*?)<\/tr>/gi)];

    for (const match of rowMatches) {
      const itemId = match[1]; // e.g. "ebay-318558565306" or "tcgplayer-5rcjg9MHXDui"
      const rowContent = match[2];

      // Extract Date (YYYY-MM-DD)
      const dateMatch = rowContent.match(/<td class="date">\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\s*<\/td>/i);
      if (!dateMatch) continue;
      const saleDate = new Date(dateMatch[1]);

      // Extract Title
      const titleMatch = rowContent.match(/<td class="title">[\s\S]*?<a[^>]*>\s*([\s\S]*?)\s*<\/a>/i);
      if (!titleMatch) continue;
      // Decode entities before storing: PriceCharting emits "NM-MT&#43;9" and
      // "Black &amp; White", which otherwise reach both the grade parser and
      // the on-site sales table verbatim.
      const ebayTitle = decodeHtmlEntities(
        titleMatch[1].replace(/<[^>]+>/g, '')
      )
        .replace(/\s+/g, ' ')
        .trim();

      // Extract Price ($xx.xx)
      const priceMatch = rowContent.match(/<span class="js-price"[^>]*>\s*\$([0-9,.]+)\s*<\/span>/i);
      if (!priceMatch) continue;
      const priceFloat = parseFloat(priceMatch[1].replace(/,/g, ''));
      if (isNaN(priceFloat) || priceFloat <= 0) continue;
      const salePriceCents = Math.round(priceFloat * 100);

      // Parse condition using grade-parser
      const gradeResult = parseGrade(ebayTitle);

      // Variant guard — reject only CONTRADICTING evidence.
      //
      // We already fetched a variant-specific URL, so the page is mostly right;
      // what leaks through is PriceCharting's own contamination (their
      // non-reverse Legendary Collection page carries ~9% reverse-foil sales,
      // which is how a $28,600 reverse-foil PSA 10 ended up pooled with ~$200
      // normal sales).
      //
      // The guard must not require positive confirmation: only 11 of 32,621
      // reverse-holo sales actually say "reverse" in the title, so demanding a
      // match would discard ~99.9% of them. parseVariant also returns
      // 'unlimited' as its default, which means "no marker found" rather than
      // "this is unlimited". So we drop a sale only when the title explicitly
      // claims a variant that differs from the card being scraped.
      const explicitVariant =
        gradeResult.variant !== 'unlimited' ? gradeResult.variant : null;

      if (explicitVariant && explicitVariant !== card.variant) {
        variantRejects++;
        continue;
      }

      saleRows.push({
        cardId: card.id,
        condition: gradeResult.condition,
        gradingCompany: gradeResult.gradingCompany,
        gradeValue: gradeResult.gradeValue ? gradeResult.gradeValue.toString() : null,
        salePrice: salePriceCents,
        saleDate,
        ebayItemId: itemId,
        ebayTitle,
        ebayUrl: url,
        source: itemId.startsWith('ebay-')
          ? 'pricecharting:ebay'
          : itemId.startsWith('tcgplayer-')
            ? 'pricecharting:tcgplayer'
            : 'pricecharting:auction',
        isOutlier: false,
        gradeConfidence: gradeResult.confidence,
      });
    }

    // Bulk-insert the page's sales. A busy card's page carries 400+ rows, and
    // inserting them one at a time was by far the most expensive thing the
    // scraper did. onConflictDoNothing handles the dedup that the old
    // per-row try/catch was doing.
    if (saleRows.length > 0) {
      // A page can list the same item id twice (it appears under more than one
      // condition tab); Postgres rejects a batch that conflicts with itself.
      const deduped = [
        ...new Map(saleRows.map((r) => [r.ebayItemId, r])).values(),
      ];

      const SALE_CHUNK = 500;
      for (let i = 0; i < deduped.length; i += SALE_CHUNK) {
        const inserted = await db
          .insert(schema.sales)
          .values(deduped.slice(i, i + SALE_CHUNK))
          .onConflictDoNothing({ target: schema.sales.ebayItemId })
          .returning({ id: schema.sales.id });
        salesInserted += inserted.length;
      }
    }

    return {
      success: true,
      url,
      salesInserted,
      pricesUpdated,
      variantRejects,
    };
  } catch (err: any) {
    // Drizzle wraps driver errors and its `message` is the full SQL text, which
    // buries the actual Postgres complaint. The useful detail is on `cause`.
    const cause = err?.cause;
    const detail = cause
      ? [cause.code, cause.message, cause.detail].filter(Boolean).join(' | ')
      : null;

    return {
      success: false,
      url,
      salesInserted: 0,
      pricesUpdated: 0,
      error: detail ?? err.message ?? String(err),
    };
  }
}
