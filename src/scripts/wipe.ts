import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function wipe() {
  const sql = neon(process.env.DATABASE_URL!);
  await sql`TRUNCATE current_prices, price_snapshots, sales, cards CASCADE`;
  console.log('Tables wiped.');
}

wipe().catch(console.error);
