import type { Metadata } from "next";
import SearchAutocomplete from "@/components/SearchAutocomplete";

export const revalidate = 3600; // Cache for 1 hour at edge

export const metadata: Metadata = {
  title: "Trading Card Prices — Free Ungraded & PSA Price Guide",
  description:
    "Track real market prices for Pokemon, YuGiOh, Magic, Lorcana, One Piece and more. Ungraded and graded (PSA, CGC, BGS, TAG) prices from eBay sold data.",
};

const GAMES = [
  {
    name: "Pokémon",
    slug: "pokemon",
    description: "150+ sets · 18,000+ cards",
    active: true,
    emoji: "⚡",
    gradient: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
  },
  {
    name: "Dragon Ball Z",
    slug: "dragon-ball-z",
    description: "Coming Soon",
    active: false,
    emoji: "🐉",
    gradient: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
  },
  {
    name: "Lorcana",
    slug: "lorcana",
    description: "Coming Soon",
    active: false,
    emoji: "✨",
    gradient: "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
  },
  {
    name: "Magic the Gathering",
    slug: "magic",
    description: "Coming Soon",
    active: false,
    emoji: "🔮",
    gradient: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
  },
  {
    name: "One Piece",
    slug: "one-piece",
    description: "Coming Soon",
    active: false,
    emoji: "🏴‍☠️",
    gradient: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
  },
  {
    name: "YuGiOh",
    slug: "yugioh",
    description: "Coming Soon",
    active: false,
    emoji: "🃏",
    gradient: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
  },
];

const POPULAR_SETS = [
  { name: "Base Set", slug: "pokemon-base-set", year: "1999", cards: 102 },
  { name: "Jungle", slug: "pokemon-jungle", year: "1999", cards: 64 },
  { name: "Fossil", slug: "pokemon-fossil", year: "1999", cards: 62 },
  { name: "Team Rocket", slug: "pokemon-team-rocket", year: "2000", cards: 83 },
  { name: "Gym Heroes", slug: "pokemon-gym-heroes", year: "2000", cards: 132 },
  { name: "Neo Genesis", slug: "pokemon-neo-genesis", year: "2000", cards: 111 },
  { name: "Scarlet & Violet 151", slug: "pokemon-sv-151", year: "2023", cards: 207 },
  { name: "Crown Zenith", slug: "pokemon-crown-zenith", year: "2023", cards: 230 },
];

const CONDITIONS = [
  "Ungraded",
  "Grade 1-9",
  "Grade 9.5",
  "PSA 10",
  "CGC 10",
  "BGS 10",
  "TAG 10",
];

