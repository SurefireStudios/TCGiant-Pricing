import { MetadataRoute } from 'next';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@/db/schema';

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://pricing.tcgiant.com';
const PER_SITEMAP = 10000;

function db() {
  return drizzle(neon(process.env.DATABASE_URL!), { schema });
}

export async function generateSitemaps() {
  const [row] = await db()
    .select({ count: sql<number>`count(*)` })
    .from(schema.tcgProducts);

  const total = Number(row?.count ?? 0);
  // id 0 carries the static routes plus every game and set.
  return [{ id: 0 }, ...Array.from({ length: Math.ceil(total / PER_SITEMAP) }, (_, i) => ({ id: i + 1 }))];
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  const database = db();

  if (id === 0) {
    const games = await database
      .select({ slug: schema.tcgCategories.slug })
      .from(schema.tcgCategories)
      .where(eq(schema.tcgCategories.isEnabled, true));

    const sets = await database
      .select({ gameSlug: schema.tcgCategories.slug, setSlug: schema.tcgGroups.slug })
      .from(schema.tcgGroups)
      .innerJoin(schema.tcgCategories, eq(schema.tcgCategories.id, schema.tcgGroups.categoryId))
      .where(eq(schema.tcgCategories.isEnabled, true));

    return [
      { url: baseUrl, lastModified: new Date(), changeFrequency: 'daily', priority: 1.0 },
      { url: `${baseUrl}/pricing`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
      { url: `${baseUrl}/pricing/docs`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.5 },
      ...games.map((g) => ({
        url: `${baseUrl}/pricing/${g.slug}`,
        lastModified: new Date(),
        changeFrequency: 'daily' as const,
        priority: 0.8,
      })),
      ...sets.map((s) => ({
        url: `${baseUrl}/pricing/${s.gameSlug}/${s.setSlug}`,
        lastModified: new Date(),
        changeFrequency: 'daily' as const,
        priority: 0.7,
      })),
    ];
  }

  const products = await database
    .select({ slug: schema.tcgProducts.slug, updatedAt: schema.tcgProducts.updatedAt })
    .from(schema.tcgProducts)
    .limit(PER_SITEMAP)
    .offset((id - 1) * PER_SITEMAP);

  return products.map((p) => ({
    url: `${baseUrl}/pricing/card/${p.slug}`,
    lastModified: p.updatedAt,
    changeFrequency: 'daily' as const,
    priority: 0.6,
  }));
}
