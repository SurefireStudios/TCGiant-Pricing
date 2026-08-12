import type { Metadata } from "next";
import Link from "next/link";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import SearchAutocomplete from "@/components/SearchAutocomplete";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Trading Card Prices — Pokémon, Lorcana, One Piece & more",
  description:
    "Daily market prices for Pokémon, Lorcana, One Piece and other trading card games. Every printing and finish, sourced from TCGplayer.",
};

function db() {
  return drizzle(neon(process.env.DATABASE_URL!), { schema });
}

/**
 * Everything on this page is measured, not asserted.
 *
 * The previous version hardcoded "18,000+ cards" and "Real-time" while the
 * database held a fraction of that and was days stale, and linked to sets with
 * no prices at all. Counting at render time costs one cached query an hour and
 * cannot drift from reality.
 */
async function getGames() {
  return db()
    .select({
      id: schema.tcgCategories.id,
      name: schema.tcgCategories.name,
      slug: schema.tcgCategories.slug,
      sets: sql<number>`count(distinct ${schema.tcgGroups.id})`,
      priced: sql<number>`count(distinct ${schema.tcgLatestPrices.productId})`,
    })
    .from(schema.tcgCategories)
    .leftJoin(schema.tcgGroups, eq(schema.tcgGroups.categoryId, schema.tcgCategories.id))
    .leftJoin(schema.tcgProducts, eq(schema.tcgProducts.groupId, schema.tcgGroups.id))
    .leftJoin(schema.tcgLatestPrices, eq(schema.tcgLatestPrices.productId, schema.tcgProducts.id))
    .where(and(eq(schema.tcgCategories.isEnabled, true), isNotNull(schema.tcgProducts.number)))
    .groupBy(schema.tcgCategories.id, schema.tcgCategories.name, schema.tcgCategories.slug)
    .orderBy(desc(sql`count(distinct ${schema.tcgLatestPrices.productId})`));
}

async function getStats() {
  const [row] = await db()
    .select({
      priced: sql<number>`(select count(*) from tcg_latest_prices)`,
      products: sql<number>`(select count(*) from tcg_products where number is not null)`,
      games: sql<number>`(select count(*) from tcg_categories where is_enabled)`,
      freshest: sql<string | null>`(select max(as_of)::text from tcg_latest_prices)`,
    })
    .from(sql`(select 1) as _`);
  return row;
}

function freshness(asOf: string | null): string {
  if (!asOf) return "No data";
  const days = Math.floor((Date.now() - new Date(asOf).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

const GAME_ACCENT: Record<string, string> = {
  pokemon: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
  "lorcana-tcg": "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
  "one-piece-card-game": "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
  yugioh: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
  magic: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
};

export default async function PricingPage() {
  const [games, stats] = await Promise.all([getGames(), getStats()]);

  const tiles = [
    { label: "Prices Tracked", value: Number(stats.priced).toLocaleString() },
    { label: "Cards", value: Number(stats.products).toLocaleString() },
    { label: "Games", value: String(stats.games) },
    { label: "Last Updated", value: freshness(stats.freshest) },
  ];

  return (
    <div style={{ position: "relative", zIndex: 1 }}>
      <section className="hero">
        <div className="container">
          <h1 className="animate-in">Trading Card Price Guide</h1>
          <p className="animate-in" style={{ animationDelay: "100ms" }}>
            Daily market prices across every printing and finish — sourced from TCGplayer.
          </p>
          <div
            className="animate-in"
            style={{
              animationDelay: "200ms",
              display: "flex",
              justifyContent: "center",
              maxWidth: 560,
              margin: "0 auto",
              position: "relative",
              zIndex: 50,
            }}
          >
            <SearchAutocomplete />
          </div>
        </div>
      </section>

      <section
        style={{
          borderTop: "1px solid var(--border-subtle)",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--bg-surface)",
          padding: "var(--space-lg) 0",
        }}
      >
        <div
          className="container"
          style={{ display: "flex", justifyContent: "center", gap: "var(--space-3xl)", flexWrap: "wrap" }}
        >
          {tiles.map((s) => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <div
                className="font-mono"
                style={{
                  fontSize: "1.5rem",
                  fontWeight: 800,
                  background: "linear-gradient(135deg, var(--color-primary-light), var(--color-accent))",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {s.value}
              </div>
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  fontWeight: 600,
                }}
              >
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section" style={{ marginTop: "var(--space-3xl)" }}>
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">Games</h2>
          </div>
          <div className="set-grid">
            {games.map((g) => (
              <Link
                key={g.id}
                href={`/pricing/${g.slug}`}
                className="glass-card game-card active"
                style={{ textDecoration: "none" }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "var(--radius-md)",
                    background: GAME_ACCENT[g.slug] ?? "linear-gradient(135deg, #64748b 0%, #475569 100%)",
                    marginBottom: "var(--space-md)",
                  }}
                />
                <h3>{g.name}</h3>
                <p>
                  {Number(g.sets).toLocaleString()} sets ·{" "}
                  {Number(g.priced).toLocaleString()} prices
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section
        className="section"
        style={{
          background: "var(--bg-surface)",
          borderTop: "1px solid var(--border-subtle)",
          borderBottom: "1px solid var(--border-subtle)",
          padding: "var(--space-3xl) 0",
        }}
      >
        <div className="container">
          <h2 className="section-title" style={{ textAlign: "center", marginBottom: "var(--space-2xl)" }}>
            How these prices work
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "var(--space-xl)" }}>
            {[
              {
                icon: "🏷️",
                title: "Every printing",
                desc: "Base Set, Shadowless and 1st Edition are separate products — and each finish (Normal, Holofoil, Reverse Holofoil) is priced on its own.",
              },
              {
                icon: "📈",
                title: "Real history",
                desc: "One snapshot per card, per finish, per day, recorded as it happens. Nothing is backfilled or estimated.",
              },
              {
                icon: "🔄",
                title: "Updated daily",
                desc: "The catalogue refreshes on a rolling schedule, and every card page shows the date its price was taken.",
              },
              {
                icon: "🎴",
                title: "More than Pokémon",
                desc: "Lorcana and One Piece are live, with Yu-Gi-Oh, Magic and others available as we enable them.",
              },
            ].map((item) => (
              <div key={item.title} style={{ textAlign: "center", padding: "var(--space-lg)" }}>
                <div style={{ fontSize: "2rem", marginBottom: "var(--space-md)" }}>{item.icon}</div>
                <h3 style={{ fontSize: "1.125rem", marginBottom: "var(--space-sm)" }}>{item.title}</h3>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", lineHeight: 1.7 }}>
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: "var(--space-3xl)" }}>
        <div className="container" style={{ textAlign: "center" }}>
          <div
            className="glass-card"
            style={{
              padding: "var(--space-3xl)",
              maxWidth: 700,
              margin: "0 auto",
              background: "linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(245, 158, 11, 0.05))",
              border: "1px solid var(--border-primary)",
            }}
          >
            <h2 style={{ marginBottom: "var(--space-md)" }}>🔌 Pricing API</h2>
            <p style={{ color: "var(--text-secondary)", maxWidth: 500, margin: "0 auto var(--space-xl)" }}>
              Build on our data. RESTful JSON, keyed access, generous free tier.
            </p>
            <Link href="/pricing/docs" className="btn btn-primary btn-lg">
              View API Documentation
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
