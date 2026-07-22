import type { Metadata } from "next";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, asc, desc } from "drizzle-orm";
import * as schema from "@/db/schema";
import SearchAutocomplete from "@/components/SearchAutocomplete";

export const revalidate = 3600; // Cache for 1 hour at edge

export const metadata: Metadata = {
  title: "Pokémon Card Prices — All Sets | TCGiant",
  description:
    "Browse all Pokémon TCG sets with real market prices. From Base Set to the latest expansions.",
};

interface SetRow {
  id: number;
  name: string;
  slug: string;
  series: string | null;
  releaseDate: string | null;
  totalCards: number | null;
  imageUrl: string | null;
  symbolUrl: string | null;
}

// Group sets by series
function groupBySeries(sets: SetRow[]): Record<string, SetRow[]> {
  const groups: Record<string, SetRow[]> = {};
  for (const set of sets) {
    const series = set.series || "Other";
    if (!groups[series]) groups[series] = [];
    groups[series].push(set);
  }
  return groups;
}

export default async function PokemonSetsPage() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql, { schema });

  // Fetch the Pokemon game
  const games = await db
    .select()
    .from(schema.games)
    .where(eq(schema.games.slug, "pokemon"));

  if (games.length === 0) {
    return (
      <div className="container" style={{ paddingTop: "var(--space-2xl)", textAlign: "center" }}>
        <h1>No Data Yet</h1>
        <p style={{ color: "var(--text-secondary)" }}>Run the seeder to populate Pokémon card data.</p>
      </div>
    );
  }

  // Fetch all sets for Pokemon
  const sets = await db
    .select()
    .from(schema.sets)
    .where(eq(schema.sets.gameId, games[0].id))
    .orderBy(asc(schema.sets.releaseDate));

  const grouped = groupBySeries(sets);
  const totalCards = sets.reduce((sum, s) => sum + (s.totalCards || 0), 0);

  return (
    <div className="container" style={{ position: "relative", zIndex: 1, paddingTop: "var(--space-2xl)", paddingBottom: "var(--space-3xl)" }}>
      {/* Breadcrumb */}
      <nav
        style={{
          fontSize: "0.8rem",
          color: "var(--text-muted)",
          marginBottom: "var(--space-lg)",
        }}
      >
        <a href="/pricing" style={{ color: "var(--text-muted)" }}>
          Home
        </a>
        {" / "}
        <span style={{ color: "var(--text-primary)" }}>Pokémon Cards</span>
      </nav>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--space-2xl)",
          flexWrap: "wrap",
          gap: "var(--space-md)",
        }}
      >
        <div>
          <h1 style={{ marginBottom: "var(--space-xs)" }}>Pokémon Card Sets</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            Browse all Pokémon TCG sets · {sets.length} sets ·{" "}
            {totalCards.toLocaleString()} cards
          </p>
        </div>
        <div style={{ maxWidth: 320, width: "100%" }}>
          <SearchAutocomplete />
        </div>
      </div>

      {/* Sets grouped by series */}
      {Object.entries(grouped)
        .sort(([a], [b]) => {
          if (a === "Japanese" && b !== "Japanese") return 1;
          if (b === "Japanese" && a !== "Japanese") return -1;
          return 0; // Maintain release date order within groups
        })
        .map(([series, seriesSets]) => (
        <section key={series} className="section" style={{ marginBottom: "var(--space-2xl)" }}>
          <h2
            style={{
              fontSize: "1.125rem",
              fontWeight: 700,
              color: "var(--text-secondary)",
              marginBottom: "var(--space-md)",
              paddingBottom: "var(--space-sm)",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            {series} Series
          </h2>
          <div className="set-grid">
            {seriesSets.map((set) => (
              <a
                key={set.slug}
                href={`/pricing/pokemon/${set.slug}`}
                className="glass-card"
                style={{
                  padding: "var(--space-lg)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-md)",
                  textDecoration: "none",
                }}
              >
                {/* Set symbol/logo */}
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "var(--radius-md)",
                    background: "var(--bg-elevated)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    overflow: "hidden",
                  }}
                >
                  {set.symbolUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={set.symbolUrl}
                      alt={set.name}
                      style={{ width: "100%", height: "100%", objectFit: "contain" }}
                    />
                  ) : (
                    <div style={{ fontSize: "1.5rem", opacity: 0.8 }}>
                      {series === "Japanese" ? "🇯🇵" : "⚡"}
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h4
                    style={{
                      color: "var(--text-primary)",
                      fontSize: "0.95rem",
                      marginBottom: 2,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {set.name}
                  </h4>
                  <p
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    {set.releaseDate ? new Date(set.releaseDate).getFullYear() : "—"} · {set.totalCards || 0} cards
                  </p>
                </div>
                <div
                  style={{
                    color: "var(--text-muted)",
                    fontSize: "1rem",
                    flexShrink: 0,
                  }}
                >
                  →
                </div>
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
