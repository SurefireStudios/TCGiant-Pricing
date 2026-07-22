import type { Metadata } from "next";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, asc, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import * as schema from "@/db/schema";
import FallbackImage from "@/components/FallbackImage";

// Dynamic metadata based on set
export async function generateMetadata({
  params,
}: {
  params: Promise<{ set: string }>;
}): Promise<Metadata> {
  const { set: setSlug } = await params;
  const sqlClient = neon(process.env.DATABASE_URL!);
  const db = drizzle(sqlClient, { schema });

  const sets = await db
    .select()
    .from(schema.sets)
    .where(eq(schema.sets.slug, setSlug))
    .limit(1);

  if (sets.length === 0) {
    return { title: "Set Not Found | TCGiant" };
  }

  return {
    title: `${sets[0].name} Card Prices | TCGiant`,
    description: `Complete price guide for Pokémon ${sets[0].name} cards. View ungraded and graded prices for every card.`,
  };
}

export default async function SetDetailPage({
  params,
}: {
  params: Promise<{ set: string }>;
}) {
  const { set: setSlug } = await params;

  const sqlClient = neon(process.env.DATABASE_URL!);
  const db = drizzle(sqlClient, { schema });

  // Fetch the set
  const sets = await db
    .select()
    .from(schema.sets)
    .where(eq(schema.sets.slug, setSlug))
    .limit(1);

  if (sets.length === 0) {
    notFound();
  }

  const currentSet = sets[0];

  // Fetch all cards in this set
  const cards = await db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.setId, currentSet.id))
    .orderBy(sql`CAST(NULLIF(regexp_replace(${schema.cards.cardNumber}, '[^0-9]', '', 'g'), '') AS INTEGER) ASC NULLS LAST`);

  return (
    <div
      className="container"
      style={{
        position: "relative",
        zIndex: 1,
        paddingTop: "var(--space-2xl)",
        paddingBottom: "var(--space-3xl)",
      }}
    >
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
        <a href="/pricing/pokemon" style={{ color: "var(--text-muted)" }}>
          Pokémon
        </a>
        {" / "}
        <span style={{ color: "var(--text-primary)" }}>{currentSet.name}</span>
      </nav>

      {/* Set Header */}
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
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
          {currentSet.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentSet.imageUrl}
              alt={currentSet.name}
              style={{ height: 48, objectFit: "contain" }}
            />
          )}
          <div>
            <h1 style={{ marginBottom: "var(--space-xs)" }}>{currentSet.name}</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              {currentSet.releaseDate ? `Released ${new Date(currentSet.releaseDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}` : ""} · {cards.length} cards · {currentSet.series || "Pokémon TCG"}
            </p>
          </div>
        </div>
      </div>

      {/* Cards Table */}
      <div
        className="glass-card"
        style={{
          overflow: "hidden",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 50 }}>#</th>
                <th>Card</th>
                <th>Rarity</th>
                <th>Type</th>
                <th style={{ textAlign: "right" }}>Ungraded</th>
                <th style={{ textAlign: "right" }}>PSA 10</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((card) => (
                <tr key={card.id}>
                  <td
                    className="font-mono"
                    style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}
                  >
                    {card.cardNumber}
                  </td>
                  <td>
                    <a
                      href={`/pricing/card/${card.slug}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-sm)",
                        textDecoration: "none",
                        color: "var(--text-primary)",
                        fontWeight: 500,
                      }}
                    >
                      {/* Thumbnail */}
                      <div
                        style={{
                          width: 32,
                          height: 44,
                          borderRadius: 4,
                          overflow: "hidden",
                          flexShrink: 0,
                          background: "var(--bg-elevated)",
                        }}
                      >
                        {card.imageUrl && (
                          <FallbackImage
                            src={card.imageUrl}
                            alt={card.name}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                            }}
                          />
                        )}
                      </div>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)" }}>
                          {card.name}
                          {card.variant && card.variant !== 'unlimited' && (
                            <span style={{ fontSize: "0.65rem", padding: "2px 6px", borderRadius: 4, background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border-subtle)", textTransform: "capitalize" }}>
                              {card.variant.replace("_", " ")}
                            </span>
                          )}
                        </div>
                      </div>
                    </a>
                  </td>
                  <td>
                    <span className="badge badge-ungraded" style={{ fontSize: "0.7rem" }}>
                      {card.rarity || "Unknown"}
                    </span>
                  </td>
                  <td style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                    {card.supertype}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <span
                      className="font-mono"
                      style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}
                    >
                      —
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <span
                      className="font-mono"
                      style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}
                    >
                      —
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer note */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          padding: "var(--space-md) 0",
          fontSize: "0.75rem",
          color: "var(--text-muted)",
        }}
      >
        Showing {cards.length} cards
      </div>
    </div>
  );
}
