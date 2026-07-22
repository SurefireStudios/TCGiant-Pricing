/**
 * Database Connection — Neon PostgreSQL via serverless driver
 *
 * Uses @neondatabase/serverless for connection pooling in serverless
 * environments (Vercel). Drizzle ORM is used for type-safe queries.
 *
 * Set DATABASE_URL in .env.local to your Neon connection string:
 * DATABASE_URL=postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL environment variable is required. ' +
      'Set it in .env.local to your Neon PostgreSQL connection string.'
  );
}

const sql = neon(process.env.DATABASE_URL);

export const db = drizzle(sql, { schema });

export { schema };
