import type { Metadata } from "next";
import Link from "next/link";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import * as schema from "@/db/schema";

export const revalidate = 3600;

function db() {
  return drizzle(neon(process.env.DATABASE_URL!), { schema });
}

/**
 * Sets in one game.
 *
 * The route is [game] rather than a hardcoded /pokemon, so enabling Lorcana or
 * Yu-Gi-Oh is a database flag, not a new page. That is the whole point of
 * moving onto the TCGplayer category model.
 */
async function loadGame(slug: string) {
  const database = db();

  const [game] = await database
    .select()
    .from(schema.tcgCategories)
    .where(eq(schema.tcgCategories.slug, slug))
    .limit(1);

  if (!game || !game.isEnabled) return null;

  const groups = await database
    .select({
      id: schema.tcgGroups.id,
      name: schema.tcgGroups.name,
      slug: schema.tcgGroups.slug,
      publishedOn: schema.tcgGroups.publishedOn,
      products: sql<number>`count(distinct ${schema.tcgProducts.id})`,
      priced: sql<number>`count(distinct ${schema.tcgLatestPrices.productId})`,
    })
    .from(schema.tcgGroups)
    .leftJoin(schema.tcgProducts, eq(schema.tcgProducts.groupId, schema.tcgGroups.id))
    .leftJoin(schema.tcgLatestPrices, eq(schema.tcgLatestPrices.productId, schema.tcgProducts.id))
    .where(and(eq(schema.tcgGroups.categoryId, game.id), isNotNull(schema.tcgProducts.number)))
    .groupBy(schema.tcgGroups.id, schema.tcgGroups.name, schema.tcgGroups.slug, schema.tcgGroups.publishedOn)
    .orderBy(desc(schema.tcgGroups.publishedOn));

  return { game, groups };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ game: string }>;
}): Promise<Metadata> {
  const { game } = await params;
  const data = await loadGame(game);
  if (!data) return { title: "Not Found | TCGiant" };
  return {
    title: `${data.game.name} Card Prices — All Sets | TCGiant`,
    description: `Market prices for every ${data.game.name} set. ${data.groups.length} sets tracked, updated daily.`,
  };
}

export default async function GamePage({
  params,
}: {
  params: Promise<{ game: string }>;
}) {
  const { game } = await params;
  const data = await loadGame(game);
  if (!data) notFound();

  const totalPriced = data.groups.reduce((sum, g) => sum + Number(g.priced), 0);

  return (
    <div className="container" style={{ paddingTop: "var(--space-2xl)", paddingBottom: "var(--space-3xl)" }}>
      <nav style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "var(--space-md)" }}>
        <Link href="/pricing" style={{ color: "var(--text-muted)" }}>Pricing</Link> / {data.game.name}
      </nav>

      <h1 style={{ marginBottom: "var(--space-xs)" }}>{data.game.name} Prices</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-2xl)" }}>
        {data.groups.length.toLocaleString()} sets · {totalPriced.toLocaleString()} cards priced
      </p>

      <div className="set-grid">
        {data.groups.map((g) => (
          <Link
            key={g.id}
            href={`/pricing/${data.game.slug}/${g.slug}`}
            className="glass-card"
            style={{ padding: "var(--space-lg)", display: "block", textDecoration: "none" }}
          >
            <h4 style={{ color: "var(--text-primary)", marginBottom: 4 }}>{g.name}</h4>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              {g.publishedOn ? `${String(g.publishedOn).slice(0, 4)} · ` : ""}
              {Number(g.priced).toLocaleString()} of {Number(g.products).toLocaleString()} priced
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