export default function PricingPage() {
  return (
    <div style={{ position: "relative", zIndex: 1 }}>
      {/* Hero Section */}
      <section className="hero">
        <div className="container">
          <h1 className="animate-in">
            Trading Card Price Guide
          </h1>
          <p className="animate-in" style={{ animationDelay: "100ms" }}>
            Real market prices from eBay sold listings. Track ungraded &amp;
            graded card values across PSA, CGC, BGS, and TAG.
          </p>

          {/* Search Bar */}
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

          {/* Condition badges */}
          <div
            className="animate-in"
            style={{
              animationDelay: "300ms",
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: "var(--space-sm)",
              marginTop: "var(--space-xl)",
            }}
          >
            {CONDITIONS.map((condition) => (
              <span
                key={condition}
                className="badge badge-ungraded"
                style={{ fontSize: "0.7rem" }}
              >
                {condition}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Stats Bar */}
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
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "var(--space-3xl)",
            flexWrap: "wrap",
          }}
        >
          {[
            { label: "Cards Tracked", value: "18,000+" },
            { label: "Price Updates", value: "Real-time" },
            { label: "Grading Companies", value: "4" },
            { label: "Conditions", value: "15" },
          ].map((stat) => (
            <div key={stat.label} style={{ textAlign: "center" }}>
              <div
                className="font-mono"
                style={{
                  fontSize: "1.5rem",
                  fontWeight: 800,
                  background:
                    "linear-gradient(135deg, var(--color-primary-light), var(--color-accent))",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {stat.value}
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
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* TCG Games Grid */}
      <section className="section" style={{ marginTop: "var(--space-3xl)" }}>
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">Trading Card Games</h2>
          </div>
          <div className="set-grid">
            {GAMES.map((game) => (
              <a
                key={game.slug}
                href={game.active ? `/pricing/${game.slug}` : "#"}
                className={`glass-card game-card ${game.active ? "active" : "coming-soon"}`}
                style={
                  game.active
                    ? {}
                    : { pointerEvents: "none" as const }
                }
              >
                {!game.active && (
                  <div className="coming-soon-badge">Coming Soon</div>
                )}
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "var(--radius-md)",
                    background: game.gradient,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "1.5rem",
                    marginBottom: "var(--space-md)",
                  }}
                >
                  {game.emoji}
                </div>
                <h3>{game.name}</h3>
                <p>{game.description}</p>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Popular Pokemon Sets */}
      <section className="section">
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">Popular Pokémon Sets</h2>
            <a href="/pricing/pokemon" className="btn btn-ghost btn-sm">
              View All Sets →
            </a>
          </div>
          <div className="set-grid">
            {POPULAR_SETS.map((set) => (
              <a
                key={set.slug}
                href={`/pricing/pokemon/${set.slug}`}
                className="glass-card"
                style={{
                  padding: "var(--space-lg)",
                  display: "block",
                  textDecoration: "none",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <h4 style={{ color: "var(--text-primary)", marginBottom: 4 }}>
                      {set.name}
                    </h4>
                    <p
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      {set.year} · {set.cards} cards
                    </p>
                  </div>
                  <div
                    style={{
                      color: "var(--text-muted)",
                      fontSize: "1.25rem",
                    }}
                  >
                    →
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
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
          <h2
            className="section-title"
            style={{ textAlign: "center", marginBottom: "var(--space-2xl)" }}
          >
            How We Determine Prices
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
              gap: "var(--space-xl)",
            }}
          >
            {[
              {
                icon: "📊",
                title: "Real Sales Data",
                desc: "We track completed eBay sold listings for every card, capturing actual transaction prices — not asking prices.",
              },
              {
                icon: "🧮",
                title: "Smart Algorithm",
                desc: "Our pricing engine uses EWMA, median, and age-weighted averages with outlier detection to give you the most accurate market price.",
              },
              {
                icon: "🏷️",
                title: "15 Conditions",
                desc: "Prices for Ungraded, Grade 1-9, Grade 9.5, and Grade 10 across PSA, CGC, BGS, and TAG grading companies.",
              },
              {
                icon: "🔄",
                title: "Constantly Updated",
                desc: "Prices update throughout the day as new sales data comes in. Never rely on stale pricing data again.",
              },
            ].map((item) => (
              <div
                key={item.title}
                style={{
                  textAlign: "center",
                  padding: "var(--space-lg)",
                }}
              >
                <div style={{ fontSize: "2rem", marginBottom: "var(--space-md)" }}>
                  {item.icon}
                </div>
                <h3
                  style={{
                    fontSize: "1.125rem",
                    marginBottom: "var(--space-sm)",
                  }}
                >
                  {item.title}
                </h3>
                <p
                  style={{
                    color: "var(--text-secondary)",
                    fontSize: "0.875rem",
                    lineHeight: 1.7,
                  }}
                >
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* API CTA */}
      <section className="section" style={{ paddingTop: "var(--space-3xl)" }}>
        <div className="container" style={{ textAlign: "center" }}>
          <div
            className="glass-card"
            style={{
              padding: "var(--space-3xl)",
              maxWidth: 700,
              margin: "0 auto",
              background:
                "linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(245, 158, 11, 0.05))",
              border: "1px solid var(--border-primary)",
            }}
          >
            <h2 style={{ marginBottom: "var(--space-md)" }}>
              🔌 Pricing API
            </h2>
            <p
              style={{
                color: "var(--text-secondary)",
                marginBottom: "var(--space-xl)",
                maxWidth: 500,
                margin: "0 auto var(--space-xl)",
              }}
            >
              Build apps powered by our pricing data. RESTful JSON API with
              comprehensive documentation. Access card prices, sales history,
              and price trends programmatically.
            </p>
            <a href="/pricing/docs" className="btn btn-primary btn-lg">
              View API Documentation
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
