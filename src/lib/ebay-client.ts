/**
 * eBay API Client — OAuth 2.0 + Browse/Finding API
 *
 * Handles authentication and searching eBay's completed/sold listings.
 * Uses the Browse API's item_summary/search with sold item filters.
 *
 * Required env vars:
 * - EBAY_CLIENT_ID
 * - EBAY_CLIENT_SECRET
 * - EBAY_ENVIRONMENT (PRODUCTION or SANDBOX)
 */

// --- Types ---

interface EbayToken {
  access_token: string;
  expires_at: number; // Unix timestamp (ms)
}

export interface EbaySoldItem {
  itemId: string;
  title: string;
  price: number; // in cents (USD)
  currency: string;
  soldDate: string; // ISO date string
  itemUrl: string;
  imageUrl?: string;
  condition?: string;
  seller?: string;
}

interface EbaySearchResponse {
  href: string;
  total: number;
  next?: string;
  limit: number;
  offset: number;
  itemSummaries?: EbayItemSummary[];
}

interface EbayItemSummary {
  itemId: string;
  title: string;
  price: { value: string; currency: string };
  itemWebUrl: string;
  itemEndDate?: string;
  image?: { imageUrl: string };
  condition?: string;
  seller?: { username: string };
}

// --- eBay API Endpoints ---

const ENDPOINTS = {
  PRODUCTION: {
    auth: 'https://api.ebay.com/identity/v1/oauth2/token',
    browse: 'https://api.ebay.com/buy/browse/v1',
  },
  SANDBOX: {
    auth: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
    browse: 'https://api.sandbox.ebay.com/buy/browse/v1',
  },
};

// --- Token Cache ---
let cachedToken: EbayToken | null = null;

/**
 * Get an OAuth 2.0 client credentials token from eBay.
 * Tokens are cached and auto-refreshed when expired.
 */
async function getAccessToken(): Promise<string> {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const env = (process.env.EBAY_ENVIRONMENT || 'PRODUCTION') as keyof typeof ENDPOINTS;

  if (!clientId || !clientSecret) {
    throw new Error('EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be set');
  }

  // Return cached token if still valid (with 5-min buffer)
  if (cachedToken && cachedToken.expires_at > Date.now() + 300_000) {
    return cachedToken.access_token;
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const endpoint = ENDPOINTS[env].auth;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`eBay OAuth failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in * 1000),
  };

  return cachedToken.access_token;
}

/**
 * Search eBay for completed/sold listings.
 *
 * Uses the Browse API item_summary/search endpoint with filters
 * for sold items in the Trading Cards category.
 *
 * @param query - Search query string (e.g., '"Charizard" "Base Set" 4/102')
 * @param options - Search options
 * @returns Array of sold items
 */
export async function searchSoldListings(
  query: string,
  options: {
    categoryId?: string;    // eBay category ID (183454 = Pokémon Cards)
    limit?: number;         // Max results per page (default: 50, max: 200)
    maxPages?: number;      // Max pages to fetch (default: 1)
    minPrice?: number;      // Min price in dollars (filters out $0.01 listings)
    maxPrice?: number;      // Max price in dollars
  } = {}
): Promise<EbaySoldItem[]> {
  const {
    categoryId = '183454', // Pokémon Individual Cards
    limit = 50,
    maxPages = 1,
    minPrice = 0.50,       // Filter out penny listings
  } = options;

  const env = (process.env.EBAY_ENVIRONMENT || 'PRODUCTION') as keyof typeof ENDPOINTS;
  const baseUrl = ENDPOINTS[env].browse;
  const token = await getAccessToken();

  const allItems: EbaySoldItem[] = [];

  for (let page = 0; page < maxPages; page++) {
    const offset = page * limit;

    // Build filter string
    const filters: string[] = [
      'buyingOptions:{FIXED_PRICE|AUCTION}',
      'priceCurrency:USD',
      `price:[${minPrice}..${options.maxPrice || ''}]`,
      'conditionIds:{1000|1500|2000|2500|3000|4000|5000|6000|7000}', // New to Acceptable
    ];

    const params = new URLSearchParams({
      q: query,
      category_ids: categoryId,
      filter: filters.join(','),
      sort: '-endDate', // Most recently ended first
      limit: limit.toString(),
      offset: offset.toString(),
      // Request sold/completed items
      fieldgroups: 'MATCHING_ITEMS',
    });

    const url = `${baseUrl}/item_summary/search?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'X-EBAY-C-ENDUSERCTX': 'contextualLocation=country=US',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`eBay search failed (${response.status}): ${errorText}`);

      // If 429, wait and retry
      if (response.status === 429) {
        await new Promise((r) => setTimeout(r, 2000));
        page--; // Retry this page
        continue;
      }

      break;
    }

    const data: EbaySearchResponse = await response.json();

    if (!data.itemSummaries || data.itemSummaries.length === 0) {
      break;
    }

    for (const item of data.itemSummaries) {
      if (!item.price || !item.price.value) continue;

      const priceValue = parseFloat(item.price.value);
      if (isNaN(priceValue) || priceValue <= 0) continue;

      allItems.push({
        itemId: item.itemId,
        title: item.title,
        price: Math.round(priceValue * 100), // Convert to cents
        currency: item.price.currency || 'USD',
        soldDate: item.itemEndDate || new Date().toISOString(),
        itemUrl: item.itemWebUrl,
        imageUrl: item.image?.imageUrl,
        condition: item.condition,
        seller: item.seller?.username,
      });
    }

    // Stop if we've gotten all results
    if (!data.next || data.itemSummaries.length < limit) {
      break;
    }

    // Rate limit: wait between pages
    await new Promise((r) => setTimeout(r, 200));
  }

  return allItems;
}

