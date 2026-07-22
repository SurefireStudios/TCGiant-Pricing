import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Documentation",
  description:
    "TCGiant Pricing API documentation. Access trading card prices, sales data, and price history programmatically.",
};

const API_BASE = "https://pricing.tcgiant.com";

const ENDPOINTS = [
  {
    method: "GET",
    path: "/api/v1/card",
    description: "Get a single card with prices across all 15 conditions.",
    params: [
      { name: "id", type: "integer", required: false, desc: "Card ID" },
      { name: "slug", type: "string", required: false, desc: "Card slug" },
      { name: "q", type: "string", required: false, desc: "Search query (card name, set, number)" },
    ],
    example: `curl "${API_BASE}/api/v1/card?key=YOUR_KEY&id=123"

{
  "status": "success",
  "id": "123",
  "name": "Charizard",
  "card_number": "4/102",
  "set_name": "Base Set",
  "game": "Pokemon",
  "image_url": "https://...",
  "prices": {
    "ungraded": 32500,
    "grade_1": 8500,
    "grade_9": 95000,
    "grade_9_5": 150000,
    "psa_10": 420000,
    "cgc_10": 280000,
    "bgs_10": 350000,
    "tag_10": 180000
  },
  "sale_count": 847,
  "last_updated": "2026-07-07"
}`,
  },
  {
    method: "GET",
    path: "/api/v1/cards",
    description: "Search and list cards with pagination.",
    params: [
      { name: "q", type: "string", required: false, desc: "Search query" },
      { name: "set", type: "string", required: false, desc: "Filter by set slug" },
      { name: "game", type: "string", required: false, desc: "Filter by game slug (default: pokemon)" },
      { name: "page", type: "integer", required: false, desc: "Page number (default: 1)" },
      { name: "limit", type: "integer", required: false, desc: "Results per page (default: 20, max: 100)" },
    ],
    example: `curl "${API_BASE}/api/v1/cards?key=YOUR_KEY&q=charizard&game=pokemon"`,
  },
  {
    method: "GET",
    path: "/api/v1/sets",
    description: "List all card sets, optionally filtered by game.",
    params: [
      { name: "game", type: "string", required: false, desc: "Filter by game slug" },
      { name: "page", type: "integer", required: false, desc: "Page number" },
      { name: "limit", type: "integer", required: false, desc: "Results per page (default: 50)" },
    ],
    example: `curl "${API_BASE}/api/v1/sets?key=YOUR_KEY&game=pokemon"`,
  },
  {
    method: "GET",
    path: "/api/v1/sales",
    description: "Get recent eBay sold listings for a card with filtering.",
    params: [
      { name: "card_id", type: "integer", required: true, desc: "Card ID" },
      { name: "condition", type: "string", required: false, desc: "Filter: UNGRADED, GRADE_9, PSA_10, etc." },
      { name: "grading_company", type: "string", required: false, desc: "Filter: PSA, CGC, BGS, TAG" },
      { name: "from", type: "date", required: false, desc: "Start date (YYYY-MM-DD)" },
      { name: "to", type: "date", required: false, desc: "End date (YYYY-MM-DD)" },
      { name: "include_outliers", type: "boolean", required: false, desc: "Include outlier sales (default: true)" },
      { name: "page", type: "integer", required: false, desc: "Page number" },
      { name: "limit", type: "integer", required: false, desc: "Results per page (default: 25)" },
    ],
    example: `curl "${API_BASE}/api/v1/sales?key=YOUR_KEY&card_id=123&condition=PSA_10"`,
  },
  {
    method: "GET",
    path: "/api/v1/price-history",
    description: "Get historical price data for charting. Returns time-series snapshots.",
    params: [
      { name: "card_id", type: "integer", required: true, desc: "Card ID" },
      { name: "condition", type: "string", required: false, desc: "Condition (default: UNGRADED)" },
      { name: "period", type: "string", required: false, desc: "daily or weekly (default: daily)" },
      { name: "from", type: "date", required: false, desc: "Start date (default: 90 days ago)" },
      { name: "to", type: "date", required: false, desc: "End date (default: today)" },
    ],
    example: `curl "${API_BASE}/api/v1/price-history?key=YOUR_KEY&card_id=123&condition=PSA_10&period=daily"`,
  },
  {
    method: "GET",
    path: "/api/v1/games",
    description: "List all supported TCG brands/games.",
    params: [],
    example: `curl "${API_BASE}/api/v1/games?key=YOUR_KEY"`,
  },
];

