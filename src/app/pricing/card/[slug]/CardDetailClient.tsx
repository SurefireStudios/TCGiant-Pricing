"use client";

import { useState } from "react";
import { getConditionLabel } from "@/lib/grade-parser";
import type { CardCondition } from "@/lib/grade-parser";
import { formatPrice } from "@/lib/pricing-engine";
import PriceChart from "@/components/PriceChart";
import type { PriceDataPoint } from "@/components/PriceChart";
import SalesTable from "@/components/SalesTable";
import type { Sale } from "@/components/SalesTable";
import FallbackImage from "@/components/FallbackImage";

interface CardData {
  id: number;
  name: string;
  cardNumber: string | null;
  setName: string;
  setSlug: string;
  game: string;
  gameSlug: string;
  rarity: string;
  supertype: string;
  hp: string | null;
  artist: string;
  variant?: string;
  imageUrl: string;
  prices: Record<string, number | null>;
  volumes?: Record<string, string | null>;
  saleCount: number;
  lastUpdated: string;
  sales: Sale[];
  priceHistory: (PriceDataPoint & { condition: string })[];
}

const ALL_CONDITIONS: CardCondition[] = [
  "UNGRADED",
  "GRADE_1",
  "GRADE_2",
  "GRADE_3",
  "GRADE_4",
  "GRADE_5",
  "GRADE_6",
  "GRADE_7",
  "GRADE_8",
  "GRADE_9",
  "GRADE_9_5",
  "PSA_10",
  "CGC_10",
  "BGS_10",
  "TAG_10",
];

const QUICK_CONDITIONS: CardCondition[] = [
  "UNGRADED",
  "GRADE_9",
  "GRADE_9_5",
  "PSA_10",
  "CGC_10",
  "BGS_10",
  "TAG_10",
];

function getConditionBadgeClass(condition: CardCondition): string {
  if (condition.startsWith("PSA")) return "badge-psa";
  if (condition.startsWith("CGC")) return "badge-cgc";
  if (condition.startsWith("BGS")) return "badge-bgs";
  if (condition.startsWith("TAG")) return "badge-tag";
  return "badge-ungraded";
}

