/**
 * eBay Marketplace Insights — the only official source of eBay SOLD data.
 *
 * Endpoint: buy/marketplace_insights/v1_beta/item_sales/search
 * Scope:    https://api.ebay.com/oauth/api_scope/buy.marketplace.insights
 * Window:   the last 90 days of sales.
 *
 * This is a **Limited Release** API. A standard developer keyset cannot use it:
 * requesting the scope returns HTTP 400 `invalid_scope`, and calling the
 * endpoint with a basic token returns HTTP 403 `Insufficient permissions`.
 * Access must be granted by eBay for a specific production keyset.
 *
 * STATUS: **our application was DENIED.** eBay reserves this API for major
 * partners; being an active seller (the cardboardshop store) was not enough.
 * This module is kept because it costs nothing to keep and switches on with no
 * code change should that ever be revisited — but nothing should be planned
 * around it. Ungraded pricing comes from TCGdex; graded from PriceCharting.
 *
 * The client is written and tested against that failure so the switch-over is a
 * config change rather than a project: `isAvailable()` reports false until the
 * scope is granted, and the pipeline falls back to PriceCharting until then.
 */

import type {
  SoldDataSource,
  SoldQuery,
  SoldSale,
} from '../sold-data-source';

const INSIGHTS_SCOPE = 'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights';

const ENDPOINTS = {
  PRODUCTION: {
    auth: 'https://api.ebay.com/identity/v1/oauth2/token',
    insights: 'https://api.ebay.com/buy/marketplace_insights/v1_beta',
  },
  SANDBOX: {
    auth: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
    insights: 'https://api.sandbox.ebay.com/buy/marketplace_insights/v1_beta',
  },
};

/** Pokémon Individual Cards. */
const POKEMON_CATEGORY = '183454';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;
/** Memoised availability so we don't re-probe eBay on every card. */
let availability: { checked: boolean; available: boolean; reason: string } = {
  checked: false,
  available: false,
  reason: 'not checked',
};

function env() {
  return (process.env.EBAY_ENVIRONMENT || 'PRODUCTION') as keyof typeof ENDPOINTS;
}

/**
 * Fetch a token carrying the Marketplace Insights scope.
 * Throws with eBay's own message when the scope is not granted.
 */
async function getInsightsToken(): Promise<string> {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be set');
  }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 300_000) {
    return cachedToken.accessToken;
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(ENDPOINTS[env()].auth, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(INSIGHTS_SCOPE)}`,
  });

  if (!response.ok) {
    const body = await response.text();
    // The expected pre-approval failure is 400 invalid_scope.
    throw new Error(
      `eBay Marketplace Insights token request failed (${response.status}): ${body.slice(0, 300)}`
    );
  }

  const data = await response.json();
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

interface ItemSale {
  itemId?: string;
  legacyItemId?: string;
  title?: string;
  lastSoldPrice?: { value: string; currency: string };
  lastSoldDate?: string;
  itemWebUrl?: string;
  categories?: { categoryId: string }[];
}

/**
 * Build the search query. Mirrors the tuning already proven in ebay-client:
 * quote the card name, include the set and number, and exclude bulk listings
 * that would otherwise drag the price down.
 */
function buildQuery(q: SoldQuery): string {
  const parts: string[] = [];

  let name = q.cardName;
  let japanese = false;
  if (name.includes('(Japanese)')) {
    name = name.replace('(Japanese)', '').trim();
    japanese = true;
  }

  parts.push(`"${name}"`);
  if (japanese) parts.push('Japanese');

  if (q.setName) {
    parts.push(
      `"${q.setName.replace(/Pok[eé]mon /gi, '').replace(/Black Star Promos/gi, 'Promos')}"`
    );
  }
  if (q.cardNumber) parts.push(q.cardNumber);

  // Variant has to be in the query, not just filtered after: a 1st edition and
  // an unlimited copy of the same card are different products at different prices.
  if (q.variant === '1st_edition') parts.push('"1st Edition"');
  if (q.variant === 'shadowless') parts.push('Shadowless');
  if (q.variant === 'reverse_holo') parts.push('"Reverse Holo"');

  const exclusions = '-lot -bundle -repack -mystery -random -break -"pick your" -proxy -custom';
  return `${parts.join(' ')} ${exclusions}`;
}

export const ebayInsightsSource: SoldDataSource = {
  id: 'ebay:insights',
  label: 'eBay Marketplace Insights (sold, 90d)',

  async isAvailable(): Promise<boolean> {
    if (availability.checked) return availability.available;

    try {
      await getInsightsToken();
      availability = { checked: true, available: true, reason: 'scope granted' };
    } catch (err) {
      const message = (err as Error).message;
      availability = {
        checked: true,
        available: false,
        reason: /invalid_scope/.test(message)
          ? 'Marketplace Insights not granted for this keyset — request limited-release access from eBay'
          : message.slice(0, 200),
      };
    }

    if (!availability.available) {
      console.warn(`[ebay:insights] unavailable — ${availability.reason}`);
    }
    return availability.available;
  },

  async fetchSales(query: SoldQuery): Promise<SoldSale[]> {
    const token = await getInsightsToken();

    const params = new URLSearchParams({
      q: buildQuery(query),
      category_ids: POKEMON_CATEGORY,
      limit: String(Math.min(query.limit ?? 50, 200)),
      // Marketplace Insights only carries the last 90 days; no date filter needed.
      filter: 'priceCurrency:USD',
    });

    const response = await fetch(
      `${ENDPOINTS[env()].insights}/item_sales/search?${params}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        },
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Marketplace Insights search failed (${response.status}): ${body.slice(0, 200)}`
      );
    }

    const data = await response.json();
    const items: ItemSale[] = data.itemSales ?? [];
    const sales: SoldSale[] = [];

    for (const item of items) {
      const value = item.lastSoldPrice?.value;
      const soldDate = item.lastSoldDate;
      // A row without a price or a sold date is not a usable observation.
      if (!value || !soldDate) continue;

      const price = parseFloat(value);
      if (!Number.isFinite(price) || price <= 0) continue;

      const externalId = item.itemId ?? item.legacyItemId;
      if (!externalId) continue;

      sales.push({
        externalId: `ebay-insights-${externalId}`,
        title: item.title ?? '',
        price: Math.round(price * 100),
        currency: item.lastSoldPrice?.currency ?? 'USD',
        soldDate: new Date(soldDate),
        url: item.itemWebUrl ?? null,
        source: 'ebay:insights',
      });
    }

    return sales;
  },
};

/** Diagnostic used by scripts/check-ebay-access.ts. */
export function getInsightsAvailability() {
  return availability;
}
