/**
 * eBay Scraper — Extracts sold listing data from eBay
 *
 * This module scrapes eBay's completed/sold listings for trading cards.
 * It uses fetch with proper headers to request eBay pages, then parses
 * the HTML to extract sale data.
 *
 * For production, this should be run via Vercel Cron or a separate
 * worker process. Consider adding proxy rotation (ScrapingBee, Bright Data)
 * if eBay rate-limits the requests.
 *
 * Usage:
 *   const sales = await scrapeEbaySales("Charizard Base Set PSA 10");
 */

import { parseGrade, type GradeResult } from '@/lib/grade-parser';
import { parsePriceToCents } from '@/lib/pricing-engine';

export interface EbaySaleResult {
  ebayItemId: string;
  title: string;
  price: number; // cents
  saleDate: Date;
  url: string;
  imageUrl?: string;
  grade: GradeResult;
}

export interface ScrapeOptions {
  /** Max number of pages to scrape (each page has ~60 results) */
  maxPages?: number;
  /** Delay between requests in ms */
  delayMs?: number;
  /** Custom user agent */
  userAgent?: string;
}

const DEFAULT_OPTIONS: Required<ScrapeOptions> = {
  maxPages: 2,
  delayMs: 2000,
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
};

/**
 * Build an eBay sold listings search URL.
 *
 * @param query - Search query (e.g., "Charizard Base Set 4/102")
 * @param page - Page number (1-indexed)
 * @returns Full eBay URL with sold/completed filters
 */
export function buildEbayUrl(query: string, page: number = 1): string {
  const params = new URLSearchParams({
    _nkw: query,
    _sacat: '183454', // Trading Cards category
    LH_Complete: '1', // Completed listings
    LH_Sold: '1', // Sold items only
    _sop: '13', // Sort by end date (newest first)
    _pgn: page.toString(),
    _ipg: '60', // 60 results per page
    rt: 'nc', // No cache
  });

  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

/**
 * Parse the HTML from an eBay sold listings page to extract sale data.
 *
 * This function uses regex patterns to extract data from eBay's HTML.
 * It's fragile by nature (eBay can change their markup) but handles
 * the current structure as of 2026.
 *
 * @param html - Raw HTML string from eBay
 * @returns Array of extracted sales
 */
export function parseEbayHtml(html: string): EbaySaleResult[] {
  const sales: EbaySaleResult[] = [];

  // Match each listing item in the search results
  // eBay uses <li> elements with specific data attributes or classes
  // Pattern: look for item containers with title, price, and date

  // Extract item blocks — eBay wraps each listing in a div with class s-item
  const itemPattern =
    /<li[^>]*class="[^"]*s-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let itemMatch;

  while ((itemMatch = itemPattern.exec(html)) !== null) {
    const itemHtml = itemMatch[1];

    // Skip "shop on eBay" promotional items
    if (itemHtml.includes('Shop on eBay')) continue;

    try {
      // Extract title
      const titleMatch = itemHtml.match(
        /<(?:span|div)[^>]*class="[^"]*s-item__title[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/i
      );
      const title = titleMatch
        ? titleMatch[1].replace(/<[^>]*>/g, '').trim()
        : '';
      if (!title || title === 'Shop on eBay') continue;

      // Extract price
      const priceMatch = itemHtml.match(
        /<span[^>]*class="[^"]*s-item__price[^"]*"[^>]*>([\s\S]*?)<\/span>/i
      );
      const priceText = priceMatch
        ? priceMatch[1].replace(/<[^>]*>/g, '').trim()
        : '';

      // Skip if price range (e.g., "$10.00 to $20.00") — we want single prices
      if (priceText.includes(' to ')) continue;

      const price = parsePriceToCents(priceText);
      if (price <= 0) continue;

      // Extract item ID from link
      const linkMatch = itemHtml.match(
        /href="https:\/\/www\.ebay\.com\/itm\/(\d+)/i
      );
      const ebayItemId = linkMatch ? linkMatch[1] : '';
      if (!ebayItemId) continue;

      const url = `https://www.ebay.com/itm/${ebayItemId}`;

      // Extract sold date
      const dateMatch = itemHtml.match(
        /<span[^>]*class="[^"]*s-item__ended-date[^"]*"[^>]*>([\s\S]*?)<\/span>/i
      ) || itemHtml.match(
        /<span[^>]*class="[^"]*POSITIVE[^"]*"[^>]*>Sold\s*([\s\S]*?)<\/span>/i
      );
      let saleDate = new Date();
      if (dateMatch) {
        const dateText = dateMatch[1].replace(/<[^>]*>/g, '').trim();
        const parsed = new Date(dateText);
        if (!isNaN(parsed.getTime())) {
          saleDate = parsed;
        }
      }

      // Extract image URL
      const imgMatch = itemHtml.match(
        /<img[^>]*src="(https:\/\/i\.ebayimg\.com[^"]*)"[^>]*>/i
      );
      const imageUrl = imgMatch ? imgMatch[1] : undefined;

      // Parse grade from title
      const grade = parseGrade(title);

      sales.push({
        ebayItemId,
        title,
        price,
        saleDate,
        url,
        imageUrl,
        grade,
      });
    } catch (e) {
      // Skip items that fail to parse
      console.warn('Failed to parse eBay item:', e);
      continue;
    }
  }

  return sales;
}

