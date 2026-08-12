/**
 * HTML entity decoding for scraped listing titles.
 *
 * PriceCharting serves titles with entities intact (`Mint&#43;9`, `Black &amp; White`).
 * Storing them raw breaks two things: the grade parser can't see the real
 * characters, and the sales table renders the entity text to users.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  eacute: 'é',
  egrave: 'è',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  deg: '°',
  reg: '®',
  trade: '™',
  copy: '©',
};

/**
 * Decode numeric (`&#43;`, `&#x2B;`) and common named HTML entities.
 *
 * Runs `&amp;` last-resort resolution first so double-encoded input
 * (`&amp;#43;`) collapses correctly.
 */
export function decodeHtmlEntities(input: string): string {
  if (!input || !input.includes('&')) return input;

  let out = input;

  // Collapse double-encoding before resolving the rest.
  out = out.replace(/&amp;(#?\w+;)/g, '&$1');

  // Numeric: decimal and hex.
  out = out.replace(/&#(\d+);/g, (_, code) => {
    const n = parseInt(code, 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : _;
  });
  out = out.replace(/&#x([0-9a-f]+);/gi, (_, code) => {
    const n = parseInt(code, 16);
    return Number.isFinite(n) ? String.fromCodePoint(n) : _;
  });

  // Named.
  out = out.replace(/&(\w+);/g, (match, name: string) => {
    const replacement = NAMED_ENTITIES[name.toLowerCase()];
    return replacement !== undefined ? replacement : match;
  });

  return out;
}
