import { MetadataRoute } from 'next';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql } from 'drizzle-orm';
import * as schema from '@/db/schema';

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://tcgiant-pricing.vercel.app';
const CARDS_PER_SITEMAP = 10000;

export async function generateSitemaps() {
  const sqlClient = neon(process.env.DATABASE_URL!);
  const db = drizzle(sqlClient, { schema });
  
  const countResult = await db.select({ count: sql<number>`count(*)` }).from(schema.cards);
  const totalCards = Number(countResult[0]?.count || 0);
  const numSitemaps = Math.ceil(totalCards / CARDS_PER_SITEMAP);
  
  // Return an array of sitemap ids
  const sitemaps = [{ id: 0 }]; // Static routes and sets
  for (let i = 0; i < numSitemaps; i++) {
    sitemaps.push({ id: i + 1 });
  }
  return sitemaps;
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  const sqlClient = neon(process.env.DATABASE_URL!);
  const db = drizzle(sqlClient, { schema });

  if (id === 0) {
    // Generate static routes and sets
    const sets = await db.select({ slug: schema.sets.slug }).from(schema.sets);
    
    const staticRoutes = [
      { url: `${baseUrl}`, lastModified: new Date(), changeFrequency: 'daily', priority: 1.0 },
      { url: `${baseUrl}/pricing`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
      { url: `${baseUrl}/pricing/pokemon`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.8 },
      { url: `${baseUrl}/pricing/docs`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.5 },
    ];
    
    const setRoutes = sets.map((s) => ({
      url: `${baseUrl}/pricing/pokemon/${s.slug}`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    }));
    
    return [...staticRoutes, ...setRoutes] as MetadataRoute.Sitemap;
  }

  // Generate cards for this sitemap ID
  const offset = (id - 1) * CARDS_PER_SITEMAP;
  const cards = await db
    .select({ slug: schema.cards.slug, updatedAt: schema.cards.updatedAt })
    .from(schema.cards)
    .limit(CARDS_PER_SITEMAP)
    .offset(offset);
    
  return cards.map((c) => ({
    url: `${baseUrl}/pricing/card/${c.slug}`,
    lastModified: c.updatedAt,
    changeFrequency: 'weekly',
    priority: 0.7,
  })) as MetadataRoute.Sitemap;
}