/**
 * Fetch and parse eBay sold listings for a search query.
 *
 * @param query - Search query (e.g., "Charizard Base Set #4 Pokemon")
 * @param options - Scraping options
 * @returns Array of sale results
 */
export async function scrapeEbaySales(
  query: string,
  options?: ScrapeOptions
): Promise<EbaySaleResult[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const allSales: EbaySaleResult[] = [];
  const seenIds = new Set<string>();

  for (let page = 1; page <= opts.maxPages; page++) {
    const url = buildEbayUrl(query, page);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': opts.userAgent,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
        },
      });

      if (!response.ok) {
        console.error(
          `eBay request failed: ${response.status} ${response.statusText}`
        );
        break;
      }

      const html = await response.text();
      const pageSales = parseEbayHtml(html);

      // Deduplicate
      for (const sale of pageSales) {
        if (!seenIds.has(sale.ebayItemId)) {
          seenIds.add(sale.ebayItemId);
          allSales.push(sale);
        }
      }

      // If we got fewer results than expected, there are no more pages
      if (pageSales.length < 20) break;

      // Delay between pages
      if (page < opts.maxPages) {
        await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
      }
    } catch (error) {
      console.error(`Error scraping page ${page}:`, error);
      break;
    }
  }

  return allSales;
}

/**
 * Build optimized eBay search queries for a specific card.
 *
 * Generates multiple queries to maximize coverage:
 * 1. Card name + set name + card number
 * 2. Card name + set name (broader)
 *
 * @param cardName - Card name (e.g., "Charizard")
 * @param setName - Set name (e.g., "Base Set")
 * @param cardNumber - Card number (e.g., "4/102")
 * @returns Array of search queries to try
 */
export function buildCardSearchQueries(
  cardName: string,
  setName: string,
  cardNumber?: string
): string[] {
  const queries: string[] = [];

  // Most specific query first
  if (cardNumber) {
    queries.push(`${cardName} ${setName} ${cardNumber} pokemon card`);
  }

  // Broader query
  queries.push(`${cardName} ${setName} pokemon card`);

  return queries;
}

/**
 * Scrape sales for a specific card and deduplicate across queries.
 */
export async function scrapeCardSales(
  cardName: string,
  setName: string,
  cardNumber?: string,
  options?: ScrapeOptions
): Promise<EbaySaleResult[]> {
  const queries = buildCardSearchQueries(cardName, setName, cardNumber);
  const allSales: EbaySaleResult[] = [];
  const seenIds = new Set<string>();

  for (const query of queries) {
    const sales = await scrapeEbaySales(query, options);

    for (const sale of sales) {
      if (!seenIds.has(sale.ebayItemId)) {
        seenIds.add(sale.ebayItemId);
        allSales.push(sale);
      }
    }

    // Small delay between different queries
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Sort by date descending (newest first)
  allSales.sort((a, b) => b.saleDate.getTime() - a.saleDate.getTime());

  return allSales;
}
