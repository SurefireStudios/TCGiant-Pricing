import type { Metadata } from "next";
import Link from "next/link";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import * as schema from "@/db/schema";
import FallbackImage from "@/components/FallbackImage";

export const revalidate = 3600;

const money = (cents: number | null) =>
  cents === null ? "—" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function db() {
  return drizzle(neon(process.env.DATABASE_URL!), { schema });
}

async function loadSet(gameSlug: string, setSlug: string) {
  const database = db();

  const [group] = await database
    .select({
      id: schema.tcgGroups.id,
      name: schema.tcgGroups.name,
      slug: schema.tcgGroups.slug,
      publishedOn: schema.tcgGroups.publishedOn,
      gameName: schema.tcgCategories.name,
      gameSlug: schema.tcgCategories.slug,
    })
    .from(schema.tcgGroups)
    .innerJoin(schema.tcgCategories, eq(schema.tcgCategories.id, schema.tcgGroups.categoryId))
    .where(eq(schema.tcgGroups.slug, setSlug))
    .limit(1);

  if (!group || group.gameSlug !== gameSlug) return null;

  // Headline price per product: the highest-value finish, so a card whose
  // reverse holo is the valuable printing doesn't show its common price.
  const products = await database
    .select({
      id: schema.tcgProducts.id,
      name: schema.tcgProducts.name,
      slug: schema.tcgProducts.slug,
      number: schema.tcgProducts.number,
      rarity: schema.tcgProducts.rarity,
      imageUrl: schema.tcgProducts.imageUrl,
      topPrice: sql<number | null>`max(${schema.tcgLatestPrices.marketPrice})`,
      finishes: sql<number>`count(${schema.tcgLatestPrices.subType})`,
    })
    .from(schema.tcgProducts)
    .leftJoin(schema.tcgLatestPrices, eq(schema.tcgLatestPrices.productId, schema.tcgProducts.id))
    // Cards only — sealed product and code cards live in the same catalogue
    // but do not belong in a card grid.
    .where(and(eq(schema.tcgProducts.groupId, group.id), isNotNull(schema.tcgProducts.number)))
    .groupBy(
      schema.tcgProducts.id,
      schema.tcgProducts.name,
      schema.tcgProducts.slug,
      schema.tcgProducts.number,
      schema.tcgProducts.rarity,
      schema.tcgProducts.imageUrl
    )
    .orderBy(asc(schema.tcgProducts.id));

  return { group, products };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ game: string; set: string }>;
}): Promise<Metadata> {
  const { game, set } = await params;
  const data = await loadSet(game, set);
  if (!data) return { title: "Set Not Found | TCGiant" };
  return {
    title: `${data.group.name} Card Prices | TCGiant`,
    description: `Market prices for all ${data.products.length} cards in ${data.group.name} (${data.group.gameName}), updated daily.`,
  };
}

export default async function SetPage({
  params,
}: {
  params: Promise<{ game: string; set: string }>;
}) {
  const { game, set } = await params;
  const data = await loadSet(game, set);
  if (!data) notFound();

  const priced = data.products.filter((p) => p.topPrice !== null).length;

  return (
    <div className="container" style={{ paddingTop: "var(--space-2xl)", paddingBottom: "var(--space-3xl)" }}>
      <nav style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "var(--space-md)" }}>
        <Link href="/pricing" style={{ color: "var(--text-muted)" }}>Pricing</Link>
        {" / "}
        <Link href={`/pricing/${data.group.gameSlug}`} style={{ color: "var(--text-muted)" }}>
          {data.group.gameName}
        </Link>
        {" / "}
        {data.group.name}
      </nav>

      <h1 style={{ marginBottom: "var(--space-xs)" }}>{data.group.name}</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-2xl)" }}>
        {data.group.publishedOn ? `${String(data.group.publishedOn).slice(0, 4)} · ` : ""}
        {priced.toLocaleString()} of {data.products.length.toLocaleString()} cards priced
      </p>

      <div className="card-grid">
        {data.products.map((p) => (
          <Link
            key={p.id}
            href={`/pricing/card/${p.slug}`}
            className="glass-card"
            style={{ padding: "var(--space-md)", display: "block", textDecoration: "none" }}
          >
            <FallbackImage
              src={p.imageUrl ?? ""}
              alt={p.name}
              style={{ width: "100%", height: "auto", borderRadius: "var(--radius-sm)", marginBottom: "var(--space-sm)" }}
            />
            <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>
              {p.name}
            </div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: 6 }}>
              {p.number ? `#${p.number}` : ""}{p.rarity ? ` · ${p.rarity}` : ""}
            </div>
            <div className="font-mono" style={{ fontWeight: 700, color: "var(--text-primary)" }}>
              {money(p.topPrice)}
              {Number(p.finishes) > 1 && (
                <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: 400 }}>
                  {" "}· {p.finishes} finishes
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