/**
 * Search specifically for completed/sold Pokémon cards.
 * Builds an optimized query and handles eBay category filtering.
 */
export async function searchSoldPokemonCards(
  cardName: string,
  setName: string,
  cardNumber?: string | null,
  options: { limit?: number; maxPages?: number; extraKeywords?: string } = {}
): Promise<EbaySoldItem[]> {
  // Build a precise search query
  // Wrap in quotes for exact match, exclude bulk lots
  const parts: string[] = [];

  // Handle Japanese cards (don't force exact match on the parentheses)
  let parsedCardName = cardName;
  let isJapanese = false;
  if (parsedCardName.includes('(Japanese)')) {
    parsedCardName = parsedCardName.replace('(Japanese)', '').trim();
    isJapanese = true;
  }

  // Card name in quotes for exact match
  parts.push(`"${parsedCardName}"`);
  if (isJapanese) {
    parts.push('Japanese');
  }

  // Set name (shortened for better results — eBay truncates titles)
  if (setName) {
    // Shorten common set name patterns
    const shortSet = setName
      .replace(/Pokémon /gi, '')
      .replace(/Pokemon /gi, '')
      .replace(/Black Star Promos/gi, 'Promos');
    parts.push(`"${shortSet}"`);
  }

  if (cardNumber) {
    parts.push(cardNumber);
  }

  if (options.extraKeywords) {
    parts.push(options.extraKeywords);
  }

  // Exclude bulk/lot listings that skew prices
  const exclusions = '-lot -bundle -repack -mystery -random -break -"pick your"';

  const query = `${parts.join(' ')} ${exclusions}`;

  return searchSoldListings(query, {
    categoryId: '183454', // Pokémon Individual Cards
    limit: options.limit || 50,
    maxPages: options.maxPages || 2,
    minPrice: 0.50,
  });
}

/**
 * Search eBay for active (live) listings.
 */
