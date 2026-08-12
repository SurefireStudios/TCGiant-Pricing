/**
 * tcgcsv.com — a free, daily, no-key mirror of TCGplayer's catalogue and prices.
 *
 * This is the backbone of the catalogue. It supplies, for every game TCGplayer
 * sells:
 *
 *   categories  → games        (Pokemon 3, Lorcana 71, One Piece 68, YuGiOh 2 …)
 *   groups      → printing runs ("Base Set", "Base Set (Shadowless)" and
 *                                "Base Set (1st Edition)" are separate groups)
 *   products    → cards, with collector number and rarity
 *   prices      → per product per finish (Normal / Holofoil / Reverse Holofoil)
 *
 * Two properties make it the right foundation:
 *
 *   1. Identity is given, not inferred. Every previous source forced us to
 *      reconstruct variant and printing from names and slugs, and every serious
 *      data bug came from that. Here `groupId` and `subTypeName` are
 *      authoritative.
 *   2. It is bulk. One request returns a whole set's prices in ~30ms, so the
 *      full multi-game catalogue is a few thousand requests — minutes, daily.
 *
 * Limits worth stating: these are RAW prices (no PSA/CGC/BGS), and there is no
 * public archive, so price history begins when we begin recording it.
 */

const BASE = 'https://tcgcsv.com/tcgplayer';

interface Envelope<T> {
  success: boolean;
  errors: string[];
  results: T[];
}

export interface TcgCsvCategory {
  categoryId: number;
  name: string;
  modifiedOn?: string;
  seoCategoryName?: string;
}

export interface TcgCsvGroup {
  groupId: number;
  categoryId: number;
  name: string;
  abbreviation?: string | null;
  publishedOn?: string | null;
}

export interface TcgCsvProduct {
  productId: number;
  categoryId: number;
  groupId: number;
  name: string;
  cleanName?: string;
  imageUrl?: string;
  url?: string;
  extendedData?: { name: string; displayName: string; value: string }[];
}

export interface TcgCsvPrice {
  productId: number;
  subTypeName: string;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  marketPrice: number | null;
  directLowPrice: number | null;
}

async function get<T>(path: string, attempts = 4): Promise<T[]> {
  let lastError = '';
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'TCGiant/1.0 (+pricing.tcgiant.com)' },
      });
      if (res.ok) {
        const body = (await res.json()) as Envelope<T>;
        return body.results ?? [];
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = (err as Error).message;
    }
    await new Promise((r) => setTimeout(r, Math.min(8000, 400 * 2 ** i)));
  }
  throw new Error(`tcgcsv ${path} failed: ${lastError}`);
}

export const fetchCategories = () => get<TcgCsvCategory>('/categories');
export const fetchGroups = (categoryId: number) => get<TcgCsvGroup>(`/${categoryId}/groups`);
export const fetchProducts = (categoryId: number, groupId: number) =>
  get<TcgCsvProduct>(`/${categoryId}/${groupId}/products`);
export const fetchPrices = (categoryId: number, groupId: number) =>
  get<TcgCsvPrice>(`/${categoryId}/${groupId}/prices`);

/** Pull a named field out of TCGplayer's extendedData bag. */
export function extended(product: TcgCsvProduct, field: string): string | null {
  return product.extendedData?.find((e) => e.name === field)?.value ?? null;
}

/** Dollars (or null) → integer cents (or null). Prices are never floats here. */
export function toCents(v: number | null | undefined): number | null {
  return v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100);
}

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
