import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, and } from 'drizzle-orm';
import * as schema from '../db/schema';
import { parseGrade } from './grade-parser';

export function getPriceChartingConsole(setName: string): string {
  let cleanName = setName
    .toLowerCase()
    .trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');

  if (cleanName === 'base' || cleanName === 'base-set') return 'pokemon-base-set';
  return `pokemon-${cleanName}`;
}

export function getPriceChartingGameName(
  cardName: string,
  variant: string,
  cardNumber: string | null
): string {
  let cleanName = cardName
    .toLowerCase()
    .trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');

  let pcVariant = '';
  if (variant === '1st_edition') pcVariant = '-1st-edition';
  if (variant === 'shadowless') pcVariant = '-shadowless';
  if (variant === 'reverse_holo') pcVariant = '-reverse-foil';

  const numPart = cardNumber ? `-${cardNumber.replace(/[^a-z0-9-]/gi, '')}` : '';
  return `${cleanName}${pcVariant}${numPart}`;
}

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

export interface PCScrapeResult {
  success: boolean;
  url: string;
  salesInserted: number;
  pricesUpdated: number;
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
  const consoleSlug = getPriceChartingConsole(card.setName);
  const gameSlug = getPriceChartingGameName(card.name, card.variant, card.cardNumber);
  const url = `https://www.pricecharting.com/game/${consoleSlug}/${gameSlug}`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!res.ok) {
      return {
        success: false,
        url,
        salesInserted: 0,
        pricesUpdated: 0,
        error: `HTTP ${res.status} ${res.statusText}`,
      };
    }

    const html = await res.text();

    // 1. Extract Baseline Prices from #price_data table
    let pricesUpdated = 0;
    const priceTableMatch = html.match(/<table id="price_data"[^>]*>([\s\S]*?)<\/table>/i);

    if (priceTableMatch) {
      const tableHtml = priceTableMatch[1];
      const headerMatches = [...tableHtml.matchAll(/<th[^>]*>(.*?)<\/th>/gi)].map((m) =>
        m[1].replace(/<[^>]+>/g, '').trim()
      );

      const priceMatches = [...tableHtml.matchAll(/<span class="price js-price">\s*\$([0-9,.]+)\s*<\/span>/gi)].map(
        (m) => parseFloat(m[1].replace(/,/g, ''))
      );

      const conditionMap: Record<string, string> = {
        'Ungraded': 'UNGRADED',
        'Grade 7': 'GRADE_7',
        'Grade 8': 'GRADE_8',
        'Grade 9': 'GRADE_9',
        'Grade 9.5': 'GRADE_9_5',
        'PSA 10': 'PSA_10',
      };

      for (let i = 0; i < headerMatches.length && i < priceMatches.length; i++) {
        const header = headerMatches[i];
        const priceVal = priceMatches[i];

        const mappedCond = conditionMap[header];
        if (mappedCond && !isNaN(priceVal) && priceVal > 0) {
          const priceCents = Math.round(priceVal * 100);

          // Upsert current price
          const existing = await db
            .select()
            .from(schema.currentPrices)
            .where(
              and(
                eq(schema.currentPrices.cardId, card.id),
                eq(schema.currentPrices.condition, mappedCond as any)
              )
            );

          if (existing.length > 0) {
            await db
              .update(schema.currentPrices)
              .set({
                marketPrice: priceCents,
                updatedAt: new Date(),
              })
              .where(eq(schema.currentPrices.id, existing[0].id));
          } else {
            await db.insert(schema.currentPrices).values({
              cardId: card.id,
              condition: mappedCond as any,
              gradingCompany: mappedCond === 'PSA_10' ? 'PSA' : 'UNGRADED',
              marketPrice: priceCents,
              saleCount: 0,
              updatedAt: new Date(),
            });
          }
          pricesUpdated++;
        }
      }
    }

    // 2. Extract Completed Sales Rows (<tr id="ebay-..." or <tr id="tcgplayer-...")
    let salesInserted = 0;
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
      const ebayTitle = titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

      // Extract Price ($xx.xx)
      const priceMatch = rowContent.match(/<span class="js-price"[^>]*>\s*\$([0-9,.]+)\s*<\/span>/i);
      if (!priceMatch) continue;
      const priceFloat = parseFloat(priceMatch[1].replace(/,/g, ''));
      if (isNaN(priceFloat) || priceFloat <= 0) continue;
      const salePriceCents = Math.round(priceFloat * 100);

      // Parse condition using grade-parser
      const gradeResult = parseGrade(ebayTitle);

      try {
        await db.insert(schema.sales).values({
          cardId: card.id,
          condition: gradeResult.condition,
          gradingCompany: gradeResult.gradingCompany,
          gradeValue: gradeResult.gradeValue ? gradeResult.gradeValue.toString() : null,
          salePrice: salePriceCents,
          saleDate,
          ebayItemId: itemId,
          ebayTitle,
          ebayUrl: `https://www.pricecharting.com/game/${consoleSlug}/${gameSlug}`,
          isOutlier: false,
          gradeConfidence: gradeResult.confidence,
        });
        salesInserted++;
      } catch (err: any) {
        // Unique index collision on ebayItemId — skip gracefully
        if (!err.message?.includes('duplicate key') && !err.message?.includes('unique constraint')) {
          // ignore duplicate insertions
        }
      }
    }

    return {
      success: true,
      url,
      salesInserted,
      pricesUpdated,
    };
  } catch (err: any) {
    return {
      success: false,
      url,
      salesInserted: 0,
      pricesUpdated: 0,
      error: err.message || String(err),
    };
  }
}
