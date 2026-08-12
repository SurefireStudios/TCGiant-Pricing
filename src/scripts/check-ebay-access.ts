/**
 * Reports whether this eBay keyset can read SOLD data yet.
 *
 * Run it after requesting limited-release access to the Marketplace Insights
 * API; when it prints GRANTED, the eBay pipeline can be switched on with no
 * code change.
 *
 * Usage: npx tsx src/scripts/check-ebay-access.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { ebayInsightsSource } from '../lib/sources/ebay-insights';
import { getInsightsAvailability } from '../lib/sources/ebay-insights';

const BASIC_SCOPE = 'https://api.ebay.com/oauth/api_scope';

async function basicTokenWorks(): Promise<boolean> {
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) return false;

  const creds = Buffer.from(`${id}:${secret}`).toString('base64');
  const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${creds}`,
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(BASIC_SCOPE)}`,
  });
  return r.ok;
}

async function main() {
  console.log('=== eBay API access check ===\n');

  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    console.log('  EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not set.');
    process.exit(1);
  }

  const basic = await basicTokenWorks();
  console.log(`  Credentials valid (basic scope):  ${basic ? 'YES' : 'NO'}`);

  const available = await ebayInsightsSource.isAvailable();
  const detail = getInsightsAvailability();

  console.log(`  Marketplace Insights (sold data): ${available ? 'GRANTED' : 'NOT GRANTED'}`);
  console.log(`    ${detail.reason}`);

  if (!available) {
    console.log('\n  Sold data is unavailable, so pricing continues to come from');
    console.log('  PriceCharting. To change that, request limited-release access to');
    console.log('  the Marketplace Insights API for this production keyset at');
    console.log('  https://developer.ebay.com — it is not self-serve, and a standard');
    console.log('  developer keyset always returns invalid_scope until approved.');
    console.log('\n  Note: the Browse API cannot substitute. It returns active');
    console.log('  listings only, and findCompletedItems was decommissioned in Feb 2025.');
    return;
  }

  console.log('\n  Sold data is available. Sample query:');
  const sales = await ebayInsightsSource.fetchSales({
    cardName: 'Charizard',
    setName: 'Base Set',
    cardNumber: '4',
    variant: 'unlimited',
    limit: 5,
  });
  console.log(`    ${sales.length} sales returned`);
  for (const s of sales.slice(0, 5)) {
    console.log(
      `    $${(s.price / 100).toFixed(2).padStart(10)}  ${s.soldDate.toISOString().slice(0, 10)}  ${s.title.slice(0, 60)}`
    );
  }
}

main().catch((err) => {
  console.error('\nCheck failed:', err.message ?? err);
  process.exit(1);
});