const CONDITIONS_TABLE = [
  { key: "ungraded", label: "Ungraded", desc: "No grading service has given the card a grade" },
  { key: "grade_1", label: "Grade 1", desc: "Graded by PSA, BGS, or CGC as 1" },
  { key: "grade_2", label: "Grade 2", desc: "Graded by PSA, BGS, or CGC as 2" },
  { key: "grade_3", label: "Grade 3", desc: "Graded by PSA, BGS, or CGC as 3" },
  { key: "grade_4", label: "Grade 4", desc: "Graded by PSA, BGS, or CGC as 4" },
  { key: "grade_5", label: "Grade 5", desc: "Graded by PSA, BGS, or CGC as 5" },
  { key: "grade_6", label: "Grade 6", desc: "Graded by PSA, BGS, or CGC as 6" },
  { key: "grade_7", label: "Grade 7", desc: "Graded by PSA, BGS, or CGC as 7" },
  { key: "grade_8", label: "Grade 8", desc: "Graded by PSA, BGS, or CGC as 8" },
  { key: "grade_9", label: "Grade 9", desc: "Graded by PSA, BGS, or CGC as 9" },
  { key: "grade_9_5", label: "Grade 9.5", desc: "Graded by BGS as 9.5" },
  { key: "psa_10", label: "PSA 10", desc: "Graded by PSA as a 10 (Gem Mint)" },
  { key: "cgc_10", label: "CGC 10", desc: "Graded by CGC as a 10 (Pristine/Perfect)" },
  { key: "bgs_10", label: "BGS 10", desc: "Graded by BGS (Beckett) as a 10 (Pristine)" },
  { key: "tag_10", label: "TAG 10", desc: "Graded by TAG as a 10 (Gem Mint)" },
];

