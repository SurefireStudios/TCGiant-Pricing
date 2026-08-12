/**
 * TCGdex — free, open-source card database that carries TCGplayer and
 * Cardmarket prices.
 *
 * Chosen over pokemontcg.io after that project was absorbed into Scrydex, a
 * commercial service selling the same data for $29-399/month. Its free
 * endpoint still works but is now owned by a company with an obvious reason to
 * close it, and in practice returns HTTP 500 on roughly four of five requests.
 *
 * TCGdex is measurably better for this job:
 *   - ~115ms per card versus 3-10s, and it does not fall over
 *   - no API key, no signup, no per-day quota to negotiate
 *   - open source, so it cannot be quietly paywalled the same way
 *   - card ids match the pokemontcg.io ids we already store as `externalId`
 *
 * There is no bulk endpoint that includes prices — the list endpoints return
 * brief card objects (id, name, image) only — so pricing is fetched per card.
 * At 115ms that is ~1.9h for the full catalogue single-threaded, or well under
 * an hour with a handful of workers.
 *
 * These are marketplace prices for RAW cards, so everything here maps to
 * condition UNGRADED. Graded pricing is not available from this source.
 */

import type { CardVariant } from '../grade-parser';

const API_BASE = 'https://api.tcgdex.net/v2/en';

interface TcgdexTcgplayerVariant {
  productId?: number;
  lowPrice?: number | null;
  midPrice?: number | null;
  highPrice?: number | null;
  marketPrice?: number | null;
  directLowPrice?: number | null;
}

interface TcgdexPricing {
  tcgplayer?: {
    unit?: string;
    updated?: string;
  } & Record<string, TcgdexTcgplayerVariant | string | undefined>;
  cardmarket?: {
    unit?: string;
    updated?: string;
    avg?: number | null;
    low?: number | null;
    trend?: number | null;
    avg7?: number | null;
    avg30?: number | null;
    'avg-holo'?: number | null;
    'low-holo'?: number | null;
    'trend-holo'?: number | null;
    'avg7-holo'?: number | null;
  };
}

export interface TcgdexCard {
  id: string;
  name: string;
  localId?: string;
  rarity?: string;
  updated?: string;
  pricing?: TcgdexPricing;
}

export interface ReferencePrice {
  externalId: string;
  source: 'tcgplayer' | 'cardmarket';
  /** Cents. */
  price: number;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  currency: string;
  variantKey: string;
  observedAt: Date | null;
}

const toCents = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100);

/**
 * TCGdex nests TCGplayer prices under the same variant keys TCGplayer uses.
 * Returned in preference order so a card whose rarity implies holo still
 * resolves when only the plain printing is priced.
 */
function candidateKeys(variant: CardVariant, rarity: string | null): string[] {
  const isHolo = /holo|ultra|secret|illustration|hyper|rare holo/i.test(rarity ?? '');

  switch (variant) {
    case 'reverse_holo':
      return ['reverse-holofoil', 'reverseHolofoil'];
    case '1st_edition':
      return isHolo
        ? ['1st-edition-holofoil', '1stEditionHolofoil', 'holofoil', 'normal']
        : ['1st-edition', '1stEditionNormal', 'normal', 'holofoil'];
    case 'shadowless':
      // Not priced as a distinct product.
      return [];
    case 'unlimited':
    default:
      return isHolo ? ['holofoil', 'normal'] : ['normal', 'holofoil'];
  }
}

export function extractTcgplayerPrice(
  card: TcgdexCard,
  variant: CardVariant,
  rarity: string | null
): ReferencePrice | null {
  const tp = card.pricing?.tcgplayer;
  if (!tp) return null;

  const key = candidateKeys(variant, rarity).find((k) => {
    const v = tp[k];
    return v && typeof v === 'object';
  });
  if (!key) return null;

  const bucket = tp[key] as TcgdexTcgplayerVariant;
  // marketPrice is the headline; midPrice covers cards listed but not recently sold.
  const headline = toCents(bucket.marketPrice) ?? toCents(bucket.midPrice);
  if (headline === null || headline <= 0) return null;

  return {
    externalId: card.id,
    source: 'tcgplayer',
    price: headline,
    lowPrice: toCents(bucket.lowPrice),
    midPrice: toCents(bucket.midPrice),
    highPrice: toCents(bucket.highPrice),
    currency: 'USD',
    variantKey: key,
    observedAt: tp.updated && typeof tp.updated === 'string' ? new Date(tp.updated) : null,
  };
}

export function extractCardmarketPrice(
  card: TcgdexCard,
  variant: CardVariant
): ReferencePrice | null {
  const cm = card.pricing?.cardmarket;
  if (!cm) return null;

  // Cardmarket exposes holo variants with a `-holo` suffix; reverse holos are
  // closest to those, since Cardmarket does not separate reverse explicitly.
  const isHolo = variant === 'reverse_holo';
  const headline = toCents(isHolo ? cm['trend-holo'] ?? cm['avg-holo'] : cm.trend ?? cm.avg);
  if (headline === null || headline <= 0) return null;

  return {
    externalId: card.id,
    source: 'cardmarket',
    price: headline,
    lowPrice: toCents(isHolo ? cm['low-holo'] : cm.low),
    midPrice: toCents(isHolo ? cm['avg7-holo'] : cm.avg7),
    highPrice: null,
    currency: cm.unit === 'EUR' || !cm.unit ? 'EUR' : cm.unit,
    variantKey: isHolo ? 'trend-holo' : 'trend',
    observedAt: cm.updated ? new Date(cm.updated) : null,
  };
}

/**
 * Fetch one card. Returns null for 404 (TCGdex does not carry every id we
 * hold) so callers can distinguish "absent" from "failed".
 */
export async function fetchCard(externalId: string): Promise<TcgdexCard | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${API_BASE}/cards/${encodeURIComponent(externalId)}`, {
      headers: { Accept: 'application/json' },
    });

    if (res.status === 404) return null;
    if (res.ok) return (await res.json()) as TcgdexCard;

    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  throw new Error(`TCGdex failed for ${externalId}`);
}