export async function searchActiveListings(
  query: string,
  options: {
    categoryId?: string;
    limit?: number;
    sellerUsername?: string;
  } = {}
): Promise<EbaySoldItem[]> {
  const { categoryId = '183454', limit = 10 } = options;
  const env = (process.env.EBAY_ENVIRONMENT || 'PRODUCTION') as keyof typeof ENDPOINTS;
  const baseUrl = ENDPOINTS[env].browse;
  const token = await getAccessToken();

  const filters: string[] = [
    'buyingOptions:{FIXED_PRICE}', // Only Buy It Now
    'priceCurrency:USD',
    'conditionIds:{1000|1500|2000|2500|3000|4000|5000|6000|7000}',
  ];

  if (options.sellerUsername) {
    filters.push(`sellers:{${options.sellerUsername}}`);
  }

  const params = new URLSearchParams({
    q: query,
    category_ids: categoryId,
    filter: filters.join(','),
    limit: limit.toString(),
  });

  const url = `${baseUrl}/item_summary/search?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      'X-EBAY-C-ENDUSERCTX': 'contextualLocation=country=US',
    },
  });

  if (!response.ok) {
    return [];
  }

  const data: EbaySearchResponse = await response.json();
  const allItems: EbaySoldItem[] = [];

  if (!data.itemSummaries) return [];

  for (const item of data.itemSummaries) {
    if (!item.price || !item.price.value) continue;
    const priceValue = parseFloat(item.price.value);
    
    allItems.push({
      itemId: item.itemId,
      title: item.title,
      price: Math.round(priceValue * 100),
      currency: item.price.currency || 'USD',
      soldDate: item.itemEndDate || new Date().toISOString(),
      itemUrl: item.itemWebUrl,
      imageUrl: item.image?.imageUrl,
      condition: item.condition,
      seller: item.seller?.username,
    });
  }

  return allItems;
}

/**
 * Search specifically for live Pokémon cards (Active Listings).
 */
export async function searchActivePokemonCards(
  cardName: string,
  setName: string,
  cardNumber?: string | null,
  options: { limit?: number; sellerUsername?: string; extraKeywords?: string } = {}
): Promise<EbaySoldItem[]> {
  const parts: string[] = [];
  
  let parsedCardName = cardName;
  let isJapanese = false;
  if (parsedCardName.includes('(Japanese)')) {
    parsedCardName = parsedCardName.replace('(Japanese)', '').trim();
    isJapanese = true;
  }

  parts.push(`"${parsedCardName}"`);
  if (isJapanese) {
    parts.push('Japanese');
  }

  if (setName) {
    const shortSet = setName
      .replace(/Pokémon /gi, '')
      .replace(/Pokemon /gi, '')
      .replace(/Black Star Promos/gi, 'Promos');
    parts.push(`"${shortSet}"`);
  }

  if (cardNumber) {
    parts.push(cardNumber);
  }

  if (options.extraKeywords) {
    parts.push(options.extraKeywords);
  }

  const exclusions = '-lot -bundle -repack -mystery -random -break -"pick your"';
  const query = `${parts.join(' ')} ${exclusions}`;

  return searchActiveListings(query, {
    categoryId: '183454',
    limit: options.limit || 10,
    sellerUsername: options.sellerUsername,
  });
}

/**
 * Test the eBay connection by fetching a single result.
 * Useful for verifying credentials are working.
 */
export async function testConnection(): Promise<{ success: boolean; message: string }> {
  try {
    const token = await getAccessToken();
    const env = (process.env.EBAY_ENVIRONMENT || 'PRODUCTION') as keyof typeof ENDPOINTS;
    const baseUrl = ENDPOINTS[env].browse;

    const params = new URLSearchParams({
      q: 'pokemon card',
      category_ids: '183454',
      limit: '1',
    });

    const response = await fetch(`${baseUrl}/item_summary/search?${params}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    });

    if (!response.ok) {
      return { success: false, message: `API returned ${response.status}` };
    }

    const data = await response.json();
    return {
      success: true,
      message: `Connected! Found ${data.total || 0} results. Token valid until ${new Date(cachedToken!.expires_at).toISOString()}`,
    };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}
