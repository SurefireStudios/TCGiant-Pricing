import type { Metadata } from "next";
import Link from "next/link";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, asc, eq, gte } from "drizzle-orm";
import { notFound } from "next/navigation";
import * as schema from "@/db/schema";
import FallbackImage from "@/components/FallbackImage";
import ProductPriceChart, { type FinishSeries } from "@/components/ProductPriceChart";

export const revalidate = 3600;

/**
 * Render a date-only value ("2026-08-12") without timezone drift.
 *
 * new Date("2026-08-12") is parsed as UTC midnight, so toLocaleDateString in
 * any negative-offset timezone renders the previous day — a price synced today
 * displayed as "as of yesterday", which quietly undermines the whole point of
 * showing an as-of date.
 */
function formatDay(value: string): string {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const money = (cents: number | null) =>
  cents === null ? "—" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function db() {
  return drizzle(neon(process.env.DATABASE_URL!), { schema });
}

/** Load the product and everything shown on its page. */
async function loadProduct(slug: string) {
  const database = db();

  const [product] = await database
    .select({
      id: schema.tcgProducts.id,
      name: schema.tcgProducts.name,
      number: schema.tcgProducts.number,
      rarity: schema.tcgProducts.rarity,
      imageUrl: schema.tcgProducts.imageUrl,
      sourceUrl: schema.tcgProducts.sourceUrl,
      groupName: schema.tcgGroups.name,
      groupSlug: schema.tcgGroups.slug,
      publishedOn: schema.tcgGroups.publishedOn,
      gameName: schema.tcgCategories.name,
      gameSlug: schema.tcgCategories.slug,
    })
    .from(schema.tcgProducts)
    .innerJoin(schema.tcgGroups, eq(schema.tcgGroups.id, schema.tcgProducts.groupId))
    .innerJoin(schema.tcgCategories, eq(schema.tcgCategories.id, schema.tcgProducts.categoryId))
    .where(eq(schema.tcgProducts.slug, slug))
    .limit(1);

  if (!product) return null;

  const latest = await database
    .select()
    .from(schema.tcgLatestPrices)
    .where(eq(schema.tcgLatestPrices.productId, product.id))
    .orderBy(asc(schema.tcgLatestPrices.subType));

  // 180 days is plenty of chart, and keeps the query bounded.
  const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
  const history = await database
    .select({
      subType: schema.tcgPrices.subType,
      asOf: schema.tcgPrices.asOf,
      marketPrice: schema.tcgPrices.marketPrice,
    })
    .from(schema.tcgPrices)
    .where(and(eq(schema.tcgPrices.productId, product.id), gte(schema.tcgPrices.asOf, since)))
    .orderBy(asc(schema.tcgPrices.asOf));

  return { product, latest, history };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadProduct(slug);
  if (!data) return { title: "Card Not Found | TCGiant" };

  const { product, latest } = data;
  const headline = latest.find((l) => l.marketPrice !== null)?.marketPrice ?? null;

  return {
    title: `${product.name} ${product.number ? `#${product.number} ` : ""}— ${product.groupName} Price | TCGiant`,
    description:
      `Current market price for ${product.name} from ${product.groupName} (${product.gameName})` +
      `${headline ? `, currently ${money(headline)}` : ""}. Price history and every printing.`,
  };
}

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await loadProduct(slug);
  if (!data) notFound();

  const { product, latest, history } = data;

  // One series per finish, so a card with Normal + Reverse Holofoil charts both.
  const bySubType = new Map<string, FinishSeries>();
  for (const row of history) {
    if (row.marketPrice === null) continue;
    const series = bySubType.get(row.subType) ?? { subType: row.subType, points: [] };
    series.points.push({
      date: String(row.asOf),
      label: formatDay(String(row.asOf)).replace(/,? \d{4}$/, ""),
      price: row.marketPrice,
    });
    bySubType.set(row.subType, series);
  }

  const asOf = latest[0]?.asOf ? String(latest[0].asOf) : null;

  return (
    <div className="container" style={{ paddingTop: "var(--space-2xl)", paddingBottom: "var(--space-3xl)" }}>
      <nav style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "var(--space-lg)" }}>
        <Link href="/pricing" style={{ color: "var(--text-muted)" }}>Pricing</Link>
        {" / "}
        <Link href={`/pricing/${product.gameSlug}`} style={{ color: "var(--text-muted)" }}>
          {product.gameName}
        </Link>
        {" / "}
        <Link href={`/pricing/${product.gameSlug}/${product.groupSlug}`} style={{ color: "var(--text-muted)" }}>
          {product.groupName}
        </Link>
      </nav>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 280px) minmax(0, 1fr)", gap: "var(--space-2xl)", alignItems: "start" }}>
        <div className="glass-card" style={{ padding: "var(--space-lg)" }}>
          <FallbackImage
            src={product.imageUrl ?? ""}
            alt={product.name}
            style={{ width: "100%", height: "auto", borderRadius: "var(--radius-md)" }}
          />
        </div>

        <div>
          <h1 style={{ marginBottom: "var(--space-xs)" }}>{product.name}</h1>
          <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-md)" }}>
            {product.groupName}
            {product.number ? ` · #${product.number}` : ""}
            {product.rarity ? ` · ${product.rarity}` : ""}
          </p>

          <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap", marginBottom: "var(--space-xl)" }}>
            <span className="badge badge-ungraded">{product.gameName}</span>
            {product.publishedOn && (
              <span className="badge badge-ungraded">{String(product.publishedOn).slice(0, 4)}</span>
            )}
          </div>

          <h2 style={{ fontSize: "1.1rem", marginBottom: "var(--space-md)" }}>Market prices</h2>

          {latest.length === 0 ? (
            <div className="glass-card" style={{ padding: "var(--space-lg)" }}>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                No price recorded for this product yet.
              </p>
            </div>
          ) : (
            <table className="data-table" style={{ marginBottom: "var(--space-md)" }}>
              <thead>
                <tr>
                  <th>Finish</th>
                  <th>Market</th>
                  <th>Low</th>
                  <th>Mid</th>
                  <th>High</th>
                </tr>
              </thead>
              <tbody>
                {latest.map((row) => (
                  <tr key={row.subType}>
                    <td>{row.subType}</td>
                    <td className="font-mono" style={{ fontWeight: 700, color: "var(--text-primary)" }}>
                      {money(row.marketPrice)}
                    </td>
                    <td className="font-mono">{money(row.lowPrice)}</td>
                    <td className="font-mono">{money(row.midPrice)}</td>
                    <td className="font-mono">{money(row.highPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Provenance, stated rather than implied. */}
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Raw (ungraded) market prices from TCGplayer
            {asOf ? `, as of ${formatDay(asOf)}` : ""}.
            Graded prices are not currently tracked.
            {product.sourceUrl && (
              <>
                {" "}
                <a href={product.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-primary-light)" }}>
                  View on TCGplayer →
                </a>
              </>
            )}
          </p>
        </div>
      </div>

      <section style={{ marginTop: "var(--space-3xl)" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "var(--space-md)" }}>Price history</h2>
        <ProductPriceChart series={[...bySubType.values()]} />
      </section>
    </div>
  );
}