export default function ApiDocsPage() {
  return (
    <div
      className="container"
      style={{
        position: "relative",
        zIndex: 1,
        paddingTop: "var(--space-2xl)",
        paddingBottom: "var(--space-3xl)",
        display: "grid",
        gridTemplateColumns: "200px 1fr",
        gap: "var(--space-2xl)",
      }}
    >
      {/* Sidebar Navigation */}
      <nav
        style={{
          position: "sticky",
          top: "calc(var(--header-height) + var(--space-lg))",
          alignSelf: "start",
          maxHeight: "calc(100vh - var(--header-height) - var(--space-2xl))",
          overflowY: "auto",
        }}
      >
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "var(--space-sm)" }}>
          Getting Started
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: "var(--space-lg)" }}>
          <a href="#overview" style={{ fontSize: "0.8rem", color: "var(--text-secondary)", padding: "4px 0" }}>Overview</a>
          <a href="#authentication" style={{ fontSize: "0.8rem", color: "var(--text-secondary)", padding: "4px 0" }}>Authentication</a>
          <a href="#rate-limits" style={{ fontSize: "0.8rem", color: "var(--text-secondary)", padding: "4px 0" }}>Rate Limits</a>
          <a href="#errors" style={{ fontSize: "0.8rem", color: "var(--text-secondary)", padding: "4px 0" }}>Error Handling</a>
        </div>

        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "var(--space-sm)" }}>
          Endpoints
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: "var(--space-lg)" }}>
          {ENDPOINTS.map((ep) => (
            <a key={ep.path} href={`#${ep.path.replace(/\//g, "-").slice(1)}`} style={{ fontSize: "0.8rem", color: "var(--text-secondary)", padding: "4px 0" }}>
              {ep.path}
            </a>
          ))}
        </div>

        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "var(--space-sm)" }}>
          Reference
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <a href="#conditions" style={{ fontSize: "0.8rem", color: "var(--text-secondary)", padding: "4px 0" }}>Condition IDs</a>
          <a href="#pricing-algorithm" style={{ fontSize: "0.8rem", color: "var(--text-secondary)", padding: "4px 0" }}>Pricing Algorithm</a>
        </div>
      </nav>

      {/* Main Content */}
      <div>
        <h1 style={{ marginBottom: "var(--space-md)" }}>
          TCGiant Pricing API
        </h1>
        <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-2xl)", maxWidth: 600 }}>
          Access trading card market prices, eBay sold listings, and historical
          price data. Build price guides, collection trackers, and pricing tools
          with our REST API.
        </p>

        {/* Overview */}
        <section id="overview" style={{ marginBottom: "var(--space-2xl)" }}>
          <h2 style={{ marginBottom: "var(--space-md)" }}>Overview</h2>
          <div className="glass-card" style={{ padding: "var(--space-lg)" }}>
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
              <li style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                ✅ Requests are made over <strong style={{ color: "var(--text-primary)" }}>HTTPS</strong>
              </li>
              <li style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                ✅ Responses are returned in <strong style={{ color: "var(--text-primary)" }}>JSON</strong> format
              </li>
              <li style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                ✅ <strong style={{ color: "var(--text-primary)" }}>CORS headers</strong> included for cross-site requests
              </li>
              <li style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                ✅ Prices are integers in <strong style={{ color: "var(--text-primary)" }}>cents</strong> (e.g., $17.32 = 1732)
              </li>
              <li style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                ✅ Dates are encoded as <strong style={{ color: "var(--text-primary)" }}>YYYY-MM-DD</strong> strings
              </li>
            </ul>
          </div>
        </section>

        {/* Authentication */}
        <section id="authentication" style={{ marginBottom: "var(--space-2xl)" }}>
          <h2 style={{ marginBottom: "var(--space-md)" }}>Authentication</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "var(--space-md)" }}>
            Every API call requires an API key. Pass it as a query parameter or header:
          </p>
          <div style={{ background: "var(--bg-elevated)", borderRadius: "var(--radius-md)", padding: "var(--space-md)", fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--color-success-light)", marginBottom: "var(--space-md)", overflowX: "auto", border: "1px solid var(--border-subtle)" }}>
            <div style={{ marginBottom: 8 }}># Query parameter</div>
            <div style={{ color: "var(--text-primary)" }}>
              curl &quot;{API_BASE}/api/v1/card?<span style={{ color: "var(--color-accent)" }}>key=YOUR_API_KEY</span>&amp;id=123&quot;
            </div>
            <div style={{ marginTop: 16, marginBottom: 8 }}># Header</div>
            <div style={{ color: "var(--text-primary)" }}>
              curl -H &quot;<span style={{ color: "var(--color-accent)" }}>X-Api-Key: YOUR_API_KEY</span>&quot; &quot;{API_BASE}/api/v1/card?id=123&quot;
            </div>
          </div>
        </section>

        {/* Rate Limits */}
        <section id="rate-limits" style={{ marginBottom: "var(--space-2xl)" }}>
          <h2 style={{ marginBottom: "var(--space-md)" }}>Rate Limits</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Tier</th>
                <th>Requests/Min</th>
                <th>Requests/Day</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className="badge" style={{ background: "rgba(99,102,241,0.15)", color: "var(--color-primary-light)", border: "1px solid rgba(99,102,241,0.2)" }}>Free</span></td>
                <td className="font-mono">10</td>
                <td className="font-mono">100</td>
                <td>$0</td>
              </tr>
              <tr>
                <td><span className="badge" style={{ background: "rgba(245,158,11,0.15)", color: "var(--color-accent)", border: "1px solid rgba(245,158,11,0.2)" }}>Pro</span></td>
                <td className="font-mono">60</td>
                <td className="font-mono">10,000</td>
                <td>TBD</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Error Handling */}
        <section id="errors" style={{ marginBottom: "var(--space-2xl)" }}>
          <h2 style={{ marginBottom: "var(--space-md)" }}>Error Handling</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "var(--space-md)" }}>
            Every response includes a <code style={{ background: "var(--bg-elevated)", padding: "2px 6px", borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>status</code> field
            set to <code style={{ background: "var(--bg-elevated)", padding: "2px 6px", borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--color-success)" }}>success</code> or{" "}
            <code style={{ background: "var(--bg-elevated)", padding: "2px 6px", borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--color-danger)" }}>error</code>.
          </p>
          <div style={{ background: "var(--bg-elevated)", borderRadius: "var(--radius-md)", padding: "var(--space-md)", fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}>
{`{
  "status": "error",
  "error-message": "API key is required."
}`}
          </div>
        </section>

        {/* Endpoints */}
        <h2 style={{ marginBottom: "var(--space-xl)", paddingTop: "var(--space-lg)", borderTop: "1px solid var(--border-subtle)" }}>
          API Endpoints
        </h2>

        {ENDPOINTS.map((ep) => (
          <section
            key={ep.path}
            id={ep.path.replace(/\//g, "-").slice(1)}
            style={{ marginBottom: "var(--space-2xl)" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: "var(--space-sm)" }}>
              <span className="badge" style={{ background: "rgba(16,185,129,0.15)", color: "var(--color-success-light)", border: "1px solid rgba(16,185,129,0.2)", fontFamily: "var(--font-mono)" }}>
                {ep.method}
              </span>
              <h3 style={{ fontFamily: "var(--font-mono)", fontSize: "1rem" }}>{ep.path}</h3>
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "var(--space-md)" }}>
              {ep.description}
            </p>

            {ep.params.length > 0 && (
              <>
                <h4 style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "var(--space-sm)", color: "var(--text-secondary)" }}>Parameters</h4>
                <table className="data-table" style={{ marginBottom: "var(--space-md)" }}>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Required</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ep.params.map((p) => (
                      <tr key={p.name}>
                        <td><code style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--color-primary-light)" }}>{p.name}</code></td>
                        <td style={{ fontSize: "0.8rem" }}>{p.type}</td>
                        <td>{p.required ? <span style={{ color: "var(--color-danger)" }}>Yes</span> : "No"}</td>
                        <td style={{ fontSize: "0.85rem" }}>{p.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            <h4 style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "var(--space-sm)", color: "var(--text-secondary)" }}>Example</h4>
            <div style={{ background: "var(--bg-elevated)", borderRadius: "var(--radius-md)", padding: "var(--space-md)", fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", overflowX: "auto", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
              {ep.example}
            </div>
          </section>
        ))}

        {/* Condition IDs Reference */}
        <section id="conditions" style={{ marginBottom: "var(--space-2xl)", paddingTop: "var(--space-lg)", borderTop: "1px solid var(--border-subtle)" }}>
          <h2 style={{ marginBottom: "var(--space-md)" }}>Condition IDs</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "var(--space-md)" }}>
            We track 15 conditions for each card, covering ungraded and graded across
            all major grading companies.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>API Key</th>
                <th>Label</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {CONDITIONS_TABLE.map((c) => (
                <tr key={c.key}>
                  <td><code style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--color-primary-light)" }}>{c.key}</code></td>
                  <td style={{ fontWeight: 600 }}>{c.label}</td>
                  <td style={{ fontSize: "0.85rem" }}>{c.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Pricing Algorithm */}
        <section id="pricing-algorithm" style={{ marginBottom: "var(--space-2xl)" }}>
          <h2 style={{ marginBottom: "var(--space-md)" }}>How We Determine Prices</h2>
          <div className="glass-card" style={{ padding: "var(--space-lg)" }}>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "var(--space-md)" }}>
              We combine all eBay sold listing data to determine the current market price.
              Our algorithm considers:
            </p>
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}>
              <li style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                📊 <strong style={{ color: "var(--text-primary)" }}>EWMA</strong> — Exponentially Weighted Moving Average gives more weight to recent sales (40% of final price)
              </li>
              <li style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                📈 <strong style={{ color: "var(--text-primary)" }}>Median Price</strong> — Most robust against manipulation (35% of final price)
              </li>
              <li style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                🔄 <strong style={{ color: "var(--text-primary)" }}>Recent Average</strong> — Average of last 5 sales for responsiveness (25% of final price)
              </li>
              <li style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                🚫 <strong style={{ color: "var(--text-primary)" }}>Outlier Detection</strong> — IQR method flags suspiciously low/high sales
              </li>
              <li style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                ⏳ <strong style={{ color: "var(--text-primary)" }}>Age Weighting</strong> — Recent sales (7 days) weighted at 100%, older sales decay
              </li>
            </ul>
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
              Minimum 3 non-outlier sales required to calculate a price. Outlier sales
              are preserved in the database and visible in sales history but excluded
              from price calculations.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