export default function CardDetailClient({ card }: { card: CardData }) {
  const [selectedCondition, setSelectedCondition] =
    useState<CardCondition>("UNGRADED");
  const [chartTimeRange, setChartTimeRange] = useState("90d");

  const currentPrice = card.prices[selectedCondition];
  const hasPrices = Object.values(card.prices).some((p) => p !== null && p !== undefined);

  const handleVolumeClick = (e: React.MouseEvent, condition: CardCondition) => {
    e.stopPropagation();
    setSelectedCondition(condition);
    const element = document.getElementById("recent-sales-section");
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

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
        <a
          href={`/pricing/${card.gameSlug}`}
          style={{ color: "var(--text-muted)" }}
        >
          {card.game}
        </a>
        {" / "}
        <a
          href={`/pricing/${card.gameSlug}/${card.setSlug}`}
          style={{ color: "var(--text-muted)" }}
        >
          {card.setName}
        </a>
        {" / "}
        <span style={{ color: "var(--text-primary)" }}>{card.name}</span>
      </nav>

      {/* Main Header Card */}
      <div
        className="glass-card"
        style={{
          padding: "var(--space-xl)",
          marginBottom: "var(--space-2xl)",
          display: "grid",
          gridTemplateColumns: "240px 1fr",
          gap: "var(--space-2xl)",
          alignItems: "start",
        }}
      >
        {/* Card Image */}
        <div
          style={{
            position: "relative",
            aspectRatio: "0.714",
            borderRadius: "var(--radius-lg)",
            overflow: "hidden",
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          {card.imageUrl ? (
            <FallbackImage
              src={card.imageUrl}
              alt={card.name}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "var(--text-muted)",
              }}
            >
              No Image
            </div>
          )}
        </div>

        {/* Card Metadata & Market Price */}
        <div>
          {/* Header Info */}
          <div style={{ marginBottom: "var(--space-xl)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-sm)",
                marginBottom: "var(--space-xs)",
              }}
            >
              <span className="badge badge-ungraded">{card.rarity}</span>
              {card.variant && card.variant !== 'unlimited' && (
                <span className="badge badge-ungraded" style={{ textTransform: "capitalize" }}>
                  {card.variant.replace("_", " ")}
                </span>
              )}
            </div>
            <h1 style={{ fontSize: "2rem", marginBottom: "var(--space-xs)" }}>
              {card.name}
            </h1>
            <p className="text-sm text-secondary">
              {card.setName} · {card.supertype}
              {card.hp ? ` · HP ${card.hp}` : ""}
              {card.artist ? ` · Artist: ${card.artist}` : ""}
            </p>
          </div>

          {/* Market Price Banner */}
          <div
            className="glass-card"
            style={{
              padding: "var(--space-lg)",
              background: "rgba(99, 102, 241, 0.05)",
              border: "1px solid rgba(99, 102, 241, 0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  fontWeight: 600,
                  marginBottom: "var(--space-2xs)",
                }}
              >
                Market Price ·{" "}
                <span style={{ color: "var(--color-primary-light)" }}>
                  {getConditionLabel(selectedCondition)}
                </span>
              </div>
              <div
                className="price font-mono"
                style={{
                  fontSize: "2.5rem",
                  fontWeight: 700,
                  color: "var(--text-primary)",
                }}
              >
                {currentPrice !== null ? formatPrice(currentPrice) : "N/A"}
              </div>
            </div>

            {/* Condition Selector */}
            <div style={{ textAlign: "right" }}>
              <label
                htmlFor="condition-select"
                style={{
                  fontSize: "0.75rem",
                  color: "var(--text-muted)",
                  display: "block",
                  marginBottom: "var(--space-2xs)",
                }}
              >
                Grade / Condition
              </label>
              <select
                id="condition-select"
                className="btn btn-ghost"
                value={selectedCondition}
                onChange={(e) =>
                  setSelectedCondition(e.target.value as CardCondition)
                }
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-primary)",
                  padding: "var(--space-xs) var(--space-md)",
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                }}
              >
                {ALL_CONDITIONS.map((cond) => (
                  <option key={cond} value={cond}>
                    {getConditionLabel(cond)}
                    {card.prices[cond]
                      ? ` — ${formatPrice(card.prices[cond]!)}`
                      : " (No Data)"}
                  </option>
                ))}
              </select>
            </div>

            {/* Total Sales Counter */}
            <div style={{ textAlign: "right" }}>
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "var(--text-muted)",
                  marginBottom: "var(--space-2xs)",
                }}
              >
                Total Sales
              </div>
              <div
                className="font-mono"
                style={{
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  color: "var(--text-primary)",
                }}
              >
                {card.saleCount}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Price Grid across all conditions */}
      <section className="section">
        <div className="section-header">
          <h2 className="section-title">All Prices</h2>
        </div>
        <div className="price-grid">
          {ALL_CONDITIONS.map((condition) => {
            const price = card.prices[condition];
            return (
              <button
                key={condition}
                className="price-grid-item"
                style={{
                  cursor: "pointer",
                  border:
                    selectedCondition === condition
                      ? "1px solid var(--color-primary)"
                      : "1px solid var(--border-subtle)",
                  background:
                    selectedCondition === condition
                      ? "var(--bg-hover)"
                      : "var(--bg-elevated)",
                }}
                onClick={() => setSelectedCondition(condition)}
              >
                <div className="price-grid-label">
                  {getConditionLabel(condition)}
                </div>
                <div className={`price-grid-value ${!price ? "no-data" : ""}`}>
                  {price ? formatPrice(price) : "—"}
                </div>
                {card.volumes && card.volumes[condition] && (
                  <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: 4, whiteSpace: "nowrap" }}>
                    volume:{" "}
                    <span
                      onClick={(e) => handleVolumeClick(e, condition)}
                      style={{
                        color: "var(--color-primary-light)",
                        fontWeight: 500,
                        textDecoration: "underline",
                        cursor: "pointer",
                      }}
                      title="Jump to Recent Sales"
                    >
                      {card.volumes[condition]}
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Price Chart */}
      <section className="section">
        <div className="section-header">
          <h2 className="section-title">Price History</h2>
          <div className="filter-tabs" style={{ width: "auto" }}>
            {["7d", "30d", "90d", "1y", "All"].map((range) => (
              <button
                key={range}
                className={`filter-tab ${chartTimeRange === range ? "active" : ""}`}
                onClick={() => setChartTimeRange(range)}
              >
                {range}
              </button>
            ))}
          </div>
        </div>
        <div className="chart-container">
          <PriceChart condition={selectedCondition} timeRange={chartTimeRange} data={card.priceHistory.filter(h => h.condition === selectedCondition)} />
        </div>
      </section>

      {/* Recent Sales */}
      <section id="recent-sales-section" className="section">
        <div className="section-header">
          <h2 className="section-title">Recent Sales</h2>
        </div>
        <SalesTable
          cardId={card.id}
          sales={card.sales}
          selectedCondition={selectedCondition}
          onConditionChange={setSelectedCondition}
        />
      </section>
    </div>
  );
}
